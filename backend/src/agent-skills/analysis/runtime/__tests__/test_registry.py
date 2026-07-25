from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any, Dict


TEST_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = TEST_DIR.parent
ANALYSIS_DIR = RUNTIME_DIR.parent
BACKEND_SRC_DIR = ANALYSIS_DIR.parents[1]

sys.path.insert(0, str(RUNTIME_DIR))
sys.path.insert(0, str(BACKEND_SRC_DIR / "skill-shared" / "python"))

from registry import AnalysisEngineRegistry  # noqa: E402
from api import AnalysisRequest, _exception_error_code  # noqa: E402
from contracts import AnalysisCapabilityError  # noqa: E402
from structure_protocol.structure_model_v2 import StructureModelV2  # noqa: E402


def _coordinate_system(dimension: str = "2d") -> dict:
    return {
        "semantics": "global-z-up",
        "version": 1,
        "dimension": dimension,
        "plane": "xz" if dimension == "2d" else None,
        "dof_order": ["ux", "uy", "uz", "rx", "ry", "rz"],
    }


def build_frame_model() -> StructureModelV2:
    return StructureModelV2.model_validate({
        "schema_version": "2.0.0",
        "unit_system": "SI",
        "coordinate_system": _coordinate_system(),
        "nodes": [
            {"id": "B1", "x": 0.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "B2", "x": 6.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "T1", "x": 0.0, "y": 0.0, "z": 3.6},
            {"id": "T2", "x": 6.0, "y": 0.0, "z": 3.6},
        ],
        "materials": [{"id": "m1", "name": "C30", "E": 30000.0, "nu": 0.2, "rho": 2500.0}],
        "sections": [
            {"id": "s1", "name": "500x500", "type": "rectangular", "properties": {"A": 0.25, "Iy": 0.005, "Iz": 0.005, "J": 0.01}}
        ],
        "elements": [
            {"id": "C1", "type": "column", "nodes": ["B1", "T1"], "material": "m1", "section": "s1"},
            {"id": "C2", "type": "column", "nodes": ["B2", "T2"], "material": "m1", "section": "s1"},
            {"id": "B1", "type": "beam", "nodes": ["T1", "T2"], "material": "m1", "section": "s1"},
        ],
    })


class CapturingRegistry(AnalysisEngineRegistry):
    def __init__(self) -> None:
        super().__init__("test-runtime", "0.1.0")
        self.captured: Dict[str, Any] | None = None

    def list_engines(self) -> list[Dict[str, Any]]:
        return [{
            "id": "builtin-opensees",
            "name": "OpenSees Builtin",
            "version": "0.1.0",
            "kind": "python",
            "adapterKey": "builtin-opensees",
            "capabilities": ["analyze", "validate", "code-check"],
            "supportedAnalysisTypes": ["static", "dynamic", "seismic", "nonlinear"],
            "supportedModelFamilies": ["frame", "truss", "generic"],
            "priority": 100,
            "routingHints": ["high-fidelity", "default"],
            "visibility": "builtin",
            "enabled": True,
            "available": True,
            "status": "available",
            "constraints": {},
            "skillIds": ["opensees-seismic"],
        }]

    def _run_python_analysis(
        self,
        adapter_key: str,
        analysis_type: str,
        model: StructureModelV2,
        parameters: Dict[str, Any],
    ) -> Dict[str, Any]:
        skill = self._resolve_builtin_skill(adapter_key, analysis_type)
        self.captured = {
            "adapterKey": adapter_key,
            "analysisType": analysis_type,
            "parameters": parameters,
            "skillId": skill["id"] if skill else None,
        }
        return {
            "workflowInputMode": "structured_seismic_workflow",
            "data": {"workflowInputMode": "structured_seismic_workflow"},
            "meta": {"analysisSkillId": self.captured["skillId"]},
        }


class AnalysisRegistryTest(unittest.TestCase):
    def test_capability_error_has_a_stable_machine_readable_code(self) -> None:
        error = AnalysisCapabilityError(
            engine="yjk",
            capability="canonical-3d-building-model",
            reason="YJK requires a genuine 3-D model",
        )

        self.assertEqual(_exception_error_code(error), "ENGINE_INPUT_UNSUPPORTED")
        self.assertEqual(error.meta["failureKind"], "capability-boundary")
        self.assertEqual(error.meta["capability"], "canonical-3d-building-model")
        self.assertEqual(_exception_error_code(RuntimeError("solver crashed")), "ANALYSIS_EXECUTION_FAILED")

    def test_worker_request_migrates_v1_before_requiring_the_v2_coordinate_contract(self) -> None:
        legacy_model = build_frame_model().model_dump(mode="json")
        legacy_model["schema_version"] = "1.0.0"
        legacy_model.pop("coordinate_system")
        legacy_model["metadata"] = {}

        request = AnalysisRequest.model_validate({
            "type": "static",
            "model": legacy_model,
            "parameters": {},
        })

        self.assertEqual(request.model.coordinate_system.dimension, "2d")
        self.assertEqual(request.model.coordinate_system.plane, "xz")

    def test_worker_request_rejects_untyped_v2_instead_of_guessing(self) -> None:
        untyped_model = build_frame_model().model_dump(mode="json")
        untyped_model.pop("coordinate_system")

        with self.assertRaisesRegex(ValueError, "typed coordinate_system"):
            AnalysisRequest.model_validate({
                "type": "static",
                "model": untyped_model,
                "parameters": {},
            })

    def test_auto_seismic_analysis_routes_to_opensees_seismic_without_stripping_workflow(self) -> None:
        workflow = {
            "methodPreference": "response_spectrum",
            "designBasis": {
                "siteSeismic": {
                    "intensity": 8,
                    "designGroup": "2",
                    "siteCategory": "III",
                },
            },
        }
        parameters = {"seismicWorkflow": workflow}
        registry = CapturingRegistry()

        result = registry.run_analysis("seismic", build_frame_model(), parameters)

        self.assertIsNotNone(registry.captured)
        self.assertEqual(registry.captured["adapterKey"], "builtin-opensees")
        self.assertEqual(registry.captured["analysisType"], "seismic")
        self.assertEqual(registry.captured["skillId"], "opensees-seismic")
        self.assertEqual(registry.captured["parameters"]["seismicWorkflow"], workflow)
        self.assertEqual(result["meta"]["engineId"], "builtin-opensees")
        self.assertEqual(result["meta"]["selectionMode"], "auto")
        self.assertEqual(result["meta"]["analysisSkillId"], "opensees-seismic")


if __name__ == "__main__":
    unittest.main()
