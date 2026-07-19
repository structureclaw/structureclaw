from __future__ import annotations

import sys
from pathlib import Path

import pytest


SKILL_DIR = Path(__file__).resolve().parents[1]
ANALYSIS_RUNTIME_DIR = SKILL_DIR.parents[0] / "runtime"
SHARED_PYTHON_DIR = SKILL_DIR.parents[2] / "skill-shared" / "python"
for path in (SKILL_DIR, ANALYSIS_RUNTIME_DIR, SHARED_PYTHON_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from opensees_dynamic_analysis import OpenSeesDynamicExecutor  # noqa: E402
from opensees_shared.tags import OpenSeesTagMapper  # noqa: E402
from structure_protocol.structure_model_v2 import StructureModelV2  # noqa: E402


def _coordinate_system(dimension: str = "2d") -> dict:
    return {
        "semantics": "global-z-up",
        "version": 1,
        "dimension": dimension,
        "plane": "xz" if dimension == "2d" else None,
        "dof_order": ["ux", "uy", "uz", "rx", "ry", "rz"],
    }


def _cantilever_model() -> StructureModelV2:
    return StructureModelV2.model_validate({
        "coordinate_system": _coordinate_system(),
        "nodes": [
            {"id": "N1", "x": 0, "y": 0, "z": 0, "restraints": [True] * 6},
            {"id": "N2", "x": 0, "y": 0, "z": 3},
        ],
        "elements": [
            {"id": "E1", "type": "column", "nodes": ["N1", "N2"], "material": "M1", "section": "S1"},
        ],
        "materials": [{"id": "M1", "name": "steel", "E": 205000, "nu": 0.3, "rho": 7850}],
        "sections": [{
            "id": "S1",
            "name": "column",
            "type": "column",
            "properties": {"A": 0.02, "Iy": 0.0001, "Iz": 0.0002, "J": 0.00005},
        }],
    })


def test_real_modal_analysis_maps_opensees_xy_back_to_global_xz():
    import openseespy.opensees as ops

    model = _cantilever_model()
    executor = OpenSeesDynamicExecutor(OpenSeesTagMapper(model))
    result = executor.modal_analysis(2, ops, "x")

    assert result["status"] == "success"
    assert result["direction"] == "x"
    assert result["meta"]["dimension"] == "2d"
    assert result["meta"]["plane"] == "xz"
    assert result["modes"]
    for mode in result["modes"]:
        vector = mode["modeShape"]["N2"]
        assert len(vector) == 3
        assert vector[1] == 0.0
        assert mode["modeShapeFrame"] == "global"


def test_2d_dynamic_analysis_rejects_global_y_direction():
    import openseespy.opensees as ops

    model = _cantilever_model()
    executor = OpenSeesDynamicExecutor(OpenSeesTagMapper(model))
    with pytest.raises(ValueError, match="inactive"):
        executor.modal_analysis(1, ops, "y")


def test_real_time_history_reports_global_x_displacement_vector():
    import openseespy.opensees as ops

    model = _cantilever_model()
    executor = OpenSeesDynamicExecutor(OpenSeesTagMapper(model))
    result = executor.time_history_analysis(
        time_step=0.02,
        duration=0.10,
        damping_ratio=0.05,
        ground_motion=[0.0, 0.1, -0.1, 0.05, 0.0],
        ops=ops,
        direction="x",
    )

    assert result["status"] == "success"
    assert result["direction"] == "x"
    assert result["monitorNode"] == "N2"
    assert len(result["timeHistory"]) == 5
    for sample in result["timeHistory"]:
        assert sample["referenceFrame"] == "global"
        assert sample["displacement"] == pytest.approx(sample["displacementVector"][0])
        assert sample["displacementVector"][1] == 0.0
