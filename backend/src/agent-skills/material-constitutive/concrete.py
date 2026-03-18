"""
混凝土结构设计模块
基于 GB50010-2010
"""

import numpy as np
from typing import Dict, Any, Tuple
import logging

logger = logging.getLogger(__name__)


class ConcreteDesigner:
    """混凝土结构设计器"""

    # 混凝土强度设计值 (N/mm²)
    CONCRETE_STRENGTH = {
        'C15': {'fc': 7.2, 'ft': 0.91},
        'C20': {'fc': 9.6, 'ft': 1.10},
        'C25': {'fc': 11.9, 'ft': 1.27},
        'C30': {'fc': 14.3, 'ft': 1.43},
        'C35': {'fc': 16.7, 'ft': 1.57},
        'C40': {'fc': 19.1, 'ft': 1.71},
        'C45': {'fc': 21.1, 'ft': 1.80},
        'C50': {'fc': 23.1, 'ft': 1.89},
        'C55': {'fc': 25.3, 'ft': 1.96},
        'C60': {'fc': 27.5, 'ft': 2.04},
        'C65': {'fc': 29.7, 'ft': 2.09},
        'C70': {'fc': 31.8, 'ft': 2.14},
        'C75': {'fc': 33.8, 'ft': 2.18},
        'C80': {'fc': 35.9, 'ft': 2.22},
    }

    # 钢筋强度设计值 (N/mm²)
    STEEL_STRENGTH = {
        'HPB300': {'fy': 270, 'fyv': 270},
        'HRB335': {'fy': 300, 'fyv': 300},
        'HRB400': {'fy': 360, 'fyv': 360},
        'HRB500': {'fy': 435, 'fyv': 435},
    }

    def __init__(self):
        pass

    def design_beam(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        梁截面设计

        Args:
            params: 设计参数
                - M: 弯矩设计值 (kN·m)
                - V: 剪力设计值 (kN)
                - b: 截面宽度 (mm)
                - h: 截面高度 (mm)
                - concreteGrade: 混凝土强度等级
                - steelGrade: 钢筋级别
                - cover: 保护层厚度 (mm)

        Returns:
            设计结果
        """
        M = params.get('M', 0)  # kN·m
        V = params.get('V', 0)  # kN
        b = params.get('b', 250)  # mm
        h = params.get('h', 500)  # mm
        concrete_grade = params.get('concreteGrade', 'C30')
        steel_grade = params.get('steelGrade', 'HRB400')
        cover = params.get('cover', 25)  # mm

        logger.info(f"Designing beam: M={M}kN·m, V={V}kN, {b}x{h}mm, {concrete_grade}")

        # 获取材料强度
        fc = self.CONCRETE_STRENGTH.get(concrete_grade, self.CONCRETE_STRENGTH['C30'])['fc']
        ft = self.CONCRETE_STRENGTH.get(concrete_grade, self.CONCRETE_STRENGTH['C30'])['ft']
        fy = self.STEEL_STRENGTH.get(steel_grade, self.STEEL_STRENGTH['HRB400'])['fy']

        # 有效高度
        h0 = h - cover - 20  # 假设钢筋直径20mm

        # 1. 正截面受弯承载力计算
        As_result = self._design_flexure(M, b, h0, fc, fy)

        # 2. 斜截面受剪承载力计算
        Asv_result = self._design_shear(V, b, h0, fc, ft, fy)

        # 3. 验算最小配筋率
        min_As = max(0.002 * b * h, 0.45 * ft / fy * b * h)

        return {
            'status': 'success',
            'input': {
                'M': M,
                'V': V,
                'section': f'{b}x{h}mm',
                'concreteGrade': concrete_grade,
                'steelGrade': steel_grade,
            },
            'flexureDesign': As_result,
            'shearDesign': Asv_result,
            'minimumSteel': {
                'minArea': round(min_As, 0),
                'note': f'最小配筋率 {max(0.2, 0.45*ft/fy*100):.2f}%'
            },
            'recommendation': self._generate_beam_recommendation(As_result, Asv_result, b)
        }

    def _design_flexure(self, M: float, b: float, h0: float, fc: float, fy: float) -> Dict:
        """
        正截面受弯设计
        """
        # M 转换为 N·mm
        M_Nmm = M * 1e6

        # 计算相对界限受压区高度
        # 对于 HRB400, ξb ≈ 0.518
        xi_b = 0.518

        # 单筋截面计算
        # αs = M / (fc * b * h0²)
        alpha_s = M_Nmm / (fc * b * h0 ** 2)

        # 检查是否超筋
        alpha_sb = xi_b * (1 - 0.5 * xi_b)

        if alpha_s > alpha_sb:
            # 需要双筋或加大截面
            return {
                'status': 'needDoubleReinforcement',
                'alphaS': round(alpha_s, 4),
                'alphaSb': round(alpha_sb, 4),
                'message': '截面尺寸不足，需要采用双筋截面或加大截面',
                'suggestion': f'建议增大截面高度至 {h0 * (alpha_s/alpha_sb)**0.5:.0f}mm 以上'
            }

        # 计算相对受压区高度
        xi = 1 - np.sqrt(1 - 2 * alpha_s)

        # 计算受拉钢筋面积
        As = (fc * b * xi * h0) / fy

        # 计算配筋率
        rho = As / (b * h0) * 100

        return {
            'status': 'ok',
            'steelArea': round(As, 0),
            'reinforcementRatio': round(rho, 2),
            'xi': round(xi, 4),
            'alphaS': round(alpha_s, 4),
            'bars': self._select_bars(As, 'bottom')
        }

    def _design_shear(self, V: float, b: float, h0: float, fc: float, ft: float, fy: float) -> Dict:
        """
        斜截面受剪设计
        """
        # V 转换为 N
        V_N = V * 1e3

        # 验算截面尺寸
        V_max = 0.25 * fc * b * h0

        if V_N > V_max:
            return {
                'status': 'sectionTooSmall',
                'Vmax': round(V_max / 1e3, 1),
                'message': f'截面尺寸不足，最大受剪承载力 {V_max/1e3:.1f} kN'
            }

        # 验算是否需要计算配箍
        V_c = 0.7 * ft * b * h0

        if V_N <= V_c:
            # 按构造配箍
            return {
                'status': 'ok',
                'Vc': round(V_c / 1e3, 1),
                'needCalculation': False,
                'message': '按构造配箍即可',
                'stirrupSuggestion': '箍筋 φ8@200'
            }

        # 计算配箍
        # V ≤ Vc + Vsv
        # Vsv = fyv * Asv/s * h0
        fyv = fy  # 箍筋与纵筋同级别
        Asv_over_s = (V_N - V_c) / (fyv * h0)

        # 选择箍筋
        # 双肢箍 φ8
        Asv1 = 50.3  # φ8 单肢面积
        n = 2  # 双肢
        Asv = n * Asv1
        s = Asv / Asv_over_s

        # 最大间距限制
        s_max = min(h0 / 2, 250)
        s = min(s, s_max)
        s = max(s, 100)  # 最小间距

        # 验算最小配箍率
        rho_sv_min = 0.24 * ft / fyv
        rho_sv = Asv / (b * s)

        return {
            'status': 'ok',
            'Vc': round(V_c / 1e3, 1),
            'needCalculation': True,
            'AsvOverS': round(Asv_over_s, 2),
            'stirrupSuggestion': f'箍筋 φ8@{int(s/25)*25}mm',
            'spacing': int(s / 25) * 25,
            'shearReinforcementRatio': round(rho_sv * 100, 3),
            'minimumShearReinforcementRatio': round(rho_sv_min * 100, 3)
        }

    def design_column(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        柱截面设计

        Args:
            params: 设计参数
                - N: 轴力设计值 (kN)
                - Mx: 绕x轴弯矩 (kN·m)
                - My: 绕y轴弯矩 (kN·m)
                - b: 截面宽度 (mm)
                - h: 截面高度 (mm)
                - L0: 计算长度 (mm)
                - concreteGrade: 混凝土强度等级
                - steelGrade: 钢筋级别

        Returns:
            设计结果
        """
        N = params.get('N', 0)  # kN
        Mx = params.get('Mx', 0)  # kN·m
        My = params.get('My', 0)  # kN·m
        b = params.get('b', 400)  # mm
        h = params.get('h', 400)  # mm
        L0 = params.get('L0', 4000)  # mm
        concrete_grade = params.get('concreteGrade', 'C30')
        steel_grade = params.get('steelGrade', 'HRB400')

        logger.info(f"Designing column: N={N}kN, Mx={Mx}kN·m, {b}x{h}mm")

        # 获取材料强度
        fc = self.CONCRETE_STRENGTH.get(concrete_grade, self.CONCRETE_STRENGTH['C30'])['fc']
        fy = self.STEEL_STRENGTH.get(steel_grade, self.STEEL_STRENGTH['HRB400'])['fy']

        # 长细比
        i = min(b, h) / np.sqrt(12)
        l0_i = L0 / i

        # 稳定系数 (简化)
        phi = self._get_stability_factor(l0_i)

        # 轴心受压承载力
        N_capacity = phi * (fc * b * h + fy * 0.01 * b * h * 2) / 1000  # kN

        # 偏心受压验算
        e0 = max(Mx, My) * 1e6 / (N * 1e3) if N > 0 else 0  # mm

        return {
            'status': 'success',
            'input': {
                'N': N,
                'Mx': Mx,
                'My': My,
                'section': f'{b}x{h}mm',
                'effectiveLength': L0,
            },
            'slendernessRatio': round(l0_i, 1),
            'stabilityFactor': round(phi, 3),
            'axialCapacity': round(N_capacity, 1),
            'eccentricity': round(e0, 1),
            'check': {
                'ratio': round(N / N_capacity, 3) if N_capacity > 0 else 0,
                'status': 'OK' if N < N_capacity else 'NG'
            },
            'recommendation': self._generate_column_recommendation(N, N_capacity, b, h)
        }

    def _get_stability_factor(self, l0_i: float) -> float:
        """
        获取稳定系数 φ
        """
        # 根据 GB50010 表 6.2.15
        if l0_i <= 8:
            return 1.0
        elif l0_i <= 10:
            return 0.98
        elif l0_i <= 12:
            return 0.95
        elif l0_i <= 14:
            return 0.92
        elif l0_i <= 16:
            return 0.87
        elif l0_i <= 18:
            return 0.81
        elif l0_i <= 20:
            return 0.75
        elif l0_i <= 22:
            return 0.70
        elif l0_i <= 24:
            return 0.65
        elif l0_i <= 26:
            return 0.60
        elif l0_i <= 28:
            return 0.56
        elif l0_i <= 30:
            return 0.52
        else:
            return 0.48

    def _select_bars(self, As: float, position: str) -> Dict:
        """
        选择钢筋
        """
        bar_areas = {
            12: 113,
            14: 154,
            16: 201,
            18: 254,
            20: 314,
            22: 380,
            25: 491,
            28: 616,
            32: 804
        }

        # 选择合适的钢筋直径和根数
        for d, area in sorted(bar_areas.items()):
            n = int(np.ceil(As / area))
            if n <= 8 and n * area >= As:
                return {
                    'diameter': d,
                    'number': n,
                    'totalArea': n * area,
                    'description': f'{n}根 HRB400 直径{d}mm (As={n*area}mm²)'
                }

        # 如果单排不够
        return {
            'diameter': 25,
            'number': int(np.ceil(As / 491)),
            'totalArea': int(np.ceil(As / 491)) * 491,
            'description': f'需{int(np.ceil(As/491))}根 HRB400 直径25mm，建议双排布置'
        }

    def _generate_beam_recommendation(self, flexure: Dict, shear: Dict, b: int) -> str:
        """生成梁设计建议"""
        rec = []

        if flexure.get('status') == 'ok':
            rec.append(f"纵向受拉钢筋：{flexure['bars']['description']}")
        else:
            rec.append(flexure.get('message', ''))

        if shear.get('status') == 'ok':
            rec.append(f"箍筋：{shear.get('stirrupSuggestion', '按构造配箍')}")

        return '；'.join(rec)

    def _generate_column_recommendation(self, N: float, N_capacity: float, b: int, h: int) -> str:
        """生成柱设计建议"""
        ratio = N / N_capacity if N_capacity > 0 else 0

        if ratio < 0.7:
            return f"承载力富余 {round((1-ratio)*100, 1)}%，配筋满足要求"
        elif ratio < 0.9:
            return f"承载力利用系数 {round(ratio*100, 1)}%，建议适当增加配筋"
        elif ratio < 1.0:
            return f"承载力接近极限，建议加大截面或提高材料强度"
        else:
            return f"承载力不足，需加大截面至 {int(b*np.sqrt(ratio))}x{int(h*np.sqrt(ratio))}mm"
