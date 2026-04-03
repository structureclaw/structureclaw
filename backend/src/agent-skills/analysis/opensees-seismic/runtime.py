from __future__ import annotations

from typing import Any, Dict

from opensees_seismic_analysis import OpenSeesSeismicExecutor
from opensees_seismic_simplified_seismic_analysis import (
    SimplifiedSeismicAnalyzer,
    build_simplified_response_spectrum_result,
)
from opensees_shared.tags import OpenSeesTagMapper
from structure_protocol.structure_model_v1 import StructureModelV1


def run_analysis(model: StructureModelV1, parameters: Dict[str, Any]) -> Dict[str, Any]:
    method = parameters.get("method", "response_spectrum")
    helper = OpenSeesTagMapper(model)
    executor = OpenSeesSeismicExecutor(helper)

    if method == "response_spectrum":
        analyzer = SimplifiedSeismicAnalyzer(model)
        try:
            import openseespy.opensees as ops  # noqa: F401
        except ImportError as error:
            raise RuntimeError(
                "Response spectrum analysis requires OpenSeesPy"
            ) from error
        try:
            modes = executor.get_modes(ops)
        except Exception as error:
            raise RuntimeError(
                f"Failed to compute modal data: {error}"
            ) from error

        result = build_simplified_response_spectrum_result(analyzer, parameters)
        result["modalResponses"] = [
            {
                **item,
                "period": modes[idx]["period"] if idx < len(modes) else item["period"],
            }
            for idx, item in enumerate(result["modalResponses"])
        ]
        return result

    if method == "pushover":
        try:
            import openseespy.opensees as ops  # noqa: F401
        except ImportError as error:
            raise RuntimeError(
                "Pushover analysis requires OpenSeesPy"
            ) from error
        try:
            return executor.pushover_analysis(
                parameters.get("targetDisplacement", 0.5),
                parameters.get("controlNode"),
                ops,
            )
        except Exception as error:
            raise RuntimeError(f"Pushover analysis failed: {error}") from error

    raise RuntimeError(f"Unknown seismic analysis method: {method}")
