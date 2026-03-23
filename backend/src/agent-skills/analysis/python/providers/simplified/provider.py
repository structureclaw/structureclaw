from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException

from providers.simplified.dynamic_analysis import SimplifiedDynamicAnalyzer
from providers.simplified.seismic_analysis import SimplifiedSeismicAnalyzer
from providers.simplified.static_analysis import StaticAnalyzer
from structure_protocol.structure_model_v1 import StructureModelV1


def run_analysis(
    analysis_type: str,
    model: StructureModelV1,
    parameters: Dict[str, Any],
) -> Dict[str, Any]:
    if analysis_type == "static":
        return StaticAnalyzer(model).run(parameters)
    if analysis_type == "dynamic":
        return SimplifiedDynamicAnalyzer(model).run(parameters)
    if analysis_type == "seismic":
        return SimplifiedSeismicAnalyzer(model).run(parameters)
    if analysis_type == "nonlinear":
        return StaticAnalyzer(model).run_nonlinear(parameters)
    raise HTTPException(
        status_code=400,
        detail={
            "errorCode": "INVALID_ANALYSIS_TYPE",
            "message": f"Unknown analysis type: {analysis_type}",
        },
    )
