from __future__ import annotations

import math
from typing import Any, Dict, List

import numpy as np


class OpenSeesStaticExecutor:
    def __init__(self, analyzer):
        self.analyzer = analyzer

    @staticmethod
    def _positive_section_property(section: Any, key: str, element_id: str) -> float:
        try:
            value = float(section.properties.get(key, 0.0))
        except (TypeError, ValueError) as error:
            raise ValueError(f"Element '{element_id}' section property {key} must be finite") from error
        if not math.isfinite(value) or value <= 0.0:
            raise ValueError(f"Element '{element_id}' requires section property {key} > 0")
        return value

    @staticmethod
    def _material_moduli(material: Any, element_id: str) -> tuple[float, float]:
        if material is None:
            raise ValueError(f"Element '{element_id}' references an unavailable material")
        try:
            elastic_modulus = float(material.E) * 1000.0
            poisson_ratio = float(material.nu)
        except (TypeError, ValueError) as error:
            raise ValueError(f"Element '{element_id}' material properties must be finite") from error
        if not math.isfinite(elastic_modulus) or elastic_modulus <= 0.0:
            raise ValueError(f"Element '{element_id}' requires material E > 0")
        if not math.isfinite(poisson_ratio) or poisson_ratio < 0.0 or poisson_ratio > 0.5:
            raise ValueError(f"Element '{element_id}' requires 0 <= material nu <= 0.5")
        return elastic_modulus, elastic_modulus / (2.0 * (1.0 + poisson_ratio))

    @staticmethod
    def _element_response_values(ops, element_tag: int, response: str, expected: int, element_id: str) -> List[float]:
        raw = ops.eleResponse(element_tag, response)
        if isinstance(raw, (list, tuple, np.ndarray)):
            values = [float(value) for value in raw]
        elif raw is None:
            values = []
        else:
            values = [float(raw)]
        if len(values) < expected or not all(math.isfinite(value) for value in values[:expected]):
            raise ValueError(
                f"OpenSees returned an invalid {response} response for element '{element_id}'"
            )
        return values[:expected]

    def run(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        import openseespy.opensees as ops
        from coordinate_semantics import resolve_model_dimension

        ops.wipe()
        dimension = resolve_model_dimension(self.analyzer.model)
        if dimension == '2d':
            if not self.analyzer._can_run_2d_frame_solver():
                raise ValueError("Canonical 2-D OpenSees frame analysis does not support mixed frame/truss models")
            return self._run_2d_frame(parameters, ops)
        return self._run_3d_frame(parameters, ops)

    def _run_2d_frame(self, parameters: Dict[str, Any], ops) -> Dict[str, Any]:
        plane = self.analyzer._select_opensees_planar_frame_mode(parameters) or 'xz'
        if plane != 'xz':
            raise ValueError("Canonical 2-D OpenSees analysis supports only the global X-Z plane")
        loads = self.analyzer._collect_nodal_loads(parameters)

        ops.model('basic', '-ndm', 2, '-ndf', 3)

        for node in self.analyzer.model.nodes:
            x_coord, y_coord = self.analyzer._get_2d_plane_coordinates(node, plane)
            node_tag = self.analyzer._ops_node_tag(node.id)
            ops.node(node_tag, x_coord, y_coord)
            restraints = node.restraints or [False] * 6
            ops.fix(node_tag, int(bool(restraints[0])), int(bool(restraints[2])), int(bool(restraints[4])))

        for elem in self.analyzer.model.elements:
            self._define_beam_element_2d(elem, ops)

        self._apply_standardized_loads_2d(loads, ops, plane)
        analysis_status = self._run_static_analysis(ops)
        if analysis_status != 0:
            ops.wipe()
            raise RuntimeError(
                f"OpenSees static analysis failed with code {analysis_status}. "
                "The model may be unstable or insufficiently restrained."
            )

        ops.reactions()
        displacements: Dict[str, Dict[str, float]] = {}
        reactions: Dict[str, Dict[str, float]] = {}
        for node in self.analyzer.model.nodes:
            node_tag = self.analyzer._ops_node_tag(node.id)
            disp = ops.nodeDisp(node_tag)
            react = ops.nodeReaction(node_tag)
            displacements[node.id] = {
                'ux': float(disp[0]),
                'uy': 0.0,
                'uz': float(disp[1]),
                'rx': 0.0,
                'ry': float(disp[2]),
                'rz': 0.0,
            }
            if any(node.restraints or []):
                reactions[node.id] = {
                    'fx': float(react[0]),
                    'fz': float(react[1]),
                    'my': float(react[2]),
                }

        forces: Dict[str, Dict[str, Any]] = {}
        for elem in self.analyzer.model.elements:
            raw_force = self._element_response_values(
                ops,
                self.analyzer._ops_element_tag(elem.id),
                'localForce',
                6,
                elem.id,
            )
            axial_start, shear_start, moment_start, axial_end, shear_end, moment_end = [
                float(value) for value in raw_force[:6]
            ]
            area = float(self.analyzer.sections[elem.section].properties.get('A', 0.0))
            forces[elem.id] = {
                'referenceFrame': 'element-local',
                'n1': {'N': axial_start, 'V': shear_start, 'M': moment_start},
                'n2': {'N': axial_end, 'V': shear_end, 'M': moment_end},
                'axial': axial_start,
                'stress': float(axial_start / area) if area > 0.0 else 0.0,
            }

        ops.wipe()
        return self.analyzer._attach_floor_load_transfer({
            'status': 'success',
            'analysisMode': 'opensees_2d_frame',
            'plane': plane,
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self.analyzer._build_envelope(displacements, forces, reactions),
            'summary': self.analyzer._generate_summary(displacements, forces),
        })

    def _run_3d_frame(self, parameters: Dict[str, Any], ops) -> Dict[str, Any]:
        loads = self.analyzer._collect_nodal_loads(parameters)

        ops.model('basic', '-ndm', 3, '-ndf', 6)

        for node in self.analyzer.model.nodes:
            node_tag = self.analyzer._ops_node_tag(node.id)
            ops.node(node_tag, node.x, node.y, node.z)
            if node.restraints:
                ops.fix(node_tag, *[int(bool(value)) for value in node.restraints])

        for elem in self.analyzer.model.elements:
            if elem.type in {'beam', 'column'}:
                self._define_beam_element(elem, ops)
            elif elem.type == 'truss':
                self._define_truss_element(elem, ops)
            else:
                raise ValueError(f"OpenSees static analysis does not support element type '{elem.type}'")

        self._apply_standardized_loads_3d(loads, ops)
        analysis_status = self._run_static_analysis(ops)
        if analysis_status != 0:
            ops.wipe()
            raise RuntimeError(
                f"OpenSees static analysis failed with code {analysis_status}. "
                "The model may be unstable or insufficiently restrained."
            )

        ops.reactions()
        displacements = {}
        reactions = {}
        for node in self.analyzer.model.nodes:
            node_tag = self.analyzer._ops_node_tag(node.id)
            disp = ops.nodeDisp(node_tag)
            react = ops.nodeReaction(node_tag)
            displacements[node.id] = {
                'ux': float(disp[0]),
                'uy': float(disp[1]),
                'uz': float(disp[2]),
                'rx': float(disp[3]),
                'ry': float(disp[4]),
                'rz': float(disp[5]),
            }
            if any(node.restraints or []):
                reactions[node.id] = {
                    'fx': float(react[0]),
                    'fy': float(react[1]),
                    'fz': float(react[2]),
                    'mx': float(react[3]),
                    'my': float(react[4]),
                    'mz': float(react[5]),
                }

        forces = {}
        for elem in self.analyzer.model.elements:
            element_tag = self.analyzer._ops_element_tag(elem.id)
            local_axes = self.analyzer._element_local_axes(elem)
            if elem.type in {'beam', 'column'}:
                force = self._element_response_values(ops, element_tag, 'localForce', 12, elem.id)
                area = self._positive_section_property(self.analyzer.sections[elem.section], 'A', elem.id)
                forces[elem.id] = {
                    'referenceFrame': 'element-local',
                    'localAxes': {
                        'x': local_axes[0].tolist(),
                        'y': local_axes[1].tolist(),
                        'z': local_axes[2].tolist(),
                    },
                    'n1': {
                        'N': float(force[0]),
                        'V': float(np.sqrt(force[1] ** 2 + force[2] ** 2)),
                        'M': float(np.sqrt(force[4] ** 2 + force[5] ** 2)),
                        'V2': float(force[1]),
                        'V3': float(force[2]),
                        'T': float(force[3]),
                        'M2': float(force[4]),
                        'M3': float(force[5]),
                    },
                    'n2': {
                        'N': float(force[6]),
                        'V': float(np.sqrt(force[7] ** 2 + force[8] ** 2)),
                        'M': float(np.sqrt(force[10] ** 2 + force[11] ** 2)),
                        'V2': float(force[7]),
                        'V3': float(force[8]),
                        'T': float(force[9]),
                        'M2': float(force[10]),
                        'M3': float(force[11]),
                    },
                    'axial': float(force[0]),
                    'stress': float(force[0] / area),
                }
            else:
                axial = self._element_response_values(ops, element_tag, 'axialForce', 1, elem.id)[0]
                area = self._positive_section_property(self.analyzer.sections[elem.section], 'A', elem.id)
                forces[elem.id] = {
                    'referenceFrame': 'element-local',
                    'localAxes': {
                        'x': local_axes[0].tolist(),
                        'y': local_axes[1].tolist(),
                        'z': local_axes[2].tolist(),
                    },
                    'axial': axial,
                    'stress': axial / area,
                }

        ops.wipe()
        return self.analyzer._attach_floor_load_transfer({
            'status': 'success',
            'analysisMode': 'opensees_3d_frame',
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self.analyzer._build_envelope(displacements, forces, reactions),
            'summary': self.analyzer._generate_summary(displacements, forces),
        })

    def _run_static_analysis(self, ops) -> int:
        ops.system('BandGeneral')
        ops.numberer('Plain')
        ops.constraints('Plain')
        ops.integrator('LoadControl', 1.0)
        ops.algorithm('Newton')
        ops.analysis('Static')
        return int(ops.analyze(1))

    def _define_beam_element(self, elem, ops) -> None:
        section = self.analyzer.sections.get(elem.section)
        material = self.analyzer.materials.get(elem.material)
        if not section:
            raise ValueError(f"Section '{elem.section}' was not found for frame element '{elem.id}'")

        area = self._positive_section_property(section, 'A', elem.id)
        torsion = self._positive_section_property(section, 'J', elem.id)
        inertia_y = self._positive_section_property(section, 'Iy', elem.id)
        inertia_z = self._positive_section_property(section, 'Iz', elem.id)
        elastic_modulus, shear_modulus = self._material_moduli(material, elem.id)

        transform_tag = self.analyzer._ops_element_tag(elem.id)
        reference_vector = self.analyzer._get_beam_reference_vector(elem)
        ops.geomTransf('Linear', transform_tag, *reference_vector)
        ops.element(
            'elasticBeamColumn',
            self.analyzer._ops_element_tag(elem.id),
            self.analyzer._ops_node_tag(elem.nodes[0]),
            self.analyzer._ops_node_tag(elem.nodes[1]),
            area,
            elastic_modulus,
            shear_modulus,
            torsion,
            inertia_y,
            inertia_z,
            transform_tag,
        )

    def _define_beam_element_2d(self, elem, ops) -> None:
        section = self.analyzer.sections.get(elem.section)
        material = self.analyzer.materials.get(elem.material)
        if not section:
            raise ValueError(f"Section '{elem.section}' was not found for beam element '{elem.id}'")

        transform_tag = self.analyzer._ops_element_tag(elem.id)
        area = self._positive_section_property(section, 'A', elem.id)
        inertia = self._positive_section_property(section, 'Iy', elem.id)
        elastic_modulus, _ = self._material_moduli(material, elem.id)
        ops.geomTransf('Linear', transform_tag)
        ops.element(
            'elasticBeamColumn',
            self.analyzer._ops_element_tag(elem.id),
            self.analyzer._ops_node_tag(elem.nodes[0]),
            self.analyzer._ops_node_tag(elem.nodes[1]),
            area,
            elastic_modulus,
            inertia,
            transform_tag,
        )

    def _define_truss_element(self, elem, ops) -> None:
        section = self.analyzer.sections.get(elem.section)
        if section is None:
            raise ValueError(f"Section '{elem.section}' was not found for truss element '{elem.id}'")
        area = self._positive_section_property(section, 'A', elem.id)
        ops.element(
            'truss',
            self.analyzer._ops_element_tag(elem.id),
            self.analyzer._ops_node_tag(elem.nodes[0]),
            self.analyzer._ops_node_tag(elem.nodes[1]),
            area,
            self.analyzer._ops_material_tag(elem.material),
        )

    def _apply_standardized_loads_2d(self, loads: List[Dict[str, Any]], ops, plane: str) -> None:
        if not loads:
            return
        ops.timeSeries('Linear', 1)
        ops.pattern('Plain', 1, 1)

        for load in loads:
            if load.get('type') == 'nodal':
                transverse = self.analyzer._plane_transverse_force(load, plane)
                moment = self.analyzer._plane_bending_moment(load, plane)
                ops.load(
                    self.analyzer._ops_node_tag(load['node']),
                    float(load.get('fx', 0.0)),
                    transverse,
                    moment,
                )
            elif load.get('type') == 'distributed':
                elem = self.analyzer.elements.get(str(load['element']))
                if elem is None:
                    raise ValueError(f"Unknown element '{load['element']}' in distributed load")
                qx, qy = self.analyzer._distributed_load_planar_components(load, elem)
                ops.eleLoad(
                    '-ele',
                    self.analyzer._ops_element_tag(load['element']),
                    '-type',
                    '-beamUniform',
                    qy,
                    qx,
                )

    def _apply_standardized_loads_3d(self, loads: List[Dict[str, Any]], ops) -> None:
        if not loads:
            return
        ops.timeSeries('Linear', 1)
        ops.pattern('Plain', 1, 1)

        for load in loads:
            if load.get('type') == 'nodal':
                forces = load.get('forces')
                if isinstance(forces, list) and len(forces) >= 6:
                    ops.load(self.analyzer._ops_node_tag(load['node']), *[float(value) for value in forces[:6]])
                else:
                    ops.load(
                        self.analyzer._ops_node_tag(load['node']),
                        float(load.get('fx', 0.0)),
                        float(load.get('fy', 0.0)),
                        float(load.get('fz', 0.0)),
                        float(load.get('mx', 0.0)),
                        float(load.get('my', 0.0)),
                        float(load.get('mz', 0.0)),
                    )
            elif load.get('type') == 'distributed':
                elem = self.analyzer.elements.get(str(load['element']))
                if elem is None:
                    raise ValueError(f"Unknown element '{load['element']}' in distributed load")
                if load.get('distribution') == 'piecewise_linear':
                    for position, px, py, pz in self.analyzer._piecewise_linear_element_point_loads(load, elem):
                        ops.eleLoad(
                            '-ele',
                            self.analyzer._ops_element_tag(load['element']),
                            '-type',
                            '-beamPoint',
                            py,
                            pz,
                            position,
                            px,
                        )
                    continue
                wx, wy, wz = self.analyzer._distributed_load_local_components(load, elem)
                ops.eleLoad(
                    '-ele',
                    self.analyzer._ops_element_tag(load['element']),
                    '-type',
                    '-beamUniform',
                    wy,
                    wz,
                    wx,
                )
