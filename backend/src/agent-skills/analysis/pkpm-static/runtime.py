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


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _max_from_list(values: list[float]) -> float:
    return max(values) if values else 0.0


def _extract_results(jws_path: Path) -> Dict[str, Any]:
    """Extract design results from a completed SATWE analysis via APIPyInterface."""
    import APIPyInterface

    result = APIPyInterface.ResultData()
    ret = result.InitialResult(str(jws_path))
    if ret == 0:
        raise RuntimeError(f"InitialResult returned FALSE (0) — failed to load results from {jws_path}")

    try:
        # ---- Mode periods ----
        mode_periods: list[dict[str, Any]] = []
        for p in result.GetModePeriods():
            mode_periods.append({
                "index": p.GetIndex(),
                "period_s": round(p.GetCycle(), 4),
                "angle": round(p.GetAngle(), 2),
                "torsion_ratio": round(p.GetTorsi(), 4),
            })

        # ---- Beam & column design data per floor ----
        beam_results: list[dict[str, Any]] = []
        column_results: list[dict[str, Any]] = []
        max_shear_force = 0.0
        max_posi_moment = 0.0
        max_nega_moment = 0.0
        max_shear_compression_ratio = 0.0
        max_axial_compression_ratio = 0.0
        all_node_disp_x: list[float] = []
        all_node_disp_y: list[float] = []
        all_node_disp_z: list[float] = []

        floor_idx = 1
        max_floors = 500
        while floor_idx <= max_floors:
            beams = result.GetDesignBeams(floor_idx)
            columns = result.GetDesignColumns(floor_idx)
            if not beams and not columns:
                break

            for b in beams:
                pmid = b.GetPmid()

                # Primary: use GetForce() for per-load-case forces
                # GetForce() returns dict[case, dict[pos, [N, Vy, Vz, T, My, Mz]]]
                force_data = b.GetForce()
                beam_max_v = 0.0
                beam_max_m = 0.0
                if force_data:
                    for case_name, inner in force_data.items():
                        for _pos, vals in inner.items():
                            if len(vals) >= 3:
                                beam_max_v = max(beam_max_v, abs(vals[2]))  # Vz
                            if len(vals) >= 5:
                                beam_max_m = max(beam_max_m, abs(vals[4]))  # My

                # Fallback: use design summary methods
                shear = _safe_float(b.GetShearingforce())
                posi = b.GetPosiMoment()
                nega = b.GetNegaMoment()
                scr = _safe_float(b.GetShearCompressionRatio())

                # Prefer GetForce() values if design methods return 0
                if beam_max_v > 0 and abs(shear) < 0.001:
                    shear = beam_max_v
                if beam_max_m > 0:
                    if _max_from_list([abs(v) for v in posi]) < 0.001:
                        posi = [beam_max_m]
                    if _max_from_list([abs(v) for v in nega]) < 0.001:
                        nega = [beam_max_m]

                max_shear_force = max(max_shear_force, abs(shear))
                max_posi_moment = max(max_posi_moment, _max_from_list([abs(v) for v in posi]))
                max_nega_moment = max(max_nega_moment, _max_from_list([abs(v) for v in nega]))
                max_shear_compression_ratio = max(max_shear_compression_ratio, scr)

                beam_results.append({
                    "floor": floor_idx,
                    "pmid": pmid,
                    "max_shear_force_kn": round(shear, 2),
                    "shear_compression_ratio": round(scr, 4),
                    "positive_moments_kNm": [round(v, 2) for v in posi],
                    "negative_moments_kNm": [round(v, 2) for v in nega],
                })

            for c in columns:
                pmid = c.GetPmid()

                # Primary: use GetForce() for per-load-case forces
                # GetForce() returns dict[case, dict[pos, [N, Vy, Vz, T, My, Mz]]]
                force_data = c.GetForce()
                col_max_n = 0.0
                col_max_v = 0.0
                col_max_m = 0.0
                if force_data:
                    for case_name, inner in force_data.items():
                        for _pos, vals in inner.items():
                            if len(vals) >= 1:
                                col_max_n = max(col_max_n, abs(vals[0]))  # N
                            if len(vals) >= 3:
                                col_max_v = max(col_max_v, (vals[1]**2 + vals[2]**2)**0.5)  # sqrt(Vy²+Vz²)
                            if len(vals) >= 6:
                                col_max_m = max(col_max_m, (vals[4]**2 + vals[5]**2)**0.5)  # sqrt(My²+Mz²)

                axial_ratios = c.GetAxialCompresRatio()
                acr = _max_from_list([abs(v) for v in axial_ratios])
                max_axial_compression_ratio = max(max_axial_compression_ratio, acr)

                column_results.append({
                    "floor": floor_idx,
                    "pmid": pmid,
                    "axial_compression_ratio": [round(v, 4) for v in axial_ratios],
                    "slenderness_ratio": [round(v, 2) for v in c.GetSlenderRatio()],
                    "max_axial_force_kn": round(col_max_n, 2),
                    "max_shear_force_kn": round(col_max_v, 2),
                    "max_moment_kNm": round(col_max_m, 2),
                })

            floor_idx += 1

        # ---- Node displacements (filter PKPM sentinel 99999) ----
        _SENTINEL = 99990.0
        node_displacements: list[dict[str, Any]] = []
        try:
            for node in result.GetPyNodeInResult():
                disp_dict = node.GetNodeDisp()
                dx = dy = dz = 0.0
                for _key, nd in disp_dict.items():
                    vx = abs(_safe_float(nd.GetDispX()))
                    vy = abs(_safe_float(nd.GetDispY()))
                    vz = abs(_safe_float(nd.GetDispZ()))
                    if vx < _SENTINEL:
                        dx = max(dx, vx)
                    if vy < _SENTINEL:
                        dy = max(dy, vy)
                    if vz < _SENTINEL:
                        dz = max(dz, vz)
                if dx > 0:
                    all_node_disp_x.append(dx)
                if dy > 0:
                    all_node_disp_y.append(dy)
                if dz > 0:
                    all_node_disp_z.append(dz)
                if dx > 0 or dy > 0 or dz > 0:
                    node_displacements.append({
                        "pmid": node.GetPmID(),
                        "floor": node.GetFloorNo(),
                        "max_disp_x_mm": round(dx, 4),
                        "max_disp_y_mm": round(dy, 4),
                        "max_disp_z_mm": round(dz, 4),
                    })
        except Exception:
            pass

        max_displacement = max(
            max(all_node_disp_x, default=0.0),
            max(all_node_disp_y, default=0.0),
            max(all_node_disp_z, default=0.0),
        )

        # ---- Story drift ratios ----
        story_drift: list[dict[str, Any]] = []
        for label, drift_data in result.GetStoryDrift_Earthquake().items():
            for d in drift_data:
                story_drift.append({
                    "direction": label,
                    "floor": d.Getifloor(),
                    "max_displacement_mm": round(_safe_float(d.GetmaxD()), 4),
                    "drift_ratio": round(_safe_float(d.GetratioD()), 6),
                })
        for label, drift_data in result.GetStoryDrift_Wind().items():
            for d in drift_data:
                story_drift.append({
                    "direction": label,
                    "floor": d.Getifloor(),
                    "max_displacement_mm": round(_safe_float(d.GetmaxD()), 4),
                    "drift_ratio": round(_safe_float(d.GetratioD()), 6),
                })

        # ---- Story stiffness ----
        storey_stiffness: list[dict[str, Any]] = []
        for s in result.GetStoreyStifs():
            storey_stiffness.append({
                "floor": s.Getfloorindex(),
                "tower": s.GetTowerIndex(),
                "stiffness_x_kn_m": round(_safe_float(s.GetRJX()), 2),
                "stiffness_y_kn_m": round(_safe_float(s.GetRJY()), 2),
                "ratio_x": round(_safe_float(s.GetRatx()), 4),
                "ratio_y": round(_safe_float(s.GetRaty()), 4),
            })

        # ---- Bearing shear ----
        bearing_shear: list[dict[str, Any]] = []
        for bs in result.GetBearingShear():
            bearing_shear.append({
                "floor": bs.GetFloorNum(),
                "tower": bs.GetTowerNum(),
                "ratio_x": round(_safe_float(bs.GetRatx()), 4),
                "ratio_y": round(_safe_float(bs.GetRaty()), 4),
                "limit_value": round(_safe_float(bs.GetLimitVal()), 4),
            })

        return {
            "mode_periods": mode_periods,
            "beam_count": len(beam_results),
            "column_count": len(column_results),
            "floors_analyzed": floor_idx - 1,
            "summary": {
                "max_displacement_mm": round(max_displacement, 4),
                "max_shear_force_kn": round(max_shear_force, 2),
                "max_bending_moment_kNm": round(max(max_posi_moment, max_nega_moment), 2),
                "max_shear_compression_ratio": round(max_shear_compression_ratio, 4),
                "max_axial_compression_ratio": round(max_axial_compression_ratio, 4),
            },
            "beams": beam_results,
            "columns": column_results,
            "node_displacements": node_displacements,
            "story_drift": story_drift,
            "storey_stiffness": storey_stiffness,
            "bearing_shear": bearing_shear,
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
        model_dict = model.model_dump(mode="json") if hasattr(model, "model_dump") else dict(model)
        jws_path = convert_v2_to_jws(model_dict, work_dir, project_name)
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

    # ---- Phase 4: Map to frontend-compatible analysis result format ----
    pkpm_summary = extracted.get("summary", {})
    node_disps = extracted.get("node_displacements", [])
    beams = extracted.get("beams", [])
    columns = extracted.get("columns", [])

    # displacements: { nodeId: { ux, uy, uz, rx, ry, rz } }
    displacements: Dict[str, Dict[str, float]] = {}
    for nd in node_disps:
        node_id = str(nd.get("pmid", ""))
        if node_id:
            displacements[node_id] = {
                "ux": nd.get("max_disp_x_mm", 0.0),
                "uy": nd.get("max_disp_y_mm", 0.0),
                "uz": nd.get("max_disp_z_mm", 0.0),
                "rx": 0.0,
                "ry": 0.0,
                "rz": 0.0,
            }

    # forces: { elementId: { N, V, M, T, n1.N, n2.N, ... } }
    forces: Dict[str, Dict[str, float]] = {}
    for b in beams:
        elem_id = str(b.get("pmid", ""))
        if not elem_id:
            continue
        shear = b.get("max_shear_force_kn", 0.0)
        posi_moments = b.get("positive_moments_kNm", [])
        nega_moments = b.get("negative_moments_kNm", [])
        max_m = max(
            max([abs(v) for v in posi_moments], default=0.0),
            max([abs(v) for v in nega_moments], default=0.0),
        )
        forces[elem_id] = {
            "V": abs(shear),
            "M": max_m,
        }
    for c in columns:
        elem_id = str(c.get("pmid", ""))
        if not elem_id:
            continue
        col_n = c.get("max_axial_force_kn", 0.0)
        col_v = c.get("max_shear_force_kn", 0.0)
        col_m = c.get("max_moment_kNm", 0.0)
        acr = c.get("axial_compression_ratio", [])
        forces[elem_id] = {
            **(forces.get(elem_id, {})),
            "N": max(col_n, max([abs(v) for v in acr], default=0.0)),
            "V": col_v,
            "M": col_m,
        }

    # envelope for max displacement
    max_disp = pkpm_summary.get("max_displacement_mm", 0.0)
    max_disp_node = ""
    for nid, d in displacements.items():
        mag = (d["ux"] ** 2 + d["uy"] ** 2 + d["uz"] ** 2) ** 0.5
        if mag > 0 and (not max_disp_node or mag > max_disp):
            max_disp_node = nid

    envelope: Dict[str, Any] = {}
    if max_disp_node:
        envelope[f"node:{max_disp_node}:maxAbsDisplacement"] = max_disp

    return {
        "status": "success",
        "analysisMode": "pkpm-satwe",
        "displacements": displacements,
        "forces": forces,
        "reactions": {},
        "envelope": envelope,
        "summary": {
            "maxDisplacement": max_disp,
            "maxDisplacementNode": max_disp_node,
            "nodeCount": len(displacements),
            "elementCount": len(forces),
            "engine": "pkpm-static",
            "jws_path": str(jws_path),
            "work_dir": str(work_dir),
            "floors_analyzed": extracted.get("floors_analyzed", 0),
            "beam_count": extracted.get("beam_count", 0),
            "column_count": extracted.get("column_count", 0),
            **pkpm_summary,
        },
        "pkpm_detailed": {
            "mode_periods": extracted.get("mode_periods", []),
            "beams": beams,
            "columns": columns,
            "node_displacements": node_disps,
            "story_drift": extracted.get("story_drift", []),
            "storey_stiffness": extracted.get("storey_stiffness", []),
            "bearing_shear": extracted.get("bearing_shear", []),
        },
        "warnings": warnings,
    }
