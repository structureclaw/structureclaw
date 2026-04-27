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
_CURRENT_WORK_DIR: str | None = None


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


def _env_text(name: str, default: str = "") -> str:
    value = os.environ.get(name, default)
    if value is None:
        return ""
    return str(value).strip()


def _env_path(name: str, default: str = "") -> str:
    return _env_text(name, default).strip('"')


def _flush_stdio() -> None:
    for stream in (sys.stderr, sys.stdout):
        try:
            stream.flush()
        except Exception:
            pass


def _write_steps_json(work_dir: str | None, steps: list[dict] | None) -> None:
    if not work_dir or steps is None:
        return
    steps_path = os.path.join(work_dir, "steps.json")
    if os.path.exists(steps_path):
        return
    try:
        os.makedirs(work_dir, exist_ok=True)
        with open(steps_path, "w", encoding="utf-8") as f:
            json.dump(steps, f, ensure_ascii=False, indent=2)
            f.write("\n")
    except Exception as exc:
        print(
            f"[yjk_driver] failed to write steps.json: {exc}",
            file=sys.stderr,
            flush=True,
        )


def _finish_after_json(
    *,
    work_dir: str | None,
    steps: list[dict] | None,
    exit_code: int,
    force_exit: bool,
) -> int:
    _write_steps_json(work_dir, steps)
    _flush_stdio()
    if force_exit:
        os._exit(exit_code)
    return exit_code


def _write_driver_output_json(work_dir: str | None, payload: dict) -> None:
    if not work_dir:
        return
    try:
        os.makedirs(work_dir, exist_ok=True)
        output_path = os.path.join(work_dir, "driver-output.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
    except Exception as exc:
        print(
            f"[yjk_driver] failed to write driver-output.json: {exc}",
            file=sys.stderr,
            flush=True,
        )


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

    work_dir = str(summary_payload.get("work_dir") or "") or _CURRENT_WORK_DIR
    payload = {
        "status": "error",
        "summary": summary_payload,
        "data": {},
        "detailed": detail,
        "warnings": [message],
        "steps": steps or [],
    }
    _write_driver_output_json(work_dir, payload)
    _emit_json(payload)
    _finish_after_json(
        work_dir=work_dir,
        steps=steps,
        exit_code=1,
        force_exit=work_dir is not None,
    )


def _setup_paths() -> str:
    """Set up sys.path and os.environ["PATH"] for YJK.

    Returns the resolved YJKS_ROOT directory.
    """
    yjks_root = _env_path("YJKS_ROOT") or _env_path("YJK_PATH")
    if not yjks_root:
        for candidate in (r"C:\YJKS\YJKS_8_0_0", r"D:\YJKS\YJKS_8_0_0"):
            if os.path.isdir(candidate):
                yjks_root = candidate
                break

    yjks_exe_env = _env_path("YJKS_EXE")
    if yjks_exe_env and os.path.isfile(yjks_exe_env):
        root = os.path.dirname(os.path.abspath(yjks_exe_env))
    elif os.path.isdir(yjks_root):
        root = yjks_root
    else:
        root = yjks_root

    # DLL search path
    os.environ["PATH"] = root + os.pathsep + _env_text("PATH")

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
    return _env_text(name).lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env_text(name) or default)
    except ValueError:
        return default


def _launcher_prewarm_mode() -> str:
    value = _env_text("YJK_LAUNCHER_PREWARM", "auto").lower()
    if value in {"0", "false", "no", "off", "never", "disabled"}:
        return "off"
    if value in {"1", "true", "yes", "on", "always", "force"}:
        return "always"
    return "auto"


def _find_yjk_launcher(root: str) -> str | None:
    explicit = _env_path("YJK_LAUNCHER_EXE")
    if explicit and os.path.isfile(explicit):
        return explicit
    for name in ("YjkLauncher.exe", "YJKLauncher.exe"):
        p = os.path.join(root, name)
        if os.path.isfile(p):
            return p
    return None


def _should_launch_with_launcher(root: str) -> bool:
    explicit = _env_text("YJK_USE_LAUNCHER")
    if explicit:
        return _env_flag("YJK_USE_LAUNCHER")
    return False


def _direct_launch_cwd(yjks_root: str) -> str:
    configured = _env_path("YJK_CWD")
    if configured and os.path.isdir(configured):
        return configured
    return yjks_root


def _powershell_exe() -> str:
    system_root = _env_text("SystemRoot", r"C:\Windows")
    candidate = os.path.join(
        system_root,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
    )
    return candidate if os.path.isfile(candidate) else "powershell"


def _get_processes_by_name(process_name: str) -> list[dict]:
    import subprocess

    escaped = process_name.replace("'", "''")
    command = (
        f"Get-Process | Where-Object {{ $_.ProcessName -ieq '{escaped}' }} | "
        "Select-Object Id,Path,MainWindowTitle | ConvertTo-Json -Compress"
    )
    try:
        proc = subprocess.run(
            [_powershell_exe(), "-NoProfile", "-Command", command],
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


def _get_yjks_processes() -> list[dict]:
    return _get_processes_by_name("yjks")


def _get_launcher_processes() -> list[dict]:
    return _get_processes_by_name("YjkLauncher")


def _process_id(proc: dict | None) -> int:
    return int(_safe_float((proc or {}).get("Id"), 0.0))


def _is_auth_failure_title(title: object) -> bool:
    text = str(title or "").strip().lower()
    return bool(text) and (
        "授权检测失败" in text
        or "authorization verification failed" in text
        or "license verification failed" in text
    )


def _wait_for_direct_launch_state(before_pids: set[int], timeout_s: float) -> dict:
    """Watch a freshly launched yjks.exe for the local auth failure dialog.

    A valid direct launch may keep the title blank for a while, especially when
    YJK is invisible.  We only use this watch to confidently detect the official
    "authorization check failed" window; otherwise the caller proceeds normally.
    """
    deadline = time.monotonic() + timeout_s
    last_seen: dict | None = None
    while time.monotonic() < deadline:
        for proc in _get_yjks_processes():
            pid = _process_id(proc)
            if pid <= 0:
                continue
            if before_pids and pid in before_pids:
                continue
            last_seen = proc
            title = str(proc.get("MainWindowTitle") or "")
            if _is_auth_failure_title(title):
                return {"state": "auth_failed", "pid": pid, "title": title}
            if title.strip():
                return {"state": "ready", "pid": pid, "title": title}
        time.sleep(1.0)
    if last_seen:
        return {
            "state": "unknown",
            "pid": _process_id(last_seen),
            "title": str(last_seen.get("MainWindowTitle") or ""),
        }
    return {"state": "not_found", "pid": None, "title": None}


def _stop_process(pid: int) -> bool:
    if pid <= 0:
        return False
    import subprocess

    try:
        proc = subprocess.run(
            [
                _powershell_exe(),
                "-NoProfile",
                "-Command",
                f"Stop-Process -Id {pid} -Force -ErrorAction Stop",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return proc.returncode == 0
    except Exception:
        return False


def _prewarm_yjk_launcher(yjks_root: str, steps: list[dict]) -> bool:
    import subprocess

    launcher = _find_yjk_launcher(yjks_root)
    if not launcher:
        _record_step(
            steps,
            phase="launch",
            name="Prewarm YJK launcher authorization",
            command="YjkLauncher.exe",
            status="error",
            message=f"YjkLauncher.exe not found under {yjks_root}",
        )
        return False

    existing = _get_launcher_processes()
    existing_pid = _process_id(existing[0]) if existing else 0
    started_at = time.monotonic()
    cwd = _env_path("YJK_LAUNCHER_CWD") or yjks_root
    try:
        if existing_pid <= 0:
            proc = subprocess.Popen([launcher], cwd=cwd)
            pid = proc.pid
            message = "Started official YJK launcher and kept it alive for authorization."
        else:
            pid = existing_pid
            message = "Reused existing official YJK launcher for authorization."
    except Exception as exc:
        _record_step(
            steps,
            phase="launch",
            name="Prewarm YJK launcher authorization",
            command=launcher,
            status="error",
            message=str(exc),
            started_at=started_at,
        )
        return False

    wait_s = _env_float("YJK_LAUNCHER_PREWARM_S", 18.0)
    if wait_s > 0:
        time.sleep(wait_s)
    _record_step(
        steps,
        phase="launch",
        name="Prewarm YJK launcher authorization",
        command=launcher,
        status="success",
        message=message,
        started_at=started_at,
        pid=pid,
        wait_s=wait_s,
        cwd=cwd,
    )
    return True


def _run_yjk_direct(
    *,
    yjks_root: str,
    yjks_exe: str,
    yjks_control: object,
    steps: list[dict],
    attempt: str,
) -> tuple[str | None, dict]:
    print(
        f"[yjk_driver] Phase 2: RunYJK({yjks_exe}) [{attempt}]",
        file=sys.stderr,
        flush=True,
    )
    before_pids = {
        _process_id(proc)
        for proc in _get_yjks_processes()
        if _process_id(proc) > 0
    }
    started_at = time.monotonic()
    launch_cwd = _direct_launch_cwd(yjks_root)
    previous_cwd = os.getcwd()
    try:
        os.chdir(launch_cwd)
        msg = yjks_control.RunYJK(yjks_exe)
    except Exception as exc:
        _record_step(
            steps,
            phase="launch",
            name=f"RunYJK ({attempt})",
            command="RunYJK",
            status="error",
            message=str(exc),
            started_at=started_at,
        )
        return None, {"state": "exception", "error": str(exc), "pid": None, "title": None}
    finally:
        try:
            os.chdir(previous_cwd)
        except OSError:
            pass

    state = _wait_for_direct_launch_state(
        before_pids,
        _env_float("YJK_DIRECT_READY_TIMEOUT_S", 12.0),
    )
    _record_step(
        steps,
        phase="launch",
        name=f"RunYJK ({attempt})",
        command="RunYJK",
        status="success" if state.get("state") != "auth_failed" else "warning",
        message=str(msg),
        started_at=started_at,
        cwd=launch_cwd,
        pid=state.get("pid"),
        window_title=state.get("title"),
        launch_state=state.get("state"),
    )
    return str(msg), state


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
    time.sleep(_env_float("YJK_AUTO_IPC_FOCUS_DELAY_S", 1.0))
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
    cwd = _env_path("YJK_LAUNCHER_CWD") or yjks_root
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

    wait_timeout = _env_float("YJK_LAUNCHER_WAIT_S", 90.0)
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
    time.sleep(_env_float("YJK_AUTO_IPC_DELAY_S", 8.0))
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
    callback: str | None = None,
    *,
    phase: str,
    steps: list[dict],
) -> bool:
    """Execute a YJK command and return success status.

    Returns True if the command succeeded, False if YJK is no longer running.
    """
    from YJKAPI import YJKSControl
    display_command = cmd if callback is None else f"{cmd}:{callback}"
    print(
        f"[yjk_driver] RunCmd({cmd!r}, {arg!r}, {callback!r})",
        file=sys.stderr,
        flush=True,
    )
    started_at = time.monotonic()
    try:
        if callback is None:
            YJKSControl.RunCmd(cmd, arg)
        else:
            YJKSControl.RunCmd(cmd, arg, callback)
        # Check if YJK is still running after the command
        if not _is_yjk_running():
            message = f"YJK process terminated after {cmd}"
            print(f"[yjk_driver] WARNING: {message}", file=sys.stderr, flush=True)
            _record_step(
                steps,
                phase=phase,
                name=cmd,
                command=display_command,
                status="error",
                message=message,
                started_at=started_at,
            )
            return False
        _record_step(
            steps,
            phase=phase,
            name=cmd,
            command=display_command,
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
            command=display_command,
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


def _id_candidates(value: object) -> list[str]:
    if value is None:
        return []
    text = str(value).strip()
    if not text or text.lower() == "none":
        return []
    candidates = [text]
    number = _safe_float(value, None)
    if number is not None and abs(number - round(number)) < 1e-9:
        candidates.append(str(int(round(number))))
    return list(dict.fromkeys(candidates))


def _coord_key(x: object, y: object, z: object, *, scale: float = 1.0) -> tuple[int, int, int]:
    return (
        int(round(_safe_float(x) * scale)),
        int(round(_safe_float(y) * scale)),
        int(round(_safe_float(z) * scale)),
    )


def _coord_candidates(x: object, y: object, z: object) -> list[tuple[int, int, int]]:
    """Return millimetre-like and raw coordinate keys for YJK result matching."""
    candidates = [
        _coord_key(x, y, z),
        _coord_key(x, y, z, scale=1000.0),
    ]
    return list(dict.fromkeys(candidates))


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


def _build_result_node_lookup(
    extracted: dict,
    mapping: dict,
    diagnostics: dict | None = None,
) -> dict[str, str]:
    id_to_v2: dict[str, str] = {}
    coord_to_v2: dict[tuple[int, int, int], str] = {}
    nodes = mapping.get("nodes", {})
    if isinstance(nodes, dict):
        for v2_id, item in nodes.items():
            if not isinstance(item, dict):
                continue
            mapped_id = str(item.get("v2_id") or v2_id)
            for field in (
                "yjk_std_floor_node_id",
                "yjk_node_id",
                "yjk_model_id",
                "node_id",
                "id",
            ):
                for candidate in _id_candidates(item.get(field)):
                    id_to_v2[candidate] = mapped_id
            coord_keys: list[tuple[int, int, int]] = []
            if any(item.get(field) is not None for field in ("x_mm", "y_mm", "z_mm")):
                coord_keys.append(_coord_key(item.get("x_mm"), item.get("y_mm"), item.get("z_mm")))
            if any(item.get(field) is not None for field in ("x_m", "y_m", "z_m")):
                coord_keys.append(_coord_key(item.get("x_m"), item.get("y_m"), item.get("z_m"), scale=1000.0))
            for key in coord_keys:
                existing = coord_to_v2.get(key)
                coord_to_v2[key] = mapped_id if existing in (None, mapped_id) else ""

    result_lookup: dict[str, str] = {}
    result_lookup.update(id_to_v2)
    id_matches = 0
    coord_matches = 0
    unmapped = 0
    for node in extracted.get("nodes", []) if isinstance(extracted.get("nodes"), list) else []:
        if not isinstance(node, dict):
            continue
        result_id = str(node.get("id"))
        direct = id_to_v2.get(result_id)
        if direct:
            result_lookup[result_id] = direct
            id_matches += 1
            continue

        matched = None
        for key in _coord_candidates(node.get("x"), node.get("y"), node.get("z")):
            candidate = coord_to_v2.get(key)
            if candidate:
                matched = candidate
                break
        if matched:
            result_lookup[result_id] = matched
            coord_matches += 1
        else:
            result_lookup[result_id] = result_id
            unmapped += 1
    if diagnostics is not None:
        diagnostics["node_id_matches"] = id_matches
        diagnostics["node_coord_matches"] = coord_matches
        diagnostics["node_unmapped"] = unmapped
        diagnostics["node_id_index_size"] = len(id_to_v2)
    return result_lookup


def _element_category(elem_type: object) -> str:
    normalized = str(elem_type or "").lower()
    if normalized == "column":
        return "columns"
    if normalized in ("brace", "braces", "truss"):
        return "braces"
    return "beams"


def _endpoint_key(nodes: object) -> tuple[str, str] | None:
    if not isinstance(nodes, list) or len(nodes) < 2:
        return None
    endpoints = [str(nodes[0]), str(nodes[-1])]
    endpoints.sort()
    return (endpoints[0], endpoints[1])


def _build_element_lookups(mapping: dict) -> dict[str, dict]:
    by_yjk_id: dict[tuple[str, int, str], str] = {}
    by_endpoint: dict[tuple[str, int, tuple[str, str]], str] = {}
    by_sequence: dict[tuple[str, int, int], str] = {}
    elements = mapping.get("elements", {})
    if not isinstance(elements, dict):
        return {
            "by_yjk_id": by_yjk_id,
            "by_endpoint": by_endpoint,
            "by_sequence": by_sequence,
        }

    for v2_id, item in elements.items():
        if not isinstance(item, dict):
            continue
        elem_id = str(item.get("v2_id") or v2_id)
        category = _element_category(item.get("type"))
        floor_index = int(round(_safe_float(item.get("floor_index"), 0.0)))
        for field in (
            "yjk_model_id",
            "yjk_member_id",
            "yjk_id",
            "tot_id",
            "original_no",
            "id",
        ):
            for candidate in _id_candidates(item.get(field)):
                by_yjk_id[(category, floor_index, candidate)] = elem_id

        endpoints = _endpoint_key(item.get("nodes"))
        if endpoints is not None and floor_index > 0:
            by_endpoint[(category, floor_index, endpoints)] = elem_id

        fallback = item.get("fallback_match", {})
        if isinstance(fallback, dict):
            sequence = int(round(_safe_float(fallback.get("sequence_in_floor_type"), 0.0)))
            if floor_index > 0 and sequence > 0:
                by_sequence[(category, floor_index, sequence)] = elem_id
    return {
        "by_yjk_id": by_yjk_id,
        "by_endpoint": by_endpoint,
        "by_sequence": by_sequence,
    }


def _member_id_for(
    *,
    category: str,
    raw_member: dict,
    sequence: int,
    lookups: dict[str, dict],
    result_node_lookup: dict[str, str],
    diagnostics: dict | None = None,
) -> tuple[str, str]:
    floor = int(round(_safe_float(raw_member.get("floor"), 0.0)))
    original_floor = int(round(_safe_float(raw_member.get("original_floor"), 0.0)))
    floors = [item for item in (floor, original_floor) if item > 0]
    if not floors:
        floors = [0]

    by_yjk_id = lookups.get("by_yjk_id", {})
    for candidate_field in ("tot_id", "id", "original_no"):
        for candidate in _id_candidates(raw_member.get(candidate_field)):
            for floor_key in floors:
                direct = by_yjk_id.get((category, floor_key, candidate))
                if direct:
                    if diagnostics is not None:
                        diagnostics["element_direct_matches"] = diagnostics.get("element_direct_matches", 0) + 1
                    return direct, "direct"

    node_i = raw_member.get("node_i")
    node_j = raw_member.get("node_j")
    endpoint = _endpoint_key([
        result_node_lookup.get(str(node_i), str(node_i)),
        result_node_lookup.get(str(node_j), str(node_j)),
    ])
    if endpoint is not None:
        by_endpoint = lookups.get("by_endpoint", {})
        for floor_key in floors:
            direct = by_endpoint.get((category, floor_key, endpoint))
            if direct:
                if diagnostics is not None:
                    diagnostics["element_endpoint_matches"] = diagnostics.get("element_endpoint_matches", 0) + 1
                return direct, "endpoint"

    raw_sequence = int(round(_safe_float(raw_member.get("sequence"), 0.0))) or sequence
    by_sequence = lookups.get("by_sequence", {})
    for floor_key in floors:
        fallback = by_sequence.get((category, floor_key, raw_sequence))
        if fallback:
            if diagnostics is not None:
                diagnostics["element_sequence_matches"] = diagnostics.get("element_sequence_matches", 0) + 1
            return fallback, "sequence"

    if diagnostics is not None:
        diagnostics["element_unmapped"] = diagnostics.get("element_unmapped", 0) + 1
    member_key = next(
        (str(raw_member.get(field)) for field in ("tot_id", "id", "original_no") if raw_member.get(field) is not None),
        str(raw_sequence),
    )
    return f"{category}:{floors[0]}:{member_key}", "raw"


def _force_from_sections(sections: object) -> dict[str, float]:
    """Map YJK section force rows [Mx, My, Qx, Qy, N, T] to common fields."""
    force = {"N": 0.0, "Vy": 0.0, "Vz": 0.0, "T": 0.0, "My": 0.0, "Mz": 0.0}
    if not isinstance(sections, list):
        force["V"] = 0.0
        force["M"] = 0.0
        return force

    rows = sections
    if sections and all(not isinstance(item, (list, tuple)) for item in sections):
        rows = [sections]

    for row in rows:
        if not isinstance(row, (list, tuple)):
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


def _reaction_from_raw(raw: dict) -> dict[str, float]:
    reaction = {
        "Fx": _safe_float(raw.get("Fx", raw.get("fx", raw.get("RX", raw.get("rx"))))),
        "Fy": _safe_float(raw.get("Fy", raw.get("fy", raw.get("RY", raw.get("ry"))))),
        "Fz": _safe_float(raw.get("Fz", raw.get("fz", raw.get("RZ", raw.get("rz"))))),
        "Mx": _safe_float(raw.get("Mx", raw.get("mx"))),
        "My": _safe_float(raw.get("My", raw.get("my"))),
        "Mz": _safe_float(raw.get("Mz", raw.get("mz"))),
    }
    reaction["R"] = _safe_float(
        raw.get("R"),
        (reaction["Fx"] ** 2 + reaction["Fy"] ** 2 + reaction["Fz"] ** 2) ** 0.5,
    )
    return reaction


def _merge_max_reaction(target: dict[str, float], candidate: dict[str, float]) -> dict[str, float]:
    merged = dict(target)
    for key in ("Fx", "Fy", "Fz", "Mx", "My", "Mz", "R"):
        merged[key] = max(abs(_safe_float(merged.get(key))), abs(_safe_float(candidate.get(key))))
    return merged


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


def _accumulate_reaction_envelope(
    table: dict[str, dict],
    node_id: str,
    case_name: str,
    reaction: dict[str, float],
) -> None:
    item = table.setdefault(
        str(node_id),
        {
            "maxAbsReaction": 0.0,
            "controlCase": "",
            "Fx": 0.0,
            "Fy": 0.0,
            "Fz": 0.0,
            "Mx": 0.0,
            "My": 0.0,
            "Mz": 0.0,
            "R": 0.0,
        },
    )
    resultant = abs(_safe_float(reaction.get("R")))
    if resultant > _safe_float(item.get("maxAbsReaction")):
        item.update(_round_map(reaction, digits=3))
        item["maxAbsReaction"] = round(resultant, 3)
        item["controlCase"] = case_name


def _case_descriptors(extracted: dict, raw_case_keys: set[str]) -> list[dict]:
    meta = extracted.get("meta", {}) if isinstance(extracted.get("meta"), dict) else {}
    raw_cases = extracted.get("load_cases")
    if raw_cases is None:
        raw_cases = meta.get("load_cases")
    descriptors: list[dict] = []
    used_result_keys: set[str] = set()
    claimed_source_keys: set[str] = set()

    if isinstance(raw_cases, list):
        for index, item in enumerate(raw_cases, start=1):
            if isinstance(item, dict):
                case_id = item.get("id")
                old_id = item.get("oldId")
                key = str(item.get("key") or f"lc_{case_id}") if case_id is not None else str(item.get("key") or f"case_{index}")
                label = str(item.get("name") or item.get("expName") or key)
                source_keys = [
                    key,
                    *(f"lc_{value}" for value in _id_candidates(case_id)),
                    *(f"lc_{value}" for value in _id_candidates(old_id)),
                    *_id_candidates(case_id),
                    *_id_candidates(old_id),
                ]
                descriptor = {
                    "result_key": key,
                    "source_keys": list(dict.fromkeys(source_keys)),
                    "label": label,
                    "name": item.get("name"),
                    "expName": item.get("expName"),
                    "kind": item.get("kind"),
                    "id": case_id,
                    "oldId": old_id,
                }
            else:
                key = f"lc_{item}"
                descriptor = {
                    "result_key": key,
                    "source_keys": [key, str(item)],
                    "label": key,
                    "name": key,
                    "kind": None,
                    "id": item,
                    "oldId": None,
                    "expName": None,
                }

            result_key = str(descriptor["result_key"])
            if result_key in used_result_keys:
                result_key = f"{result_key}_{index}"
                descriptor["result_key"] = result_key
            used_result_keys.add(result_key)
            claimed_source_keys.update(str(value) for value in descriptor["source_keys"])
            descriptors.append(descriptor)

    for raw_key in sorted(raw_case_keys - claimed_source_keys):
        descriptors.append({
            "result_key": raw_key,
            "source_keys": [raw_key],
            "label": raw_key,
            "name": raw_key,
            "kind": None,
            "id": None,
            "oldId": None,
            "expName": None,
        })
    return descriptors


def _case_block(block: dict, descriptor: dict) -> object:
    for key in descriptor.get("source_keys", []):
        if key in block:
            return block.get(key)
    return []


def _raw_member_definition_lookup(extracted: dict) -> dict[str, dict[tuple[int, str], dict]]:
    lookup: dict[str, dict[tuple[int, str], dict]] = {}
    members = extracted.get("members", {})
    if not isinstance(members, dict):
        return lookup
    for category in ("columns", "beams", "braces"):
        category_lookup: dict[tuple[int, str], dict] = {}
        raw_members = members.get(category, [])
        if not isinstance(raw_members, list):
            continue
        for raw in raw_members:
            if not isinstance(raw, dict):
                continue
            floor = int(round(_safe_float(raw.get("floor"), 0.0)))
            original_floor = int(round(_safe_float(raw.get("original_floor"), 0.0)))
            floors = [item for item in (floor, original_floor) if item > 0] or [0]
            for field in ("tot_id", "id", "original_no", "sequence"):
                for candidate in _id_candidates(raw.get(field)):
                    for floor_key in floors:
                        category_lookup[(floor_key, candidate)] = raw
        lookup[category] = category_lookup
    return lookup


def _merge_member_definition(category_lookup: dict[tuple[int, str], dict], raw_force: dict) -> dict:
    floor = int(round(_safe_float(raw_force.get("floor"), 0.0)))
    original_floor = int(round(_safe_float(raw_force.get("original_floor"), 0.0)))
    floors = [item for item in (floor, original_floor) if item > 0] or [0]
    for field in ("tot_id", "id", "original_no", "sequence"):
        for candidate in _id_candidates(raw_force.get(field)):
            for floor_key in floors:
                raw_member = category_lookup.get((floor_key, candidate))
                if raw_member:
                    merged = dict(raw_member)
                    merged.update(raw_force)
                    return merged
    return raw_force


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
    diagnostics: dict[str, int] = {}
    result_node_lookup = _build_result_node_lookup(extracted, mapping, diagnostics)
    element_lookups = _build_element_lookups(mapping)
    member_definition_lookup = _raw_member_definition_lookup(extracted)

    displacements: dict[str, dict[str, float]] = {}
    forces: dict[str, dict[str, float]] = {}
    reactions: dict[str, dict[str, float]] = {}
    case_results: dict[str, dict] = {}
    node_displacement_envelope: dict[str, dict] = {}
    element_force_envelope: dict[str, dict] = {}
    node_reaction_envelope: dict[str, dict] = {}

    node_disp_cases = extracted.get("node_disp", {})
    if not isinstance(node_disp_cases, dict):
        node_disp_cases = {}
    node_reaction_cases = extracted.get("node_reactions", {})
    if not isinstance(node_reaction_cases, dict):
        node_reaction_cases = {}
    member_force_blocks = extracted.get("member_forces", {})
    if not isinstance(member_force_blocks, dict):
        member_force_blocks = {}

    raw_case_keys = set(node_disp_cases.keys())
    raw_case_keys.update(node_reaction_cases.keys())
    for block in member_force_blocks.values():
        if isinstance(block, dict):
            raw_case_keys.update(block.keys())

    case_descriptors = _case_descriptors(extracted, raw_case_keys)
    displacement_rows_seen = 0
    nonzero_displacement_rows = 0
    force_rows_seen = 0
    reaction_rows_seen = 0

    for descriptor in case_descriptors:
        case_name = str(descriptor["result_key"])
        case_disps: dict[str, dict[str, float]] = {}
        raw_disps = _case_block(node_disp_cases, descriptor)
        if isinstance(raw_disps, list):
            for raw_disp in raw_disps:
                if not isinstance(raw_disp, dict):
                    continue
                displacement_rows_seen += 1
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
                if mag > 0:
                    nonzero_displacement_rows += 1
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
            raw_forces = _case_block(block, descriptor) if isinstance(block, dict) else []
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
                force_rows_seen += 1
                category_member_lookup = member_definition_lookup.get(category, {})
                raw_force = _merge_member_definition(category_member_lookup, raw_force)
                floor = int(round(_safe_float(raw_force.get("floor"), 0.0)))
                sequence_by_floor[floor] = sequence_by_floor.get(floor, 0) + 1
                elem_id, _match_method = _member_id_for(
                    category=category,
                    raw_member=raw_force,
                    sequence=sequence_by_floor[floor],
                    lookups=element_lookups,
                    result_node_lookup=result_node_lookup,
                    diagnostics=diagnostics,
                )
                force = _round_map(_force_from_sections(raw_force.get("sections")), digits=3)
                case_forces[elem_id] = _merge_max_force(case_forces.get(elem_id, {}), force)
                forces[elem_id] = _merge_max_force(forces.get(elem_id, {}), force)
                _accumulate_element_envelope(element_force_envelope, elem_id, case_name, force)

        case_reactions: dict[str, dict[str, float]] = {}
        raw_reactions = _case_block(node_reaction_cases, descriptor)
        if isinstance(raw_reactions, list):
            for raw_reaction in raw_reactions:
                if not isinstance(raw_reaction, dict):
                    continue
                reaction_rows_seen += 1
                raw_node_id = str(raw_reaction.get("id", raw_reaction.get("node_id")))
                node_id = result_node_lookup.get(raw_node_id, raw_node_id)
                reaction = _round_map(_reaction_from_raw(raw_reaction), digits=3)
                case_reactions[node_id] = _merge_max_reaction(case_reactions.get(node_id, {}), reaction)
                reactions[node_id] = _merge_max_reaction(reactions.get(node_id, {}), reaction)
                _accumulate_reaction_envelope(node_reaction_envelope, node_id, case_name, reaction)

        case_results[case_name] = {
            "status": "success",
            "key": case_name,
            "label": descriptor.get("label"),
            "name": descriptor.get("name"),
            "expName": descriptor.get("expName"),
            "kind": descriptor.get("kind"),
            "id": descriptor.get("id"),
            "oldId": descriptor.get("oldId"),
            "displacements": case_disps,
            "forces": case_forces,
            "reactions": case_reactions,
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

    max_reaction = 0.0
    control_reaction = ""
    for node_id, item in node_reaction_envelope.items():
        reaction = _safe_float(item.get("maxAbsReaction"))
        if reaction > max_reaction:
            max_reaction = reaction
            control_reaction = node_id

    envelope = {
        "maxAbsDisplacement": round(max_disp, 4),
        "controlNodeDisplacement": max_disp_node,
        "maxAbsAxialForce": round(max_axial, 2),
        "maxAbsShearForce": round(max_shear, 2),
        "maxAbsMoment": round(max_moment, 2),
        "maxAbsReaction": round(max_reaction, 3),
        "controlElementAxialForce": control_axial or None,
        "controlElementShearForce": control_shear or None,
        "controlElementMoment": control_moment or None,
        "controlNodeReaction": control_reaction or None,
    }
    if max_disp_node:
        envelope[f"node:{max_disp_node}:maxAbsDisplacement"] = round(max_disp, 4)

    warnings: list[str] = []
    if not mapping:
        warnings.append("YJK mapping.json was not found; raw YJK ids were used for result keys.")
    members = extracted.get("members", {})
    if not isinstance(members, dict) or all(not members.get(category) for category in ("columns", "beams", "braces")):
        warnings.append("YJK raw members were empty; element result mapping used force rows and fallbacks.")
    if force_rows_seen == 0:
        warnings.append("YJK raw member_forces were empty; top-level forces and element envelopes are empty.")
    if displacement_rows_seen == 0:
        warnings.append("YJK raw node_disp was empty; displacement envelopes are empty.")
    elif nonzero_displacement_rows == 0:
        warnings.append("YJK raw node_disp values were all zero; check whether the extractor returned solved displacements.")
    if reaction_rows_seen == 0:
        warnings.append("YJK raw node_reactions were empty; reaction envelopes are empty.")
    if diagnostics.get("node_coord_matches", 0) > 0:
        warnings.append(
            f"YJK node mapping used coordinate fallback for {diagnostics.get('node_coord_matches', 0)} result nodes."
        )
    if diagnostics.get("node_unmapped", 0) > 0:
        warnings.append(
            f"YJK node mapping left {diagnostics.get('node_unmapped', 0)} result nodes on raw ids."
        )
    if diagnostics.get("element_endpoint_matches", 0) > 0:
        warnings.append(
            f"YJK element mapping used endpoint fallback for {diagnostics.get('element_endpoint_matches', 0)} force rows."
        )
    if diagnostics.get("element_sequence_matches", 0) > 0:
        warnings.append(
            f"YJK element mapping used sequence fallback for {diagnostics.get('element_sequence_matches', 0)} force rows."
        )
    if diagnostics.get("element_unmapped", 0) > 0:
        warnings.append(
            f"YJK element mapping left {diagnostics.get('element_unmapped', 0)} force rows on raw ids."
        )

    return {
        "status": "success",
        "analysisMode": "yjk-static",
        "displacements": {key: _round_map(value) for key, value in displacements.items()},
        "forces": {key: _round_map(value, digits=3) for key, value in forces.items()},
        "reactions": {key: _round_map(value, digits=3) for key, value in reactions.items()},
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
            "reactionNodeCount": len(reactions),
            "maxDisplacement": round(max_disp, 4),
            "maxDisplacementNode": max_disp_node,
            "floors_analyzed": meta.get("n_floors"),
            "n_floors": meta.get("n_floors"),
            "n_nodes": meta.get("n_nodes"),
            "load_cases": extracted.get("load_cases", meta.get("load_cases")),
        },
        "data": extracted,
        "detailed": {
            "message": "YJK static analysis completed and results were extracted.",
            "yjk_project": yjk_project,
            "results_path": results_path,
            "extraction": extracted,
            "mapping": mapping,
            "normalization": diagnostics,
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
            "nodeReaction": node_reaction_envelope,
        },
        "warnings": warnings,
        "steps": steps,
    }


def main() -> int:
    global _CURRENT_WORK_DIR

    # -- Parse arguments ------------------------------------------------
    if len(sys.argv) < 3:
        _error("Usage: yjk_driver.py <model.json> <work_dir>", phase="arguments")
        return 1

    model_path = sys.argv[1]
    work_dir = sys.argv[2]
    _CURRENT_WORK_DIR = os.path.abspath(work_dir)

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
    global _CURRENT_WORK_DIR

    steps: list[dict] = []
    work_dir = os.path.abspath(work_dir)
    _CURRENT_WORK_DIR = work_dir
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
    yjks_exe_env = _env_path("YJKS_EXE")
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

    version = _env_text("YJK_VERSION", "8.0.0")
    attach_existing = _env_flag("YJK_ATTACH_EXISTING")
    use_launcher = (not attach_existing) and _should_launch_with_launcher(yjks_root)
    prewarm_mode = _launcher_prewarm_mode()

    # Default: show the YJK GUI so the user can observe the full workflow.
    # Set YJK_INVISIBLE=1 in .env to run fully headless (CI / unattended).
    cfg = ControlConfig()
    cfg.Version = version
    cfg.Invisible = _env_text("YJK_INVISIBLE", "0") == "1"
    if attach_existing:
        try:
            cfg.Pid = int(_env_text("YJK_ATTACH_PID", "-1") or "-1")
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
        if prewarm_mode == "always":
            if not _prewarm_yjk_launcher(yjks_root, steps):
                _error(
                    "YJK launcher authorization prewarm failed",
                    phase="launch",
                    command="YjkLauncher.exe",
                    steps=steps,
                    summary={"work_dir": work_dir},
                )
                return 1

        msg, launch_state = _run_yjk_direct(
            yjks_root=yjks_root,
            yjks_exe=yjks_exe,
            yjks_control=YJKSControl,
            steps=steps,
            attempt="direct",
        )

        if msg is None:
            _error(
                f"YJK failed to launch: {launch_state.get('error')}",
                phase="launch",
                command="RunYJK",
                steps=steps,
                summary={"work_dir": work_dir},
                detailed={
                    "hint": (
                        "RunYJK accepts only the yjks.exe file path. If this install "
                        "requires online/BIT launcher authorization, set "
                        "YJK_LAUNCHER_PREWARM=1 to let the official launcher initialize "
                        "authorization before direct RunYJK."
                    )
                },
            )
            return 1

        if launch_state.get("state") in {"auth_failed", "not_found"}:
            pid = int(_safe_float(launch_state.get("pid"), 0.0))
            if prewarm_mode == "off":
                _error(
                    "YJK direct launch did not produce an authorized YJK session",
                    phase="launch",
                    command="RunYJK",
                    steps=steps,
                    summary={"work_dir": work_dir},
                    detailed={
                        "windowTitle": launch_state.get("title"),
                        "hint": "Set YJK_LAUNCHER_PREWARM=auto or 1 for official launcher authorization prewarm.",
                    },
                )
                return 1

            if pid > 0:
                stopped = _stop_process(pid)
                _record_step(
                    steps,
                    phase="launch",
                    name="Close failed direct YJK session",
                    command="Stop-Process yjks",
                    status="success" if stopped else "warning",
                    message=(
                        "Closed the failed direct session before retry."
                        if stopped
                        else "Could not close the failed direct process before retry."
                    ),
                    pid=pid,
                )
            if not _prewarm_yjk_launcher(yjks_root, steps):
                _error(
                    "YJK direct launch authorization failed and launcher prewarm failed",
                    phase="launch",
                    command="YjkLauncher.exe",
                    steps=steps,
                    summary={"work_dir": work_dir},
                    detailed={"windowTitle": launch_state.get("title")},
                )
                return 1

            msg, retry_state = _run_yjk_direct(
                yjks_root=yjks_root,
                yjks_exe=yjks_exe,
                yjks_control=YJKSControl,
                steps=steps,
                attempt="after-launcher-prewarm",
            )
            if msg is None or retry_state.get("state") == "auth_failed":
                _error(
                    "YJK direct launch still failed authorization after official launcher prewarm",
                    phase="launch",
                    command="RunYJK",
                    steps=steps,
                    summary={"work_dir": work_dir},
                    detailed={
                        "windowTitle": retry_state.get("title"),
                        "hint": (
                            "The official launcher was started, but this machine still did not "
                            "expose a reusable authorization session to yjks.exe."
                        ),
                    },
                )
                return 1
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
        _env_text(name) == "1"
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

        output = {
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
        }
        _write_driver_output_json(work_dir, output)
        _emit_json(output)
        print("[yjk_driver] done — calculation running in YJK", file=sys.stderr, flush=True)
        _finish_after_json(work_dir=work_dir, steps=steps, exit_code=0, force_exit=True)

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

    if not _run_cmd("yjks_pyload", extract_script, "pyyjks", phase="result_extraction", steps=steps):
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
        extract_timeout = _env_float("YJK_EXTRACT_TIMEOUT_S", 30.0)
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

    _write_driver_output_json(work_dir, output)
    _emit_json(output)
    print("[yjk_driver] done — calculation and extraction completed", file=sys.stderr, flush=True)
    return _finish_after_json(work_dir=work_dir, steps=steps, exit_code=0, force_exit=True)


if __name__ == "__main__":
    raise SystemExit(main())
