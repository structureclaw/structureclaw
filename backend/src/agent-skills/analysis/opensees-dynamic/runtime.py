from __future__ import annotations

from typing import Any, Dict

from opensees_dynamic_analysis import OpenSeesDynamicExecutor
from opensees_shared.tags import OpenSeesTagMapper
from structure_protocol.structure_model_v1 import StructureModelV1


def run_analysis(model: StructureModelV1, parameters: Dict[str, Any]) -> Dict[str, Any]:
    analysis_type = parameters.get("analysisType", "modal")
    helper = OpenSeesTagMapper(model)
    executor = OpenSeesDynamicExecutor(helper)

    try:
        import openseespy.opensees as ops
    except Exception as error:
        from contracts import EngineNotAvailableError
        raise EngineNotAvailableError("builtin-opensees", f"OpenSeesPy is not available: {error}") from error

    if analysis_type == "modal":
        num_modes = parameters.get("numModes", 10)
        try:
            return executor.modal_analysis(num_modes, ops)
        except Exception as error:
            raise RuntimeError(f"Modal analysis failed: {error}") from error

    if analysis_type == "time_history":
        try:
            return executor.time_history_analysis(
                parameters.get("timeStep", 0.02),
                parameters.get("duration", 20.0),
                parameters.get("dampingRatio", 0.05),
                parameters.get("groundMotion", []),
                ops,
            )
        except Exception as error:
            raise RuntimeError(f"Time history analysis failed: {error}") from error

    raise RuntimeError(f"Unknown analysis type: {analysis_type}")
