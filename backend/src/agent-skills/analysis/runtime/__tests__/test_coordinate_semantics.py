from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest


RUNTIME_DIR = Path(__file__).resolve().parents[1]
if str(RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(RUNTIME_DIR))

from coordinate_semantics import (  # noqa: E402
    build_element_local_axes,
    coordinate_contract_metadata,
    planar_xz_local_components,
    resolve_model_dimension,
    transform_global_vector_to_local,
    transform_local_vector_to_global,
    validate_coordinate_contract,
)


def _model(*, dimension: str = "2d", nodes=None, loads=None):
    return {
        "coordinate_system": {
            "semantics": "global-z-up",
            "version": 1,
            "dimension": dimension,
            "plane": "xz" if dimension == "2d" else None,
            "dof_order": ["ux", "uy", "uz", "rx", "ry", "rz"],
        },
        "nodes": nodes or [
            {"id": "N1", "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": "N2", "x": 5.0, "y": 0.0, "z": 0.0},
        ],
        "elements": [{"id": "E1", "type": "beam", "nodes": ["N1", "N2"]}],
        "load_cases": [{"id": "LC1", "loads": loads or []}],
    }


def test_canonical_2d_contract_is_xz_with_expected_active_dofs():
    model = _model()
    validate_coordinate_contract(model)
    assert resolve_model_dimension(model) == "2d"
    assert coordinate_contract_metadata(model) == {
        "coordinateSemantics": "global-z-up",
        "coordinateContractVersion": 1,
        "dimension": "2d",
        "plane": "xz",
        "dofOrder": ["ux", "uy", "uz", "rx", "ry", "rz"],
        "activeDofs": ["ux", "uz", "ry"],
        "nodalResultFrame": "global",
        "elementForceFrame": "element-local",
    }


def test_v2_contract_is_never_inferred_from_geometry_or_legacy_metadata():
    untyped = {
        "schema_version": "2.0.0",
        "metadata": {
            "coordinateSemantics": "global-z-up",
            "coordinateContractVersion": 1,
            "frameDimension": "2d",
        },
        "nodes": [
            {"id": "N1", "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": "N2", "x": 5.0, "y": 0.0, "z": 0.0},
        ],
        "elements": [{"id": "E1", "nodes": ["N1", "N2"]}],
    }
    with pytest.raises(ValueError, match="typed coordinate_system"):
        validate_coordinate_contract(untyped)
    with pytest.raises(ValueError, match="coordinate_system.dimension"):
        resolve_model_dimension(untyped)


def test_canonical_2d_contract_rejects_nonzero_global_y_geometry():
    model = _model(nodes=[
        {"id": "N1", "x": 0.0, "y": 0.0, "z": 0.0},
        {"id": "N2", "x": 5.0, "y": 1.0, "z": 0.0},
    ])
    with pytest.raises(ValueError, match="non-zero global Y"):
        validate_coordinate_contract(model)


@pytest.mark.parametrize("component", ["fy", "mx", "mz", "wy"])
def test_canonical_2d_contract_rejects_global_out_of_plane_loads(component):
    model = _model(loads=[{
        "type": "distributed" if component == "wy" else "nodal",
        "element": "E1" if component == "wy" else None,
        "node": "N2" if component != "wy" else None,
        "reference_frame": "global",
        component: 5.0,
    }])
    with pytest.raises(ValueError, match="Out-of-plane load components"):
        validate_coordinate_contract(model)


def test_canonical_2d_contract_rejects_local_out_of_plane_loads():
    model = _model(loads=[{
        "type": "distributed",
        "element": "E1",
        "reference_frame": "element-local",
        "wy": 5.0,
    }])
    with pytest.raises(ValueError, match="Local wy is out of plane"):
        validate_coordinate_contract(model)


def test_element_local_reference_frame_is_rejected_for_nodal_loads():
    model = _model(loads=[{
        "type": "nodal",
        "node": "N2",
        "reference_frame": "element-local",
        "fz": -5.0,
    }])
    with pytest.raises(ValueError, match="Only member loads"):
        validate_coordinate_contract(model)


@pytest.mark.parametrize(
    ("load", "message"),
    [
        ({"node": "N2", "wz": -5.0}, "Nodal loads must use"),
        ({"element": "E1", "fz": -5.0}, "Member loads must use"),
    ],
)
def test_v2_rejects_target_dependent_load_component_aliases(load, message):
    with pytest.raises(ValueError, match=message):
        validate_coordinate_contract(_model(loads=[load]))


@pytest.mark.parametrize(
    ("load", "message"),
    [
        ({"fz": -5.0}, "exactly one node or element"),
        ({"node": "N2", "element": "E1", "fz": -5.0}, "exactly one node or element"),
        ({"node": "N1", "nodeId": "N2", "fz": -5.0}, "conflicting aliases"),
    ],
)
def test_v2_requires_exactly_one_unambiguous_load_target(load, message):
    with pytest.raises(ValueError, match=message):
        validate_coordinate_contract(_model(loads=[load]))


def test_canonical_2d_rejects_custom_element_reference_vectors():
    model = _model()
    model["metadata"] = {"elementReferenceVectors": {"E1": [0.0, 0.0, 1.0]}}
    with pytest.raises(ValueError, match="Canonical 2-D local axes are fixed"):
        validate_coordinate_contract(model)


def test_local_axes_are_orthonormal_right_handed_for_arbitrary_member():
    axes = build_element_local_axes([1.0, 2.0, 3.0], [4.0, 6.0, 8.0])
    assert np.allclose(axes @ axes.T, np.eye(3), atol=1e-12)
    assert np.linalg.det(axes) == pytest.approx(1.0)
    assert axes[0].tolist() == pytest.approx(np.array([3.0, 4.0, 5.0]) / math.sqrt(50.0))


def test_local_axes_honor_section_rotation_and_round_trip_vectors():
    base = build_element_local_axes([0, 0, 0], [5, 0, 0], [0, 0, 1])
    rotated = build_element_local_axes([0, 0, 0], [5, 0, 0], [0, 0, 1], 90)
    assert rotated[1].tolist() == pytest.approx(base[2].tolist(), abs=1e-12)
    assert rotated[2].tolist() == pytest.approx((-base[1]).tolist(), abs=1e-12)

    global_vector = (2.0, -3.0, 7.0)
    local = transform_global_vector_to_local(global_vector, rotated)
    assert transform_local_vector_to_global(local, rotated) == pytest.approx(global_vector)


def test_global_gravity_projects_correctly_for_horizontal_and_vertical_xz_members():
    assert planar_xz_local_components([0, 0, -10], [0, 0, 0], [5, 0, 0]) == pytest.approx((0, -10))
    assert planar_xz_local_components([0, 0, -10], [0, 0, 0], [0, 0, 5]) == pytest.approx((-10, 0))


def test_global_gravity_projects_to_local_z_for_x_and_y_members():
    for end in ([5, 0, 0], [0, 5, 0]):
        axes = build_element_local_axes([0, 0, 0], end, [0, 0, 1])
        local = transform_global_vector_to_local([0, 0, -10], axes)
        assert local == pytest.approx((0, 0, -10))


def test_parallel_reference_vector_is_rejected_instead_of_silently_changed():
    with pytest.raises(ValueError, match="parallel"):
        build_element_local_axes([0, 0, 0], [5, 0, 0], [1, 0, 0])
