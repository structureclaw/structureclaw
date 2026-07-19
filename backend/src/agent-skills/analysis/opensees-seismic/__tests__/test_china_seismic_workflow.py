from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path


TEST_DIR = Path(__file__).resolve().parent
OPENSEES_SEISMIC_DIR = TEST_DIR.parent
BACKEND_SRC_DIR = OPENSEES_SEISMIC_DIR.parents[2]

sys.path.insert(0, str(OPENSEES_SEISMIC_DIR))
sys.path.insert(0, str(OPENSEES_SEISMIC_DIR.parent))
sys.path.insert(0, str(OPENSEES_SEISMIC_DIR.parent / "runtime"))
sys.path.insert(0, str(BACKEND_SRC_DIR / "skill-shared" / "python"))

from design_basis import build_design_basis  # noqa: E402
from ground_motion import _story_drift_snapshot, parse_ground_motions, run_modal_time_history, select_ground_motions_for_direction  # noqa: E402
from ground_motion_catalog import list_recorded_reference_catalog, resolve_builtin_catalog_records, resolve_catalog_records  # noqa: E402
from method_decision import decide_seismic_method  # noqa: E402
from modal import ModalAnalysis  # noqa: E402
from regularity import assess_regularity  # noqa: E402
from result_adapter import build_pushover_seismic_result, build_seismic_result  # noqa: E402
from response_spectrum import apply_minimum_story_shear_adjustment, run_response_spectrum  # noqa: E402
from runtime import run_analysis as run_seismic_analysis  # noqa: E402
from spectrum import generate_design_spectrum, seismic_influence_coefficient  # noqa: E402
from structure_protocol.structure_model_v2 import StructureModelV2  # noqa: E402


def _coordinate_system(dimension: str) -> dict:
    return {
        "semantics": "global-z-up",
        "version": 1,
        "dimension": dimension,
        "plane": "xz" if dimension == "2d" else None,
        "dof_order": ["ux", "uy", "uz", "rx", "ry", "rz"],
    }


def expected_gb50011_alpha(period: float, alpha_max: float, tg: float, damping_ratio: float) -> float:
    damping = max(0.01, min(0.20, damping_ratio))
    gamma = 0.9 + (0.05 - damping) / (0.3 + 6.0 * damping)
    eta1 = max(0.0, 0.02 + (0.05 - damping) / (4.0 + 32.0 * damping))
    eta2 = max(0.55, 1.0 + (0.05 - damping) / (0.08 + 1.6 * damping))
    t = max(float(period), 0.0)
    if t < 0.1:
        alpha = alpha_max * (0.45 + (t / 0.1) * (eta2 - 0.45))
    elif t < tg:
        alpha = alpha_max * eta2
    elif t < 5.0 * tg:
        alpha = alpha_max * ((tg / max(t, 1e-6)) ** gamma) * eta2
    else:
        alpha = alpha_max * ((eta2 * (0.2 ** gamma)) - eta1 * (t - 5.0 * tg))
    return round(max(alpha, 0.2 * alpha_max), 6)


def build_frame_model() -> StructureModelV2:
    return StructureModelV2.model_validate({
        "schema_version": "2.0.0",
        "unit_system": "SI",
        "coordinate_system": _coordinate_system("2d"),
        "site_seismic": {
            "intensity": 8,
            "design_group": "2",
            "site_category": "III",
            "max_influence_coefficient": 0.16,
            "extra": {"acceleration_g": 0.20},
        },
        "stories": [
            {"id": "F1", "height": 3.6, "elevation": 0.0, "floor_loads": [{"type": "dead", "value": 5.0}]},
            {"id": "F2", "height": 3.6, "elevation": 3.6, "floor_loads": [{"type": "dead", "value": 5.0}]},
        ],
        "nodes": [
            {"id": "B1", "x": 0.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "B2", "x": 6.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "T1", "x": 0.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "T2", "x": 6.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "U1", "x": 0.0, "y": 0.0, "z": 7.2, "story": "F2"},
            {"id": "U2", "x": 6.0, "y": 0.0, "z": 7.2, "story": "F2"},
        ],
        "materials": [{"id": "1", "name": "C30", "E": 30000.0, "nu": 0.2, "rho": 2500.0}],
        "sections": [
            {"id": "1", "name": "500X500", "type": "rectangular", "properties": {"A": 0.25, "Iy": 0.005, "Iz": 0.005, "J": 0.01, "G": 12500.0}}
        ],
        "elements": [
            {"id": "C1", "type": "column", "nodes": ["B1", "T1"], "material": "1", "section": "1"},
            {"id": "C2", "type": "column", "nodes": ["B2", "T2"], "material": "1", "section": "1"},
            {"id": "C3", "type": "column", "nodes": ["T1", "U1"], "material": "1", "section": "1"},
            {"id": "C4", "type": "column", "nodes": ["T2", "U2"], "material": "1", "section": "1"},
            {"id": "B1", "type": "beam", "nodes": ["T1", "T2"], "material": "1", "section": "1"},
            {"id": "B2", "type": "beam", "nodes": ["U1", "U2"], "material": "1", "section": "1"},
        ],
        "metadata": {"structuralTypeKey": "concrete-frame", "storyCount": 2},
    })


def build_space_frame_model() -> StructureModelV2:
    nodes = []
    for prefix, z, story, restrained in (
        ("B", 0.0, None, True),
        ("T", 3.6, "F1", False),
        ("U", 7.2, "F2", False),
    ):
        for x_index, x in enumerate((0.0, 6.0)):
            for y_index, y in enumerate((0.0, 5.0)):
                node = {"id": f"{prefix}{x_index}{y_index}", "x": x, "y": y, "z": z}
                if story:
                    node["story"] = story
                if restrained:
                    node["restraints"] = [True, True, True, True, True, True]
                nodes.append(node)
    elements = []
    for x_index in range(2):
        for y_index in range(2):
            elements.append({"id": f"C1{x_index}{y_index}", "type": "column", "nodes": [f"B{x_index}{y_index}", f"T{x_index}{y_index}"], "material": "1", "section": "1"})
            elements.append({"id": f"C2{x_index}{y_index}", "type": "column", "nodes": [f"T{x_index}{y_index}", f"U{x_index}{y_index}"], "material": "1", "section": "1"})
    for prefix in ("T", "U"):
        elements.extend([
            {"id": f"{prefix}BX0", "type": "beam", "nodes": [f"{prefix}00", f"{prefix}10"], "material": "1", "section": "1"},
            {"id": f"{prefix}BX1", "type": "beam", "nodes": [f"{prefix}01", f"{prefix}11"], "material": "1", "section": "1"},
            {"id": f"{prefix}BY0", "type": "beam", "nodes": [f"{prefix}00", f"{prefix}01"], "material": "1", "section": "1"},
            {"id": f"{prefix}BY1", "type": "beam", "nodes": [f"{prefix}10", f"{prefix}11"], "material": "1", "section": "1"},
        ])
    return StructureModelV2.model_validate({
        "schema_version": "2.0.0",
        "unit_system": "SI",
        "coordinate_system": _coordinate_system("3d"),
        "site_seismic": {
            "intensity": 8,
            "design_group": "2",
            "site_category": "III",
            "max_influence_coefficient": 0.16,
            "extra": {"acceleration_g": 0.20},
        },
        "stories": [
            {"id": "F1", "height": 3.6, "elevation": 0.0, "floor_loads": [{"type": "dead", "value": 5.0}]},
            {"id": "F2", "height": 3.6, "elevation": 3.6, "floor_loads": [{"type": "dead", "value": 5.0}]},
        ],
        "nodes": nodes,
        "materials": [{"id": "1", "name": "C30", "E": 30000.0, "nu": 0.2, "rho": 2500.0}],
        "sections": [
            {"id": "1", "name": "500X500", "type": "rectangular", "properties": {"A": 0.25, "Iy": 0.005, "Iz": 0.005, "J": 0.01, "G": 12500.0}}
        ],
        "elements": elements,
        "metadata": {"structuralTypeKey": "concrete-frame", "storyCount": 2},
    })


class ChinaSeismicWorkflowTest(unittest.TestCase):
    def test_story_drift_snapshot_uses_max_matching_node_line(self) -> None:
        class FakeOps:
            def nodeDisp(self, node_tag: int, _dof: int) -> float:
                return {
                    1: 0.0,
                    2: 0.0,
                    3: 0.01,
                    4: 0.04,
                }[node_tag]

        levels = [
            {
                "elevation": 0.0,
                "nodeTags": [1, 2],
                "points": [
                    {"nodeTag": 1, "x": 0.0, "y": 0.0},
                    {"nodeTag": 2, "x": 6.0, "y": 0.0},
                ],
            },
            {
                "elevation": 3.6,
                "nodeTags": [3, 4],
                "points": [
                    {"nodeTag": 3, "x": 0.0, "y": 0.0},
                    {"nodeTag": 4, "x": 6.0, "y": 0.0},
                ],
            },
        ]

        ratio, controlling = _story_drift_snapshot(FakeOps(), levels, 1)

        self.assertAlmostEqual(ratio, 0.04 / 3.6)
        self.assertEqual(controlling["source"], "node_line")
        self.assertEqual(controlling["lowerNodeTag"], 2)
        self.assertEqual(controlling["upperNodeTag"], 4)
        self.assertAlmostEqual(controlling["driftRatio"], round(0.04 / 3.6, 8))

    def test_design_basis_uses_latest_china_code_parameters(self) -> None:
        basis = build_design_basis(build_frame_model(), {}, {"methodPreference": "auto"})

        self.assertEqual(basis.intensity, 8)
        self.assertAlmostEqual(basis.alpha_max, 0.16)
        self.assertEqual(basis.design_group, "2")
        self.assertEqual(basis.site_category, "III")
        self.assertAlmostEqual(basis.characteristic_period, 0.55)
        self.assertEqual(basis.code_basis[0]["code"], "GB 55002-2021")
        self.assertEqual(basis.code_basis[1]["displayCode"], "GB/T 50011-2010（2024年版）")
        self.assertEqual(basis.code_basis[1]["revision"], "2024 partial revision")
        self.assertEqual(basis.code_basis[2]["code"], "GB 18306-2015")
        self.assertEqual(basis.code_basis[2]["standardStatus"], "current")
        self.assertEqual(basis.code_basis[2]["lastReviewConclusion"], "continue_valid")
        self.assertEqual(basis.code_basis[2]["amendments"][0]["no"], "No.1")
        self.assertEqual(basis.code_basis[2]["amendments"][0]["status"], "effective")
        self.assertEqual(basis.code_basis[2]["amendments"][0]["effectiveDate"], "2026-02-27")
        self.assertEqual(basis.code_basis[2]["revisionPlan"]["planNo"], "20260055-Q-419")
        self.assertEqual(basis.code_basis[2]["revisionPlan"]["status"], "drafting")

    def test_gb50011_design_spectrum_matches_four_segment_curve(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload.pop("site_seismic", None)
        model = StructureModelV2.model_validate(payload)

        for damping_ratio in (0.02, 0.05, 0.10, 0.20):
            with self.subTest(damping_ratio=damping_ratio):
                basis = build_design_basis(model, {}, {
                    "designBasis": {
                        "dampingRatio": damping_ratio,
                        "designBasicAccelerationG": 0.10,
                        "siteSeismic": {
                            "designGroup": "2",
                            "siteCategory": "II",
                        },
                    },
                    "designRequirements": {"fortificationCategory": "standard"},
                })

                self.assertEqual(basis.intensity, 7)
                self.assertAlmostEqual(basis.alpha_max, 0.08)
                self.assertAlmostEqual(basis.characteristic_period, 0.40)
                for period in (0.0, 0.05, 0.10, 0.40, 0.60, 1.00, 2.00, 2.40, 3.00, 3.80, 6.00):
                    self.assertAlmostEqual(
                        seismic_influence_coefficient(period, basis),
                        expected_gb50011_alpha(period, basis.alpha_max, basis.characteristic_period, damping_ratio),
                    )

        basis = build_design_basis(model, {}, {
            "designBasis": {
                "dampingRatio": 0.05,
                "designBasicAccelerationG": 0.10,
                "siteSeismic": {
                    "designGroup": "2",
                    "siteCategory": "II",
                },
            },
            "designRequirements": {"fortificationCategory": "standard"},
        })

        spectrum = generate_design_spectrum(basis)
        selected = {
            point["period"]: point["alpha"]
            for point in spectrum
            if point["period"] in {0.0, 0.1, 0.4, 2.0, 2.4, 3.0, 3.8, 6.0}
        }
        self.assertEqual(len(spectrum), 301)
        self.assertEqual(selected, {
            0.0: 0.036,
            0.1: 0.08,
            0.4: 0.08,
            2.0: 0.018794,
            2.4: 0.018154,
            3.0: 0.017194,
            3.8: 0.016,
            6.0: 0.016,
        })

    def test_design_basis_normalizes_fortification_category_and_safety_evaluation(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload.pop("site_seismic", None)
        model = StructureModelV2.model_validate(payload)
        base_workflow = {
            "designBasis": {
                "dampingRatio": 0.05,
                "designBasicAccelerationG": 0.20,
                "siteSeismic": {
                    "designGroup": "2",
                    "siteCategory": "III",
                },
            },
        }

        key_category = build_design_basis(model, {}, {
            **base_workflow,
            "designRequirements": {"fortificationCategory": "重点设防类"},
        })
        key_payload = key_category.to_dict()

        self.assertEqual(key_category.fortification_category, "key")
        self.assertEqual(key_payload["fortificationCategoryCodeClass"], "B")
        self.assertEqual(key_payload["fortificationCategoryLabel"]["zh"], "重点设防类")
        self.assertEqual(key_payload["seismicMeasureIntensity"], 9)
        self.assertFalse(key_payload["seismicSafetyEvaluationRequired"])
        self.assertFalse(key_payload["isPreliminary"])

        special_missing = build_design_basis(model, {}, {
            **base_workflow,
            "designRequirements": {"fortificationCategory": "special"},
        })

        self.assertEqual(special_missing.fortification_category, "special")
        self.assertIn("designBasis.seismicSafetyEvaluation", special_missing.missing_inputs)
        self.assertTrue(special_missing.to_dict()["seismicSafetyEvaluationRequired"])

        special_confirmed = build_design_basis(model, {}, {
            **base_workflow,
            "designBasis": {
                **base_workflow["designBasis"],
                "seismicSafetyEvaluation": {
                    "approved": True,
                    "designBasicAccelerationG": 0.40,
                    "intensity": 9,
                    "designGroup": "3",
                    "characteristicPeriod": 0.65,
                    "alphaMax": 0.50,
                },
            },
            "designRequirements": {"fortificationCategory": "special"},
        })

        self.assertEqual(special_confirmed.fortification_category, "special")
        self.assertNotIn("designBasis.seismicSafetyEvaluation", special_confirmed.missing_inputs)
        self.assertTrue(special_confirmed.to_dict()["seismicSafetyEvaluationProvided"])
        self.assertAlmostEqual(special_confirmed.acceleration_g or 0.0, 0.40)
        self.assertEqual(special_confirmed.intensity, 9)
        self.assertEqual(special_confirmed.design_group, "3")
        self.assertAlmostEqual(special_confirmed.characteristic_period, 0.65)
        self.assertAlmostEqual(special_confirmed.alpha_max, 0.50)

        special_unapproved = build_design_basis(model, {}, {
            **base_workflow,
            "designBasis": {
                **base_workflow["designBasis"],
                "seismicSafetyEvaluation": {
                    "designBasicAccelerationG": 0.40,
                    "intensity": 9,
                    "designGroup": "3",
                    "alphaMax": 0.50,
                },
            },
            "designRequirements": {"fortificationCategory": "special"},
        })

        self.assertIn("designBasis.seismicSafetyEvaluation", special_unapproved.missing_inputs)
        self.assertFalse(special_unapproved.to_dict()["seismicSafetyEvaluationProvided"])
        self.assertAlmostEqual(special_unapproved.acceleration_g or 0.0, 0.20)
        self.assertEqual(special_unapproved.intensity, 8)
        self.assertEqual(special_unapproved.design_group, "2")

    def test_design_basis_derives_intensity_from_basic_acceleration_without_keyword_matching(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload.pop("site_seismic", None)
        payload["metadata"]["fortificationCategory"] = "standard"
        model = StructureModelV2.model_validate(payload)

        basis = build_design_basis(model, {}, {
            "designBasis": {
                "dampingRatio": 0.05,
                "siteSeismic": {
                    "accelerationG": 0.20,
                    "designGroup": "2",
                    "siteCategory": "III",
                },
            },
        })

        self.assertEqual(basis.intensity, 8)
        self.assertNotIn("designBasis.siteSeismic.intensityOrAccelerationG", basis.missing_inputs)
        self.assertFalse(basis.to_dict()["isPreliminary"])
        source_trace = {
            item["field"]: item
            for item in basis.to_dict()["sourceTrace"]
        }
        self.assertEqual(source_trace["accelerationG"]["source"], "designBasis.siteSeismic.accelerationG")
        self.assertEqual(source_trace["intensity"]["source"], "derived.intensityFromAccelerationG")
        self.assertEqual(source_trace["alphaMax"]["source"], "GB/T 50011-2010(2024).alphaMaxByAcceleration")
        self.assertEqual(source_trace["dampingRatio"]["source"], "designBasis.dampingRatio")
        self.assertFalse(source_trace["dampingRatio"]["assumed"])

    def test_design_basis_accepts_design_basic_acceleration_contract_field(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload.pop("site_seismic", None)
        payload["metadata"]["fortificationCategory"] = "standard"
        model = StructureModelV2.model_validate(payload)

        basis = build_design_basis(model, {}, {
            "designBasis": {
                "dampingRatio": 0.05,
                "designBasicAccelerationG": 0.30,
                "siteSeismic": {
                    "designGroup": "2",
                    "siteCategory": "III",
                },
            },
        })

        self.assertEqual(basis.intensity, 8)
        self.assertAlmostEqual(basis.acceleration_g or 0.0, 0.30)
        self.assertAlmostEqual(basis.alpha_max, 0.24)
        self.assertNotIn("designBasis.siteSeismic.accelerationG", basis.missing_inputs)
        self.assertFalse(basis.to_dict()["isPreliminary"])

    def test_design_basis_supports_fortification_and_rare_earthquake_levels(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload.pop("site_seismic", None)
        payload["metadata"]["fortificationCategory"] = "standard"
        model = StructureModelV2.model_validate(payload)

        base_workflow = {
            "designBasis": {
                "dampingRatio": 0.05,
                "designBasicAccelerationG": 0.20,
                "siteSeismic": {
                    "designGroup": "2",
                    "siteCategory": "III",
                },
            },
        }
        fortification = build_design_basis(model, {}, {
            **base_workflow,
            "earthquakeLevel": "fortification",
        })
        rare = build_design_basis(model, {}, {
            **base_workflow,
            "designBasis": {
                **base_workflow["designBasis"],
                "earthquakeLevel": "rare",
            },
        })

        self.assertEqual(fortification.earthquake_level, "fortification")
        self.assertAlmostEqual(fortification.alpha_max, 0.45)
        self.assertAlmostEqual(fortification.characteristic_period, 0.55)
        self.assertEqual(rare.earthquake_level, "rare")
        self.assertAlmostEqual(rare.alpha_max, 0.90)
        self.assertAlmostEqual(rare.characteristic_period, 0.60)
        self.assertFalse(rare.to_dict()["isPreliminary"])

    def test_design_basis_marks_intensity_only_7_or_8_as_preliminary(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload.pop("site_seismic", None)
        payload["metadata"]["fortificationCategory"] = "standard"
        model = StructureModelV2.model_validate(payload)

        cases = [
            (7, 0.12),
            (8, 0.24),
        ]
        for intensity, expected_alpha in cases:
            with self.subTest(intensity=intensity):
                basis = build_design_basis(model, {}, {
                    "designBasis": {
                        "dampingRatio": 0.05,
                        "siteSeismic": {
                            "intensity": intensity,
                            "designGroup": "2",
                            "siteCategory": "III",
                        },
                    },
                })

                self.assertEqual(basis.intensity, intensity)
                self.assertAlmostEqual(basis.alpha_max, expected_alpha)
                self.assertIn("designBasis.siteSeismic.accelerationG", basis.missing_inputs)
                self.assertTrue(basis.to_dict()["isPreliminary"])

    def test_design_basis_uses_structured_gb18306_zonation_record(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload.pop("site_seismic", None)
        payload["metadata"]["fortificationCategory"] = "standard"
        model = StructureModelV2.model_validate(payload)

        basis = build_design_basis(model, {}, {
            "designBasis": {
                "region": "示例市",
                "regionCode": "EX-001",
                "dampingRatio": 0.05,
                "siteSeismic": {"siteCategory": "III"},
                "groundMotionZonation": {
                    "source": "user_uploaded_gb18306_table",
                    "records": [
                        {"region": "其他市", "regionCode": "EX-000", "accelerationG": 0.10, "designGroup": "1"},
                        {"region": "示例市", "regionCode": "EX-001", "accelerationG": 0.20, "designGroup": "2", "characteristicPeriod": 0.55},
                    ],
                },
            },
        })

        self.assertEqual(basis.region, "示例市")
        self.assertEqual(basis.intensity, 8)
        self.assertAlmostEqual(basis.acceleration_g or 0.0, 0.20)
        self.assertEqual(basis.design_group, "2")
        self.assertEqual(basis.characteristic_period, 0.55)
        self.assertEqual(basis.zonation_record["regionCode"], "EX-001")
        self.assertFalse(basis.to_dict()["isPreliminary"])

    def test_design_basis_marks_missing_code_inputs_as_preliminary(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload.pop("site_seismic", None)
        model = StructureModelV2.model_validate(payload)

        basis = build_design_basis(model, {}, {"designBasis": {"region": "北京"}})

        self.assertEqual(basis.region, "北京")
        self.assertTrue(basis.to_dict()["isPreliminary"])
        self.assertIn("designBasis.siteSeismic.intensityOrAccelerationG", basis.missing_inputs)
        self.assertIn("designBasis.siteSeismic.designGroup", basis.missing_inputs)
        self.assertIn("designBasis.siteSeismic.siteCategory", basis.missing_inputs)
        self.assertIn("designRequirements.fortificationCategory", basis.missing_inputs)

    def test_method_decision_requires_time_history_for_height_threshold_without_keyword_matching(self) -> None:
        basis = build_design_basis(build_frame_model(), {}, {
            "designBasis": {"siteSeismic": {"intensity": 8, "siteCategory": "III"}},
            "structure": {"heightM": 90, "storyCount": 24},
        })

        self.assertEqual(basis.height_m, 90.0)
        self.assertEqual(basis.story_count, 24)
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, ground_motion_count=0)

        self.assertTrue(decision.requires_time_history)
        self.assertEqual(decision.selected_methods, ["response_spectrum"])
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_method_decision_ignores_natural_language_keywords_in_parameters(self) -> None:
        workflow = {"methodPreference": "response_spectrum"}
        basis = build_design_basis(build_frame_model(), {}, workflow)
        decision = decide_seismic_method(
            workflow,
            {
                "message": "请做时程分析和 Pushover，最好也看弹塑性时程",
                "userText": "time history response spectrum pushover",
            },
            basis,
            ground_motion_count=0,
        )

        self.assertFalse(decision.requires_time_history)
        self.assertFalse(decision.requires_elastic_plastic_time_history)
        self.assertFalse(decision.requires_pushover)
        self.assertEqual(decision.selected_methods, ["response_spectrum"])
        self.assertNotIn("groundMotions", decision.missing_inputs)

    def test_nested_regularity_assessment_classification_triggers_time_history(self) -> None:
        workflow = {
            "methodPreference": "auto",
            "regularityAssessment": {"classification": "particularly_irregular"},
        }
        regularity = assess_regularity(build_frame_model(), workflow)
        basis = build_design_basis(build_frame_model(), {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=0, regularity_assessment=regularity)
        explicit_check = next(
            check for check in regularity.checks
            if check.get("name") == "explicit_regularity"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(regularity.source, "structured_requirement")
        self.assertEqual(explicit_check["value"], "particularly_irregular")
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_contract_alias_fields_drive_design_basis_and_method_decision(self) -> None:
        workflow = {
            "requestedMethod": {"preference": "time_history"},
            "groundMotionRequirement": {"recordCount": 7},
            "structureProfile": {
                "heightM": 90,
                "storyCount": 24,
                "regularity": "particularly_irregular",
            },
            "designBasis": {
                "dampingRatio": 0.05,
                "designBasicAccelerationG": 0.20,
                "siteSeismic": {"designGroup": "2", "siteCategory": "III"},
            },
            "designRequirements": {"fortificationCategory": "standard"},
        }
        basis = build_design_basis(build_frame_model(), {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=0)

        self.assertEqual(basis.height_m, 90.0)
        self.assertEqual(basis.story_count, 24)
        self.assertEqual(basis.intensity, 8)
        self.assertTrue(decision.requires_time_history)
        self.assertEqual(decision.required_ground_motion_count, 7)
        self.assertIn("groundMotions", decision.missing_inputs)
        self.assertTrue(any("particularly irregular" in reason for reason in decision.reasons))

    def test_design_basis_preserves_structured_seismic_grade(self) -> None:
        workflow = {
            "methodPreference": "response_spectrum",
            "designRequirements": {
                "fortificationCategory": "standard",
                "seismicGrade": 2,
            },
        }

        basis = build_design_basis(build_frame_model(), {}, workflow)

        self.assertEqual(basis.seismic_grade, 2)
        self.assertEqual(basis.to_dict()["seismicGrade"], 2)
        self.assertEqual(basis.to_dict()["seismicGradeSource"], "designRequirements.seismicGrade")

    def test_method_decision_marks_partial_ground_motion_count_missing(self) -> None:
        workflow = {"methodPreference": "time_history", "groundMotionSet": {"requiredCount": 3}}
        basis = build_design_basis(build_frame_model(), {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=1)

        self.assertIn("time_history", decision.selected_methods)
        self.assertEqual(decision.required_ground_motion_count, 3)
        self.assertIn("groundMotions", decision.missing_inputs)
        self.assertTrue(any("1 ground-motion" in warning for warning in decision.warnings))

    def test_method_decision_honors_elastic_plastic_time_history_preference(self) -> None:
        workflow = {"methodPreference": "elastic_plastic_time_history", "groundMotionSet": {"requiredCount": 3}}
        basis = build_design_basis(build_frame_model(), {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=0)

        self.assertTrue(decision.requires_time_history)
        self.assertTrue(decision.requires_elastic_plastic_time_history)
        self.assertEqual(decision.selected_methods, ["response_spectrum"])
        self.assertEqual(decision.required_ground_motion_count, 3)
        self.assertIn("groundMotions", decision.missing_inputs)
        self.assertTrue(decision.to_dict()["requiresElasticPlasticTimeHistory"])

    def test_auto_method_decision_requires_elastic_plastic_time_history_for_structured_performance_objective(self) -> None:
        workflow = {
            "methodPreference": "auto",
            "performanceObjective": {"name": "collapse_prevention", "acceptanceDriftRatio": 0.015},
            "groundMotionSet": {"requiredCount": 3},
        }
        basis = build_design_basis(build_frame_model(), {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=3)

        self.assertTrue(decision.requires_time_history)
        self.assertTrue(decision.requires_elastic_plastic_time_history)
        self.assertEqual(decision.selected_methods, ["response_spectrum", "time_history"])
        self.assertEqual(decision.required_ground_motion_count, 3)
        self.assertTrue(any("performance objective" in reason for reason in decision.reasons))

    def test_auto_method_decision_selects_pushover_for_structured_static_nonlinear_inputs_without_ground_motions(self) -> None:
        workflow = {
            "methodPreference": "auto",
            "performanceObjective": {"name": "collapse_prevention", "acceptanceDriftRatio": 0.012},
            "pushover": {"targetDisplacement": 0.02},
        }
        basis = build_design_basis(build_frame_model(), {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=0)

        self.assertFalse(decision.requires_time_history)
        self.assertFalse(decision.requires_elastic_plastic_time_history)
        self.assertTrue(decision.requires_pushover)
        self.assertEqual(decision.selected_methods, ["response_spectrum", "pushover"])
        self.assertEqual(decision.required_ground_motion_count, 0)
        self.assertNotIn("groundMotions", decision.missing_inputs)
        self.assertTrue(decision.to_dict()["requiresPushover"])

    def test_method_decision_flags_structured_vertical_seismic_requirement(self) -> None:
        workflow = {
            "methodPreference": "response_spectrum",
            "structureProfile": {"hasLargeSpan": True},
        }
        basis = build_design_basis(build_frame_model(), {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=0)

        self.assertTrue(decision.vertical_seismic_required)
        self.assertTrue(any("large-span" in reason for reason in decision.vertical_seismic_reasons))
        self.assertTrue(decision.to_dict()["verticalSeismicRequired"])

    def test_method_decision_exposes_special_system_capability_boundaries(self) -> None:
        workflow = {
            "methodPreference": "response_spectrum",
            "structure": {
                "hasIsolation": True,
                "hasEnergyDissipation": True,
            },
            "isolationSystem": {
                "equivalentHorizontalStiffness": 120000.0,
                "equivalentDampingRatio": 0.15,
                "displacementDemand": 0.18,
                "displacementCapacity": 0.25,
                "bearings": [{
                    "id": "LRB-1",
                    "horizontalStiffness": 30000.0,
                    "equivalentDampingRatio": 0.15,
                    "displacementDemand": 0.18,
                    "displacementCapacity": 0.22,
                    "shearStrainDemand": 1.2,
                    "shearStrainCapacity": 2.0,
                }],
            },
            "energyDissipationSystem": {
                "devices": [{
                    "id": "VD-1",
                    "type": "viscous",
                    "dampingCoefficient": 500.0,
                    "additionalDampingRatio": 0.08,
                    "displacementDemand": 0.04,
                    "deformationCapacity": 0.06,
                    "forceDemandKN": 800.0,
                    "forceCapacityKN": 1000.0,
                }],
            },
        }
        basis = build_design_basis(build_frame_model(), {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=0)
        payload = decision.to_dict()

        self.assertTrue(payload["specialSystemReviewRequired"])
        self.assertIn("gb50011.isolationSystemSpecialSeismicAnalysis", payload["specialSystemMissingCapabilities"])
        self.assertIn("gb50011.energyDissipationSystemSpecialSeismicAnalysis", payload["specialSystemMissingCapabilities"])
        self.assertTrue(any("isolation system" in reason for reason in payload["specialSystemReasons"]))
        self.assertTrue(any("energy-dissipation system" in reason for reason in payload["specialSystemReasons"]))
        audit = payload["specialSystemAudit"]
        self.assertTrue(audit["reviewRequired"])
        self.assertEqual(audit["systems"], ["isolation", "energy_dissipation"])
        self.assertEqual(audit["deviceCounts"]["isolation"], 1)
        self.assertEqual(audit["deviceCounts"]["energy_dissipation"], 1)
        self.assertEqual(audit["missingInputs"], [])
        self.assertGreaterEqual(len(audit["checks"]), 4)
        self.assertEqual(audit["failedCheckCount"], 0)

    def test_special_system_review_enters_analysis_result(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "response_spectrum",
                "structure": {
                    "hasIsolation": True,
                    "hasEnergyDissipation": True,
                },
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
                "isolationSystem": {
                    "equivalentHorizontalStiffness": 120000.0,
                    "equivalentDampingRatio": 0.15,
                    "displacementDemand": 0.18,
                    "displacementCapacity": 0.25,
                    "bearings": [{
                        "id": "LRB-1",
                        "horizontalStiffness": 30000.0,
                        "equivalentDampingRatio": 0.15,
                        "displacementDemand": 0.18,
                        "displacementCapacity": 0.22,
                    }],
                },
                "energyDissipationSystem": {
                    "equivalentDampingRatio": 0.13,
                    "devices": [{
                        "id": "VD-1",
                        "type": "viscous",
                        "dampingCoefficient": 500.0,
                        "displacementDemand": 0.04,
                        "deformationCapacity": 0.06,
                        "forceCapacityKN": 1000.0,
                    }],
                },
                "groundMotionSet": {
                    "records": [{
                        "name": "ED-TH-1",
                        "dt": 0.02,
                        "unit": "g",
                        "values": [0.0, 0.05, -0.04, 0.03, -0.02, 0.01, 0.0],
                    }],
                },
            },
        })
        data = result["data"]
        review = data["specialSystemReview"]

        self.assertEqual(result["status"], "partial")
        self.assertTrue(review["reviewRequired"])
        self.assertEqual(review["systems"], ["isolation", "energy_dissipation"])
        self.assertEqual(review["isolationEquivalentLinearEstimate"]["status"], "estimated")
        self.assertGreater(review["isolationEquivalentLinearEstimate"]["periodSec"], 0.0)
        self.assertGreater(review["isolationEquivalentLinearEstimate"]["displacementDemandM"], 0.0)
        self.assertIn("finalCompliance", review["isolationEquivalentLinearEstimate"])
        self.assertEqual(review["energyDissipationEquivalentEstimate"]["status"], "estimated")
        self.assertAlmostEqual(review["energyDissipationEquivalentEstimate"]["baseDampingRatio"], 0.05)
        self.assertAlmostEqual(review["energyDissipationEquivalentEstimate"]["additionalDampingRatio"], 0.08)
        self.assertAlmostEqual(review["energyDissipationEquivalentEstimate"]["equivalentDampingRatio"], 0.13)
        self.assertGreater(review["energyDissipationEquivalentEstimate"]["demandReductionRatio"], 0.0)
        self.assertIn("finalCompliance", review["energyDissipationEquivalentEstimate"])
        self.assertEqual(review["energyDissipationTimeHistoryEstimate"]["status"], "estimated")
        self.assertEqual(review["energyDissipationTimeHistoryEstimate"]["controllingRecord"], "ED-TH-1")
        self.assertGreater(review["energyDissipationTimeHistoryEstimate"]["maxDeviceDeformationM"], 0.0)
        self.assertGreater(review["energyDissipationTimeHistoryEstimate"]["maxDeviceForceKN"], 0.0)
        self.assertIn("finalCompliance", review["energyDissipationTimeHistoryEstimate"])
        self.assertEqual(data["summary"]["specialSystemMissingInputCount"], 0)
        self.assertIn("isolationEquivalentLinearSpectrumEstimate", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gb50011.isolationDisplacementDemandTrace", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("energyDissipationEquivalentDampingEstimate", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gb50011.energyDissipationDeformationDemandTrace", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("energyDissipationSdofTimeHistoryEstimate", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gb50011.energyDissipationDeviceDynamicDemandTrace", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gb50011.isolationSystemSpecialSeismicAnalysis", data["missingCapabilities"])
        self.assertIn("gb50011.energyDissipationSystemSpecialSeismicAnalysis", data["missingCapabilities"])

    def test_isolation_layer_time_history_estimate_uses_structured_ground_motions(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "response_spectrum",
                "structure": {"hasIsolation": True},
                "designRequirements": {"fortificationCategory": "standard"},
                "isolationSystem": {
                    "equivalentHorizontalStiffness": 90000.0,
                    "equivalentDampingRatio": 0.18,
                    "displacementCapacity": 0.30,
                    "bearings": [{
                        "id": "LRB-1",
                        "horizontalStiffness": 45000.0,
                        "equivalentDampingRatio": 0.18,
                        "displacementCapacity": 0.28,
                    }],
                },
                "groundMotionSet": {
                    "records": [{
                        "name": "ISO-TH-1",
                        "dt": 0.02,
                        "unit": "g",
                        "values": [0.0, 0.05, -0.04, 0.03, -0.02, 0.01, 0.0],
                    }],
                },
            },
        })
        review = result["data"]["specialSystemReview"]
        estimate = review["isolationLayerTimeHistoryEstimate"]

        self.assertEqual(estimate["status"], "estimated")
        self.assertEqual(estimate["engineMode"], "isolation_layer_sdof_time_history_estimate")
        self.assertEqual(estimate["recordCount"], 1)
        self.assertEqual(estimate["controllingRecord"], "ISO-TH-1")
        self.assertGreater(estimate["maxDisplacementM"], 0.0)
        self.assertGreater(estimate["maxBaseShearKN"], 0.0)
        self.assertIn("finalCompliance", estimate)
        self.assertTrue(any(check["item"] == "隔震层 SDOF 时程位移估算验收" for check in review["checks"]))
        self.assertIn("isolationLayerSdofTimeHistoryEstimate", result["data"]["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gb50011.isolationLayerDynamicDisplacementTrace", result["data"]["capabilityAssessment"]["implementedCapabilities"])

    def test_response_spectrum_long_period_requires_special_study(self) -> None:
        model = build_frame_model()
        basis = build_design_basis(model, {}, {"methodPreference": "response_spectrum"})
        modal = ModalAnalysis(
            modes=[{
                "modeNumber": 1,
                "period": 6.5,
                "effectiveMass": 100.0,
                "massParticipationRatio": 1.0,
                "cumulativeMassParticipationRatio": 1.0,
                "participationFactor": 1.0,
                "storyShape": [{"story": "F1", "elevation": 3.6, "phi": 1.0}],
            }],
            total_mass=100.0,
            floor_masses=[{"story": "F1", "elevation": 3.6, "mass": 100.0, "weightKN": 980.665}],
            model_dimension="2d",
            direction="x",
            engine_mode="test_modal",
        )
        response = run_response_spectrum(basis, modal)

        self.assertTrue(response["periodRangeAssessment"]["requiresSpecialStudy"])
        self.assertEqual(response["periodRangeAssessment"]["maxCodeSpectrumPeriodSec"], 6.0)
        self.assertTrue(response["modalResponses"][0]["requiresSpecialStudy"])
        self.assertTrue(response["spectrumAtModes"][0]["requiresSpecialStudy"])
        advisory = response["longPeriodSpecialStudyAdvisory"]
        self.assertEqual(advisory["status"], "advisory_only")
        self.assertEqual(advisory["governingMode"]["modeNumber"], 1)
        self.assertEqual(advisory["governingMode"]["period"], 6.5)
        self.assertGreater(advisory["governingMode"]["advisoryAlpha"], 0.0)

        decision = decide_seismic_method({"methodPreference": "response_spectrum"}, {}, basis, ground_motion_count=0)
        result = build_seismic_result(
            model=model,
            basis=basis,
            decision=decision,
            modal=modal,
            response_spectrum=response,
            time_history=None,
            elastic_plastic_time_history=None,
            pushover=None,
            seismic_design_actions={"status": "computed", "memberForceCount": 1, "memberForces": {"C1": {}}},
            gravity_design_actions={"status": "computed", "memberForceCount": 1, "memberForces": {"C1": {}}},
            member_design_action_combinations={"status": "computed", "caseCount": 1},
            vertical_seismic=None,
            regularity=None,
            warnings=[],
        )

        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["summary"]["periodSpecialStudyRequired"])
        self.assertIn("gb50011.responseSpectrumLongPeriodSpecialStudy", result["missingCapabilities"])
        self.assertFalse(result["capabilityAssessment"]["finalComplianceSupported"])

    def test_result_adapter_preserves_structured_over_limit_review_trace(self) -> None:
        model = build_frame_model()
        workflow = {
            "methodPreference": "response_spectrum",
            "overLimitReview": {
                "reviewRequired": True,
                "reviewType": "over_limit_high_rise",
                "status": "approved",
                "approvalId": "SZ-REVIEW-2026-001",
            },
            "specialReview": {
                "reviewRequired": False,
                "status": "not_required",
            },
        }
        basis = build_design_basis(model, {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=0)

        result = build_seismic_result(
            model=model,
            basis=basis,
            decision=decision,
            modal=None,
            response_spectrum=None,
            time_history=None,
            elastic_plastic_time_history=None,
            pushover=None,
            seismic_design_actions=None,
            gravity_design_actions=None,
            member_design_action_combinations=None,
            vertical_seismic=None,
            regularity=None,
            warnings=[],
            workflow=workflow,
        )

        self.assertEqual(result["overLimitReview"]["approvalId"], "SZ-REVIEW-2026-001")
        self.assertTrue(result["detailed"]["overLimitReview"]["reviewRequired"])
        self.assertEqual(result["data"]["specialReview"]["status"], "not_required")

    def test_pushover_result_adapter_preserves_structured_special_review_trace(self) -> None:
        model = build_frame_model()
        workflow = {
            "methodPreference": "pushover",
            "specialSeismicReview": {
                "reviewRequired": True,
                "status": "approved",
                "reportId": "PUSHOVER-REVIEW-1",
            },
        }
        basis = build_design_basis(model, {}, workflow)
        decision = decide_seismic_method(workflow, {}, basis, ground_motion_count=0)
        pushover = {
            "status": "success",
            "targetDisplacement": 0.1,
            "pushoverCurve": [
                {"step": 1, "roofDisplacement": 0.05, "baseShear": 100.0},
                {"step": 2, "roofDisplacement": 0.10, "baseShear": 180.0},
            ],
            "finalCompliance": {"status": "pass", "utilization": 0.8},
        }

        result = build_pushover_seismic_result(
            model=model,
            basis=basis,
            decision=decision,
            regularity=None,
            pushover=pushover,
            warnings=[],
            workflow=workflow,
        )

        self.assertEqual(result["specialSeismicReview"]["reportId"], "PUSHOVER-REVIEW-1")
        self.assertTrue(result["detailed"]["specialSeismicReview"]["reviewRequired"])

    def test_auto_regularity_assessment_can_require_time_history(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["stories"][0]["height"] = 3.0
        payload["stories"][1]["height"] = 5.2
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)
        self.assertTrue(any("Automatic model regularity assessment" in reason for reason in decision.reasons))

    def test_auto_regularity_assessment_flags_soft_story_from_column_stiffness(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["sections"].append({
            "id": "weak",
            "name": "250X250",
            "type": "rectangular",
            "properties": {"A": 0.0625, "Iy": 0.0001, "Iz": 0.0001, "J": 0.0002},
        })
        for element in payload["elements"]:
            if element["id"] in {"C3", "C4"}:
                element["section"] = "weak"
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        stiffness_check = next(
            check for check in regularity.checks
            if check.get("name") == "story_lateral_stiffness_variation"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertLess(stiffness_check["value"], 0.50)
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_structured_weak_story(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["stories"][0].setdefault("extra", {})["isSoftStory"] = True
        model = StructureModelV2.model_validate(payload)
        workflow = {
            "structure": {
                "hasWeakStory": True,
            },
        }

        regularity = assess_regularity(model, workflow)
        basis = build_design_basis(model, workflow, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        weak_story_check = next(
            check for check in regularity.checks
            if check.get("name") == "explicit_weak_soft_story"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(weak_story_check["severity"], "particularly_irregular")
        self.assertEqual(weak_story_check["triggers"][0]["source"], "seismicWorkflow.structure.hasWeakStory")
        self.assertEqual(weak_story_check["storyTriggers"][0]["source"], "stories[].isSoftStory")
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_story_lateral_strength_variation(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["stories"][0].setdefault("extra", {})["storyLateralCapacity"] = {"xKN": 3200.0, "yKN": 3000.0}
        payload["stories"][1].setdefault("extra", {})["storyLateralCapacity"] = {"xKN": 1600.0, "yKN": 1550.0}
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        strength_check = next(
            check for check in regularity.checks
            if check.get("name") == "story_lateral_strength_variation"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(strength_check["severity"], "particularly_irregular")
        self.assertLess(strength_check["value"], 0.65)
        self.assertEqual(strength_check["storyStrengths"][0]["source"], "stories[].extra.storyLateralCapacity")
        self.assertAlmostEqual(strength_check["storyStrengths"][0]["strengthKN"], 3000.0)
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_structured_story_lateral_stiffness_variation(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["stories"][0].setdefault("extra", {})["storyLateralStiffnessKNPerM"] = 200000.0
        payload["stories"][1].setdefault("extra", {})["storyLateralStiffness"] = {"x": 78000.0, "y": 82000.0}
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        stiffness_check = next(
            check for check in regularity.checks
            if check.get("name") == "structured_story_lateral_stiffness_variation"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(stiffness_check["severity"], "particularly_irregular")
        self.assertLess(stiffness_check["value"], 0.50)
        self.assertEqual(stiffness_check["storyStiffness"][0]["source"], "stories[].extra.storyLateralStiffnessKNPerM")
        self.assertEqual(stiffness_check["storyStiffness"][1]["source"], "stories[].extra.storyLateralStiffness")
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_story_mass_variation(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["stories"][0].setdefault("extra", {})["seismicWeightKN"] = 1000.0
        payload["stories"][1].setdefault("extra", {})["seismicWeightKN"] = 2600.0
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        mass_check = next(
            check for check in regularity.checks
            if check.get("name") == "story_mass_variation"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(mass_check["severity"], "particularly_irregular")
        self.assertGreater(mass_check["value"], 2.00)
        self.assertEqual(mass_check["storyWeights"][0]["source"], "stories[].extra.seismicWeightKN")
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_floor_diaphragm_discontinuity(self) -> None:
        payload = build_space_frame_model().model_dump(mode="python")
        payload["slab_openings"] = [
            {
                "id": "SO-F1",
                "story_id": "F1",
                "x": 3.0,
                "y": 2.5,
                "width": 5.6,
                "depth": 4.6,
                "shape": "rectangular",
            },
        ]
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        diaphragm_check = next(
            check for check in regularity.checks
            if check.get("name") == "floor_diaphragm_discontinuity"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(diaphragm_check["severity"], "particularly_irregular")
        self.assertGreater(diaphragm_check["value"], 0.50)
        self.assertEqual(diaphragm_check["storyDiaphragms"][0]["openingCount"], 1)
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_story_level_diaphragm_opening_ratio(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["stories"][0].setdefault("extra", {})["openingRatio"] = 0.56
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        diaphragm_check = next(
            check for check in regularity.checks
            if check.get("name") == "floor_diaphragm_discontinuity"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(diaphragm_check["severity"], "particularly_irregular")
        self.assertGreater(diaphragm_check["value"], 0.50)
        self.assertEqual(diaphragm_check["storyDiaphragms"][0]["openingRatioSource"], "stories[].extra.openingRatio")
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_torsional_eccentricity(self) -> None:
        payload = build_space_frame_model().model_dump(mode="python")
        payload["sections"].append({
            "id": "stiff",
            "name": "stiff corner column",
            "type": "rectangular",
            "properties": {"A": 1.0, "Iy": 0.5, "Iz": 0.5, "J": 1.0},
        })
        for element in payload["elements"]:
            if element["id"] in {"C100", "C200"}:
                element["section"] = "stiff"
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        torsion_check = next(
            check for check in regularity.checks
            if check.get("name") == "plan_torsional_eccentricity"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertGreater(torsion_check["value"], 0.30)
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_structured_torsional_displacement_ratio(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["stories"][1].setdefault("extra", {})["maxDisplacementToAverageRatio"] = 1.46
        model = StructureModelV2.model_validate(payload)
        workflow = {
            "regularityAssessment": {
                "torsionalDisplacementRatio": 1.31,
            },
        }

        regularity = assess_regularity(model, workflow)
        basis = build_design_basis(model, workflow, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        torsion_check = next(
            check for check in regularity.checks
            if check.get("name") == "structured_torsional_displacement_ratio"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(torsion_check["severity"], "particularly_irregular")
        self.assertGreater(torsion_check["value"], 1.40)
        self.assertTrue(any(item["source"] == "seismicWorkflow.regularityAssessment.torsionalDisplacementRatio" for item in torsion_check["ratios"]))
        self.assertTrue(any(item["source"] == "stories[].extra.maxDisplacementToAverageRatio" for item in torsion_check["ratios"]))
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_plan_setback(self) -> None:
        payload = build_space_frame_model().model_dump(mode="python")
        for node in payload["nodes"]:
            if node.get("story") == "F2":
                node["x"] = 0.0 if node["x"] == 0.0 else 2.0
                node["y"] = 0.0 if node["y"] == 0.0 else 2.0
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        setback_check = next(
            check for check in regularity.checks
            if check.get("name") == "plan_setback_variation"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertLess(setback_check["value"], 0.50)
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_structured_severe_plan_irregularity(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["stories"][0].setdefault("extra", {})["planReentrantCornerRatio"] = 0.43
        model = StructureModelV2.model_validate(payload)
        workflow = {
            "structure": {
                "hasSeverePlanIrregularity": True,
            },
        }

        regularity = assess_regularity(model, workflow)
        basis = build_design_basis(model, workflow, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        plan_check = next(
            check for check in regularity.checks
            if check.get("name") == "structured_plan_irregularity_flags"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(plan_check["severity"], "particularly_irregular")
        self.assertTrue(any(item["source"] == "seismicWorkflow.structure.hasSeverePlanIrregularity" for item in plan_check["triggers"]))
        self.assertTrue(any(item["source"] == "stories[].extra.planReentrantCornerRatio" for item in plan_check["triggers"]))
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_keeps_general_plan_irregularity_without_forcing_time_history(self) -> None:
        model = build_frame_model()
        workflow = {
            "structure": {
                "hasPlanIrregularity": True,
            },
        }

        regularity = assess_regularity(model, workflow)
        basis = build_design_basis(model, workflow, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        plan_check = next(
            check for check in regularity.checks
            if check.get("name") == "structured_plan_irregularity_flags"
        )

        self.assertEqual(regularity.classification, "irregular")
        self.assertEqual(plan_check["severity"], "irregular")
        self.assertFalse(decision.requires_time_history)

    def test_auto_regularity_assessment_flags_vertical_lateral_system_discontinuity(self) -> None:
        model = build_frame_model()
        workflow = {
            "structure": {
                "hasTransferStory": True,
            },
        }

        regularity = assess_regularity(model, workflow)
        basis = build_design_basis(model, workflow, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        discontinuity_check = next(
            check for check in regularity.checks
            if check.get("name") == "vertical_lateral_system_discontinuity"
        )

        self.assertEqual(regularity.classification, "particularly_irregular")
        self.assertEqual(discontinuity_check["severity"], "particularly_irregular")
        self.assertEqual(discontinuity_check["triggers"][0]["source"], "seismicWorkflow.structure.hasTransferStory")
        self.assertTrue(decision.requires_time_history)
        self.assertIn("groundMotions", decision.missing_inputs)

    def test_auto_regularity_assessment_flags_plan_aspect_without_forcing_time_history(self) -> None:
        payload = build_space_frame_model().model_dump(mode="python")
        for node in payload["nodes"]:
            node["y"] = 0.0 if node["y"] == 0.0 else 0.5
        model = StructureModelV2.model_validate(payload)

        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)
        aspect_check = next(
            check for check in regularity.checks
            if check.get("name") == "plan_aspect_ratio"
        )

        self.assertEqual(regularity.classification, "irregular")
        self.assertGreater(aspect_check["value"], 6.0)
        self.assertFalse(decision.requires_time_history)

    def test_auto_regularity_assessment_keeps_regular_model_on_response_spectrum(self) -> None:
        model = build_frame_model()
        regularity = assess_regularity(model, {})
        basis = build_design_basis(model, {}, {})
        decision = decide_seismic_method({"methodPreference": "auto"}, {}, basis, 0, regularity)

        self.assertEqual(regularity.classification, "regular")
        self.assertFalse(decision.requires_time_history)
        self.assertEqual(decision.selected_methods, ["response_spectrum"])

    def test_multi_direction_response_spectrum_runs_structured_xy_workflow(self) -> None:
        result = run_seismic_analysis(build_space_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "response_spectrum",
                "directions": ["x", "y"],
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
            },
        })

        data = result["data"]
        self.assertEqual(data["summary"]["directionCount"], 2)
        self.assertEqual(data["summary"]["directions"], ["x", "y"])
        self.assertEqual([item["direction"] for item in data["directionResults"]], ["x", "y"])
        self.assertGreater(data["envelope"]["maxBaseShear"], 0.0)
        self.assertIn(data["envelope"]["controlCase"]["direction"], {"x", "y"})
        self.assertIn(data["seismicDesignActions"]["direction"], {"x", "y"})
        self.assertEqual(data["seismicDesignActions"]["status"], "computed")
        self.assertGreater(data["seismicDesignActions"]["memberForceCount"], 0)
        self.assertTrue(all(
            item["seismicDesignActions"]["status"] == "computed"
            for item in data["directionResults"]
        ))
        combinations = data["memberDesignActionCombinations"]
        case_names = [case["name"] for case in combinations["cases"]]
        self.assertEqual(combinations["horizontalDirections"], ["x", "y"])
        self.assertIn("gravity_plus_x_horizontal_seismic", case_names)
        self.assertIn("gravity_plus_y_horizontal_seismic", case_names)
        self.assertIn("gravity_plus_x_horizontal_with_y", case_names)
        self.assertIn("gravity_plus_y_horizontal_with_x", case_names)
        self.assertIn("seismicEquivalentLateralMemberForces", data["capabilityAssessment"]["implementedCapabilities"])

    def test_structured_workflow_reports_structured_input_mode(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "response_spectrum",
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
            },
        })

        self.assertEqual(result["workflowInputMode"], "structured_seismic_workflow")
        self.assertEqual(result["data"]["workflowInputMode"], "structured_seismic_workflow")
        self.assertFalse(any("legacy compatibility" in warning for warning in result["warnings"]))

    def test_legacy_method_parameters_report_compatibility_input_mode(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {"method": "response_spectrum"})

        self.assertEqual(result["workflowInputMode"], "legacy_compatibility_parameters")
        self.assertEqual(result["data"]["workflowInputMode"], "legacy_compatibility_parameters")
        self.assertTrue(any("legacy compatibility mode" in warning for warning in result["warnings"]))

    def test_response_spectrum_builds_member_design_action_combinations(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "response_spectrum",
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
            },
        })
        data = result["data"]
        combinations = data["memberDesignActionCombinations"]

        self.assertEqual(data["gravityDesignActions"]["status"], "computed")
        self.assertGreater(data["gravityDesignActions"]["memberForceCount"], 0)
        self.assertEqual(combinations["status"], "computed")
        self.assertGreater(combinations["memberCount"], 0)
        self.assertGreater(combinations["caseCount"], 0)
        self.assertEqual(combinations["horizontalDirections"], ["x"])
        self.assertIn("gravity_plus_horizontal_seismic", [case["name"] for case in combinations["cases"]])
        self.assertIn("gb50011.seismicBasicActionCombination", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gravityRepresentativeMemberForces", data["capabilityAssessment"]["implementedCapabilities"])

    def test_response_spectrum_outputs_elastic_drift_final_compliance(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "response_spectrum",
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
            },
        })
        data = result["data"]
        final_compliance = data["responseSpectrumFinalCompliance"]

        self.assertIn(final_compliance["status"], {"pass", "fail"})
        self.assertEqual(final_compliance["clause"], "GB/T 50011-2010(2024) 5.5.1")
        self.assertAlmostEqual(final_compliance["limitDriftRatio"], round(1.0 / 550.0, 8))
        self.assertEqual(data["responseSpectrum"]["finalCompliance"]["status"], final_compliance["status"])
        self.assertEqual(data["summary"]["responseSpectrumFinalComplianceStatus"], final_compliance["status"])
        self.assertIn("gb50011.frequentEarthquakeElasticDriftFinalCompliance", data["capabilityAssessment"]["implementedCapabilities"])

    def test_response_spectrum_uses_structural_family_drift_limits(self) -> None:
        cases = [
            ("concrete-frame-shear-wall", 1.0 / 800.0, "1/800"),
            ("concrete-shear-wall", 1.0 / 1000.0, "1/1000"),
            ("steel-frame", 1.0 / 250.0, "1/250"),
        ]
        for structural_family, expected_limit, expected_limit_text in cases:
            with self.subTest(structural_family=structural_family):
                payload = build_frame_model().model_dump(mode="python")
                payload["metadata"]["structuralTypeKey"] = structural_family
                model = StructureModelV2.model_validate(payload)
                result = run_seismic_analysis(model, {
                    "seismicWorkflow": {
                        "methodPreference": "response_spectrum",
                        "designBasis": {"dampingRatio": 0.05},
                        "designRequirements": {"fortificationCategory": "standard"},
                    },
                })
                data = result["data"]
                final_compliance = data["responseSpectrumFinalCompliance"]

                self.assertEqual(data["designBasis"]["structuralFamily"], structural_family)
                self.assertAlmostEqual(final_compliance["limitDriftRatio"], round(expected_limit, 8))
                self.assertEqual(final_compliance["limitRatioText"], expected_limit_text)
                self.assertNotIn("gb50011.elasticDriftLimitForStructuralFamily", data["missingCapabilities"])
                self.assertIn("gb50011.elasticDriftLimit", data["capabilityAssessment"]["implementedCapabilities"])

    def test_unsupported_final_compliance_family_returns_partial_capability_boundary(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["metadata"]["structuralTypeKey"] = "bridge"
        payload["metadata"]["fortificationCategory"] = "standard"
        model = StructureModelV2.model_validate(payload)

        result = run_seismic_analysis(model, {
            "seismicWorkflow": {
                "methodPreference": "response_spectrum",
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
            },
        })
        data = result["data"]

        self.assertEqual(result["status"], "partial")
        self.assertGreater(data["envelope"]["maxBaseShear"], 0.0)
        self.assertEqual(data["capabilityAssessment"]["structuralFamily"], "bridge")
        self.assertFalse(data["capabilityAssessment"]["finalComplianceSupported"])
        self.assertIn("gb50011.elasticDriftLimitForStructuralFamily", data["missingCapabilities"])

    def test_rare_earthquake_response_spectrum_exposes_nonlinear_deformation_boundary(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload.pop("site_seismic", None)
        payload["metadata"]["fortificationCategory"] = "standard"
        model = StructureModelV2.model_validate(payload)

        result = run_seismic_analysis(model, {
            "seismicWorkflow": {
                "methodPreference": "response_spectrum",
                "designBasis": {
                    "earthquakeLevel": "rare",
                    "dampingRatio": 0.05,
                    "designBasicAccelerationG": 0.20,
                    "siteSeismic": {
                        "designGroup": "2",
                        "siteCategory": "III",
                    },
                },
                "designRequirements": {"fortificationCategory": "standard"},
            },
        })
        data = result["data"]

        self.assertEqual(result["status"], "partial")
        self.assertEqual(data["designBasis"]["earthquakeLevel"], "rare")
        self.assertAlmostEqual(data["designBasis"]["alphaMax"], 0.90)
        self.assertAlmostEqual(data["designBasis"]["characteristicPeriod"], 0.60)
        self.assertEqual(data["responseSpectrum"]["earthquakeLevel"], "rare")
        self.assertIn("gb50011.rareEarthquakeElasticPlasticDeformation", data["missingCapabilities"])

    def test_elastic_plastic_time_history_request_reports_final_compliance(self) -> None:
        wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "elastic_plastic_time_history",
                "groundMotionSet": {
                    "requiredCount": 3,
                    "records": [
                        {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                        {"name": "GM2", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                        {"name": "GM3", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                    ],
                },
            },
        })
        data = result["data"]
        nonlinear = data["elasticPlasticTimeHistory"]

        self.assertIn(result["status"], {"success", "partial"})
        self.assertEqual(data["methodDecision"]["selectedMethods"], ["response_spectrum", "time_history"])
        self.assertTrue(data["methodDecision"]["requiresElasticPlasticTimeHistory"])
        self.assertEqual(nonlinear["status"], "estimated")
        self.assertEqual(nonlinear["engineMode"], "opensees_bilinear_story_shear_building_estimate")
        self.assertEqual(nonlinear["modelScope"], "bilinear_story_shear_building")
        self.assertTrue(nonlinear["fallbackElasticTimeHistoryExecuted"])
        self.assertGreater(len(nonlinear["records"]), 0)
        self.assertGreater(len(nonlinear["records"][0]["storyResponses"]), 0)
        self.assertGreaterEqual(nonlinear["maxDriftRatio"], 0.0)
        self.assertIn("elasticPlasticTimeHistoryEstimate", nonlinear["implementedCapabilities"])
        self.assertIn("elasticPlasticStoryShearBuildingEstimate", nonlinear["implementedCapabilities"])
        self.assertIn("gb50011.elasticPlasticTimeHistoryAnalysis", nonlinear["implementedCapabilities"])
        self.assertIn("nonlinearModelStructuredInputAudit", nonlinear["implementedCapabilities"])
        self.assertEqual(nonlinear["nonlinearModelAudit"]["status"], "missing")
        self.assertIn(nonlinear["finalCompliance"]["status"], {"pass", "fail"})
        self.assertEqual(nonlinear["finalCompliance"]["source"], "elasticPlasticTimeHistory.acceptanceCheck")
        self.assertIn("nonlinearModel.fullMemberConstitutiveModels", nonlinear["missingInputs"])
        self.assertNotIn("gb50011.elasticPlasticTimeHistoryAnalysis", data["missingCapabilities"])
        self.assertNotIn("gb50011.elasticPlasticTimeHistoryAnalysis", nonlinear["missingCapabilities"])
        self.assertIn("elasticPlasticTimeHistoryEstimate", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("elasticPlasticStoryShearBuildingEstimate", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gb50011.elasticPlasticTimeHistoryAnalysis", data["capabilityAssessment"]["implementedCapabilities"])

    def test_elastic_plastic_time_history_audits_structured_nonlinear_model(self) -> None:
        wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "elastic_plastic_time_history",
                "groundMotionSet": {
                    "requiredCount": 3,
                    "records": [
                        {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                        {"name": "GM2", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                        {"name": "GM3", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                    ],
                },
                "performanceObjective": {"name": "life_safety", "acceptanceDriftRatio": 0.015},
                "nonlinearModel": {
                    "materialConstitutiveModels": [
                        {"id": "C30-confined", "modelType": "Concrete02", "fc": 20.1},
                    ],
                    "memberPlasticHinges": [
                        {"elementId": "C1", "end": "i", "yieldMoment": 120.0, "yieldRotation": 0.004},
                        {"elementId": "C1", "end": "j", "backbone": {"positive": [[0.004, 120.0], [0.02, 144.0]]}},
                    ],
                    "convergenceCriteria": {"test": "NormDispIncr", "tolerance": 1.0e-8, "maxIterations": 25},
                },
            },
        })
        nonlinear = result["data"]["elasticPlasticTimeHistory"]
        audit = nonlinear["nonlinearModelAudit"]

        self.assertEqual(audit["status"], "complete")
        self.assertEqual(audit["materialModelCount"], 1)
        self.assertEqual(audit["memberPlasticHingeCount"], 2)
        self.assertEqual(audit["calibratedPlasticHingeCount"], 2)
        self.assertEqual(nonlinear["missingInputs"], [])
        self.assertAlmostEqual(nonlinear["acceptanceDriftRatio"], 0.015)
        self.assertEqual(nonlinear["finalCompliance"]["performanceObjective"]["name"], "life_safety")
        self.assertAlmostEqual(nonlinear["finalCompliance"]["limitDriftRatio"], 0.015)
        self.assertIn("gb50011.elasticPlasticTimeHistoryFullMemberAnalysis", nonlinear["missingCapabilities"])
        self.assertIn("gb50011.elasticPlasticTimeHistoryFullMemberAnalysis", result["data"]["missingCapabilities"])
        self.assertIn("nonlinearModelStructuredInputAudit", result["data"]["capabilityAssessment"]["implementedCapabilities"])

    def test_elastic_plastic_time_history_uses_structured_member_plastic_hinges_when_available(self) -> None:
        wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "elastic_plastic_time_history",
                "groundMotionSet": {
                    "requiredCount": 3,
                    "records": [
                        {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                        {"name": "GM2", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                        {"name": "GM3", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                    ],
                },
                "performanceObjective": {"name": "collapse_prevention", "acceptanceDriftRatio": 0.015},
                "nonlinearModel": {
                    "materialConstitutiveModels": [
                        {"id": "C30-confined", "modelType": "Concrete02", "fc": 20.1},
                    ],
                    "memberPlasticHinges": [
                        {"elementId": "C1", "end": "i", "yieldMoment": 160.0, "yieldRotation": 0.004},
                        {"elementId": "C1", "end": "j", "yieldMoment": 160.0, "yieldRotation": 0.004},
                        {"elementId": "C2", "end": "i", "yieldMoment": 160.0, "yieldRotation": 0.004},
                        {"elementId": "C2", "end": "j", "yieldMoment": 160.0, "yieldRotation": 0.004},
                        {"elementId": "C3", "end": "i", "yieldMoment": 140.0, "yieldRotation": 0.004},
                        {"elementId": "C3", "end": "j", "yieldMoment": 140.0, "yieldRotation": 0.004},
                        {"elementId": "C4", "end": "i", "yieldMoment": 140.0, "yieldRotation": 0.004},
                        {"elementId": "C4", "end": "j", "yieldMoment": 140.0, "yieldRotation": 0.004},
                    ],
                    "convergenceCriteria": {"test": "NormDispIncr", "tolerance": 1.0e-8, "maxIterations": 30},
                },
            },
        })
        nonlinear = result["data"]["elasticPlasticTimeHistory"]

        self.assertIn(result["status"], {"success", "partial"})
        self.assertEqual(nonlinear["status"], "estimated")
        self.assertEqual(nonlinear["engineMode"], "opensees_member_end_plastic_hinge_2d_time_history_estimate")
        self.assertEqual(nonlinear["modelScope"], "member_end_rotational_plastic_hinges_2d")
        self.assertEqual(nonlinear["parameters"]["hingeCount"], 8)
        self.assertGreater(len(nonlinear["records"]), 0)
        self.assertGreater(len(nonlinear["records"][0]["hingeResponses"]), 0)
        self.assertIn("controllingHinge", nonlinear)
        self.assertIn("elasticPlasticMemberPlasticHinge2dTimeHistory", nonlinear["implementedCapabilities"])
        self.assertIn("elasticPlasticMemberPlasticHinge2dTimeHistory", result["data"]["capabilityAssessment"]["implementedCapabilities"])
        self.assertEqual(nonlinear["missingInputs"], [])
        self.assertIn("gb50011.elasticPlasticTimeHistoryFullMemberAnalysis", nonlinear["missingCapabilities"])
        self.assertIn("member-end rotational plastic-hinge", nonlinear["finalCompliance"]["scope"])

    def test_auto_workflow_selects_elastic_plastic_time_history_for_structured_performance_objective(self) -> None:
        wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "auto",
                "groundMotionSet": {
                    "requiredCount": 3,
                    "records": [
                        {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                        {"name": "GM2", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                        {"name": "GM3", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                    ],
                },
                "performanceObjective": {"name": "collapse_prevention", "acceptanceDriftRatio": 0.015},
            },
        })
        data = result["data"]
        nonlinear = data["elasticPlasticTimeHistory"]

        self.assertIn(result["status"], {"success", "partial"})
        self.assertEqual(data["methodDecision"]["selectedMethods"], ["response_spectrum", "time_history"])
        self.assertTrue(data["methodDecision"]["requiresElasticPlasticTimeHistory"])
        self.assertEqual(nonlinear["status"], "estimated")
        self.assertEqual(nonlinear["finalCompliance"]["performanceObjective"]["name"], "collapse_prevention")
        self.assertIn("gb50011.elasticPlasticTimeHistoryAnalysis", data["capabilityAssessment"]["implementedCapabilities"])

    def test_elastic_plastic_reduced_model_uses_structural_family_yield_drift(self) -> None:
        wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
        payload = build_frame_model().model_dump(mode="python")
        payload["metadata"]["structuralTypeKey"] = "concrete-shear-wall"
        model = StructureModelV2.model_validate(payload)
        result = run_seismic_analysis(model, {
            "seismicWorkflow": {
                "methodPreference": "elastic_plastic_time_history",
                "groundMotionSet": {
                    "requiredCount": 3,
                    "records": [
                        {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                        {"name": "GM2", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                        {"name": "GM3", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                    ],
                },
            },
        })
        params = result["data"]["elasticPlasticTimeHistory"]["parameters"]

        self.assertEqual(result["data"]["designBasis"]["structuralFamily"], "concrete-shear-wall")
        self.assertAlmostEqual(params["yieldDriftRatio"], 1.0 / 1000.0)
        self.assertEqual(params["yieldDriftLimitRatioText"], "1/1000")
        self.assertFalse(params["yieldDriftIsFallback"])
        self.assertAlmostEqual(params["yieldDisplacementM"], 0.0072)
        self.assertTrue(any("1/1000" in item for item in result["data"]["elasticPlasticTimeHistory"]["assumptions"]))

    def test_auto_workflow_selects_pushover_when_structured_performance_objective_has_no_ground_motions(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "auto",
                "performanceObjective": {"name": "collapse_prevention", "acceptanceDriftRatio": 0.012},
                "pushover": {"targetDisplacement": 0.02},
            },
        })
        data = result["data"]
        decision = data["methodDecision"]
        pushover = data["pushover"]

        self.assertIn(result["status"], {"success", "partial"})
        self.assertEqual(decision["selectedMethods"], ["response_spectrum", "pushover"])
        self.assertTrue(decision["requiresPushover"])
        self.assertFalse(decision["requiresElasticPlasticTimeHistory"])
        self.assertNotIn("groundMotions", data["missingInputs"])
        self.assertIsNotNone(data["responseSpectrum"])
        self.assertIsNone(data["elasticPlasticTimeHistory"])
        self.assertEqual(pushover["engineMode"], "opensees_linear_static_pushover")
        self.assertGreater(pushover["stepCount"], 0)
        self.assertEqual(pushover["capacityAssessment"]["capacitySpectrumIteration"]["status"], "estimated")
        self.assertEqual(pushover["capacityAssessment"]["performancePoint"]["source"], "secantCapacitySpectrumIteration")
        self.assertIn(pushover["finalCompliance"]["status"], {"pass", "fail"})
        self.assertEqual(pushover["finalCompliance"]["performanceObjective"]["name"], "collapse_prevention")
        self.assertIn("pushoverCapacitySpectrumIteration", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gb50011.nonlinearPushoverFinalCompliance", data["capabilityAssessment"]["implementedCapabilities"])

    def test_rare_elastic_plastic_time_history_satisfies_rare_deformation_capability(self) -> None:
        wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "elastic_plastic_time_history",
                "designBasis": {"earthquakeLevel": "rare"},
                "groundMotionSet": {
                    "requiredCount": 3,
                    "records": [
                        {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                        {"name": "GM2", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                        {"name": "GM3", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                    ],
                },
            },
        })
        data = result["data"]

        self.assertEqual(data["designBasis"]["earthquakeLevel"], "rare")
        self.assertIn(data["elasticPlasticTimeHistory"]["finalCompliance"]["status"], {"pass", "fail"})
        self.assertNotIn("gb50011.rareEarthquakeElasticPlasticDeformation", data["missingCapabilities"])
        self.assertIn("gb50011.rareEarthquakeElasticPlasticDeformation", data["capabilityAssessment"]["implementedCapabilities"])

    def test_vertical_seismic_requirement_exposes_capability_boundary(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "response_spectrum",
                "structureProfile": {"hasLargeSpan": True},
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
            },
        })
        data = result["data"]

        self.assertIn(result["status"], {"success", "partial"})
        self.assertTrue(data["methodDecision"]["verticalSeismicRequired"])
        self.assertEqual(data["verticalSeismic"]["status"], "computed")
        self.assertAlmostEqual(data["verticalSeismic"]["coefficient"], 0.10)
        self.assertGreater(data["verticalSeismic"]["totalVerticalActionKN"], 0.0)
        self.assertEqual(data["verticalSeismic"]["openSeesStatic"]["status"], "completed")
        self.assertGreater(data["verticalSeismic"]["openSeesStatic"]["baseReactionKN"], 0.0)
        self.assertGreater(data["verticalSeismic"]["openSeesStatic"]["memberForceCount"], 0)
        self.assertNotIn("gb50011.verticalSeismicAction", data["missingCapabilities"])
        self.assertNotIn("gb50011.verticalSeismicMemberForceCombination", data["missingCapabilities"])
        self.assertNotIn("gb50011.verticalSeismicMemberCapacityCheck", data["missingCapabilities"])
        self.assertIn("verticalSeismicMemberForces", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gb50011.verticalSeismicMemberCapacityCheck", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertTrue(data["capabilityAssessment"]["finalComplianceSupported"])

    def test_pushover_result_reports_final_compliance(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "pushover",
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
                "pushover": {
                    "targetDisplacement": 0.02,
                    "performanceObjective": {"name": "collapse_prevention", "acceptanceDriftRatio": 0.012},
                },
            },
        })
        data = result["data"]

        self.assertIn(result["status"], {"success", "partial"})
        self.assertEqual(data["methodDecision"]["selectedMethods"], ["pushover"])
        self.assertTrue(data["capabilityAssessment"]["finalComplianceSupported"])
        self.assertNotIn("gb50011.nonlinearPushoverFinalCompliance", data["missingCapabilities"])
        capacity = data["pushover"]["capacityAssessment"]
        self.assertEqual(capacity["status"], "estimated")
        self.assertIn("performancePoint", capacity)
        self.assertEqual(capacity["capacitySpectrumIteration"]["status"], "estimated")
        self.assertEqual(capacity["performancePoint"]["source"], "secantCapacitySpectrumIteration")
        self.assertGreater(capacity["performancePoint"]["baseShearKN"], 0.0)
        nonlinear = data["pushover"]["nonlinearEstimate"]
        self.assertEqual(nonlinear["status"], "estimated")
        self.assertEqual(nonlinear["engineMode"], "opensees_bilinear_story_shear_pushover_estimate")
        self.assertEqual(nonlinear["modelScope"], "bilinear_story_shear_building")
        self.assertGreater(len(nonlinear["curve"]), 0)
        self.assertGreater(len(nonlinear["curve"][0]["storyResponses"]), 0)
        self.assertGreater(nonlinear["controllingStory"]["driftRatio"], 0.0)
        self.assertGreater(nonlinear["performancePoint"]["baseShearKN"], 0.0)
        final_compliance = data["pushover"]["finalCompliance"]
        self.assertIn(final_compliance["status"], {"pass", "fail"})
        self.assertEqual(final_compliance["source"], "pushover.nonlinearEstimate.acceptanceCheck")
        self.assertAlmostEqual(final_compliance["limitDriftRatio"], 0.012)
        self.assertEqual(final_compliance["performanceObjective"]["name"], "collapse_prevention")
        self.assertIn("pushoverPerformancePointEstimate", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("pushoverCapacitySpectrumIteration", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("pushoverBilinearSdofEstimate", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("pushoverBilinearStoryShearBuildingEstimate", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertIn("gb50011.nonlinearPushoverFinalCompliance", data["capabilityAssessment"]["implementedCapabilities"])

    def test_pushover_reduced_model_uses_structural_family_yield_drift(self) -> None:
        payload = build_frame_model().model_dump(mode="python")
        payload["metadata"]["structuralTypeKey"] = "steel-frame"
        model = StructureModelV2.model_validate(payload)
        result = run_seismic_analysis(model, {
            "seismicWorkflow": {
                "methodPreference": "pushover",
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
                "pushover": {"targetDisplacement": 0.02},
            },
        })
        params = result["data"]["pushover"]["nonlinearEstimate"]["parameters"]

        self.assertEqual(result["data"]["designBasis"]["structuralFamily"], "steel-frame")
        self.assertAlmostEqual(params["yieldDriftRatio"], 1.0 / 250.0)
        self.assertEqual(params["yieldDriftLimitRatioText"], "1/250")
        self.assertFalse(params["yieldDriftIsFallback"])
        self.assertAlmostEqual(params["yieldDisplacementM"], 0.0288)
        self.assertTrue(any("1/250" in item for item in result["data"]["pushover"]["nonlinearEstimate"]["assumptions"]))

    def test_pushover_uses_structured_member_plastic_hinge_model_when_available(self) -> None:
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "pushover",
                "designBasis": {"dampingRatio": 0.05},
                "designRequirements": {"fortificationCategory": "standard"},
                "performanceObjective": {"name": "collapse_prevention", "acceptanceDriftRatio": 0.012},
                "pushover": {"targetDisplacement": 0.02},
                "nonlinearModel": {
                    "memberPlasticHinges": [
                        {"elementId": "C1", "end": "i", "yieldMoment": 160.0, "yieldRotation": 0.004},
                        {"elementId": "C1", "end": "j", "yieldMoment": 160.0, "yieldRotation": 0.004},
                        {"elementId": "C2", "end": "i", "yieldMoment": 160.0, "yieldRotation": 0.004},
                        {"elementId": "C2", "end": "j", "yieldMoment": 160.0, "yieldRotation": 0.004},
                        {"elementId": "C3", "end": "i", "yieldMoment": 140.0, "yieldRotation": 0.004},
                        {"elementId": "C3", "end": "j", "yieldMoment": 140.0, "yieldRotation": 0.004},
                        {"elementId": "C4", "end": "i", "yieldMoment": 140.0, "yieldRotation": 0.004},
                        {"elementId": "C4", "end": "j", "yieldMoment": 140.0, "yieldRotation": 0.004},
                    ],
                    "convergenceCriteria": {"test": "NormDispIncr", "tolerance": 1.0e-8, "maxIterations": 30},
                },
            },
        })
        data = result["data"]
        nonlinear = data["pushover"]["nonlinearEstimate"]

        self.assertIn(result["status"], {"success", "partial"})
        self.assertEqual(nonlinear["status"], "estimated")
        self.assertEqual(nonlinear["engineMode"], "opensees_member_end_plastic_hinge_2d_pushover_estimate")
        self.assertEqual(nonlinear["modelScope"], "member_end_rotational_plastic_hinges_2d")
        self.assertEqual(nonlinear["parameters"]["hingeCount"], 8)
        self.assertGreater(len(nonlinear["curve"]), 0)
        self.assertGreater(len(nonlinear["hingeResponses"]), 0)
        self.assertGreaterEqual(nonlinear["performancePoint"]["baseShearKN"], 0.0)
        self.assertIn("controllingHinge", nonlinear)
        self.assertIn("pushoverMemberPlasticHinge2dEstimate", nonlinear["implementedCapabilities"])
        self.assertIn("pushoverMemberPlasticHinge2dEstimate", data["capabilityAssessment"]["implementedCapabilities"])
        self.assertNotIn("nonlinearModel.memberPlasticHingeBackboneCalibration", nonlinear["missingInputs"])
        self.assertIn("nonlinearModel.fullMemberConstitutiveModels", nonlinear["missingInputs"])
        self.assertEqual(data["pushover"]["finalCompliance"]["source"], "pushover.nonlinearEstimate.acceptanceCheck")
        self.assertIn("member-end rotational plastic-hinge", data["pushover"]["finalCompliance"]["scope"])

    def test_response_spectrum_supports_structured_cqc_and_srss_modal_combination(self) -> None:
        basis = build_design_basis(build_frame_model(), {}, {})
        modal = ModalAnalysis(
            modes=[
                {
                    "modeNumber": 1,
                    "period": 0.80,
                    "effectiveMass": 100.0,
                    "participationFactor": 1.0,
                    "massParticipationRatio": 0.50,
                    "cumulativeMassParticipationRatio": 0.50,
                    "storyShape": [{"story": "F1", "elevation": 3.6, "phi": 0.6}],
                },
                {
                    "modeNumber": 2,
                    "period": 0.82,
                    "effectiveMass": 80.0,
                    "participationFactor": 1.0,
                    "massParticipationRatio": 0.40,
                    "cumulativeMassParticipationRatio": 0.90,
                    "storyShape": [{"story": "F1", "elevation": 3.6, "phi": 0.5}],
                },
            ],
            total_mass=200.0,
            floor_masses=[{"story": "F1", "elevation": 3.6, "mass": 200.0, "weightKN": 200.0 * 9.80665}],
            model_dimension="2d",
            direction="x",
            engine_mode="unit-test",
        )

        cqc = run_response_spectrum(basis, modal, modal_combination="cqc")
        srss = run_response_spectrum(basis, modal, modal_combination="srss")

        self.assertEqual(cqc["modalCombination"], "cqc")
        self.assertEqual(srss["modalCombination"], "srss")
        self.assertGreater(cqc["baseShear"], srss["baseShear"])
        self.assertEqual(cqc["envelope"]["modalCombination"], "cqc")
        self.assertAlmostEqual(cqc["fundamentalPeriod"], 0.80)
        self.assertGreater(cqc["minStoryShearWeightRatio"], 0.0)
        self.assertGreater(cqc["floorResponses"][0]["storyShearKN"], 0.0)
        self.assertGreater(cqc["floorResponses"][0]["cumulativeWeightKN"], 0.0)
        self.assertAlmostEqual(
            cqc["floorResponses"][0]["shearWeightRatio"],
            cqc["minStoryShearWeightRatio"],
        )

    def test_response_spectrum_adjusts_floor_forces_for_minimum_story_shear(self) -> None:
        basis = build_design_basis(build_frame_model(), {}, {})
        modal = ModalAnalysis(
            modes=[
                {
                    "modeNumber": 1,
                    "period": 0.8,
                    "effectiveMass": 1.0,
                    "participationFactor": 1.0,
                    "massParticipationRatio": 0.10,
                    "cumulativeMassParticipationRatio": 0.10,
                    "storyShape": [
                        {"story": "F1", "elevation": 3.6, "phi": 0.6},
                        {"story": "F2", "elevation": 7.2, "phi": 1.0},
                    ],
                },
            ],
            total_mass=200.0,
            floor_masses=[
                {"story": "F1", "elevation": 3.6, "mass": 100.0, "weightKN": 100.0 * 9.80665},
                {"story": "F2", "elevation": 7.2, "mass": 100.0, "weightKN": 100.0 * 9.80665},
            ],
            model_dimension="2d",
            direction="x",
            engine_mode="unit-test",
        )
        raw = run_response_spectrum(basis, modal, modal_combination="cqc")
        adjusted = apply_minimum_story_shear_adjustment(
            raw,
            basis,
            {
                "checks": [
                    {
                        "name": "explicit_weak_soft_story",
                        "severity": "particularly_irregular",
                        "storyTriggers": [{"story": "F2"}],
                    }
                ]
            },
        )

        adjustment = adjusted["minimumStoryShearAdjustment"]
        first_floor, second_floor = adjusted["floorResponses"]
        self.assertEqual(adjustment["status"], "adjusted")
        self.assertGreater(adjustment["maxAdjustmentFactor"], 1.0)
        self.assertGreater(adjusted["baseShear"], raw["baseShear"])
        self.assertEqual(adjusted["rawBaseShear"], raw["baseShear"])
        self.assertTrue(second_floor["isWeakStory"])
        self.assertGreater(second_floor["minimumShearCoefficient"], first_floor["minimumShearCoefficient"])
        self.assertLess(first_floor["rawShearWeightRatio"], first_floor["minimumShearCoefficient"])
        self.assertGreaterEqual(first_floor["shearWeightRatio"], first_floor["minimumShearCoefficient"])
        self.assertGreaterEqual(second_floor["shearWeightRatio"], second_floor["minimumShearCoefficient"])
        self.assertAlmostEqual(
            sum(row["lateralForce"] for row in adjusted["floorResponses"]),
            adjusted["baseShear"],
            places=5,
        )

    def test_modal_time_history_scales_selected_records_and_checks_base_shear_ratio(self) -> None:
        basis = build_design_basis(build_frame_model(), {}, {})
        motions = parse_ground_motions([
            {"name": "GM1", "dt": 0.02, "unit": "g", "values": [0.0, 0.02, -0.02, 0.01] * 20},
            {"name": "GM2", "dt": 0.02, "unit": "g", "values": [0.0, -0.03, 0.03, -0.01] * 20},
            {"name": "GM3", "dt": 0.02, "unit": "g", "values": [0.0, 0.01, -0.01, 0.005] * 20},
        ])
        modal = ModalAnalysis(
            modes=[
                {
                    "modeNumber": 1,
                    "period": 0.8,
                    "effectiveMass": 100.0,
                    "participationFactor": 1.0,
                    "storyShape": [{"story": "F1", "elevation": 3.6, "phi": 0.5}],
                },
                {
                    "modeNumber": 2,
                    "period": 0.35,
                    "effectiveMass": 25.0,
                    "participationFactor": 1.0,
                    "storyShape": [{"story": "F1", "elevation": 3.6, "phi": 0.2}],
                },
            ],
            total_mass=125.0,
            floor_masses=[{"story": "F1", "elevation": 3.6, "mass": 125.0, "weightKN": 125.0 * 9.80665}],
            model_dimension="2d",
            direction="x",
            engine_mode="unit-test",
        )
        response_base_shear = float(run_response_spectrum(basis, modal, modal_combination="cqc")["baseShear"])

        result = run_modal_time_history(motions, basis, modal, response_base_shear, "envelope_max_vs_response_spectrum")

        self.assertEqual(len(result["records"]), 3)
        self.assertEqual(result["modalCombination"], "cqc")
        self.assertEqual(result["modesUsed"], 2)
        self.assertTrue(all(record["scaleFactor"] > 0 for record in result["records"]))
        self.assertTrue(all(record["modesUsed"] == 2 for record in result["records"]))
        self.assertTrue(all(len(record["modalResponses"]) == 2 for record in result["records"]))
        self.assertTrue(all(record["preview"]["unit"] == "g" for record in result["records"]))
        self.assertTrue(all(record["preview"]["pointCount"] == record["pointCount"] for record in result["records"]))
        self.assertTrue(all(len(record["preview"]["points"]) > 0 for record in result["records"]))
        self.assertEqual(result["records"][0]["preview"]["points"][1]["time"], 0.02)
        self.assertAlmostEqual(result["records"][0]["preview"]["points"][1]["accelG"], 0.02)
        self.assertTrue(all(record["modalResponses"][0]["modeNumber"] == 1 for record in result["records"]))
        self.assertTrue(all(record["targetSpectralAccelerationMps2"] > 0 for record in result["records"]))
        self.assertTrue(all(record["spectralAccelerationRatioToTarget"] > 0 for record in result["records"]))
        self.assertTrue(all(record["modalResponses"][1]["targetSpectralAccelerationMps2"] > 0 for record in result["records"]))
        self.assertTrue(all(record["modalResponses"][1]["spectralAccelerationRatioToTarget"] > 0 for record in result["records"]))
        self.assertTrue(math.isfinite(result["combinedBaseShear"]))
        self.assertIn("baseShearCheck", result)
        self.assertIn("spectrumMatch", result)
        self.assertEqual(result["spectrumMatch"]["recordCount"], 3)
        self.assertTrue(math.isfinite(result["spectrumMatch"]["maxScaleFactor"]))
        self.assertEqual(result["spectrumMatch"]["scaleFactorLimit"], 10.0)
        self.assertEqual(result["spectrumMatch"]["periodCheckScope"], "modal_period_points")
        self.assertEqual(result["spectrumMatch"]["modalSpectrumAverageMinRatio"], 0.65)
        self.assertEqual(len(result["spectrumMatch"]["periodChecks"]), 2)
        self.assertGreater(result["spectrumMatch"]["averageModalSpectrumMinRatioToTarget"], 0.0)
        self.assertEqual(result["combinationSummary"]["timeHistoryStatistic"], "envelope")
        self.assertEqual(result["combinationSummary"]["rule"], "envelope_max_vs_response_spectrum")
        self.assertAlmostEqual(
            result["combinedBaseShear"],
            max(result["envelopeBaseShear"], response_base_shear),
        )

    def test_modal_time_history_combines_seven_records_against_response_spectrum(self) -> None:
        basis = build_design_basis(build_frame_model(), {}, {})
        motions = parse_ground_motions([
            {"name": f"GM{index}", "dt": 0.02, "unit": "g", "values": [0.0, 0.01, -0.01, 0.005] * 20}
            for index in range(1, 8)
        ])
        modal = ModalAnalysis(
            modes=[
                {
                    "modeNumber": 1,
                    "period": 0.8,
                    "effectiveMass": 100.0,
                    "participationFactor": 1.0,
                    "storyShape": [{"story": "F1", "elevation": 3.6, "phi": 0.5}],
                },
            ],
            total_mass=100.0,
            floor_masses=[{"story": "F1", "elevation": 3.6, "mass": 100.0, "weightKN": 100.0 * 9.80665}],
            model_dimension="2d",
            direction="x",
            engine_mode="unit-test",
        )
        response_base_shear = 1_000_000.0

        result = run_modal_time_history(motions, basis, modal, response_base_shear, "mean_vs_response_spectrum")

        self.assertEqual(len(result["records"]), 7)
        self.assertEqual(result["combinationSummary"]["timeHistoryStatistic"], "average")
        self.assertEqual(result["combinationSummary"]["governingSource"], "response_spectrum")
        self.assertAlmostEqual(result["combinedBaseShear"], response_base_shear)
        self.assertAlmostEqual(result["combinationSummary"]["timeHistoryAverageBaseShear"], result["averageBaseShear"])

    def test_time_history_transient_story_drift_enters_envelope(self) -> None:
        wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
        result = run_seismic_analysis(build_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "time_history",
                "groundMotionSet": {
                    "requiredCount": 3,
                    "records": [
                        {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                        {"name": "GM2", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                        {"name": "GM3", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                    ],
                },
            },
        })
        data = result["data"]
        time_history = data["timeHistory"]
        transient = time_history["openSeesTransient"]
        transient_drifts = [
            float(record.get("maxStoryDriftRatio", 0.0) or 0.0)
            for record in transient["records"]
        ]

        self.assertEqual(time_history["engineMode"], "opensees_transient_check")
        self.assertGreater(max(transient_drifts), 0.0)
        self.assertAlmostEqual(time_history["maxStoryDriftRatio"], transient["maxStoryDriftRatio"])
        self.assertGreaterEqual(data["envelope"]["maxStoryDriftRatio"], time_history["maxStoryDriftRatio"])
        self.assertEqual(
            data["elasticStoryDriftFinalCompliance"]["source"],
            "envelope.maxStoryDriftRatio",
        )
        self.assertAlmostEqual(
            data["elasticStoryDriftFinalCompliance"]["driftRatio"],
            data["envelope"]["maxStoryDriftRatio"],
        )
        self.assertIn("controllingStory", time_history)

    def test_ground_motion_direction_components_are_selected_per_direction(self) -> None:
        motions = parse_ground_motions([
            {"name": "GM-X1", "direction": "x", "dt": 0.02, "unit": "g", "values": [0.0, 0.01, -0.01]},
            {"name": "GM-Y1", "component": "y", "dt": 0.02, "unit": "g", "values": [0.0, 0.02, -0.02]},
            {"name": "GM-U1", "dt": 0.02, "unit": "g", "values": [0.0, 0.03, -0.03]},
        ])

        x_motions, x_warnings = select_ground_motions_for_direction(motions, "x")
        y_motions, y_warnings = select_ground_motions_for_direction(motions, "y")

        self.assertEqual([motion.name for motion in x_motions], ["GM-X1", "GM-U1"])
        self.assertEqual([motion.name for motion in y_motions], ["GM-Y1", "GM-U1"])
        self.assertEqual(x_warnings, [])
        self.assertEqual(y_warnings, [])
        self.assertEqual(motions[0].to_summary()["direction"], "x")
        self.assertEqual(motions[1].to_summary()["direction"], "y")

    def test_multi_direction_time_history_uses_matching_ground_motion_components(self) -> None:
        wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
        result = run_seismic_analysis(build_space_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "time_history",
                "directions": ["x", "y"],
                "groundMotionSet": {
                    "requiredCount": 3,
                    "records": [
                        {"name": "X1", "direction": "x", "dt": 0.02, "unit": "g", "values": wave},
                        {"name": "X2", "direction": "x", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                        {"name": "X3", "direction": "x", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                        {"name": "Y1", "direction": "y", "dt": 0.02, "unit": "g", "values": [value * 1.2 for value in wave]},
                        {"name": "Y2", "direction": "y", "dt": 0.02, "unit": "g", "values": [value * 1.3 for value in wave]},
                        {"name": "Y3", "direction": "y", "dt": 0.02, "unit": "g", "values": [value * 0.8 for value in wave]},
                    ],
                },
            }
        })
        data = result["data"]
        by_direction = {item["direction"]: item for item in data["directionResults"]}

        self.assertEqual([record["direction"] for record in by_direction["x"]["timeHistory"]["records"]], ["x", "x", "x"])
        self.assertEqual([record["direction"] for record in by_direction["y"]["timeHistory"]["records"]], ["y", "y", "y"])
        self.assertEqual(data["groundMotionRequirement"]["missingCount"], 0)

    def test_multi_direction_time_history_reports_missing_direction_records(self) -> None:
        wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
        result = run_seismic_analysis(build_space_frame_model(), {
            "seismicWorkflow": {
                "methodPreference": "time_history",
                "directions": ["x", "y"],
                "groundMotionSet": {
                    "requiredCount": 3,
                    "records": [
                        {"name": "X1", "direction": "x", "dt": 0.02, "unit": "g", "values": wave},
                        {"name": "X2", "direction": "x", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                        {"name": "X3", "direction": "x", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                    ],
                },
            }
        })
        data = result["data"]
        by_direction = {item["direction"]: item for item in data["directionResults"]}
        requirement_by_direction = {
            item["direction"]: item
            for item in data["groundMotionRequirement"]["directionRequirements"]
        }

        self.assertEqual(result["status"], "partial")
        self.assertEqual([record["direction"] for record in by_direction["x"]["timeHistory"]["records"]], ["x", "x", "x"])
        self.assertIsNone(by_direction["y"]["timeHistory"])
        self.assertIn("groundMotions", data["missingInputs"])
        self.assertEqual(data["groundMotionRequirement"]["totalRequiredCount"], 6)
        self.assertEqual(data["groundMotionRequirement"]["providedCount"], 3)
        self.assertEqual(data["groundMotionRequirement"]["missingCount"], 3)
        self.assertEqual(requirement_by_direction["x"]["missingCount"], 0)
        self.assertEqual(requirement_by_direction["y"]["missingCount"], 3)
        self.assertEqual(data["summary"]["groundMotionRecordCount"], 3)
        self.assertEqual(data["summary"]["missingGroundMotionCount"], 3)

    def test_builtin_catalog_records_can_be_selected_by_structured_ids(self) -> None:
        records = resolve_builtin_catalog_records({
            "groundMotionSet": {
                "catalogIds": ["SCGM-A1", "SCGM-A2", "SCGM-A3"],
            },
        })

        self.assertEqual([record["id"] for record in records], ["SCGM-A1", "SCGM-A2", "SCGM-A3"])
        self.assertTrue(all(record["recordType"] == "artificial" for record in records))
        self.assertTrue(all(len(record["values"]) > 100 for record in records))

    def test_builtin_catalog_auto_select_uses_required_count(self) -> None:
        records = resolve_builtin_catalog_records({
            "groundMotionSet": {
                "source": "builtin_artificial",
                "autoSelect": True,
            },
        }, required_count=7, allow_auto_select=True)

        self.assertEqual(len(records), 7)
        self.assertEqual(records[0]["id"], "SCGM-A1")

    def test_common_recorded_catalog_is_metadata_only(self) -> None:
        references = list_recorded_reference_catalog()
        records = resolve_catalog_records({
            "groundMotionSet": {
                "source": "builtin_reference",
                "catalogIds": ["SCGM-R1", "SCGM-R4"],
            },
        })

        self.assertEqual(len(references), 7)
        self.assertEqual(references[0]["id"], "SCGM-R1")
        self.assertFalse(references[0]["usableForAnalysis"])
        self.assertEqual(references[0]["dataAvailability"], "metadata_only")
        self.assertEqual(records, [])

    def test_local_catalog_records_can_be_selected_by_structured_ids(self) -> None:
        records = resolve_catalog_records({
            "groundMotionSet": {
                "source": "local_catalog",
                "catalogIds": ["LC-03", "LC-02"],
                "localCatalog": {
                    "records": [
                        {"id": "LC-01", "name": "unused", "dt": 0.02, "unit": "g", "values": [0.0, 0.01, -0.01]},
                        {"id": "LC-02", "name": "record 2", "dt": 0.02, "unit": "g", "values": [0.0, 0.02, -0.02]},
                        {"id": "LC-03", "name": "record 3", "dt": 0.02, "unit": "g", "values": [0.0, -0.03, 0.03]},
                    ],
                },
            },
        })

        self.assertEqual([record["id"] for record in records], ["LC-03", "LC-02"])
        self.assertTrue(all(record["source"] == "local_ground_motion_catalog" for record in records))
        self.assertTrue(all(record["recordType"] == "actual" for record in records))

    def test_local_catalog_records_can_be_selected_by_structured_metadata(self) -> None:
        wave = [0.0, 0.01, -0.01]
        records = resolve_catalog_records({
            "groundMotionSet": {
                "source": "local_catalog",
                "requiredCount": 2,
                "selectionCriteria": {
                    "recordType": "actual",
                    "siteClass": "III",
                    "minMagnitude": 6.0,
                    "maxMagnitude": 7.0,
                    "maxDistanceKm": 50.0,
                    "targetMagnitude": 6.6,
                    "targetDistanceKm": 30.0,
                },
                "localCatalog": {
                    "records": [
                        {"id": "LC-01", "recordType": "actual", "siteClass": "II", "magnitude": 6.6, "distanceKm": 28.0, "dt": 0.02, "unit": "g", "values": wave},
                        {"id": "LC-02", "recordType": "actual", "siteClass": "III", "magnitude": 6.5, "distanceKm": 35.0, "dt": 0.02, "unit": "g", "values": wave},
                        {"id": "LC-03", "recordType": "actual", "siteClass": "III", "magnitude": 6.8, "distanceKm": 22.0, "dt": 0.02, "unit": "g", "values": wave},
                        {"id": "LC-04", "recordType": "artificial", "siteClass": "III", "magnitude": 6.6, "distanceKm": 30.0, "dt": 0.02, "unit": "g", "values": wave},
                    ],
                },
            },
        })

        self.assertEqual([record["id"] for record in records], ["LC-02", "LC-03"])
        self.assertTrue(all(record["recordType"] == "actual" for record in records))
        self.assertTrue(all(record["siteClass"] == "III" for record in records))

    def test_uploaded_csv_rows_can_drive_ground_motion_record(self) -> None:
        motions = parse_ground_motions([{
            "name": "uploaded-wave.csv",
            "unit": "g",
            "headers": ["time", "accel_g"],
            "rows": [
                ["0.00", "0.000"],
                ["0.02", "0.010"],
                ["0.04", "-0.010"],
                ["0.06", "0.005"],
            ],
        }])

        self.assertEqual(len(motions), 1)
        self.assertEqual(motions[0].name, "uploaded-wave.csv")
        self.assertAlmostEqual(motions[0].dt, 0.02)
        self.assertEqual(motions[0].source_format, "rows")
        self.assertEqual(len(motions[0].accelerations_mps2), 4)
        self.assertAlmostEqual(motions[0].accelerations_mps2[1], 0.010 * 9.80665)

    def test_uploaded_at2_text_can_drive_ground_motion_record(self) -> None:
        motions = parse_ground_motions([{
            "name": "uploaded-wave.at2",
            "unit": "g",
            "content": "\n".join([
                "PEER NGA STRONG MOTION DATABASE RECORD",
                "NPTS= 6, DT= .02 SEC",
                "0.000 0.010 -0.010",
                "0.005 -0.005 0.000",
            ]),
        }])

        self.assertEqual(len(motions), 1)
        self.assertAlmostEqual(motions[0].dt, 0.02)
        self.assertEqual(motions[0].source_format, "text")
        self.assertEqual(len(motions[0].accelerations_mps2), 6)


if __name__ == "__main__":
    unittest.main()
