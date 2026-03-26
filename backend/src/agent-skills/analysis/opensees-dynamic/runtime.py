from __future__ import annotations

from typing import Any, Dict

from opensees_dynamic_analysis import OpenSeesDynamicExecutor
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
    analysis_type = parameters.get('analysisType', 'modal')
    helper = OpenSeesModelAdapter(model)
    executor = OpenSeesDynamicExecutor(helper)

    if analysis_type == 'modal':
        num_modes = parameters.get('numModes', 10)
        try:
            import openseespy.opensees as ops
            return executor.modal_analysis(num_modes, ops)
        except Exception:
            return {
                'status': 'error',
                'message': 'Modal analysis requires OpenSeesPy for the requested engine',
            }
    if analysis_type == 'time_history':
        try:
            import openseespy.opensees as ops
            return executor.time_history_analysis(
                parameters.get('timeStep', 0.02),
                parameters.get('duration', 20.0),
                parameters.get('dampingRatio', 0.05),
                parameters.get('groundMotion', []),
                ops,
            )
        except Exception:
            return {
                'status': 'error',
                'message': 'Time history analysis requires OpenSeesPy',
            }
    return {
        'status': 'error',
        'message': f"Unknown analysis type: {analysis_type}",
    }
