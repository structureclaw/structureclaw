from __future__ import annotations

from typing import Any, Dict

from simplified_static_analysis import StaticAnalyzer
from structure_protocol.structure_model_v2 import StructureModelV2


def run_analysis(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    return StaticAnalyzer(model).run(parameters)
