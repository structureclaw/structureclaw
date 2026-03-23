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
