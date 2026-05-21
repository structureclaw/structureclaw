"""
静力分析模块
基于 OpenSeesPy 实现线性静力分析
"""

import numpy as np
from typing import Dict, Any, List, Optional, Set, Tuple
import logging
import re

logger = logging.getLogger(__name__)


class StaticAnalyzer:
    """简化静力分析器"""

    def __init__(self, model):
        """
        初始化分析器

        Args:
            model: 结构模型数据
        """
        self.model = model
        self.nodes = {n.id: n for n in model.nodes}
        self.elements = {e.id: e for e in model.elements}
        self.materials = {m.id: m for m in model.materials}
        self.sections = {s.id: s for s in model.sections}

        # 位移结果
        self.displacements = {}
        # 内力结果
        self.forces = {}
        # 应力结果
        self.stresses = {}

        # Lazily cached coordinate semantics metadata.
        self._coordinate_metadata: Optional[Dict[str, Any]] = None
        self._floor_load_transfer_trace: Dict[str, Any] = {}

    def _get_coordinate_metadata(self) -> Dict[str, Any]:
        """Return cached model metadata dict for coordinate semantics lookups."""
        if self._coordinate_metadata is not None:
            return self._coordinate_metadata
        try:
            from coordinate_semantics import get_model_metadata

            model_dict = (
                self.model.model_dump(mode='python')
                if hasattr(self.model, 'model_dump')
                else self.model if isinstance(self.model, dict) else {}
            )
            self._coordinate_metadata = get_model_metadata(model_dict)
        except Exception:
            logger.debug('Could not extract coordinate metadata', exc_info=True)
            self._coordinate_metadata = {}
        return self._coordinate_metadata

    def run(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        logger.info("Starting static analysis")
        return self._run_simplified(parameters)

    def _raise_unstable_structure(self) -> None:
        raise ValueError(
            "Structure is unstable or insufficiently restrained; please check node restraints / boundary conditions."
        )

    def _axis_range(self, axis: str) -> float:
        values = [float(getattr(node, axis)) for node in self.model.nodes]
        if not values:
            return 0.0
        return max(values) - min(values)

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

        try:
            from coordinate_semantics import get_frame_dimension

            if get_frame_dimension(self._get_coordinate_metadata()) == '3d':
                return None
        except Exception:
            logger.debug('Could not read frame dimension metadata; falling back to geometry-based plane inference', exc_info=True)

        y_range = self._axis_range('y')
        z_range = self._axis_range('z')
        tolerance = 1e-12

        if y_range > tolerance and z_range > tolerance:
            return None
        if y_range > tolerance:
            return 'xy'
        if z_range > tolerance:
            return 'xz'

        # Model is 1D (all nodes on x-axis).
        # For 1D beam models, always default to xz plane for compatibility with
        # restraint format and load mapping. Load handling maps fy to fz for xz plane.
        # However, certain load patterns cannot be represented correctly by 2D solver:
        # - torsional moment mx (2D solver ignores torsion)
        # - simultaneous nonzero xy-plane (fy/mz/wy) and xz-plane (fz/my/wz) components
        # In those cases we must fall back to 3D solver (return None).
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

            # Any torsional load about x-axis requires 3D; 2D solver ignores mx.
            if abs(mx) > tolerance:
                return None

            if abs(fy) > tolerance or abs(mz) > tolerance:
                has_xy_load = True
            if abs(fz) > tolerance or abs(my) > tolerance:
                has_xz_load = True

        # Mixed-plane loads cannot be accurately represented in 2D (would drop components)
        if has_xy_load and has_xz_load:
            return None

        # For 1D models, always use x-z plane; load handling maps fy to fz.
        # This aligns with restraint interpretation and fixes the instability issue from #83.
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

        return self._attach_floor_load_transfer({
            'status': 'success',
            'analysisMode': 'linear_2d_frame',
            'plane': plane,
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self._build_envelope(displacements, forces, reactions),
            'summary': self._generate_summary(displacements, forces),
        })

    def _run_linear_3d_frame(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        3D frame/beam 线弹性静力分析（DOF: ux, uy, uz, rx, ry, rz）。
        """
        node_order = sorted(self.model.nodes, key=lambda n: n.id)
        node_index = {node.id: idx for idx, node in enumerate(node_order)}
        dof_count = len(node_order) * 6

        K = np.zeros((dof_count, dof_count), dtype=float)
        F = np.zeros(dof_count, dtype=float)

        load_list = self._collect_nodal_loads(parameters)
        element_distributed_loads: Dict[str, List[Tuple[float, float]]] = {}
        for load in load_list:
            if str(load.get('type', '')) != 'distributed':
                continue
            elem_id = str(load.get('element', ''))
            if not elem_id:
                continue
            wy = self._to_float(load.get('wy', 0.0), 0.0)
            wz = self._to_float(load.get('wz', 0.0), 0.0)
            element_distributed_loads.setdefault(elem_id, []).append((wy, wz))

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

            R = self._build_3d_rotation_matrix(vec / L, elem_id=elem.id)
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

            wy = sum(item[0] for item in element_distributed_loads.get(elem.id, []))
            wz = sum(item[1] for item in element_distributed_loads.get(elem.id, []))
            f_local_dist = self._build_3d_uniform_load_vector(wy, wz, L)
            if np.any(np.abs(f_local_dist) > 0.0):
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
            f_local = meta['k_local'] @ u_local - meta['f_local_dist']
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

        return self._attach_floor_load_transfer({
            'status': 'success',
            'analysisMode': 'linear_3d_frame',
            'displacements': displacements,
            'forces': forces,
            'reactions': reactions,
            'envelope': self._build_envelope(displacements, forces, reactions),
            'summary': self._generate_summary(displacements, forces),
        })

    def _build_3d_rotation_matrix(self, ex: np.ndarray, elem_id: str = None) -> np.ndarray:
        """构建 3D frame 局部坐标旋转矩阵（局部 x 沿杆轴）。"""
        # Check metadata for an explicit reference vector first.
        ref = None
        if elem_id is not None:
            try:
                from coordinate_semantics import get_reference_vector

                explicit = get_reference_vector(self._get_coordinate_metadata(), elem_id)
                if explicit is not None:
                    ref = np.array(explicit, dtype=float)
            except Exception:
                logger.debug("Could not read metadata reference vectors; using geometry fallback", exc_info=True)

        if ref is None:
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

    def _build_3d_uniform_load_vector(self, wy: float, wz: float, L: float) -> np.ndarray:
        """Equivalent nodal load vector for local-y/local-z uniform beam loads."""
        f = np.zeros(12, dtype=float)
        if abs(wy) > 0.0:
            f[1] += wy * L / 2.0
            f[5] += wy * (L ** 2) / 12.0
            f[7] += wy * L / 2.0
            f[11] += -wy * (L ** 2) / 12.0
        if abs(wz) > 0.0:
            f[2] += wz * L / 2.0
            f[4] += -wz * (L ** 2) / 12.0
            f[8] += wz * L / 2.0
            f[10] += wz * (L ** 2) / 12.0
        return f

    def _collect_nodal_loads(self, parameters: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Collect standardized loads.

        Explicit nodal/distributed loads take precedence. When selected load
        cases contain no explicit loads, story floor loads are expanded into
        equivalent gravity nodal loads so OpenSees can analyze V2 floor-load
        models without engine-specific preprocessing.
        """
        self._floor_load_transfer_trace = {}
        explicit_loads: List[Dict[str, Any]] = []

        load_combination_id = (
            parameters.get('loadCombinationId')
            or parameters.get('load_combination_id')
            or parameters.get('combinationId')
        )
        if load_combination_id:
            floor_specs: List[Dict[str, Any]] = []
            combo_found = False
            for combo in self.model.load_combinations:
                if combo.id != str(load_combination_id):
                    continue
                combo_found = True
                case_map = {lc.id: lc for lc in self.model.load_cases}
                for case_id, factor in combo.factors.items():
                    lc = case_map.get(case_id)
                    if not lc:
                        continue
                    case_load_count = 0
                    for load in lc.loads:
                        normalized = self._normalize_load(load)
                        if normalized is not None:
                            explicit_loads.append(self._scale_load(normalized, float(factor)))
                            case_load_count += 1
                    if case_load_count == 0:
                        floor_specs.extend(self._floor_load_specs_for_case(lc, float(factor)))
                if combo_found:
                    expanded_floor_loads = self._expand_story_floor_loads(parameters, floor_specs)
                    return explicit_loads + expanded_floor_loads

        parameter_load_cases = parameters.get('loadCases') or parameters.get('load_cases') or []
        parameter_floor_specs: List[Dict[str, Any]] = []
        for lc in parameter_load_cases:
            if not isinstance(lc, dict):
                continue
            case_load_count = 0
            for load in lc.get('loads', []):
                normalized = self._normalize_load(load)
                if normalized is not None:
                    explicit_loads.append(normalized)
                    case_load_count += 1
            if case_load_count == 0:
                parameter_floor_specs.extend(self._floor_load_specs_for_case(lc, 1.0))

        if parameter_floor_specs:
            return explicit_loads + self._expand_story_floor_loads(parameters, parameter_floor_specs)
        if explicit_loads:
            return explicit_loads

        load_case_ids = parameters.get('loadCaseIds') or parameters.get('load_case_ids')
        if load_case_ids:
            allowed = set(str(i) for i in load_case_ids)
            selected_floor_specs: List[Dict[str, Any]] = []
            for lc in self.model.load_cases:
                if lc.id in allowed:
                    case_load_count = 0
                    for load in lc.loads:
                        normalized = self._normalize_load(load)
                        if normalized is not None:
                            explicit_loads.append(normalized)
                            case_load_count += 1
                    if case_load_count == 0:
                        selected_floor_specs.extend(self._floor_load_specs_for_case(lc, 1.0))
            if selected_floor_specs:
                return explicit_loads + self._expand_story_floor_loads(parameters, selected_floor_specs)
            return explicit_loads

        default_floor_specs: List[Dict[str, Any]] = []
        for lc in self.model.load_cases:
            case_load_count = 0
            for load in lc.loads:
                normalized = self._normalize_load(load)
                if normalized is not None:
                    explicit_loads.append(normalized)
                    case_load_count += 1
            if case_load_count == 0:
                default_floor_specs.extend(self._floor_load_specs_for_case(lc, 1.0))

        if default_floor_specs:
            return explicit_loads + self._expand_story_floor_loads(parameters, default_floor_specs)

        if explicit_loads:
            return explicit_loads

        return self._expand_story_floor_loads(parameters)

    def _floor_load_specs_for_case(self, load_case: Any, factor: float) -> List[Dict[str, Any]]:
        load_case_id = str(self._get_field(load_case, 'id', ''))
        load_case_type = str(self._get_field(load_case, 'type', '')).lower()
        return [{
            'types': self._floor_load_types_for_case(load_case_id, load_case_type),
            'factor': factor,
        }]

    def _floor_load_types_for_case(self, load_case_id: str, load_case_type: str) -> Optional[Set[str]]:
        if load_case_type in {'dead', 'live'}:
            return {load_case_type}
        if load_case_type == 'other':
            inferred = self._infer_floor_load_type_from_case_id(load_case_id)
            return {inferred} if inferred else None

        inferred = self._infer_floor_load_type_from_case_id(load_case_id)
        return {inferred} if inferred else None

    def _infer_floor_load_type_from_case_id(self, load_case_id: str) -> Optional[str]:
        normalized = re.sub(r'[^a-z0-9]+', '', load_case_id.lower())
        dead_aliases = {'d', 'dl', 'dead', 'deadload', 'lcde', 'lcdl', 'lcdead'}
        live_aliases = {'l', 'll', 'live', 'liveload', 'lcll', 'lclive'}
        if normalized in dead_aliases or normalized.startswith(('dead', 'deadload', 'dl', 'lcdead', 'lcdl')):
            return 'dead'
        if normalized in live_aliases or normalized.startswith(('live', 'liveload', 'll', 'lclive', 'lcll')):
            return 'live'
        return None

    def _expand_story_floor_loads(
        self,
        parameters: Dict[str, Any],
        floor_specs: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        if parameters.get('includeFloorLoads') is False or parameters.get('include_floor_loads') is False:
            requested_mode = self._floor_load_transfer_mode(parameters)
            warnings = self._floor_load_trace_warnings()
            warnings.append('Story floor load transfer was disabled by analysis parameters.')
            self._floor_load_transfer_trace = {
                'requestedMode': requested_mode,
                'effectiveMode': 'disabled',
                'loadSource': 'story_floor_loads',
                'method': self._floor_load_transfer_method_label('disabled'),
                'methodEn': self._floor_load_transfer_method_label('disabled'),
                'methodZh': self._floor_load_transfer_method_label_zh('disabled'),
                'warnings': warnings,
            }
            return []
        if not getattr(self.model, 'stories', None):
            return []

        requested_mode = self._floor_load_transfer_mode(parameters)
        mode_warnings = self._floor_load_trace_warnings()
        specs = floor_specs if floor_specs is not None else [{'types': None, 'factor': 1.0}]
        self._floor_load_transfer_trace = {
            'requestedMode': requested_mode,
            'effectiveMode': requested_mode,
            'loadSource': 'story_floor_loads',
            'designCode': 'GB 50010-2010(2015) 9.1.1',
            'method': self._floor_load_transfer_method_label(requested_mode),
            'methodEn': self._floor_load_transfer_method_label(requested_mode),
            'methodZh': self._floor_load_transfer_method_label_zh(requested_mode),
            'items': [],
            'warnings': mode_warnings,
        }

        if requested_mode == 'node_tributary':
            loads = self._expand_story_floor_loads_to_nodes(parameters, specs, 'node_tributary')
            self._refresh_floor_load_transfer_effective_mode()
            return loads

        slab_loads = self._expand_story_floor_loads_to_slab_beams(parameters, specs, requested_mode)
        if slab_loads:
            self._refresh_floor_load_transfer_effective_mode()
            return slab_loads

        warnings = self._floor_load_trace_warnings()
        warnings.append('No complete supported slab panel was found; falling back to node tributary-area loads.')
        self._floor_load_transfer_trace['warnings'] = warnings
        self._floor_load_transfer_trace['effectiveMode'] = 'node_tributary'
        self._floor_load_transfer_trace['method'] = self._floor_load_transfer_method_label('node_tributary')
        self._floor_load_transfer_trace['methodEn'] = self._floor_load_transfer_method_label('node_tributary')
        self._floor_load_transfer_trace['methodZh'] = self._floor_load_transfer_method_label_zh('node_tributary')
        loads = self._expand_story_floor_loads_to_nodes(parameters, specs, 'node_tributary')
        self._refresh_floor_load_transfer_effective_mode()
        return loads

    def _expand_story_floor_loads_to_nodes(
        self,
        parameters: Dict[str, Any],
        specs: List[Dict[str, Any]],
        effective_mode: str,
    ) -> List[Dict[str, Any]]:
        expanded: List[Dict[str, Any]] = []

        for story in self.model.stories:
            expanded.extend(self._expand_story_floor_load_to_nodes(story, parameters, specs, effective_mode))

        return expanded

    def _expand_story_floor_load_to_nodes(
        self,
        story: Any,
        parameters: Dict[str, Any],
        specs: List[Dict[str, Any]],
        effective_mode: str,
    ) -> List[Dict[str, Any]]:
        components = self._story_floor_load_components(story)
        if not components:
            return []

        intensity = self._story_floor_load_intensity(components, specs)
        if abs(intensity) <= 1e-12:
            return []

        node_areas = self._story_floor_node_areas(story, parameters)
        if not node_areas:
            self._append_floor_load_warning(
                f"Story {self._get_field(story, 'id', '')}: no floor nodes found for node tributary-area fallback."
            )
            return []

        expanded: List[Dict[str, Any]] = []
        generated_count = 0
        total_load = 0.0
        for node_id, area in node_areas.items():
            fz = -intensity * area
            if abs(fz) <= 1e-12:
                continue
            generated_count += 1
            total_load += intensity * area
            expanded.append({
                'type': 'nodal',
                'node': node_id,
                'fx': 0.0,
                'fy': 0.0,
                'fz': fz,
                'mx': 0.0,
                'my': 0.0,
                'mz': 0.0,
                'forces': [0.0, 0.0, fz, 0.0, 0.0, 0.0],
                'source': 'storyFloorLoad',
            })

        if generated_count > 0:
            self._append_floor_load_trace_item({
                'story': str(self._get_field(story, 'id', '')),
                'method': self._floor_load_transfer_method_label(effective_mode),
                'methodEn': self._floor_load_transfer_method_label(effective_mode),
                'methodZh': self._floor_load_transfer_method_label_zh(effective_mode),
                'effectiveMode': effective_mode,
                'loadIntensityKNPerM2': intensity,
                'generatedLoadType': 'nodal',
                'generatedLoadCount': generated_count,
                'totalLoadKN': total_load,
            })

        return expanded

    def _expand_story_floor_loads_to_slab_beams(
        self,
        parameters: Dict[str, Any],
        specs: List[Dict[str, Any]],
        requested_mode: str,
    ) -> List[Dict[str, Any]]:
        expanded: List[Dict[str, Any]] = []

        for story in self.model.stories:
            story_id = str(self._get_field(story, 'id', ''))
            components = self._story_floor_load_components(story)
            if not components:
                continue

            intensity = self._story_floor_load_intensity(components, specs)
            if abs(intensity) <= 1e-12:
                continue

            panels = self._story_floor_panels(story)
            if not panels:
                self._append_floor_load_warning(f"Story {story_id}: no complete rectangular floor panel found.")
                expanded.extend(self._expand_story_floor_load_to_nodes(story, parameters, specs, 'node_tributary'))
                continue

            story_loads: List[Dict[str, Any]] = []
            all_panels_supported = True
            for panel in panels:
                panel_loads = self._panel_floor_loads(panel, intensity, requested_mode)
                if not panel_loads:
                    all_panels_supported = False
                    continue
                story_loads.extend(panel_loads)

            if story_loads and all_panels_supported:
                expanded.extend(story_loads)
                continue

            self._remove_floor_load_trace_items_for_story(story_id)
            self._append_floor_load_warning(
                f"Story {story_id}: slab-beam transfer was incomplete; falling back to node tributary-area loads."
            )
            expanded.extend(self._expand_story_floor_load_to_nodes(story, parameters, specs, 'node_tributary'))

        return expanded

    def _story_floor_load_intensity(
        self,
        components: List[Tuple[str, float]],
        specs: List[Dict[str, Any]],
    ) -> float:
        intensity = 0.0
        for spec in specs:
            requested_types = spec.get('types')
            factor = self._to_float(spec.get('factor', 1.0), 1.0)
            for component_type, component_value in components:
                if requested_types is None or component_type in requested_types:
                    intensity += component_value * factor
        return intensity

    def _floor_load_transfer_mode(self, parameters: Dict[str, Any]) -> str:
        raw = (
            parameters.get('floorLoadTransferMode')
            or parameters.get('floor_load_transfer_mode')
            or self._get_field(getattr(self.model, 'metadata', {}) or {}, 'floorLoadTransferMode', None)
            or self._get_field(getattr(self.model, 'metadata', {}) or {}, 'floor_load_transfer_mode', None)
            or 'auto_code_cn'
        )
        mode = str(raw).strip().lower()
        aliases = {
            'node': 'node_tributary',
            'node_tributary_area': 'node_tributary',
            'one_way': 'one_way_slab',
            'one-way': 'one_way_slab',
            'two_way': 'two_way_slab',
            'two-way': 'two_way_slab',
            'auto': 'auto_code_cn',
            'cn': 'auto_code_cn',
            'gb50010': 'auto_code_cn',
        }
        normalized = aliases.get(mode, mode)
        if normalized not in {'node_tributary', 'one_way_slab', 'two_way_slab', 'auto_code_cn'}:
            self._append_floor_load_warning(f"Unknown floor load transfer mode '{raw}', using auto_code_cn.")
            return 'auto_code_cn'
        return normalized

    def _floor_load_transfer_method_label(self, mode: str) -> str:
        labels = {
            'node_tributary': 'Node tributary-area equivalent nodal load',
            'one_way_slab': 'One-way slab load transfer to supporting beams',
            'two_way_slab': 'Two-way slab load transfer with equivalent uniform beam loads',
            'auto_code_cn': 'Automatic GB 50010 slab classification and beam load transfer',
            'mixed': 'Mixed floor load transfer methods',
            'disabled': 'Floor load transfer disabled',
        }
        return labels.get(mode, mode)

    def _floor_load_transfer_method_label_zh(self, mode: str) -> str:
        labels = {
            'node_tributary': '节点影响面积等效节点荷载',
            'one_way_slab': '单向板传至支承梁',
            'two_way_slab': '双向板传至支承梁并折算为等效均布梁荷载',
            'auto_code_cn': '按 GB 50010 自动判别单向/双向板并传至梁',
            'mixed': '混合楼面荷载传递方法',
            'disabled': '楼面荷载传递已关闭',
        }
        return labels.get(mode, mode)

    def _story_floor_panels(self, story: Any) -> List[Dict[str, Any]]:
        target_nodes = self._target_floor_nodes(story)
        if not target_nodes:
            return []

        z_values = self._unique_sorted_coordinates(float(node.z) for node in target_nodes)
        if len(z_values) != 1:
            return []
        z = z_values[0]
        x_values = self._unique_sorted_coordinates(float(node.x) for node in target_nodes)
        y_values = self._unique_sorted_coordinates(float(node.y) for node in target_nodes)
        if len(x_values) < 2 or len(y_values) < 2:
            return []

        story_id = str(self._get_field(story, 'id', ''))
        panels: List[Dict[str, Any]] = []
        for x_idx in range(len(x_values) - 1):
            for y_idx in range(len(y_values) - 1):
                x0 = x_values[x_idx]
                x1 = x_values[x_idx + 1]
                y0 = y_values[y_idx]
                y1 = y_values[y_idx + 1]
                edges = {
                    'x_min': self._find_beam_between(z, x0, y0, x0, y1, story_id),
                    'x_max': self._find_beam_between(z, x1, y0, x1, y1, story_id),
                    'y_min': self._find_beam_between(z, x0, y0, x1, y0, story_id),
                    'y_max': self._find_beam_between(z, x0, y1, x1, y1, story_id),
                }
                panels.append({
                    'id': f"{story_id or 'story'}:{x_idx + 1}:{y_idx + 1}",
                    'story': story_id,
                    'z': z,
                    'x0': x0,
                    'x1': x1,
                    'y0': y0,
                    'y1': y1,
                    'lx': x1 - x0,
                    'ly': y1 - y0,
                    'edges': edges,
                })
        return panels

    def _find_beam_between(
        self,
        z: float,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        story_id: str,
    ) -> Optional[Dict[str, Any]]:
        for elem in self.model.elements:
            if getattr(elem, 'type', '') != 'beam' or len(elem.nodes) < 2:
                continue
            if story_id and getattr(elem, 'story', None) not in {None, story_id}:
                continue
            start = self.nodes.get(elem.nodes[0])
            end = self.nodes.get(elem.nodes[1])
            if start is None or end is None:
                continue
            p_start = (float(start.x), float(start.y), float(start.z))
            p_end = (float(end.x), float(end.y), float(end.z))
            a = (x1, y1, z)
            b = (x2, y2, z)
            if self._segment_contains_points(p_start, p_end, a, b):
                return {
                    'id': str(elem.id),
                    'segmentLength': self._point_distance(a, b),
                    'elementLength': self._point_distance(p_start, p_end),
                }
        return None

    def _points_match(self, first: Tuple[float, float, float], second: Tuple[float, float, float]) -> bool:
        tolerance = 1e-6
        return all(abs(first[idx] - second[idx]) <= tolerance for idx in range(3))

    def _segment_contains_points(
        self,
        start: Tuple[float, float, float],
        end: Tuple[float, float, float],
        first: Tuple[float, float, float],
        second: Tuple[float, float, float],
    ) -> bool:
        return self._point_on_segment(first, start, end) and self._point_on_segment(second, start, end)

    def _point_on_segment(
        self,
        point: Tuple[float, float, float],
        start: Tuple[float, float, float],
        end: Tuple[float, float, float],
    ) -> bool:
        tolerance = 1e-6
        direction = tuple(end[idx] - start[idx] for idx in range(3))
        relative = tuple(point[idx] - start[idx] for idx in range(3))
        length_sq = sum(value * value for value in direction)
        if length_sq <= tolerance ** 2:
            return self._points_match(point, start)
        cross = (
            relative[1] * direction[2] - relative[2] * direction[1],
            relative[2] * direction[0] - relative[0] * direction[2],
            relative[0] * direction[1] - relative[1] * direction[0],
        )
        cross_norm_sq = sum(value * value for value in cross)
        if cross_norm_sq > (tolerance ** 2) * length_sq:
            return False
        dot = sum(relative[idx] * direction[idx] for idx in range(3))
        return -tolerance <= dot <= length_sq + tolerance

    def _point_distance(self, first: Tuple[float, float, float], second: Tuple[float, float, float]) -> float:
        return sum((first[idx] - second[idx]) ** 2 for idx in range(3)) ** 0.5

    def _panel_floor_loads(
        self,
        panel: Dict[str, Any],
        intensity: float,
        requested_mode: str,
    ) -> List[Dict[str, Any]]:
        lx = self._to_float(panel.get('lx', 0.0), 0.0)
        ly = self._to_float(panel.get('ly', 0.0), 0.0)
        if lx <= 0.0 or ly <= 0.0:
            return []

        edges = panel.get('edges') if isinstance(panel.get('edges'), dict) else {}
        edge_ids = {key: value for key, value in edges.items() if value}
        ratio = max(lx, ly) / min(lx, ly)
        mode = self._classify_panel_transfer_mode(requested_mode, lx, ly, edge_ids)
        if mode is None:
            self._append_floor_load_warning(f"Panel {panel.get('id')}: supporting beams are incomplete.")
            return []

        if mode == 'one_way_slab':
            loads = self._one_way_panel_loads(panel, intensity)
        else:
            loads = self._two_way_panel_loads(panel, intensity)

        total_load = intensity * lx * ly
        trace_item = {
            'story': panel.get('story'),
            'panelId': panel.get('id'),
            'requestedMode': requested_mode,
            'effectiveMode': mode,
            'method': self._floor_load_transfer_method_label(mode),
            'methodEn': self._floor_load_transfer_method_label(mode),
            'methodZh': self._floor_load_transfer_method_label_zh(mode),
            'designCodeRule': self._panel_design_code_rule(mode, ratio, edge_ids),
            'designCodeRuleEn': self._panel_design_code_rule(mode, ratio, edge_ids),
            'designCodeRuleZh': self._panel_design_code_rule_zh(mode, ratio, edge_ids),
            'spanX': lx,
            'spanY': ly,
            'longShortRatio': ratio,
            'loadIntensityKNPerM2': intensity,
            'generatedLoadType': 'distributed',
            'generatedLoadCount': len(loads),
            'totalLoadKN': total_load,
        }
        if mode == 'two_way_slab':
            trace_item['note'] = (
                'Two-way slab line loads are converted to equivalent uniform beam loads '
                'for the OpenSees beamUniform load interface.'
            )
            trace_item['noteEn'] = trace_item['note']
            trace_item['noteZh'] = '双向板分配到边梁的线荷载会折算为 OpenSees beamUniform 等效均布梁荷载。'
        self._append_floor_load_trace_item(trace_item)
        return loads

    def _classify_panel_transfer_mode(
        self,
        requested_mode: str,
        lx: float,
        ly: float,
        edge_ids: Dict[str, Any],
    ) -> Optional[str]:
        has_x_pair = bool(edge_ids.get('x_min') and edge_ids.get('x_max'))
        has_y_pair = bool(edge_ids.get('y_min') and edge_ids.get('y_max'))

        if requested_mode == 'one_way_slab':
            return 'one_way_slab' if (has_x_pair or has_y_pair) else None
        if requested_mode == 'two_way_slab':
            return 'two_way_slab' if (has_x_pair and has_y_pair) else None

        if has_x_pair and has_y_pair:
            ratio = max(lx, ly) / min(lx, ly)
            return 'one_way_slab' if ratio >= 3.0 else 'two_way_slab'
        if has_x_pair or has_y_pair:
            return 'one_way_slab'
        return None

    def _panel_design_code_rule(self, mode: str, ratio: float, edge_ids: Dict[str, Any]) -> str:
        if not (edge_ids.get('x_min') and edge_ids.get('x_max') and edge_ids.get('y_min') and edge_ids.get('y_max')):
            return 'GB 50010 9.1.1: slab supported on two opposite sides is calculated as one-way slab.'
        if mode == 'one_way_slab':
            return 'GB 50010 9.1.1: four-side supported slab with long/short span ratio >= 3.0 may be calculated as one-way slab along the short span.'
        if ratio <= 2.0:
            return 'GB 50010 9.1.1: four-side supported slab with long/short span ratio <= 2.0 is calculated as two-way slab.'
        return 'GB 50010 9.1.1: four-side supported slab with long/short span ratio between 2.0 and 3.0 is preferably calculated as two-way slab.'

    def _panel_design_code_rule_zh(self, mode: str, ratio: float, edge_ids: Dict[str, Any]) -> str:
        if not (edge_ids.get('x_min') and edge_ids.get('x_max') and edge_ids.get('y_min') and edge_ids.get('y_max')):
            return 'GB 50010 9.1.1：两对边支承板按单向板计算。'
        if mode == 'one_way_slab':
            return 'GB 50010 9.1.1：四边支承板长短边比不小于 3.0 时，可按沿短边方向受力的单向板计算。'
        if ratio <= 2.0:
            return 'GB 50010 9.1.1：四边支承板长短边比不大于 2.0 时，按双向板计算。'
        return 'GB 50010 9.1.1：四边支承板长短边比大于 2.0 且小于 3.0 时，宜按双向板计算。'

    def _one_way_panel_loads(self, panel: Dict[str, Any], intensity: float) -> List[Dict[str, Any]]:
        lx = self._to_float(panel.get('lx', 0.0), 0.0)
        ly = self._to_float(panel.get('ly', 0.0), 0.0)
        edges = panel.get('edges') if isinstance(panel.get('edges'), dict) else {}

        if lx <= ly and edges.get('x_min') and edges.get('x_max'):
            line_load = intensity * lx / 2.0
            return [
                self._distributed_gravity_load(edges['x_min'], line_load, panel),
                self._distributed_gravity_load(edges['x_max'], line_load, panel),
            ]
        if edges.get('y_min') and edges.get('y_max'):
            line_load = intensity * ly / 2.0
            return [
                self._distributed_gravity_load(edges['y_min'], line_load, panel),
                self._distributed_gravity_load(edges['y_max'], line_load, panel),
            ]
        return []

    def _two_way_panel_loads(self, panel: Dict[str, Any], intensity: float) -> List[Dict[str, Any]]:
        lx = self._to_float(panel.get('lx', 0.0), 0.0)
        ly = self._to_float(panel.get('ly', 0.0), 0.0)
        edges = panel.get('edges') if isinstance(panel.get('edges'), dict) else {}
        if not all(edges.get(key) for key in ('x_min', 'x_max', 'y_min', 'y_max')):
            return []

        a = min(lx, ly)
        b = max(lx, ly)
        long_edge_line_load = intensity * a * (0.5 - a / (4.0 * b))
        short_edge_line_load = intensity * a / 4.0

        if lx <= ly:
            return [
                self._distributed_gravity_load(edges['x_min'], long_edge_line_load, panel),
                self._distributed_gravity_load(edges['x_max'], long_edge_line_load, panel),
                self._distributed_gravity_load(edges['y_min'], short_edge_line_load, panel),
                self._distributed_gravity_load(edges['y_max'], short_edge_line_load, panel),
            ]
        return [
            self._distributed_gravity_load(edges['y_min'], long_edge_line_load, panel),
            self._distributed_gravity_load(edges['y_max'], long_edge_line_load, panel),
            self._distributed_gravity_load(edges['x_min'], short_edge_line_load, panel),
            self._distributed_gravity_load(edges['x_max'], short_edge_line_load, panel),
        ]

    def _distributed_gravity_load(self, edge: Any, line_load: float, panel: Dict[str, Any]) -> Dict[str, Any]:
        edge_data = edge if isinstance(edge, dict) else {'id': str(edge)}
        element_id = str(edge_data.get('id', ''))
        segment_length = self._to_float(edge_data.get('segmentLength', 0.0), 0.0)
        element_length = self._to_float(edge_data.get('elementLength', 0.0), 0.0)
        coverage_ratio = segment_length / element_length if segment_length > 0.0 and element_length > 0.0 else 1.0
        load = {
            'type': 'distributed',
            'element': element_id,
            'wy': 0.0,
            'wz': -line_load * coverage_ratio,
            'source': 'storyFloorLoad',
            'panel': panel.get('id'),
        }
        if coverage_ratio < 1.0:
            load['tributarySegmentLength'] = segment_length
            load['elementLength'] = element_length
        return load

    def _append_floor_load_trace_item(self, item: Dict[str, Any]) -> None:
        if not isinstance(self._floor_load_transfer_trace, dict):
            self._floor_load_transfer_trace = {}
        items = self._floor_load_transfer_trace.setdefault('items', [])
        if isinstance(items, list):
            items.append(item)

    def _remove_floor_load_trace_items_for_story(self, story_id: str) -> None:
        if not isinstance(self._floor_load_transfer_trace, dict):
            return
        items = self._floor_load_transfer_trace.get('items')
        if not isinstance(items, list):
            return
        self._floor_load_transfer_trace['items'] = [
            item for item in items if not isinstance(item, dict) or str(item.get('story', '')) != story_id
        ]

    def _append_floor_load_warning(self, warning: str) -> None:
        if not warning:
            return
        if not isinstance(self._floor_load_transfer_trace, dict):
            self._floor_load_transfer_trace = {}
        warnings = self._floor_load_transfer_trace.setdefault('warnings', [])
        if isinstance(warnings, list) and warning not in warnings:
            warnings.append(warning)

    def _floor_load_trace_warnings(self) -> List[str]:
        warnings = self._floor_load_transfer_trace.get('warnings', [])
        if not isinstance(warnings, list):
            return []
        return [str(warning) for warning in warnings if str(warning)]

    def _refresh_floor_load_transfer_effective_mode(self) -> None:
        if not isinstance(self._floor_load_transfer_trace, dict):
            return
        items = self._floor_load_transfer_trace.get('items')
        if not isinstance(items, list) or not items:
            return
        modes = sorted({
            str(item.get('effectiveMode'))
            for item in items
            if isinstance(item, dict) and item.get('effectiveMode')
        })
        if not modes:
            return
        effective_mode = modes[0] if len(modes) == 1 else 'mixed'
        self._floor_load_transfer_trace['effectiveMode'] = effective_mode
        self._floor_load_transfer_trace['method'] = self._floor_load_transfer_method_label(effective_mode)
        self._floor_load_transfer_trace['methodEn'] = self._floor_load_transfer_method_label(effective_mode)
        self._floor_load_transfer_trace['methodZh'] = self._floor_load_transfer_method_label_zh(effective_mode)

    def _floor_load_transfer_summary(self) -> Optional[Dict[str, Any]]:
        if not isinstance(self._floor_load_transfer_trace, dict) or not self._floor_load_transfer_trace:
            return None
        summary = dict(self._floor_load_transfer_trace)
        items = summary.get('items')
        warnings = summary.get('warnings')
        if isinstance(items, list) and not items:
            summary.pop('items', None)
        if isinstance(warnings, list) and not warnings:
            summary.pop('warnings', None)
        if not summary.get('effectiveMode') and not summary.get('method'):
            return None
        return summary

    def _attach_floor_load_transfer(self, result: Dict[str, Any]) -> Dict[str, Any]:
        summary = self._floor_load_transfer_summary()
        if summary is None:
            return result
        return {**result, 'floorLoadTransfer': summary}

    def _story_floor_load_components(self, story: Any) -> List[Tuple[str, float]]:
        components: List[Tuple[str, float]] = []
        seen_types: Set[str] = set()

        for floor_load in self._get_field(story, 'floor_loads', []) or []:
            load_type = str(self._get_field(floor_load, 'type', 'other')).lower()
            value = self._to_float(self._get_field(floor_load, 'value', 0.0), 0.0)
            if abs(value) <= 1e-12:
                continue
            components.append((load_type, value))
            seen_types.add(load_type)

        for field_name, load_type in (('dead_load', 'dead'), ('live_load', 'live')):
            if load_type in seen_types:
                continue
            value = self._to_float(self._get_field(story, field_name, 0.0), 0.0)
            if abs(value) > 1e-12:
                components.append((load_type, value))
                seen_types.add(load_type)

        return components

    def _story_floor_node_areas(self, story: Any, parameters: Dict[str, Any]) -> Dict[str, float]:
        target_nodes = self._target_floor_nodes(story)
        if not target_nodes:
            return {}

        x_values = self._unique_sorted_coordinates(float(node.x) for node in target_nodes)
        y_values = self._unique_sorted_coordinates(float(node.y) for node in target_nodes)
        x_lengths = self._tributary_lengths(x_values)

        if len(y_values) >= 2:
            y_lengths = self._tributary_lengths(y_values)
            return {
                str(node.id): x_lengths.get(self._coord_key(float(node.x)), 0.0) * y_lengths.get(self._coord_key(float(node.y)), 0.0)
                for node in target_nodes
            }

        tributary_width = self._floor_load_tributary_width(parameters)
        if len(x_values) >= 2:
            return {
                str(node.id): x_lengths.get(self._coord_key(float(node.x)), 0.0) * tributary_width
                for node in target_nodes
            }

        return {str(node.id): tributary_width for node in target_nodes}

    def _target_floor_nodes(self, story: Any) -> List[Any]:
        story_id = str(self._get_field(story, 'id', ''))
        elevation = self._field_float(story, 'elevation')
        height = self._field_float(story, 'height')

        if elevation is not None and height is not None:
            nodes = self._nodes_at_z(elevation + height)
            if nodes:
                return nodes

        story_ordinal = self._story_ordinal(story_id)
        if story_ordinal is not None:
            levels = self._z_levels()
            if story_ordinal < len(levels):
                nodes = self._nodes_at_z(levels[story_ordinal])
                if nodes:
                    return nodes

        if story_id:
            nodes = [node for node in self.model.nodes if str(getattr(node, 'story', '')) == story_id]
            if nodes:
                return nodes

        if elevation is not None:
            return self._nodes_at_z(elevation)

        return []

    def _story_ordinal(self, story_id: str) -> Optional[int]:
        match = re.search(r'(\d+)$', story_id)
        if not match:
            return None
        value = int(match.group(1))
        return value if value > 0 else None

    def _z_levels(self) -> List[float]:
        return self._unique_sorted_coordinates(float(node.z) for node in self.model.nodes)

    def _nodes_at_z(self, z: float) -> List[Any]:
        tolerance = 1e-6
        return [node for node in self.model.nodes if abs(float(node.z) - z) <= tolerance]

    def _tributary_lengths(self, values: List[float]) -> Dict[int, float]:
        if not values:
            return {}
        if len(values) == 1:
            return {self._coord_key(values[0]): 1.0}

        lengths: Dict[int, float] = {}
        for idx, value in enumerate(values):
            if idx == 0:
                length = (values[1] - value) / 2.0
            elif idx == len(values) - 1:
                length = (value - values[idx - 1]) / 2.0
            else:
                length = (values[idx + 1] - values[idx - 1]) / 2.0
            lengths[self._coord_key(value)] = max(float(length), 0.0)
        return lengths

    def _unique_sorted_coordinates(self, values: Any) -> List[float]:
        by_key: Dict[int, float] = {}
        for value in values:
            key = self._coord_key(float(value))
            by_key.setdefault(key, float(value))
        return sorted(by_key.values())

    def _coord_key(self, value: float) -> int:
        return int(round(float(value) * 1_000_000))

    def _floor_load_tributary_width(self, parameters: Dict[str, Any]) -> float:
        for key in ('floorLoadTributaryWidthM', 'floor_load_tributary_width_m', 'tributaryWidthM', 'tributary_width_m'):
            value = self._to_float(parameters.get(key, 0.0), 0.0)
            if value > 0.0:
                return value

        metadata = getattr(self.model, 'metadata', {}) or {}
        if isinstance(metadata, dict):
            for key in ('floorLoadTributaryWidthM', 'floor_load_tributary_width_m', 'tributaryWidthM', 'tributary_width_m'):
                value = self._to_float(metadata.get(key, 0.0), 0.0)
                if value > 0.0:
                    return value

        return 1.0

    def _get_field(self, obj: Any, key: str, fallback: Any = None) -> Any:
        if isinstance(obj, dict):
            return obj.get(key, fallback)
        return getattr(obj, key, fallback)

    def _field_float(self, obj: Any, key: str) -> Optional[float]:
        value = self._get_field(obj, key, None)
        if value is None:
            return None
        return self._to_float(value, 0.0)

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
        raise NotImplementedError(
            "Nonlinear analysis is not supported by the simplified engine"
        )

    def _get_beam_reference_vector(self, elem) -> List[float]:
        # Check metadata for an explicit reference vector first.
        try:
            from coordinate_semantics import get_reference_vector

            explicit = get_reference_vector(self._get_coordinate_metadata(), elem.id)
            if explicit is not None:
                return explicit
        except Exception:
            logger.debug("Could not read metadata reference vectors; using geometry fallback", exc_info=True)

        # Fallback: geometry-based reference vector
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
