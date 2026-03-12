"""
地震分析模块
反应谱分析、Pushover 分析
"""

import numpy as np
from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)


class SeismicAnalyzer:
    """地震分析器"""

    def __init__(self, model, engine_mode: str = "auto"):
        self.model = model
        self.engine_mode = engine_mode
        self.nodes = {n.id: n for n in model.nodes}
        self.elements = {e.id: e for e in model.elements}
        self.materials = {m.id: m for m in model.materials}

    def run(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行地震分析

        Args:
            parameters: 分析参数
                - method: 'response_spectrum' 或 'pushover'
                - seismicZone: 抗震设防烈度
                - siteClass: 场地类别
                - dampingRatio: 阻尼比
        """
        method = parameters.get('method', 'response_spectrum')

        if method == 'response_spectrum':
            return self._response_spectrum_analysis(parameters)
        elif method == 'pushover':
            return self._pushover_analysis(parameters)
        else:
            return {
                'status': 'error',
                'message': f'Unknown seismic analysis method: {method}'
            }

    def _response_spectrum_analysis(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        反应谱分析
        """
        seismic_zone = parameters.get('seismicZone', 8)
        site_class = parameters.get('siteClass', 'II')
        damping_ratio = parameters.get('dampingRatio', 0.05)

        logger.info(f"Running response spectrum analysis: zone={seismic_zone}, site={site_class}")

        # 根据中国规范确定地震影响系数
        alpha_max = self._get_alpha_max(seismic_zone)
        Tg = self._get_characteristic_period(seismic_zone, site_class)

        # 简化的模态分析获取周期
        if self.engine_mode == 'simplified':
            modes = self._get_modes_simplified()
        else:
            try:
                import openseespy.opensees as ops
                modes = self._get_modes_opensees(ops)
            except Exception:
                if self.engine_mode == 'opensees':
                    return {
                        'status': 'error',
                        'message': 'Response spectrum analysis requires OpenSeesPy for the requested engine'
                    }
                modes = self._get_modes_simplified()

        # 对每个模态计算地震作用
        modal_responses = []
        total_mass = 1000  # 简化

        for mode in modes:
            T = mode['period']

            # 计算地震影响系数
            alpha = self._calculate_alpha(T, alpha_max, Tg, damping_ratio)

            # 模态参与系数（简化）
            gamma = 1.0 / (mode['modeNumber'] ** 0.5)

            # 模态地震力
            Fi = alpha * gamma * total_mass

            modal_responses.append({
                'modeNumber': mode['modeNumber'],
                'period': T,
                'alpha': alpha,
                'participationFactor': gamma,
                'seismicForce': Fi
            })

        # SRSS 组合
        total_force = np.sqrt(sum(r['seismicForce']**2 for r in modal_responses))

        # 生成设计反应谱
        spectrum = self._generate_design_spectrum(alpha_max, Tg, damping_ratio)

        return {
            'status': 'success',
            'seismicZone': seismic_zone,
            'siteClass': site_class,
            'alphaMax': alpha_max,
            'Tg': Tg,
            'modalResponses': modal_responses,
            'totalSeismicForce': total_force,
            'designSpectrum': spectrum
        }

    def _pushover_analysis(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        Pushover 分析（简化版）
        """
        target_displacement = parameters.get('targetDisplacement', 0.5)  # 目标位移 (m)
        control_node = parameters.get('controlNode')

        logger.info(f"Running pushover analysis: target={target_displacement}m")

        if self.engine_mode == 'simplified':
            return self._pushover_simplified(target_displacement)
        try:
            import openseespy.opensees as ops
            return self._pushover_opensees(target_displacement, control_node, ops)
        except Exception:
            if self.engine_mode == 'opensees':
                return {
                    'status': 'error',
                    'message': 'Pushover analysis requires OpenSeesPy for the requested engine'
                }
            return self._pushover_simplified(target_displacement)

    def _pushover_opensees(self, target_disp: float, control_node: str, ops) -> Dict[str, Any]:
        """
        使用 OpenSeesPy 执行 Pushover 分析
        """
        # 建立非线性模型
        ops.wipe()
        ops.model('basic', '-ndm', 3, '-ndf', 6)

        # 定义节点
        for node in self.model.nodes:
            ops.node(int(node.id), node.x, node.y, node.z)
            if node.restraints:
                ops.fix(int(node.id), *node.restraints)

        # 定义非线性材料
        for mat in self.model.materials:
            # Concrete01 - 混凝土
            ops.uniaxialMaterial(
                'Concrete01',
                int(mat.id),
                mat.fy * 0.002 if mat.fy else 30,  # fpc
                0.002,  # epsc0
                mat.fy * 0.004 if mat.fy else 20,  # fpcu
                0.006   # epscu
            )

        # 定义单元
        for elem in self.model.elements:
            if elem.type == 'beam':
                ops.element(
                    'elasticBeamColumn',
                    int(elem.id),
                    int(elem.nodes[0]),
                    int(elem.nodes[1]),
                    0.01, 200000000, 0.0001, 0.0001, 79000000, 0.00001
                )

        # 定义重力荷载
        ops.timeSeries('Linear', 1)
        ops.pattern('Plain', 1, 1)
        for node in self.model.nodes:
            if not node.restraints or not all(node.restraints):
                ops.load(int(node.id), 0, -100, 0, 0, 0, 0)

        # 重力分析
        ops.system('BandSPD')
        ops.numberer('Plain')
        ops.constraints('Plain')
        ops.integrator('LoadControl', 0.1)
        ops.algorithm('Newton')
        ops.analysis('Static')
        ops.analyze(10)

        # 保持重力荷载
        ops.loadConst('-time', 0.0)

        # Pushover 荷载模式（倒三角形）
        ops.timeSeries('Linear', 2)
        ops.pattern('Plain', 2, 2)

        heights = sorted(set(n.z for n in self.model.nodes))
        max_height = max(heights) if heights else 1

        for node in self.model.nodes:
            if not node.restraints or not all(node.restraints):
                coeff = node.z / max_height
                ops.load(int(node.id), coeff * 10, 0, 0, 0, 0, 0)

        # 位移控制分析
        if not control_node:
            for node in self.model.nodes:
                if not node.restraints or not all(node.restraints):
                    control_node = node.id
                    break

        ops.integrator('DisplacementControl', int(control_node), 1, 0.001)
        ops.analysis('Static')

        # 分步执行
        results = []
        num_steps = int(target_disp / 0.001)
        base_shear = []

        for i in range(num_steps):
            ok = ops.analyze(1)
            if ok != 0:
                break

            # 记录基底剪力和顶点位移
            reaction = ops.nodeReaction(1, 1)  # 假设节点1是基底
            roof_disp = ops.nodeDisp(int(control_node), 1)

            results.append({
                'step': i,
                'baseShear': reaction,
                'roofDisplacement': roof_disp
            })

        ops.wipe()

        return {
            'status': 'success',
            'pushoverCurve': results,
            'targetDisplacement': target_disp
        }

    def _pushover_simplified(self, target_disp: float) -> Dict[str, Any]:
        """
        简化 Pushover 分析
        """
        # 生成简化的能力曲线
        results = []
        V_max = 1000  # 假设最大基底剪力 (kN)
        delta_y = 0.1  # 屈服位移 (m)

        for i in range(int(target_disp / 0.01)):
            delta = i * 0.01

            # 双线性模型
            if delta < delta_y:
                V = V_max * delta / delta_y
            else:
                V = V_max * (1 + 0.1 * (delta - delta_y) / delta_y)

            results.append({
                'step': i,
                'baseShear': V,
                'roofDisplacement': delta
            })

        return {
            'status': 'success',
            'pushoverCurve': results,
            'note': 'Simplified pushover analysis'
        }

    def _get_alpha_max(self, seismic_zone: int) -> float:
        """获取地震影响系数最大值"""
        # 根据 GB50011
        alpha_map = {
            6: 0.04,
            7: 0.08,
            8: 0.16,
            9: 0.32
        }
        return alpha_map.get(seismic_zone, 0.16)

    def _get_characteristic_period(self, seismic_zone: int, site_class: str) -> float:
        """获取特征周期"""
        # 根据 GB50011
        tg_map = {
            'I': 0.25,
            'I0': 0.20,
            'II': 0.35,
            'III': 0.45,
            'IV': 0.65
        }
        return tg_map.get(site_class, 0.35)

    def _calculate_alpha(self, T: float, alpha_max: float, Tg: float, damping: float) -> float:
        """
        计算地震影响系数
        根据 GB50011-2010 反应谱
        """
        # 阻尼修正系数
        gamma = 0.9 + (0.05 - damping) / (0.3 + 6 * damping)
        eta1 = 0.02 + (0.05 - damping) / (4 + 32 * damping)
        eta2 = 1 + (0.05 - damping) / (0.08 + 1.6 * damping)

        Tg = Tg
        T0 = 0.1

        if T < T0:
            alpha = alpha_max * (eta2 + (T / T0) * (1 - eta2))
        elif T < Tg:
            alpha = alpha_max * eta2
        elif T < 5 * Tg:
            alpha = alpha_max * (Tg / T) ** gamma * eta2
        else:
            alpha = alpha_max * (Tg / T) ** gamma * eta2 - eta1 * (T - 5 * Tg)

        return max(alpha, 0.2 * alpha_max)

    def _generate_design_spectrum(self, alpha_max: float, Tg: float, damping: float) -> List[Dict]:
        """生成设计反应谱"""
        spectrum = []
        for T in np.arange(0, 6.0, 0.02):
            alpha = self._calculate_alpha(T, alpha_max, Tg, damping)
            spectrum.append({
                'period': round(T, 2),
                'alpha': round(alpha, 4)
            })
        return spectrum

    def _get_modes_opensees(self, ops) -> List[Dict]:
        """使用 OpenSees 获取模态"""
        # 简化：返回3个模态
        return [
            {'modeNumber': 1, 'period': 0.8},
            {'modeNumber': 2, 'period': 0.3},
            {'modeNumber': 3, 'period': 0.18}
        ]

    def _get_modes_simplified(self) -> List[Dict]:
        """简化模态估算"""
        return [
            {'modeNumber': 1, 'period': 0.8},
            {'modeNumber': 2, 'period': 0.3},
            {'modeNumber': 3, 'period': 0.18}
        ]
