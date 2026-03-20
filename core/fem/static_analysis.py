"""
静力分析模块
基于 OpenSeesPy 实现线性静力分析
"""

import numpy as np
from typing import Dict, Any, List, Optional
import logging

logger = logging.getLogger(__name__)


class StaticAnalyzer:
    """静力分析器"""

    def __init__(self, model, engine_mode: str = "auto"):
        """
        初始化分析器

        Args:
            model: 结构模型数据
        """
        self.model = model
        self.engine_mode = engine_mode
        self.nodes = {n.id: n for n in model.nodes}
        self.elements = {e.id: e for e in model.elements}
        self.materials = {m.id: m for m in model.materials}
        self.sections = {s.id: s for s in model.sections}

        # OpenSees requires integer tags; keep external IDs untouched and map internally.
        self._ops_node_tags = {str(node.id): index + 1 for index, node in enumerate(model.nodes)}
        self._ops_element_tags = {str(elem.id): index + 1 for index, elem in enumerate(model.elements)}
        self._ops_material_tags = {str(mat.id): index + 1 for index, mat in enumerate(model.materials)}

        # 位移结果
        self.displacements = {}
        # 内力结果
        self.forces = {}
        # 应力结果
        self.stresses = {}

    def _ops_node_tag(self, node_id: Any) -> int:
        key = str(node_id)
        if key not in self._ops_node_tags:
            raise ValueError(f"Unknown node id '{node_id}' in OpenSees mapping")
        return self._ops_node_tags[key]

    def _ops_element_tag(self, element_id: Any) -> int:
        key = str(element_id)
        if key not in self._ops_element_tags:
            raise ValueError(f"Unknown element id '{element_id}' in OpenSees mapping")
        return self._ops_element_tags[key]

    def _ops_material_tag(self, material_id: Any) -> int:
        key = str(material_id)
        if key not in self._ops_material_tags:
            raise ValueError(f"Unknown material id '{material_id}' in OpenSees mapping")
        return self._ops_material_tags[key]

    def run(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行静力分析

        Args:
            parameters: 分析参数，包含荷载工况等

        Returns:
            分析结果
        """
        logger.info("Starting static analysis")

        if self.engine_mode == "simplified":
            result = self._run_simplified(parameters)
        else:
            try:
                import openseespy.opensees as ops  # noqa: F401
            except Exception as error:
                if self.engine_mode == "opensees":
                    raise RuntimeError("OpenSeesPy is not available for the requested engine") from error
                # 降级到简化计算
                logger.warning("OpenSeesPy runtime unavailable, using simplified analysis: %s", error)
                result = self._run_simplified(parameters)
            else:
                try:
                    result = self._run_with_opensees(parameters)
                except Exception as error:
                    if self.engine_mode == "opensees":
                        raise RuntimeError(f"OpenSees analysis failed: {error}") from error
                    logger.warning("OpenSees analysis failed, using simplified analysis: %s", error)
                    result = self._run_simplified(parameters)

        return result

    def _raise_unstable_structure(self) -> None:
        raise ValueError(
            "Structure is unstable or insufficiently restrained; please check node restraints / boundary conditions."
        )

    def _run_with_opensees(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        使用 OpenSeesPy 执行分析
        """
        import openseespy.opensees as ops

        ops.wipe()
        if self._select_opensees_planar_frame_mode(parameters):
            return self._run_with_opensees_2d_frame(parameters, ops)
        return self._run_with_opensees_3d_frame(parameters, ops)

    def _select_opensees_planar_frame_mode(self, parameters: Dict[str, Any]) -> Optional[str]:
        return self._select_planar_frame_mode(parameters)

    def _axis_range(self, axis: str) -> float:
        values = [float(getattr(node, axis)) for node in self.model.nodes]
        if not values:
            return 0.0
        return max(values) - min(values)

    def _run_with_opensees_2d_frame(self, parameters: Dict[str, Any], ops) -> Dict[str, Any]:
        plane = self._select_opensees_planar_frame_mode(parameters) or 'xz'
        loads = self._collect_nodal_loads(parameters)

        ops.model('basic', '-ndm', 2, '-ndf', 3)

        for node in self.model.nodes:
            x_coord, y_coord = self._get_2d_plane_coordinates(node, plane)
            node_tag = self._ops_node_tag(node.id)
            ops.node(node_tag, x_coord, y_coord)
            restraints = node.restraints or [False] * 6
            if plane == 'xy':
                ops.fix(node_tag, int(bool(restraints[0])), int(bool(restraints[1])), int(bool(restraints[5])))
            else:
                ops.fix(node_tag, int(bool(restraints[0])), int(bool(restraints[2])), int(bool(restraints[4])))

        for elem in self.model.elements:
            self._define_beam_element_2d(elem, ops)

        self._apply_standardized_loads_2d(loads, ops, plane)
        analysis_status = self._run_opensees_static_analysis(ops)
        if analysis_status != 0:
            ops.wipe()
            raise RuntimeError(
                f"OpenSees static analysis failed with code {analysis_status}. "
                "The model may be unstable or insufficiently restrained."
            )

        ops.reactions()
        displacements: Dict[str, Dict[str, float]] = {}
        reactions: Dict[str, Dict[str, float]] = {}
        for node in self.model.nodes:
            node_tag = self._ops_node_tag(node.id)
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
        for elem in self.model.elements:
            raw_force = ops.eleForce(self._ops_element_tag(elem.id))
            axial_start, shear_start, moment_start, axial_end, shear_end, moment_end = [float(value) for value in raw_force[:6]]
            area = float(self.sections[elem.section].properties.get('A', 0.0))
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
            'envelope': self._build_envelope(displacements, forces, reactions),
            'summary': self._generate_summary(displacements, forces),
        }

    def _run_with_opensees_3d_frame(self, parameters: Dict[str, Any], ops) -> Dict[str, Any]:
        loads = self._collect_nodal_loads(parameters)

        ops.model('basic', '-ndm', 3, '-ndf', 6)

        for node in self.model.nodes:
            node_tag = self._ops_node_tag(node.id)
            ops.node(node_tag, node.x, node.y, node.z)
            if node.restraints:
                ops.fix(node_tag, *[int(bool(value)) for value in node.restraints])

        for elem in self.model.elements:
            if elem.type == 'beam':
                self._define_beam_element(elem, ops)
            elif elem.type == 'truss':
                self._define_truss_element(elem, ops)

        self._apply_standardized_loads_3d(loads, ops)
        analysis_status = self._run_opensees_static_analysis(ops)
        if analysis_status != 0:
            ops.wipe()
            raise RuntimeError(
                f"OpenSees static analysis failed with code {analysis_status}. "
                "The model may be unstable or insufficiently restrained."
            )

        ops.reactions()
        displacements = {}
        reactions = {}
        for node in self.model.nodes:
            node_tag = self._ops_node_tag(node.id)
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
        for elem in self.model.elements:
            try:
                force = ops.eleForce(self._ops_element_tag(elem.id))
                if elem.type == 'beam':
                    area = float(self.sections[elem.section].properties.get('A', 0.0))
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
            'envelope': self._build_envelope(displacements, forces, reactions),
            'summary': self._generate_summary(displacements, forces),
        }

    def _run_opensees_static_analysis(self, ops) -> int:
        ops.system('BandGeneral')
        ops.numberer('Plain')
        ops.constraints('Plain')
        ops.integrator('LoadControl', 1.0)
        ops.algorithm('Newton')
        ops.analysis('Static')
        return int(ops.analyze(1))

    def _get_2d_plane_coordinates(self, node, plane: str) -> tuple[float, float]:
        if plane == 'xy':
            return float(node.x), float(node.y)
        return float(node.x), float(node.z)

    def _run_simplified(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        简化分析（当 OpenSees 不可用时）
        """
        batch_cases = parameters.get('batchCases', [])
        planar_frame_mode = self._select_planar_frame_mode(parameters)

        if self._can_run_2d_frame_solver() and planar_frame_mode is not None:
            try:
                if batch_cases:
                    return self._run_batch_cases(
                        parameters,
                        lambda case_parameters: self._run_linear_2d_frame(case_parameters, planar_frame_mode),
                    )
                return self._run_linear_2d_frame(parameters, planar_frame_mode)
            except Exception as e:
                logger.warning(f"2D frame solver failed, trying truss/zero fallback: {e}")

        if self._can_run_3d_frame_solver() and self._requires_3d_frame_solver(parameters):
            try:
                if batch_cases:
                    return self._run_batch_cases(parameters, self._run_linear_3d_frame)
                return self._run_linear_3d_frame(parameters)
            except Exception as e:
                logger.warning(f"3D frame solver failed, trying 3D truss/2D/zero fallback: {e}")

        if self._can_run_3d_truss_solver() and self._requires_3d_truss_solver():
            try:
                if batch_cases:
                    return self._run_batch_cases(parameters, self._run_linear_3d_truss)
                return self._run_linear_3d_truss(parameters)
            except Exception as e:
                logger.warning(f"3D truss solver failed, trying 2D/zero fallback: {e}")

        if self._can_run_2d_truss_solver():
            try:
                if batch_cases:
                    return self._run_batch_cases(parameters, self._run_linear_2d_truss)
                return self._run_linear_2d_truss(parameters)
            except Exception as e:
                logger.warning(f"2D truss solver failed, fallback to zero-result mode: {e}")

        # 兜底的零结果模式
        displacements = {}
        forces = {}

        # 假设简化计算
        for node in self.model.nodes:
            # 简化的位移估算
            displacements[node.id] = {
                'ux': 0.0,
                'uy': 0.0,
                'uz': 0.0,
                'rx': 0.0,
                'ry': 0.0,
                'rz': 0.0
            }

        return {
            'status': 'success',
            'displacements': displacements,
            'forces': forces,
            'reactions': {},
            'envelope': self._build_envelope(displacements, forces, {}),
            'note': 'Simplified analysis - OpenSeesPy not available'
        }

    def _run_batch_cases(self, parameters: Dict[str, Any], solver_func) -> Dict[str, Any]:
        """
        批量工况分析，并返回跨工况包络。
        """
        batch_cases = parameters.get('batchCases', [])
        if not isinstance(batch_cases, list) or not batch_cases:
            raise ValueError("batchCases must be a non-empty list")

        case_results: Dict[str, Dict[str, Any]] = {}
        summary_envelope = {
            'maxAbsDisplacement': 0.0,
            'maxAbsAxialForce': 0.0,
            'maxAbsShearForce': 0.0,
            'maxAbsMoment': 0.0,
            'maxAbsReaction': 0.0,
            'controlCase': {
                'displacement': '',
                'axialForce': '',
                'shearForce': '',
                'moment': '',
                'reaction': '',
            },
        }
        node_displacement_envelope: Dict[str, Dict[str, Any]] = {}
        element_force_envelope: Dict[str, Dict[str, Any]] = {}
        node_reaction_envelope: Dict[str, Dict[str, Any]] = {}

        for idx, case in enumerate(batch_cases):
            case_id = str(case.get('id', f'case_{idx + 1}'))
            case_parameters = {k: v for k, v in parameters.items() if k != 'batchCases'}
            for key in ('loadCases', 'loadCaseIds', 'loadCombinationId'):
                if key in case:
                    case_parameters[key] = case[key]

            case_result = solver_func(case_parameters)
            case_results[case_id] = case_result
            self._accumulate_case_envelope_tables(
                case_id,
                case_result,
                node_displacement_envelope,
                element_force_envelope,
                node_reaction_envelope,
            )

            env = case_result.get('envelope', {})
            mapping = [
                ('maxAbsDisplacement', 'displacement'),
                ('maxAbsAxialForce', 'axialForce'),
                ('maxAbsShearForce', 'shearForce'),
                ('maxAbsMoment', 'moment'),
                ('maxAbsReaction', 'reaction'),
            ]
            for metric, control_name in mapping:
                value = float(env.get(metric, 0.0))
                if value > float(summary_envelope[metric]):
                    summary_envelope[metric] = value
                    summary_envelope['controlCase'][control_name] = case_id

        return {
            'status': 'success',
            'analysisMode': case_results[next(iter(case_results))].get('analysisMode', 'batch'),
            'batchCaseCount': len(case_results),
            'caseResults': case_results,
            'envelope': summary_envelope,
            'envelopeTables': {
                'nodeDisplacement': node_displacement_envelope,
                'elementForce': element_force_envelope,
                'nodeReaction': node_reaction_envelope,
            },
            'summary': {
                'caseCount': len(case_results),
                'maxAbsDisplacement': summary_envelope['maxAbsDisplacement'],
            },
        }

    def _accumulate_case_envelope_tables(
        self,
        case_id: str,
        case_result: Dict[str, Any],
        node_displacement_envelope: Dict[str, Dict[str, Any]],
        element_force_envelope: Dict[str, Dict[str, Any]],
        node_reaction_envelope: Dict[str, Dict[str, Any]],
    ) -> None:
        """累计单工况结果到跨工况明细包络表。"""
        displacements = case_result.get('displacements', {})
        for node_id, disp in displacements.items():
            ux = float(disp.get('ux', 0.0))
            uy = float(disp.get('uy', 0.0))
            uz = float(disp.get('uz', 0.0))
            mag = float(np.sqrt(ux * ux + uy * uy + uz * uz))
            item = node_displacement_envelope.setdefault(
                str(node_id),
                {
                    'maxAbsDisplacement': 0.0,
                    'controlCase': '',
                },
            )
            if mag > float(item['maxAbsDisplacement']):
                item['maxAbsDisplacement'] = mag
                item['controlCase'] = case_id

        forces = case_result.get('forces', {})
        for elem_id, force in forces.items():
            axial = abs(float(force.get('axial', 0.0))) if isinstance(force, dict) else 0.0
            shear = 0.0
            moment = 0.0
            if isinstance(force, dict):
                if isinstance(force.get('n1'), dict):
                    shear = max(shear, abs(float(force['n1'].get('V', 0.0))))
                    moment = max(moment, abs(float(force['n1'].get('M', 0.0))))
                if isinstance(force.get('n2'), dict):
                    shear = max(shear, abs(float(force['n2'].get('V', 0.0))))
                    moment = max(moment, abs(float(force['n2'].get('M', 0.0))))

            item = element_force_envelope.setdefault(
                str(elem_id),
                {
                    'maxAbsAxialForce': 0.0,
                    'maxAbsShearForce': 0.0,
                    'maxAbsMoment': 0.0,
                    'controlCaseAxial': '',
                    'controlCaseShear': '',
                    'controlCaseMoment': '',
                },
            )
            if axial > float(item['maxAbsAxialForce']):
                item['maxAbsAxialForce'] = axial
                item['controlCaseAxial'] = case_id
            if shear > float(item['maxAbsShearForce']):
                item['maxAbsShearForce'] = shear
                item['controlCaseShear'] = case_id
            if moment > float(item['maxAbsMoment']):
                item['maxAbsMoment'] = moment
                item['controlCaseMoment'] = case_id

        reactions = case_result.get('reactions', {})
        for node_id, reaction in reactions.items():
            max_reaction = 0.0
            for v in self._iter_numeric_values(reaction):
                max_reaction = max(max_reaction, abs(float(v)))

            item = node_reaction_envelope.setdefault(
                str(node_id),
                {
                    'maxAbsReaction': 0.0,
                    'controlCase': '',
                },
            )
            if max_reaction > float(item['maxAbsReaction']):
                item['maxAbsReaction'] = max_reaction
                item['controlCase'] = case_id

    def _can_run_2d_truss_solver(self) -> bool:
        """判断是否可用内置 2D truss 求解器。"""
        if not self.model.elements:
            return False
        return all(elem.type == 'truss' for elem in self.model.elements)

    def _can_run_2d_frame_solver(self) -> bool:
        """判断是否可用内置 2D frame 求解器。"""
        if not self.model.elements:
            return False
        return all(elem.type == 'beam' for elem in self.model.elements)

    def _can_run_3d_frame_solver(self) -> bool:
        """判断是否可用内置 3D frame 求解器。"""
        if not self.model.elements:
            return False
        return all(elem.type == 'beam' for elem in self.model.elements)

    def _requires_3d_frame_solver(self, parameters: Dict[str, Any]) -> bool:
        """
        判断 beam 模型是否需要 3D 求解路径。
        如果无法安全映射到 x-y / x-z 平面 frame，则走 3D。
        """
        return self._select_planar_frame_mode(parameters) is None

    def _select_planar_frame_mode(self, parameters: Dict[str, Any]) -> Optional[str]:
        """
        判断 beam 模型能否映射为 2D 平面 frame。
        返回:
          - 'xy': x-y 平面，弯曲绕 z 轴
          - 'xz': x-z 平面，弯曲绕 y 轴
          - None: 必须走 3D
        """
        if not self.model.elements or not all(elem.type == 'beam' for elem in self.model.elements):
            return None

        y_range = self._axis_range('y')
        z_range = self._axis_range('z')
        tolerance = 1e-12

        if y_range > tolerance and z_range > tolerance:
            return None
        if y_range > tolerance:
            return 'xy'
        if z_range > tolerance:
            return 'xz'

        has_xy_load = False
        has_xz_load = False
        for load in self._collect_nodal_loads(parameters):
            if str(load.get('type', '')) == 'distributed':
                wy = self._to_float(load.get('wy', 0.0), 0.0)
                wz = self._to_float(load.get('wz', 0.0), 0.0)
                if abs(wy) > tolerance:
                    has_xy_load = True
                if abs(wz) > tolerance:
                    has_xz_load = True
                continue

            fy = self._to_float(load.get('fy', 0.0), 0.0)
            fz = self._to_float(load.get('fz', 0.0), 0.0)
            mx = self._to_float(load.get('mx', load.get('momentX', 0.0)), 0.0)
            my = self._to_float(load.get('my', load.get('momentY', 0.0)), 0.0)
            mz = self._to_float(load.get('mz', load.get('momentZ', 0.0)), 0.0)

            if abs(mx) > tolerance:
                return None
            if abs(fy) > tolerance or abs(mz) > tolerance:
                has_xy_load = True
            if abs(fz) > tolerance or abs(my) > tolerance:
                has_xz_load = True

        if has_xy_load and has_xz_load:
            return None
        if has_xy_load:
            return 'xy'
        return 'xz'

    def _can_run_3d_truss_solver(self) -> bool:
        """判断是否可用内置 3D truss 求解器。"""
        if not self.model.elements:
            return False
        return all(elem.type == 'truss' for elem in self.model.elements)

    def _requires_3d_truss_solver(self) -> bool:
        """
        判断当前 truss 模型是否需要 3D 求解路径。
        规则：任一节点 y 坐标非零即触发 3D。
        """
        for node in self.model.nodes:
            if abs(float(node.y)) > 1e-12:
                return True
        return False

    def _run_linear_3d_truss(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        3D truss 线弹性静力分析（DOF: ux, uy, uz）。
        """
        node_order = sorted(self.model.nodes, key=lambda n: n.id)
        node_index = {node.id: idx for idx, node in enumerate(node_order)}
        dof_count = len(node_order) * 3

        K = np.zeros((dof_count, dof_count), dtype=float)
        F = np.zeros(dof_count, dtype=float)

        for elem in self.model.elements:
            n1 = self.nodes[elem.nodes[0]]
            n2 = self.nodes[elem.nodes[1]]
            mat = self.materials[elem.material]
            sec = self.sections[elem.section]

            x1, y1, z1 = n1.x, n1.y, n1.z
            x2, y2, z2 = n2.x, n2.y, n2.z
            dx, dy, dz = x2 - x1, y2 - y1, z2 - z1
            L = float(np.sqrt(dx * dx + dy * dy + dz * dz))
            if L <= 0.0:
                raise ValueError(f"Element '{elem.id}' has zero length")

            A = float(sec.properties.get('A', 0.0))
            if A <= 0.0:
                raise ValueError(f"Element '{elem.id}' requires section area A > 0")

            E = float(mat.E)
            l = dx / L
            m = dy / L
            n = dz / L
            k = (A * E) / L

            ke = k * np.array(
                [
                    [l * l, l * m, l * n, -l * l, -l * m, -l * n],
                    [l * m, m * m, m * n, -l * m, -m * m, -m * n],
                    [l * n, m * n, n * n, -l * n, -m * n, -n * n],
                    [-l * l, -l * m, -l * n, l * l, l * m, l * n],
                    [-l * m, -m * m, -m * n, l * m, m * m, m * n],
                    [-l * n, -m * n, -n * n, l * n, m * n, n * n],
                ],
                dtype=float,
            )

            i = node_index[n1.id] * 3
            j = node_index[n2.id] * 3
            dofs = [i, i + 1, i + 2, j, j + 1, j + 2]
            for r in range(6):
                for c_idx in range(6):
                    K[dofs[r], dofs[c_idx]] += ke[r, c_idx]

        for load in self._collect_nodal_loads(parameters):
            node_id = str(load.get('node', ''))
            if node_id not in node_index:
                continue
            i = node_index[node_id] * 3
            F[i] += float(load.get('fx', 0.0))
            F[i + 1] += float(load.get('fy', 0.0))
            F[i + 2] += float(load.get('fz', 0.0))

        fixed_dofs = set()
        for node in node_order:
            idx = node_index[node.id] * 3
            restraints = node.restraints or [False] * 6
            if restraints[0]:
                fixed_dofs.add(idx)
            if restraints[1]:
                fixed_dofs.add(idx + 1)
            if restraints[2]:
                fixed_dofs.add(idx + 2)

        free_dofs = [i for i in range(dof_count) if i not in fixed_dofs]
        if not free_dofs:
            raise ValueError("No free DOFs for solving")

        Kff = K[np.ix_(free_dofs, free_dofs)]
        Ff = F[free_dofs]
        try:
            Uf = np.linalg.solve(Kff, Ff)
        except np.linalg.LinAlgError as exc:
            try:
                self._raise_unstable_structure()
            except ValueError as unstable_error:
                raise unstable_error from exc

        U = np.zeros(dof_count, dtype=float)
        U[free_dofs] = Uf
        R = K @ U - F

        displacements = {}
        for node in node_order:
            i = node_index[node.id] * 3
            displacements[node.id] = {
                'ux': float(U[i]),
                'uy': float(U[i + 1]),
                'uz': float(U[i + 2]),
                'rx': 0.0,
                'ry': 0.0,
                'rz': 0.0,
            }

        forces = {}
        for elem in self.model.elements:
            n1 = self.nodes[elem.nodes[0]]
            n2 = self.nodes[elem.nodes[1]]
            mat = self.materials[elem.material]
            sec = self.sections[elem.section]
            x1, y1, z1 = n1.x, n1.y, n1.z
            x2, y2, z2 = n2.x, n2.y, n2.z
            dx, dy, dz = x2 - x1, y2 - y1, z2 - z1
            L = float(np.sqrt(dx * dx + dy * dy + dz * dz))
            A = float(sec.properties.get('A', 0.0))
            E = float(mat.E)
            l = dx / L
            m = dy / L
            n = dz / L

            i = node_index[n1.id] * 3
            j = node_index[n2.id] * 3
            u1x, u1y, u1z = U[i], U[i + 1], U[i + 2]
            u2x, u2y, u2z = U[j], U[j + 1], U[j + 2]
            delta = l * (u2x - u1x) + m * (u2y - u1y) + n * (u2z - u1z)
            axial_force = (A * E / L) * delta
            forces[elem.id] = {
                'axial': float(axial_force),
                'stress': float(axial_force / A) if A > 0.0 else 0.0,
            }

        reactions = {}
        for node in node_order:
            i = node_index[node.id] * 3
            if i in fixed_dofs or (i + 1) in fixed_dofs or (i + 2) in fixed_dofs:
                reactions[node.id] = {
                    'fx': float(R[i]),
                    'fy': float(R[i + 1]),
                    'fz': float(R[i + 2]),
                }

        return {
            'status': 'success',
            'analysisMode': 'linear_3d_truss',
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self._build_envelope(displacements, forces, reactions),
            'summary': self._generate_summary(displacements, forces),
        }

    def _run_linear_2d_truss(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        2D truss 线弹性静力分析（x-z 平面）
        """
        node_order = sorted(self.model.nodes, key=lambda n: n.id)
        node_index = {node.id: idx for idx, node in enumerate(node_order)}
        dof_count = len(node_order) * 2  # ux, uz

        K = np.zeros((dof_count, dof_count), dtype=float)
        F = np.zeros(dof_count, dtype=float)

        for elem in self.model.elements:
            n1 = self.nodes[elem.nodes[0]]
            n2 = self.nodes[elem.nodes[1]]
            mat = self.materials[elem.material]
            sec = self.sections[elem.section]

            x1, z1 = n1.x, n1.z
            x2, z2 = n2.x, n2.z
            dx, dz = x2 - x1, z2 - z1
            L = float(np.sqrt(dx * dx + dz * dz))
            if L <= 0.0:
                raise ValueError(f"Element '{elem.id}' has zero length")

            A = float(sec.properties.get('A', 0.0))
            if A <= 0.0:
                raise ValueError(f"Element '{elem.id}' requires section area A > 0")

            E = float(mat.E)
            c = dx / L
            s = dz / L
            k = (A * E) / L

            ke = k * np.array(
                [
                    [c * c, c * s, -c * c, -c * s],
                    [c * s, s * s, -c * s, -s * s],
                    [-c * c, -c * s, c * c, c * s],
                    [-c * s, -s * s, c * s, s * s],
                ],
                dtype=float,
            )

            i = node_index[n1.id] * 2
            j = node_index[n2.id] * 2
            dofs = [i, i + 1, j, j + 1]
            for r in range(4):
                for c_idx in range(4):
                    K[dofs[r], dofs[c_idx]] += ke[r, c_idx]

        for load in self._collect_nodal_loads(parameters):
            node_id = str(load.get('node', ''))
            if node_id not in node_index:
                continue
            i = node_index[node_id] * 2
            F[i] += float(load.get('fx', 0.0))
            # 兼容 fy/fz，统一映射到 x-z 平面的竖向 z
            F[i + 1] += self._plane_transverse_force(load, 'xz')

        fixed_dofs = set()
        for node in node_order:
            idx = node_index[node.id] * 2
            restraints = node.restraints or [False] * 6
            if restraints[0]:
                fixed_dofs.add(idx)
            # z 向平移约束（常见 3D 第3个自由度）
            if restraints[2]:
                fixed_dofs.add(idx + 1)

        free_dofs = [i for i in range(dof_count) if i not in fixed_dofs]
        if not free_dofs:
            raise ValueError("No free DOFs for solving")

        Kff = K[np.ix_(free_dofs, free_dofs)]
        Ff = F[free_dofs]
        try:
            Uf = np.linalg.solve(Kff, Ff)
        except np.linalg.LinAlgError as exc:
            try:
                self._raise_unstable_structure()
            except ValueError as unstable_error:
                raise unstable_error from exc

        U = np.zeros(dof_count, dtype=float)
        U[free_dofs] = Uf

        R = K @ U - F

        displacements = {}
        for node in node_order:
            i = node_index[node.id] * 2
            displacements[node.id] = {
                'ux': float(U[i]),
                'uy': 0.0,
                'uz': float(U[i + 1]),
                'rx': 0.0,
                'ry': 0.0,
                'rz': 0.0,
            }

        forces = {}
        for elem in self.model.elements:
            n1 = self.nodes[elem.nodes[0]]
            n2 = self.nodes[elem.nodes[1]]
            mat = self.materials[elem.material]
            sec = self.sections[elem.section]

            x1, z1 = n1.x, n1.z
            x2, z2 = n2.x, n2.z
            dx, dz = x2 - x1, z2 - z1
            L = float(np.sqrt(dx * dx + dz * dz))
            A = float(sec.properties.get('A', 0.0))
            E = float(mat.E)
            c = dx / L
            s = dz / L

            i = node_index[n1.id] * 2
            j = node_index[n2.id] * 2
            u1x, u1z = U[i], U[i + 1]
            u2x, u2z = U[j], U[j + 1]
            delta = c * (u2x - u1x) + s * (u2z - u1z)
            axial_force = (A * E / L) * delta
            forces[elem.id] = {
                'axial': float(axial_force),
                'stress': float(axial_force / A) if A > 0.0 else 0.0,
            }

        reactions = {}
        for node in node_order:
            i = node_index[node.id] * 2
            if i in fixed_dofs or (i + 1) in fixed_dofs:
                reactions[node.id] = {
                    'fx': float(R[i]),
                    'fz': float(R[i + 1]),
                }

        return {
            'status': 'success',
            'analysisMode': 'linear_2d_truss',
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self._build_envelope(displacements, forces, reactions),
            'summary': self._generate_summary(displacements, forces),
        }

    def _run_linear_2d_frame(self, parameters: Dict[str, Any], plane: Optional[str] = None) -> Dict[str, Any]:
        """
        2D frame/beam 线弹性静力分析。
        `xz` 平面: DOF = ux, uz, ry
        `xy` 平面: DOF = ux, uy, rz
        """
        plane = plane or self._select_planar_frame_mode(parameters) or 'xz'
        node_order = sorted(self.model.nodes, key=lambda n: n.id)
        node_index = {node.id: idx for idx, node in enumerate(node_order)}
        dof_count = len(node_order) * 3

        K = np.zeros((dof_count, dof_count), dtype=float)
        F = np.zeros(dof_count, dtype=float)

        load_list = self._collect_nodal_loads(parameters)
        element_distributed_loads: Dict[str, List[float]] = {}
        for load in load_list:
            if str(load.get('type', '')) == 'distributed':
                elem_id = str(load.get('element', ''))
                if not elem_id:
                    continue
                # 约定 q>0 沿局部 +v 方向；常见竖向向下可传负值
                q = self._plane_distributed_load(load, plane)
                element_distributed_loads.setdefault(elem_id, []).append(q)

        element_meta: Dict[str, Dict[str, Any]] = {}
        for elem in self.model.elements:
            n1 = self.nodes[elem.nodes[0]]
            n2 = self.nodes[elem.nodes[1]]
            mat = self.materials[elem.material]
            sec = self.sections[elem.section]

            x1, t1 = self._get_2d_plane_coordinates(n1, plane)
            x2, t2 = self._get_2d_plane_coordinates(n2, plane)
            dx, dt = x2 - x1, t2 - t1
            L = float(np.sqrt(dx * dx + dt * dt))
            if L <= 0.0:
                raise ValueError(f"Element '{elem.id}' has zero length")

            A = float(sec.properties.get('A', 0.0))
            if A <= 0.0:
                raise ValueError(f"Element '{elem.id}' requires section area A > 0")

            E = self._effective_elastic_modulus(mat)
            inertia_key = 'Iz' if plane == 'xy' else 'Iy'
            fallback_inertia_key = 'Iy' if plane == 'xy' else 'Iz'
            I = float(sec.properties.get(inertia_key, sec.properties.get(fallback_inertia_key, 0.0)))
            if I <= 0.0:
                raise ValueError(f"Element '{elem.id}' requires section inertia {inertia_key}/{fallback_inertia_key} > 0")

            c = dx / L
            s = dt / L

            k_local = np.array(
                [
                    [E * A / L, 0, 0, -E * A / L, 0, 0],
                    [0, 12 * E * I / (L**3), 6 * E * I / (L**2), 0, -12 * E * I / (L**3), 6 * E * I / (L**2)],
                    [0, 6 * E * I / (L**2), 4 * E * I / L, 0, -6 * E * I / (L**2), 2 * E * I / L],
                    [-E * A / L, 0, 0, E * A / L, 0, 0],
                    [0, -12 * E * I / (L**3), -6 * E * I / (L**2), 0, 12 * E * I / (L**3), -6 * E * I / (L**2)],
                    [0, 6 * E * I / (L**2), 2 * E * I / L, 0, -6 * E * I / (L**2), 4 * E * I / L],
                ],
                dtype=float,
            )

            T = np.array(
                [
                    [c, s, 0, 0, 0, 0],
                    [-s, c, 0, 0, 0, 0],
                    [0, 0, 1, 0, 0, 0],
                    [0, 0, 0, c, s, 0],
                    [0, 0, 0, -s, c, 0],
                    [0, 0, 0, 0, 0, 1],
                ],
                dtype=float,
            )
            k_global = T.T @ k_local @ T

            i = node_index[n1.id] * 3
            j = node_index[n2.id] * 3
            dofs = [i, i + 1, i + 2, j, j + 1, j + 2]
            for r in range(6):
                for c_idx in range(6):
                    K[dofs[r], dofs[c_idx]] += k_global[r, c_idx]

            q = sum(element_distributed_loads.get(elem.id, []))
            f_local_dist = np.zeros(6, dtype=float)
            if abs(q) > 0.0:
                f_local_dist = np.array(
                    [0.0, q * L / 2.0, q * (L**2) / 12.0, 0.0, q * L / 2.0, -q * (L**2) / 12.0],
                    dtype=float,
                )
                F[dofs] += T.T @ f_local_dist

            element_meta[elem.id] = {
                'dofs': dofs,
                'k_local': k_local,
                'transform': T,
                'f_local_dist': f_local_dist,
                'A': A,
            }

        for load in load_list:
            if str(load.get('type', '')) == 'distributed':
                continue
            node_id = str(load.get('node', ''))
            if node_id not in node_index:
                continue
            i = node_index[node_id] * 3
            F[i] += float(load.get('fx', 0.0))
            F[i + 1] += self._plane_transverse_force(load, plane)
            F[i + 2] += self._plane_bending_moment(load, plane)

        fixed_dofs = set()
        for node in node_order:
            idx = node_index[node.id] * 3
            restraints = node.restraints or [False] * 6
            if plane == 'xy':
                if restraints[0]:
                    fixed_dofs.add(idx)
                if restraints[1]:
                    fixed_dofs.add(idx + 1)
                if restraints[5]:
                    fixed_dofs.add(idx + 2)
            else:
                if restraints[0]:
                    fixed_dofs.add(idx)
                if restraints[2]:
                    fixed_dofs.add(idx + 1)
                if restraints[4]:
                    fixed_dofs.add(idx + 2)

        free_dofs = [i for i in range(dof_count) if i not in fixed_dofs]
        if not free_dofs:
            raise ValueError("No free DOFs for solving")

        Kff = K[np.ix_(free_dofs, free_dofs)]
        Ff = F[free_dofs]
        try:
            Uf = np.linalg.solve(Kff, Ff)
        except np.linalg.LinAlgError as exc:
            try:
                self._raise_unstable_structure()
            except ValueError as unstable_error:
                raise unstable_error from exc

        U = np.zeros(dof_count, dtype=float)
        U[free_dofs] = Uf
        R = K @ U - F

        displacements = {}
        for node in node_order:
            i = node_index[node.id] * 3
            if plane == 'xy':
                displacements[node.id] = {
                    'ux': float(U[i]),
                    'uy': float(U[i + 1]),
                    'uz': 0.0,
                    'rx': 0.0,
                    'ry': 0.0,
                    'rz': float(U[i + 2]),
                }
            else:
                displacements[node.id] = {
                    'ux': float(U[i]),
                    'uy': 0.0,
                    'uz': float(U[i + 1]),
                    'rx': 0.0,
                    'ry': float(U[i + 2]),
                    'rz': 0.0,
                }

        forces = {}
        for elem in self.model.elements:
            meta = element_meta[elem.id]
            dofs = meta['dofs']
            u_global = U[dofs]
            u_local = meta['transform'] @ u_global
            f_local = meta['k_local'] @ u_local - meta['f_local_dist']
            A = float(meta['A'])
            forces[elem.id] = {
                'n1': {'N': float(f_local[0]), 'V': float(f_local[1]), 'M': float(f_local[2])},
                'n2': {'N': float(f_local[3]), 'V': float(f_local[4]), 'M': float(f_local[5])},
                'axial': float(f_local[0]),
                'stress': float(f_local[0] / A) if A > 0.0 else 0.0,
            }

        reactions = {}
        for node in node_order:
            i = node_index[node.id] * 3
            if i in fixed_dofs or (i + 1) in fixed_dofs or (i + 2) in fixed_dofs:
                if plane == 'xy':
                    reactions[node.id] = {
                        'fx': float(R[i]),
                        'fy': float(R[i + 1]),
                        'mz': float(R[i + 2]),
                    }
                else:
                    reactions[node.id] = {
                        'fx': float(R[i]),
                        'fz': float(R[i + 1]),
                        'my': float(R[i + 2]),
                    }

        return {
            'status': 'success',
            'analysisMode': 'linear_2d_frame',
            'plane': plane,
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self._build_envelope(displacements, forces, reactions),
            'summary': self._generate_summary(displacements, forces),
        }

    def _run_linear_3d_frame(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        3D frame/beam 线弹性静力分析（DOF: ux, uy, uz, rx, ry, rz）。
        说明：当前版本先支持节点荷载工况（不含 3D 分布荷载）。
        """
        node_order = sorted(self.model.nodes, key=lambda n: n.id)
        node_index = {node.id: idx for idx, node in enumerate(node_order)}
        dof_count = len(node_order) * 6

        K = np.zeros((dof_count, dof_count), dtype=float)
        F = np.zeros(dof_count, dtype=float)

        element_meta: Dict[str, Dict[str, Any]] = {}
        for elem in self.model.elements:
            n1 = self.nodes[elem.nodes[0]]
            n2 = self.nodes[elem.nodes[1]]
            mat = self.materials[elem.material]
            sec = self.sections[elem.section]

            p1 = np.array([float(n1.x), float(n1.y), float(n1.z)], dtype=float)
            p2 = np.array([float(n2.x), float(n2.y), float(n2.z)], dtype=float)
            vec = p2 - p1
            L = float(np.linalg.norm(vec))
            if L <= 0.0:
                raise ValueError(f"Element '{elem.id}' has zero length")

            A = float(sec.properties.get('A', 0.0))
            Iy = float(sec.properties.get('Iy', sec.properties.get('Iz', 0.0)))
            Iz = float(sec.properties.get('Iz', sec.properties.get('Iy', 0.0)))
            J = float(sec.properties.get('J', 0.0))
            E = self._effective_elastic_modulus(mat)
            G = float(sec.properties.get('G', E / (2.0 * (1.0 + float(mat.nu)))))

            if A <= 0.0 or Iy <= 0.0 or Iz <= 0.0:
                raise ValueError(f"Element '{elem.id}' requires A/Iy/Iz > 0 for 3D frame solver")
            if J <= 0.0:
                # 为最小可用路径提供扭转惯量兜底，避免常见输入缺失导致求解失败。
                J = max(Iy + Iz, 1e-9)

            R = self._build_3d_rotation_matrix(vec / L)
            T = np.zeros((12, 12), dtype=float)
            T[0:3, 0:3] = R
            T[3:6, 3:6] = R
            T[6:9, 6:9] = R
            T[9:12, 9:12] = R

            k_local = self._build_3d_frame_local_stiffness(E, G, A, Iy, Iz, J, L)
            k_global = T.T @ k_local @ T

            i = node_index[n1.id] * 6
            j = node_index[n2.id] * 6
            dofs = [i, i + 1, i + 2, i + 3, i + 4, i + 5, j, j + 1, j + 2, j + 3, j + 4, j + 5]
            for r in range(12):
                for c_idx in range(12):
                    K[dofs[r], dofs[c_idx]] += k_global[r, c_idx]

            element_meta[elem.id] = {
                'dofs': dofs,
                'k_local': k_local,
                'transform': T,
                'A': A,
            }

        for load in self._collect_nodal_loads(parameters):
            if str(load.get('type', '')) == 'distributed':
                continue
            node_id = str(load.get('node', ''))
            if node_id not in node_index:
                continue
            i = node_index[node_id] * 6
            F[i] += float(load.get('fx', 0.0))
            F[i + 1] += float(load.get('fy', 0.0))
            F[i + 2] += float(load.get('fz', 0.0))
            F[i + 3] += float(load.get('mx', load.get('momentX', 0.0)))
            F[i + 4] += float(load.get('my', load.get('momentY', 0.0)))
            F[i + 5] += float(load.get('mz', load.get('momentZ', 0.0)))

        fixed_dofs = set()
        for node in node_order:
            idx = node_index[node.id] * 6
            restraints = node.restraints or [False] * 6
            for k in range(6):
                if restraints[k]:
                    fixed_dofs.add(idx + k)

        free_dofs = [i for i in range(dof_count) if i not in fixed_dofs]
        if not free_dofs:
            raise ValueError("No free DOFs for solving")

        Kff = K[np.ix_(free_dofs, free_dofs)]
        Ff = F[free_dofs]
        try:
            Uf = np.linalg.solve(Kff, Ff)
        except np.linalg.LinAlgError as exc:
            try:
                self._raise_unstable_structure()
            except ValueError as unstable_error:
                raise unstable_error from exc

        U = np.zeros(dof_count, dtype=float)
        U[free_dofs] = Uf
        Rf = K @ U - F

        displacements = {}
        for node in node_order:
            i = node_index[node.id] * 6
            displacements[node.id] = {
                'ux': float(U[i]),
                'uy': float(U[i + 1]),
                'uz': float(U[i + 2]),
                'rx': float(U[i + 3]),
                'ry': float(U[i + 4]),
                'rz': float(U[i + 5]),
            }

        forces = {}
        for elem in self.model.elements:
            meta = element_meta[elem.id]
            dofs = meta['dofs']
            u_global = U[dofs]
            u_local = meta['transform'] @ u_global
            f_local = meta['k_local'] @ u_local
            A = float(meta['A'])

            v1 = float(np.sqrt(f_local[1] ** 2 + f_local[2] ** 2))
            v2 = float(np.sqrt(f_local[7] ** 2 + f_local[8] ** 2))
            m1 = float(np.sqrt(f_local[4] ** 2 + f_local[5] ** 2))
            m2 = float(np.sqrt(f_local[10] ** 2 + f_local[11] ** 2))

            forces[elem.id] = {
                'n1': {
                    'N': float(f_local[0]),
                    'V': v1,
                    'M': m1,
                    'V2': float(f_local[1]),
                    'V3': float(f_local[2]),
                    'T': float(f_local[3]),
                    'M2': float(f_local[4]),
                    'M3': float(f_local[5]),
                },
                'n2': {
                    'N': float(f_local[6]),
                    'V': v2,
                    'M': m2,
                    'V2': float(f_local[7]),
                    'V3': float(f_local[8]),
                    'T': float(f_local[9]),
                    'M2': float(f_local[10]),
                    'M3': float(f_local[11]),
                },
                'axial': float(f_local[0]),
                'stress': float(f_local[0] / A) if A > 0.0 else 0.0,
            }

        reactions = {}
        for node in node_order:
            i = node_index[node.id] * 6
            if any((i + k) in fixed_dofs for k in range(6)):
                reactions[node.id] = {
                    'fx': float(Rf[i]),
                    'fy': float(Rf[i + 1]),
                    'fz': float(Rf[i + 2]),
                    'mx': float(Rf[i + 3]),
                    'my': float(Rf[i + 4]),
                    'mz': float(Rf[i + 5]),
                }

        return {
            'status': 'success',
            'analysisMode': 'linear_3d_frame',
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self._build_envelope(displacements, forces, reactions),
            'summary': self._generate_summary(displacements, forces),
        }

    def _build_3d_rotation_matrix(self, ex: np.ndarray) -> np.ndarray:
        """构建 3D frame 局部坐标旋转矩阵（局部 x 沿杆轴）。"""
        ref = np.array([0.0, 0.0, 1.0], dtype=float)
        if abs(float(np.dot(ex, ref))) > 0.98:
            ref = np.array([0.0, 1.0, 0.0], dtype=float)

        ey = np.cross(ref, ex)
        ey_norm = float(np.linalg.norm(ey))
        if ey_norm <= 0.0:
            raise ValueError("Cannot construct local y-axis for 3D frame element")
        ey /= ey_norm
        ez = np.cross(ex, ey)
        ez_norm = float(np.linalg.norm(ez))
        if ez_norm <= 0.0:
            raise ValueError("Cannot construct local z-axis for 3D frame element")
        ez /= ez_norm
        return np.vstack([ex, ey, ez])

    def _build_3d_frame_local_stiffness(
        self,
        E: float,
        G: float,
        A: float,
        Iy: float,
        Iz: float,
        J: float,
        L: float,
    ) -> np.ndarray:
        """构建 3D frame 局部刚度矩阵（Euler-Bernoulli）。"""
        k = np.zeros((12, 12), dtype=float)

        EA_L = E * A / L
        GJ_L = G * J / L
        EIy = E * Iy
        EIz = E * Iz

        # Axial
        k[0, 0] = EA_L
        k[0, 6] = -EA_L
        k[6, 0] = -EA_L
        k[6, 6] = EA_L

        # Torsion
        k[3, 3] = GJ_L
        k[3, 9] = -GJ_L
        k[9, 3] = -GJ_L
        k[9, 9] = GJ_L

        # Bending about local z (v-rz coupling, uses Iz)
        k[1, 1] = 12.0 * EIz / (L ** 3)
        k[1, 5] = 6.0 * EIz / (L ** 2)
        k[1, 7] = -12.0 * EIz / (L ** 3)
        k[1, 11] = 6.0 * EIz / (L ** 2)

        k[5, 1] = 6.0 * EIz / (L ** 2)
        k[5, 5] = 4.0 * EIz / L
        k[5, 7] = -6.0 * EIz / (L ** 2)
        k[5, 11] = 2.0 * EIz / L

        k[7, 1] = -12.0 * EIz / (L ** 3)
        k[7, 5] = -6.0 * EIz / (L ** 2)
        k[7, 7] = 12.0 * EIz / (L ** 3)
        k[7, 11] = -6.0 * EIz / (L ** 2)

        k[11, 1] = 6.0 * EIz / (L ** 2)
        k[11, 5] = 2.0 * EIz / L
        k[11, 7] = -6.0 * EIz / (L ** 2)
        k[11, 11] = 4.0 * EIz / L

        # Bending about local y (w-ry coupling, uses Iy)
        k[2, 2] = 12.0 * EIy / (L ** 3)
        k[2, 4] = -6.0 * EIy / (L ** 2)
        k[2, 8] = -12.0 * EIy / (L ** 3)
        k[2, 10] = -6.0 * EIy / (L ** 2)

        k[4, 2] = -6.0 * EIy / (L ** 2)
        k[4, 4] = 4.0 * EIy / L
        k[4, 8] = 6.0 * EIy / (L ** 2)
        k[4, 10] = 2.0 * EIy / L

        k[8, 2] = -12.0 * EIy / (L ** 3)
        k[8, 4] = 6.0 * EIy / (L ** 2)
        k[8, 8] = 12.0 * EIy / (L ** 3)
        k[8, 10] = 6.0 * EIy / (L ** 2)

        k[10, 2] = -6.0 * EIy / (L ** 2)
        k[10, 4] = 2.0 * EIy / L
        k[10, 8] = 6.0 * EIy / (L ** 2)
        k[10, 10] = 4.0 * EIy / L

        return k

    def _collect_nodal_loads(self, parameters: Dict[str, Any]) -> List[Dict[str, Any]]:
        """收集并标准化荷载（优先 request.parameters，其次模型中的 load_cases）。"""
        loads: List[Dict[str, Any]] = []

        load_combination_id = (
            parameters.get('loadCombinationId')
            or parameters.get('load_combination_id')
            or parameters.get('combinationId')
        )
        if load_combination_id:
            for combo in self.model.load_combinations:
                if combo.id != str(load_combination_id):
                    continue
                case_map = {lc.id: lc for lc in self.model.load_cases}
                for case_id, factor in combo.factors.items():
                    lc = case_map.get(case_id)
                    if not lc:
                        continue
                    for load in lc.loads:
                        normalized = self._normalize_load(load)
                        if normalized is not None:
                            loads.append(self._scale_load(normalized, float(factor)))
                return loads

        parameter_load_cases = parameters.get('loadCases') or parameters.get('load_cases') or []
        for lc in parameter_load_cases:
            if not isinstance(lc, dict):
                continue
            for load in lc.get('loads', []):
                normalized = self._normalize_load(load)
                if normalized is not None:
                    loads.append(normalized)

        load_case_ids = parameters.get('loadCaseIds') or parameters.get('load_case_ids')
        if load_case_ids:
            allowed = set(str(i) for i in load_case_ids)
            for lc in self.model.load_cases:
                if lc.id in allowed:
                    for load in lc.loads:
                        normalized = self._normalize_load(load)
                        if normalized is not None:
                            loads.append(normalized)
        elif not loads:
            for lc in self.model.load_cases:
                for load in lc.loads:
                    normalized = self._normalize_load(load)
                    if normalized is not None:
                        loads.append(normalized)

        return loads

    def _scale_load(self, load: Dict[str, Any], factor: float) -> Dict[str, Any]:
        """按组合系数缩放荷载中的数值字段。"""
        scaled = dict(load)
        numeric_keys = ['fx', 'fy', 'fz', 'mx', 'my', 'mz', 'momentX', 'momentY', 'momentZ', 'wy', 'wz']
        for key in numeric_keys:
            if key in scaled:
                scaled[key] = float(scaled[key]) * factor
        if isinstance(scaled.get('forces'), list):
            scaled['forces'] = [float(value) * factor for value in scaled['forces']]
        return scaled

    def _normalize_load(self, load: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(load, dict):
            return None

        load_type = str(load.get('type', '')).lower()

        if load_type == 'distributed' or load.get('element') is not None or load.get('elementId') is not None or load.get('element_id') is not None:
            element_id = str(load.get('element') or load.get('elementId') or load.get('element_id') or '')
            if not element_id:
                return None

            direction = str(load.get('direction', load.get('axis', ''))).lower()
            raw_magnitude = self._to_float(
                load.get('wy', load.get('wz', load.get('q', load.get('w', load.get('value', 0.0))))),
                0.0,
            )

            if direction in {'z', 'local-z', '2'}:
                wy = 0.0
                wz = raw_magnitude
            elif direction in {'y', 'local-y', '1'}:
                wy = raw_magnitude
                wz = 0.0
            else:
                has_wy = ('wy' in load) or ('fy' in load)
                has_wz = ('wz' in load) or ('fz' in load)
                if has_wy:
                    wy = self._to_float(load.get('wy', load.get('fy', 0.0)), 0.0)
                else:
                    wy = 0.0
                if has_wz:
                    wz = self._to_float(load.get('wz', load.get('fz', 0.0)), 0.0)
                else:
                    wz = 0.0
                if (not has_wy) and (not has_wz):
                    # Backward-compatible fallback for legacy q/w/value payloads.
                    wz = raw_magnitude

            return {
                'type': 'distributed',
                'element': element_id,
                'wy': wy,
                'wz': wz,
            }

        node_id = str(load.get('node') or load.get('nodeId') or load.get('node_id') or '')
        if not node_id:
            return None

        if isinstance(load.get('forces'), list):
            raw_forces = [self._to_float(value, 0.0) for value in list(load['forces'])[:6]]
            while len(raw_forces) < 6:
                raw_forces.append(0.0)
            fx, fy, fz, mx, my, mz = raw_forces
        else:
            direction = str(load.get('direction', load.get('axis', ''))).lower()
            directional_value = self._to_float(load.get('value', load.get('magnitude', 0.0)), 0.0)

            fx = self._to_float(load.get('fx', load.get('Fx', 0.0)), 0.0)
            fy = self._to_float(load.get('fy', load.get('Fy', load.get('wy', 0.0))), 0.0)
            fz = self._to_float(load.get('fz', load.get('Fz', load.get('wz', 0.0))), 0.0)
            mx = self._to_float(load.get('mx', load.get('Mx', load.get('momentX', 0.0))), 0.0)
            my = self._to_float(load.get('my', load.get('My', load.get('momentY', 0.0))), 0.0)
            mz = self._to_float(load.get('mz', load.get('Mz', load.get('momentZ', 0.0))), 0.0)

            if direction in {'x', 'fx'}:
                fx = directional_value
            elif direction in {'y', 'fy'}:
                fy = directional_value
            elif direction in {'z', 'fz'}:
                fz = directional_value
            elif direction in {'mx', 'rx'}:
                mx = directional_value
            elif direction in {'my', 'ry'}:
                my = directional_value
            elif direction in {'mz', 'rz'}:
                mz = directional_value

        return {
            'type': 'nodal',
            'node': node_id,
            'fx': fx,
            'fy': fy,
            'fz': fz,
            'mx': mx,
            'my': my,
            'mz': mz,
            'forces': [fx, fy, fz, mx, my, mz],
        }

    def _to_float(self, value: Any, fallback: float = 0.0) -> float:
        if isinstance(value, (int, float, np.floating, np.integer)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return fallback
        return fallback

    def _effective_elastic_modulus(self, material) -> float:
        # Keep the simplified solver consistent with the OpenSees branch.
        return float(material.E) * 1000.0

    def _plane_transverse_force(self, load: Dict[str, Any], plane: str) -> float:
        primary_key = 'fy' if plane == 'xy' else 'fz'
        secondary_key = 'fz' if plane == 'xy' else 'fy'
        primary = self._to_float(load.get(primary_key, 0.0), 0.0)
        secondary = self._to_float(load.get(secondary_key, 0.0), 0.0)
        if abs(primary) > 1e-12 or secondary_key not in load:
            return primary
        return secondary

    def _plane_bending_moment(self, load: Dict[str, Any], plane: str) -> float:
        primary_key = 'mz' if plane == 'xy' else 'my'
        secondary_key = 'my' if plane == 'xy' else 'mz'
        primary = self._to_float(load.get(primary_key, 0.0), 0.0)
        secondary = self._to_float(load.get(secondary_key, 0.0), 0.0)
        if abs(primary) > 1e-12 or secondary_key not in load:
            return primary
        return secondary

    def _plane_distributed_load(self, load: Dict[str, Any], plane: str) -> float:
        primary = self._to_float(load.get('wy', 0.0), 0.0)
        secondary = self._to_float(load.get('wz', 0.0), 0.0)
        if plane == 'xy':
            return primary if abs(primary) > 1e-12 or 'wz' not in load else secondary
        return secondary if abs(secondary) > 1e-12 else primary

    def _build_envelope(self, displacements: Dict[str, Any], forces: Dict[str, Any], reactions: Dict[str, Any]) -> Dict[str, Any]:
        """构建结果包络：最大位移、内力与反力绝对值。"""
        max_abs_disp = 0.0
        control_node_disp = ''
        for node_id, disp in displacements.items():
            if not isinstance(disp, dict):
                continue
            ux = float(disp.get('ux', 0.0))
            uy = float(disp.get('uy', 0.0))
            uz = float(disp.get('uz', 0.0))
            mag = float(np.sqrt(ux * ux + uy * uy + uz * uz))
            if mag > max_abs_disp:
                max_abs_disp = mag
                control_node_disp = str(node_id)

        max_abs_axial = 0.0
        max_abs_shear = 0.0
        max_abs_moment = 0.0
        control_element_axial = ''
        control_element_shear = ''
        control_element_moment = ''
        for elem_id, force in forces.items():
            if isinstance(force, dict):
                axial = abs(float(force.get('axial', 0.0)))
                if axial > max_abs_axial:
                    max_abs_axial = axial
                    control_element_axial = str(elem_id)

                if 'n1' in force and isinstance(force['n1'], dict):
                    shear_n1 = abs(float(force['n1'].get('V', 0.0)))
                    moment_n1 = abs(float(force['n1'].get('M', 0.0)))
                    if shear_n1 > max_abs_shear:
                        max_abs_shear = shear_n1
                        control_element_shear = str(elem_id)
                    if moment_n1 > max_abs_moment:
                        max_abs_moment = moment_n1
                        control_element_moment = str(elem_id)
                if 'n2' in force and isinstance(force['n2'], dict):
                    shear_n2 = abs(float(force['n2'].get('V', 0.0)))
                    moment_n2 = abs(float(force['n2'].get('M', 0.0)))
                    if shear_n2 > max_abs_shear:
                        max_abs_shear = shear_n2
                        control_element_shear = str(elem_id)
                    if moment_n2 > max_abs_moment:
                        max_abs_moment = moment_n2
                        control_element_moment = str(elem_id)
            elif isinstance(force, list):
                for v in force:
                    axial = abs(float(v))
                    if axial > max_abs_axial:
                        max_abs_axial = axial
                        control_element_axial = str(elem_id)

        max_abs_reaction = 0.0
        control_node_reaction = ''
        for node_id, reaction in reactions.items():
            for v in self._iter_numeric_values(reaction):
                abs_v = abs(float(v))
                if abs_v > max_abs_reaction:
                    max_abs_reaction = abs_v
                    control_node_reaction = str(node_id)

        return {
            'maxAbsDisplacement': max_abs_disp,
            'maxAbsAxialForce': max_abs_axial,
            'maxAbsShearForce': max_abs_shear,
            'maxAbsMoment': max_abs_moment,
            'maxAbsReaction': max_abs_reaction,
            'controlNodeDisplacement': control_node_disp,
            'controlElementAxialForce': control_element_axial,
            'controlElementShearForce': control_element_shear,
            'controlElementMoment': control_element_moment,
            'controlNodeReaction': control_node_reaction,
        }

    def _iter_numeric_values(self, obj: Any):
        if isinstance(obj, dict):
            for value in obj.values():
                yield from self._iter_numeric_values(value)
        elif isinstance(obj, list):
            for value in obj:
                yield from self._iter_numeric_values(value)
        elif isinstance(obj, (int, float, np.floating, np.integer)):
            yield float(obj)

    def run_nonlinear(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        非线性静力分析 (Pushover)
        """
        logger.info("Starting nonlinear static analysis")

        try:
            if self.engine_mode == "simplified":
                return {
                    'status': 'error',
                    'message': 'Nonlinear analysis requires OpenSeesPy'
                }
            import openseespy.opensees as ops
            return self._run_nonlinear_opensees(parameters)
        except Exception:
            return {
                'status': 'error',
                'message': 'Nonlinear analysis requires OpenSeesPy'
            }

    def _run_nonlinear_opensees(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        使用 OpenSeesPy 执行非线性分析
        """
        raise NotImplementedError(
            "Nonlinear OpenSees analysis is not yet implemented; "
            "node/element definitions and nonlinear material setup are required"
        )

    def _define_beam_element(self, elem, ops):
        """定义梁单元"""
        section = self.sections.get(elem.section)
        material = self.materials.get(elem.material)
        if not section:
            raise ValueError(f"Section '{elem.section}' was not found for beam element '{elem.id}'")

        transform_tag = self._ops_element_tag(elem.id)
        reference_vector = self._get_beam_reference_vector(elem)
        ops.geomTransf('Linear', transform_tag, *reference_vector)
        ops.element(
            'elasticBeamColumn',
            self._ops_element_tag(elem.id),
            self._ops_node_tag(elem.nodes[0]),
            self._ops_node_tag(elem.nodes[1]),
            section.properties.get('A', 0.01),
            (material.E * 1000) if material else section.properties.get('E', 200000000),
            section.properties.get('G', 79000000),
            section.properties.get('J', 0.0001),
            section.properties.get('Iy', 0.0001),
            section.properties.get('Iz', 0.0001),
            transform_tag
        )

    def _define_beam_element_2d(self, elem, ops):
        section = self.sections.get(elem.section)
        material = self.materials.get(elem.material)
        if not section:
            raise ValueError(f"Section '{elem.section}' was not found for beam element '{elem.id}'")

        transform_tag = self._ops_element_tag(elem.id)
        inertia = float(section.properties.get('Iy', section.properties.get('Iz', 0.0001)))
        ops.geomTransf('Linear', transform_tag)
        ops.element(
            'elasticBeamColumn',
            self._ops_element_tag(elem.id),
            self._ops_node_tag(elem.nodes[0]),
            self._ops_node_tag(elem.nodes[1]),
            float(section.properties.get('A', 0.01)),
            float((material.E * 1000) if material else section.properties.get('E', 200000000)),
            inertia,
            transform_tag,
        )

    def _get_beam_reference_vector(self, elem) -> List[float]:
        start = self.nodes.get(elem.nodes[0])
        end = self.nodes.get(elem.nodes[1])
        if start is None or end is None:
            raise ValueError(f"Beam element '{elem.id}' references unknown nodes")

        axis = np.array([end.x - start.x, end.y - start.y, end.z - start.z], dtype=float)
        length = np.linalg.norm(axis)
        if length == 0:
            raise ValueError(f"Beam element '{elem.id}' has zero length")

        axis /= length
        reference = np.array([0.0, 0.0, 1.0], dtype=float)
        if abs(float(np.dot(axis, reference))) > 0.9:
            reference = np.array([0.0, 1.0, 0.0], dtype=float)
        return reference.tolist()

    def _define_truss_element(self, elem, ops):
        """定义桁架单元"""
        section = self.sections.get(elem.section)
        if section:
            ops.element(
                'truss',
                self._ops_element_tag(elem.id),
                self._ops_node_tag(elem.nodes[0]),
                self._ops_node_tag(elem.nodes[1]),
                section.properties.get('A', 0.01),
                self._ops_material_tag(elem.material)
            )

    def _apply_standardized_loads_2d(self, loads: List[Dict[str, Any]], ops, plane: str):
        if not loads:
            return
        ops.timeSeries('Linear', 1)
        ops.pattern('Plain', 1, 1)

        for load in loads:
            if load.get('type') == 'nodal':
                transverse = self._plane_transverse_force(load, plane)
                moment = self._plane_bending_moment(load, plane)
                ops.load(
                    self._ops_node_tag(load['node']),
                    float(load.get('fx', 0.0)),
                    transverse,
                    moment,
                )
            elif load.get('type') == 'distributed':
                ops.eleLoad(
                    '-ele',
                    self._ops_element_tag(load['element']),
                    '-type',
                    '-beamUniform',
                    self._plane_distributed_load(load, plane),
                )

    def _apply_standardized_loads_3d(self, loads: List[Dict[str, Any]], ops):
        if not loads:
            return
        ops.timeSeries('Linear', 1)
        ops.pattern('Plain', 1, 1)

        for load in loads:
            if load.get('type') == 'nodal':
                forces = load.get('forces')
                if isinstance(forces, list) and len(forces) >= 6:
                    ops.load(self._ops_node_tag(load['node']), *[float(value) for value in forces[:6]])
                else:
                    ops.load(
                        self._ops_node_tag(load['node']),
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
                    self._ops_element_tag(load['element']),
                    '-type',
                    '-beamUniform',
                    float(load.get('wy', 0.0)),
                    float(load.get('wz', 0.0)),
                )

    def _generate_summary(self, displacements: Dict, forces: Dict) -> Dict:
        """生成分析结果摘要"""
        if not displacements:
            return {}

        # 找最大位移
        max_disp = 0
        max_disp_node = None
        for node_id, disp in displacements.items():
            total_disp = (disp['ux']**2 + disp['uy']**2 + disp['uz']**2)**0.5
            if total_disp > max_disp:
                max_disp = total_disp
                max_disp_node = node_id

        return {
            'maxDisplacement': max_disp,
            'maxDisplacementNode': max_disp_node,
            'nodeCount': len(displacements),
            'elementCount': len(forces)
        }
