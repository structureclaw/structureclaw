"""Tests for pkpm-calcbook runtime."""
from __future__ import annotations

import json
import math
import sys
import types
import re
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Stub APIPyInterface before importing runtime
_api = types.ModuleType("APIPyInterface")
sys.modules.setdefault("APIPyInterface", _api)

from runtime import (
    _dump_worker_response,
    _extract_base_shear,
    _extract_beam_design,
    _extract_column_design,
    _extract_modal,
    _extract_story_drift,
    _extract_story_mass,
    _extract_story_stiffness,
    _extract_stiff_weight_ratio,
    _generate_markdown,
    _generate_pdf,
    _resolve_jws_path,
    run_analysis,
)


def _make_mode_period(**kwargs):
    m = MagicMock()
    m.GetIndex.return_value = kwargs.get("index", 1)
    m.GetCycle.return_value = kwargs.get("period", 0.8)
    m.GetAngle.return_value = kwargs.get("angle", 0.0)
    m.GetDampingRatio.return_value = kwargs.get("damping", 0.05)
    m.GetTorsi.return_value = kwargs.get("torsion", 0.1)
    m.GetxSide.return_value = kwargs.get("x_side", 0.9)
    m.GetySide.return_value = kwargs.get("y_side", 0.0)
    return m


def _make_beam(**kwargs):
    b = MagicMock()
    b.GetPmid.return_value = kwargs.get("pmid", 1)
    b.GetShearCompressionRatio.return_value = kwargs.get("shear_ratio", 0.1)
    b.GetReinForceQuantity.return_value = kwargs.get("reinforce", 5.0)
    b.GetConcreteQuantity.return_value = kwargs.get("concrete", 1.0)
    b.GetSteelQuantity.return_value = kwargs.get("steel", 2.0)
    b.GetExceedLimitInfo.return_value = []
    return b


def _make_column(**kwargs):
    c = MagicMock()
    c.GetPmid.return_value = kwargs.get("pmid", 1)
    c.GetElementid.return_value = kwargs.get("element_id", 10)
    c.GetAxialCompresRatio.return_value = kwargs.get("axial", [0.5])
    c.GetReinForceQuantity.return_value = kwargs.get("reinforce", 8.0)
    c.GetConcreteQuantity.return_value = kwargs.get("concrete", 2.0)
    c.GetSteelQuantity.return_value = kwargs.get("steel", 3.0)
    c.GetSlenderRatio.return_value = kwargs.get("slender", [15.0])
    c.GetExceedLimitInfo.return_value = []
    return c


def _decode_pdf_literal(value: bytes) -> str:
    raw = bytearray()
    i = 0
    while i < len(value):
        if value[i] == 0x5C:
            octal = value[i + 1:i + 4]
            if len(octal) == 3 and all(48 <= b <= 55 for b in octal):
                raw.append(int(octal, 8))
                i += 4
                continue
            if i + 1 < len(value):
                raw.append(value[i + 1])
                i += 2
                continue
        raw.append(value[i])
        i += 1
    data = bytes(raw)
    try:
        return data.decode("utf-16-be")
    except UnicodeDecodeError:
        return data.decode("latin-1", errors="ignore")


def _extract_uncompressed_pdf_text(pdf_path: Path) -> str:
    data = pdf_path.read_bytes()
    return "\n".join(_decode_pdf_literal(value) for value in re.findall(rb"\((.*?)\)\s*Tj", data, flags=re.S))


class TestResolveJwsPath:
    def test_from_parameters(self, tmp_path):
        jws = tmp_path / "test.JWS"
        jws.write_text("dummy")
        p = _resolve_jws_path({}, {"jws_path": str(jws)})
        assert p == jws

    def test_from_model(self, tmp_path):
        jws = tmp_path / "test.JWS"
        jws.write_text("dummy")
        p = _resolve_jws_path({"_pkpm_jws_path": str(jws)}, {})
        assert p == jws

    def test_missing_raises(self):
        with pytest.raises(ValueError, match="No JWS path"):
            _resolve_jws_path({}, {})

    def test_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            _resolve_jws_path({}, {"jws_path": "/nonexistent/test.JWS"})


class TestWorkerJson:
    def test_replaces_non_finite_numbers_with_null(self):
        text = _dump_worker_response({
            "ok": True,
            "data": {
                "positive": math.inf,
                "negative": -math.inf,
                "nan": float("nan"),
                "nested": [1.0, math.inf],
            },
        })

        assert "Infinity" not in text
        assert "NaN" not in text
        assert json.loads(text) == {
            "ok": True,
            "data": {
                "positive": None,
                "negative": None,
                "nan": None,
                "nested": [1.0, None],
            },
        }


class TestExtractModal:
    def test_basic(self):
        result = MagicMock()
        result.GetModePeriods.return_value = [
            _make_mode_period(index=1, period=0.8, torsion=0.05),
            _make_mode_period(index=2, period=0.65, torsion=0.6),
        ]
        out = _extract_modal(result)
        assert len(out) == 2
        assert out[0]["period_s"] == 0.8
        assert out[0]["torsion_ratio"] == 0.05
        assert out[1]["period_s"] == 0.65

    def test_empty(self):
        result = MagicMock()
        result.GetModePeriods.return_value = []
        out = _extract_modal(result)
        assert out == []


class TestExtractStoryStiffness:
    def test_basic(self):
        result = MagicMock()
        s = MagicMock()
        s.Getfloorindex.return_value = 1
        s.GetTowerIndex.return_value = 0
        s.GetRJX.return_value = 100000.0
        s.GetRJY.return_value = 95000.0
        s.GetRatx.return_value = 1.2
        s.GetRaty.return_value = 1.15
        result.GetStoreyStifs.return_value = [s]
        out = _extract_story_stiffness(result)
        assert len(out) == 1
        assert out[0]["RJX"] == 100000.0


class TestExtractBaseShear:
    def test_basic(self):
        result = MagicMock()
        result.GetRatShearWeightConsVal.return_value = 0.016
        s = MagicMock()
        s.GetFloorNum.return_value = 1
        s.GetTowerNum.return_value = 0
        s.GetRatx.return_value = 0.03
        s.GetRaty.return_value = 0.028
        s.GetLimitVal.return_value = 0.016
        result.GetBearingShear.return_value = [s]
        out = _extract_base_shear(result)
        assert len(out["entries"]) == 1
        assert out["shear_weight_limit"] == 0.016


class TestExtractBeamDesign:
    def test_basic(self):
        result = MagicMock()
        b1 = _make_beam(pmid=1, shear_ratio=0.12, reinforce=5.0)
        result.GetDesignBeams.side_effect = lambda idx: [b1] if idx == 1 else []
        out = _extract_beam_design(result)
        assert out["total_beams"] == 1
        assert out["max_shear_compression_ratio"] == 0.12
        assert out["floors_analyzed"] == 1


class TestExtractColumnDesign:
    def test_basic(self):
        result = MagicMock()
        c1 = _make_column(pmid=1, axial=[0.55])
        result.GetDesignColumns.side_effect = lambda idx: [c1] if idx == 1 else []
        out = _extract_column_design(result)
        assert out["total_columns"] == 1
        assert out["max_axial_compression_ratio"] == 0.55


class TestGenerateMarkdown:
    def test_basic_report(self):
        report = {
            "detailed": {
                "modal_analysis": [
                    {"index": 1, "period_s": 0.8, "angle": 0.0,
                     "torsion_ratio": 0.05, "x_side": 0.95, "y_side": 0.0}
                ],
                "story_stiffness": [],
                "story_drift": {"earthquake": {}, "wind": {}, "limit_value": None},
                "base_shear": {"entries": [], "shear_weight_limit": None},
                "story_mass": [],
                "stiff_weight_ratio": {"entries": [], "limit_value": None},
                "beam_design": {"total_beams": 10, "max_shear_compression_ratio": 0.15,
                                "total_reinforce_quantity": 50.0},
                "column_design": {"total_columns": 6, "max_axial_compression_ratio": 0.65,
                                  "total_reinforce_quantity": 30.0},
                "code_exceedance": [],
            }
        }
        md = _generate_markdown(report)
        assert "# PKPM SATWE 结构计算书" in md
        assert "模态分析" in md
        assert "0.8" in md


class TestGeneratePdf:
    def test_includes_wmass_wind_and_seismic_parameters(self, tmp_path):
        pytest.importorskip("reportlab")
        import reportlab.rl_config

        report = {
            "detailed": {
                "out_file_data": {
                    "wmass_params": {
                        "wind_info_params": "\n".join([
                            "修正后的基本风压 (kN/m2):             WO     =   0.40",
                            "地面粗糙程度:                         B 类",
                        ]),
                        "earthquake_params": "\n".join([
                            "计算振型数:                           NMODE  =      6",
                            "场地类别:                             KD     =III",
                            "设计地震分组:                         三组",
                            "特征周期:                             TG     =   0.65",
                        ]),
                    }
                },
                "modal_analysis": [],
                "story_stiffness": [],
                "story_drift": {"earthquake": {}, "wind": {}, "limit_value": None},
                "base_shear": {"entries": [], "shear_weight_limit": None},
                "story_mass": [],
                "stiff_weight_ratio": {"entries": [], "limit_value": None},
                "beam_design": {},
                "column_design": {},
                "code_exceedance": [],
            }
        }
        output = tmp_path / "calcbook.pdf"
        old_compression = reportlab.rl_config.pageCompression
        reportlab.rl_config.pageCompression = 0
        try:
            _generate_pdf(report, output)
        finally:
            reportlab.rl_config.pageCompression = old_compression

        text = _extract_uncompressed_pdf_text(output)
        assert "风荷载参数" in text
        assert "WO" in text
        assert "0.40" in text
        assert "B 类" in text
        assert "地震参数" in text
        assert "NMODE" in text
        assert "III" in text
        assert "三组" in text
        assert "0.65" in text


class TestRunAnalysis:
    def test_no_jws_path(self):
        with pytest.raises(ValueError, match="No JWS path"):
            run_analysis({}, {})

    def test_with_mock(self, tmp_path):
        jws = tmp_path / "test.JWS"
        jws.write_text("dummy")

        mock_result = MagicMock()
        mock_result.InitialResult.return_value = 0
        mock_result.GetModePeriods.return_value = [_make_mode_period()]
        mock_result.GetStoreyStifs.return_value = []
        mock_result.GetStoryDrift_Earthquake.return_value = {}
        mock_result.GetStoryDrift_Wind.return_value = {}
        mock_result.GetBearingShear.return_value = []
        mock_result.GetStoreyUnitMass.return_value = []
        mock_result.GetStiffWeightRatioFrame.return_value = []
        mock_result.GetDesignBeams.side_effect = lambda idx: []
        mock_result.GetDesignColumns.side_effect = lambda idx: []

        mock_api = MagicMock()
        mock_api.ResultData.return_value = mock_result

        with patch.dict("sys.modules", {"APIPyInterface": mock_api}):
            out = run_analysis({}, {"jws_path": str(jws)})

        assert out["status"] == "success"
        assert out["summary"]["engine"] == "pkpm-calcbook"
        assert len(out["detailed"]["modal_analysis"]) == 1
        assert "markdown" in out
        assert "out_file_data" in out["detailed"]
