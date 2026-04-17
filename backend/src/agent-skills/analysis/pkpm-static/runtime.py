"""PKPM static analysis skill — runtime.

Converts a V2 StructureModelV2 JSON payload into a PKPM JWS project file
via APIPyInterface, then invokes JWSCYCLE.exe for SATWE structural analysis,
and extracts results via APIPyInterface.ResultData.

Environment variables
---------------------
PKPM_CYCLE_PATH : str
    Full path to JWSCYCLE.exe on the local machine.
PKPM_WORK_DIR : str, optional
    Directory where PKPM project files are written.
    Defaults to a 'pkpm_projects' subfolder in the system temp directory.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import uuid
from pathlib import Path
from threading import Lock
from typing import Any, Dict

from contracts import EngineNotAvailableError

# Thread lock to serialize DirectorySet.conf write + execution within this process.
# For multi-process deployments, use an external lock mechanism (e.g., file lock).
_jws_cycle_lock = Lock()


def _check_pkpm_available() -> Path:
    """Return Path to JWSCYCLE.exe or raise EngineNotAvailableError."""
    cycle_path = os.getenv("PKPM_CYCLE_PATH", "").strip()
    if not cycle_path:
        raise EngineNotAvailableError(
            engine="pkpm",
            reason=(
                "PKPM_CYCLE_PATH environment variable is not set. "
                "Set it to the full path of JWSCYCLE.exe."
            ),
        )
    p = Path(cycle_path)
    if not p.is_file():
        raise EngineNotAvailableError(
            engine="pkpm",
            reason=f"JWSCYCLE.exe not found at: {cycle_path}",
        )
    return p


def _import_apipyinterface() -> None:
    """Ensure APIPyInterface can be imported; raise EngineNotAvailableError if not."""
    try:
        import APIPyInterface  # noqa: F401
    except ImportError as exc:
        raise EngineNotAvailableError(
            engine="pkpm",
            reason=f"APIPyInterface Python extension not found: {exc}",
        ) from exc


def _run_jws_cycle(cycle_path: Path, work_dir: Path, timeout: int = 600) -> None:
    """Launch JWSCYCLE.exe using the official DirectorySet.conf mechanism.

    Per PKPM official API documentation (gitee.com/pkpmgh/pkpm-official---api-release):
    1. Write work_dir path into DirectorySet.conf in the PkpmCycle directory.
    2. Set cwd to the PkpmCycle directory.
    3. Launch JWSCYCLE.exe (no CLI arguments needed).

    Uses an in-process thread lock to prevent concurrent analyses in this
    process from overwriting the shared DirectorySet.conf file.
    Multi-process deployments require an external lock mechanism.
    """
    cycle_dir = cycle_path.parent
    conf_path = cycle_dir / "DirectorySet.conf"

    with _jws_cycle_lock:
        had_previous_conf = conf_path.exists()
        previous_conf_text = (
            conf_path.read_text(encoding="utf-8") if had_previous_conf else None
        )

        conf_path.write_text(str(work_dir), encoding="utf-8")

        try:
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
                raise RuntimeError(f"PKPM analysis timed out after {timeout}s")
            except (FileNotFoundError, OSError) as exc:
                raise RuntimeError(
                    f"Failed to launch JWSCYCLE.exe at '{cycle_path}': {exc}"
                ) from exc
        finally:
            if had_previous_conf:
                conf_path.write_text(previous_conf_text, encoding="utf-8")
            elif conf_path.exists():
                conf_path.unlink()

    if proc.returncode != 0:
        stderr_snippet = (proc.stderr or "")[:500]
        raise RuntimeError(
            f"JWSCYCLE.exe exited with code {proc.returncode}. "
            f"stderr: {stderr_snippet}"
        )


def _extract_results(jws_path: Path) -> Dict[str, Any]:
    """Extract design results from a completed SATWE analysis via APIPyInterface."""
    import APIPyInterface

    result = APIPyInterface.ResultData()
    ret = result.InitialResult(str(jws_path))
    if ret != 0:
        raise RuntimeError(f"InitialResult returned non-zero: {ret}")

    try:
        mode_periods: list[dict[str, Any]] = []
        for p in result.GetModePeriods():
            mode_periods.append({
                "index": p.GetIndex(),
                "period_s": round(p.GetCycle(), 4),
                "angle": round(p.GetAngle(), 2),
                "torsion_ratio": round(p.GetTorsi(), 4),
            })

        beam_results: list[dict[str, Any]] = []
        column_results: list[dict[str, Any]] = []

        floor_idx = 1
        max_floors = 500
        while floor_idx <= max_floors:
            beams = result.GetDesignBeams(floor_idx)
            columns = result.GetDesignColumns(floor_idx)
            if not beams and not columns:
                break
            for b in beams:
                beam_results.append({
                    "floor": floor_idx,
                    "pmid": b.GetPmid(),
                })
            for c in columns:
                column_results.append({
                    "floor": floor_idx,
                    "pmid": c.GetPmid(),
                })
            floor_idx += 1

        return {
            "mode_periods": mode_periods,
            "beam_count": len(beam_results),
            "column_count": len(column_results),
            "floors_analyzed": floor_idx - 1,
        }
    finally:
        result.ClearResult()


def run_analysis(model: Dict[str, Any], parameters: Dict[str, Any]) -> Dict[str, Any]:
    """Convert V2 model to PKPM JWS and run SATWE static analysis.

    Parameters
    ----------
    model : dict
        Deserialized StructureModelV2 payload (raw dict, not Pydantic instance).
    parameters : dict
        Analysis parameters forwarded from the API request.

    Returns
    -------
    dict
        AnalysisResult-shaped dict with status / summary / detailed / warnings.

    Raises
    ------
    EngineNotAvailableError
        When PKPM is not installed or APIPyInterface is unavailable.
    RuntimeError
        When JWS generation or SATWE analysis fails.
    """
    cycle_path = _check_pkpm_available()
    _import_apipyinterface()

    from pkpm_converter import convert_v2_to_jws  # local import after availability check

    # ---- Determine working directory ----
    base_work_dir = Path(
        os.getenv("PKPM_WORK_DIR", "").strip()
        or Path(tempfile.gettempdir()) / "pkpm_projects"
    )
    project_name = f"sc_{uuid.uuid4().hex[:8]}"
    work_dir = base_work_dir / project_name

    warnings: list[str] = []

    # ---- Phase 1: Generate JWS ----
    try:
        jws_path = convert_v2_to_jws(model, work_dir, project_name)
    except Exception as exc:
        raise RuntimeError(f"PKPM JWS generation failed: {exc}") from exc

    # ---- Phase 2: Run SATWE via JWSCYCLE.exe ----
    timeout = int(parameters.get("timeout", 600))
    _run_jws_cycle(cycle_path, work_dir, timeout=timeout)

    # ---- Phase 3: Extract results via APIPyInterface ----
    try:
        extracted = _extract_results(jws_path)
    except Exception as exc:
        warnings.append(f"Result extraction failed: {exc}")
        extracted = {}

    return {
        "status": "success",
        "summary": {
            "engine": "pkpm-static",
            "jws_path": str(jws_path),
            "work_dir": str(work_dir),
            "floors_analyzed": extracted.get("floors_analyzed", 0),
            "beam_count": extracted.get("beam_count", 0),
            "column_count": extracted.get("column_count", 0),
        },
        "detailed": {
            "mode_periods": extracted.get("mode_periods", []),
        },
        "warnings": warnings,
    }
