"""Regression tests for StructureModelV2 schema validation and V1→V2 migration."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_PROTOCOL_ROOT = Path(__file__).resolve().parent.parent
if str(_PROTOCOL_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROTOCOL_ROOT))

from structure_protocol.migrations import ensure_v2_dict, migrate_v1_to_v2
from structure_protocol.structure_model_v2 import (
    AnalysisControl,
    CoordinateSystemV2,
    ElementV2,
    FloorLoad,
    LoadCaseV2,
    LoadCombinationV2,
    MaterialV2,
    NodeV2,
    ProjectInfo,
    SectionShape,
    SectionV2,
    SiteSeismicParams,
    SlabOpening,
    StoryDef,
    StructureModelV2,
    StructureSystem,
    WallOpening,
    WindParams,
)

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "examples"
EXAMPLES_V2_DIR = Path(__file__).resolve().parent.parent / "examples_v2"


def _coordinate_system(dimension: str = "2d") -> dict:
    return {
        "semantics": "global-z-up",
        "version": 1,
        "dimension": dimension,
        "plane": "xz" if dimension == "2d" else None,
        "dof_order": ["ux", "uy", "uz", "rx", "ry", "rz"],
    }


def _load_json(name: str, v2: bool = False) -> dict:
    base = EXAMPLES_V2_DIR if v2 else EXAMPLES_DIR
    with open(base / name, encoding="utf-8") as fh:
        return json.load(fh)


def _minimal_model(**kwargs) -> StructureModelV2:
    """Helper: valid minimal model with two nodes, one beam, one material, one section."""
    defaults = dict(
        coordinate_system=CoordinateSystemV2(**_coordinate_system()),
        nodes=[NodeV2(id="1", x=0, y=0, z=0), NodeV2(id="2", x=1, y=0, z=0)],
        elements=[ElementV2(id="e1", nodes=["1", "2"], material="m1", section="s1")],
        materials=[MaterialV2(id="m1", name="S", E=200000, nu=0.3, rho=7850)],
        sections=[SectionV2(id="s1", name="S", type="I")],
    )
    defaults.update(kwargs)
    return StructureModelV2(**defaults)


# ---------------------------------------------------------------------------
# Sub-model unit tests
# ---------------------------------------------------------------------------

class TestProjectInfo:
    def test_defaults(self):
        p = ProjectInfo()
        assert p.name is None
        assert p.extra == {}

    def test_full(self):
        p = ProjectInfo(
            name="test",
            code_standard="GB50011-2010",
            design_life=50,
            importance_class="丙",
        )
        assert p.design_life == 50


class TestStructureSystem:
    def test_valid_types(self):
        for t in ["frame", "frame-shear-wall", "shear-wall", "frame-tube",
                   "tube-in-tube", "braced-frame", "masonry", "other"]:
            ss = StructureSystem(type=t)
            assert ss.type == t

    def test_seismic_grades(self):
        for g in ["special", "first", "second", "third", "fourth", "none"]:
            ss = StructureSystem(seismic_grade=g)
            assert ss.seismic_grade == g


class TestSiteSeismicParams:
    def test_defaults(self):
        s = SiteSeismicParams()
        assert s.damping_ratio == 0.05

    def test_characteristic_period_non_negative(self):
        with pytest.raises(Exception):
            SiteSeismicParams(characteristic_period=-0.1)


class TestWindParams:
    def test_roughness_categories(self):
        for cat in ["A", "B", "C", "D"]:
            w = WindParams(terrain_roughness=cat)
            assert w.terrain_roughness == cat


class TestStoryDef:
    def test_basic(self):
        s = StoryDef(id="F1", height=3.6)
        assert s.is_basement is False
        assert s.rigid_diaphragm is True
        assert s.standard_floor_group is None

    def test_with_floor_loads(self):
        s = StoryDef(
            id="F1",
            height=3.0,
            floor_loads=[FloorLoad(type="dead", value=5.0)],
        )
        assert len(s.floor_loads) == 1

    def test_standard_floor_group(self):
        s = StoryDef(id="F2", height=3.0, standard_floor_group="STD-A")
        assert s.standard_floor_group == "STD-A"

    def test_dead_live_load_fields(self):
        s = StoryDef(id="F3", height=3.0, dead_load=5.0, live_load=2.0)
        assert s.dead_load == 5.0
        assert s.live_load == 2.0


class TestAnalysisControl:
    def test_defaults(self):
        ac = AnalysisControl()
        assert ac.p_delta is False
        assert ac.rigid_floor is True
        assert ac.consideration_torsion is True
        assert ac.basement_count is None
        assert ac.design_params == {}

    def test_period_reduction_bounds(self):
        with pytest.raises(Exception):
            AnalysisControl(period_reduction_factor=1.5)

    def test_extended_fields(self):
        ac = AnalysisControl(
            basement_count=1,
            vibration_mode_method="ritz",
            live_load_reduction=True,
            structure_importance_factor=1.1,
            damping_ratio_wind=0.02,
        )
        assert ac.basement_count == 1
        assert ac.vibration_mode_method == "ritz"
        assert ac.live_load_reduction is True
        assert ac.structure_importance_factor == 1.1


class TestSectionShape:
    def test_22_kinds(self):
        kinds = [
            "rectangular", "circular", "I", "H", "T", "L",
            "box", "hollow-circular", "channel", "Z", "cross",
            "thin-walled-I", "built-up-I", "built-up-box",
            "pipe", "double-angle", "unequal-angle",
            "CFT-circular", "CFT-rectangular", "SRC",
            "cold-formed-C", "custom",
        ]
        assert len(kinds) == 22
        for k in kinds:
            s = SectionShape(kind=k)
            assert s.kind == k

    def test_h_section_params(self):
        s = SectionShape(kind="H", H=400.0, B=200.0, tw=8.0, tf=13.0)
        assert s.H == 400.0
        assert s.B == 200.0
        assert s.tw == 8.0
        assert s.tf == 13.0

    def test_box_section_params(self):
        s = SectionShape(kind="box", H=300.0, B=300.0, T=16.0)
        assert s.T == 16.0

    def test_wall_section(self):
        """Wall sections only need kind='rectangular' + T (thickness mm)."""
        s = SectionShape(kind="rectangular", T=200.0)
        assert s.kind == "rectangular"
        assert s.T == 200.0

    def test_pipe_params(self):
        s = SectionShape(kind="pipe", d=219.0, T=8.0)
        assert s.d == 219.0

    def test_unequal_angle(self):
        s = SectionShape(kind="unequal-angle", a=100.0, a2=75.0, t=8.0)
        assert s.a2 == 75.0


class TestSectionV2:
    def test_legacy_compat(self):
        s = SectionV2(id="1", name="COL", type="rectangular", width=500, height=500)
        assert s.width == 500
        assert s.shape is None
        assert s.standard_steel_name is None

    def test_with_shape(self):
        s = SectionV2(
            id="s1", name="HN400x200", type="H",
            purpose="beam",
            shape=SectionShape(kind="H", H=400.0, B=200.0, tw=8.0, tf=13.0),
        )
        assert s.shape.kind == "H"
        assert s.purpose == "beam"

    def test_with_standard_steel_name(self):
        s = SectionV2(
            id="s2", name="HW200x200", type="H",
            purpose="column",
            standard_steel_name="HW200x200",
        )
        assert s.standard_steel_name == "HW200x200"

    def test_both_shape_and_name_allowed(self):
        """Both may coexist; standard_steel_name takes precedence by convention."""
        s = SectionV2(
            id="s3", name="H400", type="H",
            shape=SectionShape(kind="H", H=400.0, B=200.0),
            standard_steel_name="HN400x200",
        )
        assert s.shape is not None
        assert s.standard_steel_name is not None

    def test_purpose_values(self):
        for p in ["beam", "column", "wall", "slab", "brace", "other"]:
            s = SectionV2(id="x", name="X", type="I", purpose=p)
            assert s.purpose == p


class TestElementV2:
    def test_extended_types_including_brace(self):
        for t in ["beam", "column", "truss", "shell", "solid",
                   "wall", "slab", "link", "brace"]:
            e = ElementV2(id="1", type=t, nodes=["a", "b"], material="m1", section="s1")
            assert e.type == t

    def test_per_element_grades(self):
        e = ElementV2(
            id="C1", type="column", nodes=["1", "2"], material="m1", section="s1",
            concrete_grade="C35",
            steel_grade="Q355",
            rebar_grade="HRB400",
            seismic_grade="second",
        )
        assert e.concrete_grade == "C35"
        assert e.steel_grade == "Q355"
        assert e.seismic_grade == "second"

    def test_rotation_and_offsets(self):
        e = ElementV2(
            id="B1", type="beam", nodes=["1", "2"], material="m1", section="s1",
            rotation_angle=90.0,
            offsets={"i_z": 0.25, "j_z": 0.25},
        )
        assert e.rotation_angle == 90.0
        assert e.offsets["i_z"] == 0.25


class TestLoadCaseV2:
    def test_extended_types(self):
        for t in ["dead", "live", "wind", "seismic", "temperature",
                   "settlement", "crane", "snow", "other"]:
            lc = LoadCaseV2(id="1", type=t)
            assert lc.type == t

    def test_kind_field(self):
        for k in ["permanent", "variable", "accidental"]:
            lc = LoadCaseV2(id="1", kind=k)
            assert lc.kind == k

    def test_kind_defaults_none(self):
        lc = LoadCaseV2(id="D", type="dead")
        assert lc.kind is None


class TestLoadCombinationV2:
    def test_with_code_reference(self):
        lc = LoadCombinationV2(
            id="ULS1",
            factors={"D": 1.2, "L": 1.4},
            combination_type="uls",
            code_reference="GB50009-2012 §3.2",
        )
        assert lc.combination_type == "uls"


class TestWallOpening:
    def test_basic(self):
        wo = WallOpening(
            id="WO1", wall_element_id="W1",
            x_offset=1.0, z_offset=0.5,
            width=0.9, height=2.1,
        )
        assert wo.width == 0.9

    def test_negative_offset_rejected(self):
        with pytest.raises(Exception):
            WallOpening(
                id="WO1", wall_element_id="W1",
                x_offset=-0.1, z_offset=0.5,
                width=0.9, height=2.1,
            )


class TestSlabOpening:
    def test_basic(self):
        so = SlabOpening(id="SO1", story_id="F2", x=3.0, y=3.0, width=1.0, depth=1.0)
        assert so.shape == "rectangular"

    def test_circular_shape(self):
        so = SlabOpening(id="SO2", story_id="F2", x=2.0, y=2.0,
                         width=1.2, depth=1.2, shape="circular")
        assert so.shape == "circular"


# ---------------------------------------------------------------------------
# Full-model example validation
# ---------------------------------------------------------------------------

class TestExamplePayloads:
    def test_v2_rc_frame_example(self):
        data = _load_json("model_13_v2_rc_frame.json", v2=True)
        model = StructureModelV2(**data)
        assert model.schema_version == "2.0.0"
        assert model.project.name == "某办公楼框架结构"
        assert model.structure_system.type == "frame"
        assert len(model.stories) == 3
        assert len(model.elements) == 16

    def test_pkpm_shearwall_example(self):
        data = _load_json("model_14_pkpm_shearwall.json", v2=True)
        model = StructureModelV2(**data)
        assert model.schema_version == "2.0.0"
        assert model.structure_system.type == "shear-wall"
        assert model.structure_system.seismic_grade == "second"
        assert any(s.is_basement for s in model.stories)
        assert model.extensions.get("pkpm") is not None

    def test_pkpm_full_frame_example(self):
        data = _load_json("model_15_pkpm_full_frame.json", v2=True)
        model = StructureModelV2(**data)
        assert model.schema_version == "2.0.0"
        assert model.structure_system.type == "frame"
        assert len(model.stories) >= 3

    def test_steel_frame_example(self):
        data = _load_json("model_16_steel_frame.json", v2=True)
        model = StructureModelV2(**data)
        assert model.schema_version == "2.0.0"
        # All elements should have steel_grade set
        steel_elements = [e for e in model.elements if e.steel_grade]
        assert len(steel_elements) > 0
        # No concrete-only sections
        section_kinds = {s.shape.kind for s in model.sections if s.shape}
        assert section_kinds & {"H", "box", "pipe"}  # at least one steel shape


# ---------------------------------------------------------------------------
# V1 → V2 migration
# ---------------------------------------------------------------------------

class TestMigration:
    def test_v1_to_v2_migration(self):
        v1_data = _load_json("model_02_two_story_frame.json")
        v2_data = migrate_v1_to_v2(v1_data)
        model = StructureModelV2(**v2_data)
        assert model.schema_version == "2.0.0"
        assert model.project is None
        assert model.structure_system is None
        assert model.extensions == {}
        assert len(model.nodes) == 6
        assert len(model.elements) == 6
        assert model.metadata.get("schema_migration") == {
            "from": "1.0.0",
            "to": "2.0.0",
        }

    def test_all_v1_examples_migrate(self):
        for fname in sorted(EXAMPLES_DIR.glob("model_*.json")):
            with open(fname, encoding="utf-8") as fh:
                v1 = json.load(fh)
            if v1.get("schema_version", "").startswith("2"):
                continue
            v2 = migrate_v1_to_v2(v1)
            model = StructureModelV2(**v2)
            assert model.schema_version == "2.0.0", f"Migration failed for {fname.name}"

    def test_simply_supported_beam_migrates_with_canonical_pin_and_roller(self):
        v1 = _load_json("model_21_simply_supported_beam.json")
        migrated = migrate_v1_to_v2(v1)

        assert migrated["coordinate_system"]["dimension"] == "2d"
        assert migrated["coordinate_system"]["plane"] == "xz"
        assert migrated["nodes"][0]["restraints"] == [True, True, True, False, False, False]
        assert migrated["nodes"][2]["restraints"] == [False, True, True, False, False, False]
        assert migrated["load_cases"][0]["loads"][0]["fz"] == -20
        StructureModelV2.model_validate(migrated)

    def test_already_v2_data_migrates_as_noop(self):
        """Migrating a 2.0.0 payload should preserve schema_version."""
        v2_data = _load_json("model_13_v2_rc_frame.json", v2=True)
        result = migrate_v1_to_v2(v2_data)
        assert result["schema_version"] == "2.0.0"

    def test_untyped_v2_payload_is_rejected_instead_of_inferred(self):
        data = _load_json("model_13_v2_rc_frame.json", v2=True)
        data.pop("coordinate_system")
        with pytest.raises(ValueError, match="typed coordinate_system"):
            ensure_v2_dict(data)
        with pytest.raises(ValueError, match="coordinate_system"):
            StructureModelV2.model_validate(data)

    @pytest.mark.parametrize(
        "coordinate_system",
        [
            {},
            {"dimension": "2d", "plane": "xz"},
            {
                "semantics": "global-z-up",
                "version": 1,
                "dimension": "2d",
                "plane": "xz",
            },
        ],
    )
    def test_partial_v2_coordinate_contract_is_rejected(self, coordinate_system):
        data = _load_json("model_13_v2_rc_frame.json", v2=True)
        data["coordinate_system"] = coordinate_system
        with pytest.raises(ValueError, match="coordinate_system"):
            StructureModelV2.model_validate(data)

    def test_legacy_xz_load_aliases_migrate_to_canonical_components(self):
        data = _load_json("model_01_single_beam.json")
        data["load_cases"] = [{
            "id": "LC1",
            "loads": [
                {
                    "node": data["nodes"][-1]["id"],
                    "fy": -7.0,
                    "mz": 2.0,
                    "forces": [1.0, -7.0, 0.0, 4.0, 0.0, 2.0],
                },
                {"element": data["elements"][0]["id"], "wy": -3.0},
            ],
        }]
        migrated = migrate_v1_to_v2(data)
        load = migrated["load_cases"][0]["loads"][0]
        assert load["forces"] == [1.0, 0.0, -7.0, 0.0, 2.0, 0.0]
        assert not any(key in load for key in ("fx", "fy", "fz", "mx", "my", "mz"))
        member_load = migrated["load_cases"][0]["loads"][1]
        assert (member_load["wy"], member_load["wz"]) == (0.0, -3.0)
        assert migrated["coordinate_system"]["dimension"] == "2d"

    def test_explicit_y_up_v1_rotates_geometry_vectors_and_dofs(self):
        data = {
            "schema_version": "1.0.0",
            "metadata": {
                "coordinateSemantics": "legacy-global-y-up",
                "elementReferenceVectors": {"E1": [0.0, 0.0, 1.0]},
            },
            "nodes": [
                {
                    "id": "N1", "x": 0.0, "y": 0.0, "z": 0.0,
                    "restraints": [True, False, True, False, False, True],
                },
                {"id": "N2", "x": 1.0, "y": 2.0, "z": 3.0},
            ],
            "elements": [{"id": "E1", "nodes": ["N1", "N2"], "material": "M1", "section": "S1"}],
            "materials": [{"id": "M1", "name": "steel", "E": 200000, "nu": 0.3, "rho": 7850}],
            "sections": [{"id": "S1", "name": "section", "type": "custom"}],
            "load_cases": [{
                "id": "LC1",
                "loads": [{
                    "node": "N2",
                    "fx": 1.0, "fy": 2.0, "fz": 3.0,
                    "mx": 4.0, "my": 5.0, "mz": 6.0,
                    "forces": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
                }],
            }],
        }
        migrated = migrate_v1_to_v2(data)
        assert migrated["nodes"][1] == {"id": "N2", "x": 1.0, "y": -3.0, "z": 2.0}
        assert migrated["nodes"][0]["restraints"] == [True, True, False, False, True, False]
        load = migrated["load_cases"][0]["loads"][0]
        assert load["forces"] == [1.0, -3.0, 2.0, 4.0, -6.0, 5.0]
        assert not any(key in load for key in ("fx", "fy", "fz", "mx", "my", "mz"))
        assert migrated["metadata"]["elementReferenceVectors"]["E1"] == [0.0, -1.0, 0.0]
        assert migrated["coordinate_system"]["dimension"] == "3d"

    def test_planar_v1_reference_vectors_are_replaced_by_fixed_xz_axes(self):
        data = {
            "schema_version": "1.0.0",
            "metadata": {
                "coordinateSemantics": "legacy-global-y-up",
                "elementReferenceVectors": {"E1": [0.0, 0.0, 1.0]},
            },
            "nodes": [
                {"id": "N1", "x": 0.0, "y": 0.0, "z": 0.0},
                {"id": "N2", "x": 5.0, "y": 3.0, "z": 0.0},
            ],
            "elements": [],
        }
        migrated = migrate_v1_to_v2(data)
        assert migrated["coordinate_system"]["dimension"] == "2d"
        assert migrated["nodes"][1] == {"id": "N2", "x": 5.0, "y": -0.0, "z": 3.0}
        assert "elementReferenceVectors" not in migrated["metadata"]
        assert migrated["metadata"]["coordinate_local_axis_migration"]["to"] == "fixed-canonical-xz-local-axes"
        StructureModelV2.model_validate(migrated)

    def test_untagged_genuine_3d_v1_is_preserved_as_historical_z_up(self):
        data = {
            "schema_version": "1.0.0",
            "nodes": [
                {"id": "N1", "x": 0.0, "y": 0.0, "z": 0.0},
                {"id": "N2", "x": 1.0, "y": 2.0, "z": 3.0},
            ],
            "elements": [],
        }
        migrated = migrate_v1_to_v2(data)
        assert migrated["nodes"] == data["nodes"]
        assert migrated["coordinate_system"]["dimension"] == "3d"


# ---------------------------------------------------------------------------
# Cross-reference validation
# ---------------------------------------------------------------------------

class TestCrossReferenceValidation:
    @pytest.mark.parametrize(
        ("load", "message"),
        [
            ({"fz": -5.0}, "exactly one node or element"),
            ({"node": "2", "element": "e1", "fz": -5.0}, "exactly one node or element"),
            ({"node": "1", "nodeId": "2", "fz": -5.0}, "conflicting aliases"),
        ],
    )
    def test_load_requires_exactly_one_unambiguous_target(self, load, message):
        with pytest.raises(ValueError, match=message):
            _minimal_model(load_cases=[LoadCaseV2(id="D", type="dead", loads=[load])])

    def test_unknown_node_reference(self):
        with pytest.raises(ValueError, match="unknown node"):
            _minimal_model(
                elements=[ElementV2(id="e1", nodes=["1", "999"], material="m1", section="s1")]
            )

    def test_unknown_material_reference(self):
        with pytest.raises(ValueError, match="unknown material"):
            _minimal_model(
                elements=[ElementV2(id="e1", nodes=["1", "2"], material="missing", section="s1")]
            )

    def test_unknown_section_reference(self):
        with pytest.raises(ValueError, match="unknown section"):
            _minimal_model(
                elements=[ElementV2(id="e1", nodes=["1", "2"], material="m1", section="missing")]
            )

    def test_unknown_story_reference_element(self):
        with pytest.raises(ValueError, match="unknown story"):
            StructureModelV2(
                coordinate_system=CoordinateSystemV2(**_coordinate_system()),
                stories=[StoryDef(id="F1", height=3.0)],
                nodes=[NodeV2(id="1", x=0, y=0, z=0), NodeV2(id="2", x=1, y=0, z=0)],
                elements=[ElementV2(id="e1", nodes=["1", "2"], material="m1",
                                    section="s1", story="MISSING")],
                materials=[MaterialV2(id="m1", name="S", E=200000, nu=0.3, rho=7850)],
                sections=[SectionV2(id="s1", name="S", type="I")],
            )

    def test_unknown_load_case_in_combination(self):
        with pytest.raises(ValueError, match="unknown load case"):
            StructureModelV2(
                coordinate_system=CoordinateSystemV2(**_coordinate_system()),
                load_cases=[LoadCaseV2(id="D", type="dead")],
                load_combinations=[LoadCombinationV2(id="C1", factors={"D": 1.2, "MISSING": 1.0})],
            )

    def test_wall_opening_unknown_element(self):
        with pytest.raises(ValueError, match="unknown element"):
            StructureModelV2(
                coordinate_system=CoordinateSystemV2(**_coordinate_system()),
                nodes=[NodeV2(id="1", x=0, y=0, z=0), NodeV2(id="2", x=6, y=0, z=0)],
                elements=[ElementV2(id="W1", type="wall", nodes=["1", "2"],
                                    material="m1", section="s1")],
                materials=[MaterialV2(id="m1", name="C40", E=32500, nu=0.2, rho=2500)],
                sections=[SectionV2(id="s1", name="wall", type="rectangular")],
                wall_openings=[WallOpening(id="WO1", wall_element_id="MISSING",
                                           x_offset=1.0, z_offset=0.5,
                                           width=0.9, height=2.1)],
            )

    def test_slab_opening_unknown_story(self):
        with pytest.raises(ValueError, match="unknown story"):
            StructureModelV2(
                coordinate_system=CoordinateSystemV2(**_coordinate_system()),
                stories=[StoryDef(id="F1", height=3.0)],
                slab_openings=[SlabOpening(id="SO1", story_id="MISSING",
                                           x=2.0, y=2.0, width=1.0, depth=1.0)],
            )

    def test_valid_model_with_openings(self):
        model = StructureModelV2(
            coordinate_system=CoordinateSystemV2(**_coordinate_system()),
            stories=[StoryDef(id="F1", height=3.0)],
            nodes=[NodeV2(id="1", x=0, y=0, z=0), NodeV2(id="2", x=6, y=0, z=0)],
            elements=[ElementV2(id="W1", type="wall", nodes=["1", "2"],
                                material="m1", section="s1", story="F1")],
            materials=[MaterialV2(id="m1", name="C40", E=32500, nu=0.2, rho=2500)],
            sections=[SectionV2(id="s1", name="wall", type="rectangular")],
            wall_openings=[WallOpening(id="WO1", wall_element_id="W1",
                                       x_offset=1.0, z_offset=0.5,
                                       width=0.9, height=2.1)],
            slab_openings=[SlabOpening(id="SO1", story_id="F1",
                                       x=3.0, y=3.0, width=1.0, depth=1.0)],
        )
        assert len(model.wall_openings) == 1
        assert len(model.slab_openings) == 1

    def test_valid_model_passes(self):
        model = _minimal_model(
            stories=[StoryDef(id="F1", height=3.0)],
            load_cases=[LoadCaseV2(id="D", type="dead")],
            load_combinations=[LoadCombinationV2(id="C1", factors={"D": 1.2})],
        )
        assert model.schema_version == "2.0.0"
