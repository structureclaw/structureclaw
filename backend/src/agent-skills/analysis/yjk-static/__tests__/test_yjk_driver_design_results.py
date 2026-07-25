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


def test_driver_does_not_switch_to_design_results_ui_after_calculation():
    source = (YJK_STATIC_DIR / "yjk_driver.py").read_text(encoding="utf-8")

    # This UI-only command can block after a successful solve. Result
    # extraction uses yjks_pyload directly and does not require this label.
    assert '"IDDSN_DSP"' not in source


def test_build_analysis_result_maps_yjk_member_design_results():
    driver = _load_driver_module()

    extracted = {
        "meta": {"n_floors": 1, "n_nodes": 3, "load_cases": [1]},
        "load_cases": [{"id": 1, "key": "lc_1", "name": "DL"}],
        "nodes": [
            {"id": 1, "x": 0, "y": 0, "z": 0},
            {"id": 2, "x": 6, "y": 0, "z": 0},
            {"id": 3, "x": 12, "y": 0, "z": 0},
        ],
        "node_disp": {"lc_1": [
            {"id": node_id, "ux": 0, "uy": 0, "uz": 0, "rx": 0, "ry": 0, "rz": 0}
            for node_id in (1, 2, 3)
        ]},
        "node_reactions": {"lc_1": [
            {"id": node_id, "fx": 0, "fy": 0, "fz": 0, "mx": 0, "my": 0, "mz": 0}
            for node_id in (1, 2, 3)
        ]},
        "members": {
            "columns": [
                {"id": 101, "tot_id": 101, "floor": 1, "node_i": 1, "node_j": 2, "sequence": 1},
            ],
            "beams": [
                {"id": 201, "tot_id": 201, "floor": 1, "node_i": 2, "node_j": 3, "sequence": 1},
            ],
            "braces": [],
        },
        "member_forces": {
            "columns": {"lc_1": [{"id": 101, "floor": 1, "sections": [[0, 0, 0, 0, -10, 0]]}]},
            "beams": {"lc_1": [{"id": 201, "floor": 1, "sequence": 1, "sections": [[0, 5, 0, 3, 0, 0]]}]},
            "braces": {"lc_1": []},
        },
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
        "nodes": {
            "N1": {"v2_id": "N1", "yjk_std_floor_node_id": 1, "x_mm": 0, "y_mm": 0, "z_mm": 0},
            "N2": {"v2_id": "N2", "yjk_std_floor_node_id": 2, "x_mm": 6000, "y_mm": 0, "z_mm": 0},
            "N3": {"v2_id": "N3", "yjk_std_floor_node_id": 3, "x_mm": 12000, "y_mm": 0, "z_mm": 0},
        },
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
    assert result["designResults"]["elements"]["B1"]["yjk"]["matchMethod"] == "endpoint"
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
