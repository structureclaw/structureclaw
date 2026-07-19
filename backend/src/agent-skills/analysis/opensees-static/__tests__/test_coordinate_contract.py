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

from opensees_static_simplified_static_analysis import StaticAnalyzer  # noqa: E402
from runtime import run_analysis as run_opensees_analysis  # noqa: E402
from structure_protocol.structure_model_v2 import StructureModelV2  # noqa: E402


def _coordinate_system(dimension: str) -> dict:
    return {
        "semantics": "global-z-up",
        "version": 1,
        "dimension": dimension,
        "plane": "xz" if dimension == "2d" else None,
        "dof_order": ["ux", "uy", "uz", "rx", "ry", "rz"],
    }


def _section(*, iy=0.0001, iz=0.0004):
    return {
        "id": "S1",
        "name": "test",
        "type": "beam",
        "properties": {"A": 0.02, "Iy": iy, "Iz": iz, "J": 0.0002, "G": 79000},
    }


def _material():
    return {"id": "M1", "name": "steel", "E": 205000, "nu": 0.3, "rho": 7850}


def test_simply_supported_xz_beam_matches_closed_form_point_load_solution():
    span = 6.0
    load = 20.0
    model = StructureModelV2.model_validate({
        "coordinate_system": _coordinate_system("2d"),
        "nodes": [
            {"id": "N1", "x": 0, "y": 0, "z": 0, "restraints": [True, True, True, False, False, False]},
            {"id": "N2", "x": span / 2, "y": 0, "z": 0},
            {"id": "N3", "x": span, "y": 0, "z": 0, "restraints": [False, True, True, False, False, False]},
        ],
        "elements": [
            {"id": "E1", "type": "beam", "nodes": ["N1", "N2"], "material": "M1", "section": "S1"},
            {"id": "E2", "type": "beam", "nodes": ["N2", "N3"], "material": "M1", "section": "S1"},
        ],
        "materials": [_material()],
        "sections": [_section()],
        "load_cases": [{"id": "LC1", "loads": [{"node": "N2", "fz": -load}]}],
    })

    result = StaticAnalyzer(model)._run_linear_2d_frame({"loadCaseIds": ["LC1"]}, "xz")
    expected_displacement = -load * span**3 / (48 * 205000 * 1000 * 0.0001)
    assert result["displacements"]["N2"]["uz"] == pytest.approx(expected_displacement, rel=1e-10)
    assert result["displacements"]["N2"]["uy"] == 0
    assert result["reactions"]["N1"]["fz"] == pytest.approx(load / 2, rel=1e-10)
    assert result["reactions"]["N3"]["fz"] == pytest.approx(load / 2, rel=1e-10)
    assert result["meta"]["activeDofs"] == ["ux", "uz", "ry"]


def test_3d_global_gravity_load_uses_local_iy_for_x_axis_member():
    span = 4.0
    load = 10.0
    iy = 0.0001
    model = StructureModelV2.model_validate({
        "coordinate_system": _coordinate_system("3d"),
        "nodes": [
            {"id": "N1", "x": 0, "y": 0, "z": 0, "restraints": [True] * 6},
            {"id": "N2", "x": span, "y": 0, "z": 0},
        ],
        "elements": [{"id": "E1", "type": "beam", "nodes": ["N1", "N2"], "material": "M1", "section": "S1"}],
        "materials": [_material()],
        "sections": [_section(iy=iy, iz=iy * 4)],
        "load_cases": [{
            "id": "LC1",
            "loads": [{"type": "distributed", "element": "E1", "reference_frame": "global", "wz": -load}],
        }],
    })

    result = StaticAnalyzer(model)._run_linear_3d_frame({"loadCaseIds": ["LC1"]})
    expected_displacement = -load * span**4 / (8 * 205000 * 1000 * iy)
    assert result["displacements"]["N2"]["uz"] == pytest.approx(expected_displacement, rel=1e-10)
    assert result["displacements"]["N2"]["uy"] == pytest.approx(0.0, abs=1e-12)
    assert result["forces"]["E1"]["referenceFrame"] == "element-local"
    assert result["forces"]["E1"]["localAxes"] == {
        "x": pytest.approx([1, 0, 0]),
        "y": pytest.approx([0, 1, 0]),
        "z": pytest.approx([0, 0, 1]),
    }


def test_truss_uses_kilonewton_meter_modulus_conversion():
    model = StructureModelV2.model_validate({
        "coordinate_system": _coordinate_system("2d"),
        "nodes": [
            {"id": "N1", "x": 0, "y": 0, "z": 0, "restraints": [True, True, True, False, False, False]},
            {"id": "N2", "x": 2, "y": 0, "z": 0, "restraints": [False, True, True, False, False, False]},
        ],
        "elements": [{"id": "E1", "type": "truss", "nodes": ["N1", "N2"], "material": "M1", "section": "S1"}],
        "materials": [_material()],
        "sections": [{"id": "S1", "name": "rod", "type": "rod", "properties": {"A": 0.01}}],
        "load_cases": [{"id": "LC1", "loads": [{"node": "N2", "fx": 100}]}],
    })

    result = StaticAnalyzer(model)._run_linear_2d_truss({"loadCaseIds": ["LC1"]})
    expected = 100 * 2 / (0.01 * 205000 * 1000)
    assert result["displacements"]["N2"]["ux"] == pytest.approx(expected, rel=1e-10)


def test_2d_solver_rejects_fy_instead_of_treating_it_as_fz():
    with pytest.raises(ValueError, match="Out-of-plane"):
        StructureModelV2.model_validate({
            "coordinate_system": _coordinate_system("2d"),
            "nodes": [{"id": "N1", "x": 0, "y": 0, "z": 0}],
            "load_cases": [{"id": "LC1", "loads": [{"node": "N1", "fy": -10}]}],
        })


def test_real_opensees_2d_xz_solution_and_local_force_frame():
    span = 6.0
    load = 20.0
    model = StructureModelV2.model_validate({
        "coordinate_system": _coordinate_system("2d"),
        "nodes": [
            {"id": "N1", "x": 0, "y": 0, "z": 0, "restraints": [True, True, True, False, False, False]},
            {"id": "N2", "x": span / 2, "y": 0, "z": 0},
            {"id": "N3", "x": span, "y": 0, "z": 0, "restraints": [False, True, True, False, False, False]},
        ],
        "elements": [
            {"id": "E1", "type": "beam", "nodes": ["N1", "N2"], "material": "M1", "section": "S1"},
            {"id": "E2", "type": "beam", "nodes": ["N2", "N3"], "material": "M1", "section": "S1"},
        ],
        "materials": [_material()],
        "sections": [_section()],
        "load_cases": [{"id": "LC1", "loads": [{"node": "N2", "fz": -load}]}],
    })

    result = run_opensees_analysis(model, {"loadCaseIds": ["LC1"]})
    expected_displacement = -load * span**3 / (48 * 205000 * 1000 * 0.0001)
    assert result["analysisMode"] == "opensees_2d_frame"
    assert result["displacements"]["N2"]["uz"] == pytest.approx(expected_displacement, rel=1e-9)
    assert result["reactions"]["N1"]["fz"] == pytest.approx(load / 2, rel=1e-9)
    assert result["reactions"]["N3"]["fz"] == pytest.approx(load / 2, rel=1e-9)
    assert result["forces"]["E1"]["referenceFrame"] == "element-local"


def test_real_opensees_sloped_2d_global_load_preserves_global_resultants():
    distributed_load = 4.0
    member_length = 5.0
    model = StructureModelV2.model_validate({
        "coordinate_system": _coordinate_system("2d"),
        "nodes": [
            {"id": "N1", "x": 0, "y": 0, "z": 0, "restraints": [True] * 6},
            {"id": "N2", "x": 3, "y": 0, "z": 4},
        ],
        "elements": [
            {"id": "E1", "type": "beam", "nodes": ["N1", "N2"], "material": "M1", "section": "S1"},
        ],
        "materials": [_material()],
        "sections": [_section()],
        "load_cases": [{
            "id": "LC1",
            "loads": [{
                "type": "distributed",
                "element": "E1",
                "reference_frame": "global",
                "wz": -distributed_load,
            }],
        }],
    })

    result = run_opensees_analysis(model, {"loadCaseIds": ["LC1"]})
    assert result["reactions"]["N1"]["fx"] == pytest.approx(0.0, abs=1e-9)
    assert result["reactions"]["N1"]["fz"] == pytest.approx(distributed_load * member_length, rel=1e-9)


def test_real_opensees_3d_uses_iy_for_global_z_bending():
    span = 4.0
    distributed_load = 10.0
    iy = 0.0001
    model = StructureModelV2.model_validate({
        "coordinate_system": _coordinate_system("3d"),
        "nodes": [
            {"id": "N1", "x": 0, "y": 0, "z": 0, "restraints": [True] * 6},
            {"id": "N2", "x": span, "y": 0, "z": 0},
        ],
        "elements": [
            {"id": "E1", "type": "beam", "nodes": ["N1", "N2"], "material": "M1", "section": "S1"},
        ],
        "materials": [_material()],
        "sections": [_section(iy=iy, iz=iy * 4)],
        "load_cases": [{
            "id": "LC1",
            "loads": [{"type": "distributed", "element": "E1", "reference_frame": "global", "wz": -distributed_load}],
        }],
    })

    result = run_opensees_analysis(model, {"loadCaseIds": ["LC1"]})
    expected_displacement = -distributed_load * span**4 / (8 * 205000 * 1000 * iy)
    assert result["analysisMode"] == "opensees_3d_frame"
    assert result["displacements"]["N2"]["uz"] == pytest.approx(expected_displacement, rel=1e-8)
    assert result["displacements"]["N2"]["uy"] == pytest.approx(0.0, abs=1e-10)
    assert result["forces"]["E1"]["referenceFrame"] == "element-local"


def test_real_opensees_3d_uses_iz_for_global_y_bending():
    span = 4.0
    distributed_load = 10.0
    iy = 0.0001
    iz = iy * 4
    model = StructureModelV2.model_validate({
        "coordinate_system": _coordinate_system("3d"),
        "nodes": [
            {"id": "N1", "x": 0, "y": 0, "z": 0, "restraints": [True] * 6},
            {"id": "N2", "x": span, "y": 0, "z": 0},
        ],
        "elements": [
            {"id": "E1", "type": "beam", "nodes": ["N1", "N2"], "material": "M1", "section": "S1"},
        ],
        "materials": [_material()],
        "sections": [_section(iy=iy, iz=iz)],
        "load_cases": [{
            "id": "LC1",
            "loads": [{"type": "distributed", "element": "E1", "reference_frame": "global", "wy": -distributed_load}],
        }],
    })

    result = run_opensees_analysis(model, {"loadCaseIds": ["LC1"]})
    expected_displacement = -distributed_load * span**4 / (8 * 205000 * 1000 * iz)
    assert result["displacements"]["N2"]["uy"] == pytest.approx(expected_displacement, rel=1e-8)
    assert result["displacements"]["N2"]["uz"] == pytest.approx(0.0, abs=1e-10)


def test_real_opensees_3d_section_rotation_rotates_iy_iz_axes_once():
    span = 4.0
    distributed_load = 10.0
    iy = 0.0001
    iz = iy * 4
    model = StructureModelV2.model_validate({
        "coordinate_system": _coordinate_system("3d"),
        "nodes": [
            {"id": "N1", "x": 0, "y": 0, "z": 0, "restraints": [True] * 6},
            {"id": "N2", "x": span, "y": 0, "z": 0},
        ],
        "elements": [{
            "id": "E1",
            "type": "beam",
            "nodes": ["N1", "N2"],
            "material": "M1",
            "section": "S1",
            "rotation_angle": 90,
        }],
        "materials": [_material()],
        "sections": [_section(iy=iy, iz=iz)],
        "load_cases": [{
            "id": "LC1",
            "loads": [{"type": "distributed", "element": "E1", "reference_frame": "global", "wz": -distributed_load}],
        }],
    })

    result = run_opensees_analysis(model, {"loadCaseIds": ["LC1"]})
    expected_displacement = -distributed_load * span**4 / (8 * 205000 * 1000 * iz)
    assert result["displacements"]["N2"]["uz"] == pytest.approx(expected_displacement, rel=1e-8)
    assert result["forces"]["E1"]["localAxes"] == {
        "x": pytest.approx([1, 0, 0], abs=1e-12),
        "y": pytest.approx([0, 0, 1], abs=1e-12),
        "z": pytest.approx([0, -1, 0], abs=1e-12),
    }
