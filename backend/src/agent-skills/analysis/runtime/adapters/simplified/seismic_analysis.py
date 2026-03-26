import numpy as np
from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)


class SimplifiedSeismicAnalyzer:
    def __init__(self, model):
        self.model = model

    def run(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        method = parameters.get('method', 'response_spectrum')

        if method == 'response_spectrum':
            return build_simplified_response_spectrum_result(self, parameters)
        if method == 'pushover':
            return build_simplified_pushover_result(parameters.get('targetDisplacement', 0.5))
        return {
            'status': 'error',
            'message': f'Unknown seismic analysis method: {method}'
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

    def _get_modes_simplified(self) -> List[Dict]:
        """简化模态估算"""
        return [
            {'modeNumber': 1, 'period': 0.8},
            {'modeNumber': 2, 'period': 0.3},
            {'modeNumber': 3, 'period': 0.18}
        ]


def build_simplified_response_spectrum_result(analyzer: SimplifiedSeismicAnalyzer, parameters: Dict[str, Any]) -> Dict[str, Any]:
    seismic_zone = parameters.get('seismicZone', 8)
    site_class = parameters.get('siteClass', 'II')
    damping_ratio = parameters.get('dampingRatio', 0.05)

    logger.info(f"Running response spectrum analysis: zone={seismic_zone}, site={site_class}")

    alpha_max = analyzer._get_alpha_max(seismic_zone)
    tg = analyzer._get_characteristic_period(seismic_zone, site_class)
    modes = analyzer._get_modes_simplified()

    modal_responses = []
    total_mass = 1000

    for mode in modes:
        period = mode['period']
        alpha = analyzer._calculate_alpha(period, alpha_max, tg, damping_ratio)
        gamma = 1.0 / (mode['modeNumber'] ** 0.5)
        seismic_force = alpha * gamma * total_mass

        modal_responses.append({
            'modeNumber': mode['modeNumber'],
            'period': period,
            'alpha': alpha,
            'participationFactor': gamma,
            'seismicForce': seismic_force
        })

    total_force = np.sqrt(sum(r['seismicForce']**2 for r in modal_responses))
    spectrum = analyzer._generate_design_spectrum(alpha_max, tg, damping_ratio)

    return {
        'status': 'success',
        'seismicZone': seismic_zone,
        'siteClass': site_class,
        'alphaMax': alpha_max,
        'Tg': tg,
        'modalResponses': modal_responses,
        'totalSeismicForce': total_force,
        'designSpectrum': spectrum
    }


def build_simplified_pushover_result(target_disp: float) -> Dict[str, Any]:
    results = []
    max_base_shear = 1000
    yield_displacement = 0.1

    for i in range(int(target_disp / 0.01)):
        delta = i * 0.01
        if delta < yield_displacement:
            base_shear = max_base_shear * delta / yield_displacement
        else:
            base_shear = max_base_shear * (1 + 0.1 * (delta - yield_displacement) / yield_displacement)

        results.append({
            'step': i,
            'baseShear': base_shear,
            'roofDisplacement': delta
        })

    return {
        'status': 'success',
        'pushoverCurve': results,
        'note': 'Simplified pushover analysis'
    }
