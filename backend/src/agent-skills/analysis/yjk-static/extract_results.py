# -*- coding: utf-8 -*-
"""YJK result extraction -- runs INSIDE the YJK process via yjks_pyload.

Invocation (from remote-control driver):
    YJKSControl.RunCmd("yjks_pyload", script_path, "pyyjks")

The script writes ``results.json`` to ``SC_YJK_RESULTS_PATH`` when set,
otherwise to ``SC_YJK_WORK_DIR/results.json`` or next to itself.  The driver
copies this script into the current work directory before loading it, so the
normal output path is the current run's ``work_dir/results.json``.

JSON schema:
{
  "meta":   { "n_floors", "n_nodes", "load_cases" },
  "nodes":  [ {"id", "x", "y", "z"} ],
  "node_disp": {
      "lc_<N>": [ {"id", "ux","uy","uz","rx","ry","rz"} ]
  },
  "members": {
      "columns": [ {"id","floor","node_i","node_j"} ],
      "beams":   [ {"id","floor","node_i","node_j"} ],
      "braces":  [ {"id","floor","node_i","node_j"} ]
  },
  "member_forces": {
      "columns": { "lc_<N>": [ {"id","floor","sections":[[Mx,My,Qx,Qy,N,T],...]} ] },
      "beams":   { ... },
      "braces":  { ... }
  },
  "floor_stats": [ {"floor","stiffness_x","stiffness_y","shear_cap_x","shear_cap_y"} ]
}
"""
import json
import os
import traceback

LOAD_CASES = [1, 2, 3, 4]
_HAS_RUN = False


def _results_path():
    explicit = os.environ.get("SC_YJK_RESULTS_PATH", "").strip()
    if explicit:
        return explicit

    work_dir = os.environ.get("SC_YJK_WORK_DIR", "").strip()
    if work_dir:
        return os.path.join(work_dir, "results.json")

    out_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(out_dir, "results.json")


def _safe(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception:
        return default


def extract():
    """Entry point called by ``yjks_pyload``."""
    try:
        from YJKAPI import YJKSPrePy, YJKSDsnDataPy
    except ImportError:
        yjkapi = __import__("YJKAPI", fromlist=["YJKSPrePy", "YJKSDsnDataPy"])
        YJKSPrePy = getattr(yjkapi, "YJKSPrePy", None)
        YJKSDsnDataPy = getattr(yjkapi, "YJKSDsnDataPy", None)
        if YJKSPrePy is None or YJKSDsnDataPy is None:
            raise

    pre = YJKSPrePy()
    YJKSDsnDataPy.dsnInitData()

    n_floors = pre.NZRC()
    n_nodes = pre.NJD()

    result = {
        "meta": {
            "n_floors": n_floors,
            "n_nodes": n_nodes,
            "load_cases": LOAD_CASES,
        },
        "nodes": [],
        "node_disp": {},
        "members": {"columns": [], "beams": [], "braces": []},
        "member_forces": {"columns": {}, "beams": {}, "braces": {}},
        "floor_stats": [],
    }

    # 1. Node coordinates (mm)
    for jd in range(1, n_nodes + 1):
        xyz = _safe(pre.XYZ, jd, default=None)
        if xyz is None:
            x = _safe(pre.X, jd, default=0.0)
            y = _safe(pre.Y, jd, default=0.0)
            z = _safe(pre.Z, jd, default=0.0)
        else:
            x, y, z = float(xyz[0]), float(xyz[1]), float(xyz[2])
        result["nodes"].append({"id": jd, "x": x, "y": y, "z": z})

    # 2. Node displacements per load case (mm / rad)
    for lc in LOAD_CASES:
        key = f"lc_{lc}"
        disp_list = []
        for jd in range(1, n_nodes + 1):
            d = _safe(YJKSDsnDataPy.dsnGetNodeDis, jd, lc, default=None)
            if d and len(d) >= 6:
                disp_list.append({
                    "id": jd,
                    "ux": float(d[0]), "uy": float(d[1]), "uz": float(d[2]),
                    "rx": float(d[3]), "ry": float(d[4]), "rz": float(d[5]),
                })
        result["node_disp"][key] = disp_list

    # 3. Member topology and internal forces
    for lc in LOAD_CASES:
        result["member_forces"]["columns"][f"lc_{lc}"] = []
        result["member_forces"]["beams"][f"lc_{lc}"] = []
        result["member_forces"]["braces"][f"lc_{lc}"] = []

    for iFlr in range(1, n_floors + 1):
        _safe(YJKSDsnDataPy.dsnReadFloorPJ, iFlr)

        # -- Columns --
        col_ids = _safe(pre.FlrColumns, iFlr, default=[]) or []
        for cid in col_ids:
            jd_pair = _safe(pre.ColumnJD, cid, default=None)
            entry = {
                "id": int(cid), "floor": iFlr,
                "node_i": int(jd_pair[0]) if jd_pair else -1,
                "node_j": int(jd_pair[1]) if jd_pair else -1,
            }
            if not any(c["id"] == entry["id"] for c in result["members"]["columns"]):
                result["members"]["columns"].append(entry)
            for lc in LOAD_CASES:
                raw = _safe(
                    YJKSDsnDataPy.dsnGetColumnStdForce,
                    iFlr, cid, lc, 1, default=(0, []),
                ) or (0, [])
                nSect, Force = raw
                sects = (
                    [[float(v) for v in Force[s]] for s in range(nSect)]
                    if nSect else []
                )
                result["member_forces"]["columns"][f"lc_{lc}"].append(
                    {"id": int(cid), "floor": iFlr, "sections": sects}
                )

        # -- Beams --
        beam_ids = _safe(pre.FlrBeams, iFlr, default=[]) or []
        for bid in beam_ids:
            jd_pair = _safe(pre.BeamJD, bid, default=None)
            entry = {
                "id": int(bid), "floor": iFlr,
                "node_i": int(jd_pair[0]) if jd_pair else -1,
                "node_j": int(jd_pair[1]) if jd_pair else -1,
            }
            if not any(b["id"] == entry["id"] for b in result["members"]["beams"]):
                result["members"]["beams"].append(entry)
            for lc in LOAD_CASES:
                raw = _safe(
                    YJKSDsnDataPy.dsnGetBeamStdForce,
                    iFlr, bid, lc, 1, default=(0, []),
                ) or (0, [])
                nSect, Force = raw
                sects = (
                    [[float(v) for v in Force[s]] for s in range(nSect)]
                    if nSect else []
                )
                result["member_forces"]["beams"][f"lc_{lc}"].append(
                    {"id": int(bid), "floor": iFlr, "sections": sects}
                )

        # -- Braces --
        brace_ids = _safe(pre.FlrBraces, iFlr, default=[]) or []
        for rid in brace_ids:
            jd_pair = _safe(pre.BraceJD, rid, default=None)
            entry = {
                "id": int(rid), "floor": iFlr,
                "node_i": int(jd_pair[0]) if jd_pair else -1,
                "node_j": int(jd_pair[1]) if jd_pair else -1,
            }
            if not any(r["id"] == entry["id"] for r in result["members"]["braces"]):
                result["members"]["braces"].append(entry)
            for lc in LOAD_CASES:
                raw = _safe(
                    YJKSDsnDataPy.dsnGetBraceStdForce,
                    iFlr, rid, lc, 1, default=(0, []),
                ) or (0, [])
                nSect, Force = raw
                sects = (
                    [[float(v) for v in Force[s]] for s in range(nSect)]
                    if nSect else []
                )
                result["member_forces"]["braces"][f"lc_{lc}"].append(
                    {"id": int(rid), "floor": iFlr, "sections": sects}
                )

    # 4. Floor statistics: stiffness and shear capacity
    for iFlr in range(1, n_floors + 1):
        stiff = _safe(YJKSDsnDataPy.dsnGetFlrStiff, iFlr, 1, default=([0, 0], [0, 0]))
        shear = _safe(YJKSDsnDataPy.dsnGetFlrShearCapacity, iFlr, 1, default=[0, 0])
        dSC = stiff[1] if stiff else [0, 0]
        result["floor_stats"].append({
            "floor": iFlr,
            "stiffness_x": float(dSC[0]) if dSC else 0.0,
            "stiffness_y": float(dSC[1]) if dSC else 0.0,
            "shear_cap_x": float(shear[0]) if shear else 0.0,
            "shear_cap_y": float(shear[1]) if shear else 0.0,
        })

    # 5. Write JSON
    out_path = _results_path()
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print("Results exported:", out_path)
    return out_path


def _write_error(exc):
    out_path = _results_path()
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    payload = {
        "status": "error",
        "phase": "result_extraction",
        "command": "extract_results.py",
        "error": str(exc),
        "traceback": traceback.format_exc(),
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print("Result extraction failed:", out_path)
    return out_path


def _autorun():
    global _HAS_RUN
    if _HAS_RUN:
        return _results_path()
    _HAS_RUN = True
    try:
        return extract()
    except Exception as exc:
        return _write_error(exc)


def pyyjks():
    """YJK ``yjks_pyload`` default callback name."""
    return _autorun()


def _should_autorun():
    if os.environ.get("SC_YJK_EXTRACT_NO_AUTORUN", "").strip() == "1":
        return False
    if __name__ == "__main__":
        return True
    if os.environ.get("SC_YJK_RESULTS_PATH", "").strip():
        return True
    if os.environ.get("SC_YJK_WORK_DIR", "").strip():
        return True
    return False


if _should_autorun():
    _autorun()
