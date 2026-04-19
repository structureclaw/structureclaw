from __future__ import annotations

from typing import Any, Dict

from structure_protocol.structure_model_v2 import StructureModelV2


def run_analysis(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    raise NotImplementedError(
        "Nonlinear OpenSees analysis is not yet implemented; "
        "node/element definitions and nonlinear material setup are required"
    )
