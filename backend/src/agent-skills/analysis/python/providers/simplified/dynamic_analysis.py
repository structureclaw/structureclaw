import numpy as np
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)


class SimplifiedDynamicAnalyzer:
    def __init__(self, model):
        self.model = model

    def run(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        analysis_type = parameters.get('analysisType', 'modal')

        if analysis_type == 'modal':
            num_modes = parameters.get('numModes', 10)
            logger.info(f"Running modal analysis for {num_modes} modes")
            return build_simplified_modal_result(self.model, num_modes)
        if analysis_type in {'timeHistory', 'time-history'}:
            return {
                'status': 'error',
                'message': 'Time history analysis is not supported by the simplified engine'
            }
        return {
            'status': 'error',
            'message': f'Unknown analysis type: {analysis_type}'
        }


def build_simplified_modal_result(model, num_modes: int) -> Dict[str, Any]:
    n_stories = len(set(n.z for n in model.nodes)) - 1
    if n_stories <= 0:
        return {
            'status': 'error',
            'message': 'Modal analysis requires at least one story level above the base'
        }

    modes = []
    for i in range(num_modes):
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
