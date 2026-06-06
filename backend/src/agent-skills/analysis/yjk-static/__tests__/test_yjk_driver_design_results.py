from __future__ import annotations

import importlib.util
from pathlib import Path


YJK_STATIC_DIR = Path(__file__).resolve().parents[1]


def _load_driver_module():
    spec = importlib.util.spec_from_file_location("yjk_driver_under_test", YJK_STATIC_DIR / "yjk_driver.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_analysis_result_maps_yjk_member_design_results():
    driver = _load_driver_module()

    extracted = {
        "meta": {"n_floors": 1, "n_nodes": 0, "load_cases": []},
        "load_cases": [],
        "nodes": [],
        "node_disp": {},
        "node_reactions": {},
        "members": {
            "columns": [
                {"id": 101, "tot_id": 101, "floor": 1, "node_i": 1, "node_j": 2, "sequence": 1},
            ],
            "beams": [
                {"id": 201, "tot_id": 201, "floor": 1, "node_i": 2, "node_j": 3, "sequence": 1},
            ],
            "braces": [],
        },
        "member_forces": {"columns": {}, "beams": {}, "braces": {}},
        "member_design": {
            "columns": [
                {
                    "id": 101,
                    "tot_id": 101,
                    "floor": 1,
                    "node_i": 1,
                    "node_j": 2,
                    "sequence": 1,
                    "raw": {"axial_compression_ratio": [0.62]},
                    "metrics": {"axial_compression_ratio": {"max_abs_numeric": 0.62, "numeric_count": 1}},
                },
            ],
            "beams": [
                {
                    "id": 201,
                    "tot_id": 201,
                    "floor": 1,
                    "node_i": 2,
                    "node_j": 3,
                    "sequence": 1,
                    "raw": {"design_ratio": [92.0]},
                    "metrics": {"design_ratio": {"max_abs_numeric": 92.0, "numeric_count": 1}},
                },
            ],
            "braces": [],
        },
        "floor_stats": [],
    }
    mapping = {
        "nodes": {},
        "elements": {
            "C1": {"v2_id": "C1", "type": "column", "floor_index": 1, "yjk_model_id": 101, "nodes": ["N1", "N2"]},
            "B1": {
                "v2_id": "B1",
                "type": "beam",
                "floor_index": 2,
                "nodes": ["N2", "N3"],
                "fallback_match": {"sequence_in_floor_type": 1},
            },
        },
    }

    result = driver._build_analysis_result(
        extracted=extracted,
        mapping=mapping,
        ydb_path="demo.ydb",
        yjk_project="demo",
        work_dir="work",
        results_path="results.json",
        steps=[],
    )

    assert result["summary"]["designElementCount"] == 2
    assert result["summary"]["maxDesignUtilization"] == 0.92
    assert result["summary"]["controllingDesignElement"] == "B1"
    assert result["utilizationByElement"]["C1"]["轴压比"] == 0.62
    assert result["utilizationByElement"]["B1"]["正截面受弯"] == 0.92
    assert result["designResults"]["summary"] == {
        "elementCount": 2,
        "rawMemberCount": 2,
        "mappedMemberCount": 2,
        "maxUtilization": 0.92,
        "controllingElement": "B1",
        "controllingCheck": "正截面受弯",
    }
    assert result["designResults"]["elements"]["C1"]["yjk"]["matchMethod"] == "direct"
    assert result["designResults"]["elements"]["B1"]["yjk"]["matchMethod"] == "sequence"
    assert driver._design_usage_by_check(
        "beams",
        {"design_ratio": {"max_abs_numeric": 9.0, "numeric_count": 1}},
    ) == {"正截面受弯": 0.09}
    assert driver._design_usage_by_check(
        "beams",
        {"design_ratio": {"max_abs_numeric": 150.0, "numeric_count": 1}},
    ) == {"正截面受弯": 1.5}
    assert driver._design_usage_by_check(
        "beams",
        {"design_ratio": {"max_abs_numeric": 1001.0, "numeric_count": 1}},
    ) == {}
    assert driver._normalize_utilization(None, percent_encoded=True) is None
