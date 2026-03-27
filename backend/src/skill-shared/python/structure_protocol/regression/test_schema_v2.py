"""Regression tests for StructureModelV2 schema validation."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Ensure the structure_protocol package is importable
_PROTOCOL_ROOT = Path(__file__).resolve().parent.parent
if str(_PROTOCOL_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROTOCOL_ROOT))

from structure_protocol.structure_model_v2 import (
    AnalysisControl,
    ElementV2,
    FloorLoad,
    LoadCaseV2,
    LoadCombinationV2,
    MaterialV2,
    NodeV2,
    ProjectInfo,
    SectionV2,
    SiteSeismicParams,
    StoryDef,
    StructureModelV2,
    StructureSystem,
    WindParams,
)
from structure_protocol.migrations import migrate_structure_model_v1 as migrate_v1_to_v2

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "examples"
EXAMPLES_V2_DIR = Path(__file__).resolve().parent.parent / "examples_v2"


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _load_json(name: str, v2: bool = False) -> dict:
    base = EXAMPLES_V2_DIR if v2 else EXAMPLES_DIR
    with open(base / name, encoding="utf-8") as fh:
        return json.load(fh)


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
        for t in ["frame", "frame-shear-wall", "shear-wall", "frame-tube", "tube-in-tube",
                   "braced-frame", "masonry", "other"]:
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

    def test_with_floor_loads(self):
        s = StoryDef(
            id="F1",
            height=3.0,
            floor_loads=[FloorLoad(type="dead", value=5.0)],
        )
        assert len(s.floor_loads) == 1


class TestAnalysisControl:
    def test_defaults(self):
        ac = AnalysisControl()
        assert ac.p_delta is False
        assert ac.rigid_floor is True
        assert ac.consideration_torsion is True

    def test_period_reduction_bounds(self):
        with pytest.raises(Exception):
            AnalysisControl(period_reduction_factor=1.5)


class TestMaterialV2:
    def test_with_grade(self):
        m = MaterialV2(
            id="1", name="C30", E=30000, nu=0.2, rho=2500,
            grade="C30", category="concrete",
        )
        assert m.grade == "C30"
        assert m.category == "concrete"


class TestElementV2:
    def test_extended_types(self):
        for t in ["beam", "column", "truss", "shell", "solid", "wall", "slab", "link"]:
            e = ElementV2(id="1", type=t, nodes=["a", "b"], material="m1", section="s1")
            assert e.type == t


class TestSectionV2:
    def test_with_dimensions(self):
        s = SectionV2(id="1", name="COL", type="rectangular", width=500, height=500)
        assert s.width == 500


class TestLoadCaseV2:
    def test_extended_types(self):
        for t in ["dead", "live", "wind", "seismic", "temperature",
                   "settlement", "crane", "snow", "other"]:
            lc = LoadCaseV2(id="1", type=t)
            assert lc.type == t


class TestLoadCombinationV2:
    def test_with_code_reference(self):
        lc = LoadCombinationV2(
            id="ULS1",
            factors={"D": 1.2, "L": 1.4},
            combination_type="uls",
            code_reference="GB50009-2012 §3.2",
        )
        assert lc.combination_type == "uls"


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
        # Original V1 data should be intact
        assert len(model.nodes) == 6
        assert len(model.elements) == 6
        assert model.metadata.get("schema_migration") == {
            "from": "1.0.0",
            "to": "2.0.0",
        }

    def test_all_v1_examples_migrate(self):
        """Every existing V1 example should migrate cleanly to V2."""
        for fname in sorted(EXAMPLES_DIR.glob("model_*.json")):
            with open(fname, encoding="utf-8") as fh:
                v1 = json.load(fh)
            if v1.get("schema_version", "").startswith("2"):
                continue
            v2 = migrate_v1_to_v2(v1)
            model = StructureModelV2(**v2)
            assert model.schema_version == "2.0.0", f"Migration failed for {fname.name}"


# ---------------------------------------------------------------------------
# Cross-reference validation
# ---------------------------------------------------------------------------

class TestCrossReferenceValidation:
    def test_unknown_node_reference(self):
        with pytest.raises(ValueError, match="unknown node"):
            StructureModelV2(
                nodes=[NodeV2(id="1", x=0, y=0, z=0)],
                elements=[ElementV2(id="e1", nodes=["1", "999"], material="m1", section="s1")],
                materials=[MaterialV2(id="m1", name="S", E=200000, nu=0.3, rho=7850)],
                sections=[SectionV2(id="s1", name="S", type="I")],
            )

    def test_unknown_material_reference(self):
        with pytest.raises(ValueError, match="unknown material"):
            StructureModelV2(
                nodes=[NodeV2(id="1", x=0, y=0, z=0), NodeV2(id="2", x=1, y=0, z=0)],
                elements=[ElementV2(id="e1", nodes=["1", "2"], material="missing", section="s1")],
                materials=[MaterialV2(id="m1", name="S", E=200000, nu=0.3, rho=7850)],
                sections=[SectionV2(id="s1", name="S", type="I")],
            )

    def test_unknown_section_reference(self):
        with pytest.raises(ValueError, match="unknown section"):
            StructureModelV2(
                nodes=[NodeV2(id="1", x=0, y=0, z=0), NodeV2(id="2", x=1, y=0, z=0)],
                elements=[ElementV2(id="e1", nodes=["1", "2"], material="m1", section="missing")],
                materials=[MaterialV2(id="m1", name="S", E=200000, nu=0.3, rho=7850)],
                sections=[SectionV2(id="s1", name="S", type="I")],
            )

    def test_unknown_story_reference_element(self):
        with pytest.raises(ValueError, match="unknown story"):
            StructureModelV2(
                stories=[StoryDef(id="F1", height=3.0)],
                nodes=[NodeV2(id="1", x=0, y=0, z=0), NodeV2(id="2", x=1, y=0, z=0)],
                elements=[ElementV2(id="e1", nodes=["1", "2"], material="m1", section="s1", story="MISSING")],
                materials=[MaterialV2(id="m1", name="S", E=200000, nu=0.3, rho=7850)],
                sections=[SectionV2(id="s1", name="S", type="I")],
            )

    def test_unknown_load_case_in_combination(self):
        with pytest.raises(ValueError, match="unknown load case"):
            StructureModelV2(
                load_cases=[LoadCaseV2(id="D", type="dead")],
                load_combinations=[LoadCombinationV2(id="C1", factors={"D": 1.2, "MISSING": 1.0})],
            )

    def test_valid_model_passes(self):
        """A fully-valid minimal model should not raise."""
        model = StructureModelV2(
            stories=[StoryDef(id="F1", height=3.0)],
            nodes=[NodeV2(id="1", x=0, y=0, z=0, story="F1"),
                   NodeV2(id="2", x=1, y=0, z=0, story="F1")],
            elements=[ElementV2(id="e1", nodes=["1", "2"], material="m1", section="s1", story="F1")],
            materials=[MaterialV2(id="m1", name="S", E=200000, nu=0.3, rho=7850)],
            sections=[SectionV2(id="s1", name="S", type="I")],
            load_cases=[LoadCaseV2(id="D", type="dead")],
            load_combinations=[LoadCombinationV2(id="C1", factors={"D": 1.2})],
        )
        assert model.schema_version == "2.0.0"
