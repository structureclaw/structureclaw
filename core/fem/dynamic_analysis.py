"""
动力分析模块
模态分析、时程分析
"""

import numpy as np
from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)


class DynamicAnalyzer:
    """动力分析器"""

    def __init__(self, model, engine_mode: str = "auto"):
        self.model = model
        self.engine_mode = engine_mode
        self.nodes = {n.id: n for n in model.nodes}
        self.elements = {e.id: e for e in model.elements}
        self.materials = {m.id: m for m in model.materials}

        self._ops_node_tags = {str(n.id): i + 1 for i, n in enumerate(model.nodes)}
        self._ops_element_tags = {str(e.id): i + 1 for i, e in enumerate(model.elements)}
        self._ops_material_tags = {str(m.id): i + 1 for i, m in enumerate(model.materials)}

    def _ops_node_tag(self, node_id) -> int:
        key = str(node_id)
        if key not in self._ops_node_tags:
            raise ValueError(f"Unknown node id '{node_id}' in OpenSees mapping")
        return self._ops_node_tags[key]

    def _ops_element_tag(self, element_id) -> int:
        key = str(element_id)
        if key not in self._ops_element_tags:
            raise ValueError(f"Unknown element id '{element_id}' in OpenSees mapping")
        return self._ops_element_tags[key]

    def _ops_material_tag(self, material_id) -> int:
        key = str(material_id)
        if key not in self._ops_material_tags:
            raise ValueError(f"Unknown material id '{material_id}' in OpenSees mapping")
        return self._ops_material_tags[key]

    def run(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行动力分析

        Args:
            parameters: 分析参数
                - analysisType: 'modal' 或 'time_history'
                - numModes: 模态数量（模态分析）
                - timeStep: 时间步长
                - duration: 分析时长
                - groundMotion: 地震动数据
        """
        analysis_type = parameters.get('analysisType', 'modal')

        if analysis_type == 'modal':
            return self._modal_analysis(parameters)
        elif analysis_type == 'time_history':
            return self._time_history_analysis(parameters)
        else:
            return {
                'status': 'error',
                'message': f'Unknown analysis type: {analysis_type}'
            }

    def _modal_analysis(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        模态分析
        """
        num_modes = parameters.get('numModes', 10)

        logger.info(f"Running modal analysis for {num_modes} modes")

        if self.engine_mode == 'simplified':
            return self._modal_simplified(num_modes)
        try:
            import openseespy.opensees as ops
            return self._modal_opensees(num_modes, ops)
        except Exception:
            if self.engine_mode == 'opensees':
                return {
                    'status': 'error',
                    'message': 'Modal analysis requires OpenSeesPy for the requested engine'
                }
            return self._modal_simplified(num_modes)

    def _modal_opensees(self, num_modes: int, ops) -> Dict[str, Any]:
        """
        使用 OpenSeesPy 执行模态分析
        """
        # 建立模型（复用静力分析的代码）
        ops.wipe()
        ops.model('basic', '-ndm', 3, '-ndf', 6)

        # 定义节点
        for node in self.model.nodes:
            tag = self._ops_node_tag(node.id)
            ops.node(tag, node.x, node.y, node.z)
            if node.restraints:
                ops.fix(tag, *node.restraints)

        # 定义质量和刚度
        total_mass = 0
        for node in self.model.nodes:
            mass = [100] * 6  # 简化的质量
            ops.mass(self._ops_node_tag(node.id), *mass)
            total_mass += mass[0]

        # 定义材料
        for mat in self.model.materials:
            ops.uniaxialMaterial('Elastic', self._ops_material_tag(mat.id), mat.E * 1000)

        # 定义单元
        for elem in self.model.elements:
            if elem.type == 'beam':
                ops.element(
                    'elasticBeamColumn',
                    self._ops_element_tag(elem.id),
                    self._ops_node_tag(elem.nodes[0]),
                    self._ops_node_tag(elem.nodes[1]),
                    0.01,  # A
                    200000000,  # E
                    0.0001,  # Iz
                    0.0001,  # Iy
                    79000000,  # G
                    0.00001  # J
                )

        # 构建刚度矩阵
        ops.system('BandSPD')
        ops.numberer('Plain')
        ops.constraints('Plain')

        # 模态分析
        eigen_values = ops.eigen(num_modes)

        # 提取模态结果
        modes = []
        for i, ev in enumerate(eigen_values):
            omega = np.sqrt(ev)
            period = 2 * np.pi / omega
            frequency = omega / (2 * np.pi)

            # 获取模态形状
            mode_shape = {}
            for node in self.model.nodes:
                try:
                    shape = ops.nodeEigenvector(self._ops_node_tag(node.id), i + 1)
                    mode_shape[node.id] = shape[:3].tolist()
                except:
                    mode_shape[node.id] = [0, 0, 0]

            modes.append({
                'modeNumber': i + 1,
                'period': period,
                'frequency': frequency,
                'omega': omega,
                'modeShape': mode_shape
            })

        ops.wipe()

        return {
            'status': 'success',
            'totalMass': total_mass,
            'modes': modes
        }

    def _modal_simplified(self, num_modes: int) -> Dict[str, Any]:
        """
        简化模态分析
        """
        # 使用简化方法估算基本周期
        # T ≈ 0.1n (n为楼层数)
        n_stories = len(set(n.z for n in self.model.nodes)) - 1

        modes = []
        for i in range(num_modes):
            # 简化的周期估算
            period = 0.1 * n_stories / (i + 1)
            frequency = 1 / period

            modes.append({
                'modeNumber': i + 1,
                'period': period,
                'frequency': frequency,
                'omega': 2 * np.pi * frequency
            })

        return {
            'status': 'success',
            'modes': modes,
            'note': 'Simplified modal analysis'
        }

    def _time_history_analysis(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        时程分析
        """
        time_step = parameters.get('timeStep', 0.02)
        duration = parameters.get('duration', 20.0)
        damping_ratio = parameters.get('dampingRatio', 0.05)
        ground_motion = parameters.get('groundMotion', [])

        logger.info(f"Running time history analysis: duration={duration}s, dt={time_step}s")

        if self.engine_mode == 'simplified':
            return {
                'status': 'error',
                'message': 'Time history analysis is not supported by the simplified engine'
            }
        try:
            import openseespy.opensees as ops
            return self._time_history_opensees(
                time_step, duration, damping_ratio, ground_motion, ops
            )
        except Exception:
            return {
                'status': 'error',
                'message': 'Time history analysis requires OpenSeesPy'
            }

    def _time_history_opensees(
        self,
        time_step: float,
        duration: float,
        damping_ratio: float,
        ground_motion: List[float],
        ops
    ) -> Dict[str, Any]:
        """
        使用 OpenSeesPy 执行时程分析
        """
        # 建立模型
        ops.wipe()
        ops.model('basic', '-ndm', 3, '-ndf', 6)

        # 定义节点和单元
        for node in self.model.nodes:
            tag = self._ops_node_tag(node.id)
            ops.node(tag, node.x, node.y, node.z)
            if node.restraints:
                ops.fix(tag, *node.restraints)

        # 定义质量
        for node in self.model.nodes:
            ops.mass(self._ops_node_tag(node.id), 100, 100, 100, 0, 0, 0)

        # 定义材料
        for mat in self.model.materials:
            ops.uniaxialMaterial('Elastic', self._ops_material_tag(mat.id), mat.E * 1000)

        # 定义单元
        for elem in self.model.elements:
            if elem.type == 'beam':
                ops.element(
                    'elasticBeamColumn',
                    self._ops_element_tag(elem.id),
                    self._ops_node_tag(elem.nodes[0]),
                    self._ops_node_tag(elem.nodes[1]),
                    0.01, 200000000, 0.0001, 0.0001, 79000000, 0.00001
                )

        # Rayleigh 阻尼
        ops.rayleigh(damping_ratio, 0, 0, damping_ratio)

        # 定义地震波
        if ground_motion:
            ops.timeSeries('Path', 1,
                          '-dt', time_step,
                          '-values', *ground_motion[:min(len(ground_motion), 1000)])
        else:
            # 使用简单的正弦波
            t = np.arange(0, duration, time_step)
            acc = 0.1 * np.sin(2 * np.pi * 1 * t)
            ops.timeSeries('Path', 1, '-dt', time_step, '-values', *acc.tolist())

        # 定义荷载模式
        ops.pattern('UniformExcitation', 1, 1, '-accel', 1)

        # 分析设置
        ops.system('BandSPD')
        ops.numberer('Plain')
        ops.constraints('Plain')
        ops.integrator('Newmark', 0.5, 0.25)
        ops.algorithm('Newton')
        ops.analysis('Transient')

        # 执行分析
        results = []
        current_time = 0
        num_steps = int(duration / time_step)

        # 监测节点（取最高的一个非约束节点）
        monitor_node = None
        for node in self.model.nodes:
            if not node.restraints or not all(node.restraints):
                monitor_node = node.id
                break

        for i in range(num_steps):
            ok = ops.analyze(1, time_step)
            if ok != 0:
                break

            current_time += time_step

            if monitor_node and i % 10 == 0:  # 每10步记录一次
                disp = ops.nodeDisp(int(monitor_node))
                results.append({
                    'time': current_time,
                    'displacement': disp[1] if len(disp) > 1 else 0
                })

        # 获取最大响应
        if results:
            max_disp = max(r['displacement'] for r in results)
            max_time = max(results, key=lambda x: x['displacement'])['time']
        else:
            max_disp = 0
            max_time = 0

        ops.wipe()

        return {
            'status': 'success',
            'maxDisplacement': max_disp,
            'timeOfMaxDisp': max_time,
            'timeHistory': results
        }
