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


def build_model(
    load_cases=None,
    load_combinations=None,
    *,
    include_floor_beams: bool = False,
    span_x: float = 6.0,
    span_y: float = 6.0,
) -> StructureModelV2:
    payload = {
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
            {"id": "B2", "x": span_x, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "B3", "x": 0.0, "y": span_y, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "B4", "x": span_x, "y": span_y, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "T1", "x": 0.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "T2", "x": span_x, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "T3", "x": 0.0, "y": span_y, "z": 3.6, "story": "F1"},
            {"id": "T4", "x": span_x, "y": span_y, "z": 3.6, "story": "F1"},
        ],
        "load_cases": load_cases if load_cases is not None else [],
        "load_combinations": load_combinations if load_combinations is not None else [],
    }
    if include_floor_beams:
        payload["materials"] = [
            {"id": "1", "name": "Q355", "E": 206000.0, "nu": 0.3, "rho": 7850.0, "fy": 355.0}
        ]
        payload["sections"] = [
            {
                "id": "1",
                "name": "beam",
                "type": "rectangular",
                "properties": {"A": 0.1, "Iy": 0.01, "Iz": 0.01, "J": 0.02, "G": 79000.0},
            }
        ]
        payload["elements"] = [
            {"id": "X0", "type": "beam", "nodes": ["T1", "T2"], "material": "1", "section": "1", "story": "F1"},
            {"id": "X1", "type": "beam", "nodes": ["T3", "T4"], "material": "1", "section": "1", "story": "F1"},
            {"id": "Y0", "type": "beam", "nodes": ["T1", "T3"], "material": "1", "section": "1", "story": "F1"},
            {"id": "Y1", "type": "beam", "nodes": ["T2", "T4"], "material": "1", "section": "1", "story": "F1"},
        ]

    return StructureModelV2.model_validate(payload)


def build_two_story_mixed_support_model() -> StructureModelV2:
    payload = {
        "schema_version": "2.0.0",
        "unit_system": "SI",
        "stories": [
            {
                "id": "F1",
                "height": 3.6,
                "elevation": 0.0,
                "floor_loads": [{"type": "dead", "value": 4.0}, {"type": "live", "value": 2.0}],
            },
            {
                "id": "F2",
                "height": 3.6,
                "elevation": 3.6,
                "floor_loads": [{"type": "dead", "value": 4.0}, {"type": "live", "value": 2.0}],
            },
        ],
        "nodes": [
            {"id": "T1", "x": 0.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "T2", "x": 6.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "T3", "x": 0.0, "y": 6.0, "z": 3.6, "story": "F1"},
            {"id": "T4", "x": 6.0, "y": 6.0, "z": 3.6, "story": "F1"},
            {"id": "U1", "x": 0.0, "y": 0.0, "z": 7.2, "story": "F2"},
            {"id": "U2", "x": 6.0, "y": 0.0, "z": 7.2, "story": "F2"},
            {"id": "U3", "x": 0.0, "y": 6.0, "z": 7.2, "story": "F2"},
            {"id": "U4", "x": 6.0, "y": 6.0, "z": 7.2, "story": "F2"},
        ],
        "materials": [{"id": "1", "name": "Q355", "E": 206000.0, "nu": 0.3, "rho": 7850.0, "fy": 355.0}],
        "sections": [
            {
                "id": "1",
                "name": "beam",
                "type": "rectangular",
                "properties": {"A": 0.1, "Iy": 0.01, "Iz": 0.01, "J": 0.02, "G": 79000.0},
            }
        ],
        "elements": [
            {"id": "X0", "type": "beam", "nodes": ["T1", "T2"], "material": "1", "section": "1", "story": "F1"},
            {"id": "X1", "type": "beam", "nodes": ["T3", "T4"], "material": "1", "section": "1", "story": "F1"},
            {"id": "Y0", "type": "beam", "nodes": ["T1", "T3"], "material": "1", "section": "1", "story": "F1"},
            {"id": "Y1", "type": "beam", "nodes": ["T2", "T4"], "material": "1", "section": "1", "story": "F1"},
        ],
    }
    return StructureModelV2.model_validate(payload)


def build_continuous_beam_floor_model() -> StructureModelV2:
    payload = {
        "schema_version": "2.0.0",
        "unit_system": "SI",
        "stories": [
            {
                "id": "F1",
                "height": 3.6,
                "elevation": 0.0,
                "floor_loads": [{"type": "dead", "value": 4.0}, {"type": "live", "value": 2.0}],
            }
        ],
        "nodes": [
            {"id": "A0", "x": 0.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "A1", "x": 6.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "A2", "x": 12.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "B0", "x": 0.0, "y": 6.0, "z": 3.6, "story": "F1"},
            {"id": "B1", "x": 6.0, "y": 6.0, "z": 3.6, "story": "F1"},
            {"id": "B2", "x": 12.0, "y": 6.0, "z": 3.6, "story": "F1"},
        ],
        "materials": [{"id": "1", "name": "Q355", "E": 206000.0, "nu": 0.3, "rho": 7850.0, "fy": 355.0}],
        "sections": [
            {
                "id": "1",
                "name": "beam",
                "type": "rectangular",
                "properties": {"A": 0.1, "Iy": 0.01, "Iz": 0.01, "J": 0.02, "G": 79000.0},
            }
        ],
        "elements": [
            {"id": "X0", "type": "beam", "nodes": ["A0", "A2"], "material": "1", "section": "1", "story": "F1"},
            {"id": "X1", "type": "beam", "nodes": ["B0", "B2"], "material": "1", "section": "1", "story": "F1"},
        ],
    }
    return StructureModelV2.model_validate(payload)


class FloorLoadExpansionTest(unittest.TestCase):
    def test_expands_story_floor_loads_to_gravity_nodal_loads(self) -> None:
        analyzer = StaticAnalyzer(build_model())

        loads = analyzer._collect_nodal_loads({})

        self.assertEqual(len(loads), 4)
        self.assertAlmostEqual(sum(load["fz"] for load in loads), -216.0)
        self.assertEqual({load["node"] for load in loads}, {"T1", "T2", "T3", "T4"})
        transfer = analyzer._floor_load_transfer_summary()
        self.assertIsNotNone(transfer)
        self.assertEqual(transfer["effectiveMode"], "node_tributary")
        self.assertIn("Node tributary-area", transfer["method"])
        self.assertEqual(transfer["methodZh"], "节点影响面积等效节点荷载")

    def test_auto_code_cn_uses_two_way_slab_for_square_panel(self) -> None:
        analyzer = StaticAnalyzer(build_model(include_floor_beams=True))

        loads = analyzer._collect_nodal_loads({})

        self.assertEqual(len(loads), 4)
        self.assertTrue(all(load["type"] == "distributed" for load in loads))
        self.assertEqual({load["element"] for load in loads}, {"X0", "X1", "Y0", "Y1"})
        self.assertTrue(all(load["wz"] < 0.0 for load in loads))
        self.assertAlmostEqual(sum(-load["wz"] * 6.0 for load in loads), 216.0)
        transfer = analyzer._floor_load_transfer_summary()
        self.assertIsNotNone(transfer)
        self.assertEqual(transfer["requestedMode"], "auto_code_cn")
        self.assertEqual(transfer["effectiveMode"], "two_way_slab")
        self.assertEqual(transfer["methodZh"], "双向板传至支承梁并折算为等效均布梁荷载")
        self.assertEqual(transfer["items"][0]["effectiveMode"], "two_way_slab")
        self.assertIn("GB 50010", transfer["items"][0]["designCodeRule"])
        self.assertEqual(transfer["items"][0]["methodZh"], "双向板传至支承梁并折算为等效均布梁荷载")
        self.assertIn("按双向板计算", transfer["items"][0]["designCodeRuleZh"])

    def test_auto_code_cn_uses_one_way_slab_for_long_panel(self) -> None:
        analyzer = StaticAnalyzer(build_model(include_floor_beams=True, span_x=3.0, span_y=12.0))

        loads = analyzer._collect_nodal_loads({})

        self.assertEqual(len(loads), 2)
        self.assertEqual({load["element"] for load in loads}, {"Y0", "Y1"})
        self.assertAlmostEqual(sum(-load["wz"] * 12.0 for load in loads), 216.0)
        transfer = analyzer._floor_load_transfer_summary()
        self.assertIsNotNone(transfer)
        self.assertEqual(transfer["effectiveMode"], "one_way_slab")
        self.assertEqual(transfer["methodZh"], "单向板传至支承梁")
        self.assertEqual(transfer["items"][0]["effectiveMode"], "one_way_slab")
        self.assertIn("long/short span ratio >= 3.0", transfer["items"][0]["designCodeRule"])
        self.assertEqual(transfer["items"][0]["methodZh"], "单向板传至支承梁")

    def test_falls_back_to_node_tributary_per_story_when_slab_support_is_incomplete(self) -> None:
        analyzer = StaticAnalyzer(build_two_story_mixed_support_model())

        loads = analyzer._collect_nodal_loads({})

        distributed_loads = [load for load in loads if load["type"] == "distributed"]
        nodal_loads = [load for load in loads if load["type"] == "nodal"]
        self.assertEqual(len(distributed_loads), 4)
        self.assertEqual(len(nodal_loads), 4)
        self.assertEqual({load["node"] for load in nodal_loads}, {"U1", "U2", "U3", "U4"})
        self.assertAlmostEqual(sum(-load["wz"] * 6.0 for load in distributed_loads), 216.0)
        self.assertAlmostEqual(sum(-load["fz"] for load in nodal_loads), 216.0)
        transfer = analyzer._floor_load_transfer_summary()
        self.assertIsNotNone(transfer)
        self.assertEqual(transfer["effectiveMode"], "mixed")
        self.assertEqual({item["effectiveMode"] for item in transfer["items"]}, {"two_way_slab", "node_tributary"})
        self.assertTrue(any("falling back to node tributary-area" in warning for warning in transfer["warnings"]))

    def test_continuous_floor_beams_can_support_panel_segments(self) -> None:
        analyzer = StaticAnalyzer(build_continuous_beam_floor_model())

        loads = analyzer._collect_nodal_loads({})

        self.assertEqual(len(loads), 4)
        self.assertEqual({load["element"] for load in loads}, {"X0", "X1"})
        self.assertTrue(all(load.get("tributarySegmentLength") == 6.0 for load in loads))
        self.assertAlmostEqual(sum(-load["wz"] * load["elementLength"] for load in loads), 432.0)
        transfer = analyzer._floor_load_transfer_summary()
        self.assertIsNotNone(transfer)
        self.assertEqual(transfer["effectiveMode"], "one_way_slab")

    def test_can_force_node_tributary_method(self) -> None:
        analyzer = StaticAnalyzer(build_model(include_floor_beams=True))

        loads = analyzer._collect_nodal_loads({"floorLoadTransferMode": "node_tributary"})

        self.assertEqual(len(loads), 4)
        self.assertTrue(all(load["type"] == "nodal" for load in loads))
        self.assertAlmostEqual(sum(load["fz"] for load in loads), -216.0)
        transfer = analyzer._floor_load_transfer_summary()
        self.assertIsNotNone(transfer)
        self.assertEqual(transfer["requestedMode"], "node_tributary")
        self.assertEqual(transfer["effectiveMode"], "node_tributary")
        self.assertEqual(transfer["methodZh"], "节点影响面积等效节点荷载")

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

    def test_infers_common_load_case_id_prefixes_for_floor_load_types(self) -> None:
        analyzer = StaticAnalyzer(build_model(
            load_cases=[
                {"id": "LC-DEAD", "type": "other", "loads": []},
                {"id": "LC-LIVE", "type": "other", "loads": []},
            ],
            load_combinations=[
                {"id": "ULS", "factors": {"LC-DEAD": 1.2, "LC-LIVE": 1.4}},
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
