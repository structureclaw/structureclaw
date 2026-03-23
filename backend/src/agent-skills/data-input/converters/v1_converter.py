from __future__ import annotations

from typing import Any, Dict

from converters.base import FormatConverter
from structure_protocol.structure_model_v1 import StructureModelV1


class StructureModelV1Converter(FormatConverter):
    format_name = "structuremodel-v1"

    def to_v1(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return payload

    def from_v1(self, model: StructureModelV1) -> Dict[str, Any]:
        return model.model_dump(mode="json")
