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
from structure_protocol.structure_model_v2 import (
    ElementV2 as Element,
    MaterialV2 as Material,
    NodeV2 as Node,
    SectionV2 as Section,
    StructureModelV2,
)
from structure_protocol.structure_model_v1 import StructureModelV1


ROOT_DIR = Path(__file__).resolve().parents[2]


def assert_true(condition, message):
    if not condition:
        raise SystemExit(message)


def validate_opensees_runtime_and_routing():

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
            {"id": "1", "x": 0.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, False, False]},
            {"id": "2", "x": 3.0, "y": 0.0, "z": 0.0},
            {"id": "3", "x": 6.0, "y": 0.0, "z": 0.0, "restraints": [False, True, True, True, False, False]},
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
    model = StructureModelV2.model_validate(simply_supported)

    if issue is None:
        print("[ok] OpenSees runtime smoke test")

        cantilever_result = run_request(cantilever)
        assert_true(cantilever_result["success"] is True, f"Cantilever OpenSees analysis failed: {cantilever_result['message']}")
        assert_true(cantilever_result["data"]["analysisMode"] == "opensees_2d_frame", f"Unexpected cantilever analysisMode: {cantilever_result['data']['analysisMode']}")
        # 1D beam models now use xz plane to align with restraint format interpretation (Issue #83 fix)
        assert_true(cantilever_result["data"].get("plane") == "xz", f"Unexpected cantilever plane: {cantilever_result['data'].get('plane')}")
        # In xz plane, transverse displacement is uz (fy loads map to fz)
        tip_uz = float(cantilever_result["data"]["displacements"]["3"]["uz"])
        assert_true(math.isfinite(tip_uz) and tip_uz < 0.0, f"Cantilever tip displacement invalid: {tip_uz}")
        assert_true("1" in cantilever_result["data"]["reactions"], "Cantilever reactions missing at fixed support")
        print("[ok] cantilever beam solves with builtin-opensees")

        simply_supported_result = run_request(simply_supported)
        assert_true(simply_supported_result["success"] is True, f"Simply-supported OpenSees analysis failed: {simply_supported_result['message']}")
        assert_true(simply_supported_result["data"]["analysisMode"] == "opensees_2d_frame", f"Unexpected simply-supported analysisMode: {simply_supported_result['data']['analysisMode']}")
        # 1D beam models now use xz plane to align with restraint format interpretation (Issue #83 fix)
        assert_true(simply_supported_result["data"].get("plane") == "xz", f"Unexpected simply-supported plane: {simply_supported_result['data'].get('plane')}")
        # In xz plane, transverse displacement is uz (fy loads map to fz)
        midspan_uz = float(simply_supported_result["data"]["displacements"]["2"]["uz"])
        assert_true(math.isfinite(midspan_uz) and midspan_uz < 0.0, f"Simply-supported midspan displacement invalid: {midspan_uz}")
        print("[ok] simply-supported beam solves with builtin-opensees")

        portal_result = run_request(portal_frame)
        assert_true(portal_result["success"] is True, f"Portal-frame OpenSees analysis failed: {portal_result['message']}")
        assert_true(portal_result["data"]["analysisMode"] == "opensees_2d_frame", f"Unexpected portal-frame analysisMode: {portal_result['data']['analysisMode']}")
        roof_uy = float(portal_result["data"]["displacements"]["3"]["uy"])
        assert_true(math.isfinite(roof_uy) and roof_uy < 0.0, f"Portal-frame roof displacement invalid: {roof_uy}")
        print("[ok] portal frame solves with builtin-opensees")
    else:
        # Verify unavailable engine surfaces clearly
        engines = registry.list_engines()
        opensees = next((e for e in engines if e["id"] == "builtin-opensees"), None)
        assert_true(opensees is not None, "builtin-opensees missing from engine list")
        assert_true(opensees["available"] is False, f"Expected available=False, got {opensees['available']}")
        assert_true(opensees.get("unavailableReason"), "Expected non-empty unavailableReason")
        print(f"[ok] list_engines marks builtin-opensees unavailable: {opensees['unavailableReason']}")

        # Verify explicit engineId request fails with ENGINE_UNAVAILABLE
        try:
            run_request(cantilever, engine_id="builtin-opensees")
            raise SystemExit("Expected HTTPException for unavailable engine")
        except HTTPException as exc:
            assert_true(exc.status_code == 422, f"Expected HTTP 422, got {exc.status_code}")
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            assert_true(detail.get("errorCode") == "ENGINE_UNAVAILABLE", f"Expected ENGINE_UNAVAILABLE, got {detail.get('errorCode')}")
        print("[ok] explicit engineId=builtin-opensees raises ENGINE_UNAVAILABLE")


def validate_analyze_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        # Verify unavailable engine contract even without OpenSees runtime
        registry = AnalysisEngineRegistry("StructureClaw Analysis Engine", "0.1.0")
        engines = registry.list_engines()
        opensees = next((e for e in engines if e["id"] == "builtin-opensees"), None)
        assert_true(opensees is not None, "builtin-opensees missing from engine list")
        assert_true(opensees["available"] is False, f"Expected available=False, got {opensees['available']}")
        assert_true(opensees.get("unavailableReason"), "Expected non-empty unavailableReason")

        model = StructureModelV2(
            schema_version="2.0.0",
            nodes=[Node(id="1", x=0, y=0, z=0, restraints=[True, True, True, True, True, True])],
            elements=[],
            materials=[],
            sections=[],
        )
        request = AnalysisRequest(type="static", model=model, parameters={}, engineId="builtin-opensees")
        try:
            asyncio.run(analyze(request))
            raise SystemExit("Expected HTTPException for unavailable engine")
        except HTTPException as exc:
            assert_true(exc.status_code == 422, f"Expected HTTP 422, got {exc.status_code}")
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            assert_true(detail.get("errorCode") == "ENGINE_UNAVAILABLE", f"Expected ENGINE_UNAVAILABLE, got {detail.get('errorCode')}")
        print("[ok] analyze contract: explicit builtin-opensees raises ENGINE_UNAVAILABLE when unavailable")
        return
    model = StructureModelV2(
        schema_version="2.0.0",
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
    if ok_result["schema_version"] != "2.0.0":
        raise SystemExit(f"Expected schema_version=2.0.0, got {ok_result['schema_version']}")
    required_meta = {"engineId", "engineName", "engineVersion", "engineKind", "selectionMode", "timestamp"}
    missing_meta = required_meta - set(ok_result["meta"].keys())
    if missing_meta:
        raise SystemExit(f"meta fields required: {sorted(missing_meta)}")
    print("[ok] analyze success envelope contract")

    frame_3d_model = StructureModelV2(
        schema_version="2.0.0",
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
        engineId="builtin-opensees",
    )
    frame_3d_result = asyncio.run(analyze(frame_3d_request)).model_dump()
    if frame_3d_result["success"] is not True:
        raise SystemExit("Expected success=true for 3D frame request")
    if frame_3d_result.get("data", {}).get("analysisMode") != "opensees_3d_frame":
        raise SystemExit(f"Expected analysisMode=opensees_3d_frame, got {frame_3d_result.get('data', {}).get('analysisMode')}")
    print("[ok] analyze 3d frame envelope contract")

    simplified_planar_beam_model = StructureModelV2(
        schema_version="2.0.0",
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
        engineId="builtin-opensees",
    )
    simplified_planar_result = asyncio.run(analyze(simplified_planar_request)).model_dump()
    if simplified_planar_result["success"] is not True:
        raise SystemExit("Expected success=true for simplified planar beam request")
    simplified_data = simplified_planar_result.get("data", {})
    if simplified_data.get("analysisMode") != "opensees_2d_frame":
        raise SystemExit(f"Expected simplified planar beam analysisMode=opensees_2d_frame, got {simplified_data.get('analysisMode')}")
    # 1D beam models now use xz plane to align with restraint format interpretation (Issue #83 fix)
    if simplified_data.get("plane") != "xz":
        raise SystemExit(f"Expected simplified planar beam plane=xz, got {simplified_data.get('plane')}")
    tip_disp = simplified_data.get("displacements", {}).get("3", {})
    # In xz plane, transverse displacement is uz (fy loads map to fz)
    if abs(float(tip_disp.get("uz", 0.0))) <= 0.0:
        raise SystemExit(f"Expected non-zero simplified planar beam uz displacement, got {tip_disp}")
    if abs(float(tip_disp.get("uy", 0.0))) > 1e-9:
        raise SystemExit(f"Expected near-zero simplified planar beam uy displacement, got {tip_disp}")
    print("[ok] analyze simplified planar beam routes to 2d xz frame")

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


def _seismic_frame_payload():
    return {
        "schema_version": "2.0.0",
        "unit_system": "SI",
        "site_seismic": {
            "intensity": 8,
            "design_group": "2",
            "site_category": "III",
            "max_influence_coefficient": 0.16,
            "extra": {"acceleration_g": 0.20},
        },
        "stories": [
            {
                "id": "F1",
                "height": 3.6,
                "elevation": 0.0,
                "floor_loads": [{"type": "dead", "value": 5.0}, {"type": "live", "value": 2.0}],
            },
            {
                "id": "F2",
                "height": 3.6,
                "elevation": 3.6,
                "floor_loads": [{"type": "dead", "value": 5.0}, {"type": "live", "value": 2.0}],
            },
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
            {
                "id": "1",
                "name": "500X500",
                "type": "rectangular",
                "properties": {"A": 0.25, "Iy": 0.005, "Iz": 0.005, "J": 0.01, "G": 12500.0},
            }
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
    }


def _seismic_wall_line_payload():
    return {
        "schema_version": "2.0.0",
        "unit_system": "SI",
        "site_seismic": {
            "intensity": 8,
            "design_group": "2",
            "site_category": "III",
            "max_influence_coefficient": 0.16,
            "extra": {"acceleration_g": 0.20},
        },
        "stories": [
            {
                "id": "F1",
                "height": 3.6,
                "elevation": 0.0,
                "floor_loads": [{"type": "dead", "value": 5.0}, {"type": "live", "value": 2.0}],
            },
            {
                "id": "F2",
                "height": 3.6,
                "elevation": 3.6,
                "floor_loads": [{"type": "dead", "value": 5.0}, {"type": "live", "value": 2.0}],
            },
        ],
        "nodes": [
            {"id": "B1", "x": 0.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "B2", "x": 6.0, "y": 0.0, "z": 0.0, "restraints": [True, True, True, True, True, True]},
            {"id": "T1", "x": 0.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "T2", "x": 6.0, "y": 0.0, "z": 3.6, "story": "F1"},
            {"id": "U1", "x": 0.0, "y": 0.0, "z": 7.2, "story": "F2"},
            {"id": "U2", "x": 6.0, "y": 0.0, "z": 7.2, "story": "F2"},
        ],
        "materials": [{"id": "1", "name": "C40", "E": 32500.0, "nu": 0.2, "rho": 2500.0, "category": "concrete"}],
        "sections": [
            {
                "id": "W1",
                "name": "SW200X3000",
                "type": "rectangular",
                "purpose": "wall",
                "thickness": 200.0,
                "properties": {"wallLength": 3.0, "G": 13500.0},
            },
            {
                "id": "F1",
                "name": "500X500",
                "type": "rectangular",
                "properties": {"A": 0.25, "Iy": 0.005, "Iz": 0.005, "J": 0.01, "G": 12500.0},
            },
        ],
        "elements": [
            {"id": "W1", "type": "wall", "nodes": ["B1", "T1"], "material": "1", "section": "W1"},
            {"id": "W2", "type": "wall", "nodes": ["T1", "U1"], "material": "1", "section": "W1"},
            {"id": "C2", "type": "column", "nodes": ["B2", "T2"], "material": "1", "section": "F1"},
            {"id": "C4", "type": "column", "nodes": ["T2", "U2"], "material": "1", "section": "F1"},
            {"id": "B1", "type": "beam", "nodes": ["T1", "T2"], "material": "1", "section": "F1"},
            {"id": "B2", "type": "beam", "nodes": ["U1", "U2"], "material": "1", "section": "F1"},
        ],
        "metadata": {"structuralTypeKey": "concrete-frame-shear-wall", "storyCount": 2},
    }


def _seismic_space_frame_payload():
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

    return {
        "schema_version": "2.0.0",
        "unit_system": "SI",
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
    }


def _run_seismic_request(parameters, model=None):
    request = AnalysisRequest.model_validate(
        {
            "type": "seismic",
            "model": model or _seismic_frame_payload(),
            "parameters": parameters,
            "engineId": "builtin-opensees",
        }
    )
    return asyncio.run(analyze(request)).model_dump(mode="json")


def validate_seismic_analyze_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic analyze contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "response_spectrum",
            "responseSpectrum": {"modalCombination": "srss"},
            "overLimitReview": {
                "reviewRequired": True,
                "status": "approved",
                "approvalId": "SZ-REVIEW-2026-001",
            },
            "designBasis": {
                "codes": ["GB 55002-2021", "GB/T 50011-2010-2024"],
                "siteSeismic": {"intensity": 8, "designGroup": "2", "siteCategory": "III"},
            },
        }
    })
    assert_true(result["success"] is True, f"Seismic response-spectrum request failed: {result['message']}")
    data = result.get("data", {})
    assert_true(data.get("analysisMode") == "opensees_china_seismic_workflow", f"Unexpected seismic mode: {data.get('analysisMode')}")
    assert_true(data.get("status") in {"success", "partial"}, f"Unexpected seismic status: {data.get('status')}")
    summary = data.get("summary", {})
    model_summary = data.get("modelSummary", {})
    assert_true(summary.get("nodeCount") == 6, f"Unexpected seismic node count summary: {summary}")
    assert_true(summary.get("elementCount") == 6, f"Unexpected seismic element count summary: {summary}")
    assert_true(summary.get("storyCount") == 2, f"Unexpected seismic story count summary: {summary}")
    assert_true(model_summary.get("nodeCount") == 6 and model_summary.get("elementCount") == 6, f"Missing seismic model summary: {model_summary}")
    envelope = data.get("envelope", {})
    assert_true(math.isfinite(float(envelope.get("maxBaseShear", 0.0))) and float(envelope.get("maxBaseShear", 0.0)) > 0.0, "Missing positive seismic maxBaseShear")
    assert_true("designBasis" in data and "methodDecision" in data, "Seismic result missing designBasis/methodDecision")
    over_limit_review = data.get("overLimitReview", {})
    detailed_review = data.get("detailed", {}).get("overLimitReview", {})
    assert_true(over_limit_review.get("approvalId") == "SZ-REVIEW-2026-001", f"Missing structured over-limit review trace: {over_limit_review}")
    assert_true(detailed_review.get("reviewRequired") is True, f"Missing detailed structured over-limit review trace: {detailed_review}")
    codes = [item.get("code") for item in data["designBasis"].get("codeBasis", [])]
    assert_true("GB 55002-2021" in codes, f"Missing GB 55002-2021 in codeBasis: {codes}")
    assert_true("GB/T 50011-2010" in codes, f"Missing GB/T 50011-2010 in codeBasis: {codes}")
    gb18306_basis = next((item for item in data["designBasis"].get("codeBasis", []) if item.get("code") == "GB 18306-2015"), {})
    assert_true(gb18306_basis.get("standardStatus") == "current", f"Missing GB18306 current status: {gb18306_basis}")
    assert_true(gb18306_basis.get("lastReviewConclusion") == "continue_valid", f"Missing GB18306 review conclusion: {gb18306_basis}")
    amendment = next((item for item in gb18306_basis.get("amendments", []) if item.get("status") == "effective"), {})
    assert_true(amendment.get("no") == "No.1", f"Missing GB18306 No.1 amendment trace: {gb18306_basis}")
    assert_true(amendment.get("effectiveDate") == "2026-02-27", f"Unexpected GB18306 amendment date: {gb18306_basis}")
    revision_plan = gb18306_basis.get("revisionPlan", {})
    assert_true(revision_plan.get("planNo") == "20260055-Q-419", f"Missing GB18306 revision plan trace: {gb18306_basis}")
    assert_true(revision_plan.get("status") == "drafting", f"Unexpected GB18306 revision plan status: {gb18306_basis}")
    assert_true(data["methodDecision"].get("selectedMethods") == ["response_spectrum"], f"Unexpected methods: {data['methodDecision'].get('selectedMethods')}")
    response = data.get("responseSpectrum", {})
    assert_true(response.get("modalCombination") == "srss", f"Unexpected modal combination: {response}")
    assert_true(envelope.get("modalCombination") == "srss", f"Envelope missing modal combination: {envelope}")
    minimum_shear_adjustment = response.get("minimumStoryShearAdjustment", {})
    assert_true(
        minimum_shear_adjustment.get("status") in {"adjusted", "not_required"},
        f"Missing minimum story shear adjustment trace: {minimum_shear_adjustment}",
    )
    response_final = data.get("responseSpectrumFinalCompliance", {})
    assert_true(response_final.get("status") in {"pass", "fail"}, f"Missing response-spectrum final compliance: {response_final}")
    assert_true(response_final.get("clause") == "GB/T 50011-2010(2024) 5.5.1", f"Unexpected drift clause: {response_final}")
    assert_true(response.get("finalCompliance", {}).get("status") == response_final.get("status"), f"Response spectrum missing final compliance mirror: {response}")
    elastic_final = data.get("elasticStoryDriftFinalCompliance", {})
    assert_true(elastic_final.get("status") in {"pass", "fail"}, f"Missing elastic envelope drift final compliance: {elastic_final}")
    assert_true(elastic_final.get("source") == "envelope.maxStoryDriftRatio", f"Unexpected elastic envelope drift source: {elastic_final}")
    assert_true(elastic_final.get("driftRatio") == envelope.get("maxStoryDriftRatio"), f"Elastic final compliance did not use the combined envelope drift: {elastic_final}, {envelope}")
    design_actions = data.get("seismicDesignActions", {})
    assert_true(design_actions.get("status") == "computed", f"Missing horizontal seismic design actions: {design_actions}")
    assert_true(int(design_actions.get("memberForceCount", 0) or 0) > 0, f"Missing horizontal member forces: {design_actions}")
    assert_true(
        design_actions.get("minimumStoryShearAdjustment", {}).get("status") in {"adjusted", "not_required"},
        f"Missing design-action minimum shear adjustment trace: {design_actions}",
    )
    assert_true("seismicEquivalentLateralMemberForces" in data.get("capabilityAssessment", {}).get("implementedCapabilities", []), f"Missing horizontal member-force capability: {data.get('capabilityAssessment')}")
    gravity_actions = data.get("gravityDesignActions", {})
    combinations = data.get("memberDesignActionCombinations", {})
    assert_true(gravity_actions.get("status") == "computed", f"Missing gravity design actions: {gravity_actions}")
    assert_true(int(gravity_actions.get("memberForceCount", 0) or 0) > 0, f"Missing gravity member forces: {gravity_actions}")
    assert_true(combinations.get("status") == "computed", f"Missing member design action combinations: {combinations}")
    assert_true(combinations.get("caseCount", 0) >= 1, f"Missing design combination cases: {combinations}")
    assert_true("gb50011.seismicBasicActionCombination" in data.get("capabilityAssessment", {}).get("implementedCapabilities", []), f"Missing basic action combination capability: {data.get('capabilityAssessment')}")
    assert_true("gb50011.frequentEarthquakeElasticDriftFinalCompliance" in data.get("capabilityAssessment", {}).get("implementedCapabilities", []), f"Missing response-spectrum drift final-compliance capability: {data.get('capabilityAssessment')}")
    print("[ok] seismic response-spectrum analyze contract")


def validate_seismic_wall_line_member_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic wall line-member contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "response_spectrum",
            "responseSpectrum": {"modalCombination": "srss"},
            "designBasis": {
                "codes": ["GB 55002-2021", "GB/T 50011-2010-2024"],
                "siteSeismic": {"intensity": 8, "designGroup": "2", "siteCategory": "III"},
            },
        }
    }, model=_seismic_wall_line_payload())
    assert_true(result["success"] is True, f"Seismic wall line-member request failed: {result['message']}")
    data = result.get("data", {})
    summary = data.get("summary", {})
    assert_true(summary.get("elementCount") == 6, f"Unexpected seismic wall model summary: {summary}")

    design_actions = data.get("seismicDesignActions", {})
    gravity_actions = data.get("gravityDesignActions", {})
    combinations = data.get("memberDesignActionCombinations", {})
    assert_true(design_actions.get("status") == "computed", f"Missing wall horizontal design actions: {design_actions}")
    assert_true(gravity_actions.get("status") == "computed", f"Missing wall gravity design actions: {gravity_actions}")
    assert_true("W1" in design_actions.get("memberForces", {}), f"Wall W1 missing from horizontal member forces: {design_actions}")
    assert_true("W1" in gravity_actions.get("memberForces", {}), f"Wall W1 missing from gravity member forces: {gravity_actions}")

    combination_member_ids = {
        action.get("elementId")
        for case in combinations.get("cases", [])
        for action in case.get("memberActions", [])
        if isinstance(action, dict)
    }
    assert_true("W1" in combination_member_ids, f"Wall W1 missing from seismic design combinations: {combinations}")
    print("[ok] seismic wall line-member response-spectrum contract")


def validate_seismic_multi_direction_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic multi-direction contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "response_spectrum",
            "directions": ["x", "y"],
            "designBasis": {"dampingRatio": 0.05},
            "designRequirements": {"fortificationCategory": "standard"},
        }
    }, model=_seismic_space_frame_payload())
    assert_true(result["success"] is True, f"Seismic multi-direction request failed: {result['message']}")
    data = result.get("data", {})
    summary = data.get("summary", {})
    direction_results = data.get("directionResults", [])
    assert_true(summary.get("directionCount") == 2, f"Unexpected direction summary: {summary}")
    assert_true(summary.get("directions") == ["x", "y"], f"Unexpected directions: {summary.get('directions')}")
    assert_true([item.get("direction") for item in direction_results] == ["x", "y"], f"Unexpected direction results: {direction_results}")
    assert_true(all(item.get("responseSpectrum", {}).get("modalCombination") == "cqc" for item in direction_results), f"Expected default CQC per direction: {direction_results}")
    assert_true(all(item.get("seismicDesignActions", {}).get("status") == "computed" for item in direction_results), f"Missing per-direction design actions: {direction_results}")
    combinations = data.get("memberDesignActionCombinations", {})
    case_names = [case.get("name") for case in combinations.get("cases", [])]
    assert_true(combinations.get("horizontalDirections") == ["x", "y"], f"Missing XY combination directions: {combinations}")
    assert_true("gravity_plus_x_horizontal_seismic" in case_names, f"Missing X horizontal combination: {case_names}")
    assert_true("gravity_plus_y_horizontal_seismic" in case_names, f"Missing Y horizontal combination: {case_names}")
    assert_true("gravity_plus_x_horizontal_with_y" in case_names, f"Missing X+Y companion combination: {case_names}")
    assert_true("gravity_plus_y_horizontal_with_x" in case_names, f"Missing Y+X companion combination: {case_names}")
    assert_true(data.get("modal", {}).get("direction") in {"x", "y"}, f"Missing controlling modal direction: {data.get('modal')}")
    envelope = data.get("envelope", {})
    assert_true(envelope.get("controlCase", {}).get("direction") in {"x", "y"}, f"Missing controlling direction: {envelope}")
    assert_true(math.isfinite(float(envelope.get("maxBaseShear", 0.0))) and float(envelope.get("maxBaseShear", 0.0)) > 0.0, f"Missing positive multi-direction base shear: {envelope}")
    print("[ok] seismic multi-direction response-spectrum contract")


def validate_seismic_directional_ground_motion_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic directional ground-motion contract skipped; builtin-opensees unavailable: {issue}")
        return

    wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
    result = _run_seismic_request({
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
    }, model=_seismic_space_frame_payload())
    assert_true(result["success"] is True, f"Seismic directional ground-motion request failed: {result['message']}")
    data = result.get("data", {})
    by_direction = {item.get("direction"): item for item in data.get("directionResults", [])}
    x_records = by_direction.get("x", {}).get("timeHistory", {}).get("records", [])
    y_records = by_direction.get("y", {}).get("timeHistory", {}).get("records", [])
    assert_true([record.get("direction") for record in x_records] == ["x", "x", "x"], f"Unexpected X records: {x_records}")
    assert_true([record.get("direction") for record in y_records] == ["y", "y", "y"], f"Unexpected Y records: {y_records}")
    requirement = data.get("groundMotionRequirement", {})
    assert_true(requirement.get("missingCount") == 0, f"Unexpected ground-motion requirement: {requirement}")
    assert_true(requirement.get("totalRequiredCount") == 6, f"Unexpected total required count: {requirement}")
    assert_true(requirement.get("providedCount") == 6, f"Unexpected provided count: {requirement}")

    missing_y_result = _run_seismic_request({
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
    }, model=_seismic_space_frame_payload())
    assert_true(missing_y_result["success"] is True, f"Seismic missing-direction request failed: {missing_y_result['message']}")
    missing_y_data = missing_y_result.get("data", {})
    missing_y_requirement = missing_y_data.get("groundMotionRequirement", {})
    by_direction_requirement = {
        item.get("direction"): item
        for item in missing_y_requirement.get("directionRequirements", [])
    }
    assert_true(missing_y_data.get("status") == "partial", f"Expected partial missing-direction result: {missing_y_data.get('status')}")
    assert_true("groundMotions" in missing_y_data.get("missingInputs", []), f"Missing groundMotions marker: {missing_y_data.get('missingInputs')}")
    assert_true(missing_y_requirement.get("totalRequiredCount") == 6, f"Unexpected missing-direction total: {missing_y_requirement}")
    assert_true(missing_y_requirement.get("providedCount") == 3, f"Unexpected missing-direction provided count: {missing_y_requirement}")
    assert_true(missing_y_requirement.get("missingCount") == 3, f"Unexpected missing-direction missing count: {missing_y_requirement}")
    assert_true(by_direction_requirement.get("x", {}).get("missingCount") == 0, f"Unexpected X requirement: {by_direction_requirement}")
    assert_true(by_direction_requirement.get("y", {}).get("missingCount") == 3, f"Unexpected Y requirement: {by_direction_requirement}")
    print("[ok] seismic directional ground-motion contract")


def validate_seismic_zonation_table_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic zonation table contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model.pop("site_seismic", None)
    model.setdefault("metadata", {})["fortificationCategory"] = "standard"
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "response_spectrum",
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
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic zonation-table request failed: {result['message']}")
    data = result.get("data", {})
    basis = data.get("designBasis", {})
    assert_true(basis.get("region") == "示例市", f"Missing zonation region: {basis}")
    assert_true(basis.get("intensity") == 8, f"Expected intensity derived from GB18306 acceleration: {basis}")
    assert_true(abs(float(basis.get("accelerationG", 0.0)) - 0.20) < 1e-9, f"Unexpected acceleration: {basis}")
    assert_true(basis.get("designGroup") == "2", f"Unexpected design group: {basis}")
    assert_true(basis.get("isPreliminary") is False, f"Zonation-table basis should be final: {basis}")
    zonation = basis.get("groundMotionZonation", {})
    assert_true(zonation.get("regionCode") == "EX-001", f"Unexpected zonation record: {zonation}")
    print("[ok] seismic GB18306 zonation-table contract")


def validate_seismic_intensity_only_preliminary_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic intensity-only preliminary contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model.pop("site_seismic", None)
    model.setdefault("metadata", {})["fortificationCategory"] = "standard"
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "response_spectrum",
            "designBasis": {
                "dampingRatio": 0.05,
                "siteSeismic": {
                    "intensity": 8,
                    "designGroup": "2",
                    "siteCategory": "III",
                },
            },
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic intensity-only request failed: {result['message']}")
    data = result.get("data", {})
    basis = data.get("designBasis", {})
    assert_true(data.get("status") == "partial", f"Expected preliminary partial result: {data.get('status')}")
    assert_true(basis.get("isPreliminary") is True, f"Intensity-only basis should be preliminary: {basis}")
    assert_true(abs(float(basis.get("alphaMax", 0.0)) - 0.24) < 1e-9, f"Expected conservative alphaMax for 8-degree intensity-only input: {basis}")
    assert_true("designBasis.siteSeismic.accelerationG" in basis.get("missingInputs", []), f"Missing acceleration input marker: {basis}")
    print("[ok] seismic intensity-only preliminary contract")


def validate_seismic_design_basic_acceleration_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic design-basic-acceleration contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model.pop("site_seismic", None)
    model.setdefault("metadata", {})["fortificationCategory"] = "standard"
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "response_spectrum",
            "designBasis": {
                "dampingRatio": 0.05,
                "designBasicAccelerationG": 0.30,
                "siteSeismic": {
                    "designGroup": "2",
                    "siteCategory": "III",
                },
            },
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic design-basic-acceleration request failed: {result['message']}")
    data = result.get("data", {})
    basis = data.get("designBasis", {})
    assert_true(basis.get("isPreliminary") is False, f"Design basic acceleration should avoid preliminary status: {basis}")
    assert_true("designBasis.siteSeismic.accelerationG" not in basis.get("missingInputs", []), f"Acceleration should not be missing: {basis}")
    assert_true(basis.get("intensity") == 8, f"Expected intensity from 0.30g acceleration: {basis}")
    assert_true(abs(float(basis.get("accelerationG", 0.0)) - 0.30) < 1e-9, f"Expected accelerationG from designBasicAccelerationG: {basis}")
    assert_true(abs(float(basis.get("alphaMax", 0.0)) - 0.24) < 1e-9, f"Expected alphaMax for 0.30g acceleration: {basis}")
    print("[ok] seismic design-basic-acceleration contract")


def validate_seismic_earthquake_level_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic earthquake-level contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model.pop("site_seismic", None)
    model.setdefault("metadata", {})["fortificationCategory"] = "standard"
    result = _run_seismic_request({
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
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic earthquake-level request failed: {result['message']}")
    data = result.get("data", {})
    basis = data.get("designBasis", {})
    summary = data.get("summary", {})
    response = data.get("responseSpectrum", {})
    assert_true(data.get("status") == "partial", f"Expected rare-earthquake elastic run to be partial: {data.get('status')}")
    assert_true(basis.get("earthquakeLevel") == "rare", f"Missing rare earthquake level in basis: {basis}")
    assert_true(summary.get("earthquakeLevel") == "rare", f"Missing rare earthquake level in summary: {summary}")
    assert_true(response.get("earthquakeLevel") == "rare", f"Missing rare earthquake level in response spectrum: {response}")
    assert_true(abs(float(basis.get("alphaMax", 0.0)) - 0.90) < 1e-9, f"Expected rare alphaMax for 0.20g: {basis}")
    assert_true(abs(float(basis.get("characteristicPeriod", 0.0)) - 0.60) < 1e-9, f"Expected rare Tg increase: {basis}")
    assert_true(
        "gb50011.rareEarthquakeElasticPlasticDeformation" in data.get("missingCapabilities", []),
        f"Missing rare-earthquake nonlinear capability boundary: {data.get('missingCapabilities')}",
    )
    print("[ok] seismic earthquake-level contract")


def validate_seismic_elastic_plastic_time_history_boundary_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic elastic-plastic time-history boundary contract skipped; builtin-opensees unavailable: {issue}")
        return

    wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
    result = _run_seismic_request({
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
        }
    })
    assert_true(result["success"] is True, f"Seismic elastic-plastic time-history request failed: {result['message']}")
    data = result.get("data", {})
    decision = data.get("methodDecision", {})
    nonlinear = data.get("elasticPlasticTimeHistory", {})

    assert_true(data.get("status") in {"success", "partial"}, f"Unexpected nonlinear result status: {data.get('status')}")
    assert_true(decision.get("requiresElasticPlasticTimeHistory") is True, f"Missing nonlinear method demand: {decision}")
    assert_true(decision.get("selectedMethods") == ["response_spectrum", "time_history"], f"Elastic fallback methods not executed: {decision}")
    assert_true(data.get("timeHistory") is not None, "Expected elastic time-history comparison to run")
    assert_true(nonlinear.get("required") is True, f"Missing nonlinear requirement object: {nonlinear}")
    assert_true(nonlinear.get("status") == "estimated", f"Unexpected nonlinear status: {nonlinear}")
    assert_true(nonlinear.get("engineMode") == "opensees_bilinear_story_shear_building_estimate", f"Unexpected nonlinear engine: {nonlinear}")
    assert_true(nonlinear.get("modelScope") == "bilinear_story_shear_building", f"Unexpected nonlinear model scope: {nonlinear}")
    assert_true(nonlinear.get("fallbackElasticTimeHistoryExecuted") is True, f"Missing fallback trace: {nonlinear}")
    assert_true(len(nonlinear.get("records", [])) == 3, f"Missing nonlinear estimate records: {nonlinear}")
    assert_true(len(nonlinear.get("records", [])[0].get("storyResponses", [])) >= 2, f"Missing nonlinear story response trace: {nonlinear}")
    assert_true(float(nonlinear.get("maxDriftRatio", -1.0) or -1.0) >= 0.0, f"Missing nonlinear drift estimate: {nonlinear}")
    assert_true("elasticPlasticTimeHistoryEstimate" in nonlinear.get("implementedCapabilities", []), f"Missing nonlinear estimate capability: {nonlinear}")
    assert_true("elasticPlasticStoryShearBuildingEstimate" in nonlinear.get("implementedCapabilities", []), f"Missing nonlinear story-shear capability: {nonlinear}")
    assert_true("gb50011.elasticPlasticTimeHistoryAnalysis" in nonlinear.get("implementedCapabilities", []), f"Missing nonlinear analysis capability: {nonlinear}")
    assert_true("nonlinearModelStructuredInputAudit" in nonlinear.get("implementedCapabilities", []), f"Missing nonlinear model audit capability: {nonlinear}")
    audit = nonlinear.get("nonlinearModelAudit", {})
    assert_true(audit.get("status") == "missing", f"Missing nonlinear model audit status: {nonlinear}")
    assert_true("gb50011.elasticPlasticTimeHistoryFullMemberAnalysis" in nonlinear.get("missingCapabilities", []), f"Missing full-member nonlinear capability trace: {nonlinear}")
    final_compliance = nonlinear.get("finalCompliance", {})
    assert_true(final_compliance.get("status") in {"pass", "fail"}, f"Missing nonlinear final compliance: {final_compliance}")
    assert_true(final_compliance.get("source") == "elasticPlasticTimeHistory.acceptanceCheck", f"Unexpected nonlinear final compliance source: {final_compliance}")
    assert_true("nonlinearModel.fullMemberConstitutiveModels" in nonlinear.get("missingInputs", []), f"Missing nonlinear model input trace: {nonlinear}")
    assert_true(
        "gb50011.elasticPlasticTimeHistoryAnalysis" not in data.get("missingCapabilities", []),
        f"Unexpected nonlinear capability boundary: {data.get('missingCapabilities')}",
    )
    assert_true(
        "gb50011.rareEarthquakeElasticPlasticDeformation" not in data.get("missingCapabilities", []),
        f"Unexpected rare-earthquake deformation boundary: {data.get('missingCapabilities')}",
    )
    assert_true(
        "gb50011.elasticPlasticTimeHistoryAnalysis" not in nonlinear.get("missingCapabilities", []),
        f"Unexpected nonlinear requirement capability trace: {nonlinear}",
    )
    assert_true(
        "gb50011.elasticPlasticTimeHistoryFullMemberAnalysis" in data.get("missingCapabilities", []),
        f"Missing full-member nonlinear top-level capability boundary: {data.get('missingCapabilities')}",
    )
    assert_true(
        "elasticPlasticTimeHistoryEstimate" in data.get("capabilityAssessment", {}).get("implementedCapabilities", []),
        f"Missing nonlinear estimate implemented capability: {data.get('capabilityAssessment')}",
    )
    assert_true(
        "elasticPlasticStoryShearBuildingEstimate" in data.get("capabilityAssessment", {}).get("implementedCapabilities", []),
        f"Missing nonlinear story-shear implemented capability: {data.get('capabilityAssessment')}",
    )
    assert_true(
        "gb50011.elasticPlasticTimeHistoryAnalysis" in data.get("capabilityAssessment", {}).get("implementedCapabilities", []),
        f"Missing nonlinear analysis implemented capability: {data.get('capabilityAssessment')}",
    )
    assert_true(
        "gb50011.rareEarthquakeElasticPlasticDeformation" in data.get("capabilityAssessment", {}).get("implementedCapabilities", []),
        f"Missing rare-earthquake deformation implemented capability: {data.get('capabilityAssessment')}",
    )
    print("[ok] seismic elastic-plastic time-history final-compliance contract")


def validate_seismic_elastic_plastic_member_hinge_time_history_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic elastic-plastic member-hinge time-history contract skipped; builtin-opensees unavailable: {issue}")
        return

    wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
    result = _run_seismic_request({
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
        }
    })
    assert_true(result["success"] is True, f"Seismic elastic-plastic member-hinge time-history request failed: {result['message']}")
    data = result.get("data", {})
    nonlinear = data.get("elasticPlasticTimeHistory", {})
    capability = data.get("capabilityAssessment", {})
    assert_true(nonlinear.get("status") == "estimated", f"Missing member-hinge time-history result: {nonlinear}")
    assert_true(nonlinear.get("engineMode") == "opensees_member_end_plastic_hinge_2d_time_history_estimate", f"Unexpected member-hinge time-history engine: {nonlinear}")
    assert_true(nonlinear.get("modelScope") == "member_end_rotational_plastic_hinges_2d", f"Unexpected member-hinge time-history scope: {nonlinear}")
    assert_true(nonlinear.get("parameters", {}).get("hingeCount") == 8, f"Unexpected hinge count: {nonlinear.get('parameters')}")
    assert_true(len(nonlinear.get("records", [])) == 3, f"Missing member-hinge time-history records: {nonlinear}")
    assert_true(len(nonlinear.get("records", [])[0].get("hingeResponses", [])) > 0, f"Missing hinge response trace: {nonlinear}")
    assert_true(nonlinear.get("controllingHinge", {}).get("elementId"), f"Missing controlling hinge: {nonlinear}")
    assert_true("elasticPlasticMemberPlasticHinge2dTimeHistory" in nonlinear.get("implementedCapabilities", []), f"Missing member-hinge implemented capability: {nonlinear}")
    assert_true("elasticPlasticMemberPlasticHinge2dTimeHistory" in capability.get("implementedCapabilities", []), f"Missing top-level member-hinge capability: {capability}")
    assert_true(nonlinear.get("missingInputs") == [], f"Unexpected member-hinge missing inputs: {nonlinear}")
    assert_true("gb50011.elasticPlasticTimeHistoryFullMemberAnalysis" in nonlinear.get("missingCapabilities", []), f"Expected full-member boundary: {nonlinear}")
    assert_true("member-end rotational plastic-hinge" in str(nonlinear.get("finalCompliance", {}).get("scope", "")), f"Missing member-hinge compliance scope: {nonlinear.get('finalCompliance')}")
    print("[ok] seismic elastic-plastic member-hinge time-history contract")


def validate_seismic_auto_performance_objective_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic auto performance-objective contract skipped; builtin-opensees unavailable: {issue}")
        return

    wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
    result = _run_seismic_request({
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
        }
    })
    assert_true(result["success"] is True, f"Seismic auto performance-objective request failed: {result['message']}")
    data = result.get("data", {})
    decision = data.get("methodDecision", {})
    nonlinear = data.get("elasticPlasticTimeHistory", {})
    assert_true(decision.get("selectedMethods") == ["response_spectrum", "time_history"], f"Unexpected auto method selection: {decision}")
    assert_true(decision.get("requiresElasticPlasticTimeHistory") is True, f"Missing auto nonlinear demand: {decision}")
    assert_true(any("performance objective" in str(reason) for reason in decision.get("reasons", [])), f"Missing performance objective reason: {decision}")
    assert_true(nonlinear.get("status") == "estimated", f"Missing auto nonlinear result: {nonlinear}")
    assert_true(nonlinear.get("finalCompliance", {}).get("performanceObjective", {}).get("name") == "collapse_prevention", f"Missing nonlinear performance objective trace: {nonlinear}")
    assert_true("gb50011.elasticPlasticTimeHistoryAnalysis" in data.get("capabilityAssessment", {}).get("implementedCapabilities", []), f"Missing auto nonlinear capability: {data.get('capabilityAssessment')}")
    print("[ok] seismic auto performance-objective contract")


def validate_seismic_auto_pushover_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic auto pushover contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
            "performanceObjective": {"name": "collapse_prevention", "acceptanceDriftRatio": 0.012},
            "pushover": {
                "targetDisplacement": 0.02,
            },
        }
    })
    assert_true(result["success"] is True, f"Seismic auto pushover request failed: {result['message']}")
    data = result.get("data", {})
    decision = data.get("methodDecision", {})
    pushover = data.get("pushover", {})
    capability = data.get("capabilityAssessment", {})
    assert_true(decision.get("selectedMethods") == ["response_spectrum", "pushover"], f"Unexpected auto pushover method selection: {decision}")
    assert_true(decision.get("requiresPushover") is True, f"Missing auto pushover requirement: {decision}")
    assert_true(decision.get("requiresElasticPlasticTimeHistory") is False, f"Auto pushover should not require elastic-plastic time-history without records: {decision}")
    assert_true("groundMotions" not in data.get("missingInputs", []), f"Auto pushover should not require ground motions: {data.get('missingInputs')}")
    assert_true(data.get("responseSpectrum"), f"Auto pushover should keep response-spectrum baseline: {data}")
    assert_true(data.get("elasticPlasticTimeHistory") is None, f"Unexpected elastic-plastic time-history result: {data.get('elasticPlasticTimeHistory')}")
    assert_true(pushover.get("engineMode") == "opensees_linear_static_pushover", f"Unexpected auto pushover engine: {pushover}")
    assert_true(int(pushover.get("stepCount", 0) or 0) > 0, f"Missing auto pushover curve: {pushover}")
    capacity = pushover.get("capacityAssessment", {})
    assert_true(capacity.get("capacitySpectrumIteration", {}).get("status") == "estimated", f"Missing auto pushover capacity-spectrum iteration: {capacity}")
    assert_true(capacity.get("performancePoint", {}).get("source") == "secantCapacitySpectrumIteration", f"Unexpected auto pushover performance point source: {capacity}")
    final_compliance = pushover.get("finalCompliance", {})
    assert_true(final_compliance.get("status") in {"pass", "fail"}, f"Missing auto pushover final compliance: {final_compliance}")
    assert_true(final_compliance.get("performanceObjective", {}).get("name") == "collapse_prevention", f"Missing auto pushover performance objective trace: {final_compliance}")
    assert_true("pushoverCapacitySpectrumIteration" in capability.get("implementedCapabilities", []), f"Missing auto pushover capacity-spectrum capability: {capability}")
    assert_true("gb50011.nonlinearPushoverFinalCompliance" in capability.get("implementedCapabilities", []), f"Missing auto pushover final compliance capability: {capability}")
    print("[ok] seismic auto pushover contract")


def validate_seismic_vertical_seismic_requirement_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic vertical seismic requirement contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "response_spectrum",
            "structureProfile": {"hasLargeSpan": True},
            "designBasis": {"dampingRatio": 0.05},
            "designRequirements": {"fortificationCategory": "standard"},
        }
    })
    assert_true(result["success"] is True, f"Seismic vertical requirement request failed: {result['message']}")
    data = result.get("data", {})
    decision = data.get("methodDecision", {})
    vertical = data.get("verticalSeismic", {})
    assert_true(data.get("status") in {"success", "partial"}, f"Unexpected vertical requirement result status: {data.get('status')}")
    assert_true(decision.get("verticalSeismicRequired") is True, f"Missing vertical seismic decision: {decision}")
    assert_true(vertical.get("status") == "computed", f"Missing computed vertical seismic action: {vertical}")
    assert_true(float(vertical.get("totalVerticalActionKN", 0.0) or 0.0) > 0.0, f"Expected positive vertical action: {vertical}")
    static_check = vertical.get("openSeesStatic", {})
    assert_true(static_check.get("status") == "completed", f"Expected completed OpenSees vertical static check: {static_check}")
    assert_true(float(static_check.get("baseReactionKN", 0.0) or 0.0) > 0.0, f"Expected positive vertical base reaction: {static_check}")
    assert_true(int(static_check.get("memberForceCount", 0) or 0) > 0, f"Expected vertical member forces: {static_check}")
    assert_true("gb50011.verticalSeismicAction" not in data.get("missingCapabilities", []), f"Vertical action should be implemented: {data.get('missingCapabilities')}")
    assert_true("gb50011.verticalSeismicMemberForceCombination" not in data.get("missingCapabilities", []), f"Vertical member forces should be implemented: {data.get('missingCapabilities')}")
    assert_true("gb50011.verticalSeismicMemberCapacityCheck" not in data.get("missingCapabilities", []), f"Vertical member capacity check should be implemented: {data.get('missingCapabilities')}")
    capability = data.get("capabilityAssessment", {})
    assert_true("verticalSeismicMemberForces" in capability.get("implementedCapabilities", []), f"Missing vertical member-force implemented capability: {capability}")
    assert_true("gb50011.verticalSeismicMemberCapacityCheck" in capability.get("implementedCapabilities", []), f"Missing vertical capacity implemented capability: {capability}")
    assert_true(
        data.get("capabilityAssessment", {}).get("finalComplianceSupported") is True,
        f"Expected final compliance to be supported after vertical member screening: {data.get('capabilityAssessment')}",
    )
    print("[ok] seismic vertical seismic requirement contract")


def validate_seismic_special_system_boundary_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic special-system boundary contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "response_spectrum",
            "structure": {
                "hasIsolation": True,
                "hasEnergyDissipation": True,
            },
            "isolationSystem": {
                "equivalentHorizontalStiffness": 120000.0,
                "equivalentDampingRatio": 0.15,
                "displacementCapacity": 0.25,
                "bearings": [
                    {
                        "id": "LRB-1",
                        "horizontalStiffness": 30000.0,
                        "equivalentDampingRatio": 0.15,
                        "displacementDemand": 0.18,
                        "displacementCapacity": 0.22,
                    }
                ],
            },
            "energyDissipationSystem": {
                "devices": [
                    {
                        "id": "VD-1",
                        "type": "viscous",
                        "dampingCoefficient": 500.0,
                        "additionalDampingRatio": 0.08,
                        "displacementDemand": 0.04,
                        "deformationCapacity": 0.06,
                        "forceCapacityKN": 1000.0,
                    }
                ],
            },
            "groundMotionSet": {
                "records": [
                    {
                        "name": "ISO-TH-1",
                        "dt": 0.02,
                        "unit": "g",
                        "values": [0.0, 0.05, -0.04, 0.03, -0.02, 0.01, 0.0],
                    }
                ],
            },
            "designBasis": {"dampingRatio": 0.05},
            "designRequirements": {"fortificationCategory": "standard"},
        }
    })
    assert_true(result["success"] is True, f"Seismic special-system request failed: {result['message']}")
    data = result.get("data", {})
    decision = data.get("methodDecision", {})
    review = data.get("specialSystemReview", {})
    missing = data.get("missingCapabilities", [])
    capability = data.get("capabilityAssessment", {})
    assert_true(data.get("status") == "partial", f"Special-system analysis should be partial: {data.get('status')}")
    assert_true(decision.get("specialSystemReviewRequired") is True, f"Missing special-system review flag: {decision}")
    assert_true(review.get("reviewRequired") is True, f"Missing special-system review audit: {review}")
    assert_true("isolation" in review.get("systems", []), f"Missing isolation audit system: {review}")
    assert_true("energy_dissipation" in review.get("systems", []), f"Missing energy-dissipation audit system: {review}")
    isolation_estimate = review.get("isolationEquivalentLinearEstimate", {})
    assert_true(isolation_estimate.get("status") == "estimated", f"Missing isolation equivalent estimate: {review}")
    assert_true(float(isolation_estimate.get("periodSec", 0.0)) > 0.0, f"Invalid isolation estimate period: {isolation_estimate}")
    assert_true(float(isolation_estimate.get("displacementDemandM", 0.0)) > 0.0, f"Invalid isolation displacement demand: {isolation_estimate}")
    isolation_time_history = review.get("isolationLayerTimeHistoryEstimate", {})
    assert_true(isolation_time_history.get("status") == "estimated", f"Missing isolation SDOF time-history estimate: {review}")
    assert_true(isolation_time_history.get("controllingRecord") == "ISO-TH-1", f"Unexpected controlling isolation record: {isolation_time_history}")
    assert_true(float(isolation_time_history.get("maxDisplacementM", 0.0)) > 0.0, f"Invalid isolation time-history displacement: {isolation_time_history}")
    assert_true(
        "isolationLayerSdofTimeHistoryEstimate" in capability.get("implementedCapabilities", []),
        f"Missing isolation time-history implemented capability: {capability}",
    )
    energy_estimate = review.get("energyDissipationEquivalentEstimate", {})
    assert_true(energy_estimate.get("status") == "estimated", f"Missing energy-dissipation equivalent estimate: {review}")
    assert_true(float(energy_estimate.get("demandReductionRatio", 0.0)) > 0.0, f"Invalid energy-dissipation reduction ratio: {energy_estimate}")
    energy_time_history = review.get("energyDissipationTimeHistoryEstimate", {})
    assert_true(energy_time_history.get("status") == "estimated", f"Missing energy-dissipation SDOF time-history estimate: {review}")
    assert_true(energy_time_history.get("controllingRecord") == "ISO-TH-1", f"Unexpected controlling energy-dissipation record: {energy_time_history}")
    assert_true(float(energy_time_history.get("maxDeviceDeformationM", 0.0)) > 0.0, f"Invalid energy-dissipation device deformation: {energy_time_history}")
    assert_true(float(energy_time_history.get("maxDeviceForceKN", 0.0)) > 0.0, f"Invalid energy-dissipation device force: {energy_time_history}")
    assert_true(
        "energyDissipationSdofTimeHistoryEstimate" in capability.get("implementedCapabilities", []),
        f"Missing energy-dissipation time-history implemented capability: {capability}",
    )
    assert_true(
        "gb50011.isolationSystemSpecialSeismicAnalysis" in missing,
        f"Missing isolation capability boundary: {missing}",
    )
    assert_true(
        "gb50011.energyDissipationSystemSpecialSeismicAnalysis" in missing,
        f"Missing energy-dissipation capability boundary: {missing}",
    )
    assert_true(capability.get("finalComplianceSupported") is False, f"Expected final compliance boundary: {capability}")
    print("[ok] seismic special-system boundary contract")


def validate_seismic_long_period_special_study_contract():
    seismic_dir = ROOT_DIR / "backend/src/agent-skills/analysis/opensees-seismic"
    shared_dir = ROOT_DIR / "backend/src/skill-shared/python"
    for path in (seismic_dir, shared_dir):
        text = str(path)
        if text not in sys.path:
            sys.path.insert(0, text)

    from design_basis import build_design_basis
    from method_decision import decide_seismic_method
    from modal import ModalAnalysis
    from response_spectrum import run_response_spectrum
    from result_adapter import build_seismic_result

    model = StructureModelV2.model_validate(_seismic_frame_payload())
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
        engine_mode="contract_modal",
    )
    response = run_response_spectrum(basis, modal)
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

    assert_true(response.get("periodRangeAssessment", {}).get("requiresSpecialStudy") is True, f"Missing period special-study assessment: {response}")
    advisory = response.get("longPeriodSpecialStudyAdvisory", {})
    assert_true(advisory.get("status") == "advisory_only", f"Missing long-period advisory trace: {response}")
    assert_true(advisory.get("governingMode", {}).get("period") == 6.5, f"Unexpected long-period advisory governing mode: {advisory}")
    assert_true(result.get("status") == "partial", f"Long-period spectrum should be partial: {result.get('status')}")
    assert_true(result.get("summary", {}).get("periodSpecialStudyRequired") is True, f"Missing summary special-study flag: {result.get('summary')}")
    assert_true(
        "gb50011.responseSpectrumLongPeriodSpecialStudy" in result.get("missingCapabilities", []),
        f"Missing long-period capability boundary: {result.get('missingCapabilities')}",
    )
    print("[ok] seismic long-period special-study contract")


def validate_seismic_workflow_contract_aliases_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic workflow contract-aliases contract skipped; builtin-opensees unavailable: {issue}")
        return

    wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
    result = _run_seismic_request({
        "seismicWorkflow": {
            "requestedMethod": {"preference": "time_history"},
            "structureProfile": {"heightM": 90.0, "storyCount": 24},
            "groundMotionRequirement": {
                "recordCount": 3,
                "directions": ["X", "Y"],
            },
            "designBasis": {
                "dampingRatio": 0.05,
                "designBasicAccelerationG": 0.20,
                "siteSeismic": {
                    "designGroup": "2",
                    "siteCategory": "III",
                },
            },
            "designRequirements": {"fortificationCategory": "standard"},
            "groundMotionSet": {
                "records": [
                    {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                    {"name": "GM2", "dt": 0.02, "unit": "g", "values": [value * 1.1 for value in wave]},
                    {"name": "GM3", "dt": 0.02, "unit": "g", "values": [value * 0.9 for value in wave]},
                ],
            },
        }
    }, model=_seismic_space_frame_payload())
    assert_true(result["success"] is True, f"Seismic workflow contract-alias request failed: {result['message']}")
    data = result.get("data", {})
    basis = data.get("designBasis", {})
    decision = data.get("methodDecision", {})
    requirement = data.get("groundMotionRequirement", {})
    summary = data.get("summary", {})

    assert_true(basis.get("heightM") == 90.0, f"structureProfile height was not preserved: {basis}")
    assert_true(basis.get("storyCount") == 24, f"structureProfile story count was not preserved: {basis}")
    assert_true(abs(float(basis.get("accelerationG", 0.0)) - 0.20) < 1e-9, f"designBasicAccelerationG was not read: {basis}")
    assert_true(decision.get("selectedMethods") == ["response_spectrum", "time_history"], f"requestedMethod preference was not honored: {decision}")
    assert_true(decision.get("requiredGroundMotionCount") == 3, f"groundMotionRequirement recordCount was not honored: {decision}")
    assert_true(summary.get("directions") == ["x", "y"], f"groundMotionRequirement directions were not honored: {summary}")
    assert_true(requirement.get("totalRequiredCount") == 6, f"Unexpected total required count: {requirement}")
    assert_true(requirement.get("providedCount") == 6, f"Unexpected provided count: {requirement}")
    assert_true(requirement.get("missingCount") == 0, f"Unexpected missing count: {requirement}")
    print("[ok] seismic workflow contract-aliases contract")


def validate_seismic_time_history_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic time-history contract skipped; builtin-opensees unavailable: {issue}")
        return

    wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "time_history",
            "responseSpectrum": {"modalCombination": "srss"},
            "groundMotionSet": {
                "requiredCount": 3,
                "scaleFactorLimit": 20.0,
                "records": [
                    {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                    {"name": "GM2", "dt": 0.02, "unit": "g", "values": [value * 1.2 for value in wave]},
                    {"name": "GM3", "dt": 0.02, "unit": "g", "values": [value * 0.8 for value in wave]},
                ],
            },
        }
    })
    assert_true(result["success"] is True, f"Seismic time-history request failed: {result['message']}")
    data = result.get("data", {})
    assert_true(data.get("methodDecision", {}).get("selectedMethods") == ["response_spectrum", "time_history"], f"Unexpected methods: {data.get('methodDecision')}")
    envelope = data.get("envelope", {})
    elastic_final = data.get("elasticStoryDriftFinalCompliance", {})
    assert_true(elastic_final.get("status") in {"pass", "fail"}, f"Missing elastic envelope drift final compliance: {elastic_final}")
    assert_true(elastic_final.get("source") == "envelope.maxStoryDriftRatio", f"Unexpected elastic envelope drift source: {elastic_final}")
    assert_true(elastic_final.get("driftRatio") == envelope.get("maxStoryDriftRatio"), f"Elastic final compliance did not use the combined envelope drift: {elastic_final}, {envelope}")
    time_history = data.get("timeHistory", {})
    assert_true(len(time_history.get("records", [])) == 3, "Expected three ground-motion records in time-history result")
    assert_true(time_history.get("modalCombination") == "srss", f"Missing structured modal combination in time history: {time_history}")
    assert_true(int(time_history.get("modesUsed", 0) or 0) >= 1, f"Expected modal time-history modes: {time_history}")
    for record in time_history.get("records", []):
        modal_responses = record.get("modalResponses", [])
        assert_true(
            isinstance(modal_responses, list) and len(modal_responses) == int(record.get("modesUsed", 0) or 0),
            f"Missing per-mode time-history responses: {record}",
        )
    assert_true(time_history.get("engineMode") in {"opensees_transient_check", "modal_sdof"}, f"Unexpected time-history engine mode: {time_history.get('engineMode')}")
    transient = time_history.get("openSeesTransient", {})
    assert_true(isinstance(transient, dict), "Expected openSeesTransient metadata")
    if time_history.get("engineMode") == "opensees_transient_check":
        assert_true(len(transient.get("records", [])) == 3, "Expected three OpenSees transient records")
        assert_true(math.isfinite(float(transient.get("combinedBaseShear", 0.0))), "Missing OpenSees transient combined base shear")
        assert_true(math.isfinite(float(transient.get("maxStoryDriftRatio", 0.0))), "Missing OpenSees transient story drift ratio")
        assert_true(float(time_history.get("maxStoryDriftRatio", 0.0) or 0.0) >= 0.0, "Missing time-history story drift ratio")
        assert_true(
            float(data.get("envelope", {}).get("maxStoryDriftRatio", 0.0) or 0.0)
            >= float(time_history.get("maxStoryDriftRatio", 0.0) or 0.0),
            "Time-history story drift ratio was not included in the combined envelope",
        )
    else:
        assert_true(len(transient.get("warnings", [])) > 0, "Modal fallback should explain why OpenSees transient was unavailable")
    check = time_history.get("baseShearCheck", {})
    assert_true(check.get("eachRecordMinRatio") == 0.65, "Missing 65 percent base-shear criterion")
    assert_true(check.get("averageMinRatio") == 0.80, "Missing 80 percent average base-shear criterion")
    spectrum_match = time_history.get("spectrumMatch", {})
    assert_true(spectrum_match.get("recordCount") == 3, f"Missing spectrum-match record count: {spectrum_match}")
    assert_true(spectrum_match.get("scaleFactorLimit") == 20.0, f"Structured scale-factor limit was not preserved: {spectrum_match}")
    assert_true(math.isfinite(float(spectrum_match.get("maxScaleFactor", 0.0))) and float(spectrum_match.get("maxScaleFactor", 0.0)) > 0.0, f"Missing spectrum-match scale factor: {spectrum_match}")
    assert_true(spectrum_match.get("scaleFactorOk") is True, f"Unexpected spectrum-match status: {spectrum_match}")
    assert_true(math.isfinite(float(time_history.get("combinedBaseShear", 0.0))) and float(time_history.get("combinedBaseShear", 0.0)) > 0.0, "Missing positive combined time-history base shear")
    combination_summary = time_history.get("combinationSummary", {})
    assert_true(combination_summary.get("rule") == "envelope_max_vs_response_spectrum", f"Missing time-history combination rule: {combination_summary}")
    assert_true(combination_summary.get("timeHistoryStatistic") == "envelope", f"Unexpected time-history statistic: {combination_summary}")
    assert_true(combination_summary.get("governingSource") in {"time_history_envelope", "response_spectrum"}, f"Unexpected time-history governing source: {combination_summary}")
    expected_combined = max(
        float(combination_summary.get("responseSpectrumBaseShear", 0.0) or 0.0),
        float(combination_summary.get("timeHistoryEnvelopeBaseShear", 0.0) or 0.0),
    )
    assert_true(
        abs(float(time_history.get("combinedBaseShear", 0.0) or 0.0) - expected_combined) <= max(expected_combined * 1.0e-6, 1.0e-6),
        f"Combined time-history base shear did not follow 3-record envelope rule: {combination_summary}",
    )
    print("[ok] seismic time-history analyze contract")


def validate_seismic_ground_motion_requirement_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic ground-motion requirement contract skipped; builtin-opensees unavailable: {issue}")
        return

    wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "time_history",
            "groundMotionSet": {
                "requiredCount": 3,
                "records": [
                    {"name": "GM1", "dt": 0.02, "unit": "g", "values": wave},
                ],
            },
        }
    })
    assert_true(result["success"] is True, f"Seismic ground-motion requirement request failed: {result['message']}")
    data = result.get("data", {})
    assert_true(data.get("status") == "partial", f"Expected partial seismic result for insufficient records: {data.get('status')}")
    assert_true("groundMotions" in data.get("missingInputs", []), f"Missing groundMotions input marker: {data.get('missingInputs')}")
    requirement = data.get("groundMotionRequirement", {})
    assert_true(requirement.get("required") is True, f"Expected required ground motions: {requirement}")
    assert_true(requirement.get("requiredCount") == 3, f"Unexpected required count: {requirement}")
    assert_true(requirement.get("providedCount") == 1, f"Unexpected provided count: {requirement}")
    assert_true(requirement.get("missingCount") == 2, f"Unexpected missing count: {requirement}")
    assert_true(data.get("summary", {}).get("missingGroundMotionCount") == 2, f"Missing summary missing count: {data.get('summary')}")
    print("[ok] seismic ground-motion requirement contract")


def validate_seismic_structured_height_method_decision_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic structured-height method-decision contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
            "structure": {"heightM": 90.0, "storyCount": 24},
            "designBasis": {
                "siteSeismic": {"intensity": 8, "designGroup": "2", "siteCategory": "III"},
                "dampingRatio": 0.05,
            },
            "designRequirements": {"fortificationCategory": "standard"},
        }
    })
    assert_true(result["success"] is True, f"Seismic structured-height request failed: {result['message']}")
    data = result.get("data", {})
    basis = data.get("designBasis", {})
    decision = data.get("methodDecision", {})
    requirement = data.get("groundMotionRequirement", {})

    assert_true(data.get("status") == "partial", f"Expected partial result without required ground motions: {data.get('status')}")
    assert_true(basis.get("heightM") == 90.0, f"Structured height was not preserved: {basis}")
    assert_true(basis.get("storyCount") == 24, f"Structured story count was not preserved: {basis}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Structured height should require time history: {decision}")
    assert_true(decision.get("selectedMethods") == ["response_spectrum"], f"Missing-record workflow should keep response-spectrum primary result: {decision}")
    assert_true("groundMotions" in data.get("missingInputs", []), f"Missing groundMotions input marker: {data.get('missingInputs')}")
    assert_true(requirement.get("required") is True, f"Expected required ground motions: {requirement}")
    assert_true(requirement.get("providedCount") == 0, f"Unexpected provided count: {requirement}")
    assert_true(requirement.get("missingCount") == 3, f"Unexpected missing count: {requirement}")
    print("[ok] seismic structured-height method-decision contract")


def validate_seismic_catalog_time_history_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic catalog time-history contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "time_history",
            "groundMotionSet": {
                "source": "builtin_artificial",
                "autoSelect": True,
                "requiredCount": 3,
            },
        }
    })
    assert_true(result["success"] is True, f"Seismic catalog time-history request failed: {result['message']}")
    data = result.get("data", {})
    time_history = data.get("timeHistory", {})
    assert_true(len(time_history.get("records", [])) == 3, "Expected three catalog ground-motion records")
    catalog_selection = time_history.get("catalogSelection", {})
    assert_true(catalog_selection.get("source") == "builtin_artificial_catalog", f"Missing catalog selection: {catalog_selection}")
    assert_true(catalog_selection.get("catalogIds") == ["SCGM-A1", "SCGM-A2", "SCGM-A3"], f"Unexpected catalog ids: {catalog_selection.get('catalogIds')}")
    checks = time_history.get("groundMotionSetChecks", {})
    assert_true(checks.get("actualRecordRatioOk") is False, "Artificial catalog records must not be reported as actual recorded motions")
    print("[ok] seismic built-in catalog time-history contract")


def validate_seismic_local_catalog_time_history_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic local-catalog time-history contract skipped; builtin-opensees unavailable: {issue}")
        return

    wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "time_history",
            "groundMotionSet": {
                "source": "local_catalog",
                "catalogIds": ["LC-01", "LC-02", "LC-03"],
                "requiredCount": 3,
                "localCatalog": {
                    "records": [
                        {"id": "LC-01", "name": "licensed record 1", "recordType": "actual", "dt": 0.02, "unit": "g", "values": wave},
                        {"id": "LC-02", "name": "licensed record 2", "recordType": "actual", "dt": 0.02, "unit": "g", "values": [value * 1.2 for value in wave]},
                        {"id": "LC-03", "name": "licensed record 3", "recordType": "actual", "dt": 0.02, "unit": "g", "values": [value * 0.8 for value in wave]},
                    ],
                },
            },
        }
    })
    assert_true(result["success"] is True, f"Seismic local-catalog time-history request failed: {result['message']}")
    data = result.get("data", {})
    time_history = data.get("timeHistory", {})
    assert_true(len(time_history.get("records", [])) == 3, "Expected three local catalog ground-motion records")
    catalog_selection = time_history.get("catalogSelection", {})
    assert_true(catalog_selection.get("source") == "local_ground_motion_catalog", f"Missing local catalog selection: {catalog_selection}")
    assert_true(catalog_selection.get("catalogIds") == ["LC-01", "LC-02", "LC-03"], f"Unexpected local catalog ids: {catalog_selection.get('catalogIds')}")
    checks = time_history.get("groundMotionSetChecks", {})
    assert_true(checks.get("actualRecordRatioOk") is True, f"Local actual records should satisfy actual-record ratio: {checks}")
    print("[ok] seismic local-catalog time-history contract")


def validate_seismic_local_catalog_selection_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic local-catalog selection contract skipped; builtin-opensees unavailable: {issue}")
        return

    wave = [0.0, 0.02, -0.02, 0.01, -0.01, 0.0] * 20
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "time_history",
            "groundMotionSet": {
                "source": "local_catalog",
                "requiredCount": 3,
                "selectionCriteria": {
                    "recordType": "actual",
                    "siteClass": "III",
                    "minMagnitude": 6.0,
                    "maxMagnitude": 7.2,
                    "maxDistanceKm": 60.0,
                    "targetMagnitude": 6.6,
                    "targetDistanceKm": 30.0,
                },
                "localCatalog": {
                    "records": [
                        {"id": "LC-S0", "name": "wrong site", "recordType": "actual", "siteClass": "II", "magnitude": 6.6, "distanceKm": 28.0, "dt": 0.02, "unit": "g", "values": wave},
                        {"id": "LC-S1", "name": "selected 1", "recordType": "actual", "siteClass": "III", "magnitude": 6.5, "distanceKm": 35.0, "dt": 0.02, "unit": "g", "values": wave},
                        {"id": "LC-S2", "name": "selected 2", "recordType": "actual", "siteClass": "III", "magnitude": 6.8, "distanceKm": 22.0, "dt": 0.02, "unit": "g", "values": [value * 1.2 for value in wave]},
                        {"id": "LC-S3", "name": "selected 3", "recordType": "actual", "siteClass": "III", "magnitude": 6.1, "distanceKm": 45.0, "dt": 0.02, "unit": "g", "values": [value * 0.8 for value in wave]},
                        {"id": "LC-S4", "name": "artificial", "recordType": "artificial", "siteClass": "III", "magnitude": 6.6, "distanceKm": 30.0, "dt": 0.02, "unit": "g", "values": wave},
                    ],
                },
            },
        }
    })
    assert_true(result["success"] is True, f"Seismic local-catalog selection request failed: {result['message']}")
    time_history = result.get("data", {}).get("timeHistory", {})
    catalog_selection = time_history.get("catalogSelection", {})
    assert_true(catalog_selection.get("catalogIds") == ["LC-S1", "LC-S2", "LC-S3"], f"Unexpected selected local catalog ids: {catalog_selection}")
    checks = time_history.get("groundMotionSetChecks", {})
    assert_true(checks.get("actualRecordRatioOk") is True, f"Selected local records should satisfy actual-record ratio: {checks}")
    print("[ok] seismic local-catalog metadata selection contract")


def validate_seismic_auto_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic auto-regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model["stories"][0]["height"] = 3.0
    model["stories"][1]["height"] = 5.2
    model["nodes"][2]["z"] = 3.0
    model["nodes"][3]["z"] = 3.0
    model["nodes"][4]["z"] = 8.2
    model["nodes"][5]["z"] = 8.2
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic auto-regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    reasons = decision.get("reasons", [])
    assert_true(any("Automatic model regularity assessment" in reason for reason in reasons), f"Missing auto-regularity reason: {reasons}")
    print("[ok] seismic auto-regularity method-decision contract")


def validate_seismic_nested_regularity_assessment_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic nested regularity-assessment contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
            "regularityAssessment": {
                "classification": "particularly_irregular",
            },
        }
    }, model=_seismic_frame_payload())
    assert_true(result["success"] is True, f"Seismic nested regularity-assessment request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    explicit_checks = [
        check for check in checks
        if check.get("name") == "explicit_regularity"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(regularity.get("source") == "structured_requirement", f"Unexpected regularity source: {regularity}")
    assert_true(explicit_checks and explicit_checks[0].get("value") == "particularly_irregular", f"Missing explicit regularity trace: {checks}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic nested regularity-assessment contract")


def validate_seismic_soft_story_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic soft-story regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model["sections"].append({
        "id": "weak",
        "name": "250X250",
        "type": "rectangular",
        "properties": {"A": 0.0625, "Iy": 0.0001, "Iz": 0.0001, "J": 0.0002},
    })
    for element in model["elements"]:
        if element["id"] in {"C3", "C4"}:
            element["section"] = "weak"
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic soft-story regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    stiffness_checks = [
        check for check in checks
        if check.get("name") == "story_lateral_stiffness_variation"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(stiffness_checks and float(stiffness_checks[0].get("value", 1.0)) < 0.50, f"Missing soft-story stiffness check: {checks}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic soft-story regularity contract")


def validate_seismic_structured_weak_story_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic structured weak-story regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model["stories"][0].setdefault("extra", {})["isSoftStory"] = True
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
            "structure": {
                "hasWeakStory": True,
            },
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic structured weak-story regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    weak_story_checks = [
        check for check in checks
        if check.get("name") == "explicit_weak_soft_story"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(weak_story_checks and weak_story_checks[0].get("severity") == "particularly_irregular", f"Missing explicit weak-story check: {checks}")
    assert_true(
        weak_story_checks[0].get("triggers", [{}])[0].get("source") == "seismicWorkflow.structure.hasWeakStory",
        f"Missing workflow weak-story trigger trace: {weak_story_checks}",
    )
    assert_true(
        weak_story_checks[0].get("storyTriggers", [{}])[0].get("source") == "stories[].isSoftStory",
        f"Missing story weak-story trigger trace: {weak_story_checks}",
    )
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic structured weak-story regularity contract")


def validate_seismic_story_strength_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic story-strength regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model["stories"][0].setdefault("extra", {})["storyLateralCapacity"] = {"xKN": 3200.0, "yKN": 3000.0}
    model["stories"][1].setdefault("extra", {})["storyLateralCapacity"] = {"xKN": 1600.0, "yKN": 1550.0}
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic story-strength regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    strength_checks = [
        check for check in checks
        if check.get("name") == "story_lateral_strength_variation"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(strength_checks and strength_checks[0].get("severity") == "particularly_irregular", f"Missing story-strength check: {checks}")
    assert_true(float(strength_checks[0].get("value", 1.0)) < 0.65, f"Unexpected story-strength ratio: {strength_checks}")
    strengths = strength_checks[0].get("storyStrengths", [])
    assert_true(strengths and strengths[0].get("source") == "stories[].extra.storyLateralCapacity", f"Unexpected story-strength source: {strengths}")
    assert_true(strengths and strengths[0].get("strengthKN") == 3000.0, f"Unexpected story-strength value: {strengths}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic story-strength regularity contract")


def validate_seismic_story_stiffness_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic structured story-stiffness regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model["stories"][0].setdefault("extra", {})["storyLateralStiffnessKNPerM"] = 200000.0
    model["stories"][1].setdefault("extra", {})["storyLateralStiffness"] = {"x": 78000.0, "y": 82000.0}
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic structured story-stiffness regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    stiffness_checks = [
        check for check in checks
        if check.get("name") == "structured_story_lateral_stiffness_variation"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(stiffness_checks and stiffness_checks[0].get("severity") == "particularly_irregular", f"Missing structured story-stiffness check: {checks}")
    assert_true(float(stiffness_checks[0].get("value", 1.0)) < 0.50, f"Unexpected story-stiffness ratio: {stiffness_checks}")
    stiffnesses = stiffness_checks[0].get("storyStiffness", [])
    assert_true(stiffnesses and stiffnesses[0].get("source") == "stories[].extra.storyLateralStiffnessKNPerM", f"Unexpected story-stiffness source: {stiffnesses}")
    assert_true(stiffnesses and stiffnesses[1].get("source") == "stories[].extra.storyLateralStiffness", f"Unexpected story-stiffness source: {stiffnesses}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic structured story-stiffness regularity contract")


def validate_seismic_story_mass_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic story-mass regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model["stories"][0].setdefault("extra", {})["seismicWeightKN"] = 1000.0
    model["stories"][1].setdefault("extra", {})["seismicWeightKN"] = 2600.0
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic story-mass regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    mass_checks = [
        check for check in checks
        if check.get("name") == "story_mass_variation"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(mass_checks and float(mass_checks[0].get("value", 0.0)) > 2.00, f"Missing story-mass check: {checks}")
    weights = mass_checks[0].get("storyWeights", [])
    assert_true(weights and weights[0].get("source") == "stories[].extra.seismicWeightKN", f"Unexpected story-mass source: {weights}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic story-mass regularity contract")


def validate_seismic_floor_diaphragm_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic floor-diaphragm regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_space_frame_payload()
    model["slab_openings"] = [
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
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic floor-diaphragm regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    diaphragm_checks = [
        check for check in checks
        if check.get("name") == "floor_diaphragm_discontinuity"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(diaphragm_checks and float(diaphragm_checks[0].get("value", 0.0)) > 0.50, f"Missing diaphragm discontinuity check: {checks}")
    story_items = diaphragm_checks[0].get("storyDiaphragms", [])
    assert_true(story_items and story_items[0].get("openingCount") == 1, f"Unexpected diaphragm story trace: {story_items}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic floor-diaphragm regularity contract")


def validate_seismic_story_diaphragm_opening_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic story diaphragm-opening regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model["stories"][0].setdefault("extra", {})["openingRatio"] = 0.56
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic story diaphragm-opening regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    diaphragm_checks = [
        check for check in checks
        if check.get("name") == "floor_diaphragm_discontinuity"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(diaphragm_checks and diaphragm_checks[0].get("severity") == "particularly_irregular", f"Missing story diaphragm-opening check: {checks}")
    story_items = diaphragm_checks[0].get("storyDiaphragms", [])
    assert_true(
        story_items and story_items[0].get("openingRatioSource") == "stories[].extra.openingRatio",
        f"Missing story opening-ratio source trace: {story_items}",
    )
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic story diaphragm-opening regularity contract")


def validate_seismic_torsional_irregularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic torsional-irregularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_space_frame_payload()
    model["sections"].append({
        "id": "stiff",
        "name": "stiff corner column",
        "type": "rectangular",
        "properties": {"A": 1.0, "Iy": 0.5, "Iz": 0.5, "J": 1.0},
    })
    for element in model["elements"]:
        if element["id"] in {"C100", "C200"}:
            element["section"] = "stiff"
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic torsional-irregularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    torsion_checks = [
        check for check in checks
        if check.get("name") == "plan_torsional_eccentricity"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(torsion_checks and float(torsion_checks[0].get("value", 0.0)) > 0.30, f"Missing torsional eccentricity check: {checks}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic torsional-irregularity regularity contract")


def validate_seismic_structured_torsional_ratio_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic structured torsional-ratio contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model["stories"][1].setdefault("extra", {})["maxDisplacementToAverageRatio"] = 1.46
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
            "regularityAssessment": {
                "torsionalDisplacementRatio": 1.31,
            },
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic structured torsional-ratio request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    torsion_checks = [
        check for check in checks
        if check.get("name") == "structured_torsional_displacement_ratio"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(torsion_checks and torsion_checks[0].get("severity") == "particularly_irregular", f"Missing structured torsional-ratio check: {checks}")
    assert_true(float(torsion_checks[0].get("value", 0.0)) > 1.40, f"Unexpected torsional-ratio value: {torsion_checks}")
    sources = {item.get("source") for item in torsion_checks[0].get("ratios", [])}
    assert_true("seismicWorkflow.regularityAssessment.torsionalDisplacementRatio" in sources, f"Missing workflow torsional-ratio trace: {torsion_checks}")
    assert_true("stories[].extra.maxDisplacementToAverageRatio" in sources, f"Missing story torsional-ratio trace: {torsion_checks}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic structured torsional-ratio contract")


def validate_seismic_plan_setback_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic plan-setback regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_space_frame_payload()
    for node in model["nodes"]:
        if node.get("story") == "F2":
            node["x"] = 0.0 if node["x"] == 0.0 else 2.0
            node["y"] = 0.0 if node["y"] == 0.0 else 2.0
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic plan-setback regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    setback_checks = [
        check for check in checks
        if check.get("name") == "plan_setback_variation"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(setback_checks and float(setback_checks[0].get("value", 1.0)) < 0.50, f"Missing plan-setback check: {checks}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic plan-setback regularity contract")


def validate_seismic_structured_plan_irregularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic structured plan-irregularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    model["stories"][0].setdefault("extra", {})["planReentrantCornerRatio"] = 0.43
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
            "structure": {
                "hasSeverePlanIrregularity": True,
            },
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic structured plan-irregularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    plan_checks = [
        check for check in checks
        if check.get("name") == "structured_plan_irregularity_flags"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(plan_checks and plan_checks[0].get("severity") == "particularly_irregular", f"Missing structured plan-irregularity check: {checks}")
    sources = {item.get("source") for item in plan_checks[0].get("triggers", [])}
    assert_true("seismicWorkflow.structure.hasSeverePlanIrregularity" in sources, f"Missing workflow plan-irregularity trace: {plan_checks}")
    assert_true("stories[].extra.planReentrantCornerRatio" in sources, f"Missing story plan-irregularity trace: {plan_checks}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic structured plan-irregularity contract")


def validate_seismic_vertical_discontinuity_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic vertical-discontinuity regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_frame_payload()
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
            "structure": {
                "hasTransferStory": True,
            },
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic vertical-discontinuity regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    discontinuity_checks = [
        check for check in checks
        if check.get("name") == "vertical_lateral_system_discontinuity"
    ]
    assert_true(regularity.get("classification") == "particularly_irregular", f"Unexpected regularity: {regularity}")
    assert_true(discontinuity_checks and discontinuity_checks[0].get("value") is True, f"Missing vertical discontinuity check: {checks}")
    triggers = discontinuity_checks[0].get("triggers", [])
    assert_true(triggers and triggers[0].get("source") == "seismicWorkflow.structure.hasTransferStory", f"Missing structured transfer-story trigger: {discontinuity_checks[0]}")
    assert_true(decision.get("requiresTimeHistory") is True, f"Expected time-history requirement: {decision}")
    assert_true("groundMotions" in decision.get("missingInputs", []), f"Expected missing ground motions: {decision}")
    print("[ok] seismic vertical-discontinuity regularity contract")


def validate_seismic_plan_aspect_regularity_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic plan-aspect regularity contract skipped; builtin-opensees unavailable: {issue}")
        return

    model = _seismic_space_frame_payload()
    for node in model["nodes"]:
        node["y"] = 0.0 if node["y"] == 0.0 else 0.5
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "auto",
        }
    }, model=model)
    assert_true(result["success"] is True, f"Seismic plan-aspect regularity request failed: {result['message']}")
    data = result.get("data", {})
    regularity = data.get("regularityAssessment", {})
    decision = data.get("methodDecision", {})
    checks = regularity.get("checks", [])
    aspect_checks = [
        check for check in checks
        if check.get("name") == "plan_aspect_ratio"
    ]
    assert_true(regularity.get("classification") == "irregular", f"Unexpected regularity: {regularity}")
    assert_true(aspect_checks and float(aspect_checks[0].get("value", 0.0)) > 6.0, f"Missing plan-aspect check: {checks}")
    assert_true(decision.get("requiresTimeHistory") is not True, f"General irregular aspect ratio should not force time history: {decision}")
    print("[ok] seismic plan-aspect regularity contract")


def validate_seismic_pushover_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic pushover contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "pushover",
            "pushover": {
                "targetDisplacement": 0.02,
            },
        }
    })
    assert_true(result["success"] is True, f"Seismic pushover request failed: {result['message']}")
    data = result.get("data", {})
    assert_true(data.get("analysisMode") == "opensees_china_seismic_workflow", f"Unexpected pushover analysis mode: {data.get('analysisMode')}")
    assert_true(data.get("status") in {"success", "partial"}, f"Unexpected pushover status: {data.get('status')}")
    model_summary = data.get("modelSummary", {})
    assert_true(model_summary.get("nodeCount") == 6 and model_summary.get("elementCount") == 6, f"Missing pushover model summary: {model_summary}")
    decision = data.get("methodDecision", {})
    assert_true(decision.get("selectedMethods") == ["pushover"], f"Unexpected pushover method decision: {decision}")
    capability = data.get("capabilityAssessment", {})
    assert_true(capability.get("finalComplianceSupported") is True, f"Pushover final compliance should be supported: {capability}")
    assert_true("gb50011.nonlinearPushoverFinalCompliance" not in data.get("missingCapabilities", []), f"Unexpected pushover capability boundary: {data.get('missingCapabilities')}")
    pushover = data.get("pushover", {})
    curve = pushover.get("curve", [])
    assert_true(len(curve) > 0, f"Expected non-empty pushover curve: {pushover}")
    assert_true(pushover.get("engineMode") == "opensees_linear_static_pushover", f"Unexpected pushover engine mode: {pushover.get('engineMode')}")
    capacity = pushover.get("capacityAssessment", {})
    performance = capacity.get("performancePoint", {})
    assert_true(capacity.get("status") == "estimated", f"Missing pushover capacity assessment: {capacity}")
    assert_true(capacity.get("capacitySpectrumIteration", {}).get("status") == "estimated", f"Missing pushover capacity-spectrum iteration: {capacity}")
    assert_true(performance.get("source") == "secantCapacitySpectrumIteration", f"Unexpected pushover performance-point source: {performance}")
    assert_true(float(performance.get("baseShearKN", 0.0) or 0.0) > 0.0, f"Missing pushover performance point: {performance}")
    nonlinear = pushover.get("nonlinearEstimate", {})
    nonlinear_performance = nonlinear.get("performancePoint", {})
    assert_true(nonlinear.get("status") == "estimated", f"Missing pushover nonlinear estimate: {nonlinear}")
    assert_true(nonlinear.get("engineMode") == "opensees_bilinear_story_shear_pushover_estimate", f"Unexpected pushover nonlinear engine: {nonlinear}")
    assert_true(nonlinear.get("modelScope") == "bilinear_story_shear_building", f"Unexpected pushover nonlinear model scope: {nonlinear}")
    assert_true(len(nonlinear.get("curve", [])) > 0, f"Missing pushover nonlinear curve: {nonlinear}")
    assert_true(len(nonlinear.get("curve", [{}])[0].get("storyResponses", [])) > 0, f"Missing pushover story responses: {nonlinear}")
    controlling_story = nonlinear.get("controllingStory", {})
    assert_true(float(controlling_story.get("driftRatio", 0.0) or 0.0) > 0.0, f"Missing pushover controlling story: {nonlinear}")
    assert_true(float(nonlinear_performance.get("baseShearKN", 0.0) or 0.0) > 0.0, f"Missing pushover nonlinear performance point: {nonlinear_performance}")
    final_compliance = pushover.get("finalCompliance", {})
    assert_true(final_compliance.get("status") in {"pass", "fail"}, f"Missing pushover final compliance: {final_compliance}")
    assert_true(final_compliance.get("source") == "pushover.nonlinearEstimate.acceptanceCheck", f"Unexpected pushover final compliance source: {final_compliance}")
    assert_true("pushoverPerformancePointEstimate" in capability.get("implementedCapabilities", []), f"Missing pushover implemented capability: {capability}")
    assert_true("pushoverCapacitySpectrumIteration" in capability.get("implementedCapabilities", []), f"Missing pushover capacity-spectrum capability: {capability}")
    assert_true("pushoverBilinearSdofEstimate" in capability.get("implementedCapabilities", []), f"Missing pushover nonlinear estimate capability: {capability}")
    assert_true("pushoverBilinearStoryShearBuildingEstimate" in capability.get("implementedCapabilities", []), f"Missing pushover story-shear nonlinear estimate capability: {capability}")
    assert_true("gb50011.nonlinearPushoverFinalCompliance" in capability.get("implementedCapabilities", []), f"Missing pushover final compliance capability: {capability}")
    envelope = data.get("envelope", {})
    assert_true(math.isfinite(float(envelope.get("maxBaseShear", 0.0))), f"Missing pushover max base shear: {envelope}")
    assert_true(math.isfinite(float(envelope.get("maxAbsDisplacement", 0.0))), f"Missing pushover max displacement: {envelope}")
    print("[ok] seismic pushover analyze contract")


def validate_seismic_pushover_member_hinge_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic pushover member-hinge contract skipped; builtin-opensees unavailable: {issue}")
        return

    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "pushover",
            "performanceObjective": {"name": "collapse_prevention", "acceptanceDriftRatio": 0.012},
            "pushover": {
                "targetDisplacement": 0.02,
            },
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
        }
    })
    assert_true(result["success"] is True, f"Seismic pushover member-hinge request failed: {result['message']}")
    data = result.get("data", {})
    pushover = data.get("pushover", {})
    nonlinear = pushover.get("nonlinearEstimate", {})
    capability = data.get("capabilityAssessment", {})
    final_compliance = pushover.get("finalCompliance", {})
    assert_true(nonlinear.get("status") == "estimated", f"Missing member-hinge nonlinear estimate: {nonlinear}")
    assert_true(nonlinear.get("engineMode") == "opensees_member_end_plastic_hinge_2d_pushover_estimate", f"Unexpected member-hinge engine: {nonlinear}")
    assert_true(nonlinear.get("modelScope") == "member_end_rotational_plastic_hinges_2d", f"Unexpected member-hinge scope: {nonlinear}")
    assert_true(nonlinear.get("parameters", {}).get("hingeCount") == 8, f"Unexpected hinge count: {nonlinear.get('parameters')}")
    assert_true(len(nonlinear.get("curve", [])) > 0, f"Missing member-hinge curve: {nonlinear}")
    assert_true(len(nonlinear.get("hingeResponses", [])) > 0, f"Missing hinge responses: {nonlinear}")
    assert_true(nonlinear.get("controllingHinge", {}).get("elementId"), f"Missing controlling hinge: {nonlinear}")
    assert_true("pushoverMemberPlasticHinge2dEstimate" in nonlinear.get("implementedCapabilities", []), f"Missing member-hinge capability: {nonlinear}")
    assert_true("pushoverMemberPlasticHinge2dEstimate" in capability.get("implementedCapabilities", []), f"Missing top-level member-hinge capability: {capability}")
    assert_true("nonlinearModel.memberPlasticHingeBackboneCalibration" not in nonlinear.get("missingInputs", []), f"Unexpected hinge calibration missing input: {nonlinear}")
    assert_true("nonlinearModel.fullMemberConstitutiveModels" in nonlinear.get("missingInputs", []), f"Expected full-member boundary: {nonlinear}")
    assert_true(final_compliance.get("source") == "pushover.nonlinearEstimate.acceptanceCheck", f"Unexpected final compliance source: {final_compliance}")
    assert_true("member-end rotational plastic-hinge" in str(final_compliance.get("scope", "")), f"Missing member-hinge final compliance scope: {final_compliance}")
    print("[ok] seismic pushover member-hinge analyze contract")


def validate_seismic_uploaded_text_time_history_contract():
    issue = get_opensees_runtime_issue()
    if issue:
        print(f"[skip] seismic uploaded-text time-history contract skipped; builtin-opensees unavailable: {issue}")
        return

    rows = [[f"{index * 0.02:.2f}", f"{0.02 * math.sin(index * 0.5):.6f}"] for index in range(80)]
    at2_text = "\n".join([
        "PEER NGA STRONG MOTION DATABASE RECORD",
        "NPTS= 80, DT= .02 SEC",
        *[
            " ".join(f"{0.018 * math.sin((line * 4 + offset) * 0.45):.6f}" for offset in range(4))
            for line in range(20)
        ],
    ])
    result = _run_seismic_request({
        "seismicWorkflow": {
            "methodPreference": "time_history",
            "groundMotionSet": {
                "requiredCount": 3,
                "records": [
                    {
                        "name": "uploaded-rows.csv",
                        "unit": "g",
                        "headers": ["time", "accel_g"],
                        "rows": rows,
                    },
                    {
                        "name": "uploaded-at2.at2",
                        "unit": "g",
                        "content": at2_text,
                    },
                    {
                        "name": "uploaded-nested-file.csv",
                        "unit": "g",
                        "fileAnalysis": {
                            "type": "csv",
                            "headers": ["time", "accel_g"],
                            "rows": [[row[0], f"{float(row[1]) * 0.8:.6f}"] for row in rows],
                        },
                    },
                ],
            },
        }
    })
    assert_true(result["success"] is True, f"Seismic uploaded-text time-history request failed: {result['message']}")
    data = result.get("data", {})
    time_history = data.get("timeHistory", {})
    records = time_history.get("records", [])
    assert_true(len(records) == 3, f"Expected three uploaded ground-motion records, got {len(records)}")
    assert_true(records[0].get("sourceFormat") == "rows", f"Expected rows source format: {records[0] if records else None}")
    assert_true(records[1].get("sourceFormat") == "text", f"Expected text source format: {records[1] if len(records) > 1 else None}")
    assert_true(all(record.get("pointCount", 0) >= 80 for record in records), f"Unexpected point counts: {records}")
    assert_true(math.isfinite(float(time_history.get("combinedBaseShear", 0.0))) and float(time_history.get("combinedBaseShear", 0.0)) > 0.0, "Missing positive uploaded-text combined base shear")
    print("[ok] seismic uploaded-text time-history contract")


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


def validate_gb50011_seismic_code_check_contract():
    result = run_code_check(
        "seismic-code-check-demo",
        "GB50011",
        ["__global_seismic__"],
        {
            "analysisSummary": {
                "analysisMode": "opensees_china_seismic_workflow",
                "summary": {
                    "maxStoryDriftRatio": 0.0012,
                    "modalMassParticipationRatio": 0.92,
                    "fundamentalPeriod": 4.0,
                },
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "intensity": 8,
                    "accelerationG": 0.30,
                    "seismicGrade": 2,
                    "seismicGradeSource": "designRequirements.seismicGrade",
                    "isPreliminary": False,
                    "missingInputs": [],
                    "codeBasis": [
                        {"code": "GB 55002-2021"},
                        {"code": "GB/T 50011-2010"},
                        {
                            "code": "GB 18306-2015",
                            "standardStatus": "current",
                            "lastReviewDate": "2021-12-31",
                            "lastReviewConclusion": "continue_valid",
                            "amendments": [{
                                "no": "No.1",
                                "status": "effective",
                                "effectiveDate": "2026-02-27",
                            }],
                            "revisionPlan": {
                                "planNo": "20260055-Q-419",
                                "status": "drafting",
                            },
                        },
                    ],
                },
                "methodDecision": {
                    "selectedMethods": ["response_spectrum", "time_history"],
                    "requiresTimeHistory": True,
                    "requiredGroundMotionCount": 3,
                    "verticalSeismicRequired": True,
                },
                "regularityAssessment": {
                    "classification": "particularly_irregular",
                    "source": "model_heuristic",
                    "checks": [
                        {"name": "story_mass_variation", "severity": "particularly_irregular"},
                    ],
                },
                "verticalSeismic": {
                    "status": "computed",
                    "method": "simplified_static",
                    "coefficient": 0.10,
                    "totalVerticalActionKN": 18.0,
                    "openSeesStatic": {
                        "status": "completed",
                        "memberForceCount": 6,
                        "memberForces": {
                            "C1": {
                                "maxAbsAxialKN": 12.0,
                                "maxAbsShearKN": 2.0,
                                "maxAbsMomentKNm": 4.0,
                            },
                        },
                    },
                },
                "seismicDesignActions": {
                    "status": "computed",
                    "direction": "x",
                    "method": "equivalent_lateral_static_from_response_spectrum_floor_forces",
                    "memberForceCount": 6,
                    "memberForces": {
                        "C1": {"maxAbsMomentKNm": 12.0},
                    },
                },
                "memberDesignActionCombinations": {
                    "status": "computed",
                    "memberCount": 6,
                    "caseCount": 2,
                    "cases": [
                        {
                            "name": "gravity_plus_horizontal_seismic",
                            "memberActions": [
                                {
                                    "elementId": "C1",
                                    "maxAbsAxialKN": 20.0,
                                    "maxAbsShearKN": 6.0,
                                    "maxAbsMomentKNm": 12.0,
                                },
                            ],
                        },
                    ],
                    "controlling": {
                        "moment": {
                            "value": 22.0,
                            "elementId": "C1",
                            "case": "gravity_plus_horizontal_seismic",
                        },
                    },
                },
                "pushover": {
                    "nonlinearEstimate": {
                        "status": "estimated",
                        "performancePoint": {"driftRatio": 0.012},
                        "acceptanceCheck": {"limitDriftRatio": 0.02},
                    },
                    "finalCompliance": {
                        "status": "pass",
                        "method": "nonlinear_pushover_drift_acceptance",
                        "source": "pushover.nonlinearEstimate.acceptanceCheck",
                        "scope": "OpenSees bilinear SDOF nonlinear estimate calibrated from the elastic pushover curve",
                        "driftRatio": 0.012,
                        "limitDriftRatio": 0.02,
                        "utilization": 0.6,
                    },
                },
                "elasticPlasticTimeHistory": {
                    "status": "estimated",
                    "finalCompliance": {
                        "status": "pass",
                        "method": "elastic_plastic_time_history_drift_acceptance",
                        "source": "elasticPlasticTimeHistory.acceptanceCheck",
                        "scope": "OpenSees bilinear SDOF nonlinear time-history estimate",
                        "driftRatio": 0.004,
                        "limitDriftRatio": 0.02,
                        "utilization": 0.2,
                    },
                },
                "responseSpectrum": {
                    "floorResponses": [
                        {
                            "story": "F1",
                            "direction": "x",
                            "shearWeightRatio": 0.052,
                            "isWeakStory": True,
                        },
                        {
                            "story": "F2",
                            "direction": "x",
                            "shearWeightRatio": 0.060,
                        },
                    ],
                },
                "groundMotionRequirement": {
                    "required": True,
                    "requiredCount": 3,
                    "providedCount": 3,
                    "missingCount": 0,
                    "status": "satisfied",
                },
                "timeHistory": {
                    "records": [
                        {"baseShearRatioToResponseSpectrum": 0.70},
                        {"baseShearRatioToResponseSpectrum": 0.82},
                        {"baseShearRatioToResponseSpectrum": 0.91},
                    ],
                    "averageBaseShear": 820.0,
                    "envelopeBaseShear": 910.0,
                    "combinedBaseShear": 1000.0,
                    "combinationRule": "envelope_max_vs_response_spectrum",
                    "combinationSummary": {
                        "rule": "envelope_max_vs_response_spectrum",
                        "recordCount": 3,
                        "responseSpectrumBaseShear": 1000.0,
                        "timeHistoryEnvelopeBaseShear": 910.0,
                        "timeHistoryAverageBaseShear": 820.0,
                        "timeHistoryStatistic": "envelope",
                        "timeHistoryStatisticBaseShear": 910.0,
                        "combinedBaseShear": 1000.0,
                        "governingSource": "response_spectrum",
                    },
                    "baseShearCheck": {"responseSpectrumBaseShear": 1000.0},
                    "spectrumMatch": {
                        "maxScaleFactor": 1.4,
                        "scaleFactorLimit": 10.0,
                        "modalSpectrumAverageMinRatio": 0.65,
                        "averageModalSpectrumMinRatioToTarget": 0.92,
                        "modalSpectrumAverageOk": True,
                        "periodCheckScope": "modal_period_points",
                        "periodChecks": [{
                            "period": 0.8,
                            "averageRatioToTarget": 1.0,
                        }],
                    },
                    "groundMotionSetChecks": {
                        "actualRecordCount": 2,
                        "requiredActualRecordCount": 2,
                    },
                },
                "directionResults": [
                    {
                        "direction": "x",
                        "timeHistory": {
                            "records": [
                                {"baseShearRatioToResponseSpectrum": 0.70},
                                {"baseShearRatioToResponseSpectrum": 0.82},
                                {"baseShearRatioToResponseSpectrum": 0.91},
                            ],
                            "averageBaseShear": 820.0,
                            "envelopeBaseShear": 910.0,
                            "combinedBaseShear": 1000.0,
                            "combinationRule": "envelope_max_vs_response_spectrum",
                            "combinationSummary": {
                                "rule": "envelope_max_vs_response_spectrum",
                                "recordCount": 3,
                                "responseSpectrumBaseShear": 1000.0,
                                "timeHistoryEnvelopeBaseShear": 910.0,
                                "timeHistoryAverageBaseShear": 820.0,
                                "timeHistoryStatistic": "envelope",
                                "timeHistoryStatisticBaseShear": 910.0,
                                "combinedBaseShear": 1000.0,
                                "governingSource": "response_spectrum",
                            },
                            "baseShearCheck": {"responseSpectrumBaseShear": 1000.0},
                            "spectrumMatch": {
                                "maxScaleFactor": 1.4,
                                "scaleFactorLimit": 10.0,
                                "modalSpectrumAverageMinRatio": 0.65,
                                "averageModalSpectrumMinRatioToTarget": 0.92,
                            },
                            "groundMotionSetChecks": {
                                "recordCount": 3,
                                "actualRecordCount": 2,
                                "requiredActualRecordCount": 2,
                            },
                        },
                    },
                    {
                        "direction": "y",
                        "timeHistory": {
                            "records": [
                                {"baseShearRatioToResponseSpectrum": 0.72},
                                {"baseShearRatioToResponseSpectrum": 0.84},
                                {"baseShearRatioToResponseSpectrum": 0.93},
                            ],
                            "averageBaseShear": 830.0,
                            "envelopeBaseShear": 930.0,
                            "combinedBaseShear": 1000.0,
                            "combinationRule": "envelope_max_vs_response_spectrum",
                            "combinationSummary": {
                                "rule": "envelope_max_vs_response_spectrum",
                                "recordCount": 3,
                                "responseSpectrumBaseShear": 1000.0,
                                "timeHistoryEnvelopeBaseShear": 930.0,
                                "timeHistoryAverageBaseShear": 830.0,
                                "timeHistoryStatistic": "envelope",
                                "timeHistoryStatisticBaseShear": 930.0,
                                "combinedBaseShear": 1000.0,
                                "governingSource": "response_spectrum",
                            },
                            "baseShearCheck": {"responseSpectrumBaseShear": 1000.0},
                            "spectrumMatch": {
                                "maxScaleFactor": 1.5,
                                "scaleFactorLimit": 10.0,
                                "modalSpectrumAverageMinRatio": 0.65,
                                "averageModalSpectrumMinRatioToTarget": 0.90,
                            },
                            "groundMotionSetChecks": {
                                "recordCount": 3,
                                "actualRecordCount": 2,
                                "requiredActualRecordCount": 2,
                            },
                        },
                    },
                ],
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "section": {"A": 250000.0, "I": 5.0e9},
                    "material": {"fc": 14.3},
                    "verticalSeismicCapacity": {
                        "verticalSeismicCapacityUtilization": 0.82,
                    },
                },
            },
        },
    )

    assert_true(result["status"] == "success", f"Unexpected GB50011 result status: {result['status']}")
    assert_true(result["summary"]["failed"] == 0, f"Expected no failed global seismic items: {result['summary']}")
    assert_true(result["summary"]["notApplicable"] == 0, f"Expected no unavailable global seismic items: {result['summary']}")
    assert_true(
        result["summary"]["passed"] == result["summary"]["total"],
        f"Expected all global seismic check items to pass: {result['summary']}",
    )
    detail = result["details"][0]
    assert_true(detail["elementType"] == "global-seismic", "Expected global-seismic detail")
    item_names = [item["item"] for group in detail["checks"] for item in group["items"]]
    assert_true("抗震设计依据完整性" in item_names, f"Missing design-basis completeness check: {item_names}")
    assert_true("抗震等级结构化依据" in item_names, f"Missing seismic-grade design-basis check: {item_names}")
    assert_true("GB 18306标准状态" in item_names, f"Missing GB18306 standard-status check: {item_names}")
    assert_true("规则性评估与补充时程触发" in item_names, f"Missing regularity time-history trigger check: {item_names}")
    assert_true("多遇地震弹性层间位移角" in item_names, f"Missing drift check: {item_names}")
    assert_true("振型参与质量系数" in item_names, f"Missing modal participation check: {item_names}")
    assert_true("楼层最小地震剪力系数" in item_names, f"Missing story minimum seismic shear coefficient check: {item_names}")
    assert_true("补充时程分析完整性" in item_names, f"Missing required time-history completeness check: {item_names}")
    assert_true("单条时程基底剪力比例" in item_names, f"Missing each-record base-shear check: {item_names}")
    assert_true("平均时程基底剪力比例" in item_names, f"Missing average base-shear check: {item_names}")
    assert_true("实际强震记录比例" in item_names, f"Missing actual-record ratio check: {item_names}")
    assert_true("地震波组数规则" in item_names, f"Missing ground-motion record-count check: {item_names}")
    assert_true("时程组合规则" in item_names, f"Missing time-history combination-rule check: {item_names}")
    assert_true("时程方向级校核追踪" in item_names, f"Missing directional time-history trace check: {item_names}")
    assert_true("地震波调幅系数" in item_names, f"Missing ground-motion scale-factor check: {item_names}")
    assert_true("地震波反应谱适配" in item_names, f"Missing ground-motion spectrum compatibility check: {item_names}")
    assert_true("弹塑性时程最终符合性" in item_names, f"Missing elastic-plastic time-history final compliance check: {item_names}")
    assert_true("竖向地震作用标准值" in item_names, f"Missing vertical seismic action check: {item_names}")
    assert_true("竖向地震构件内力" in item_names, f"Missing vertical seismic member-force check: {item_names}")
    assert_true("竖向地震构件承载力" in item_names, f"Missing vertical seismic member-capacity check: {item_names}")
    assert_true("水平地震构件内力" in item_names, f"Missing horizontal seismic member-force check: {item_names}")
    assert_true("抗震基本作用组合" in item_names, f"Missing seismic basic action combination check: {item_names}")
    assert_true("抗震组合构件承载力抽查" in item_names, f"Missing seismic combination member-capacity screening: {item_names}")
    assert_true("Pushover弹塑性估算位移角" in item_names, f"Missing pushover nonlinear estimate check: {item_names}")
    assert_true("Pushover最终符合性" in item_names, f"Missing pushover final compliance check: {item_names}")
    drift_item = next(item for group in detail["checks"] for item in group["items"] if item["item"] == "多遇地震弹性层间位移角")
    assert_true(abs(drift_item["inputs"].get("limit", 0.0) - 1.0 / 550.0) < 1.0e-8, f"Missing concrete-frame drift limit: {drift_item}")
    gb18306_item = next(item for group in detail["checks"] for item in group["items"] if item["item"] == "GB 18306标准状态")
    assert_true(gb18306_item["status"] == "pass", f"Expected GB18306 standard-status pass: {gb18306_item}")
    assert_true(gb18306_item["inputs"].get("standardStatus") == "current", f"Missing GB18306 current status trace: {gb18306_item}")
    assert_true(gb18306_item["inputs"].get("effectiveAmendment", {}).get("effectiveDate") == "2026-02-27", f"Missing GB18306 effective amendment trace: {gb18306_item}")
    assert_true(gb18306_item["inputs"].get("revisionPlan", {}).get("planNo") == "20260055-Q-419", f"Missing GB18306 revision-plan trace: {gb18306_item}")
    seismic_grade_item = next(item for group in detail["checks"] for item in group["items"] if item["item"] == "抗震等级结构化依据")
    assert_true(seismic_grade_item["status"] == "pass", f"Expected seismic-grade design-basis pass: {seismic_grade_item}")
    assert_true(seismic_grade_item["inputs"].get("seismicGrade") == 2, f"Missing structured seismic grade trace: {seismic_grade_item}")
    assert_true(seismic_grade_item["inputs"].get("seismicGradeSource") == "designRequirements.seismicGrade", f"Missing seismic-grade source trace: {seismic_grade_item}")
    required_item = next(item for group in detail["checks"] for item in group["items"] if item["item"] == "补充时程分析完整性")
    assert_true(required_item["inputs"].get("missingCount") == 0, f"Missing ground-motion requirement trace input: {required_item}")
    regularity_item = next(item for group in detail["checks"] for item in group["items"] if item["item"] == "规则性评估与补充时程触发")
    assert_true(regularity_item["status"] == "pass", f"Expected regularity trigger pass: {regularity_item}")
    assert_true(regularity_item["inputs"].get("classification") == "particularly_irregular", f"Missing regularity classification trace: {regularity_item}")
    story_shear_item = next(item for group in detail["checks"] for item in group["items"] if item["item"] == "楼层最小地震剪力系数")
    assert_true(story_shear_item["status"] == "pass", f"Expected story minimum seismic shear check to pass: {story_shear_item}")
    combination_item = next(item for group in detail["checks"] for item in group["items"] if item["item"] == "时程组合规则")
    assert_true(combination_item["status"] == "pass", f"Expected time-history combination check to pass: {combination_item}")
    assert_true(combination_item["inputs"].get("expectedCombinedBaseShear") == 1000.0, f"Missing expected time-history combined base shear: {combination_item}")
    direction_trace_item = next(item for group in detail["checks"] for item in group["items"] if item["item"] == "时程方向级校核追踪")
    assert_true(direction_trace_item["status"] == "pass", f"Expected directional time-history trace pass: {direction_trace_item}")
    assert_true(direction_trace_item["inputs"].get("checkedDirectionCount") == 2, f"Missing directional time-history count: {direction_trace_item}")
    vertical_capacity_item = next(item for group in detail["checks"] for item in group["items"] if item["item"] == "竖向地震构件承载力")
    assert_true(vertical_capacity_item["inputs"].get("capacityMethod") == "provided_vertical_capacity_utilization", f"Missing structured vertical capacity method trace: {vertical_capacity_item}")
    assert_true(vertical_capacity_item["inputs"].get("capacitySource") == "verticalSeismicCapacity", f"Missing structured vertical capacity source trace: {vertical_capacity_item}")
    assert_true(story_shear_item["inputs"].get("baseLimit") == 0.044, f"Missing interpolated 5.2.5 base limit trace: {story_shear_item}")
    assert_true(story_shear_item["inputs"].get("controlling", {}).get("isWeakStory") is True, f"Missing weak-story amplification trace: {story_shear_item}")

    special_system_result = run_code_check(
        "seismic-code-check-special-system-demo",
        "GB50011",
        ["__global_seismic__"],
        {
            "analysisSummary": {
                "summary": {
                    "maxStoryDriftRatio": 0.0012,
                    "modalMassParticipationRatio": 0.92,
                },
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "isPreliminary": False,
                    "missingInputs": [],
                },
                "specialSystemReview": {
                    "reviewRequired": True,
                    "systems": ["isolation"],
                    "capabilityBoundaries": ["gb50011.isolationSystemSpecialSeismicAnalysis"],
                    "checks": [{
                        "item": "隔震层 SDOF 时程位移估算验收",
                        "status": "pass",
                        "utilization": 0.75,
                        "clause": "GB 55002-2021 + GB/T 50011-2010(2024)",
                        "formula": "SDOF time-history isolation-layer displacement demand / displacement capacity <= 1.0",
                        "inputs": {
                            "demand": 0.09,
                            "capacity": 0.12,
                            "source": "isolationLayerTimeHistoryEstimate.maxDisplacementM",
                            "unit": "m",
                        },
                    }],
                    "isolationLayerTimeHistoryEstimate": {
                        "status": "estimated",
                        "engineMode": "isolation_layer_sdof_time_history_estimate",
                        "periodSec": 2.4,
                        "recordCount": 3,
                        "controllingRecord": "ISO-TH-1",
                        "maxDisplacementM": 0.09,
                        "maxBaseShearKN": 135.0,
                        "displacementCapacityM": 0.12,
                        "displacementUtilization": 0.75,
                    },
                    "energyDissipationTimeHistoryEstimate": {
                        "status": "estimated",
                        "engineMode": "energy_dissipation_sdof_time_history_estimate",
                        "periodSec": 1.18,
                        "recordCount": 3,
                        "controllingRecord": "ED-TH-1",
                        "maxDeviceDeformationM": 0.031,
                        "maxDeviceForceKN": 820.0,
                        "deformationCapacityM": 0.06,
                        "deformationUtilization": 0.516667,
                        "forceCapacityKN": 1000.0,
                        "forceUtilization": 0.82,
                    },
                },
            },
        },
    )
    special_detail = special_system_result["details"][0]
    special_item = next(
        item for group in special_detail["checks"]
        for item in group["items"]
        if item["item"] == "隔震与消能减震专门体系审计"
    )
    assert_true(
        special_item["inputs"].get("isolationLayerTimeHistoryEstimate", {}).get("controllingRecord") == "ISO-TH-1",
        f"Missing isolation layer time-history trace in GB50011 code-check: {special_item}",
    )
    assert_true(
        special_item["inputs"].get("isolationLayerTimeHistoryEstimate", {}).get("maxDisplacementM") == 0.09,
        f"Missing isolation layer time-history displacement in GB50011 code-check: {special_item}",
    )
    special_checks = special_item["inputs"].get("checks", [])
    assert_true(special_checks and special_checks[0].get("item") == "隔震层 SDOF 时程位移估算验收", f"Missing special-system acceptance checks: {special_item}")
    assert_true(special_checks[0].get("inputs", {}).get("demand") == 0.09, f"Missing special-system acceptance demand trace: {special_item}")
    assert_true(special_checks[0].get("inputs", {}).get("capacity") == 0.12, f"Missing special-system acceptance capacity trace: {special_item}")
    assert_true(special_checks[0].get("inputs", {}).get("source") == "isolationLayerTimeHistoryEstimate.maxDisplacementM", f"Missing special-system acceptance source trace: {special_item}")
    assert_true(
        special_item["inputs"].get("energyDissipationTimeHistoryEstimate", {}).get("controllingRecord") == "ED-TH-1",
        f"Missing energy-dissipation time-history trace in GB50011 code-check: {special_item}",
    )
    assert_true(
        special_item["inputs"].get("energyDissipationTimeHistoryEstimate", {}).get("maxDeviceForceKN") == 820.0,
        f"Missing energy-dissipation time-history force in GB50011 code-check: {special_item}",
    )

    strong_column_result = run_code_check(
        "seismic-code-check-strong-column-weak-beam-demo",
        "GB50011",
        ["J1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                },
            },
            "elementData": {
                "J1": {
                    "type": "joint",
                    "material": {"category": "concrete", "grade": "C30"},
                    "jointCore": {
                        "shearDemandKN": 300.0,
                        "shearCapacityKN": 600.0,
                    },
                    "strongColumnWeakBeam": {
                        "directions": [
                            {
                                "direction": "clockwise",
                                "columnBeamMomentRatio": 1.62,
                                "requiredColumnBeamMomentRatio": 1.5,
                            },
                            {
                                "direction": "counterClockwise",
                                "columnBeamMomentRatio": 1.58,
                                "requiredColumnBeamMomentRatio": 1.5,
                            },
                        ],
                    },
                },
            },
        },
    )
    strong_column_item = next(
        item for group in strong_column_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架节点强柱弱梁弯矩关系"
    )
    assert_true(strong_column_item["status"] == "pass", f"Expected strong-column weak-beam check to pass: {strong_column_item}")
    assert_true(
        strong_column_item["inputs"].get("controlling", {}).get("requiredColumnBeamMomentRatio") == 1.5,
        f"Missing strong-column weak-beam required ratio trace: {strong_column_item}",
    )

    long_period_result = run_code_check(
        "seismic-code-check-long-period-demo",
        "GB50011",
        ["__global_seismic__"],
        {
            "analysisSummary": {
                "summary": {
                    "maxStoryDriftRatio": 0.0012,
                    "modalMassParticipationRatio": 0.92,
                },
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "isPreliminary": False,
                    "missingInputs": [],
                },
                "responseSpectrum": {
                    "periodRangeAssessment": {
                        "requiresSpecialStudy": True,
                        "maxModePeriodSec": 6.5,
                        "maxCodeSpectrumPeriodSec": 6.0,
                    },
                    "longPeriodSpecialStudyAdvisory": {
                        "status": "advisory_only",
                        "governingMode": {
                            "modeNumber": 1,
                            "period": 6.5,
                            "advisoryAlpha": 0.012,
                        },
                    },
                },
                "missingCapabilities": ["gb50011.responseSpectrumLongPeriodSpecialStudy"],
            },
        },
    )
    long_period_item = next(
        item for group in long_period_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "反应谱长周期专项研究"
    )
    assert_true(long_period_item["status"] == "fail", f"Expected long-period special-study item to fail: {long_period_item}")
    assert_true(long_period_item["inputs"].get("maxModePeriodSec") == 6.5, f"Missing long-period max mode period: {long_period_item}")
    assert_true(long_period_item["inputs"].get("governingMode", {}).get("modeNumber") == 1, f"Missing long-period governing mode trace: {long_period_item}")

    shear_wall_drift_result = run_code_check(
        "seismic-code-check-shear-wall-drift-demo",
        "GB50011",
        ["__global_seismic__"],
        {
            "analysisSummary": {
                "summary": {
                    "maxStoryDriftRatio": 0.0012,
                    "modalMassParticipationRatio": 0.92,
                },
                "designBasis": {
                    "structuralFamily": "concrete-shear-wall",
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
        },
    )
    shear_wall_drift_item = next(
        item for group in shear_wall_drift_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "多遇地震弹性层间位移角"
    )
    assert_true(shear_wall_drift_item["status"] == "fail", f"Expected shear-wall drift failure: {shear_wall_drift_item}")
    assert_true(abs(shear_wall_drift_item["inputs"].get("limit", 0.0) - 1.0 / 1000.0) < 1.0e-8, f"Missing shear-wall drift limit: {shear_wall_drift_item}")

    story_shear_failure_result = run_code_check(
        "seismic-code-check-story-min-shear-demo",
        "GB50011",
        ["__global_seismic__"],
        {
            "analysisSummary": {
                "analysisMode": "opensees_china_seismic_workflow",
                "summary": {
                    "maxStoryDriftRatio": 0.0012,
                    "modalMassParticipationRatio": 0.92,
                    "fundamentalPeriod": 4.0,
                },
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "intensity": 8,
                    "accelerationG": 0.30,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
                "responseSpectrum": {
                    "floorResponses": [
                        {
                            "story": "F1",
                            "direction": "x",
                            "shearWeightRatio": 0.040,
                            "isWeakStory": True,
                        },
                    ],
                },
            },
        },
    )
    assert_true(story_shear_failure_result["summary"]["failed"] >= 1, f"Expected story minimum shear failure: {story_shear_failure_result['summary']}")
    story_shear_failure_item = next(
        item
        for group in story_shear_failure_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "楼层最小地震剪力系数"
    )
    assert_true(story_shear_failure_item["status"] == "fail", f"Expected story minimum shear item to fail: {story_shear_failure_item}")
    assert_true(story_shear_failure_item["inputs"].get("controlling", {}).get("limit") == 0.0506, f"Missing weak-story 1.15 limit trace: {story_shear_failure_item}")

    invalid_count_result = run_code_check(
        "seismic-code-check-invalid-wave-count-demo",
        "GB50011",
        ["__global_seismic__"],
        {
            "analysisSummary": {
                "analysisMode": "opensees_china_seismic_workflow",
                "summary": {
                    "maxStoryDriftRatio": 0.0012,
                    "modalMassParticipationRatio": 0.92,
                },
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "isPreliminary": False,
                    "missingInputs": [],
                },
                "methodDecision": {
                    "selectedMethods": ["response_spectrum", "time_history"],
                    "requiresTimeHistory": True,
                    "requiredGroundMotionCount": 3,
                },
                "groundMotionRequirement": {
                    "required": True,
                    "requiredCount": 3,
                    "providedCount": 5,
                    "missingCount": 0,
                    "status": "satisfied",
                },
                "timeHistory": {
                    "records": [
                        {"baseShearRatioToResponseSpectrum": 0.82},
                        {"baseShearRatioToResponseSpectrum": 0.84},
                        {"baseShearRatioToResponseSpectrum": 0.86},
                        {"baseShearRatioToResponseSpectrum": 0.88},
                        {"baseShearRatioToResponseSpectrum": 0.90},
                    ],
                    "averageBaseShear": 860.0,
                    "baseShearCheck": {"responseSpectrumBaseShear": 1000.0},
                    "spectrumMatch": {
                        "maxScaleFactor": 1.2,
                        "scaleFactorLimit": 10.0,
                    },
                    "groundMotionSetChecks": {
                        "recordCount": 5,
                        "actualRecordCount": 4,
                        "requiredActualRecordCount": 4,
                    },
                },
            },
        },
    )
    assert_true(invalid_count_result["summary"]["failed"] == 0, f"Invalid wave count should be classified as input-required, not a demand/capacity failure: {invalid_count_result['summary']}")
    assert_true(invalid_count_result["summary"]["notApplicable"] >= 1, f"Expected invalid wave count to require input attention: {invalid_count_result['summary']}")
    invalid_count_item = next(
        item
        for group in invalid_count_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "地震波组数规则"
    )
    assert_true(invalid_count_item["status"] == "fail", f"Expected invalid wave count check to fail: {invalid_count_item}")

    directional_missing_result = run_code_check(
        "seismic-code-check-directional-missing-demo",
        "GB50011",
        ["__global_seismic__"],
        {
            "analysisSummary": {
                "analysisMode": "opensees_china_seismic_workflow",
                "summary": {
                    "maxStoryDriftRatio": 0.0012,
                    "modalMassParticipationRatio": 0.92,
                },
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "isPreliminary": False,
                    "missingInputs": [],
                },
                "methodDecision": {
                    "selectedMethods": ["response_spectrum", "time_history"],
                    "requiresTimeHistory": True,
                    "requiredGroundMotionCount": 3,
                },
                "groundMotionRequirement": {
                    "required": True,
                    "requiredCount": 3,
                    "totalRequiredCount": 6,
                    "providedCount": 3,
                    "missingCount": 3,
                    "status": "missing",
                    "directionRequirements": [
                        {"direction": "x", "requiredCount": 3, "providedCount": 3, "missingCount": 0},
                        {"direction": "y", "requiredCount": 3, "providedCount": 0, "missingCount": 3},
                    ],
                },
                "timeHistory": {
                    "records": [
                        {"baseShearRatioToResponseSpectrum": 0.82},
                        {"baseShearRatioToResponseSpectrum": 0.84},
                        {"baseShearRatioToResponseSpectrum": 0.86},
                    ],
                    "averageBaseShear": 840.0,
                    "baseShearCheck": {"responseSpectrumBaseShear": 1000.0},
                    "spectrumMatch": {
                        "maxScaleFactor": 1.2,
                        "scaleFactorLimit": 10.0,
                    },
                    "groundMotionSetChecks": {
                        "recordCount": 3,
                        "actualRecordCount": 2,
                        "requiredActualRecordCount": 2,
                    },
                },
            },
        },
    )
    assert_true(directional_missing_result["summary"]["failed"] == 0, f"Directional missing waves should be classified as input-required, not a demand/capacity failure: {directional_missing_result['summary']}")
    assert_true(directional_missing_result["summary"]["notApplicable"] >= 1, f"Expected directional missing waves to require input attention: {directional_missing_result['summary']}")
    directional_missing_item = next(
        item
        for group in directional_missing_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "补充时程分析完整性"
    )
    assert_true(directional_missing_item["status"] == "fail", f"Expected directional time-history completeness failure: {directional_missing_item}")
    assert_true(directional_missing_item["inputs"].get("capacity") == 6, f"Missing total required count trace: {directional_missing_item}")

    unsupported_result = run_code_check(
        "seismic-code-check-capability-boundary-demo",
        "GB50011",
        ["__global_seismic__"],
        {
            "analysisSummary": {
                "analysisMode": "opensees_china_seismic_workflow",
                "summary": {
                    "maxStoryDriftRatio": 0.0012,
                    "modalMassParticipationRatio": 0.92,
                },
                "designBasis": {
                    "structuralFamily": "bridge",
                    "isPreliminary": False,
                    "missingInputs": [],
                },
                "missingCapabilities": [
                    "gb50011.elasticDriftLimitForStructuralFamily",
                ],
                "capabilityAssessment": {
                    "structuralFamily": "bridge",
                    "finalComplianceSupported": False,
                },
            },
        },
    )
    assert_true(unsupported_result["status"] == "success", f"Unexpected capability-boundary result status: {unsupported_result['status']}")
    assert_true(unsupported_result["summary"]["failed"] >= 1, f"Expected unsupported seismic check to fail: {unsupported_result['summary']}")
    unsupported_detail = unsupported_result["details"][0]
    capability_item = next(
        item
        for group in unsupported_detail["checks"]
        for item in group["items"]
        if item["item"] == "抗震能力边界"
    )
    assert_true(capability_item["status"] == "fail", f"Expected capability-boundary failure: {capability_item}")
    assert_true(
        "gb50011.elasticDriftLimitForStructuralFamily" in capability_item["inputs"].get("missingCapabilities", []),
        f"Missing capability trace input: {capability_item}",
    )

    axial_ratio_result = run_code_check(
        "seismic-code-check-column-axial-ratio-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "analysisMode": "opensees_china_seismic_workflow",
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
                "memberDesignActionCombinations": {
                    "status": "computed",
                    "memberCount": 1,
                    "caseCount": 1,
                    "cases": [
                        {
                            "name": "gravity_plus_horizontal_seismic",
                            "memberActions": [
                                {
                                    "elementId": "C1",
                                    "maxAbsAxialKN": 2000.0,
                                    "maxAbsMomentKNm": 12.0,
                                },
                            ],
                        },
                    ],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "section": {"A": 250000.0},
                    "material": {"category": "concrete", "fc": 14.3},
                },
            },
        },
    )
    axial_detail = axial_ratio_result["details"][0]
    axial_item = next(
        item
        for group in axial_detail["checks"]
        for item in group["items"]
        if item["item"] == "框架柱轴压比限值"
    )
    assert_true(axial_item["status"] == "pass", f"Expected frame-column axial-ratio check to pass: {axial_item}")
    assert_true(axial_item["inputs"].get("seismicGrade") == 2, f"Missing seismic grade trace: {axial_item}")
    assert_true(abs(float(axial_item["inputs"].get("limit", 0.0)) - 0.75) < 1e-9, f"Unexpected axial-ratio limit: {axial_item}")

    shear_span_result = run_code_check(
        "seismic-code-check-column-shear-span-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
                "memberDesignActionCombinations": {
                    "status": "computed",
                    "cases": [
                        {
                            "name": "gravity_plus_horizontal_seismic",
                            "memberActions": [
                                {
                                    "elementId": "C1",
                                    "maxAbsAxialKN": 1000.0,
                                },
                            ],
                        },
                    ],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "shearSpanRatio": 1.4,
                    "section": {"A": 250000.0},
                    "material": {"category": "concrete", "fc": 14.3},
                },
            },
        },
    )
    shear_span_item = next(
        item
        for group in shear_span_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架柱剪跨比专项要求"
    )
    adjusted_axial_item = next(
        item
        for group in shear_span_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架柱轴压比限值"
    )
    assert_true(shear_span_result["summary"]["failed"] >= 1, f"Expected shear-span special-requirement failure: {shear_span_result['summary']}")
    assert_true(shear_span_item["status"] == "fail", f"Expected shear-span item to fail: {shear_span_item}")
    assert_true(shear_span_item["inputs"].get("requiresSpecialStudy") is True, f"Missing special-study trace: {shear_span_item}")
    assert_true(adjusted_axial_item["status"] == "pass", f"Expected adjusted axial-ratio item to pass: {adjusted_axial_item}")
    assert_true(abs(float(adjusted_axial_item["inputs"].get("limit", 0.0)) - 0.70) < 1e-9, f"Missing short-column axial-ratio reduction: {adjusted_axial_item}")

    column_longitudinal_result = run_code_check(
        "seismic-code-check-column-longitudinal-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "section": {"A": 250000.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "longitudinal": {
                            "areaMm2": 1600.0,
                            "sideMinAreaMm2": 400.0,
                            "grade": "HRB400",
                        },
                    },
                },
            },
        },
    )
    column_longitudinal_item = next(
        item
        for group in column_longitudinal_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架柱纵筋构造"
    )
    column_longitudinal_subchecks = {
        item["name"]: item["status"]
        for item in column_longitudinal_item["inputs"].get("subchecks", [])
    }
    assert_true(column_longitudinal_result["summary"]["failed"] >= 1, f"Expected column longitudinal failure: {column_longitudinal_result['summary']}")
    assert_true(column_longitudinal_item["status"] == "fail", f"Expected column longitudinal item to fail: {column_longitudinal_item}")
    assert_true(column_longitudinal_subchecks.get("column_total_longitudinal_ratio") == "fail", f"Missing total longitudinal failure trace: {column_longitudinal_item}")
    assert_true(column_longitudinal_subchecks.get("column_each_side_longitudinal_ratio") == "fail", f"Missing side longitudinal failure trace: {column_longitudinal_item}")

    column_longitudinal_detailing_result = run_code_check(
        "seismic-code-check-column-longitudinal-detailing-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 1,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "shearSpanRatio": 2.0,
                    "section": {"width": 500.0, "height": 500.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "longitudinal": {
                            "ratioPercent": 6.0,
                            "sideMinRatioPercent": 1.5,
                            "spacingMm": 250.0,
                            "isSymmetric": False,
                            "areaMm2": 2200.0,
                            "smallEccentricTension": True,
                            "calculatedAreaMm2": 2000.0,
                        },
                    },
                },
            },
        },
    )
    column_longitudinal_detailing_item = next(
        item
        for group in column_longitudinal_detailing_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架柱纵筋补充构造"
    )
    column_longitudinal_detailing_subchecks = {
        item["name"]: item["status"]
        for item in column_longitudinal_detailing_item["inputs"].get("subchecks", [])
    }
    assert_true(column_longitudinal_detailing_result["summary"]["failed"] >= 1, f"Expected column longitudinal-detailing failure: {column_longitudinal_detailing_result['summary']}")
    assert_true(column_longitudinal_detailing_item["status"] == "fail", f"Expected column longitudinal-detailing item to fail: {column_longitudinal_detailing_item}")
    assert_true(column_longitudinal_detailing_subchecks.get("column_longitudinal_symmetric_configuration") == "fail", f"Missing column symmetry failure trace: {column_longitudinal_detailing_item}")
    assert_true(column_longitudinal_detailing_subchecks.get("column_longitudinal_spacing") == "fail", f"Missing column longitudinal spacing failure trace: {column_longitudinal_detailing_item}")
    assert_true(column_longitudinal_detailing_subchecks.get("column_total_longitudinal_ratio_max") == "fail", f"Missing column total max-ratio failure trace: {column_longitudinal_detailing_item}")
    assert_true(column_longitudinal_detailing_subchecks.get("column_grade_one_short_column_side_ratio_max") == "fail", f"Missing column short-column side max-ratio failure trace: {column_longitudinal_detailing_item}")
    assert_true(column_longitudinal_detailing_subchecks.get("column_small_eccentric_tension_area_increase") == "fail", f"Missing column small-eccentric area increase failure trace: {column_longitudinal_detailing_item}")

    column_stirrup_result = run_code_check(
        "seismic-code-check-column-stirrup-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "section": {"A": 250000.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "longitudinal": {"minDiameterMm": 16.0},
                        "stirrup": {"diameterMm": 6.0, "spacingMm": 150.0},
                    },
                },
            },
        },
    )
    column_stirrup_item = next(
        item
        for group in column_stirrup_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架柱箍筋加密区构造"
    )
    column_stirrup_subchecks = {
        item["name"]: item["status"]
        for item in column_stirrup_item["inputs"].get("subchecks", [])
    }
    assert_true(column_stirrup_result["summary"]["failed"] >= 1, f"Expected column stirrup failure: {column_stirrup_result['summary']}")
    assert_true(column_stirrup_item["status"] == "fail", f"Expected column stirrup item to fail: {column_stirrup_item}")
    assert_true(column_stirrup_subchecks.get("column_confined_stirrup_spacing") == "fail", f"Missing stirrup spacing failure trace: {column_stirrup_item}")
    assert_true(column_stirrup_subchecks.get("column_confined_stirrup_diameter") == "fail", f"Missing stirrup diameter failure trace: {column_stirrup_item}")

    column_confined_zone_result = run_code_check(
        "seismic-code-check-column-confined-zone-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "shearSpanRatio": 2.0,
                    "clearHeightMm": 3000.0,
                    "section": {"width": 500.0, "height": 500.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "stirrup": {"confinedLengthMm": 1200.0},
                    },
                },
            },
        },
    )
    column_confined_zone_item = next(
        item
        for group in column_confined_zone_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架柱箍筋加密区范围"
    )
    column_confined_zone_subchecks = {
        item["name"]: item["status"]
        for item in column_confined_zone_item["inputs"].get("subchecks", [])
    }
    assert_true(column_confined_zone_result["summary"]["failed"] >= 1, f"Expected column confined-zone failure: {column_confined_zone_result['summary']}")
    assert_true(column_confined_zone_item["status"] == "fail", f"Expected column confined-zone item to fail: {column_confined_zone_item}")
    assert_true(column_confined_zone_subchecks.get("column_confined_zone_full_height") == "fail", f"Missing column full-height confinement failure trace: {column_confined_zone_item}")
    assert_true(column_confined_zone_item["inputs"].get("shearSpanRatio") == 2.0, f"Missing column shear-span trace: {column_confined_zone_item}")

    column_volume_ratio_result = run_code_check(
        "seismic-code-check-column-volume-ratio-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "section": {"width": 500.0, "height": 500.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "longitudinal": {"minDiameterMm": 16.0},
                        "stirrup": {
                            "volumeRatioPercent": 0.45,
                            "nonConfinedVolumeRatioPercent": 0.10,
                            "nonConfinedSpacingMm": 220.0,
                            "axialCompressionRatio": 0.8,
                            "fyvMPa": 360.0,
                        },
                    },
                },
            },
        },
    )
    column_volume_ratio_item = next(
        item
        for group in column_volume_ratio_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架柱箍筋体积配箍率"
    )
    column_volume_ratio_subchecks = {
        item["name"]: item["status"]
        for item in column_volume_ratio_item["inputs"].get("subchecks", [])
    }
    assert_true(column_volume_ratio_result["summary"]["failed"] >= 1, f"Expected column volume-ratio failure: {column_volume_ratio_result['summary']}")
    assert_true(column_volume_ratio_item["status"] == "fail", f"Expected column volume-ratio item to fail: {column_volume_ratio_item}")
    assert_true(column_volume_ratio_subchecks.get("column_confined_stirrup_volume_ratio_minimum") == "fail", f"Missing column volume-ratio minimum failure trace: {column_volume_ratio_item}")
    assert_true(column_volume_ratio_subchecks.get("column_confined_stirrup_volume_ratio_formula") == "fail", f"Missing column volume-ratio formula failure trace: {column_volume_ratio_item}")
    assert_true(column_volume_ratio_subchecks.get("column_non_confined_stirrup_volume_ratio") == "fail", f"Missing column non-confined volume-ratio failure trace: {column_volume_ratio_item}")
    assert_true(column_volume_ratio_subchecks.get("column_non_confined_stirrup_spacing") == "fail", f"Missing column non-confined spacing failure trace: {column_volume_ratio_item}")

    joint_core_result = run_code_check(
        "seismic-code-check-joint-core-demo",
        "GB50011",
        ["J1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "J1": {
                    "type": "joint",
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "jointCore": {
                            "spacingMm": 140.0,
                            "diameterMm": 6.0,
                            "longitudinalMinDiameterMm": 16.0,
                            "characteristicValue": 0.08,
                            "volumeRatioPercent": 0.45,
                            "shearSpanRatio": 2.0,
                            "adjacentColumnEndMaxVolumeRatioPercent": 0.8,
                        },
                    },
                },
            },
        },
    )
    joint_core_item = next(
        item
        for group in joint_core_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架节点核芯区箍筋构造"
    )
    joint_core_subchecks = {
        item["name"]: item["status"]
        for item in joint_core_item["inputs"].get("subchecks", [])
    }
    assert_true(joint_core_result["summary"]["failed"] >= 1, f"Expected joint-core stirrup failure: {joint_core_result['summary']}")
    assert_true(joint_core_item["status"] == "fail", f"Expected joint-core stirrup item to fail: {joint_core_item}")
    assert_true(joint_core_subchecks.get("joint_core_stirrup_spacing") == "fail", f"Missing joint-core spacing failure trace: {joint_core_item}")
    assert_true(joint_core_subchecks.get("joint_core_stirrup_diameter") == "fail", f"Missing joint-core diameter failure trace: {joint_core_item}")
    assert_true(joint_core_subchecks.get("joint_core_stirrup_characteristic_value") == "fail", f"Missing joint-core characteristic failure trace: {joint_core_item}")
    assert_true(joint_core_subchecks.get("joint_core_stirrup_volume_ratio") == "fail", f"Missing joint-core volume-ratio failure trace: {joint_core_item}")
    assert_true(joint_core_subchecks.get("joint_core_short_column_volume_ratio") == "fail", f"Missing short-column joint-core volume-ratio failure trace: {joint_core_item}")

    joint_core_capacity_result = run_code_check(
        "seismic-code-check-joint-core-capacity-demo",
        "GB50011",
        ["J1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "J1": {
                    "type": "joint",
                    "material": {"category": "concrete", "grade": "C30"},
                    "jointCore": {
                        "shearDemandKN": 900.0,
                        "shearCapacityKN": 600.0,
                    },
                },
            },
        },
    )
    joint_core_capacity_item = next(
        item
        for group in joint_core_capacity_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架节点核芯区截面抗震验算"
    )
    assert_true(joint_core_capacity_result["summary"]["failed"] >= 1, f"Expected joint-core capacity failure: {joint_core_capacity_result['summary']}")
    assert_true(joint_core_capacity_item["status"] == "fail", f"Expected joint-core capacity item to fail: {joint_core_capacity_item}")
    assert_true(joint_core_capacity_item["inputs"].get("shearDemandKN") == 900.0, f"Missing joint-core shear demand trace: {joint_core_capacity_item}")
    assert_true(joint_core_capacity_item["inputs"].get("shearCapacityKN") == 600.0, f"Missing joint-core shear capacity trace: {joint_core_capacity_item}")

    structured_member_capacity_result = run_code_check(
        "seismic-code-check-structured-member-capacity-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "memberDesignActionCombinations": {
                    "status": "computed",
                    "cases": [
                        {
                            "name": "gravity_plus_horizontal_seismic",
                            "memberActions": [
                                {
                                    "elementId": "C1",
                                    "maxAbsShearKN": 40.0,
                                },
                            ],
                        },
                    ],
                },
            },
            "elementData": {
                "C1": {
                    "type": "beam",
                    "capacityChecks": [
                        {"shear": {"capacityKN": 25.0, "gammaRE": 0.85}},
                    ],
                },
            },
        },
    )
    structured_member_capacity_item = next(
        item
        for group in structured_member_capacity_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "抗震组合构件承载力"
    )
    assert_true(structured_member_capacity_result["summary"]["failed"] >= 1, f"Expected structured member capacity failure: {structured_member_capacity_result['summary']}")
    assert_true(structured_member_capacity_item["status"] == "fail", f"Expected structured member capacity item to fail: {structured_member_capacity_item}")
    assert_true(structured_member_capacity_item["inputs"].get("controlling", {}).get("name") == "member_shear_capacity", f"Missing controlling shear capacity trace: {structured_member_capacity_item}")
    assert_true(structured_member_capacity_item["inputs"].get("controlling", {}).get("capacity") == 25.0, f"Missing structured shear capacity trace: {structured_member_capacity_item}")
    assert_true(structured_member_capacity_item["inputs"].get("controlling", {}).get("gammaRE") == 0.85, f"Missing gammaRE trace: {structured_member_capacity_item}")
    assert_true(structured_member_capacity_item["inputs"].get("controlling", {}).get("gammaRESource") == "element.capacityChecks[1].shear.gammaRE", f"Missing gammaRE source trace: {structured_member_capacity_item}")

    steel_detailing_result = run_code_check(
        "seismic-code-check-steel-detailing-demo",
        "GB50011",
        ["SB1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "steel-frame",
                    "seismicGrade": 1,
                },
            },
            "elementData": {
                "SB1": {
                    "type": "steel-brace",
                    "material": {"category": "steel", "grade": "Q355"},
                    "steelSeismicDetailing": {
                        "braceSlendernessRatio": 130.0,
                        "braceSlendernessLimit": 120.0,
                    },
                    "widthThickness": {
                        "plateWidthThicknessRatio": 15.0,
                        "plateWidthThicknessLimit": 12.0,
                    },
                },
            },
        },
    )
    steel_detailing_item = next(
        item
        for group in steel_detailing_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "钢构件抗震构造限值"
    )
    steel_detailing_subchecks = {
        item["name"]: item["status"]
        for item in steel_detailing_item["inputs"].get("subchecks", [])
    }
    assert_true(steel_detailing_result["summary"]["failed"] >= 1, f"Expected steel detailing failure: {steel_detailing_result['summary']}")
    assert_true(steel_detailing_item["status"] == "fail", f"Expected steel detailing item to fail: {steel_detailing_item}")
    assert_true(steel_detailing_subchecks.get("brace_slenderness_ratio") == "fail", f"Missing brace slenderness failure trace: {steel_detailing_item}")
    assert_true(steel_detailing_subchecks.get("plate_width_thickness_ratio") == "fail", f"Missing plate width-thickness failure trace: {steel_detailing_item}")
    assert_true(steel_detailing_item["inputs"].get("controlling", {}).get("name") == "plate_width_thickness_ratio", f"Missing steel detailing controlling trace: {steel_detailing_item}")
    assert_true(steel_detailing_item["inputs"].get("controlling", {}).get("utilization") == 1.25, f"Missing steel detailing utilization trace: {steel_detailing_item}")

    strong_shear_result = run_code_check(
        "seismic-code-check-strong-shear-weak-bending-demo",
        "GB50011",
        ["B1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                },
            },
            "elementData": {
                "B1": {
                    "type": "beam",
                    "material": {"category": "concrete", "grade": "C30"},
                    "strongShearWeakBending": {
                        "cases": [
                            {
                                "name": "left-end",
                                "bendingControlledShearDemandKN": 520.0,
                                "shearCapacityKN": 650.0,
                            },
                            {
                                "name": "right-end",
                                "bendingControlledShearDemandKN": 500.0,
                                "shearCapacityKN": 640.0,
                            },
                        ],
                    },
                },
            },
        },
    )
    strong_shear_item = next(
        item
        for group in strong_shear_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架构件强剪弱弯受剪承载力"
    )
    assert_true(strong_shear_item["status"] == "pass", f"Expected strong-shear weak-bending check to pass: {strong_shear_item}")
    assert_true(
        strong_shear_item["inputs"].get("controlling", {}).get("name") == "left-end",
        f"Missing strong-shear weak-bending controlling case trace: {strong_shear_item}",
    )
    assert_true(
        strong_shear_item["inputs"].get("controlling", {}).get("bendingControlledShearDemandKN") == 520.0,
        f"Missing strong-shear weak-bending demand trace: {strong_shear_item}",
    )
    assert_true(
        strong_shear_item["inputs"].get("controlling", {}).get("shearCapacityKN") == 650.0,
        f"Missing strong-shear weak-bending capacity trace: {strong_shear_item}",
    )

    shear_compression_result = run_code_check(
        "seismic-code-check-shear-compression-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 1,
                },
                "memberDesignActionCombinations": {
                    "cases": [
                        {
                            "name": "gravity_plus_horizontal_seismic",
                            "memberActions": [
                                {
                                    "elementId": "C1",
                                    "maxAbsShearKN": 650.0,
                                },
                            ],
                        },
                    ],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "material": {"category": "concrete", "fc": 14.3},
                    "section": {
                        "width": 500.0,
                        "effectiveDepth": 450.0,
                    },
                    "shearSpanRatio": 1.8,
                },
            },
        },
    )
    shear_compression_item = next(
        item
        for group in shear_compression_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "混凝土构件剪压比限值"
    )
    assert_true(shear_compression_result["summary"]["failed"] >= 1, f"Expected shear-compression failure: {shear_compression_result['summary']}")
    assert_true(shear_compression_item["status"] == "fail", f"Expected shear-compression item to fail: {shear_compression_item}")
    assert_true(shear_compression_item["inputs"].get("coefficient") == 0.15, f"Missing shear-compression short-member coefficient: {shear_compression_item}")
    assert_true(shear_compression_item["inputs"].get("shearSpanRatio") == 1.8, f"Missing shear-compression shear-span trace: {shear_compression_item}")

    material_grade_result = run_code_check(
        "seismic-code-check-concrete-grade-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "analysisMode": "opensees_china_seismic_workflow",
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "section": {"A": 250000.0},
                    "material": {"category": "concrete", "grade": "C25"},
                },
            },
        },
    )
    material_grade_item = next(
        item
        for group in material_grade_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架梁柱混凝土强度等级"
    )
    assert_true(material_grade_result["summary"]["failed"] >= 1, f"Expected concrete strength-grade failure: {material_grade_result['summary']}")
    assert_true(material_grade_item["status"] == "fail", f"Expected concrete strength-grade item to fail: {material_grade_item}")
    assert_true(material_grade_item["inputs"].get("actual") == "C25", f"Missing concrete grade trace: {material_grade_item}")

    shear_wall_result = run_code_check(
        "seismic-code-check-shear-wall-demo",
        "GB50011",
        ["W1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-shear-wall",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "W1": {
                    "type": "shear-wall",
                    "storyHeightMm": 3600.0,
                    "section": {"thickness": 150.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "wall": {
                            "isBottomStrengthenedZone": True,
                            "hasEndColumn": False,
                            "isPartialFrameSupportedBottomStrengthenedZone": True,
                            "doubleLayer": False,
                            "tie": {"diameterMm": 5.0, "spacingMm": 700.0},
                            "verticalDistributed": {"ratioPercent": 0.20, "spacingMm": 250.0, "diameterMm": 6.0},
                            "horizontalDistributed": {"ratioPercent": 0.25, "spacingMm": 220.0, "diameterMm": 8.0},
                            "boundaryElement": {
                                "id": "right-edge",
                                "longitudinal": {"ratioPercent": 0.8, "diameterMm": 12.0},
                                "minLongitudinalRatioPercent": 1.0,
                                "minLongitudinalDiameterMm": 14.0,
                                "hoop": {
                                    "diameterMm": 6.0,
                                    "spacingMm": 180.0,
                                    "volumetricRatioPercent": 0.7,
                                },
                                "maxHoopSpacingMm": 120.0,
                                "minHoopDiameterMm": 8.0,
                                "minVolumetricRatioPercent": 1.0,
                            },
                        },
                    },
                },
            },
        },
    )
    shear_wall_thickness_item = next(
        item
        for group in shear_wall_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "抗震墙墙厚"
    )
    shear_wall_reinforcement_item = next(
        item
        for group in shear_wall_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "抗震墙分布钢筋构造"
    )
    shear_wall_boundary_item = next(
        item
        for group in shear_wall_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "抗震墙边缘构件构造"
    )
    shear_wall_subchecks = {
        item["name"]: item["status"]
        for item in shear_wall_reinforcement_item["inputs"].get("subchecks", [])
    }
    shear_wall_boundary_subchecks = {
        item["name"]: item["status"]
        for item in shear_wall_boundary_item["inputs"].get("subchecks", [])
    }
    assert_true(shear_wall_result["summary"]["failed"] >= 1, f"Expected shear-wall detailing failure: {shear_wall_result['summary']}")
    assert_true(shear_wall_thickness_item["status"] == "fail", f"Expected shear-wall thickness failure: {shear_wall_thickness_item}")
    assert_true(shear_wall_reinforcement_item["status"] == "fail", f"Expected shear-wall reinforcement failure: {shear_wall_reinforcement_item}")
    assert_true(shear_wall_boundary_item["status"] == "fail", f"Expected shear-wall boundary-element failure: {shear_wall_boundary_item}")
    assert_true(shear_wall_reinforcement_item["inputs"].get("ratioLimitPercent") == 0.30, f"Missing shear-wall ratio limit trace: {shear_wall_reinforcement_item}")
    assert_true(shear_wall_subchecks.get("wall_vertical_distributed_reinforcement_ratio") == "fail", f"Missing shear-wall vertical ratio failure trace: {shear_wall_reinforcement_item}")
    assert_true(shear_wall_boundary_subchecks.get("wall_boundary_longitudinal_reinforcement_ratio") == "fail", f"Missing shear-wall boundary longitudinal ratio failure trace: {shear_wall_boundary_item}")
    assert_true(shear_wall_boundary_subchecks.get("wall_boundary_transverse_spacing") == "fail", f"Missing shear-wall boundary transverse spacing failure trace: {shear_wall_boundary_item}")

    shear_wall_axial_result = run_code_check(
        "seismic-code-check-shear-wall-axial-demo",
        "GB50011",
        ["W1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-shear-wall",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
                "memberDesignActionCombinations": {
                    "cases": [{
                        "name": "gravity_plus_horizontal_seismic",
                        "memberActions": [{
                            "elementId": "W1",
                            "maxAbsAxialKN": 3000.0,
                        }],
                    }],
                },
            },
            "elementData": {
                "W1": {
                    "type": "shear-wall",
                    "section": {"thickness": 200.0},
                    "material": {"category": "concrete", "fc": 14.3},
                    "reinforcement": {
                        "wall": {
                            "wallLengthMm": 3000.0,
                            "axialCompressionRatioLimit": 0.45,
                        },
                    },
                },
            },
        },
    )
    shear_wall_axial_item = next(
        item
        for group in shear_wall_axial_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "抗震墙轴压比限值"
    )
    assert_true(shear_wall_axial_item["status"] == "pass", f"Expected shear-wall axial ratio pass: {shear_wall_axial_item}")
    assert_true(shear_wall_axial_item["inputs"].get("ratioSource") == "memberDesignActionCombinations/section/material", f"Missing shear-wall axial ratio source: {shear_wall_axial_item}")
    assert_true(shear_wall_axial_item["inputs"].get("limit") == 0.45, f"Missing shear-wall axial ratio limit trace: {shear_wall_axial_item}")

    beam_geometry_result = run_code_check(
        "seismic-code-check-beam-geometry-demo",
        "GB50011",
        ["B1"],
        {
            "elementData": {
                "B1": {
                    "type": "beam",
                    "length": 3200.0,
                    "section": {"width": 180.0, "height": 900.0},
                    "material": {"category": "concrete", "grade": "C30"},
                },
            },
        },
    )
    beam_geometry_item = next(
        item
        for group in beam_geometry_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架梁截面尺寸"
    )
    subcheck_statuses = {
        item["name"]: item["status"]
        for item in beam_geometry_item["inputs"].get("subchecks", [])
    }
    assert_true(beam_geometry_result["summary"]["failed"] >= 1, f"Expected beam geometry failure: {beam_geometry_result['summary']}")
    assert_true(beam_geometry_item["status"] == "fail", f"Expected beam geometry item to fail: {beam_geometry_item}")
    assert_true(subcheck_statuses.get("beam_width") == "fail", f"Missing beam-width failure trace: {beam_geometry_item}")
    assert_true(subcheck_statuses.get("beam_depth_width_ratio") == "fail", f"Missing depth-width failure trace: {beam_geometry_item}")
    assert_true(subcheck_statuses.get("beam_clear_span_depth_ratio") == "fail", f"Missing span-depth failure trace: {beam_geometry_item}")

    beam_flat_result = run_code_check(
        "seismic-code-check-beam-flat-demo",
        "GB50011",
        ["B1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 1,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "B1": {
                    "type": "beam",
                    "section": {"width": 950.0, "height": 300.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "flatBeam": {
                            "isFlatBeam": True,
                            "columnWidthMm": 400.0,
                            "columnLongitudinalDiameterMm": 25.0,
                            "castInPlaceFloor": False,
                            "centerlineAligned": False,
                            "bidirectional": False,
                        },
                    },
                },
            },
        },
    )
    beam_flat_item = next(
        item
        for group in beam_flat_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架扁梁构造"
    )
    beam_flat_subchecks = {
        item["name"]: item["status"]
        for item in beam_flat_item["inputs"].get("subchecks", [])
    }
    assert_true(beam_flat_result["summary"]["failed"] >= 1, f"Expected flat-beam failure: {beam_flat_result['summary']}")
    assert_true(beam_flat_item["status"] == "fail", f"Expected flat-beam item to fail: {beam_flat_item}")
    assert_true(beam_flat_subchecks.get("flat_beam_width_2bc") == "fail", f"Missing flat-beam 2bc failure trace: {beam_flat_item}")
    assert_true(beam_flat_subchecks.get("flat_beam_width_bc_plus_hb") == "fail", f"Missing flat-beam bc+hb failure trace: {beam_flat_item}")
    assert_true(beam_flat_subchecks.get("flat_beam_depth_column_bar") == "fail", f"Missing flat-beam depth failure trace: {beam_flat_item}")
    assert_true(beam_flat_subchecks.get("flat_beam_grade_one_restriction") == "fail", f"Missing flat-beam grade failure trace: {beam_flat_item}")
    assert_true(beam_flat_subchecks.get("flat_beam_cast_in_place_floor") == "fail", f"Missing flat-beam cast-in-place failure trace: {beam_flat_item}")
    assert_true(beam_flat_subchecks.get("flat_beam_centerline_alignment") == "fail", f"Missing flat-beam centerline failure trace: {beam_flat_item}")
    assert_true(beam_flat_subchecks.get("flat_beam_bidirectional_arrangement") == "fail", f"Missing flat-beam bidirectional failure trace: {beam_flat_item}")

    beam_reinforcement_result = run_code_check(
        "seismic-code-check-beam-reinforcement-demo",
        "GB50011",
        ["B1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "B1": {
                    "type": "beam",
                    "section": {"width": 250.0, "height": 600.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "topContinuous": {"count": 1, "diameterMm": 12.0, "areaMm2": 150.0},
                        "bottomContinuous": {"count": 2, "diameterMm": 14.0, "areaMm2": 500.0},
                        "topEndMaxAreaMm2": 800.0,
                        "bottomEndMaxAreaMm2": 1200.0,
                    },
                },
            },
        },
    )
    beam_reinforcement_item = next(
        item
        for group in beam_reinforcement_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架梁贯通纵筋构造"
    )
    beam_reinforcement_subchecks = {
        item["name"]: item["status"]
        for item in beam_reinforcement_item["inputs"].get("subchecks", [])
    }
    assert_true(beam_reinforcement_result["summary"]["failed"] >= 1, f"Expected beam reinforcement failure: {beam_reinforcement_result['summary']}")
    assert_true(beam_reinforcement_item["status"] == "fail", f"Expected beam reinforcement item to fail: {beam_reinforcement_item}")
    assert_true(beam_reinforcement_subchecks.get("top_continuous_bar_count") == "fail", f"Missing top bar-count failure trace: {beam_reinforcement_item}")
    assert_true(beam_reinforcement_subchecks.get("top_continuous_bar_diameter") == "fail", f"Missing top bar-diameter failure trace: {beam_reinforcement_item}")
    assert_true(beam_reinforcement_subchecks.get("top_continuous_area_ratio") == "fail", f"Missing top area-ratio failure trace: {beam_reinforcement_item}")

    beam_end_longitudinal_result = run_code_check(
        "seismic-code-check-beam-end-longitudinal-demo",
        "GB50011",
        ["B1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "B1": {
                    "type": "beam",
                    "section": {"width": 250.0, "height": 600.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "endLongitudinal": {
                            "compressionZoneRatio": 0.40,
                            "bottomTopAreaRatio": 0.20,
                        },
                        "endTensionReinforcementRatioPercent": 2.8,
                    },
                },
            },
        },
    )
    beam_end_longitudinal_item = next(
        item
        for group in beam_end_longitudinal_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架梁端纵筋延性构造"
    )
    beam_end_longitudinal_subchecks = {
        item["name"]: item["status"]
        for item in beam_end_longitudinal_item["inputs"].get("subchecks", [])
    }
    assert_true(beam_end_longitudinal_result["summary"]["failed"] >= 1, f"Expected beam-end longitudinal failure: {beam_end_longitudinal_result['summary']}")
    assert_true(beam_end_longitudinal_item["status"] == "fail", f"Expected beam-end longitudinal item to fail: {beam_end_longitudinal_item}")
    assert_true(beam_end_longitudinal_subchecks.get("beam_end_compression_zone_ratio") == "fail", f"Missing beam-end compression-zone failure trace: {beam_end_longitudinal_item}")
    assert_true(beam_end_longitudinal_subchecks.get("beam_end_bottom_top_area_ratio") == "fail", f"Missing beam-end bottom/top area-ratio failure trace: {beam_end_longitudinal_item}")
    assert_true(beam_end_longitudinal_subchecks.get("beam_end_tension_reinforcement_ratio") == "fail", f"Missing beam-end tension-ratio failure trace: {beam_end_longitudinal_item}")

    beam_through_joint_result = run_code_check(
        "seismic-code-check-beam-through-joint-demo",
        "GB50011",
        ["B1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "B1": {
                    "type": "beam",
                    "section": {"width": 250.0, "height": 600.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "throughJoint": {
                            "diameterMm": 25.0,
                            "columnDimensionMm": 400.0,
                        },
                    },
                },
            },
        },
    )
    beam_through_joint_item = next(
        item
        for group in beam_through_joint_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架梁贯通中柱纵筋直径"
    )
    assert_true(beam_through_joint_result["summary"]["failed"] >= 1, f"Expected through-joint bar-diameter failure: {beam_through_joint_result['summary']}")
    assert_true(beam_through_joint_item["status"] == "fail", f"Expected through-joint bar-diameter item to fail: {beam_through_joint_item}")
    assert_true(beam_through_joint_item["inputs"].get("barDiameterMm") == 25.0, f"Missing through-joint bar diameter trace: {beam_through_joint_item}")
    assert_true(beam_through_joint_item["inputs"].get("diameterLimitMm") == 20.0, f"Missing through-joint diameter limit trace: {beam_through_joint_item}")

    beam_stirrup_result = run_code_check(
        "seismic-code-check-beam-stirrup-demo",
        "GB50011",
        ["B1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "B1": {
                    "type": "beam",
                    "section": {"width": 250.0, "height": 600.0},
                    "material": {"category": "concrete", "grade": "C30"},
                    "reinforcement": {
                        "topContinuous": {"count": 2, "diameterMm": 16.0},
                        "bottomContinuous": {"count": 2, "diameterMm": 16.0},
                        "endTensionReinforcementRatioPercent": 2.5,
                        "endStirrup": {
                            "diameterMm": 8.0,
                            "spacingMm": 160.0,
                            "confinedLengthMm": 700.0,
                            "legSpacingMm": 300.0,
                            "firstStirrupDistanceMm": 80.0,
                            "hookAngleDeg": 90.0,
                            "hookStraightLengthMm": 60.0,
                        },
                    },
                },
            },
        },
    )
    beam_stirrup_item = next(
        item
        for group in beam_stirrup_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架梁箍筋加密区构造"
    )
    beam_stirrup_subchecks = {
        item["name"]: item["status"]
        for item in beam_stirrup_item["inputs"].get("subchecks", [])
    }
    assert_true(beam_stirrup_result["summary"]["failed"] >= 1, f"Expected beam stirrup failure: {beam_stirrup_result['summary']}")
    assert_true(beam_stirrup_item["status"] == "fail", f"Expected beam stirrup item to fail: {beam_stirrup_item}")
    assert_true(beam_stirrup_subchecks.get("beam_end_stirrup_confined_length") == "fail", f"Missing beam stirrup length failure trace: {beam_stirrup_item}")
    assert_true(beam_stirrup_subchecks.get("beam_end_stirrup_spacing") == "fail", f"Missing beam stirrup spacing failure trace: {beam_stirrup_item}")
    assert_true(beam_stirrup_subchecks.get("beam_end_stirrup_diameter") == "fail", f"Missing beam stirrup diameter failure trace: {beam_stirrup_item}")
    assert_true(beam_stirrup_subchecks.get("beam_stirrup_hook_angle") == "fail", f"Missing beam stirrup hook-angle failure trace: {beam_stirrup_item}")

    column_geometry_result = run_code_check(
        "seismic-code-check-column-geometry-demo",
        "GB50011",
        ["C1"],
        {
            "analysisSummary": {
                "designBasis": {
                    "structuralFamily": "concrete-frame",
                    "seismicGrade": 2,
                    "storyCount": 3,
                    "isPreliminary": False,
                    "missingInputs": [],
                },
            },
            "elementData": {
                "C1": {
                    "type": "column",
                    "section": {"width": 350.0, "height": 500.0},
                    "material": {"category": "concrete", "grade": "C30"},
                },
            },
        },
    )
    column_geometry_item = next(
        item
        for group in column_geometry_result["details"][0]["checks"]
        for item in group["items"]
        if item["item"] == "框架柱截面尺寸"
    )
    column_subcheck_statuses = {
        item["name"]: item["status"]
        for item in column_geometry_item["inputs"].get("subchecks", [])
    }
    assert_true(column_geometry_result["summary"]["failed"] >= 1, f"Expected column geometry failure: {column_geometry_result['summary']}")
    assert_true(column_geometry_item["status"] == "fail", f"Expected column geometry item to fail: {column_geometry_item}")
    assert_true(column_geometry_item["inputs"].get("seismicGrade") == 2, f"Missing column seismic-grade trace: {column_geometry_item}")
    assert_true(column_geometry_item["inputs"].get("storyCount") == 3, f"Missing column story-count trace: {column_geometry_item}")
    assert_true(column_subcheck_statuses.get("column_min_side") == "fail", f"Missing column minimum-side failure trace: {column_geometry_item}")
    assert_true(column_subcheck_statuses.get("column_long_short_side_ratio") == "pass", f"Unexpected column side-ratio failure: {column_geometry_item}")
    print("[ok] GB50011 seismic code-check contract")


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
        StructureModelV2.model_validate(payload)
        validated += 1
        print(f"[ok] {file_path.name}")

    print(f"Validated {validated} StructureModel examples against V2 schema.")


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

    migrated_v2 = convert_structure_model_payload(
        model_payload=source,
        target_schema_version="2.0.0",
        source_format="structuremodel-v1",
        target_format="structuremodel-v1",
        supported_formats=supported_formats(),
        get_converter=get_converter,
    )
    model_v2 = migrated_v2["model"]
    assert model_v2["schema_version"] == "2.0.0"
    assert model_v2["metadata"]["schema_migration"]["to"] == "2.0.0"
    print("[ok] schema migration 1.0.0 -> 2.0.0")

    try:
        convert_structure_model_payload(
            model_payload=source,
            target_schema_version="3.0.0",
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
    "validate-seismic-analyze-contract": validate_seismic_analyze_contract,
    "validate-seismic-wall-line-member-contract": validate_seismic_wall_line_member_contract,
    "validate-seismic-multi-direction-contract": validate_seismic_multi_direction_contract,
    "validate-seismic-directional-ground-motion-contract": validate_seismic_directional_ground_motion_contract,
    "validate-seismic-zonation-table-contract": validate_seismic_zonation_table_contract,
    "validate-seismic-intensity-only-preliminary-contract": validate_seismic_intensity_only_preliminary_contract,
    "validate-seismic-design-basic-acceleration-contract": validate_seismic_design_basic_acceleration_contract,
    "validate-seismic-earthquake-level-contract": validate_seismic_earthquake_level_contract,
    "validate-seismic-elastic-plastic-time-history-boundary-contract": validate_seismic_elastic_plastic_time_history_boundary_contract,
    "validate-seismic-elastic-plastic-member-hinge-time-history-contract": validate_seismic_elastic_plastic_member_hinge_time_history_contract,
    "validate-seismic-auto-performance-objective-contract": validate_seismic_auto_performance_objective_contract,
    "validate-seismic-auto-pushover-contract": validate_seismic_auto_pushover_contract,
    "validate-seismic-vertical-seismic-requirement-contract": validate_seismic_vertical_seismic_requirement_contract,
    "validate-seismic-special-system-boundary-contract": validate_seismic_special_system_boundary_contract,
    "validate-seismic-long-period-special-study-contract": validate_seismic_long_period_special_study_contract,
    "validate-seismic-workflow-contract-aliases-contract": validate_seismic_workflow_contract_aliases_contract,
    "validate-seismic-time-history-contract": validate_seismic_time_history_contract,
    "validate-seismic-ground-motion-requirement-contract": validate_seismic_ground_motion_requirement_contract,
    "validate-seismic-structured-height-method-decision-contract": validate_seismic_structured_height_method_decision_contract,
    "validate-seismic-catalog-time-history-contract": validate_seismic_catalog_time_history_contract,
    "validate-seismic-local-catalog-time-history-contract": validate_seismic_local_catalog_time_history_contract,
    "validate-seismic-local-catalog-selection-contract": validate_seismic_local_catalog_selection_contract,
    "validate-seismic-auto-regularity-contract": validate_seismic_auto_regularity_contract,
    "validate-seismic-nested-regularity-assessment-contract": validate_seismic_nested_regularity_assessment_contract,
    "validate-seismic-soft-story-regularity-contract": validate_seismic_soft_story_regularity_contract,
    "validate-seismic-structured-weak-story-regularity-contract": validate_seismic_structured_weak_story_regularity_contract,
    "validate-seismic-story-strength-regularity-contract": validate_seismic_story_strength_regularity_contract,
    "validate-seismic-story-stiffness-regularity-contract": validate_seismic_story_stiffness_regularity_contract,
    "validate-seismic-story-mass-regularity-contract": validate_seismic_story_mass_regularity_contract,
    "validate-seismic-floor-diaphragm-regularity-contract": validate_seismic_floor_diaphragm_regularity_contract,
    "validate-seismic-story-diaphragm-opening-regularity-contract": validate_seismic_story_diaphragm_opening_regularity_contract,
    "validate-seismic-torsional-irregularity-contract": validate_seismic_torsional_irregularity_contract,
    "validate-seismic-structured-torsional-ratio-contract": validate_seismic_structured_torsional_ratio_contract,
    "validate-seismic-plan-setback-regularity-contract": validate_seismic_plan_setback_regularity_contract,
    "validate-seismic-structured-plan-irregularity-contract": validate_seismic_structured_plan_irregularity_contract,
    "validate-seismic-vertical-discontinuity-regularity-contract": validate_seismic_vertical_discontinuity_regularity_contract,
    "validate-seismic-plan-aspect-regularity-contract": validate_seismic_plan_aspect_regularity_contract,
    "validate-seismic-pushover-contract": validate_seismic_pushover_contract,
    "validate-seismic-pushover-member-hinge-contract": validate_seismic_pushover_member_hinge_contract,
    "validate-seismic-uploaded-text-time-history-contract": validate_seismic_uploaded_text_time_history_contract,
    "validate-code-check-traceability": validate_code_check_traceability,
    "validate-gb50011-seismic-code-check-contract": validate_gb50011_seismic_code_check_contract,
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
