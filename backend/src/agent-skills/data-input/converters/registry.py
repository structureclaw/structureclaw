from __future__ import annotations

from typing import Dict, List

from converters.base import FormatConverter
from converters.compact_v1_converter import CompactV1Converter
from converters.midas_text_v1_converter import MidasTextV1Converter
from converters.simple_v1_converter import SimpleV1Converter
from converters.v1_converter import StructureModelV1Converter
from converters.v2_converter import StructureModelV2Converter


_CONVERTERS: Dict[str, FormatConverter] = {
    StructureModelV1Converter.format_name: StructureModelV1Converter(),
    StructureModelV2Converter.format_name: StructureModelV2Converter(),
    SimpleV1Converter.format_name: SimpleV1Converter(),
    CompactV1Converter.format_name: CompactV1Converter(),
    MidasTextV1Converter.format_name: MidasTextV1Converter(),
}


def get_converter(format_name: str) -> FormatConverter | None:
    return _CONVERTERS.get(format_name)


def supported_formats() -> List[str]:
    return sorted(_CONVERTERS.keys())
