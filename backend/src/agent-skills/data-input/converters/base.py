from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict

from structure_protocol.structure_model_v1 import StructureModelV1


class FormatConverter(ABC):
    format_name: str

    @abstractmethod
    def to_v1(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Convert source payload to StructureModel v1 dictionary."""

    @abstractmethod
    def from_v1(self, model: StructureModelV1) -> Dict[str, Any]:
        """Convert StructureModel v1 to target payload."""

    def to_v2(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Convert source payload to StructureModel v2 dictionary. Default: same as to_v1."""
        return self.to_v1(payload)

    def from_v2(self, model: Any) -> Dict[str, Any]:
        """Convert StructureModelV2 to target payload. Default: delegate to from_v1."""
        return self.from_v1(model)
