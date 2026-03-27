import asyncio
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import HTTPException

from api import AnalysisRequest, analyze
from converters.registry import get_converter, supported_formats
from opensees_runtime import get_opensees_runtime_issue
from registry import AnalysisEngineRegistry
from runtime import run_code_check
from structure_protocol.runtime import convert_structure_model_payload
from structure_protocol.structure_model_v1 import (
    Element,
    Material,
    Node,
    Section,
    StructureModelV1,
)


ROOT_DIR = Path(__file__).resolve().parents[2]


def assert_true(condition, message):
    if not condition:
        raise SystemExit(message)


def get_by_path(obj, dotted):
    current = obj
    for part in dotted.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            raise KeyError(f"Path not found: {dotted}")
    return current


def validate_opensees_runtime_and_routing():
    import types

    def run_request(payload, engine_id="builtin-opensees"):
        request = AnalysisRequest.model_validate(
            {
                "type": "static",
                "model": payload,
                "parameters": {"loadCaseIds": ["LC1"]},
                "engineId": engine_id,
            }
        )
        return asyncio.run(analyze(request)).model_dump(mode="json")

    issue = get_opensees_runtime_issue()

    cantilever = {
        "schema_version": "1.0.0",
        "nodes": [
            {"id": "1", "x": 0.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "2", "x": 5.0, "y": 0.0, "z": 0.0},
            {"id": "3", "x": 10.0, "y": 0.0, "z": 0.0},
        ],
        "elements": [
            {"id": "1", "type": "beam", "nodes": ["1", "2"], "material": "1", "section": "1"},
            {"id": "2", "type": "beam", "nodes": ["2", "3"], "material": "1", "section": "1"},
        ],
        "materials": [{"id": "1", "name": "steel", "E": 205000.0, "nu": 0.3, "rho": 7850}],
        "sections": [
            {
                "id": "1",
                "name": "B1",
                "type": "beam",
                "properties": {"A": 0.01, "Iy": 0.0001, "Iz": 0.0001, "J": 0.0001, "G": 79000},
            }
        ],
        "load_cases": [{"id": "LC1", "type": "other", "loads": [{"node": "3", "fy": -10.0}]}],
        "load_combinations": [],
    }

    simply_supported = {
        "schema_version": "1.0.0",
        "nodes": [
            {"id": "1", "x": 0.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, False]},
            {"id": "2", "x": 3.0, "y": 0.0, "z": 0.0},
            {"id": "3", "x": 6.0, "y": 0.0, "z": 0.0, "restraints": [False, True, True, True, True, False]},
        ],
        "elements": [
            {"id": "1", "type": "beam", "nodes": ["1", "2"], "material": "1", "section": "1"},
            {"id": "2", "type": "beam", "nodes": ["2", "3"], "material": "1", "section": "1"},
        ],
        "materials": [{"id": "1", "name": "steel", "E": 205000.0, "nu": 0.3, "rho": 7850}],
        "sections": [
            {
                "id": "1",
                "name": "B1",
                "type": "beam",
                "properties": {"A": 0.01, "Iy": 0.0001, "Iz": 0.0001, "J": 0.0001, "G": 79000},
            }
        ],
        "load_cases": [{"id": "LC1", "type": "other", "loads": [{"node": "2", "fy": -20.0}]}],
        "load_combinations": [],
    }

    portal_frame = {
        "schema_version": "1.0.0",
        "nodes": [
            {"id": "1", "x": 0.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "2", "x": 8.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "3", "x": 0.0, "y": 4.0, "z": 0.0},
            {"id": "4", "x": 8.0, "y": 4.0, "z": 0.0},
        ],
        "elements": [
            {"id": "1", "type": "beam", "nodes": ["1", "3"], "material": "1", "section": "1"},
            {"id": "2", "type": "beam", "nodes": ["3", "4"], "material": "1", "section": "1"},
            {"id": "3", "type": "beam", "nodes": ["4", "2"], "material": "1", "section": "1"},
        ],
        "materials": [{"id": "1", "name": "steel", "E": 205000.0, "nu": 0.3, "rho": 7850}],
        "sections": [
            {
                "id": "1",
                "name": "PF1",
                "type": "beam",
                "properties": {"A": 0.02, "Iy": 0.0002, "Iz": 0.0002, "J": 0.0002, "G": 79000},
            }
        ],
        "load_cases": [{"id": "LC1", "type": "other", "loads": [{"node": "3", "fy": -5.0}, {"node": "4", "fy": -5.0}]}],
        "load_combinations": [],
    }

    registry = AnalysisEngineRegistry("StructureClaw Analysis Engine", "0.1.0")
    model = StructureModelV1.model_validate(simply_supported)

    if issue is None:
        print("[ok] OpenSees runtime smoke test")

        cantilever_result = run_request(cantilever)
        assert_true(cantilever_result["success"] is True, f"Cantilever OpenSees analysis failed: {cantilever_result['message']}")
        assert_true(cantilever_result["data"]["analysisMode"] == "opensees_2d_frame", f"Unexpected cantilever analysisMode: {cantilever_result['data']['analysisMode']}")
        assert_true(cantilever_result["data"].get("plane") == "xy", f"Unexpected cantilever plane: {cantilever_result['data'].get('plane')}")
        tip_uy = float(cantilever_result["data"]["displacements"]["3"]["uy"])
        assert_true(math.isfinite(tip_uy) and tip_uy < 0.0, f"Cantilever tip displacement invalid: {tip_uy}")
        assert_true("1" in cantilever_result["data"]["reactions"], "Cantilever reactions missing at fixed support")
        print("[ok] cantilever beam solves with builtin-opensees")

        simply_supported_result = run_request(simply_supported)
        assert_true(simply_supported_result["success"] is True, f"Simply-supported OpenSees analysis failed: {simply_supported_result['message']}")
        assert_true(simply_supported_result["data"]["analysisMode"] == "opensees_2d_frame", f"Unexpected simply-supported analysisMode: {simply_supported_result['data']['analysisMode']}")
        assert_true(simply_supported_result["data"].get("plane") == "xy", f"Unexpected simply-supported plane: {simply_supported_result['data'].get('plane')}")
        midspan_uy = float(simply_supported_result["data"]["displacements"]["2"]["uy"])
        assert_true(math.isfinite(midspan_uy) and midspan_uy < 0.0, f"Simply-supported midspan displacement invalid: {midspan_uy}")
        print("[ok] simply-supported beam solves with builtin-opensees")

        portal_result = run_request(portal_frame)
        assert_true(portal_result["success"] is True, f"Portal-frame OpenSees analysis failed: {portal_result['message']}")
        assert_true(portal_result["data"]["analysisMode"] == "opensees_2d_frame", f"Unexpected portal-frame analysisMode: {portal_result['data']['analysisMode']}")
        roof_uy = float(portal_result["data"]["displacements"]["3"]["uy"])
        assert_true(math.isfinite(roof_uy) and roof_uy < 0.0, f"Portal-frame roof displacement invalid: {roof_uy}")
        print("[ok] portal frame solves with builtin-opensees")

        def fake_execute(self, selection, analysis_type, model, parameters, engine_id):
            if selection.engine["id"] == "builtin-opensees":
                raise RuntimeError("simulated runtime failure")
            return {
                "status": "success",
                "analysisMode": "linear_2d_frame",
                "displacements": {},
                "forces": {},
                "reactions": {},
                "envelope": {},
                "summary": {},
            }

        registry._execute_analysis_selection = types.MethodType(fake_execute, registry)

        auto_result = registry.run_analysis("static", model, {"loadCaseIds": ["LC1"]}, None)
        assert_true(auto_result["meta"]["engineId"] == "builtin-simplified", f"Expected fallback engine, got {auto_result['meta']['engineId']}")
        assert_true(auto_result["meta"]["selectionMode"] == "fallback", f"Expected fallback selectionMode, got {auto_result['meta']['selectionMode']}")
        assert_true(auto_result["meta"]["fallbackFrom"] == "builtin-opensees", f"Expected fallbackFrom builtin-opensees, got {auto_result['meta']['fallbackFrom']}")
        print("[ok] auto engine falls back on runtime failure")

        try:
            registry.run_analysis("static", model, {"loadCaseIds": ["LC1"]}, "builtin-opensees")
        except RuntimeError as error:
            assert_true("simulated runtime failure" in str(error), f"Unexpected manual failure reason: {error}")
            print("[ok] manual engine selection does not fall back")
        else:
            raise SystemExit("Manual builtin-opensees selection should not fall back")
    else:
        print(f"[skip] OpenSees runtime smoke test unavailable: {issue}")
        engines = {engine["id"]: engine for engine in registry.list_engines()}
        opensees = engines.get("builtin-opensees")
        simplified = engines.get("builtin-simplified")
        assert_true(opensees is not None, "builtin-opensees manifest missing")
        assert_true(simplified is not None, "builtin-simplified manifest missing")
        assert_true(opensees["available"] is False, "builtin-opensees should be marked unavailable when runtime probe fails")
        assert_true(opensees["status"] == "unavailable", f"Unexpected builtin-opensees status: {opensees['status']}")
        assert_true(isinstance(opensees.get("unavailableReason"), str) and opensees["unavailableReason"], "builtin-opensees should expose unavailableReason")
        assert_true(simplified["available"] is True, "builtin-simplified should remain available when OpenSees is unavailable")

        auto_result = registry.run_analysis("static", model, {"loadCaseIds": ["LC1"]}, None)
        assert_true(auto_result["meta"]["engineId"] == "builtin-simplified", f"Expected builtin-simplified auto selection, got {auto_result['meta']['engineId']}")
        assert_true(auto_result["meta"]["selectionMode"] == "fallback", f"Expected fallback selectionMode, got {auto_result['meta']['selectionMode']}")
        assert_true(auto_result["meta"]["fallbackFrom"] == "builtin-opensees", f"Expected fallbackFrom builtin-opensees, got {auto_result['meta']['fallbackFrom']}")
        print("[ok] auto engine pre-routes away from unavailable OpenSees runtime")

        manual_request = AnalysisRequest.model_validate(
            {
                "type": "static",
                "model": simply_supported,
                "parameters": {"loadCaseIds": ["LC1"]},
                "engineId": "builtin-opensees",
            }
        )
        try:
            asyncio.run(analyze(manual_request))
        except Exception as error:
            status_code = getattr(error, "status_code", None)
            detail = getattr(error, "detail", {})
            assert_true(status_code == 422, f"Expected manual unavailable engine to raise 422, got {status_code}")
            assert_true(isinstance(detail, dict) and detail.get("errorCode") == "ENGINE_UNAVAILABLE", f"Unexpected manual unavailable detail: {detail}")
            print("[ok] manual builtin-opensees selection reports unavailable runtime")
        else:
            raise SystemExit("Manual builtin-opensees selection should fail when runtime is unavailable")

        unsupported_request = AnalysisRequest.model_validate(
            {
                "type": "nonlinear",
                "model": simply_supported,
                "parameters": {"loadCaseIds": ["LC1"]},
                "engineId": "builtin-simplified",
            }
        )
        try:
            asyncio.run(analyze(unsupported_request))
        except Exception as error:
            status_code = getattr(error, "status_code", None)
            detail = getattr(error, "detail", {})
            assert_true(status_code == 422, f"Expected unsupported engine request to raise 422, got {status_code}")
            assert_true(isinstance(detail, dict) and detail.get("errorCode") == "ENGINE_UNSUPPORTED", f"Unexpected unsupported engine detail: {detail}")
            print("[ok] manual unsupported engine selection reports unsupported request")
        else:
            raise SystemExit("Manual builtin-simplified nonlinear selection should fail as unsupported")


def validate_analyze_contract():
    model = StructureModelV1(
        schema_version="1.0.0",
        nodes=[
            Node(id="1", x=0, y=0, z=0, restraints=[True, True, True, True, True, True]),
            Node(id="2", x=0, y=0, z=3),
        ],
        elements=[Element(id="1", type="beam", nodes=["1", "2"], material="1", section="1")],
        materials=[Material(id="1", name="steel", E=200000, nu=0.3, rho=7850, fy=345)],
        sections=[
            Section(
                id="1",
                name="W",
                type="beam",
                properties={"A": 0.01, "E": 200000, "Iz": 0.0001, "Iy": 0.0001, "G": 79000, "J": 0.0001},
            )
        ],
    )

    ok_request = AnalysisRequest(type="static", model=model, parameters={})
    ok_result = asyncio.run(analyze(ok_request)).model_dump()
    required = {"schema_version", "analysis_type", "success", "error_code", "message", "data", "meta"}
    missing = required - set(ok_result.keys())
    if missing:
        raise SystemExit(f"Missing analyze envelope fields: {sorted(missing)}")
    if ok_result["success"] is not True:
        raise SystemExit("Expected success=true for static request")
    if ok_result["analysis_type"] != "static":
        raise SystemExit(f"Expected analysis_type=static, got {ok_result['analysis_type']}")
    if ok_result["schema_version"] != "1.0.0":
        raise SystemExit(f"Expected schema_version=1.0.0, got {ok_result['schema_version']}")
    required_meta = {"engineId", "engineName", "engineVersion", "engineKind", "selectionMode", "timestamp"}
    missing_meta = required_meta - set(ok_result["meta"].keys())
    if missing_meta:
        raise SystemExit(f"meta fields required: {sorted(missing_meta)}")
    print("[ok] analyze success envelope contract")

    truss_3d_model = StructureModelV1(
        schema_version="1.0.0",
        nodes=[
            Node(id="1", x=0, y=1, z=0, restraints=[True, True, True, False, False, False]),
            Node(id="2", x=2, y=1, z=0, restraints=[False, True, True, False, False, False]),
        ],
        elements=[Element(id="1", type="truss", nodes=["1", "2"], material="1", section="1")],
        materials=[Material(id="1", name="steel", E=200000, nu=0.3, rho=7850)],
        sections=[Section(id="1", name="A1", type="rod", properties={"A": 0.01})],
        load_cases=[{"id": "LC1", "type": "other", "loads": [{"node": "2", "fx": 10.0}]}],
        load_combinations=[],
    )

    truss_3d_request = AnalysisRequest(type="static", model=truss_3d_model, parameters={"loadCaseIds": ["LC1"]})
    truss_3d_result = asyncio.run(analyze(truss_3d_request)).model_dump()
    if truss_3d_result["success"] is not True:
        raise SystemExit("Expected success=true for 3D truss request")
    data = truss_3d_result.get("data", {})
    if data.get("analysisMode") != "linear_3d_truss":
        raise SystemExit(f"Expected analysisMode=linear_3d_truss, got {data.get('analysisMode')}")
    required_data_fields = {"displacements", "forces", "reactions", "envelope", "summary"}
    missing_data = required_data_fields - set(data.keys())
    if missing_data:
        raise SystemExit(f"Missing analyze data fields for 3D truss: {sorted(missing_data)}")
    required_envelope_fields = {
        "maxAbsDisplacement",
        "maxAbsAxialForce",
        "maxAbsShearForce",
        "maxAbsMoment",
        "maxAbsReaction",
    }
    missing_envelope = required_envelope_fields - set((data.get("envelope") or {}).keys())
    if missing_envelope:
        raise SystemExit(f"Missing envelope fields for 3D truss: {sorted(missing_envelope)}")
    print("[ok] analyze 3d truss envelope contract")

    frame_3d_model = StructureModelV1(
        schema_version="1.0.0",
        nodes=[
            Node(id="1", x=0, y=0, z=0, restraints=[True, True, True, True, True, True]),
            Node(id="2", x=0, y=3, z=2, restraints=[True, False, False, True, False, False]),
        ],
        elements=[Element(id="1", type="beam", nodes=["1", "2"], material="1", section="1")],
        materials=[Material(id="1", name="steel", E=200000, nu=0.3, rho=7850)],
        sections=[Section(id="1", name="B1", type="beam", properties={"A": 0.01, "Iy": 0.0001, "Iz": 0.0001, "J": 0.00002, "G": 79000})],
        load_cases=[{"id": "LC1", "type": "other", "loads": [{"node": "2", "fy": 6.0, "fz": 4.0}]}],
        load_combinations=[],
    )

    frame_3d_request = AnalysisRequest(
        type="static",
        model=frame_3d_model,
        parameters={"loadCaseIds": ["LC1"]},
        engineId="builtin-simplified",
    )
    frame_3d_result = asyncio.run(analyze(frame_3d_request)).model_dump()
    if frame_3d_result["success"] is not True:
        raise SystemExit("Expected success=true for 3D frame request")
    if frame_3d_result.get("data", {}).get("analysisMode") != "linear_3d_frame":
        raise SystemExit(f"Expected analysisMode=linear_3d_frame, got {frame_3d_result.get('data', {}).get('analysisMode')}")
    print("[ok] analyze 3d frame envelope contract")

    simplified_planar_beam_model = StructureModelV1(
        schema_version="1.0.0",
        nodes=[
            Node(id="1", x=0, y=0, z=0, restraints=[True, True, True, True, True, True]),
            Node(id="2", x=5, y=0, z=0),
            Node(id="3", x=10, y=0, z=0),
        ],
        elements=[
            Element(id="1", type="beam", nodes=["1", "2"], material="1", section="1"),
            Element(id="2", type="beam", nodes=["2", "3"], material="1", section="1"),
        ],
        materials=[Material(id="1", name="steel", E=200000, nu=0.3, rho=7850)],
        sections=[Section(id="1", name="B1", type="beam", properties={"A": 0.01, "Iy": 0.0001, "Iz": 0.0002, "J": 0.00002, "G": 79000})],
        load_cases=[{"id": "LC1", "type": "other", "loads": [{"node": "3", "fy": -10.0}]}],
        load_combinations=[],
    )

    simplified_planar_request = AnalysisRequest(
        type="static",
        model=simplified_planar_beam_model,
        parameters={"loadCaseIds": ["LC1"]},
        engineId="builtin-simplified",
    )
    simplified_planar_result = asyncio.run(analyze(simplified_planar_request)).model_dump()
    if simplified_planar_result["success"] is not True:
        raise SystemExit("Expected success=true for simplified planar beam request")
    simplified_data = simplified_planar_result.get("data", {})
    if simplified_data.get("analysisMode") != "linear_2d_frame":
        raise SystemExit(f"Expected simplified planar beam analysisMode=linear_2d_frame, got {simplified_data.get('analysisMode')}")
    if simplified_data.get("plane") != "xy":
        raise SystemExit(f"Expected simplified planar beam plane=xy, got {simplified_data.get('plane')}")
    tip_disp = simplified_data.get("displacements", {}).get("3", {})
    if abs(float(tip_disp.get("uy", 0.0))) <= 0.0:
        raise SystemExit(f"Expected non-zero simplified planar beam uy displacement, got {tip_disp}")
    if abs(float(tip_disp.get("uz", 0.0))) > 1e-9:
        raise SystemExit(f"Expected near-zero simplified planar beam uz displacement, got {tip_disp}")
    print("[ok] analyze simplified planar beam routes to 2d xy frame")

    bad_request = AnalysisRequest(type="unknown", model=model, parameters={})
    try:
        asyncio.run(analyze(bad_request))
        raise SystemExit("Expected HTTPException for invalid analysis type")
    except HTTPException as exc:
        if exc.status_code != 400:
            raise SystemExit(f"Expected HTTP 400, got {exc.status_code}")
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        if detail.get("errorCode") != "INVALID_ANALYSIS_TYPE":
            raise SystemExit(f"Expected INVALID_ANALYSIS_TYPE, got {detail.get('errorCode')}")
        print("[ok] analyze invalid type error contract")


def validate_code_check_traceability():
    result = run_code_check(
        "trace-demo",
        "GB50017",
        ["E1"],
        {
            "analysisSummary": {"analysisType": "static", "success": True},
            "utilizationByElement": {"E1": {"正应力": 0.73}},
        },
    )

    assert result["traceability"]["modelId"] == "trace-demo"
    assert result["traceability"]["analysisSummary"]["analysisType"] == "static"
    detail = result["details"][0]
    item = detail["checks"][0]["items"][0]
    assert item["clause"]
    assert item["formula"]
    assert item["inputs"]["demand"] >= 0
    assert item["utilization"] >= 0
    print("[ok] code-check traceability contract")


def validate_static_regression():
    base = ROOT_DIR / "backend/src/skill-shared/python/structure_protocol/regression/static_2d"
    cases = sorted(base.glob("case_*.json"))
    if not cases:
        raise SystemExit("No regression case files found")

    for file_path in cases:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        request_payload = dict(payload["request"])
        request_payload["engineId"] = "builtin-simplified"
        request = AnalysisRequest.model_validate(request_payload)
        result = asyncio.run(analyze(request)).model_dump(mode="json")
        if result.get("success") is not True:
            raise SystemExit(f"{file_path.name}: analyze failed: {result.get('message')}")

        tolerance = float(payload.get("abs_tolerance", 1e-6))
        for dotted_path, expected in payload.get("expected", {}).items():
            actual = get_by_path(result, dotted_path)
            if isinstance(expected, str):
                if actual != expected:
                    raise SystemExit(f"{file_path.name}: {dotted_path} expected '{expected}', got '{actual}'")
                continue
            actual_f = float(actual)
            expected_f = float(expected)
            if not math.isfinite(actual_f):
                raise SystemExit(f"{file_path.name}: {dotted_path} is not finite: {actual}")
            if abs(actual_f - expected_f) > tolerance:
                raise SystemExit(f"{file_path.name}: {dotted_path} mismatch, expected {expected_f}, got {actual_f}, tol {tolerance}")
        print(f"[ok] {file_path.name}")

    print(f"Validated {len(cases)} static regression cases.")


def validate_static_3d_regression():
    base = ROOT_DIR / "backend/src/skill-shared/python/structure_protocol/regression/static_3d"
    cases = sorted(base.glob("case_*.json"))
    if not cases:
        raise SystemExit("No 3D regression case files found")

    for file_path in cases:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        request_payload = dict(payload["request"])
        request_payload["engineId"] = "builtin-simplified"
        request = AnalysisRequest.model_validate(request_payload)
        result = asyncio.run(analyze(request)).model_dump(mode="json")
        if result.get("success") is not True:
            raise SystemExit(f"{file_path.name}: analyze failed: {result.get('message')}")

        tolerance = float(payload.get("abs_tolerance", 1e-6))
        for dotted_path, expected in payload.get("expected", {}).items():
            actual = get_by_path(result, dotted_path)
            if isinstance(expected, str):
                if actual != expected:
                    raise SystemExit(f"{file_path.name}: {dotted_path} expected '{expected}', got '{actual}'")
                continue
            actual_f = float(actual)
            expected_f = float(expected)
            if not math.isfinite(actual_f):
                raise SystemExit(f"{file_path.name}: {dotted_path} is not finite: {actual}")
            if abs(actual_f - expected_f) > tolerance:
                raise SystemExit(f"{file_path.name}: {dotted_path} mismatch, expected {expected_f}, got {actual_f}, tol {tolerance}")
        print(f"[ok] {file_path.name}")

    print(f"Validated {len(cases)} static 3D regression cases.")


def validate_structure_examples():
    base = ROOT_DIR / "backend/src/skill-shared/python/structure_protocol/examples"
    files = sorted(base.glob("*.json"))
    if not files:
        raise SystemExit("No example files found under backend/src/skill-shared/python/structure_protocol/examples")

    minimum_expected = 20
    if len(files) < minimum_expected:
        raise SystemExit(f"Need at least {minimum_expected} examples for roadmap baseline, found {len(files)}")

    validated = 0
    for file_path in files:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        StructureModelV1.model_validate(payload)
        validated += 1
        print(f"[ok] {file_path.name}")

    print(f"Validated {validated} StructureModel v1 examples.")


def validate_convert_roundtrip():
    sample_file = ROOT_DIR / "backend/src/skill-shared/python/structure_protocol/examples/model_03_simple_truss.json"
    source = json.loads(sample_file.read_text(encoding="utf-8"))

    for external_format in ("simple-1", "compact-1", "midas-text-1"):
        exported = convert_structure_model_payload(
            model_payload=source,
            target_schema_version="1.0.0",
            source_format="structuremodel-v1",
            target_format=external_format,
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )

        imported = convert_structure_model_payload(
            model_payload=exported["model"],
            target_schema_version="1.0.0",
            source_format=external_format,
            target_format="structuremodel-v1",
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )

        round_trip = imported["model"]
        assert round_trip["schema_version"] == "1.0.0"
        assert len(source["nodes"]) == len(round_trip["nodes"])
        assert len(source["elements"]) == len(round_trip["elements"])
        assert {node["id"] for node in source["nodes"]} == {node["id"] for node in round_trip["nodes"]}
        assert {element["id"] for element in source["elements"]} == {element["id"] for element in round_trip["elements"]}
        print(f"[ok] convert round-trip structuremodel-v1 -> {external_format} -> structuremodel-v1")


def validate_midas_text_converter():
    text = """
# minimal midas text
NODE,1,0,0,0
NODE,2,2,0,0
REST,1,1,1,1,1,1,1
REST,2,0,1,1,1,1,1
MAT,1,steel,200000,0.3,7850
SEC,1,S1,beam,0.01,0.0001,0.0001,0.00002,79000
ELEM,1,beam,1,2,1,1
LOADCASE,LC1,other
NLOAD,LC1,2,10,0,0,0,0,0
COMBO,ULS,LC1=1.0
""".strip()

    exported = convert_structure_model_payload(
        model_payload={"text": text},
        target_schema_version="1.0.0",
        source_format="midas-text-1",
        target_format="structuremodel-v1",
        supported_formats=supported_formats(),
        get_converter=get_converter,
    )
    model = exported["model"]
    assert model["schema_version"] == "1.0.0"
    assert len(model["nodes"]) == 2
    assert len(model["elements"]) == 1

    reexport = convert_structure_model_payload(
        model_payload=model,
        target_schema_version="1.0.0",
        source_format="structuremodel-v1",
        target_format="midas-text-1",
        supported_formats=supported_formats(),
        get_converter=get_converter,
    )
    text2 = reexport["model"].get("text", "")
    assert "NODE,1,0.0,0.0,0.0" in text2
    assert "ELEM,1,beam,1,2,1,1" in text2
    print("[ok] midas-text convert import/export")

    try:
        convert_structure_model_payload(
            model_payload={"text": "NODE,1,a,0,0"},
            target_schema_version="1.0.0",
            source_format="midas-text-1",
            target_format="structuremodel-v1",
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )
        raise SystemExit("Expected HTTPException for invalid number")
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert exc.status_code == 422
        assert detail.get("errorCode") == "INVALID_STRUCTURE_MODEL"
        assert "line 1" in (detail.get("message") or "")
        assert "NODE.x" in (detail.get("message") or "")
        print("[ok] midas-text field-level error message")


def validate_converter_api_contract():
    expected_formats = {"structuremodel-v1", "simple-1", "compact-1", "midas-text-1"}
    schema = {
        "supportedFormats": supported_formats(),
        "defaultSourceFormat": "structuremodel-v1",
        "defaultTargetFormat": "structuremodel-v1",
    }
    supported = set(schema.get("supportedFormats", []))
    missing = expected_formats - supported
    if missing:
        raise AssertionError(f"/schema/converters missing formats: {sorted(missing)}")
    assert schema.get("defaultSourceFormat") == "structuremodel-v1"
    assert schema.get("defaultTargetFormat") == "structuremodel-v1"
    print("[ok] converter schema contract")

    try:
        convert_structure_model_payload(
            model_payload={},
            target_schema_version="1.0.0",
            source_format="unsupported-format",
            target_format="structuremodel-v1",
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )
        raise AssertionError("unsupported source format should fail")
    except HTTPException as exc:
        assert exc.status_code == 400
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert detail.get("errorCode") == "UNSUPPORTED_SOURCE_FORMAT"
        assert "supportedFormats" in detail
    print("[ok] convert unsupported source format contract")

    try:
        convert_structure_model_payload(
            model_payload={},
            target_schema_version="1.0.0",
            source_format="structuremodel-v1",
            target_format="unsupported-format",
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )
        raise AssertionError("unsupported target format should fail")
    except HTTPException as exc:
        assert exc.status_code == 400
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert detail.get("errorCode") == "UNSUPPORTED_TARGET_FORMAT"
        assert "supportedFormats" in detail
    print("[ok] convert unsupported target format contract")

    invalid_midas = {
        "text": "\n".join(
            [
                "NODE,1,0,0,0",
                "NODE,2,1,0,0",
                "MAT,1,STEEL,200000,0.3,7850,345",
                "SEC,1,S1,beam,INVALID_A",
                "ELM,1,beam,1,2,1,1",
            ]
        )
    }
    try:
        convert_structure_model_payload(
            model_payload=invalid_midas,
            target_schema_version="1.0.0",
            source_format="midas-text-1",
            target_format="structuremodel-v1",
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )
        raise AssertionError("invalid midas field should fail")
    except HTTPException as exc:
        assert exc.status_code == 422
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert detail.get("errorCode") == "INVALID_STRUCTURE_MODEL"
        message = detail.get("message", "")
        assert isinstance(message, str) and "line" in message and "A" in message
    print("[ok] convert field-level parse error contract")


def validate_schema_migration():
    sample_file = ROOT_DIR / "backend/src/skill-shared/python/structure_protocol/examples/model_01_single_beam.json"
    source = json.loads(sample_file.read_text(encoding="utf-8"))

    migrated = convert_structure_model_payload(
        model_payload=source,
        target_schema_version="1.0.1",
        source_format="structuremodel-v1",
        target_format="structuremodel-v1",
        supported_formats=supported_formats(),
        get_converter=get_converter,
    )
    model = migrated["model"]
    assert model["schema_version"] == "1.0.1"
    assert "schema_migration" in model.get("metadata", {})
    assert model["metadata"]["schema_migration"]["from"] == "1.0.0"
    assert model["metadata"]["schema_migration"]["to"] == "1.0.1"
    print("[ok] schema migration 1.0.0 -> 1.0.1")

    try:
        convert_structure_model_payload(
            model_payload=source,
            target_schema_version="2.0.0",
            source_format="structuremodel-v1",
            target_format="structuremodel-v1",
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )
        raise AssertionError("unsupported schema should fail")
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert detail.get("errorCode") == "UNSUPPORTED_TARGET_SCHEMA"
    print("[ok] unsupported target schema rejected")


def validate_convert_batch():
    with tempfile.TemporaryDirectory(prefix="structureclaw-batch-") as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        input_dir = temp_dir / "input"
        output_dir = temp_dir / "output"
        input_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)

        shutil.copyfile(
            ROOT_DIR / "backend/src/skill-shared/python/structure_protocol/examples/model_03_simple_truss.json",
            input_dir / "valid.json",
        )
        (input_dir / "invalid.json").write_text(
            json.dumps(
                {
                    "schema_version": "1.0.0",
                    "nodes": [{"id": "1", "x": 0, "y": 0, "z": 0}],
                    "elements": [{"id": "1", "type": "beam", "nodes": ["1", "2"], "material": "1", "section": "1"}],
                    "materials": [],
                    "sections": [],
                    "load_cases": [],
                    "load_combinations": [],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        report_file = temp_dir / "report.json"
        subprocess.run(
            [
                "node",
                str(ROOT_DIR / "sclaw"),
                "convert-batch",
                "--input-dir",
                str(input_dir),
                "--output-dir",
                str(output_dir),
                "--report",
                str(report_file),
                "--source-format",
                "structuremodel-v1",
                "--target-format",
                "compact-1",
                "--allow-failures",
            ],
            check=True,
            cwd=str(ROOT_DIR),
        )

        report = json.loads(report_file.read_text(encoding="utf-8"))
        valid_output = output_dir / "valid.json"
        assert report["summary"]["total"] == 2
        assert report["summary"]["success"] == 1
        assert report["summary"]["failed"] == 1
        assert valid_output.exists()
        failed_items = [item for item in report["items"] if item["status"] == "failed"]
        assert len(failed_items) == 1
        assert failed_items[0]["errorCode"] in {"INVALID_STRUCTURE_MODEL", "HTTP_422"}
        failure_dist = report["summary"].get("failureByErrorCode") or {}
        assert isinstance(failure_dist, dict)
        assert failure_dist.get(failed_items[0]["errorCode"]) == 1
        print("[ok] convert batch report with mixed success/failure")


def validate_convert_passrate():
    formats = ("simple-1", "compact-1", "midas-text-1")
    samples = sorted((ROOT_DIR / "backend/src/skill-shared/python/structure_protocol/examples").glob("model_*.json"))
    threshold = 0.95
    total = 0
    passed = 0
    failed = []

    for sample in samples:
        source = json.loads(sample.read_text(encoding="utf-8"))
        for external_format in formats:
            total += 1
            exported = convert_structure_model_payload(
                model_payload=source,
                target_schema_version="1.0.0",
                source_format="structuremodel-v1",
                target_format=external_format,
                supported_formats=supported_formats(),
                get_converter=get_converter,
            )
            imported = convert_structure_model_payload(
                model_payload=exported["model"],
                target_schema_version="1.0.0",
                source_format=external_format,
                target_format="structuremodel-v1",
                supported_formats=supported_formats(),
                get_converter=get_converter,
            )
            round_trip = imported["model"]
            ok = (
                len(source.get("nodes", [])) == len(round_trip.get("nodes", []))
                and len(source.get("elements", [])) == len(round_trip.get("elements", []))
                and {node["id"] for node in source.get("nodes", [])} == {node["id"] for node in round_trip.get("nodes", [])}
                and {element["id"] for element in source.get("elements", [])} == {element["id"] for element in round_trip.get("elements", [])}
            )
            if ok:
                passed += 1
            else:
                failed.append(f"{sample.name}::{external_format}")

    pass_rate = passed / total if total else 0.0
    print(f"[pass-rate] passed={passed} total={total} rate={pass_rate:.3f}")
    if failed:
        print("[failed]")
        for item in failed:
            print(f" - {item}")
    assert pass_rate >= threshold, f"round-trip pass rate {pass_rate:.3f} < {threshold:.2f}"
    print("[ok] convert round-trip pass rate meets threshold")


COMMANDS = {
    "validate-opensees-runtime-and-routing": validate_opensees_runtime_and_routing,
    "validate-analyze-contract": validate_analyze_contract,
    "validate-code-check-traceability": validate_code_check_traceability,
    "validate-static-regression": validate_static_regression,
    "validate-static-3d-regression": validate_static_3d_regression,
    "validate-structure-examples": validate_structure_examples,
    "validate-convert-roundtrip": validate_convert_roundtrip,
    "validate-midas-text-converter": validate_midas_text_converter,
    "validate-converter-api-contract": validate_converter_api_contract,
    "validate-schema-migration": validate_schema_migration,
    "validate-convert-batch": validate_convert_batch,
    "validate-convert-passrate": validate_convert_passrate,
}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        available = ", ".join(sorted(COMMANDS.keys()))
        raise SystemExit(f"Usage: analysis-runner.py <command>\nAvailable: {available}")
    COMMANDS[sys.argv[1]]()


if __name__ == "__main__":
    main()
