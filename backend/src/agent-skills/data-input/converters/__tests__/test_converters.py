"""Unit tests for data-input converters (registry, simple-1, compact-1, midas-text-1)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_CONVERTERS_DIR = str(Path(__file__).resolve().parent.parent)
_DATA_INPUT_DIR = str(Path(__file__).resolve().parent.parent.parent)
_SKILL_SHARED = str(Path(__file__).resolve().parent.parent.parent.parent.parent / "skill-shared" / "python")

for p in [_CONVERTERS_DIR, _DATA_INPUT_DIR, _SKILL_SHARED]:
    if p not in sys.path:
        sys.path.insert(0, p)

from converters.registry import get_converter, supported_formats  # noqa: E402
from converters.simple_v1_converter import SimpleV1Converter  # noqa: E402
from converters.compact_v1_converter import CompactV1Converter  # noqa: E402
from converters.midas_text_v1_converter import MidasTextV1Converter  # noqa: E402


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class TestRegistry:

    def test_get_converter_v1(self):
        c = get_converter("structuremodel-v1")
        assert c is not None

    def test_get_converter_v2(self):
        c = get_converter("structuremodel-v2")
        assert c is not None

    def test_get_converter_simple(self):
        c = get_converter("simple-1")
        assert c is not None
        assert isinstance(c, SimpleV1Converter)

    def test_get_converter_compact(self):
        c = get_converter("compact-1")
        assert c is not None
        assert isinstance(c, CompactV1Converter)

    def test_get_converter_midas(self):
        c = get_converter("midas-text-1")
        assert c is not None
        assert isinstance(c, MidasTextV1Converter)

    def test_get_converter_unknown_returns_none(self):
        assert get_converter("nonexistent") is None

    def test_supported_formats_count(self):
        fmts = supported_formats()
        assert len(fmts) == 5

    def test_supported_formats_sorted(self):
        fmts = supported_formats()
        assert fmts == sorted(fmts)


# ---------------------------------------------------------------------------
# SimpleV1Converter
# ---------------------------------------------------------------------------

class TestSimpleV1ConverterToV1:

    def test_basic_conversion(self):
        c = SimpleV1Converter()
        result = c.to_v1({
            "points": [
                {"name": "N1", "x": 0, "y": 0, "z": 0},
                {"name": "N2", "x": 6, "y": 0, "z": 0},
            ],
            "members": [
                {"name": "B1", "i": "N1", "j": "N2", "material": "steel", "section": "H200"},
            ],
            "materials": [
                {"name": "steel", "E": 206000, "nu": 0.3, "rho": 7850, "fy": 345},
            ],
            "sections": [
                {"name": "H200", "type": "beam", "props": {"A": 6428}},
            ],
        })
        assert result["schema_version"] == "1.0.0"
        assert len(result["nodes"]) == 2
        assert len(result["elements"]) == 1
        assert result["nodes"][0]["id"] == "N1"
        assert result["elements"][0]["nodes"] == ["N1", "N2"]

    def test_empty_payload(self):
        c = SimpleV1Converter()
        result = c.to_v1({})
        assert result["nodes"] == []
        assert result["elements"] == []
        assert result["unit_system"] == "SI"

    def test_units_preserved(self):
        c = SimpleV1Converter()
        result = c.to_v1({"units": "kN-mm", "points": []})
        assert result["unit_system"] == "kN-mm"

    def test_restraints_included_when_present(self):
        c = SimpleV1Converter()
        result = c.to_v1({
            "points": [
                {"name": "N1", "x": 0, "y": 0, "z": 0, "restraints": [1, 1, 1, 0, 0, 0]},
            ],
        })
        assert result["nodes"][0]["restraints"] == [1, 1, 1, 0, 0, 0]


# ---------------------------------------------------------------------------
# CompactV1Converter
# ---------------------------------------------------------------------------

class TestCompactV1ConverterToV1:

    def test_basic_conversion(self):
        c = CompactV1Converter()
        result = c.to_v1({
            "nodes": {
                "N1": {"x": 0, "y": 0, "z": 0},
                "N2": {"x": 6, "y": 0, "z": 0},
            },
            "elements": {
                "B1": {"type": "beam", "nodes": ["N1", "N2"], "material": "steel", "section": "H200"},
            },
        })
        assert result["schema_version"] == "1.0.0"
        assert len(result["nodes"]) == 2
        assert result["nodes"][0]["id"] in ("N1", "N2")
        assert len(result["elements"]) == 1

    def test_empty_payload(self):
        c = CompactV1Converter()
        result = c.to_v1({})
        assert result["nodes"] == []
        assert result["unit_system"] == "SI"


# ---------------------------------------------------------------------------
# MidasTextV1Converter
# ---------------------------------------------------------------------------

class TestMidasTextV1ConverterToV1:

    def test_parse_node_and_element(self):
        c = MidasTextV1Converter()
        text = "\n".join([
            "NODE,N1,0,0,0",
            "NODE,N2,6,0,0",
            "MAT,M1,steel,206000,0.3,7850,345",
            "SEC,S1,H200,beam,6428,477e4,477e4",
            "ELEM,B1,beam,N1,N2,M1,S1",
        ])
        result = c.to_v1({"text": text})
        assert len(result["nodes"]) == 2
        assert result["nodes"][0]["id"] == "N1"
        assert len(result["materials"]) == 1
        assert result["materials"][0]["E"] == 206000.0
        assert len(result["elements"]) == 1

    def test_comments_and_blanks_skipped(self):
        c = MidasTextV1Converter()
        text = "\n".join([
            "# This is a comment",
            "",
            "NODE,N1,0,0,0",
            "  ",
        ])
        result = c.to_v1({"text": text})
        assert len(result["nodes"]) == 1

    def test_unknown_record_raises(self):
        c = MidasTextV1Converter()
        with pytest.raises(ValueError, match="unsupported record"):
            c.to_v1({"text": "UNKNOWN,data,here"})

    def test_empty_text_raises(self):
        c = MidasTextV1Converter()
        with pytest.raises(ValueError, match="payload.text is required"):
            c.to_v1({"text": ""})

    def test_rest_applies_restraints(self):
        c = MidasTextV1Converter()
        text = "\n".join([
            "NODE,N1,0,0,0",
            "REST,N1,1,1,1,0,0,0",
        ])
        result = c.to_v1({"text": text})
        assert result["nodes"][0]["restraints"] == [1, 1, 1, 0, 0, 0]

    def test_loadcase_and_nload(self):
        c = MidasTextV1Converter()
        text = "\n".join([
            "NODE,N1,0,0,0",
            "LOADCASE,LC1,dead",
            "NLOAD,LC1,N1,10,0,0,0,0,0",
        ])
        result = c.to_v1({"text": text})
        assert len(result["load_cases"]) == 1
        assert result["load_cases"][0]["id"] == "LC1"
        assert len(result["load_cases"][0]["loads"]) == 1

    def test_combo_parsed(self):
        c = MidasTextV1Converter()
        text = "COMBO,C1,LC1=1.2;LC2=1.4"
        result = c.to_v1({"text": text})
        assert len(result["load_combinations"]) == 1
        assert result["load_combinations"][0]["factors"]["LC1"] == 1.2

    def test_insufficient_fields_raises(self):
        c = MidasTextV1Converter()
        with pytest.raises(ValueError, match="line"):
            c.to_v1({"text": "NODE,N1,0"})


# ---------------------------------------------------------------------------
# Format name checks
# ---------------------------------------------------------------------------

class TestFormatNames:

    def test_simple_format_name(self):
        assert SimpleV1Converter.format_name == "simple-1"

    def test_compact_format_name(self):
        assert CompactV1Converter.format_name == "compact-1"

    def test_midas_format_name(self):
        assert MidasTextV1Converter.format_name == "midas-text-1"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
