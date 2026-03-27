from __future__ import annotations

from typing import Any, Dict

from opensees_seismic_analysis import OpenSeesSeismicExecutor
from opensees_seismic_simplified_seismic_analysis import (
    SimplifiedSeismicAnalyzer,
    build_simplified_response_spectrum_result,
)
from structure_protocol.structure_model_v1 import StructureModelV1


class OpenSeesModelAdapter:
    def __init__(self, model):
        self.model = model
        self._ops_node_tags = {str(node.id): index + 1 for index, node in enumerate(model.nodes)}
        self._ops_element_tags = {str(elem.id): index + 1 for index, elem in enumerate(model.elements)}
        self._ops_material_tags = {str(mat.id): index + 1 for index, mat in enumerate(model.materials)}

    def _ops_node_tag(self, node_id: Any) -> int:
        return self._ops_node_tags[str(node_id)]

    def _ops_element_tag(self, element_id: Any) -> int:
        return self._ops_element_tags[str(element_id)]

    def _ops_material_tag(self, material_id: Any) -> int:
        return self._ops_material_tags[str(material_id)]


def run_analysis(model: StructureModelV1, parameters: Dict[str, Any]) -> Dict[str, Any]:
    method = parameters.get('method', 'response_spectrum')
    helper = OpenSeesModelAdapter(model)
    executor = OpenSeesSeismicExecutor(helper)

    if method == 'response_spectrum':
        analyzer = SimplifiedSeismicAnalyzer(model)
        try:
            import openseespy.opensees as ops
            modes = executor.get_modes(ops)
        except Exception:
            return {
                'status': 'error',
                'message': 'Response spectrum analysis requires OpenSeesPy for the requested engine',
            }
        result = build_simplified_response_spectrum_result(analyzer, parameters)
        result['modalResponses'] = [
            {
                **item,
                'period': modes[idx]['period'] if idx < len(modes) else item['period'],
            }
            for idx, item in enumerate(result['modalResponses'])
        ]
        return result

    if method == 'pushover':
        try:
            import openseespy.opensees as ops
            return executor.pushover_analysis(parameters.get('targetDisplacement', 0.5), parameters.get('controlNode'), ops)
        except Exception:
            return {
                'status': 'error',
                'message': 'Pushover analysis requires OpenSeesPy for the requested engine',
            }

    return {
        'status': 'error',
        'message': f"Unknown seismic analysis method: {method}",
    }
