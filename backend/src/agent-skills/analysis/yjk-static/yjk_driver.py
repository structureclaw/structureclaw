# -*- coding: utf-8 -*-
"""YJK analysis driver -- subprocess entry point.

Must run under YJK's bundled Python 3.10.  Do NOT add extra CLI
arguments; YJKAPI uses sys.argv[1] for internal state and will
break if unexpected args are present.

Usage (called by runtime.py via subprocess):
    <YJK_PYTHON> yjk_driver.py <model.json> <work_dir>

Reads the V2 model JSON, converts to .ydb, launches YJK GUI, runs a
full static analysis, loads extract_results.py inside YJK, reads the
current work_dir/results.json file, and outputs the final result JSON
to stdout.

The sequence below strictly follows the proven three_story_steel_frame.py
pattern from the YJK SDK.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time
import traceback

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _record_step(
    steps: list[dict],
    *,
    phase: str,
    name: str,
    status: str,
    command: str | None = None,
    message: str | None = None,
    started_at: float | None = None,
    **extra: object,
) -> None:
    step: dict = {
        "phase": phase,
        "name": name,
        "status": status,
    }
    if command:
        step["command"] = command
    if message:
        step["message"] = message
    if started_at is not None:
        step["elapsed_ms"] = round((time.monotonic() - started_at) * 1000)
    step.update({k: v for k, v in extra.items() if v is not None})
    steps.append(step)


def _emit_json(payload: dict) -> None:
    """Write the final result JSON to stdout (the ONLY stdout we produce).

    Flush stderr first so any YJKAPI noise that leaked to stdout is
    already written, then write our JSON on its own line.
    """
    sys.stderr.flush()
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _error(
    message: str,
    *,
    phase: str | None = None,
    command: str | None = None,
    steps: list[dict] | None = None,
    summary: dict | None = None,
    detailed: dict | None = None,
) -> None:
    detail = {"error": message}
    if phase:
        detail["phase"] = phase
    if command:
        detail["command"] = command
    if detailed:
        detail.update(detailed)

    summary_payload = {"engine": "yjk-static"}
    if summary:
        summary_payload.update(summary)

    _emit_json({
        "status": "error",
        "summary": summary_payload,
        "data": {},
        "detailed": detail,
        "warnings": [message],
        "steps": steps or [],
    })


def _setup_paths() -> str:
    """Set up sys.path and os.environ["PATH"] for YJK.

    Returns the resolved YJKS_ROOT directory.
    """
    yjks_root = (
        os.environ.get("YJKS_ROOT", "").strip().strip('"')
        or os.environ.get("YJK_PATH", "").strip().strip('"')
    )
    if not yjks_root:
        for candidate in (r"C:\YJKS\YJKS_8_0_0", r"D:\YJKS\YJKS_8_0_0"):
            if os.path.isdir(candidate):
                yjks_root = candidate
                break

    yjks_exe_env = os.environ.get("YJKS_EXE", "").strip().strip('"')
    if yjks_exe_env and os.path.isfile(yjks_exe_env):
        root = os.path.dirname(os.path.abspath(yjks_exe_env))
    elif os.path.isdir(yjks_root):
        root = yjks_root
    else:
        root = yjks_root

    # DLL search path
    os.environ["PATH"] = root + os.pathsep + os.environ.get("PATH", "")

    # Python import paths: YJKS_ROOT itself (for native wrappers) and
    # the driver's own directory (for yjk_converter).
    for p in (root, SCRIPT_DIR):
        if p and p not in sys.path:
            sys.path.insert(0, p)

    return root


def _find_yjks_exe(root: str) -> str | None:
    for name in ("yjks.exe", "YJKS.exe"):
        p = os.path.join(root, name)
        if os.path.isfile(p):
            return p
    return None


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _find_yjk_launcher(root: str) -> str | None:
    explicit = os.environ.get("YJK_LAUNCHER_EXE", "").strip().strip('"')
    if explicit and os.path.isfile(explicit):
        return explicit
    for name in ("YjkLauncher.exe", "YJKLauncher.exe"):
        p = os.path.join(root, name)
        if os.path.isfile(p):
            return p
    return None


def _should_launch_with_launcher(root: str) -> bool:
    explicit = os.environ.get("YJK_USE_LAUNCHER", "").strip()
    if explicit:
        return _env_flag("YJK_USE_LAUNCHER")
    return False


def _direct_launch_cwd(yjks_root: str) -> str:
    configured = os.environ.get("YJK_CWD", "").strip().strip('"')
    if configured and os.path.isdir(configured):
        return configured
    return yjks_root


def _get_yjks_processes() -> list[dict]:
    import subprocess

    command = (
        "Get-Process | Where-Object { $_.ProcessName -ieq 'yjks' } | "
        "Select-Object Id,Path,MainWindowTitle | ConvertTo-Json -Compress"
    )
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
    except Exception:
        return []
    text = (proc.stdout or "").strip()
    if proc.returncode != 0 or not text:
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return []
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


def _wait_for_new_yjks_process(before_pids: set[int], timeout_s: float) -> dict | None:
    deadline = time.monotonic() + timeout_s
    last_seen: dict | None = None
    while time.monotonic() < deadline:
        for proc in _get_yjks_processes():
            pid = int(_safe_float(proc.get("Id"), 0.0))
            if pid <= 0:
                continue
            last_seen = proc
            if pid not in before_pids:
                return proc
        if last_seen and not before_pids:
            return last_seen
        time.sleep(1.0)
    return last_seen


def _find_main_window_for_pid(pid: int) -> int | None:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    hwnd_result: list[int] = []

    enum_proc_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def _callback(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        proc_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(proc_id))
        if int(proc_id.value) != pid:
            return True
        title_len = user32.GetWindowTextLengthW(hwnd)
        if title_len <= 0:
            return True
        hwnd_result.append(int(hwnd))
        return False

    user32.EnumWindows(enum_proc_type(_callback), 0)
    return hwnd_result[0] if hwnd_result else None


def _send_virtual_key(vk: int) -> None:
    import ctypes

    user32 = ctypes.windll.user32
    KEYEVENTF_KEYUP = 0x0002
    user32.keybd_event(vk, 0, 0, 0)
    time.sleep(0.03)
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def _send_unicode_text(text: str) -> None:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 0x0002
    KEYEVENTF_UNICODE = 0x0004

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class INPUT_UNION(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("union", INPUT_UNION)]

    def _send_char(ch: str, keyup: bool) -> None:
        flags = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if keyup else 0)
        event = INPUT(
            type=INPUT_KEYBOARD,
            union=INPUT_UNION(ki=KEYBDINPUT(0, ord(ch), flags, 0, None)),
        )
        user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(event))

    for ch in text:
        if ch in ("\r", "\n"):
            _send_virtual_key(0x0D)
            continue
        _send_char(ch, False)
        _send_char(ch, True)
        time.sleep(0.01)


def _activate_yjk_ipc(pid: int) -> bool:
    hwnd = _find_main_window_for_pid(pid)
    if not hwnd:
        return False

    import ctypes

    user32 = ctypes.windll.user32
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    time.sleep(float(os.environ.get("YJK_AUTO_IPC_FOCUS_DELAY_S", "1.0").strip() or "1.0"))
    _send_virtual_key(0x1B)  # ESC clears most modal command states.
    time.sleep(0.2)
    _send_unicode_text("yjksipccontrol\n")
    return True


def _launch_yjk_with_launcher_and_attach(
    *,
    yjks_root: str,
    cfg: object,
    yjks_control: object,
    steps: list[dict],
) -> str | None:
    import subprocess

    launcher = _find_yjk_launcher(yjks_root)
    if not launcher:
        _record_step(
            steps,
            phase="launch",
            name="Find YJK launcher",
            command="YjkLauncher.exe",
            status="error",
            message=f"YjkLauncher.exe not found under {yjks_root}",
        )
        return None

    before_pids = {
        int(_safe_float(proc.get("Id"), 0.0))
        for proc in _get_yjks_processes()
        if int(_safe_float(proc.get("Id"), 0.0)) > 0
    }
    started_at = time.monotonic()
    cwd = os.environ.get("YJK_LAUNCHER_CWD", "").strip().strip('"') or yjks_root
    try:
        subprocess.Popen([launcher], cwd=cwd)
    except Exception as exc:
        _record_step(
            steps,
            phase="launch",
            name="Launch YJK via launcher",
            command=launcher,
            status="error",
            message=str(exc),
            started_at=started_at,
        )
        return None
    _record_step(
        steps,
        phase="launch",
        name="Launch YJK via launcher",
        command=launcher,
        status="success",
        started_at=started_at,
    )

    wait_timeout = float(os.environ.get("YJK_LAUNCHER_WAIT_S", "90").strip() or "90")
    proc_info = _wait_for_new_yjks_process(before_pids, wait_timeout)
    if not proc_info:
        _record_step(
            steps,
            phase="launch",
            name="Wait for yjks.exe",
            command="Get-Process yjks",
            status="error",
            message=f"YjkLauncher.exe did not start yjks.exe within {wait_timeout}s",
        )
        return None

    pid = int(_safe_float(proc_info.get("Id"), 0.0))
    time.sleep(float(os.environ.get("YJK_AUTO_IPC_DELAY_S", "8").strip() or "8"))
    ipc_enabled = True
    if not _env_flag("YJK_SKIP_AUTO_IPC"):
        ipc_enabled = _activate_yjk_ipc(pid)
    _record_step(
        steps,
        phase="launch",
        name="Enable YJK IPC command",
        command="yjksipccontrol",
        status="success" if ipc_enabled else "warning",
        message=(
            "Sent yjksipccontrol to the YJK window"
            if ipc_enabled
            else "Could not find an active YJK window; attempting attach anyway"
        ),
        pid=pid,
    )

    try:
        setattr(cfg, "Pid", pid)
        result = yjks_control.initConfig(cfg)
    except Exception as exc:
        _record_step(
            steps,
            phase="launch",
            name="Attach launched YJK",
            command="initConfig(Pid)",
            status="error",
            message=str(exc),
            pid=pid,
        )
        return None
    _record_step(
        steps,
        phase="launch",
        name="Attach launched YJK",
        command="initConfig(Pid)",
        status="success",
        message=str(result),
        pid=pid,
    )
    return f"launcher-attached:{pid}"


def _run_cmd(
    cmd: str,
    arg: str = "",
    *,
    phase: str,
    steps: list[dict],
) -> bool:
    """Execute a YJK command and return success status.

    Returns True if the command succeeded, False if YJK is no longer running.
    """
    from YJKAPI import YJKSControl
    print(f"[yjk_driver] RunCmd({cmd!r}, {arg!r})", file=sys.stderr, flush=True)
    started_at = time.monotonic()
    try:
        YJKSControl.RunCmd(cmd, arg)
        # Check if YJK is still running after the command
        if not _is_yjk_running():
            message = f"YJK process terminated after {cmd}"
            print(f"[yjk_driver] WARNING: {message}", file=sys.stderr, flush=True)
            _record_step(
                steps,
                phase=phase,
                name=cmd,
                command=cmd,
                status="error",
                message=message,
                started_at=started_at,
            )
            return False
        _record_step(
            steps,
            phase=phase,
            name=cmd,
            command=cmd,
            status="success",
            started_at=started_at,
        )
        return True
    except Exception as exc:
        print(f"[yjk_driver] ERROR in RunCmd({cmd}): {exc}", file=sys.stderr, flush=True)
        _record_step(
            steps,
            phase=phase,
            name=cmd,
            command=cmd,
            status="error",
            message=str(exc),
            started_at=started_at,
        )
        return False


def _is_yjk_running() -> bool:
    """Check if the YJK process is still running."""
    try:
        return bool(_get_yjks_processes())
    except Exception:
        return True  # Assume running if we can't check


def _collect_out_files(work_dir: str) -> str:
    """Read .OUT/.out files under work_dir as fallback result text."""
    lines: list[str] = []
    for dirpath, _dirs, files in os.walk(work_dir):
        for f in sorted(files):
            if f.upper().endswith(".OUT"):
                fp = os.path.join(dirpath, f)
                try:
                    text = open(fp, encoding="gbk", errors="replace").read()
                    lines.append(f"=== {f} ===\n{text[:3000]}")
                except Exception:
                    pass
    return "\n\n".join(lines) if lines else "(no .OUT files found)"


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_abs_max(current: float, value: object) -> float:
    return max(abs(current), abs(_safe_float(value)))


def _round_map(values: dict[str, float], digits: int = 4) -> dict[str, float]:
    return {key: round(_safe_float(value), digits) for key, value in values.items()}


def _load_json_file(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _node_lookup_from_mapping(mapping: dict) -> dict[tuple[int, int, int], str]:
    lookup: dict[tuple[int, int, int], str] = {}
    nodes = mapping.get("nodes", {})
    if not isinstance(nodes, dict):
        return lookup

    for v2_id, item in nodes.items():
        if not isinstance(item, dict):
            continue
        key = (
            int(round(_safe_float(item.get("x_mm")))),
            int(round(_safe_float(item.get("y_mm")))),
            int(round(_safe_float(item.get("z_mm")))),
        )
        lookup[key] = str(item.get("v2_id") or v2_id)
    return lookup


def _build_result_node_lookup(extracted: dict, mapping: dict) -> dict[str, str]:
    coord_to_v2 = _node_lookup_from_mapping(mapping)
    result_lookup: dict[str, str] = {}
    for node in extracted.get("nodes", []) if isinstance(extracted.get("nodes"), list) else []:
        if not isinstance(node, dict):
            continue
        result_id = str(node.get("id"))
        key = (
            int(round(_safe_float(node.get("x")))),
            int(round(_safe_float(node.get("y")))),
            int(round(_safe_float(node.get("z")))),
        )
        result_lookup[result_id] = coord_to_v2.get(key, result_id)
    return result_lookup


def _element_category(elem_type: object) -> str:
    normalized = str(elem_type or "").lower()
    if normalized == "column":
        return "columns"
    if normalized in ("brace", "braces", "truss"):
        return "braces"
    return "beams"


def _build_element_lookups(mapping: dict) -> tuple[dict[tuple[str, int, str], str], dict[tuple[str, int, int], str]]:
    by_yjk_id: dict[tuple[str, int, str], str] = {}
    by_sequence: dict[tuple[str, int, int], str] = {}
    elements = mapping.get("elements", {})
    if not isinstance(elements, dict):
        return by_yjk_id, by_sequence

    for v2_id, item in elements.items():
        if not isinstance(item, dict):
            continue
        elem_id = str(item.get("v2_id") or v2_id)
        category = _element_category(item.get("type"))
        floor_index = int(round(_safe_float(item.get("floor_index"), 0.0)))
        yjk_model_id = item.get("yjk_model_id")
        if yjk_model_id is not None:
            by_yjk_id[(category, floor_index, str(yjk_model_id))] = elem_id

        fallback = item.get("fallback_match", {})
        if isinstance(fallback, dict):
            sequence = int(round(_safe_float(fallback.get("sequence_in_floor_type"), 0.0)))
            if floor_index > 0 and sequence > 0:
                by_sequence[(category, floor_index, sequence)] = elem_id
    return by_yjk_id, by_sequence


def _member_id_for(
    *,
    category: str,
    floor: int,
    member_id: object,
    sequence: int,
    by_yjk_id: dict[tuple[str, int, str], str],
    by_sequence: dict[tuple[str, int, int], str],
) -> str:
    direct = by_yjk_id.get((category, floor, str(member_id)))
    if direct:
        return direct
    fallback = by_sequence.get((category, floor, sequence))
    if fallback:
        return fallback
    return f"{category}:{floor}:{member_id}"


def _force_from_sections(sections: object) -> dict[str, float]:
    """Map YJK section force rows [Mx, My, Qx, Qy, N, T] to common fields."""
    force = {"N": 0.0, "Vy": 0.0, "Vz": 0.0, "T": 0.0, "My": 0.0, "Mz": 0.0}
    if not isinstance(sections, list):
        force["V"] = 0.0
        force["M"] = 0.0
        return force

    for row in sections:
        if not isinstance(row, list):
            continue
        values = [_safe_float(item) for item in row]
        while len(values) < 6:
            values.append(0.0)
        mx, my, qx, qy, axial, torsion = values[:6]
        force["N"] = _as_abs_max(force["N"], axial)
        force["Vy"] = _as_abs_max(force["Vy"], qx)
        force["Vz"] = _as_abs_max(force["Vz"], qy)
        force["T"] = _as_abs_max(force["T"], torsion)
        force["My"] = _as_abs_max(force["My"], my)
        force["Mz"] = _as_abs_max(force["Mz"], mx)

    force["V"] = (force["Vy"] ** 2 + force["Vz"] ** 2) ** 0.5
    force["M"] = (force["My"] ** 2 + force["Mz"] ** 2) ** 0.5
    return force


def _merge_max_force(target: dict[str, float], candidate: dict[str, float]) -> dict[str, float]:
    merged = dict(target)
    for key in ("N", "Vy", "Vz", "T", "My", "Mz", "V", "M"):
        merged[key] = max(abs(_safe_float(merged.get(key))), abs(_safe_float(candidate.get(key))))
    return merged


def _accumulate_node_envelope(
    table: dict[str, dict],
    node_id: str,
    case_name: str,
    disp: dict[str, float],
) -> None:
    mag = (
        _safe_float(disp.get("ux")) ** 2
        + _safe_float(disp.get("uy")) ** 2
        + _safe_float(disp.get("uz")) ** 2
    ) ** 0.5
    item = table.setdefault(str(node_id), {"maxAbsDisplacement": 0.0, "controlCase": ""})
    if mag > _safe_float(item.get("maxAbsDisplacement")):
        item["maxAbsDisplacement"] = round(mag, 4)
        item["controlCase"] = case_name


def _accumulate_element_envelope(
    table: dict[str, dict],
    elem_id: str,
    case_name: str,
    force: dict[str, float],
) -> None:
    item = table.setdefault(
        str(elem_id),
        {
            "maxAbsAxialForce": 0.0,
            "maxAbsShearForce": 0.0,
            "maxAbsMoment": 0.0,
            "controlCaseAxial": "",
            "controlCaseShear": "",
            "controlCaseMoment": "",
        },
    )
    axial = abs(_safe_float(force.get("N")))
    shear = abs(_safe_float(force.get("V")))
    moment = abs(_safe_float(force.get("M")))
    if axial > _safe_float(item.get("maxAbsAxialForce")):
        item["maxAbsAxialForce"] = round(axial, 2)
        item["controlCaseAxial"] = case_name
    if shear > _safe_float(item.get("maxAbsShearForce")):
        item["maxAbsShearForce"] = round(shear, 2)
        item["controlCaseShear"] = case_name
    if moment > _safe_float(item.get("maxAbsMoment")):
        item["maxAbsMoment"] = round(moment, 2)
        item["controlCaseMoment"] = case_name


def _build_analysis_result(
    *,
    extracted: dict,
    mapping: dict,
    ydb_path: str,
    yjk_project: str,
    work_dir: str,
    results_path: str,
    steps: list[dict],
) -> dict:
    """Normalize raw YJK result JSON into the app's analysis result shape."""
    meta = extracted.get("meta", {}) if isinstance(extracted.get("meta"), dict) else {}
    result_node_lookup = _build_result_node_lookup(extracted, mapping)
    elem_by_yjk_id, elem_by_sequence = _build_element_lookups(mapping)

    displacements: dict[str, dict[str, float]] = {}
    forces: dict[str, dict[str, float]] = {}
    case_results: dict[str, dict] = {}
    node_displacement_envelope: dict[str, dict] = {}
    element_force_envelope: dict[str, dict] = {}

    node_disp_cases = extracted.get("node_disp", {})
    if not isinstance(node_disp_cases, dict):
        node_disp_cases = {}
    member_force_blocks = extracted.get("member_forces", {})
    if not isinstance(member_force_blocks, dict):
        member_force_blocks = {}

    all_case_names = set(node_disp_cases.keys())
    for block in member_force_blocks.values():
        if isinstance(block, dict):
            all_case_names.update(block.keys())

    for case_name in sorted(all_case_names):
        case_disps: dict[str, dict[str, float]] = {}
        raw_disps = node_disp_cases.get(case_name, [])
        if isinstance(raw_disps, list):
            for raw_disp in raw_disps:
                if not isinstance(raw_disp, dict):
                    continue
                raw_node_id = str(raw_disp.get("id"))
                node_id = result_node_lookup.get(raw_node_id, raw_node_id)
                disp = _round_map({
                    "ux": _safe_float(raw_disp.get("ux")),
                    "uy": _safe_float(raw_disp.get("uy")),
                    "uz": _safe_float(raw_disp.get("uz")),
                    "rx": _safe_float(raw_disp.get("rx")),
                    "ry": _safe_float(raw_disp.get("ry")),
                    "rz": _safe_float(raw_disp.get("rz")),
                })
                case_disps[node_id] = disp
                _accumulate_node_envelope(node_displacement_envelope, node_id, case_name, disp)

                mag = (
                    disp["ux"] ** 2
                    + disp["uy"] ** 2
                    + disp["uz"] ** 2
                ) ** 0.5
                previous = displacements.get(node_id)
                previous_mag = -1.0
                if previous:
                    previous_mag = (
                        previous["ux"] ** 2 + previous["uy"] ** 2 + previous["uz"] ** 2
                    ) ** 0.5
                if previous is None or mag > previous_mag:
                    displacements[node_id] = disp

        case_forces: dict[str, dict[str, float]] = {}
        for category in ("columns", "beams", "braces"):
            block = member_force_blocks.get(category, {})
            raw_forces = block.get(case_name, []) if isinstance(block, dict) else []
            if not isinstance(raw_forces, list):
                continue
            sequence_by_floor: dict[int, int] = {}
            for raw_force in sorted(
                (item for item in raw_forces if isinstance(item, dict)),
                key=lambda item: (
                    int(round(_safe_float(item.get("floor"), 0.0))),
                    _safe_float(item.get("id"), 0.0),
                ),
            ):
                floor = int(round(_safe_float(raw_force.get("floor"), 0.0)))
                sequence_by_floor[floor] = sequence_by_floor.get(floor, 0) + 1
                elem_id = _member_id_for(
                    category=category,
                    floor=floor,
                    member_id=raw_force.get("id"),
                    sequence=sequence_by_floor[floor],
                    by_yjk_id=elem_by_yjk_id,
                    by_sequence=elem_by_sequence,
                )
                force = _round_map(_force_from_sections(raw_force.get("sections")), digits=3)
                case_forces[elem_id] = _merge_max_force(case_forces.get(elem_id, {}), force)
                forces[elem_id] = _merge_max_force(forces.get(elem_id, {}), force)
                _accumulate_element_envelope(element_force_envelope, elem_id, case_name, force)

        case_results[case_name] = {
            "status": "success",
            "displacements": case_disps,
            "forces": case_forces,
            "reactions": {},
            "envelope": {},
        }

    max_disp = 0.0
    max_disp_node: str | None = None
    for node_id, item in node_displacement_envelope.items():
        value = _safe_float(item.get("maxAbsDisplacement"))
        if value > max_disp:
            max_disp = value
            max_disp_node = node_id

    max_axial = max_shear = max_moment = 0.0
    control_axial = control_shear = control_moment = ""
    for elem_id, item in element_force_envelope.items():
        axial = _safe_float(item.get("maxAbsAxialForce"))
        shear = _safe_float(item.get("maxAbsShearForce"))
        moment = _safe_float(item.get("maxAbsMoment"))
        if axial > max_axial:
            max_axial = axial
            control_axial = elem_id
        if shear > max_shear:
            max_shear = shear
            control_shear = elem_id
        if moment > max_moment:
            max_moment = moment
            control_moment = elem_id

    envelope = {
        "maxAbsDisplacement": round(max_disp, 4),
        "controlNodeDisplacement": max_disp_node,
        "maxAbsAxialForce": round(max_axial, 2),
        "maxAbsShearForce": round(max_shear, 2),
        "maxAbsMoment": round(max_moment, 2),
        "maxAbsReaction": 0.0,
        "controlElementAxialForce": control_axial or None,
        "controlElementShearForce": control_shear or None,
        "controlElementMoment": control_moment or None,
    }
    if max_disp_node:
        envelope[f"node:{max_disp_node}:maxAbsDisplacement"] = round(max_disp, 4)

    warnings: list[str] = []
    if not mapping:
        warnings.append("YJK mapping.json was not found; raw YJK ids were used for result keys.")

    return {
        "status": "success",
        "analysisMode": "yjk-static",
        "displacements": {key: _round_map(value) for key, value in displacements.items()},
        "forces": {key: _round_map(value, digits=3) for key, value in forces.items()},
        "reactions": {},
        "envelope": envelope,
        "summary": {
            "engine": "yjk-static",
            "mode": "sync",
            "ydb_path": ydb_path,
            "yjk_project": yjk_project,
            "work_dir": work_dir,
            "results_path": results_path,
            "nodeCount": len(displacements),
            "elementCount": len(forces),
            "maxDisplacement": round(max_disp, 4),
            "maxDisplacementNode": max_disp_node,
            "floors_analyzed": meta.get("n_floors"),
            "n_floors": meta.get("n_floors"),
            "n_nodes": meta.get("n_nodes"),
            "load_cases": meta.get("load_cases"),
        },
        "data": extracted,
        "detailed": {
            "message": "YJK static analysis completed and results were extracted.",
            "yjk_project": yjk_project,
            "results_path": results_path,
            "extraction": extracted,
            "mapping": mapping,
        },
        "yjk_detailed": {
            "raw_results": extracted,
            "mapping": mapping,
            "floor_stats": extracted.get("floor_stats", []),
            "members": extracted.get("members", {}),
        },
        "caseResults": case_results,
        "envelopeTables": {
            "nodeDisplacement": node_displacement_envelope,
            "elementForce": element_force_envelope,
            "nodeReaction": {},
        },
        "warnings": warnings,
        "steps": steps,
    }


def main() -> int:
    # -- Parse arguments ------------------------------------------------
    if len(sys.argv) < 3:
        _error("Usage: yjk_driver.py <model.json> <work_dir>", phase="arguments")
        return 1

    model_path = sys.argv[1]
    work_dir = sys.argv[2]

    # Strip our arguments so YJKAPI sees no stray sys.argv[1]
    sys.argv = [sys.argv[0]]

    yjks_root = _setup_paths()

    try:
        return _run(model_path, work_dir, yjks_root)
    except Exception:
        _error(
            f"Unhandled exception in yjk_driver:\n{traceback.format_exc()}",
            phase="unhandled",
        )
        return 1


def _run(model_path: str, work_dir: str, yjks_root: str) -> int:
    steps: list[dict] = []
    work_dir = os.path.abspath(work_dir)
    results_path = os.path.join(work_dir, "results.json")
    os.makedirs(work_dir, exist_ok=True)
    os.environ["SC_YJK_WORK_DIR"] = work_dir
    os.environ["SC_YJK_RESULTS_PATH"] = results_path

    # -- Import YJKAPI (requires sys.path set up by _setup_paths) ------
    # Redirect stdout during import so any YJKAPI banner/init messages
    # go to stderr and don't corrupt our JSON output channel.
    import io
    _real_stdout = sys.stdout
    sys.stdout = io.TextIOWrapper(sys.stderr.buffer, encoding=sys.stderr.encoding or "utf-8")
    started_at = time.monotonic()
    try:
        from YJKAPI import ControlConfig, YJKSControl
    except Exception as exc:
        sys.stdout = _real_stdout
        _record_step(
            steps,
            phase="bootstrap",
            name="Import YJKAPI",
            status="error",
            message=str(exc),
            started_at=started_at,
        )
        _error(
            f"YJKAPI import failed: {exc}",
            phase="bootstrap",
            command="import YJKAPI",
            steps=steps,
            summary={"work_dir": work_dir},
        )
        return 1
    finally:
        sys.stdout = _real_stdout
    _record_step(
        steps,
        phase="bootstrap",
        name="Import YJKAPI",
        status="success",
        started_at=started_at,
    )

    # -- Read V2 model JSON ---------------------------------------------
    with open(model_path, "r", encoding="utf-8") as f:
        model_data = json.load(f)

    project = model_data.get("project")
    project_name = (
        project.get("name", "sc_model") if isinstance(project, dict) else "sc_model"
    ) or "sc_model"
    ydb_filename = f"{project_name}.ydb"

    # -- Phase 1: Convert V2 -> .ydb ------------------------------------
    print("[yjk_driver] Phase 1: V2 -> YDB conversion", file=sys.stderr, flush=True)
    from yjk_converter import convert_v2_to_ydb

    started_at = time.monotonic()
    try:
        ydb_path = convert_v2_to_ydb(model_data, work_dir, ydb_filename)
    except Exception as exc:
        _record_step(
            steps,
            phase="conversion",
            name="V2 -> YDB conversion",
            status="error",
            message=str(exc),
            started_at=started_at,
        )
        _error(
            f"V2 -> YDB conversion failed: {exc}",
            phase="conversion",
            steps=steps,
        )
        return 1
    _record_step(
        steps,
        phase="conversion",
        name="V2 -> YDB conversion",
        status="success",
        started_at=started_at,
        ydb_path=ydb_path,
    )
    print(f"[yjk_driver] ydb_path = {ydb_path}", file=sys.stderr, flush=True)

    # -- Phase 2: Launch or attach to YJK -------------------------------
    yjks_exe_env = os.environ.get("YJKS_EXE", "").strip().strip('"')
    yjks_exe = (
        yjks_exe_env if yjks_exe_env and os.path.isfile(yjks_exe_env)
        else _find_yjks_exe(yjks_root)
    )
    if not yjks_exe or not os.path.isfile(yjks_exe):
        _error(
            f"yjks.exe not found (YJKS_ROOT={yjks_root})",
            phase="launch",
            command="RunYJK",
            steps=steps,
            summary={"work_dir": work_dir},
        )
        return 1

    version = os.environ.get("YJK_VERSION", "8.0.0").strip()
    attach_existing = _env_flag("YJK_ATTACH_EXISTING")
    use_launcher = (not attach_existing) and _should_launch_with_launcher(yjks_root)

    # Default: show the YJK GUI so the user can observe the full workflow.
    # Set YJK_INVISIBLE=1 in .env to run fully headless (CI / unattended).
    cfg = ControlConfig()
    cfg.Version = version
    cfg.Invisible = os.environ.get("YJK_INVISIBLE", "0").strip() == "1"
    if attach_existing:
        try:
            cfg.Pid = int(os.environ.get("YJK_ATTACH_PID", "-1").strip() or "-1")
        except ValueError:
            cfg.Pid = -1

    if not use_launcher:
        try:
            YJKSControl.initConfig(cfg)
        except Exception as exc:
            _error(
                f"YJK control config failed: {exc}",
                phase="launch",
                command="initConfig",
                steps=steps,
                summary={"work_dir": work_dir},
            )
            return 1

    if attach_existing:
        _record_step(
            steps,
            phase="launch",
            name="Attach existing YJK",
            command="initConfig(Pid)",
            status="success",
            message=(
                "Attached to an existing YJK session. Start YJK through YjkLauncher.exe "
                "and run the yjksipccontrol command inside YJK before using this mode."
            ),
            pid=getattr(cfg, "Pid", None),
        )
        msg = "attached"
    elif use_launcher:
        msg = _launch_yjk_with_launcher_and_attach(
            yjks_root=yjks_root,
            cfg=cfg,
            yjks_control=YJKSControl,
            steps=steps,
        )
        if not msg:
            _error(
                "YJK launcher bootstrap failed",
                phase="launch",
                command="YjkLauncher.exe",
                steps=steps,
                summary={"work_dir": work_dir},
                detailed={
                    "hint": (
                        "YJK_USE_LAUNCHER=1 is an explicit launcher attach mode. "
                        "Unset it to use the default SDK RunYJK(yjks.exe) direct launch path."
                    )
                },
            )
            return 1
    else:
        print(f"[yjk_driver] Phase 2: RunYJK({yjks_exe})", file=sys.stderr, flush=True)
        started_at = time.monotonic()
        launch_cwd = _direct_launch_cwd(yjks_root)
        previous_cwd = os.getcwd()
        try:
            os.chdir(launch_cwd)
            msg = YJKSControl.RunYJK(yjks_exe)
        except Exception as exc:
            _record_step(
                steps,
                phase="launch",
                name="RunYJK",
                command="RunYJK",
                status="error",
                message=str(exc),
                started_at=started_at,
            )
            _error(
                f"YJK failed to launch: {exc}",
                phase="launch",
                command="RunYJK",
                steps=steps,
                summary={"work_dir": work_dir},
                detailed={
                    "hint": (
                        "RunYJK accepts only the yjks.exe file path. If this install "
                        "requires online/BIT launcher authorization, use "
                        "YJK_ATTACH_EXISTING=1 after starting YJK from the official launcher."
                    )
                },
            )
            return 1
        finally:
            try:
                os.chdir(previous_cwd)
            except OSError:
                pass
        _record_step(
            steps,
            phase="launch",
            name="RunYJK",
            command="RunYJK",
            status="success",
            message=str(msg),
            started_at=started_at,
            cwd=launch_cwd,
        )
    print(f"[yjk_driver] YJK launch/attach result: {msg}", file=sys.stderr, flush=True)

    # -- Phase 3: Open/create project + import ydb ----------------------
    project_dir = os.path.dirname(os.path.abspath(ydb_path))
    yjk_project = os.path.join(project_dir, f"{project_name}.yjk")

    print(f"[yjk_driver] Phase 3: project = {yjk_project}", file=sys.stderr, flush=True)
    if os.path.isfile(yjk_project):
        if not _run_cmd("UIOpen", yjk_project, phase="project", steps=steps):
            _error(
                "YJK crashed while opening project",
                phase="project",
                command="UIOpen",
                steps=steps,
            )
            return 1
    else:
        if not _run_cmd("UINew", yjk_project, phase="project", steps=steps):
            _error(
                "YJK crashed while creating new project",
                phase="project",
                command="UINew",
                steps=steps,
            )
            return 1

    if not _run_cmd("yjk_importydb", ydb_path, phase="project", steps=steps):
        _error(
            "YJK crashed while importing YDB file - the model may have invalid geometry or sections",
            phase="project",
            command="yjk_importydb",
            steps=steps,
        )
        return 1

    # -- Phase 4: Model preparation (exact three_story_steel_frame.py) --
    print("[yjk_driver] Phase 4: model repair / prep", file=sys.stderr, flush=True)
    if not _run_cmd("yjk_repair", phase="model_preparation", steps=steps):
        _error(
            "YJK crashed during model repair",
            phase="model_preparation",
            command="yjk_repair",
            steps=steps,
        )
        return 1
    if not _run_cmd("yjk_save", phase="model_preparation", steps=steps):
        _error(
            "YJK crashed during save",
            phase="model_preparation",
            command="yjk_save",
            steps=steps,
        )
        return 1
    if not _run_cmd("yjk_formslab_alllayer", phase="model_preparation", steps=steps):
        _error(
            "YJK crashed during slab formation",
            phase="model_preparation",
            command="yjk_formslab_alllayer",
            steps=steps,
        )
        return 1
    if not _run_cmd("yjk_setlayersupport", phase="model_preparation", steps=steps):
        _error(
            "YJK crashed during layer support setup",
            phase="model_preparation",
            command="yjk_setlayersupport",
            steps=steps,
        )
        return 1

    # -- Phase 5: Preprocessing -----------------------------------------
    # Preprocessing steps (genmodrel, transload) are fast and must finish
    # before the model is usable.  The heavy design calculation
    # (yjkdesign_dsncalculating_all) runs in Phase 6 and is synchronous by
    # default so the runtime can return extracted results.
    print("[yjk_driver] Phase 5: preprocessing", file=sys.stderr, flush=True)
    if not _run_cmd("yjkspre_genmodrel", phase="preprocessing", steps=steps):
        _error(
            "YJK crashed during model relation generation",
            phase="preprocessing",
            command="yjkspre_genmodrel",
            steps=steps,
        )
        return 1
    if not _run_cmd("yjktransload_tlplan", phase="preprocessing", steps=steps):
        _error(
            "YJK crashed during plan load transfer",
            phase="preprocessing",
            command="yjktransload_tlplan",
            steps=steps,
        )
        return 1
    if not _run_cmd("yjktransload_tlvert", phase="preprocessing", steps=steps):
        _error(
            "YJK crashed during vertical load transfer",
            phase="preprocessing",
            command="yjktransload_tlvert",
            steps=steps,
        )
        return 1
    if not _run_cmd("SetCurrentLabel", "IDSPRE_ROOT", phase="preprocessing", steps=steps):
        _error(
            "YJK crashed during label switch",
            phase="preprocessing",
            command="SetCurrentLabel",
            steps=steps,
        )
        return 1

    async_start_only = any(
        os.environ.get(name, "").strip() == "1"
        for name in ("YJK_START_ONLY", "YJK_ASYNC_CALC", "YJK_ASYNC_START_ONLY")
    )
    if async_start_only:
        print(
            "[yjk_driver] Phase 6: starting calculation asynchronously",
            file=sys.stderr,
            flush=True,
        )

        import threading

        dispatch_ok = threading.Event()
        background_steps: list[dict] = []

        def _background_calc() -> None:
            try:
                dispatch_ok.set()
                _run_cmd(
                    "yjkdesign_dsncalculating_all",
                    phase="analysis_async",
                    steps=background_steps,
                )
                _run_cmd(
                    "SetCurrentLabel",
                    "IDDSN_DSP",
                    phase="analysis_async",
                    steps=background_steps,
                )
                print("[yjk_driver] background calculation finished", file=sys.stderr, flush=True)
            except Exception as exc:
                print(f"[yjk_driver] background calculation error: {exc}", file=sys.stderr, flush=True)

        calc_thread = threading.Thread(target=_background_calc, daemon=False)
        calc_thread.start()
        dispatch_ok.wait(timeout=10)
        _record_step(
            steps,
            phase="analysis_async",
            name="Start calculation without waiting",
            command="yjkdesign_dsncalculating_all",
            status="success",
            message="YJK_START_ONLY/YJK_ASYNC_CALC enabled; result extraction skipped.",
        )

        _emit_json({
            "status": "success",
            "summary": {
                "engine": "yjk-static",
                "mode": "async-start-only",
                "ydb_path": ydb_path,
                "yjk_project": yjk_project,
                "work_dir": work_dir,
            },
            "data": {},
            "detailed": {
                "message": "Model imported into YJK and calculation was started without waiting.",
                "yjk_project": yjk_project,
            },
            "warnings": [
                "YJK calculation was started without waiting; results.json was not extracted."
            ],
            "steps": steps,
        })
        print("[yjk_driver] done — calculation running in YJK", file=sys.stderr, flush=True)
        os._exit(0)

    # -- Phase 6: Synchronous design calculation ------------------------
    print("[yjk_driver] Phase 6: synchronous calculation", file=sys.stderr, flush=True)
    if not _run_cmd("yjkdesign_dsncalculating_all", phase="analysis", steps=steps):
        _error(
            "YJK crashed or failed during design calculation",
            phase="analysis",
            command="yjkdesign_dsncalculating_all",
            steps=steps,
            summary={"work_dir": work_dir, "yjk_project": yjk_project},
        )
        return 1
    if not _run_cmd("SetCurrentLabel", "IDDSN_DSP", phase="analysis", steps=steps):
        _error(
            "YJK crashed while switching to design result label",
            phase="analysis",
            command="SetCurrentLabel",
            steps=steps,
            summary={"work_dir": work_dir, "yjk_project": yjk_project},
        )
        return 1

    # -- Phase 7: Extract results inside YJK and read work_dir/results.json
    print("[yjk_driver] Phase 7: result extraction", file=sys.stderr, flush=True)
    extract_source = os.path.join(SCRIPT_DIR, "extract_results.py")
    extract_script = os.path.join(work_dir, "extract_results.py")
    started_at = time.monotonic()
    try:
        if os.path.isfile(results_path):
            os.remove(results_path)
        shutil.copyfile(extract_source, extract_script)
    except Exception as exc:
        _record_step(
            steps,
            phase="result_extraction",
            name="Prepare extract_results.py",
            status="error",
            message=str(exc),
            started_at=started_at,
        )
        _error(
            f"Failed to prepare YJK result extractor: {exc}",
            phase="result_extraction",
            command="copy_extract_results",
            steps=steps,
            summary={"work_dir": work_dir, "yjk_project": yjk_project},
        )
        return 1
    _record_step(
        steps,
        phase="result_extraction",
        name="Prepare extract_results.py",
        status="success",
        started_at=started_at,
        script=extract_script,
    )

    if not _run_cmd("yjks_pyload", extract_script, phase="result_extraction", steps=steps):
        _error(
            "YJK crashed or failed while running extract_results.py",
            phase="result_extraction",
            command="yjks_pyload",
            steps=steps,
            summary={"work_dir": work_dir, "yjk_project": yjk_project},
        )
        return 1

    started_at = time.monotonic()
    try:
        extract_timeout = float(os.environ.get("YJK_EXTRACT_TIMEOUT_S", "30").strip() or "30")
        deadline = time.monotonic() + extract_timeout
        while True:
            try:
                with open(results_path, "r", encoding="utf-8") as f:
                    extracted = json.load(f)
                break
            except (FileNotFoundError, json.JSONDecodeError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.5)
    except Exception as exc:
        _record_step(
            steps,
            phase="result_read",
            name="Read results.json",
            status="error",
            message=str(exc),
            started_at=started_at,
            path=results_path,
        )
        _error(
            f"Failed to read YJK results.json from work_dir: {exc}",
            phase="result_read",
            command="read_results_json",
            steps=steps,
            summary={"work_dir": work_dir, "yjk_project": yjk_project},
            detailed={"results_path": results_path},
        )
        return 1

    if isinstance(extracted, dict) and extracted.get("status") == "error":
        error_message = str(extracted.get("error") or extracted.get("message") or "YJK result extraction failed")
        _record_step(
            steps,
            phase="result_extraction",
            name="extract_results.py",
            status="error",
            message=error_message,
            started_at=started_at,
            path=results_path,
        )
        _error(
            error_message,
            phase=str(extracted.get("phase") or "result_extraction"),
            command=str(extracted.get("command") or "yjks_pyload"),
            steps=steps,
            summary={"work_dir": work_dir, "yjk_project": yjk_project},
            detailed={"results_path": results_path, "extractor": extracted},
        )
        return 1

    _record_step(
        steps,
        phase="result_read",
        name="Read results.json",
        status="success",
        started_at=started_at,
        path=results_path,
    )

    mapping = _load_json_file(os.path.join(work_dir, "mapping.json"))
    output = _build_analysis_result(
        extracted=extracted,
        mapping=mapping,
        ydb_path=ydb_path,
        yjk_project=yjk_project,
        work_dir=work_dir,
        results_path=results_path,
        steps=steps,
    )

    _emit_json(output)
    print("[yjk_driver] done — calculation and extraction completed", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
