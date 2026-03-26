from __future__ import annotations

from typing import Any, Dict, List

import numpy as np


class OpenSeesStaticExecutor:
    def __init__(self, analyzer):
        self.analyzer = analyzer

    def run(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        import openseespy.opensees as ops

        ops.wipe()
        if self.analyzer._select_opensees_planar_frame_mode(parameters):
            return self._run_2d_frame(parameters, ops)
        return self._run_3d_frame(parameters, ops)

    def _run_2d_frame(self, parameters: Dict[str, Any], ops) -> Dict[str, Any]:
        plane = self.analyzer._select_opensees_planar_frame_mode(parameters) or 'xz'
        loads = self.analyzer._collect_nodal_loads(parameters)

        ops.model('basic', '-ndm', 2, '-ndf', 3)

        for node in self.analyzer.model.nodes:
            x_coord, y_coord = self.analyzer._get_2d_plane_coordinates(node, plane)
            node_tag = self.analyzer._ops_node_tag(node.id)
            ops.node(node_tag, x_coord, y_coord)
            restraints = node.restraints or [False] * 6
            if plane == 'xy':
                ops.fix(node_tag, int(bool(restraints[0])), int(bool(restraints[1])), int(bool(restraints[5])))
            else:
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
            if plane == 'xy':
                displacements[node.id] = {
                    'ux': float(disp[0]),
                    'uy': float(disp[1]),
                    'uz': 0.0,
                    'rx': 0.0,
                    'ry': 0.0,
                    'rz': float(disp[2]),
                }
                if any(node.restraints or []):
                    reactions[node.id] = {
                        'fx': float(react[0]),
                        'fy': float(react[1]),
                        'mz': float(react[2]),
                    }
            else:
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
            raw_force = ops.eleForce(self.analyzer._ops_element_tag(elem.id))
            axial_start, shear_start, moment_start, axial_end, shear_end, moment_end = [
                float(value) for value in raw_force[:6]
            ]
            area = float(self.analyzer.sections[elem.section].properties.get('A', 0.0))
            forces[elem.id] = {
                'n1': {'N': axial_start, 'V': shear_start, 'M': moment_start},
                'n2': {'N': axial_end, 'V': shear_end, 'M': moment_end},
                'axial': axial_start,
                'stress': float(axial_start / area) if area > 0.0 else 0.0,
            }

        ops.wipe()
        return {
            'status': 'success',
            'analysisMode': 'opensees_2d_frame',
            'plane': plane,
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self.analyzer._build_envelope(displacements, forces, reactions),
            'summary': self.analyzer._generate_summary(displacements, forces),
        }

    def _run_3d_frame(self, parameters: Dict[str, Any], ops) -> Dict[str, Any]:
        loads = self.analyzer._collect_nodal_loads(parameters)

        ops.model('basic', '-ndm', 3, '-ndf', 6)

        for node in self.analyzer.model.nodes:
            node_tag = self.analyzer._ops_node_tag(node.id)
            ops.node(node_tag, node.x, node.y, node.z)
            if node.restraints:
                ops.fix(node_tag, *[int(bool(value)) for value in node.restraints])

        for elem in self.analyzer.model.elements:
            if elem.type == 'beam':
                self._define_beam_element(elem, ops)
            elif elem.type == 'truss':
                self._define_truss_element(elem, ops)

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
            try:
                force = ops.eleForce(self.analyzer._ops_element_tag(elem.id))
                if elem.type == 'beam':
                    area = float(self.analyzer.sections[elem.section].properties.get('A', 0.0))
                    forces[elem.id] = {
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
                        'stress': float(force[0] / area) if area > 0.0 else 0.0,
                    }
                else:
                    forces[elem.id] = list(force)
            except Exception:
                pass

        ops.wipe()
        return {
            'status': 'success',
            'analysisMode': 'opensees_3d_frame',
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self.analyzer._build_envelope(displacements, forces, reactions),
            'summary': self.analyzer._generate_summary(displacements, forces),
        }

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
            raise ValueError(f"Section '{elem.section}' was not found for beam element '{elem.id}'")

        transform_tag = self.analyzer._ops_element_tag(elem.id)
        reference_vector = self.analyzer._get_beam_reference_vector(elem)
        ops.geomTransf('Linear', transform_tag, *reference_vector)
        ops.element(
            'elasticBeamColumn',
            self.analyzer._ops_element_tag(elem.id),
            self.analyzer._ops_node_tag(elem.nodes[0]),
            self.analyzer._ops_node_tag(elem.nodes[1]),
            section.properties.get('A', 0.01),
            (material.E * 1000) if material else section.properties.get('E', 200000000),
            section.properties.get('G', 79000000),
            section.properties.get('J', 0.0001),
            section.properties.get('Iy', 0.0001),
            section.properties.get('Iz', 0.0001),
            transform_tag,
        )

    def _define_beam_element_2d(self, elem, ops) -> None:
        section = self.analyzer.sections.get(elem.section)
        material = self.analyzer.materials.get(elem.material)
        if not section:
            raise ValueError(f"Section '{elem.section}' was not found for beam element '{elem.id}'")

        transform_tag = self.analyzer._ops_element_tag(elem.id)
        inertia = float(section.properties.get('Iy', section.properties.get('Iz', 0.0001)))
        ops.geomTransf('Linear', transform_tag)
        ops.element(
            'elasticBeamColumn',
            self.analyzer._ops_element_tag(elem.id),
            self.analyzer._ops_node_tag(elem.nodes[0]),
            self.analyzer._ops_node_tag(elem.nodes[1]),
            float(section.properties.get('A', 0.01)),
            float((material.E * 1000) if material else section.properties.get('E', 200000000)),
            inertia,
            transform_tag,
        )

    def _define_truss_element(self, elem, ops) -> None:
        section = self.analyzer.sections.get(elem.section)
        if section:
            ops.element(
                'truss',
                self.analyzer._ops_element_tag(elem.id),
                self.analyzer._ops_node_tag(elem.nodes[0]),
                self.analyzer._ops_node_tag(elem.nodes[1]),
                section.properties.get('A', 0.01),
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
                ops.eleLoad(
                    '-ele',
                    self.analyzer._ops_element_tag(load['element']),
                    '-type',
                    '-beamUniform',
                    self.analyzer._plane_distributed_load(load, plane),
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
                ops.eleLoad(
                    '-ele',
                    self.analyzer._ops_element_tag(load['element']),
                    '-type',
                    '-beamUniform',
                    float(load.get('wy', 0.0)),
                    float(load.get('wz', 0.0)),
                )
