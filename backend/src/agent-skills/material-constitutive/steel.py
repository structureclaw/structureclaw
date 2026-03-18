"""
钢结构设计模块
基于 GB50017-2017
"""

import numpy as np
from typing import Dict, Any, Tuple
import logging

logger = logging.getLogger(__name__)


class SteelDesigner:
    """钢结构设计器"""

    # 钢材强度设计值 (N/mm²)
    STEEL_STRENGTH = {
        'Q235': {'f': 215, 'fv': 125, 'fb': 325},
        'Q345': {'f': 310, 'fv': 180, 'fb': 465},
        'Q390': {'f': 350, 'fv': 205, 'fb': 525},
        'Q420': {'f': 380, 'fv': 220, 'fb': 570},
        'Q460': {'f': 415, 'fv': 240, 'fb': 620},
    }

    # 焊缝强度设计值 (N/mm²)
    WELD_STRENGTH = {
        'Q235': {'fwf': 160, 'fwv': 160},
        'Q345': {'fwf': 200, 'fwv': 200},
        'Q390': {'fwf': 220, 'fwv': 220},
        'Q420': {'fwf': 240, 'fwv': 240},
    }

    def __init__(self):
        pass

    def design_beam(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        钢梁设计

        Args:
            params: 设计参数
                - M: 弯矩设计值 (kN·m)
                - V: 剪力设计值 (kN)
                - L: 跨度 (mm)
                - steelGrade: 钢材牌号
                - sectionType: 截面类型 (H, I, Box)
        """
        M = params.get('M', 0)  # kN·m
        V = params.get('V', 0)  # kN
        L = params.get('L', 6000)  # mm
        steel_grade = params.get('steelGrade', 'Q345')
        section_type = params.get('sectionType', 'H')

        logger.info(f"Designing steel beam: M={M}kN·m, V={V}kN, {steel_grade}")

        # 获取材料强度
        f = self.STEEL_STRENGTH.get(steel_grade, self.STEEL_STRENGTH['Q345'])['f']
        fv = self.STEEL_STRENGTH.get(steel_grade, self.STEEL_STRENGTH['Q345'])['fv']

        # 估算截面
        W_req = M * 1e6 / f  # 所需截面模量 mm³

        # 选择 H 型钢截面 (简化)
        section = self._select_h_section(W_req)

        # 验算
        stress_check = self._check_bending_stress(M, section, f)
        shear_check = self._check_shear_stress(V, section, fv)
        deflection_check = self._check_deflection(M, L, section)

        return {
            'status': 'success',
            'input': {
                'M': M,
                'V': V,
                'L': L,
                'steelGrade': steel_grade,
            },
            'selectedSection': section,
            'stressCheck': stress_check,
            'shearCheck': shear_check,
            'deflectionCheck': deflection_check,
            'recommendation': self._generate_recommendation(
                stress_check, shear_check, deflection_check
            )
        }

    def _select_h_section(self, W_req: float) -> Dict:
        """
        选择 H 型钢截面
        """
        # 热轧 H 型钢截面特性 (简化数据)
        sections = [
            {'name': 'HW200x200', 'Wx': 477e3, 'Ix': 4770e4, 'A': 6428, 'h': 200, 'b': 200, 'tw': 8, 'tf': 12},
            {'name': 'HW250x250', 'Wx': 958e3, 'Ix': 10800e4, 'A': 9218, 'h': 250, 'b': 250, 'tw': 9, 'tf': 14},
            {'name': 'HW300x300', 'Wx': 1680e3, 'Ix': 20500e4, 'A': 12040, 'h': 300, 'b': 300, 'tw': 10, 'tf': 15},
            {'name': 'HW350x350', 'Wx': 2740e3, 'Ix': 40300e4, 'A': 17390, 'h': 350, 'b': 350, 'tw': 12, 'tf': 19},
            {'name': 'HW400x400', 'Wx': 4150e3, 'Ix': 66400e4, 'A': 21870, 'h': 400, 'b': 400, 'tw': 13, 'tf': 21},
            {'name': 'HM500x300', 'Wx': 2690e3, 'Ix': 60900e4, 'A': 13180, 'h': 500, 'b': 300, 'tw': 11, 'tf': 15},
            {'name': 'HM600x300', 'Wx': 4020e3, 'Ix': 106000e4, 'A': 15920, 'h': 600, 'b': 300, 'tw': 12, 'tf': 17},
        ]

        for sec in sections:
            if sec['Wx'] >= W_req:
                return sec

        # 如果没有合适的，返回最大的
        return sections[-1]

    def _check_bending_stress(self, M: float, section: Dict, f: float) -> Dict:
        """
        弯曲应力验算
        """
        sigma = M * 1e6 / section['Wx']  # N/mm²
        ratio = sigma / f

        return {
            'stress': round(sigma, 1),
            'allowableStress': f,
            'ratio': round(ratio, 3),
            'status': 'OK' if ratio <= 1.0 else 'NG'
        }

    def _check_shear_stress(self, V: float, section: Dict, fv: float) -> Dict:
        """
        剪应力验算
        """
        # 简化计算：τ = V / (h * tw)
        tau = V * 1e3 / (section['h'] * section['tw'])
        ratio = tau / fv

        return {
            'shearStress': round(tau, 1),
            'allowableShearStress': fv,
            'ratio': round(ratio, 3),
            'status': 'OK' if ratio <= 1.0 else 'NG'
        }

    def _check_deflection(self, M: float, L: float, section: Dict) -> Dict:
        """
        挠度验算
        """
        E = 206000  # N/mm²
        I = section['Ix']

        # 简化：均布荷载简支梁 δ = 5qL⁴/(384EI)
        # 用等效荷载表示
        q_eq = 8 * M * 1e6 / (L ** 2)  # N/mm
        delta = 5 * q_eq * L ** 4 / (384 * E * I)

        # 允许挠度 L/250
        delta_limit = L / 250
        ratio = delta / delta_limit

        return {
            'deflection': round(delta, 2),
            'allowableDeflection': round(delta_limit, 1),
            'ratio': round(ratio, 3),
            'status': 'OK' if ratio <= 1.0 else 'NG'
        }

    def design_column(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        钢柱设计
        """
        N = params.get('N', 0)  # kN
        Mx = params.get('Mx', 0)  # kN·m
        My = params.get('My', 0)  # kN·m
        L0 = params.get('L0', 4000)  # mm
        steel_grade = params.get('steelGrade', 'Q345')

        f = self.STEEL_STRENGTH.get(steel_grade, self.STEEL_STRENGTH['Q345'])['f']

        # 估算所需面积
        A_req = N * 1e3 / (0.8 * f)  # 考虑稳定系数约 0.8

        # 选择截面
        section = self._select_h_column_section(A_req)

        # 长细比
        i = np.sqrt(section['Ix'] / section['A'])
        lambda_x = L0 / i

        # 稳定系数
        phi = self._get_phi(lambda_x, steel_grade)

        # 承载力验算
        N_capacity = phi * section['A'] * f / 1000  # kN

        return {
            'status': 'success',
            'input': {
                'N': N,
                'Mx': Mx,
                'My': My,
                'L0': L0,
                'steelGrade': steel_grade,
            },
            'selectedSection': section,
            'slendernessRatio': round(lambda_x, 1),
            'stabilityFactor': round(phi, 3),
            'axialCapacity': round(N_capacity, 1),
            'check': {
                'ratio': round(N / N_capacity, 3) if N_capacity > 0 else 0,
                'status': 'OK' if N < N_capacity else 'NG'
            }
        }

    def _select_h_column_section(self, A_req: float) -> Dict:
        """选择柱截面"""
        sections = [
            {'name': 'HW200x200', 'A': 6428, 'Ix': 4770e4},
            {'name': 'HW250x250', 'A': 9218, 'Ix': 10800e4},
            {'name': 'HW300x300', 'A': 12040, 'Ix': 20500e4},
            {'name': 'HW350x350', 'A': 17390, 'Ix': 40300e4},
            {'name': 'HW400x400', 'A': 21870, 'Ix': 66400e4},
        ]

        for sec in sections:
            if sec['A'] >= A_req:
                return sec

        return sections[-1]

    def _get_phi(self, lambda_x: float, steel_grade: str) -> float:
        """
        轴心受压稳定系数 (简化)
        """
        # b 类截面
        if steel_grade == 'Q235':
            fy = 235
        elif steel_grade == 'Q345':
            fy = 345
        else:
            fy = 390

        # 正则化长细比
        lambda_n = lambda_x / (np.pi * np.sqrt(206000 / fy))

        if lambda_n <= 0.215:
            phi = 1 - 0.65 * lambda_n ** 2
        else:
            phi = 1 / (2 * lambda_n ** 2) * (
                0.965 + 0.3 * lambda_n + lambda_n ** 2 -
                np.sqrt((0.965 + 0.3 * lambda_n + lambda_n ** 2) ** 2 - 4 * lambda_n ** 2)
            )

        return phi

    def _generate_recommendation(self, stress: Dict, shear: Dict, deflection: Dict) -> str:
        """生成设计建议"""
        rec = []

        if stress['status'] == 'OK':
            rec.append(f"正应力验算通过 (σ/stress['allowableStress'] = {stress['ratio']:.2f})")
        else:
            rec.append(f"正应力超限，需增大截面")

        if shear['status'] == 'OK':
            rec.append(f"剪应力验算通过")
        else:
            rec.append(f"剪应力超限，需增加腹板厚度")

        if deflection['status'] == 'OK':
            rec.append(f"挠度验算通过")
        else:
            rec.append(f"挠度超限，需增大截面刚度")

        return '；'.join(rec)
