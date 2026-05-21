from __future__ import annotations

import sys
import unittest
from pathlib import Path


TEST_DIR = Path(__file__).resolve().parent
OPENSEES_STATIC_DIR = TEST_DIR.parent
BACKEND_SRC_DIR = OPENSEES_STATIC_DIR.parents[2]

sys.path.insert(0, str(OPENSEES_STATIC_DIR))
sys.path.insert(0, str(BACKEND_SRC_DIR / "skill-shared" / "python"))

from opensees_static_simplified_static_analysis import StaticAnalyzer  # noqa: E402
from structure_protocol.structure_model_v2 import StructureModelV2  # noqa: E402


def build_model(load_cases=None, load_combinations=None) -> StructureModelV2:
    return StructureModelV2.model_validate({
        "schema_version": "2.0.0",
        "unit_system": "SI",
        "stories": [
            {
                "id": "F1",
                "height": 3.6,
                "elevation": 0.0,
                "floor_loads": [
                    {"type": "dead", "value": 4.0},
                    {"type": "live", "value": 2.0},
                ],
            }
        ],
        "nodes": [
            {"id": "B1", "x": 0.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "B2", "x": 6.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "B3", "x": 0.0, "y": 6.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "B4", "x": 6.0, "y": 6.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "T1", "x": 0.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "T2", "x": 6.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "T3", "x": 0.0, "y": 6.0, "z": 3.6, "story": "F1"},
            {"id": "T4", "x": 6.0, "y": 6.0, "z": 3.6, "story": "F1"},
        ],
        "load_cases": load_cases if load_cases is not None else [],
        "load_combinations": load_combinations if load_combinations is not None else [],
    })


class FloorLoadExpansionTest(unittest.TestCase):
    def test_expands_story_floor_loads_to_gravity_nodal_loads(self) -> None:
        analyzer = StaticAnalyzer(build_model())

        loads = analyzer._collect_nodal_loads({})

        self.assertEqual(len(loads), 4)
        self.assertAlmostEqual(sum(load["fz"] for load in loads), -216.0)
        self.assertEqual({load["node"] for load in loads}, {"T1", "T2", "T3", "T4"})

    def test_applies_load_combination_factors_by_floor_load_type(self) -> None:
        analyzer = StaticAnalyzer(build_model(
            load_cases=[
                {"id": "D", "type": "dead", "loads": []},
                {"id": "L", "type": "live", "loads": []},
            ],
            load_combinations=[
                {"id": "ULS", "factors": {"D": 1.2, "L": 1.4}},
            ],
        ))

        loads = analyzer._collect_nodal_loads({"loadCombinationId": "ULS"})

        self.assertEqual(len(loads), 4)
        self.assertAlmostEqual(sum(load["fz"] for load in loads), -273.6)

    def test_explicit_load_cases_take_precedence_over_default_floor_loads(self) -> None:
        analyzer = StaticAnalyzer(build_model(
            load_cases=[
                {"id": "LC1", "type": "other", "loads": [{"node": "T1", "fz": -10.0}]},
            ],
        ))

        loads = analyzer._collect_nodal_loads({})

        self.assertEqual(loads, [{
            "type": "nodal",
            "node": "T1",
            "fx": 0.0,
            "fy": 0.0,
            "fz": -10.0,
            "mx": 0.0,
            "my": 0.0,
            "mz": 0.0,
            "forces": [0.0, 0.0, -10.0, 0.0, 0.0, 0.0],
        }])


if __name__ == "__main__":
    unittest.main()
