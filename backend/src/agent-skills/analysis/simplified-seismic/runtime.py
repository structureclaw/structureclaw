from __future__ import annotations

from typing import Any, Dict

from simplified_seismic_analysis import SimplifiedSeismicAnalyzer
from structure_protocol.structure_model_v2 import StructureModelV2


def run_analysis(model: StructureModelV2, parameters: Dict[str, Any]) -> Dict[str, Any]:
    return SimplifiedSeismicAnalyzer(model).run(parameters)
