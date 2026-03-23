from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException

from skill_loader import SkillNotLoadedError, build_missing_skill_detail, load_skill_symbol
from providers.common.dynamic_analysis import DynamicAnalyzer
from providers.common.seismic_analysis import SeismicAnalyzer
from providers.common.static_analysis import StaticAnalyzer
from contracts.structure_model_v1 import StructureModelV1

logger = logging.getLogger(__name__)

ENGINE_MANIFEST_ENV = "ANALYSIS_ENGINE_MANIFEST_PATH"
_UNSET = object()


def _create_code_checker(code: str):
    cls = load_skill_symbol("code-check/code_check.py", "CodeChecker")
    return cls(code)


@dataclass
class EngineSelection:
    engine: Dict[str, Any]
    selection_mode: str
    fallback_from: Optional[str] = None


class AnalysisEngineRegistry:
    def __init__(self, app_name: str, app_version: str):
        self.app_name = app_name
        self.app_version = app_version
        self._opensees_runtime_reason: object = _UNSET

    def list_engines(self) -> List[Dict[str, Any]]:
        builtin = self._builtin_manifests()
        installed = self._load_installed_manifests()
        all_manifests = builtin + installed
        return [self._annotate_engine_status(manifest) for manifest in all_manifests]

    def get_engine(self, engine_id: str) -> Optional[Dict[str, Any]]:
        for manifest in self.list_engines():
            if manifest["id"] == engine_id:
                return manifest
        return None

    def check_engine(self, engine_id: str) -> Dict[str, Any]:
        manifest = self.get_engine(engine_id)
        if manifest is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "errorCode": "ENGINE_NOT_FOUND",
                    "message": f"Analysis engine '{engine_id}' was not found",
                },
            )
        return {
            "engine": manifest,
            "check": {
                "status": manifest["status"],
                "available": manifest["available"],
                "unavailableReason": manifest.get("unavailableReason"),
                "checkedAt": manifest.get("checkedAt"),
            },
        }

    def validate_model(self, model_payload: Dict[str, Any], engine_id: Optional[str] = None) -> Dict[str, Any]:
        selection = self._select_engine_for("validate", None, model_payload, engine_id)
        manifest = selection.engine
        if manifest["kind"] == "http":
            payload = {"model": model_payload}
            if engine_id:
                payload["engineId"] = engine_id
            return self._post_to_http_engine(manifest, "/validate", payload)

        model = StructureModelV1.model_validate(model_payload)
        return {
            "valid": True,
            "schemaVersion": model.schema_version,
            "stats": {
                "nodes": len(model.nodes),
                "elements": len(model.elements),
                "materials": len(model.materials),
                "sections": len(model.sections),
                "loadCases": len(model.load_cases),
                "loadCombinations": len(model.load_combinations),
            },
            "meta": self._build_engine_meta(selection),
        }

    def run_analysis(
        self,
        analysis_type: str,
        model: StructureModelV1,
        parameters: Dict[str, Any],
        engine_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if analysis_type not in {"static", "dynamic", "seismic", "nonlinear"}:
            raise HTTPException(
                status_code=400,
                detail={
                    "errorCode": "INVALID_ANALYSIS_TYPE",
                    "message": f"Unknown analysis type: {analysis_type}",
                },
            )
        selection = self._select_engine_for("analyze", analysis_type, model.model_dump(mode="json"), engine_id)
        try:
            result = self._execute_analysis_selection(selection, analysis_type, model, parameters, engine_id)
        except Exception as error:
            fallback_selection = self._select_runtime_fallback_for_analysis(
                selection,
                analysis_type,
                model,
                engine_id,
            )
            if fallback_selection is None:
                raise
            logger.warning(
                "Analysis engine '%s' failed during auto selection; retrying with '%s': %s",
                selection.engine["id"],
                fallback_selection.engine["id"],
                error,
            )
            selection = fallback_selection
            result = self._execute_analysis_selection(selection, analysis_type, model, parameters, engine_id)

        meta = self._build_engine_meta(selection)
        existing_meta = result.get("meta") if isinstance(result, dict) else None
        if isinstance(existing_meta, dict):
            meta.update(existing_meta)
        return {
            **result,
            "meta": meta,
        }

    def _execute_analysis_selection(
        self,
        selection: EngineSelection,
        analysis_type: str,
        model: StructureModelV1,
        parameters: Dict[str, Any],
        engine_id: Optional[str],
    ) -> Dict[str, Any]:
        manifest = selection.engine
        if manifest["kind"] == "http":
            payload: Dict[str, Any] = {
                "type": analysis_type,
                "model": model.model_dump(mode="json"),
                "parameters": parameters,
            }
            if engine_id:
                payload["engineId"] = engine_id
            return self._post_to_http_engine(manifest, "/analyze", payload)

        adapter_key = manifest.get("adapterKey")
        return self._run_python_analysis(adapter_key, analysis_type, model, parameters)

    def _select_runtime_fallback_for_analysis(
        self,
        selection: EngineSelection,
        analysis_type: str,
        model: StructureModelV1,
        engine_id: Optional[str],
    ) -> Optional[EngineSelection]:
        if engine_id is not None:
            return None
        if selection.engine.get("id") != "builtin-opensees":
            return None

        fallback_engine = self.get_engine("builtin-simplified")
        if fallback_engine is None:
            return None
        if not self._supports_request(fallback_engine, "analyze", analysis_type, model.model_dump(mode="json")):
            return None

        return EngineSelection(
            engine=fallback_engine,
            selection_mode="fallback",
            fallback_from=selection.engine["id"],
        )

    def run_code_check(
        self,
        model_id: str,
        code: str,
        elements: List[str],
        context: Dict[str, Any],
        engine_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        selection = self._select_engine_for("code-check", None, None, engine_id)
        manifest = selection.engine

        if manifest["kind"] == "http":
            payload: Dict[str, Any] = {
                "model_id": model_id,
                "code": code,
                "elements": elements,
                "context": context,
            }
            if engine_id:
                payload["engineId"] = engine_id
            result = self._post_to_http_engine(manifest, "/code-check", payload)
        else:
            try:
                checker = _create_code_checker(code)
                result = checker.check(model_id, elements, context)
            except SkillNotLoadedError as error:
                raise HTTPException(
                    status_code=503,
                    detail=build_missing_skill_detail(error, capability="code-check"),
                )

        if isinstance(result, dict):
            result["meta"] = self._build_engine_meta(selection)
        return result

    def _run_python_analysis(
        self,
        adapter_key: str,
        analysis_type: str,
        model: StructureModelV1,
        parameters: Dict[str, Any],
    ) -> Dict[str, Any]:
        if adapter_key == "builtin-opensees":
            mode = "opensees"
        elif adapter_key == "builtin-simplified":
            mode = "simplified"
        else:
            raise RuntimeError(f"Unknown python analysis adapter: {adapter_key}")

        if analysis_type == "static":
            analyzer = StaticAnalyzer(model, engine_mode=mode)
            return analyzer.run(parameters)
        if analysis_type == "dynamic":
            analyzer = DynamicAnalyzer(model, engine_mode=mode)
            return analyzer.run(parameters)
        if analysis_type == "seismic":
            analyzer = SeismicAnalyzer(model, engine_mode=mode)
            return analyzer.run(parameters)
        if analysis_type == "nonlinear":
            analyzer = StaticAnalyzer(model, engine_mode=mode)
            return analyzer.run_nonlinear(parameters)
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "INVALID_ANALYSIS_TYPE",
                "message": f"Unknown analysis type: {analysis_type}",
            },
        )

    def _post_to_http_engine(self, manifest: Dict[str, Any], path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        base_url = manifest.get("baseUrl")
        if not isinstance(base_url, str) or not base_url.strip():
            raise RuntimeError(f"HTTP engine '{manifest['id']}' is missing baseUrl")

        headers: Dict[str, str] = {}
        auth_env = manifest.get("authTokenEnv")
        if isinstance(auth_env, str) and auth_env:
            token = os.getenv(auth_env, "").strip()
            if token:
                headers["Authorization"] = f"Bearer {token}"

        timeout_ms = manifest.get("timeoutMs", 300000)
        with httpx.Client(timeout=timeout_ms / 1000) as client:
            response = client.post(f"{base_url.rstrip('/')}{path}", json=payload, headers=headers)
            response.raise_for_status()
            return response.json()

    def _select_engine_for(
        self,
        capability: str,
        analysis_type: Optional[str],
        model_payload: Optional[Dict[str, Any]],
        engine_id: Optional[str],
    ) -> EngineSelection:
        manifests = self.list_engines()

        if engine_id:
            explicit = next((item for item in manifests if item["id"] == engine_id), None)
            if explicit is None:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "errorCode": "UNKNOWN_ENGINE_ID",
                        "message": f"Unknown engineId: {engine_id}",
                    },
                )
            if not explicit["available"]:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "errorCode": "ENGINE_UNAVAILABLE",
                        "message": f"Engine '{engine_id}' is currently unavailable",
                    },
                )
            self._ensure_engine_supports(explicit, capability, analysis_type, model_payload)
            return EngineSelection(engine=explicit, selection_mode="manual")

        candidates = [
            item
            for item in manifests
            if self._supports_request(item, capability, analysis_type, model_payload) and item["available"]
        ]
        if not candidates:
            raise HTTPException(
                status_code=503,
                detail={
                    "errorCode": "NO_ENGINE_AVAILABLE",
                    "message": f"No analysis engine is available for capability '{capability}'",
                },
            )

        candidates.sort(key=lambda item: int(item.get("priority", 0)), reverse=True)
        selected = candidates[0]
        fallback_from = None
        selection_mode = "auto"
        preferred = next((
            item
            for item in manifests
            if item.get("priority", 0) > selected.get("priority", 0)
            and self._supports_request(item, capability, analysis_type, model_payload)
        ), None)
        if preferred and not preferred.get("available"):
            selection_mode = "fallback"
            fallback_from = preferred["id"]
        return EngineSelection(engine=selected, selection_mode=selection_mode, fallback_from=fallback_from)

    def _ensure_engine_supports(
        self,
        manifest: Dict[str, Any],
        capability: str,
        analysis_type: Optional[str],
        model_payload: Optional[Dict[str, Any]],
    ) -> None:
        if not self._supports_request(manifest, capability, analysis_type, model_payload):
            raise HTTPException(
                status_code=422,
                detail={
                    "errorCode": "ENGINE_UNSUPPORTED",
                    "message": f"Engine '{manifest['id']}' does not support this request",
                },
            )

    def _supports_request(
        self,
        manifest: Dict[str, Any],
        capability: str,
        analysis_type: Optional[str],
        model_payload: Optional[Dict[str, Any]],
    ) -> bool:
        if not manifest.get("enabled", True):
            return False
        if capability not in manifest.get("capabilities", []):
            return False
        supported_types = manifest.get("supportedAnalysisTypes", [])
        if analysis_type and supported_types and analysis_type not in supported_types:
            return False
        supported_families = manifest.get("supportedModelFamilies", [])
        if supported_families and model_payload is not None:
            family = self._detect_model_family(model_payload)
            if family not in supported_families:
                return False
        return True

    def _build_engine_meta(self, selection: EngineSelection) -> Dict[str, Any]:
        manifest = selection.engine
        return {
            "engineId": manifest["id"],
            "engineName": manifest["name"],
            "engineVersion": manifest["version"],
            "engineKind": manifest["kind"],
            "selectionMode": selection.selection_mode,
            "fallbackFrom": selection.fallback_from,
        }

    def _detect_model_family(self, model_payload: Dict[str, Any]) -> str:
        elements = model_payload.get("elements")
        if not isinstance(elements, list) or not elements:
            return "generic"
        element_types = {str(item.get("type")) for item in elements if isinstance(item, dict)}
        if element_types <= {"truss"}:
            return "truss"
        if "beam" in element_types:
            return "frame"
        return "generic"

    def _get_engine_unavailable_reason(self, manifest: Dict[str, Any]) -> Optional[str]:
        if not manifest.get("enabled", True):
            return "Engine is disabled"
        if manifest["kind"] == "python" and manifest.get("constraints", {}).get("requiresOpenSees"):
            return self._opensees_unavailable_reason()
        if manifest["kind"] == "http":
            base_url = manifest.get("baseUrl")
            if not isinstance(base_url, str) or not base_url.strip():
                return "HTTP engine is missing baseUrl"
        return None

    def _annotate_engine_status(self, manifest: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(manifest)
        unavailable_reason = self._get_engine_unavailable_reason(normalized)
        normalized["available"] = unavailable_reason is None
        normalized["status"] = (
            "disabled"
            if not normalized.get("enabled", True)
            else ("available" if unavailable_reason is None else "unavailable")
        )
        normalized["unavailableReason"] = unavailable_reason
        normalized["checkedAt"] = normalized.get("checkedAt") or self._current_timestamp()
        return normalized

    def _current_timestamp(self) -> str:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat()

    def _is_opensees_available(self) -> bool:
        return self._opensees_unavailable_reason() is None

    def _opensees_unavailable_reason(self) -> Optional[str]:
        if self._opensees_runtime_reason is not _UNSET:
            return self._opensees_runtime_reason if isinstance(self._opensees_runtime_reason, str) else None

        python_root = Path(__file__).resolve().parents[1]
        env = os.environ.copy()
        existing_pythonpath = env.get("PYTHONPATH", "").strip()
        env["PYTHONPATH"] = (
            f"{python_root}{os.pathsep}{existing_pythonpath}"
            if existing_pythonpath
            else str(python_root)
        )

        try:
            probe = subprocess.run(
                [sys.executable, "-m", "providers.opensees.runtime", "--json"],
                cwd=python_root,
                env=env,
                capture_output=True,
                text=True,
                timeout=20,
            )
        except Exception as error:
            reason = f"OpenSees runtime probe failed to execute: {error}"
            logger.warning(reason)
            self._opensees_runtime_reason = reason
            return reason

        payload_text = probe.stdout.strip()
        try:
            payload = json.loads(payload_text) if payload_text else {}
        except json.JSONDecodeError:
            payload = {}

        if probe.returncode == 0 and payload.get("available") is True:
            self._opensees_runtime_reason = None
            return None

        stderr_text = probe.stderr.strip()
        reason = (
            payload.get("reason")
            or stderr_text
            or f"OpenSees runtime probe exited with code {probe.returncode}"
        )
        logger.warning("OpenSeesPy runtime is unavailable: %s", reason)
        self._opensees_runtime_reason = str(reason)
        return self._opensees_runtime_reason

    def _builtin_manifests(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": "builtin-opensees",
                "name": "OpenSees Builtin",
                "version": self.app_version,
                "kind": "python",
                "adapterKey": "builtin-opensees",
                "capabilities": ["analyze", "validate", "code-check"],
                "supportedAnalysisTypes": ["static", "dynamic", "seismic", "nonlinear"],
                "supportedModelFamilies": ["frame", "truss", "generic"],
                "priority": 100,
                "routingHints": ["high-fidelity", "default"],
                "visibility": "builtin",
                "enabled": True,
                "constraints": {"requiresOpenSees": True},
            },
            {
                "id": "builtin-simplified",
                "name": "Simplified Builtin",
                "version": self.app_version,
                "kind": "python",
                "adapterKey": "builtin-simplified",
                "capabilities": ["analyze", "validate", "code-check"],
                "supportedAnalysisTypes": ["static", "dynamic", "seismic"],
                "supportedModelFamilies": ["frame", "truss", "generic"],
                "priority": 10,
                "routingHints": ["fallback", "fast"],
                "visibility": "builtin",
                "enabled": True,
                "constraints": {},
            },
        ]

    def _load_installed_manifests(self) -> List[Dict[str, Any]]:
        path = self._manifest_path()
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            logger.warning("Failed to load analysis engine manifest file: %s", error)
            return []

        manifests = payload if isinstance(payload, list) else payload.get("engines", [])
        if not isinstance(manifests, list):
            return []

        normalized: List[Dict[str, Any]] = []
        for item in manifests:
            if not isinstance(item, dict):
                continue
            normalized.append({
                "id": str(item.get("id", "")).strip(),
                "name": str(item.get("name", "")).strip() or str(item.get("id", "")).strip(),
                "version": str(item.get("version", "1.0.0")).strip(),
                "kind": str(item.get("kind", "http")).strip(),
                "capabilities": item.get("capabilities", []),
                "supportedAnalysisTypes": item.get("supportedAnalysisTypes", []),
                "supportedModelFamilies": item.get("supportedModelFamilies", []),
                "priority": int(item.get("priority", 50)),
                "routingHints": item.get("routingHints", []),
                "visibility": "installed",
                "enabled": bool(item.get("enabled", True)),
                "baseUrl": item.get("baseUrl"),
                "authTokenEnv": item.get("authTokenEnv"),
                "timeoutMs": int(item.get("timeoutMs", 300000)),
                "constraints": item.get("constraints", {}),
                "installedSource": item.get("installedSource", "manifest"),
            })
        return [item for item in normalized if item["id"]]

    def _manifest_path(self) -> Path:
        value = os.getenv(ENGINE_MANIFEST_ENV, "").strip()
        if value:
            return Path(value)
        return Path(__file__).resolve().parents[6] / ".runtime" / "analysis-engines.json"
