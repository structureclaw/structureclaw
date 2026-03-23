from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException

from providers.opensees.dynamic_analysis import OpenSeesDynamicExecutor
from providers.opensees.seismic_analysis import OpenSeesSeismicExecutor
from providers.opensees.static_analysis import OpenSeesStaticExecutor
from providers.simplified.static_analysis import StaticAnalyzer
from providers.simplified.dynamic_analysis import build_simplified_modal_result
from providers.simplified.seismic_analysis import (
    SimplifiedSeismicAnalyzer,
    build_simplified_pushover_result,
    build_simplified_response_spectrum_result,
)
from structure_protocol.structure_model_v1 import StructureModelV1


def run_analysis(
    analysis_type: str,
    model: StructureModelV1,
    parameters: Dict[str, Any],
) -> Dict[str, Any]:
    if analysis_type == "static":
        return run_static_analysis(model, parameters)
    if analysis_type == "dynamic":
        return run_dynamic_analysis(model, parameters)
    if analysis_type == "seismic":
        return run_seismic_analysis(model, parameters)
    if analysis_type == "nonlinear":
        return run_nonlinear_analysis()
    raise HTTPException(
        status_code=400,
        detail={
            "errorCode": "INVALID_ANALYSIS_TYPE",
            "message": f"Unknown analysis type: {analysis_type}",
        },
    )


class OpenSeesStaticAnalyzer(StaticAnalyzer):
    def __init__(self, model):
        super().__init__(model)
        self._ops_node_tags = {str(node.id): index + 1 for index, node in enumerate(model.nodes)}
        self._ops_element_tags = {str(elem.id): index + 1 for index, elem in enumerate(model.elements)}
        self._ops_material_tags = {str(mat.id): index + 1 for index, mat in enumerate(model.materials)}

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

    def _select_opensees_planar_frame_mode(self, parameters: Dict[str, Any]):
        return self._select_planar_frame_mode(parameters)


def run_static_analysis(model: StructureModelV1, parameters: Dict[str, Any]) -> Dict[str, Any]:
    analyzer = OpenSeesStaticAnalyzer(model)
    executor = OpenSeesStaticExecutor(analyzer)
    try:
        import openseespy.opensees as ops  # noqa: F401
    except Exception as error:
        raise RuntimeError("OpenSeesPy is not available for the requested engine") from error
    try:
        return executor.run(parameters)
    except Exception as error:
        raise RuntimeError(f"OpenSees analysis failed: {error}") from error


def run_nonlinear_analysis() -> Dict[str, Any]:
    raise NotImplementedError(
        "Nonlinear OpenSees analysis is not yet implemented; "
        "node/element definitions and nonlinear material setup are required"
    )


def run_dynamic_analysis(model: StructureModelV1, parameters: Dict[str, Any]) -> Dict[str, Any]:
    analysis_type = parameters.get('analysisType', 'modal')
    helper = OpenSeesStaticAnalyzer(model)
    executor = OpenSeesDynamicExecutor(helper)

    if analysis_type == 'modal':
        num_modes = parameters.get('numModes', 10)
        try:
            import openseespy.opensees as ops
            return executor.modal_analysis(num_modes, ops)
        except Exception:
            return {
                'status': 'error',
                'message': 'Modal analysis requires OpenSeesPy for the requested engine'
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
                'message': 'Time history analysis requires OpenSeesPy'
            }
    return {
        'status': 'error',
        'message': f"Unknown analysis type: {analysis_type}"
    }


def run_seismic_analysis(model: StructureModelV1, parameters: Dict[str, Any]) -> Dict[str, Any]:
    method = parameters.get('method', 'response_spectrum')
    helper = OpenSeesStaticAnalyzer(model)
    executor = OpenSeesSeismicExecutor(helper)

    if method == 'response_spectrum':
        analyzer = SimplifiedSeismicAnalyzer(model)
        try:
            import openseespy.opensees as ops
            modes = executor.get_modes(ops)
        except Exception:
            return {
                'status': 'error',
                'message': 'Response spectrum analysis requires OpenSeesPy for the requested engine'
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
                'message': 'Pushover analysis requires OpenSeesPy for the requested engine'
            }

    return {
        'status': 'error',
        'message': f"Unknown seismic analysis method: {method}"
    }
