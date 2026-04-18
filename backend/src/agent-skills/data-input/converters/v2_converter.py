from __future__ import annotations

from typing import Any, Dict

from converters.base import FormatConverter
from structure_protocol.structure_model_v2 import StructureModelV2


class StructureModelV2Converter(FormatConverter):
    format_name = "structuremodel-v2"

    def to_v1(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return payload

    def to_v2(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return payload

    def from_v1(self, model: Any) -> Dict[str, Any]:
        if hasattr(model, "model_dump"):
            return model.model_dump(mode="json")
        return dict(model)

    def from_v2(self, model: StructureModelV2) -> Dict[str, Any]:
        if hasattr(model, "model_dump"):
            return model.model_dump(mode="json")
        return dict(model)
