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


def _patch_material_label(work_dir: Path) -> None:
    """Replace 钢砼结构 with 钢结构 in JWSCYCLE output files.

    JWSCYCLE always auto-detects the material type by scanning sections,
    and custom sections via SetUserSect get classified as composite even
    when Set_M(5) and KIND 103=10303 are set correctly.  This post-process
    patch corrects the cosmetic label without affecting analysis results.
    """
    _OLD = "钢砼结构".encode("gbk")
    _NEW = "钢结构".encode("gbk")

    for fname in ("WMASS.OUT", "WHBJSS.OUT"):
        fpath = work_dir / fname
        if not fpath.exists():
            continue
        data = fpath.read_bytes()
        if _OLD in data:
            fpath.write_bytes(data.replace(_OLD, _NEW))


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


def _read_satwe_params(result: Any) -> Dict[str, Any]:
    """Read SATWE design parameters from SysInfoDetail for verification."""
    satwe_params: Dict[str, Any] = {}
    try:
        sys_info = result.GetSysInfoDetail()
        satwe_params["damping_ratio"] = _safe_float(sys_info.GetDamp_whole())
        satwe_params["structure_type"] = _safe_float(sys_info.GetKind_tb())
        satwe_params["seismic_intensity"] = _safe_float(sys_info.GetLiedu())
        satwe_params["site_category"] = _safe_float(sys_info.GetIgrdtype())
        satwe_params["steel_structure_flag"] = _safe_float(sys_info.GetIe_sts())
        satwe_params["solver_type"] = _safe_float(sys_info.GetIsolver())
        satwe_params["mode_count"] = _safe_float(sys_info.GetVb_nmode())
        satwe_params["basement_count"] = _safe_float(sys_info.GetNbasement0())
    except Exception:
        pass
    return satwe_params


def _extract_results(jws_path: Path, material_family: str = "steel") -> Dict[str, Any]:
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
        # Per-load-case force accumulation: {case_name: {(pmid,floor): {N,Vy,Vz,T,My,Mz}}}
        case_beam_forces: Dict[str, Dict[tuple[int, int], Dict[str, float]]] = {}
        case_col_forces: Dict[str, Dict[tuple[int, int], Dict[str, float]]] = {}

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
                            # Accumulate per-case forces (keyed by (pmid, floor) to avoid cross-floor overwrite)
                            beam_key = (pmid, floor_idx)
                            case_beam_forces.setdefault(case_name, {}).setdefault(
                                beam_key, {"N": 0.0, "Vy": 0.0, "Vz": 0.0, "T": 0.0, "My": 0.0, "Mz": 0.0}
                            )
                            entry = case_beam_forces[case_name][beam_key]
                            if len(vals) >= 1: entry["N"] = max(entry["N"], abs(vals[0]))
                            if len(vals) >= 2: entry["Vy"] = max(entry["Vy"], abs(vals[1]))
                            if len(vals) >= 3: entry["Vz"] = max(entry["Vz"], abs(vals[2]))
                            if len(vals) >= 4: entry["T"] = max(entry["T"], abs(vals[3]))
                            if len(vals) >= 5: entry["My"] = max(entry["My"], abs(vals[4]))
                            if len(vals) >= 6: entry["Mz"] = max(entry["Mz"], abs(vals[5]))

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

                # Beam utilization ratio (GetCalcMax1 works for both steel and concrete)
                beam_util = 0.0
                try:
                    beam_util = _max_from_list([abs(v) for v in b.GetCalcMax1()])
                except Exception:
                    pass
                if beam_util < 0.001:
                    beam_util = scr

                beam_results.append({
                    "floor": floor_idx,
                    "pmid": pmid,
                    "max_shear_force_kn": round(shear, 2),
                    "shear_compression_ratio": round(scr, 4),
                    "positive_moments_kNm": [round(v, 2) for v in posi],
                    "negative_moments_kNm": [round(v, 2) for v in nega],
                    "utilization_ratio": round(beam_util, 4),
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
                            # Accumulate per-case forces (keyed by (pmid, floor) to avoid cross-floor overwrite)
                            col_key = (pmid, floor_idx)
                            case_col_forces.setdefault(case_name, {}).setdefault(
                                col_key, {"N": 0.0, "Vy": 0.0, "Vz": 0.0, "T": 0.0, "My": 0.0, "Mz": 0.0}
                            )
                            entry = case_col_forces[case_name][col_key]
                            if len(vals) >= 1: entry["N"] = max(entry["N"], abs(vals[0]))
                            if len(vals) >= 2: entry["Vy"] = max(entry["Vy"], abs(vals[1]))
                            if len(vals) >= 3: entry["Vz"] = max(entry["Vz"], abs(vals[2]))
                            if len(vals) >= 4: entry["T"] = max(entry["T"], abs(vals[3]))
                            if len(vals) >= 5: entry["My"] = max(entry["My"], abs(vals[4]))
                            if len(vals) >= 6: entry["Mz"] = max(entry["Mz"], abs(vals[5]))

                axial_ratios = c.GetAxialCompresRatio()
                acr = _max_from_list([abs(v) for v in axial_ratios])
                max_axial_compression_ratio = max(max_axial_compression_ratio, acr)

                # Column utilization ratio (GetCalcMax1 for both steel/concrete)
                col_util = 0.0
                try:
                    col_util = _max_from_list([abs(v) for v in c.GetCalcMax1()])
                except Exception:
                    pass
                if col_util < 0.001:
                    col_util = acr

                column_results.append({
                    "floor": floor_idx,
                    "pmid": pmid,
                    "axial_compression_ratio": [round(v, 4) for v in axial_ratios],
                    "slenderness_ratio": [round(v, 2) for v in c.GetSlenderRatio()],
                    "max_axial_force_kn": round(col_max_n, 2),
                    "max_shear_force_kn": round(col_max_v, 2),
                    "max_moment_kNm": round(col_max_m, 2),
                    "utilization_ratio": round(col_util, 4),
                })

            floor_idx += 1

        # ---- Node displacements (per-load-case, filter sentinel) ----
        _SENTINEL = 99990.0
        node_displacements: list[dict[str, Any]] = []
        # {case_name: {(pmid,floor): {ux, uy, uz, rx, ry, rz}}}
        case_node_disps: Dict[str, Dict[tuple[int, int], Dict[str, float]]] = {}
        try:
            for node in result.GetPyNodeInResult():
                disp_dict = node.GetNodeDisp()
                best_mag = 0.0
                best_dx = best_dy = best_dz = 0.0
                for case_name, nd in disp_dict.items():
                    vx = _safe_float(nd.GetDispX())
                    vy = _safe_float(nd.GetDispY())
                    vz = _safe_float(nd.GetDispZ())
                    if abs(vx) >= _SENTINEL or abs(vy) >= _SENTINEL or abs(vz) >= _SENTINEL:
                        continue
                    pmid = node.GetPmID()
                    node_key = (pmid, node.GetFloorNo())
                    case_node_disps.setdefault(case_name, {})[node_key] = {
                        "ux": vx, "uy": vy, "uz": vz,
                        "rx": 0.0, "ry": 0.0, "rz": 0.0,
                    }
                    mag = (vx ** 2 + vy ** 2 + vz ** 2) ** 0.5
                    if mag > best_mag:
                        best_mag = mag
                        best_dx, best_dy, best_dz = abs(vx), abs(vy), abs(vz)
                dx, dy, dz = best_dx, best_dy, best_dz
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
            "case_node_disps": case_node_disps,
            "case_beam_forces": case_beam_forces,
            "case_col_forces": case_col_forces,
            "satwe_params": _read_satwe_params(result),
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
        # Detect material family before converter (converter needs it for grade setting)
        from pkpm_converter import _detect_material_family as _conv_detect_mat
        material_family = _conv_detect_mat(model_dict)
        jws_path, converter_mappings = convert_v2_to_jws(
            model_dict, work_dir, project_name, material_family=material_family
        )
    except Exception as exc:
        raise RuntimeError(f"PKPM JWS generation failed: {exc}") from exc

    # ---- Phase 2: Run SATWE via JWSCYCLE.exe ----
    timeout = int(parameters.get("timeout", 600))
    _run_jws_cycle(cycle_path, work_dir, timeout=timeout)

    # ---- Phase 2.5: Post-process output files ----
    if material_family == "steel":
        _patch_material_label(work_dir)

    # ---- Phase 3: Extract results via APIPyInterface ----
    # material_family was already detected in Phase 1 and passed to converter

    try:
        extracted = _extract_results(jws_path, material_family=material_family)
    except Exception as exc:
        warnings.append(f"Result extraction failed: {exc}")
        extracted = {}

    # ---- Phase 4: Map to frontend-compatible analysis result format ----
    pkpm_summary = extracted.get("summary", {})
    node_disps = extracted.get("node_displacements", [])
    beams = extracted.get("beams", [])
    columns = extracted.get("columns", [])

    # ---- Build V2 node → PKPM (floor, pmid) mapping ----
    v2_to_pm: Dict[str, int] = converter_mappings.get("v2_to_pm", {})
    v2_node_z: Dict[str, float] = converter_mappings.get("v2_node_z", {})
    elem_map_raw: Dict[str, Any] = converter_mappings.get("elem_map", {})

    # Build story top elevations for floor mapping
    sorted_stories = sorted(
        model_dict.get("stories", []),
        key=lambda s: float(s.get("elevation", 0)),
    )
    story_tops: list[float] = []
    for st in sorted_stories:
        elev = float(st.get("elevation", 0))
        h = float(st.get("height", 0))
        story_tops.append(elev + h)

    # Map each V2 node to a PKPM floor number (1-indexed)
    v2_node_floor: Dict[str, int] = {}
    for v2_id, z in v2_node_z.items():
        if abs(z) < 0.001:
            v2_node_floor[v2_id] = 0  # base
            continue
        for i, top_z in enumerate(story_tops):
            if abs(z - top_z) < 0.01:
                v2_node_floor[v2_id] = i + 1
                break

    # Build reverse: (pkpm_pmid, floor) → v2_node_id
    pm_floor_to_v2: Dict[tuple[int, int], str] = {}
    for v2_id, pm_id in v2_to_pm.items():
        floor = v2_node_floor.get(v2_id, -1)
        if floor > 0:
            pm_floor_to_v2[(pm_id, floor)] = v2_id

    # displacements: { nodeId: { ux, uy, uz, rx, ry, rz } }
    displacements: Dict[str, Dict[str, float]] = {}
    for nd in node_disps:
        pmid = nd.get("pmid", -1)
        floor = nd.get("floor", 0)
        # Try to remap to V2 node ID
        v2_id = pm_floor_to_v2.get((pmid, floor))
        node_key = v2_id if v2_id else str(pmid)
        if node_key:
            displacements[node_key] = {
                "ux": nd.get("max_disp_x_mm", 0.0),
                "uy": nd.get("max_disp_y_mm", 0.0),
                "uz": nd.get("max_disp_z_mm", 0.0),
                "rx": 0.0,
                "ry": 0.0,
                "rz": 0.0,
            }

    # Build (pmid, floor) → V2 element ID mapping
    # PKPM same pmid repeats on every floor; tuple key disambiguates.
    v2_elem_by_id: Dict[str, dict] = {
        e.get("id", ""): e for e in model_dict.get("elements", [])
    }
    pm_floor_elem_to_v2: Dict[tuple[int, int], str] = {}
    for v2_eid, info in elem_map_raw.items():
        pmid = info["pmid"]
        elem_data = v2_elem_by_id.get(v2_eid)
        if not elem_data:
            continue
        node_ids = elem_data.get("nodes", [])
        start_floor = v2_node_floor.get(node_ids[0], 0) if node_ids else 0
        end_floor = v2_node_floor.get(node_ids[-1], 0) if node_ids else 0
        pkpm_floor = max(start_floor, end_floor)
        if pkpm_floor > 0:
            pm_floor_elem_to_v2[(pmid, pkpm_floor)] = v2_eid

    # forces: { elementId: { N, V, M, Vy, Vz, My, Mz, T } }
    forces: Dict[str, Dict[str, float]] = {}
    # Collect per-element max forces from per-case data for full 6-DOF
    # Build a merged {(pmid, floor): {N,Vy,Vz,T,My,Mz}} taking max across all cases
    elem_max_forces: Dict[tuple[int, int], Dict[str, float]] = {}
    for case_forces_dict in [extracted.get("case_beam_forces", {}), extracted.get("case_col_forces", {})]:
        for _case_name, key_map in case_forces_dict.items():
            for key, f in key_map.items():
                if key not in elem_max_forces:
                    elem_max_forces[key] = {"N": 0.0, "Vy": 0.0, "Vz": 0.0, "T": 0.0, "My": 0.0, "Mz": 0.0}
                entry = elem_max_forces[key]
                for comp in ("N", "Vy", "Vz", "T", "My", "Mz"):
                    entry[comp] = max(entry[comp], f.get(comp, 0.0))

    for key, f in elem_max_forces.items():
        v2_eid = pm_floor_elem_to_v2.get(key)
        elem_id = v2_eid if v2_eid else str(key[0])
        if not elem_id or elem_id == str(-1):
            continue
        forces[elem_id] = {
            "N": f["N"],
            "V": (f["Vy"]**2 + f["Vz"]**2)**0.5,
            "M": (f["My"]**2 + f["Mz"]**2)**0.5,
            "Vy": f["Vy"],
            "Vz": f["Vz"],
            "My": f["My"],
            "Mz": f["Mz"],
            "T": f["T"],
        }

    # ---- Build member utilization map (Phase 5) ----
    member_utilization: Dict[str, float] = {}
    for item in beams + columns:
        pmid = item.get("pmid", -1)
        floor = item.get("floor", 0)
        v2_eid = pm_floor_elem_to_v2.get((pmid, floor))
        util = item.get("utilization_ratio", 0.0)
        if v2_eid and util > 0:
            member_utilization[v2_eid] = round(util, 4)

    # ---- Build caseResults + envelopeTables (Phase 3) ----
    case_node_disps = extracted.get("case_node_disps", {})
    case_beam_forces = extracted.get("case_beam_forces", {})
    case_col_forces = extracted.get("case_col_forces", {})
    floors_analyzed = extracted.get("floors_analyzed", 0)

    all_case_names: set[str] = set()
    all_case_names.update(case_node_disps.keys())
    all_case_names.update(case_beam_forces.keys())
    all_case_names.update(case_col_forces.keys())

    case_results: Dict[str, Dict[str, Any]] = {}
    node_displacement_envelope: Dict[str, Dict[str, Any]] = {}
    element_force_envelope: Dict[str, Dict[str, Any]] = {}

    for case_name in sorted(all_case_names):
        # Per-case displacements — remap (pmid, floor) → V2 node ID
        case_disps: Dict[str, Dict[str, float]] = {}
        for key, disp in case_node_disps.get(case_name, {}).items():
            v2_id = pm_floor_to_v2.get(key)
            if v2_id:
                case_disps[v2_id] = disp
            else:
                case_disps[str(key[0])] = disp

        # Per-case forces — remap (pmid, floor) → V2 element ID
        case_forces_out: Dict[str, Dict[str, float]] = {}
        for key, force in case_beam_forces.get(case_name, {}).items():
            v2_eid = pm_floor_elem_to_v2.get(key)
            elem_id = v2_eid if v2_eid else str(key[0])
            case_forces_out[elem_id] = {
                "N": force["N"],
                "V": (force["Vy"]**2 + force["Vz"]**2)**0.5,
                "M": (force["My"]**2 + force["Mz"]**2)**0.5,
                "Vy": force["Vy"], "Vz": force["Vz"],
                "My": force["My"], "Mz": force["Mz"], "T": force["T"],
            }
        for key, force in case_col_forces.get(case_name, {}).items():
            v2_eid = pm_floor_elem_to_v2.get(key)
            elem_id = v2_eid if v2_eid else str(key[0])
            existing = case_forces_out.get(elem_id, {})
            case_forces_out[elem_id] = {
                **existing,
                "N": force["N"],
                "V": (force["Vy"]**2 + force["Vz"]**2)**0.5,
                "M": (force["My"]**2 + force["Mz"]**2)**0.5,
                "Vy": force["Vy"], "Vz": force["Vz"],
                "My": force["My"], "Mz": force["Mz"], "T": force["T"],
            }

        case_results[case_name] = {
            "status": "success",
            "displacements": case_disps,
            "forces": case_forces_out,
            "reactions": {},
            "envelope": {},
        }

        # Accumulate envelope tables
        for node_id, disp in case_disps.items():
            mag = (disp["ux"]**2 + disp["uy"]**2 + disp["uz"]**2)**0.5
            item = node_displacement_envelope.setdefault(
                str(node_id), {"maxAbsDisplacement": 0.0, "controlCase": ""}
            )
            if mag > item["maxAbsDisplacement"]:
                item["maxAbsDisplacement"] = round(mag, 4)
                item["controlCase"] = case_name

        for elem_id, force in case_forces_out.items():
            item = element_force_envelope.setdefault(
                str(elem_id), {
                    "maxAbsAxialForce": 0.0, "maxAbsShearForce": 0.0, "maxAbsMoment": 0.0,
                    "controlCaseAxial": "", "controlCaseShear": "", "controlCaseMoment": "",
                }
            )
            axial = abs(force.get("N", 0.0))
            shear = abs(force.get("V", 0.0))
            moment = abs(force.get("M", 0.0))
            if axial > item["maxAbsAxialForce"]:
                item["maxAbsAxialForce"] = round(axial, 2)
                item["controlCaseAxial"] = case_name
            if shear > item["maxAbsShearForce"]:
                item["maxAbsShearForce"] = round(shear, 2)
                item["controlCaseShear"] = case_name
            if moment > item["maxAbsMoment"]:
                item["maxAbsMoment"] = round(moment, 2)
                item["controlCaseMoment"] = case_name

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

    # Build result dict
    result_dict: Dict[str, Any] = {
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
            "floors_analyzed": floors_analyzed,
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
        "caseResults": case_results,
        "envelopeTables": {
            "nodeDisplacement": node_displacement_envelope,
            "elementForce": element_force_envelope,
            "nodeReaction": {},
        },
        "warnings": warnings,
    }

    # Add utilization data under correct key for frontend adapter
    if member_utilization:
        check_key = "steelCheck" if material_family == "steel" else "codeCheck"
        result_dict[check_key] = {"memberUtilization": member_utilization}

    return result_dict
