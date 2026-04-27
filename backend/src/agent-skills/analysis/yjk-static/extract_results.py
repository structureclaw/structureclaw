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
  "load_cases": [
      {"id", "key", "name", "expName", "kind", "oldId"}
  ],
  "nodes":  [ {"id", "x", "y", "z"} ],
  "node_disp": {
      "lc_<N>": [ {"id", "ux","uy","uz","rx","ry","rz"} ]
  },
  "node_reactions": {
      "lc_<N>": [ {"id", "fx","fy","fz","mx","my","mz"} ]
  },
  "members": {
      "columns": [
          {"id","tot_id","floor","node_i","node_j","original_no",
           "original_floor","sequence"}
      ],
      "beams":   [ ... ],
      "braces":  [ ... ]
  },
  "member_forces": {
      "columns": {
          "lc_<N>": [
              {"id","tot_id","floor","option","sections":[[Mx,My,Qx,Qy,N,T],...]}
          ]
      },
      "beams":   { ... },
      "braces":  { ... }
  },
  "floor_stats": [ {"floor","stiffness_x","stiffness_y","shear_cap_x","shear_cap_y"} ],
  "extraction_debug": { ... }
}
"""
import json
import os
import traceback

FALLBACK_LOAD_CASES = [1, 2, 3, 4]
FORCE_OPTION = 1
MAX_ERROR_SAMPLES = 80
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


def _debug_path():
    return os.path.join(os.path.dirname(os.path.abspath(_results_path())), "extraction-debug.json")


def _new_debug():
    return {
        "api": {},
        "load_case_source": None,
        "member_counts": {"columns": 0, "beams": 0, "braces": 0},
        "node_counts_by_case": {},
        "member_force_counts": {"columns": {}, "beams": {}, "braces": {}},
        "errors": [],
    }


def _json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(_json_safe(key)): _json_safe(item) for key, item in value.items()}
    try:
        return int(value)
    except Exception:
        return str(value)


def _record_api(debug, name, ok, error=None, args=None):
    stats = debug["api"].setdefault(name, {"success": 0, "failure": 0})
    stats["success" if ok else "failure"] += 1
    if not ok and len(debug["errors"]) < MAX_ERROR_SAMPLES:
        debug["errors"].append({
            "api": name,
            "args": _json_safe(list(args or [])),
            "error": str(error),
        })


def _safe_api(debug, name, fn, *args, default=None):
    try:
        value = fn(*args)
        _record_api(debug, name, True, args=args)
        return value
    except Exception as exc:
        _record_api(debug, name, False, error=exc, args=args)
        return default


def _safe_method(debug, owner_name, obj, method_name, *args, default=None):
    method = getattr(obj, method_name, None)
    api_name = f"{owner_name}.{method_name}"
    if method is None:
        _record_api(debug, api_name, False, error="method unavailable", args=args)
        return default
    return _safe_api(debug, api_name, method, *args, default=default)


def _to_int(value, default=None):
    if value is None:
        return default
    try:
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return default
        return int(float(value))
    except Exception:
        return default


def _to_float(value, default=0.0):
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    try:
        return list(value)
    except Exception:
        return [value]


def _get_attr_or_key(value, names, default=None):
    if isinstance(value, dict):
        for name in names:
            if name in value:
                return value[name]
    for name in names:
        if hasattr(value, name):
            try:
                return getattr(value, name)
            except Exception:
                pass
    return default


def _normalize_top_level_items(raw):
    if raw is None:
        return []
    if isinstance(raw, tuple) and len(raw) >= 2 and isinstance(raw[1], (list, tuple)):
        return _as_list(raw[1])
    if isinstance(raw, list) and len(raw) == 2 and isinstance(raw[1], (list, tuple)):
        count = _to_int(raw[0])
        if count is not None:
            return _as_list(raw[1])
    return _as_list(raw)


def _load_case_rows_from_sort_result(raw):
    values = _as_list(raw)
    if len(values) < 2:
        return []

    count = _to_int(values[0], None)
    if isinstance(values[1], (int, float, str)):
        return []
    case_ids = _as_list(values[1])
    if count is None or not case_ids:
        return []

    old_ids = _as_list(values[2]) if len(values) > 2 else []
    kinds = _as_list(values[3]) if len(values) > 3 else []
    rows = []
    limit = min(count, len(case_ids))
    for idx in range(limit):
        case_id = _to_int(case_ids[idx], None)
        if case_id is None:
            continue
        rows.append({
            "id": case_id,
            "oldId": _to_int(old_ids[idx], case_id) if idx < len(old_ids) else case_id,
            "kind": _to_int(kinds[idx], None) if idx < len(kinds) else None,
        })
    return rows


def _pick_first_string(values):
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _first_int_from_values(values):
    for value in values:
        int_value = _to_int(value)
        if int_value is not None:
            return int_value
    return None


def _load_case_from_item(item):
    if isinstance(item, (int, float, str)):
        case_id = _to_int(item)
        if case_id is None:
            return None
        return {
            "id": case_id,
            "key": f"lc_{case_id}",
            "name": str(item),
            "expName": str(item),
            "kind": None,
            "oldId": case_id,
        }

    if isinstance(item, (list, tuple)):
        values = list(item)
        case_id = _first_int_from_values(values)
        if case_id is None:
            return None
        label = _pick_first_string(values) or str(case_id)
        return {
            "id": case_id,
            "key": f"lc_{case_id}",
            "name": label,
            "expName": label,
            "kind": _to_int(values[2], None) if len(values) > 2 else None,
            "oldId": _to_int(values[3], case_id) if len(values) > 3 else case_id,
        }

    case_id = _to_int(_get_attr_or_key(item, [
        "id", "ID", "Id", "caseId", "CaseID", "nLDCase", "ldCase", "LDCase",
        "no", "No", "NO", "oldId", "OldId", "nOldId",
    ]))
    if case_id is None:
        return None

    name = _get_attr_or_key(item, ["name", "Name", "cName", "strName", "sName"], None)
    exp_name = _get_attr_or_key(item, ["expName", "ExpName", "expression", "Expression"], None)
    kind = _get_attr_or_key(item, ["kind", "Kind", "nKind", "nLDKind", "type", "Type"], None)
    old_id = _get_attr_or_key(item, ["oldId", "OldId", "nOldId", "originalId"], None)
    return {
        "id": case_id,
        "key": f"lc_{case_id}",
        "name": str(name if name is not None else case_id),
        "expName": str(exp_name if exp_name is not None else (name if name is not None else case_id)),
        "kind": _to_int(kind, None),
        "oldId": _to_int(old_id, case_id),
    }


def _dedupe_load_cases(items):
    cases = []
    seen = set()
    for item in items:
        case = _load_case_from_item(item)
        if not case:
            continue
        case_id = case["id"]
        if case_id in seen:
            continue
        seen.add(case_id)
        cases.append(case)
    return cases


def _fallback_load_cases():
    return [_load_case_from_item(case_id) for case_id in FALLBACK_LOAD_CASES]


def _enrich_load_cases(YJKSDsnDataPy, debug, cases):
    enriched = []
    for case in cases:
        case = dict(case)
        case_id = case["id"]
        name = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            "dsnGetLDCaseName",
            case_id,
            default=None,
        )
        exp_name = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            "dsnGetLDCaseExpName",
            case_id,
            default=None,
        )
        kind = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            "dsnGetLDKind",
            case_id,
            default=None,
        )
        old_id = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            "dsnGetLDCaseOldByLDCase",
            case_id,
            default=None,
        )
        if name:
            case["name"] = str(name)
        if exp_name:
            case["expName"] = str(exp_name)
        elif name:
            case["expName"] = str(name)
        if kind is not None:
            case["kind"] = _to_int(kind, case.get("kind"))
        if old_id is not None:
            case["oldId"] = _to_int(old_id, case.get("oldId", case_id))
        case["key"] = f"lc_{case_id}"
        enriched.append(case)
    return enriched


def _get_load_cases(YJKSDsnDataPy, debug):
    for option in (5, 2):
        raw = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            "dsnGetLDCaseBySort",
            option,
            default=None,
        )
        items = _load_case_rows_from_sort_result(raw) or _normalize_top_level_items(raw)
        cases = _dedupe_load_cases(items)
        if cases:
            debug["load_case_source"] = f"dsnGetLDCaseBySort({option})"
            return _enrich_load_cases(YJKSDsnDataPy, debug, cases)
    debug["load_case_source"] = "fallback"
    return _enrich_load_cases(YJKSDsnDataPy, debug, _fallback_load_cases())


def _node_vector_entry(node_id, vector, labels):
    values = _as_list(vector)
    if len(values) < len(labels):
        return None
    entry = {"id": int(node_id)}
    for idx, label in enumerate(labels):
        entry[label] = _to_float(values[idx])
    return entry


def _node_coordinate_entry(pre, debug, node_id):
    xyz = _safe_method(debug, "YJKSPrePy", pre, "XYZ", node_id, default=None)
    if xyz is None:
        x = _safe_method(debug, "YJKSPrePy", pre, "X", node_id, default=0.0)
        y = _safe_method(debug, "YJKSPrePy", pre, "Y", node_id, default=0.0)
        z = _safe_method(debug, "YJKSPrePy", pre, "Z", node_id, default=0.0)
    else:
        xyz_values = _as_list(xyz)
        x = xyz_values[0] if len(xyz_values) > 0 else 0.0
        y = xyz_values[1] if len(xyz_values) > 1 else 0.0
        z = xyz_values[2] if len(xyz_values) > 2 else 0.0
    return {"id": int(node_id), "x": _to_float(x), "y": _to_float(y), "z": _to_float(z)}


def _append_node_results(result, debug, YJKSDsnDataPy, node_id, load_cases):
    for case in load_cases:
        case_id = case["id"]
        key = case["key"]
        d = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            "dsnGetNodeDis",
            node_id,
            case_id,
            default=None,
        )
        disp_entry = _node_vector_entry(node_id, d, ("ux", "uy", "uz", "rx", "ry", "rz"))
        if disp_entry:
            result["node_disp"].setdefault(key, []).append(disp_entry)

        r = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            "dsnGetNodeReaction",
            node_id,
            case_id,
            default=None,
        )
        reaction_entry = _node_vector_entry(node_id, r, ("fx", "fy", "fz", "mx", "my", "mz"))
        if reaction_entry:
            result["node_reactions"].setdefault(key, []).append(reaction_entry)


def _normalize_ids(raw_ids):
    ids = []
    for raw_id in _normalize_top_level_items(raw_ids):
        int_id = _to_int(raw_id)
        if int_id is not None:
            ids.append(int_id)
    return ids


def _get_member_ids(pre, debug, category, floor, config):
    ids = []
    count = None
    count_method = getattr(pre, config["count_method"], None)
    if count_method:
        count = _safe_api(debug, f"YJKSPrePy.{config['count_method']}", count_method, floor, default=None)
        count = _to_int(count, None)

    flr_method = getattr(pre, config["flr_method"], None)
    if flr_method:
        ids = _normalize_ids(
            _safe_api(debug, f"YJKSPrePy.{config['flr_method']}(floor)", flr_method, floor, default=None)
        )
        if not ids and count is not None:
            ids = _normalize_ids(
                _safe_api(
                    debug,
                    f"YJKSPrePy.{config['flr_method']}(floor,count)",
                    flr_method,
                    floor,
                    count,
                    default=None,
                )
            )

    if not ids and config.get("generic_kind") is not None and hasattr(pre, "FlrGJs"):
        ids = _normalize_ids(
            _safe_api(
                debug,
                "YJKSPrePy.FlrGJs",
                pre.FlrGJs,
                config["generic_kind"],
                floor,
                default=None,
            )
        )

    deduped = []
    seen = set()
    for item in ids:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    debug["member_force_counts"].setdefault(category, {})
    return deduped


def _member_pair(pre, debug, member_id, config):
    method = getattr(pre, config["jd_method"], None)
    pair = None
    if method:
        pair = _safe_api(debug, f"YJKSPrePy.{config['jd_method']}", method, member_id, default=None)
    if pair is None and config.get("generic_kind") is not None and hasattr(pre, "GJJD"):
        pair = _safe_api(
            debug,
            "YJKSPrePy.GJJD",
            pre.GJJD,
            config["generic_kind"],
            member_id,
            default=None,
        )
    values = _as_list(pair)
    if len(values) >= 2:
        return _to_int(values[0], -1), _to_int(values[1], -1)
    return -1, -1


def _member_metadata(pre, debug, member_id, floor, sequence, config):
    def call_member_method(method_name):
        method = getattr(pre, method_name, None)
        if not method:
            return None
        return _safe_api(debug, f"YJKSPrePy.{method_name}", method, member_id, default=None)

    node_i, node_j = _member_pair(pre, debug, member_id, config)
    original_no = call_member_method(config["original_no_method"])
    original_floor = call_member_method(config["original_floor_method"])
    local_sequence = call_member_method(config["sequence_method"])

    if original_no is None and config.get("generic_kind") is not None and hasattr(pre, "GJONO"):
        original_no = _safe_api(debug, "YJKSPrePy.GJONO", pre.GJONO, config["generic_kind"], member_id, default=None)
    if original_floor is None and config.get("generic_kind") is not None and hasattr(pre, "GJOFlr"):
        original_floor = _safe_api(debug, "YJKSPrePy.GJOFlr", pre.GJOFlr, config["generic_kind"], member_id, default=None)

    return {
        "id": int(member_id),
        "tot_id": int(member_id),
        "floor": int(floor),
        "node_i": int(node_i),
        "node_j": int(node_j),
        "original_no": _to_int(original_no, int(member_id)),
        "original_floor": _to_int(original_floor, int(floor)),
        "sequence": _to_int(local_sequence, sequence),
    }


def _numeric_row(row):
    if isinstance(row, dict):
        values = [row.get(key) for key in ("Mx", "My", "Qx", "Qy", "N", "T")]
    elif isinstance(row, (list, tuple)):
        if any(isinstance(value, (list, tuple, dict)) for value in list(row)[:6]):
            return None
        values = list(row)
    else:
        values = [
            _get_attr_or_key(row, [key, key.lower()], None)
            for key in ("Mx", "My", "Qx", "Qy", "N", "T")
        ]

    if len(values) < 6:
        return None
    return [_to_float(value) for value in values[:6]]


def _normalize_sections(raw):
    if raw is None:
        return []

    n_sect = None
    force = raw
    if isinstance(raw, (list, tuple)) and len(raw) >= 2 and _to_int(raw[0], None) is not None:
        n_sect = _to_int(raw[0], None)
        force = raw[1]

    numeric_force = _numeric_row(force)
    if numeric_force is not None:
        rows = [force]
    elif isinstance(force, dict):
        def sort_key(key):
            int_key = _to_int(key, None)
            return (0, int_key) if int_key is not None else (1, str(key))

        rows = [force[key] for key in sorted(force.keys(), key=sort_key)]
    else:
        rows = _as_list(force)
        if rows and _numeric_row(rows) is not None:
            rows = [rows]

    if n_sect is not None and n_sect >= 0:
        if len(rows) == n_sect:
            rows = rows[:n_sect]
        elif len(rows) > n_sect:
            rows = rows[1:n_sect + 1]

    sections = []
    for row in rows:
        numeric = _numeric_row(row)
        if numeric is not None:
            sections.append(numeric)
    return sections


def _get_member_force(YJKSDsnDataPy, debug, category, config, floor, tot_id, case_id):
    raw = _safe_method(
        debug,
        "YJKSDsnDataPy",
        YJKSDsnDataPy,
        "dsnGetComStdNL",
        floor,
        config["post_kind"],
        tot_id,
        case_id,
        FORCE_OPTION,
        default=None,
    )
    source = "dsnGetComStdNL"
    sections = _normalize_sections(raw)

    if raw is None:
        raw = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            config["force_method"],
            floor,
            tot_id,
            case_id,
            FORCE_OPTION,
            default=None,
        )
        source = config["force_method"]
        sections = _normalize_sections(raw)

    key = f"lc_{case_id}"
    if sections:
        debug["member_force_counts"][category][key] = debug["member_force_counts"][category].get(key, 0) + 1

    return {
        "id": int(tot_id),
        "tot_id": int(tot_id),
        "floor": int(floor),
        "option": FORCE_OPTION,
        "source": source,
        "sections": sections,
    }


def _write_debug(debug):
    out_path = _debug_path()
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(debug, f, ensure_ascii=False, indent=2)


def extract():
    """Entry point called by ``yjks_pyload``."""
    debug = _new_debug()

    try:
        from YJKAPI import GjKind, PostGjKind, YJKSPrePy, YJKSDsnDataPy
    except ImportError:
        yjkapi = __import__(
            "YJKAPI",
            fromlist=["GjKind", "PostGjKind", "YJKSPrePy", "YJKSDsnDataPy"],
        )
        GjKind = getattr(yjkapi, "GjKind", None)
        PostGjKind = getattr(yjkapi, "PostGjKind", None)
        YJKSPrePy = getattr(yjkapi, "YJKSPrePy", None)
        YJKSDsnDataPy = getattr(yjkapi, "YJKSDsnDataPy", None)
        if YJKSPrePy is None or YJKSDsnDataPy is None:
            raise

    pre = YJKSPrePy()
    YJKSDsnDataPy.dsnInitData()

    post_column = getattr(PostGjKind, "COM_COLUMN", 3) if PostGjKind is not None else 3
    post_beam = getattr(PostGjKind, "COM_BEAM", 1) if PostGjKind is not None else 1
    post_brace = getattr(PostGjKind, "COM_BRACE", 5) if PostGjKind is not None else 5
    gj_column = getattr(GjKind, "IDK_COLM", 11) if GjKind is not None else 11
    gj_beam = getattr(GjKind, "IDK_BEAM", 12) if GjKind is not None else 12
    gj_brace = getattr(GjKind, "IDK_QULI", 15) if GjKind is not None else 15

    member_configs = {
        "columns": {
            "flr_method": "FlrColumns",
            "count_method": "NColumn",
            "jd_method": "ColumnJD",
            "original_no_method": "ColumnONO",
            "original_floor_method": "ColumnOFlr",
            "sequence_method": "ColumnIDInFlr",
            "force_method": "dsnGetColumnStdForce",
            "post_kind": post_column,
            "generic_kind": gj_column,
        },
        "beams": {
            "flr_method": "FlrBeams",
            "count_method": "NBeam",
            "jd_method": "BeamJD",
            "original_no_method": "BeamONO",
            "original_floor_method": "BeamOFlr",
            "sequence_method": "BeamIDInFlr",
            "force_method": "dsnGetBeamStdForce",
            "post_kind": post_beam,
            "generic_kind": gj_beam,
        },
        "braces": {
            "flr_method": "FlrBraces",
            "count_method": "NBrace",
            "jd_method": "BraceJD",
            "original_no_method": "BraceONO",
            "original_floor_method": "BraceOFlr",
            "sequence_method": "BraceIDInFlr",
            "force_method": "dsnGetBraceStdForce",
            "post_kind": post_brace,
            "generic_kind": gj_brace,
        },
    }

    n_floors = _to_int(_safe_method(debug, "YJKSPrePy", pre, "NZRC", default=0), 0)
    n_nodes = _to_int(_safe_method(debug, "YJKSPrePy", pre, "NJD", default=0), 0)
    load_cases = _get_load_cases(YJKSDsnDataPy, debug)
    load_case_ids = [case["id"] for case in load_cases]

    result = {
        "meta": {
            "n_floors": n_floors,
            "n_nodes": n_nodes,
            "load_cases": load_case_ids,
        },
        "load_cases": load_cases,
        "nodes": [],
        "node_disp": {},
        "node_reactions": {},
        "members": {"columns": [], "beams": [], "braces": []},
        "member_forces": {"columns": {}, "beams": {}, "braces": {}},
        "floor_stats": [],
        "extraction_debug": debug,
    }

    node_ids_seen = set()

    # 1. Node coordinates (mm)
    for jd in range(1, n_nodes + 1):
        result["nodes"].append(_node_coordinate_entry(pre, debug, jd))
        node_ids_seen.add(jd)

    # 2. Node displacements and reactions per load case (mm / rad, force / moment)
    for case in load_cases:
        key = case["key"]
        result["node_disp"][key] = []
        result["node_reactions"][key] = []
    for jd in sorted(node_ids_seen):
        _append_node_results(result, debug, YJKSDsnDataPy, jd, load_cases)
    for case in load_cases:
        key = case["key"]
        debug["node_counts_by_case"][key] = {
            "displacements": len(result["node_disp"].get(key, [])),
            "reactions": len(result["node_reactions"].get(key, [])),
        }

    # 3. Member topology and internal forces
    seen_members = {"columns": set(), "beams": set(), "braces": set()}
    members_by_category = {"columns": [], "beams": [], "braces": []}
    for case in load_cases:
        for category in ("columns", "beams", "braces"):
            result["member_forces"][category][case["key"]] = []
            debug["member_force_counts"][category][case["key"]] = 0

    for floor in range(1, n_floors + 1):
        _safe_method(debug, "YJKSDsnDataPy", YJKSDsnDataPy, "dsnReadFloorPJ", floor, default=None)

        for category, config in member_configs.items():
            member_ids = _get_member_ids(pre, debug, category, floor, config)
            for sequence, member_id in enumerate(member_ids, start=1):
                member_key = (floor, member_id)
                if member_key not in seen_members[category]:
                    entry = _member_metadata(pre, debug, member_id, floor, sequence, config)
                    seen_members[category].add(member_key)
                    members_by_category[category].append(entry)
                    result["members"][category].append(entry)

                for case in load_cases:
                    force_entry = _get_member_force(
                        YJKSDsnDataPy,
                        debug,
                        category,
                        config,
                        floor,
                        member_id,
                        case["id"],
                    )
                    result["member_forces"][category][case["key"]].append(force_entry)

    for category in ("columns", "beams", "braces"):
        debug["member_counts"][category] = len(members_by_category[category])

    extra_node_ids = set()
    for raw_members in members_by_category.values():
        for member in raw_members:
            for field in ("node_i", "node_j"):
                node_id = _to_int(member.get(field), None)
                if node_id is not None and node_id > 0 and node_id not in node_ids_seen:
                    extra_node_ids.add(node_id)

    for node_id in sorted(extra_node_ids):
        result["nodes"].append(_node_coordinate_entry(pre, debug, node_id))
        node_ids_seen.add(node_id)
        _append_node_results(result, debug, YJKSDsnDataPy, node_id, load_cases)

    for case in load_cases:
        key = case["key"]
        debug["node_counts_by_case"][key] = {
            "displacements": len(result["node_disp"].get(key, [])),
            "reactions": len(result["node_reactions"].get(key, [])),
        }

    # 4. Floor statistics: stiffness and shear capacity
    for floor in range(1, n_floors + 1):
        stiff = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            "dsnGetFlrStiff",
            floor,
            1,
            default=([0, 0], [0, 0]),
        )
        shear = _safe_method(
            debug,
            "YJKSDsnDataPy",
            YJKSDsnDataPy,
            "dsnGetFlrShearCapacity",
            floor,
            1,
            default=[0, 0],
        )
        stiff_values = _as_list(stiff)
        dSC = stiff_values[1] if len(stiff_values) > 1 else [0, 0]
        dSC = _as_list(dSC)
        shear_values = _as_list(shear)
        result["floor_stats"].append({
            "floor": floor,
            "stiffness_x": _to_float(dSC[0] if len(dSC) > 0 else 0.0),
            "stiffness_y": _to_float(dSC[1] if len(dSC) > 1 else 0.0),
            "shear_cap_x": _to_float(shear_values[0] if len(shear_values) > 0 else 0.0),
            "shear_cap_y": _to_float(shear_values[1] if len(shear_values) > 1 else 0.0),
        })

    # 5. Write JSON outputs
    out_path = _results_path()
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    _write_debug(debug)
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

    debug = _new_debug()
    debug["errors"].append({
        "api": "extract_results.py",
        "args": [],
        "error": str(exc),
    })
    _write_debug(debug)
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
