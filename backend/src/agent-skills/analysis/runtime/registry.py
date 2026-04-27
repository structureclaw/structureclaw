from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import yaml
from fastapi import HTTPException

from contracts import AnalysisResult, EngineNotAvailableError
from skill_loader import SkillNotLoadedError, build_missing_skill_detail, load_skill_symbol
from structure_protocol.migrations import migrate_v1_to_v2
from structure_protocol.structure_model_v2 import StructureModelV2

logger = logging.getLogger(__name__)

ANALYSIS_ROOT = Path(__file__).resolve().parent.parent
ENGINE_MANIFEST_ENV = "ANALYSIS_ENGINE_MANIFEST_PATH"
_UNSET = object()

ENGINE_DEFAULTS = {
    "builtin-opensees": {
        "name": "OpenSees Builtin",
        "priority": 100,
        "routingHints": ["high-fidelity", "default"],
        "constraints": {"requiresOpenSees": True},
    },
    "builtin-pkpm": {
        "name": "PKPM Builtin",
        "priority": 90,
        "routingHints": ["commercial", "design-code"],
        "constraints": {"requiresPKPM": True},
    },
    "builtin-yjk": {
        "name": "YJK Builtin",
        "priority": 85,
        "routingHints": ["commercial", "design-code"],
        "constraints": {"requiresYJK": True},
    },
}


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
        self._yjk_runtime_reason: object = _UNSET

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

    def probe_engine(self, engine_id: str) -> Dict[str, Any]:
        manifest = self.get_engine(engine_id)
        if manifest is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "errorCode": "ENGINE_NOT_FOUND",
                    "message": f"Analysis engine '{engine_id}' was not found",
                },
            )
        from time import perf_counter

        start = perf_counter()
        if engine_id == "builtin-opensees":
            result = self._probe_opensees()
        elif engine_id == "builtin-pkpm":
            result = self._probe_pkpm()
        elif engine_id == "builtin-yjk":
            result = self._probe_yjk()
        else:
            result = {"passed": False, "error": f"Unknown engine '{engine_id}' for probe"}
        elapsed = round((perf_counter() - start) * 1000)
        return {
            "engineId": engine_id,
            "engineName": manifest.get("name", engine_id),
            "passed": result["passed"],
            "durationMs": elapsed,
            "error": result.get("error"),
            "details": result.get("details"),
            "steps": result.get("steps"),
            "hint": result.get("hint"),
        }

    def _probe_opensees(self) -> Dict[str, Any]:
        try:
            from importlib.util import module_from_spec, spec_from_file_location
            probe_path = ANALYSIS_ROOT / "opensees-static" / "opensees_runtime.py"
            spec = spec_from_file_location("_opensees_runtime_probe", str(probe_path))
            if spec is None or spec.loader is None:
                return {"passed": False, "error": f"Cannot load OpenSees runtime from {probe_path}"}
            mod = module_from_spec(spec)
            spec.loader.exec_module(mod)
            issue = mod.get_opensees_runtime_issue()
            if issue:
                return {"passed": False, "error": issue}
            return {"passed": True, "details": "OpenSeesPy 2-node beam smoke test passed"}
        except Exception as error:
            return {"passed": False, "error": str(error)}

    def _probe_pkpm(self) -> Dict[str, Any]:
        steps: list[Dict[str, Any]] = []

        # Step 1: check env + file
        cycle_path = os.getenv("PKPM_CYCLE_PATH", "").strip()
        if not cycle_path:
            return {"passed": False, "error": "PKPM_CYCLE_PATH environment variable is not set", "steps": steps}
        p = Path(cycle_path)
        if not p.is_file():
            return {"passed": False, "error": f"JWSCYCLE.exe not found at: {cycle_path}", "steps": steps}
        steps.append({"name": "JWSCYCLE.exe path", "passed": True})

        # Step 2: import APIPyInterface
        try:
            import APIPyInterface
        except ImportError as exc:
            return {"passed": False, "error": f"APIPyInterface import failed: {exc}", "steps": steps}
        steps.append({"name": "APIPyInterface import", "passed": True})

        # Step 3-5: create model, run SATWE, extract results — cleanup in finally
        import shutil
        import tempfile
        import uuid

        work_dir = Path(
            os.getenv("PKPM_WORK_DIR", "").strip()
            or str(Path.home() / ".structureclaw" / "analysis" / "pkpm")
        ) / "probe" / uuid.uuid4().hex[:8]
        try:
            work_dir.mkdir(parents=True, exist_ok=True)
            project_name = "probe"
            jws_path = work_dir / f"{project_name}.JWS"

            model = APIPyInterface.Model()
            model.CreatNewModel(str(work_dir), project_name)
            model.OpenPMModel(str(jws_path))

            # Add a column section (concrete rectangle 400x400)
            csec = APIPyInterface.ColumnSection()
            sh = APIPyInterface.SectionShape()
            sh.Set_H(400)
            sh.Set_B(400)
            csec.SetUserSect(APIPyInterface.SectionKind.IDSec_Rectangle, sh)
            col_sec_idx = model.AddColumnSection(csec)

            # Add a beam section
            bsec = APIPyInterface.BeamSection()
            sh2 = APIPyInterface.SectionShape()
            sh2.Set_H(300)
            sh2.Set_B(200)
            bsec.SetUserSect(APIPyInterface.SectionKind.IDSec_Rectangle, sh2)
            beam_sec_idx = model.AddBeamSection(bsec)

            # Standard floor with 2 nodes
            model.AddStandFloor()
            model.SetCurrentStandFloor(1)
            floor = model.GetCurrentStandFloor()
            n1 = floor.AddNode(0.0, 0.0)
            n2 = floor.AddNode(6000.0, 0.0)
            floor.AddColumn(col_sec_idx, n1.GetID())
            floor.AddColumn(col_sec_idx, n2.GetID())
            net = floor.AddLineNet(n1.GetID(), n2.GetID())
            floor.AddBeamEx(beam_sec_idx, net.GetID(), 0, 0, 0, 0.0)

            # 1 natural floor at 3.6m
            rf = APIPyInterface.RealFloor()
            rf.SetFloorHeight(3600.0)
            rf.SetBottomElevation(0.0)
            rf.SetStandFloorIndex(1)
            model.AddNaturalFloor(rf)

            model.SavePMModel()
            steps.append({"name": "Create minimal PKPM model", "passed": True})

            # Step 4: run SATWE via JWSCYCLE.exe
            self._run_jws_cycle_probe(p, work_dir)
            steps.append({"name": "SATWE analysis", "passed": True})

            # Step 5: extract results
            result = APIPyInterface.ResultData()
            ret = result.InitialResult(str(jws_path))
            result.ClearResult()
            if ret == 0:
                return {
                    "passed": False,
                    "error": "InitialResult returned FALSE — failed to read analysis results",
                    "steps": steps,
                }
            steps.append({"name": "Extract results", "passed": True})

        except Exception as exc:
            step_label = "Model creation" if len(steps) < 3 else ("SATWE analysis" if len(steps) < 4 else "Result extraction")
            hint = "PKPM may not be activated or the license is invalid" if len(steps) >= 3 else None
            return {
                "passed": False,
                "error": f"{step_label} failed: {exc}",
                "steps": steps,
                **({"hint": hint} if hint else {}),
            }
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

        return {"passed": True, "details": "PKPM probe completed: model created, SATWE ran, results extracted", "steps": steps}

    def _probe_yjk(self) -> Dict[str, Any]:
        steps: list[Dict[str, Any]] = []
        env_info = self._resolve_yjk_environment()

        if env_info.get("root"):
            steps.append({
                "name": "YJK install root",
                "passed": True,
                "details": str(env_info["root"]),
                "source": env_info.get("rootSource"),
            })
        if env_info.get("yjksExe"):
            steps.append({
                "name": "yjks.exe path",
                "passed": True,
                "details": str(env_info["yjksExe"]),
                "source": env_info.get("yjksExeSource"),
            })
        if env_info.get("pythonExe"):
            steps.append({
                "name": "YJK Python 3.10",
                "passed": True,
                "details": str(env_info["pythonExe"]),
                "source": env_info.get("pythonSource"),
            })

        if env_info.get("error"):
            steps.append({
                "name": env_info.get("failedStep", "YJK environment"),
                "passed": False,
                "details": env_info["error"],
            })
            return {"passed": False, "error": env_info["error"], "steps": steps}

        import_result = self._run_yjk_import_probe(env_info["root"], env_info["pythonExe"])
        steps.append({
            "name": "YJKAPI import",
            "passed": import_result["passed"],
            "details": (
                "Imported YJKAPI DataFunc and YJKSControl"
                if import_result["passed"]
                else import_result.get("error")
            ),
        })
        if not import_result["passed"]:
            return {"passed": False, "error": import_result.get("error"), "steps": steps}

        return {
            "passed": True,
            "details": "YJK probe completed: environment and YJKAPI imports are available; no heavy analysis was started",
            "steps": steps,
        }

    @staticmethod
    def _run_jws_cycle_probe(cycle_path: Path, work_dir: Path, timeout: int = 120) -> None:
        cycle_dir = cycle_path.parent
        conf_path = cycle_dir / "DirectorySet.conf"
        had_previous_conf = conf_path.exists()
        previous_conf_text = conf_path.read_text(encoding="utf-8") if had_previous_conf else None
        conf_path.write_text(str(work_dir), encoding="utf-8")
        try:
            proc = subprocess.run(
                [str(cycle_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=str(cycle_dir),
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"PKPM probe timed out after {timeout}s")
        except (FileNotFoundError, OSError) as exc:
            raise RuntimeError(f"Failed to launch JWSCYCLE.exe: {exc}") from exc
        finally:
            if had_previous_conf:
                conf_path.write_text(previous_conf_text, encoding="utf-8")
            elif conf_path.exists():
                conf_path.unlink()
        if proc.returncode != 0:
            stderr_snippet = (proc.stderr or "")[:500]
            raise RuntimeError(f"JWSCYCLE.exe exited with code {proc.returncode}. stderr: {stderr_snippet}")

    def validate_model(self, model_payload: Dict[str, Any], engine_id: Optional[str] = None) -> Dict[str, Any]:
        selection = self._select_engine_for("validate", None, model_payload, engine_id)
        manifest = selection.engine
        if manifest["kind"] == "http":
            payload = {"model": model_payload}
            if engine_id:
                payload["engineId"] = engine_id
            return self._post_to_http_engine(manifest, "/validate", payload)

        migrated = self._ensure_v2(model_payload)
        model = StructureModelV2.model_validate(migrated)
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
        model: StructureModelV2,
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
        model: StructureModelV2,
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
        model: StructureModelV2,
        parameters: Dict[str, Any],
    ) -> AnalysisResult:
        skill = self._resolve_builtin_skill(adapter_key, analysis_type)
        if skill is None:
            raise RuntimeError(
                f"No installed analysis skill runtime found for adapter '{adapter_key}'"
                f" and analysis type '{analysis_type}'"
            )

        runtime_module = _load_runtime_module(skill["id"], Path(skill["runtimePath"]))
        run_fn = getattr(runtime_module, "run_analysis", None)
        if run_fn is None:
            raise RuntimeError(f"Analysis skill runtime '{skill['id']}' is missing run_analysis()")

        # Exceptions from skill run_analysis() propagate upward so that
        # registry.run_analysis() can attempt a fallback engine before failing.
        result: AnalysisResult = run_fn(model, parameters)

        if isinstance(result, dict):
            existing_meta = result.get("meta") if isinstance(result.get("meta"), dict) else {}
            result["meta"] = {
                **existing_meta,
                "analysisSkillId": skill["id"],
                "analysisSkillIds": [skill["id"]],
                "analysisAdapterKey": adapter_key,
                "analysisType": analysis_type,
            }
        return result

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

    def _ensure_v2(self, model_payload: Dict[str, Any]) -> Dict[str, Any]:
        return migrate_v1_to_v2(model_payload)

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
        if manifest["kind"] == "python" and manifest.get("constraints", {}).get("requiresPKPM"):
            return self._pkpm_unavailable_reason()
        if manifest["kind"] == "python" and manifest.get("constraints", {}).get("requiresYJK"):
            return self._yjk_unavailable_reason()
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

        runtime_root = Path(__file__).resolve().parent
        probe_path = runtime_root.parent / "opensees-static" / "opensees_runtime.py"
        env = os.environ.copy()
        existing_pythonpath = env.get("PYTHONPATH", "").strip()
        env["PYTHONPATH"] = (
            f"{runtime_root}{os.pathsep}{existing_pythonpath}"
            if existing_pythonpath
            else str(runtime_root)
        )

        try:
            probe = subprocess.run(
                [sys.executable, str(probe_path), "--json"],
                cwd=runtime_root,
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

    def _pkpm_unavailable_reason(self) -> Optional[str]:
        cycle_path = os.getenv("PKPM_CYCLE_PATH", "").strip()
        if not cycle_path:
            return "PKPM_CYCLE_PATH environment variable is not set"
        if not Path(cycle_path).is_file():
            return f"JWSCYCLE.exe not found at: {cycle_path}"
        try:
            import APIPyInterface  # noqa: F401
        except ImportError:
            return "APIPyInterface Python extension not found"
        return None

    def _yjk_unavailable_reason(self) -> Optional[str]:
        if self._yjk_runtime_reason is not _UNSET:
            return self._yjk_runtime_reason if isinstance(self._yjk_runtime_reason, str) else None

        env_info = self._resolve_yjk_environment()
        if env_info.get("error"):
            self._yjk_runtime_reason = str(env_info["error"])
            return self._yjk_runtime_reason

        import_result = self._run_yjk_import_probe(env_info["root"], env_info["pythonExe"])
        if not import_result["passed"]:
            self._yjk_runtime_reason = str(import_result.get("error") or "YJKAPI import probe failed")
            return self._yjk_runtime_reason
        self._yjk_runtime_reason = None
        return None

    def _resolve_yjk_environment(self) -> Dict[str, Any]:
        yjk_path = self._clean_env_path(os.getenv("YJK_PATH", ""))
        yjks_root = self._clean_env_path(os.getenv("YJKS_ROOT", ""))
        root_value = yjk_path or yjks_root
        root_source = "YJK_PATH" if yjk_path else ("YJKS_ROOT" if yjks_root else None)

        if not root_value:
            for candidate in (Path(r"C:\YJKS\YJKS_8_0_0"), Path(r"D:\YJKS\YJKS_8_0_0")):
                if candidate.is_dir():
                    root_value = str(candidate)
                    root_source = "default install path"
                    break

        if not root_value:
            return {
                "error": "YJK_PATH or YJKS_ROOT environment variable is not set",
                "failedStep": "YJK install root",
            }

        root = Path(root_value)
        if not root.is_dir():
            return {
                "root": root,
                "rootSource": root_source,
                "error": f"YJK install directory does not exist: {root}",
                "failedStep": "YJK install root",
            }

        explicit_exe = self._clean_env_path(os.getenv("YJKS_EXE", ""))
        if explicit_exe:
            yjks_exe = Path(explicit_exe)
            if not yjks_exe.is_file():
                return {
                    "root": root,
                    "rootSource": root_source,
                    "error": f"YJKS_EXE points to a missing yjks.exe: {yjks_exe}",
                    "failedStep": "yjks.exe path",
                }
            yjks_exe_source = "YJKS_EXE"
        else:
            yjks_exe = self._find_yjks_exe(root)
            if yjks_exe is None:
                return {
                    "root": root,
                    "rootSource": root_source,
                    "error": f"yjks.exe not found under YJK install root: {root}",
                    "failedStep": "yjks.exe path",
                }
            yjks_exe_source = "install root"

        explicit_python = self._clean_env_path(os.getenv("YJK_PYTHON_BIN", ""))
        if explicit_python:
            python_exe = Path(explicit_python)
            if not python_exe.is_file():
                return {
                    "root": root,
                    "rootSource": root_source,
                    "yjksExe": yjks_exe,
                    "yjksExeSource": yjks_exe_source,
                    "error": f"YJK_PYTHON_BIN points to a missing Python executable: {python_exe}",
                    "failedStep": "YJK Python 3.10",
                }
            python_source = "YJK_PYTHON_BIN"
        else:
            python_exe = self._find_yjk_python(root)
            if python_exe is None:
                return {
                    "root": root,
                    "rootSource": root_source,
                    "yjksExe": yjks_exe,
                    "yjksExeSource": yjks_exe_source,
                    "error": f"YJK Python 3.10 not found under: {root}",
                    "failedStep": "YJK Python 3.10",
                }
            python_source = "install root"

        return {
            "root": root,
            "rootSource": root_source,
            "yjksExe": yjks_exe,
            "yjksExeSource": yjks_exe_source,
            "pythonExe": python_exe,
            "pythonSource": python_source,
        }

    @staticmethod
    def _clean_env_path(value: str) -> str:
        return value.strip().strip('"').strip("'")

    @staticmethod
    def _find_yjks_exe(root: Path) -> Optional[Path]:
        for name in ("yjks.exe", "YJKS.exe"):
            candidate = root / name
            if candidate.is_file():
                return candidate
        return None

    @staticmethod
    def _find_yjk_python(root: Path) -> Optional[Path]:
        for relative in (
            Path("Python310") / "python.exe",
            Path("python310") / "python.exe",
        ):
            candidate = root / relative
            if candidate.is_file():
                return candidate
        return None

    def _run_yjk_import_probe(self, root: Path, python_exe: Path, timeout: int = 20) -> Dict[str, Any]:
        script = """
import json
import os
import sys
import traceback

root = os.environ.get("YJKS_ROOT") or os.environ.get("YJK_PATH") or ""
if root:
    os.environ["PATH"] = root + os.pathsep + os.environ.get("PATH", "")
    if root not in sys.path:
        sys.path.insert(0, root)

try:
    from YJKAPI import DataFunc, YJKSControl  # noqa: F401
    print(json.dumps({"available": True, "imports": ["DataFunc", "YJKSControl"]}))
except Exception as exc:
    print(json.dumps({
        "available": False,
        "error": f"{type(exc).__name__}: {exc}",
        "traceback": traceback.format_exc(limit=5),
    }))
    sys.exit(1)
"""
        env = os.environ.copy()
        env["YJKS_ROOT"] = str(root)
        env["YJK_PATH"] = str(root)
        env["PATH"] = f"{root}{os.pathsep}{python_exe.parent}{os.pathsep}{env.get('PATH', '')}"
        existing_pythonpath = env.get("PYTHONPATH", "").strip()
        env["PYTHONPATH"] = (
            f"{root}{os.pathsep}{existing_pythonpath}"
            if existing_pythonpath
            else str(root)
        )

        try:
            probe = subprocess.run(
                [str(python_exe), "-c", script],
                cwd=str(root),
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return {
                "passed": False,
                "error": f"YJKAPI import probe timed out after {timeout}s using {python_exe}",
            }
        except (FileNotFoundError, OSError) as exc:
            return {
                "passed": False,
                "error": f"Failed to launch YJK Python at {python_exe}: {exc}",
            }

        payload = self._extract_last_json_object(probe.stdout)
        if probe.returncode == 0 and payload.get("available") is True:
            return {"passed": True, "details": payload}

        payload_error = str(payload.get("error", "")).strip()
        stderr_snippet = self._short_output(probe.stderr)
        stdout_snippet = self._short_output(probe.stdout)
        diagnostics = payload_error or f"probe exited with code {probe.returncode}"
        if stderr_snippet:
            diagnostics = f"{diagnostics}; stderr: {stderr_snippet}"
        if stdout_snippet and payload_error not in stdout_snippet:
            diagnostics = f"{diagnostics}; stdout: {stdout_snippet}"
        return {
            "passed": False,
            "error": f"YJKAPI import failed using {python_exe}: {diagnostics}",
        }

    @staticmethod
    def _extract_last_json_object(text: str) -> Dict[str, Any]:
        for line in reversed(text.splitlines()):
            candidate = line.strip()
            if not candidate.startswith("{"):
                continue
            try:
                payload = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                return payload
        return {}

    @staticmethod
    def _short_output(text: str, limit: int = 500) -> str:
        collapsed = " ".join(text.strip().split())
        return collapsed[:limit]

    def _builtin_manifests(self) -> List[Dict[str, Any]]:
        manifests: List[Dict[str, Any]] = []
        skills = self._discover_builtin_skills()

        for engine_id, defaults in ENGINE_DEFAULTS.items():
            matched = [skill for skill in skills if skill["engineId"] == engine_id]
            if not matched:
                continue

            supported_types = []
            for skill in matched:
                analysis_type = skill["analysisType"]
                if analysis_type not in supported_types:
                    supported_types.append(analysis_type)

            supported_families = []
            for skill in matched:
                for family in skill["supportedModelFamilies"]:
                    if family not in supported_families:
                        supported_families.append(family)

            manifests.append({
                "id": engine_id,
                "name": defaults["name"],
                "version": self.app_version,
                "kind": "python",
                "adapterKey": matched[0]["adapterKey"],
                "capabilities": ["analyze", "validate", "code-check"],
                "supportedAnalysisTypes": supported_types,
                "supportedModelFamilies": supported_families,
                "priority": defaults["priority"],
                "routingHints": defaults["routingHints"],
                "visibility": "builtin",
                "enabled": True,
                "constraints": defaults["constraints"],
                "skillIds": [skill["id"] for skill in matched],
            })

        return manifests

    def _discover_builtin_skills(self) -> List[Dict[str, Any]]:
        analysis_root = Path(__file__).resolve().parents[1]
        skills: List[Dict[str, Any]] = []

        for child in analysis_root.iterdir():
            if not child.is_dir() or child.name.startswith(".") or child.name == "runtime":
                continue

            manifest_path = child / "skill.yaml"
            runtime_path = child / "runtime.py"
            if not manifest_path.exists() or not runtime_path.exists():
                continue

            try:
                metadata = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
            except (yaml.YAMLError, OSError) as error:
                logger.warning("Failed to parse analysis skill manifest %s: %s", manifest_path, error)
                continue

            if not isinstance(metadata, dict) or str(metadata.get("domain", "")).strip() != "analysis":
                continue

            skill_id = str(metadata.get("id", child.name)).strip()
            engine_id = str(metadata.get("engineId", "")).strip()
            adapter_key = str(metadata.get("adapterKey", "")).strip()
            analysis_type = str(metadata.get("analysisType", "")).strip()

            if not skill_id or not engine_id or not adapter_key or not analysis_type:
                continue

            supported_model_families = metadata.get("supportedModelFamilies", ["frame", "truss", "generic"])
            if not isinstance(supported_model_families, list):
                supported_model_families = ["frame", "truss", "generic"]

            skills.append({
                "id": skill_id,
                "engineId": engine_id,
                "adapterKey": adapter_key,
                "analysisType": analysis_type,
                "priority": int(metadata.get("priority", 0)),
                "supportedModelFamilies": [str(item) for item in supported_model_families],
                "runtimePath": str(runtime_path),
            })

        skills.sort(key=lambda item: (-int(item["priority"]), str(item["id"])))
        return skills

    def _resolve_builtin_skill(self, adapter_key: str, analysis_type: str) -> Optional[Dict[str, Any]]:
        for skill in self._discover_builtin_skills():
            if skill["adapterKey"] == adapter_key and skill["analysisType"] == analysis_type:
                return skill
        return None

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
        return Path.home() / ".structureclaw" / "analysis-engines.json"


def _load_runtime_module(skill_id: str, runtime_path: Path):
    module_name = f"_analysis_skill_runtime_{skill_id.replace('-', '_')}"
    spec = spec_from_file_location(module_name, runtime_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load runtime module for {runtime_path}")

    module = module_from_spec(spec)
    sys.modules[module_name] = module
    skill_dir = str(runtime_path.parent)
    if skill_dir not in sys.path:
        sys.path.insert(0, skill_dir)
    spec.loader.exec_module(module)
    return module
