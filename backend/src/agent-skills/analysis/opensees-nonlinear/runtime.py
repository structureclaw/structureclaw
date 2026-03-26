from __future__ import annotations

from typing import Any, Dict

from adapters.opensees.provider import run_analysis as run_opensees_analysis
from structure_protocol.structure_model_v1 import StructureModelV1


def run_analysis(model: StructureModelV1, parameters: Dict[str, Any]) -> Dict[str, Any]:
    return run_opensees_analysis("nonlinear", model, parameters)
