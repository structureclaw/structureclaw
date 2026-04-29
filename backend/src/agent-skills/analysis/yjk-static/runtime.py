"""YJK static analysis skill -- runtime.

Delegates the actual YJKAPI work to a subprocess running YJK's
bundled Python 3.10 (``yjk_driver.py``).  This module runs under the
project's own venv Python and therefore cannot import YJKAPI directly.

Environment variables
---------------------
YJKS_ROOT or YJK_PATH : str
    YJK 8.0 installation root (``yjks.exe`` and ``Python310`` live here).
    The official YJK SDK samples use ``YJKS_ROOT``; ``YJK_PATH`` is an
    alias supported for compatibility.
YJKS_EXE : str, optional
    Direct path to ``yjks.exe``.  Overrides root-directory derivation.
YJK_PYTHON_BIN : str, optional
    Direct path to YJK's Python 3.10 interpreter.
    Defaults to ``<install_root>/Python310/python.exe``.
YJK_WORK_DIR : str, optional
    Base directory for YJK project files.
    Defaults to ``~/.structureclaw/analysis/yjk``.
YJK_CWD : str, optional
    Working directory used while calling SDK ``RunYJK(yjks.exe)``.
    Defaults to the YJK install root.
YJK_VERSION : str, optional
    YJK version string passed to ControlConfig.  Default ``8.0.0``.
YJK_TIMEOUT_S : str, optional
    Subprocess timeout in seconds.  Default ``600``.
YJK_INVISIBLE : str, optional
    Set to ``"1"`` to launch YJK headlessly (no GUI window).
    Default ``"0"`` — YJK GUI is visible so the user can observe the run.
YJK_START_ONLY / YJK_ASYNC_CALC : str, optional
    Set either to ``"1"`` to start YJK calculation without waiting for
    completion or extracting results. Default is synchronous closed-loop run.
YJK_ATTACH_EXISTING : str, optional
    Set to ``"1"`` to attach to an already authorized YJK GUI session instead
    of starting ``yjks.exe`` directly. Start YJK from ``YjkLauncher.exe`` first
    and enter the ``yjksipccontrol`` command in YJK before running analysis.
YJK_ATTACH_PID : str, optional
    PID to attach to when ``YJK_ATTACH_EXISTING=1``. Defaults to ``-1``, which
    lets YJK prompt for a target process when multiple sessions exist.
YJK_USE_LAUNCHER : str, optional
    Set to ``"1"`` to start YJK through ``YjkLauncher.exe`` and wait for an
    externally launched ``yjks.exe`` session. When unset, the runtime uses the
    SDK ``RunYJK(yjks.exe)`` direct launch path.
YJK_LAUNCHER_EXE : str, optional
    Direct path to ``YjkLauncher.exe``. Defaults to ``<install_root>/YjkLauncher.exe``.
YJK_LAUNCHER_PREWARM : str, optional
    ``auto`` (default) retries direct ``RunYJK(yjks.exe)`` after starting the
    official launcher if YJK shows an authorization failure dialog. ``1`` starts
    the launcher before the first direct run; ``0`` disables this fallback.
YJK_DIRECT_READY_TIMEOUT_S / YJK_LAUNCHER_PREWARM_S : str, optional
    Timeouts for detecting direct-launch authorization failure and waiting for
    the official launcher to initialize authorization.
YJK_LAUNCHER_WAIT_S / YJK_AUTO_IPC_DELAY_S : str, optional
    Timeouts for waiting for launcher startup and sending ``yjksipccontrol``.
YJK_EXTRACT_TIMEOUT_S : str, optional
    Seconds to wait for ``work_dir/results.json`` after ``yjks_pyload`` returns.
    Default ``30``.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict

from contracts import EngineNotAvailableError

YJK_LOG_SNIPPET_LIMIT = 2000
YJK_STEP_LIMIT = 8
YJK_DETAIL_STRING_LIMIT = 500
YJK_DETAIL_COLLECTION_LIMIT = 12
YJK_DETAIL_DEPTH_LIMIT = 3
YJK_MESSAGE_DETAIL_KEYS = (
    "returncode",
    "timeoutSeconds",
    "phase",
    "command",
    "error",
    "results_path",
    "windowTitle",
)


def _env_text(key: str, default: str = "") -> str:
    """Read an environment variable as stripped text."""
    value = os.getenv(key)
    if value is None:
        return default
    return str(value).strip()


def _env_int(key: str, default: int) -> int:
    try:
        return int(_env_text(key, str(default)) or str(default))
    except ValueError:
        return default


def _repo_root() -> Path:
    """Resolve the StructureClaw repository root from this runtime module."""
    return Path(__file__).resolve().parents[5]


def _safe_name(value: Any, fallback: str) -> str:
    """Return a filesystem-safe short name for trace/run identifiers."""
    text = str(value or "").strip()
    if not text:
        return fallback
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", text).strip(".-")
    return safe[:80] or fallback


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return ""
    except OSError:
        return ""


def _read_json(path: Path) -> dict | None:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def _tail_text(text: str, limit: int = YJK_LOG_SNIPPET_LIMIT) -> str:
    text = str(text or "").strip()
    if not text:
        return ""
    if len(text) <= limit:
        return text
    omitted = len(text) - limit
    return f"...[truncated {omitted} chars]\n{text[-limit:]}"


def _compact_detail_text(text: str, limit: int = YJK_DETAIL_STRING_LIMIT) -> str:
    text = str(text or "").strip()
    if len(text) <= limit:
        return text
    omitted = len(text) - limit
    marker = f"\n...[truncated {omitted} chars]...\n"
    body_limit = max(0, limit - len(marker))
    head_limit = int(body_limit * 0.35)
    tail_limit = body_limit - head_limit
    return f"{text[:head_limit]}{marker}{text[-tail_limit:]}"


def _sanitize_detail_value(value: Any, depth: int = 0) -> Any:
    if depth >= YJK_DETAIL_DEPTH_LIMIT:
        return "<truncated>"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _compact_detail_text(value)
    if isinstance(value, (list, tuple)):
        items = [
            _sanitize_detail_value(item, depth + 1)
            for item in value[:YJK_DETAIL_COLLECTION_LIMIT]
        ]
        omitted = len(value) - YJK_DETAIL_COLLECTION_LIMIT
        if omitted > 0:
            items.append(f"...[truncated {omitted} items]")
        return items
    if isinstance(value, dict):
        items = list(value.items())
        sanitized: Dict[str, Any] = {}
        for key, item in items[:YJK_DETAIL_COLLECTION_LIMIT]:
            sanitized[_compact_detail_text(str(key), 120)] = _sanitize_detail_value(
                item,
                depth + 1,
            )
        omitted = len(items) - YJK_DETAIL_COLLECTION_LIMIT
        if omitted > 0:
            sanitized["_truncated"] = f"{omitted} keys"
        return sanitized
    return _compact_detail_text(str(value))


def _message_detail_summary(detail: Dict[str, Any] | None) -> Dict[str, Any]:
    if not isinstance(detail, dict):
        return {}
    return {
        key: _sanitize_detail_value(detail[key])
        for key in YJK_MESSAGE_DETAIL_KEYS
        if key in detail
    }


def _summarize_steps(output: dict | None, limit: int = YJK_STEP_LIMIT) -> list[str]:
    if not isinstance(output, dict):
        return []
    steps = output.get("steps")
    if not isinstance(steps, list):
        return []
    lines: list[str] = []
    for step in steps[-limit:]:
        if not isinstance(step, dict):
            continue
        name = str(step.get("name") or "step")
        parts = [name]
        for key in ("phase", "status", "command", "message"):
            value = step.get(key)
            if value:
                parts.append(f"{key}={value}")
        lines.append("- " + "; ".join(parts))
    return lines


def _raise_yjk_runtime_error(
    headline: str,
    *,
    work_dir: Path,
    stdout_path: Path | None = None,
    stderr_path: Path | None = None,
    driver_output_path: Path | None = None,
    stdout: str = "",
    stderr: str = "",
    output: dict | None = None,
    detail: Dict[str, Any] | None = None,
    extra_paths: Dict[str, Path] | None = None,
) -> None:
    stdout_tail = _tail_text(stdout)
    stderr_tail = _tail_text(stderr)
    steps_tail = _summarize_steps(output)
    safe_detail = _sanitize_detail_value(detail) if detail else None
    message_detail = _message_detail_summary(
        safe_detail if isinstance(safe_detail, dict) else None,
    )
    run_meta_path = work_dir / "run-meta.json"
    driver_result_path = work_dir / "driver-result.json"

    paths: Dict[str, Path] = {
        "workDir": work_dir,
        "runMetaPath": run_meta_path,
        "driverResultPath": driver_result_path,
    }
    if driver_output_path is not None:
        paths["driverOutputPath"] = driver_output_path
    if stdout_path is not None:
        paths["stdoutPath"] = stdout_path
    if stderr_path is not None:
        paths["stderrPath"] = stderr_path
    if extra_paths:
        paths.update(extra_paths)

    lines = [headline, "", "Artifact feedback:"]
    for label, path in paths.items():
        lines.append(f"- {label}: {path}")
    if message_detail:
        lines.append(f"- detail: {json.dumps(message_detail, ensure_ascii=False)}")
    if steps_tail:
        lines.extend(["", "Recent driver steps:", *steps_tail])
    if stderr_tail:
        lines.extend(["", "driver stderr tail:", stderr_tail])
    if stdout_tail:
        lines.extend(["", "driver stdout tail:", stdout_tail])

    meta: Dict[str, Any] = {label: str(path) for label, path in paths.items()}
    if stdout_tail:
        meta["stdoutTail"] = stdout_tail
    if stderr_tail:
        meta["stderrTail"] = stderr_tail
    if steps_tail:
        meta["stepsTail"] = steps_tail
    if safe_detail:
        meta["yjkErrorDetail"] = safe_detail

    error = RuntimeError("\n".join(lines))
    setattr(error, "meta", meta)
    if safe_detail:
        setattr(error, "detail", safe_detail)
    raise error


def _yjk_install_root() -> str:
    """Resolve install root: ``YJK_PATH`` if set, else ``YJKS_ROOT``."""
    configured = _env_text("YJK_PATH") or _env_text("YJKS_ROOT")
    if configured:
        return configured
    for candidate in (r"C:\YJKS\YJKS_8_0_0", r"D:\YJKS\YJKS_8_0_0"):
        if Path(candidate).is_dir():
            return candidate
    return ""


def _resolve_yjk_python() -> str:
    """Return the path to YJK's bundled Python 3.10 executable."""
    explicit = _env_text("YJK_PYTHON_BIN")
    if explicit and Path(explicit).is_file():
        return explicit

    root = _yjk_install_root()
    if not root:
        raise EngineNotAvailableError(
            engine="yjk",
            reason="YJK install root not set (set YJKS_ROOT or YJK_PATH)",
        )
    if not Path(root).is_dir():
        raise EngineNotAvailableError(
            engine="yjk",
            reason=f"YJK install directory does not exist: {root}",
        )

    python_exe = next(
        (
            candidate
            for candidate in (
                Path(root) / "Python310" / "python.exe",
                Path(root) / "python310" / "python.exe",
            )
            if candidate.is_file()
        ),
        None,
    )
    if python_exe is None:
        raise EngineNotAvailableError(
            engine="yjk",
            reason=f"YJK Python 3.10 not found under {root}",
        )
    return str(python_exe)


def _resolve_work_dir(parameters: Dict[str, Any]) -> Path:
    """Return a per-run subdirectory under YJK_WORK_DIR.

    YJK_WORK_DIR can be set by the user so that generated project files,
    .OUT results, and logs land in a known, reviewable location. When unset,
    files are written under ``~/.structureclaw/analysis/yjk``.
    """
    base = _env_text("YJK_WORK_DIR")
    if not base:
        base = str(Path.home() / ".structureclaw" / "analysis" / "yjk")

    trace_id = _safe_name(parameters.get("traceId"), f"run-{uuid.uuid4().hex[:8]}")
    project_name = f"sc_{trace_id}"
    work = Path(base) / project_name
    work.mkdir(parents=True, exist_ok=True)
    return work


def _extract_last_json(text: str) -> dict | None:
    """Extract the last complete JSON object from text.

    YJK's Python runtime may print non-JSON lines (copyright banners,
    init messages) to stdout before our _emit_json() call, and yjks.exe may
    keep appending progress text after the driver JSON.  Decode any complete
    driver-shaped JSON object embedded in the stream and ignore trailing text.
    """
    # Fast path: the whole string is valid JSON
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    fallback: dict | None = None
    for match in re.finditer(r"\{", text):
        try:
            parsed, _ = decoder.raw_decode(text[match.start():])
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        if fallback is None:
            fallback = parsed
        if "status" not in parsed:
            continue
        if "analysisMode" in parsed or "summary" in parsed or "detailed" in parsed:
            return parsed
        fallback = parsed
    if fallback is not None and "status" in fallback:
        return fallback
    return None


def _ensure_v2_model(model_dict: dict) -> dict:
    """Convert a V1 model dict to V2-compatible format for the YJK converter.

    The YJK converter expects V2 fields (stories, V2-style sections with
    width/height, materials with category).  V1 models from build_model
    lack these.  This function synthesizes the missing V2 fields from V1
    data so the converter can proceed.

    Coordinate system
    -----------------
    V1 frame handler (frame/model.ts) uses:
        x = X-axis (horizontal span)
        y = vertical (storey height)   <-- vertical axis
        z = Y-axis (plan depth, 0 for 2-D models)

    V2 / YJK expects:
        x = X-axis
        y = Y-axis (plan depth)
        z = vertical                   <-- vertical axis

    We detect V1 models by checking whether any node has a non-zero y
    value while z is uniformly 0 (2-D) or z carries plan-depth values
    (3-D).  When detected, we remap:
        V2.x = V1.x
        V2.y = V1.z   (plan Y-axis)
        V2.z = V1.y   (vertical)
    """
    if model_dict.get("schema_version", "").startswith("2"):
        return model_dict

    from copy import deepcopy
    v2 = deepcopy(model_dict)
    v2["schema_version"] = "2.0.0"

    nodes = v2.get("nodes", [])

    # --- Remap V1 coordinates (x,y=vertical,z=planY) -> V2 (x,y=planY,z=vertical) ---
    # Detect V1 layout: at least one node has y > 0 (storey elevation) and
    # the vertical axis is y, not z.
    needs_remap = nodes and any(float(n.get("y", 0)) > 0 for n in nodes)
    if needs_remap:
        for n in nodes:
            v1_x = float(n.get("x", 0))
            v1_y = float(n.get("y", 0))  # vertical in V1
            v1_z = float(n.get("z", 0))  # plan-Y in V1
            n["x"] = v1_x
            n["y"] = v1_z   # plan-Y becomes V2.y
            n["z"] = v1_y   # vertical becomes V2.z

    # --- Synthesize stories from node Z coordinates (vertical after remap) ---
    if not v2.get("stories") and nodes:
        z_vals = sorted({round(float(n.get("z", 0)), 3) for n in nodes})
        elevations = [z for z in z_vals if z > 0]
        if not elevations:
            max_z = max((float(n.get("z", 0)) for n in nodes), default=3.0)
            elevations = [max_z] if max_z > 0 else [3.0]

        stories = []
        prev_elev = 0.0
        for i, elev in enumerate(elevations):
            story_id = f"F{i + 1}"
            height = round(elev - prev_elev, 3)
            if height <= 0:
                height = 3.0
            stories.append({
                "id": story_id,
                "height": height,
                "elevation": elev,
                "floor_loads": [
                    {"type": "dead", "value": 5.0},
                    {"type": "live", "value": 2.0},
                ],
            })
            prev_elev = elev
        v2["stories"] = stories

        elev_to_story = {round(s["elevation"], 3): s["id"] for s in stories}
        for n in nodes:
            nz = round(float(n.get("z", 0)), 3)
            if nz in elev_to_story and not n.get("story"):
                n["story"] = elev_to_story[nz]

    # --- Enrich materials with category ---
    import re as _re_mat
    for mat in v2.get("materials", []):
        if not mat.get("category"):
            name = (mat.get("name", "") or "").upper()
            if _re_mat.match(r'^(Q|S|A)\d', name) or "STEEL" in name or "钢" in name:
                mat["category"] = "steel"
            elif _re_mat.match(r'^C\d', name) or "CONCRETE" in name or "混凝土" in name:
                mat["category"] = "concrete"
            else:
                mat["category"] = "steel"

    # --- Enrich sections: recognize standard steel names and geometry ---
    import re
    _STD_STEEL_RE = re.compile(
        r'^(HW|HN|HM|HP|HT|I|C|L|TW|TN)\d+[Xx×]\d+',
        re.IGNORECASE,
    )
    _H_DIMS_RE = re.compile(
        r'^(?:HW|HN|HM|HP|HT)(\d+)[Xx×](\d+)(?:[Xx×](\d+)[Xx×](\d+))?',
        re.IGNORECASE,
    )

    for sec in v2.get("sections", []):
        props = sec.get("properties", {})
        sec_name = (sec.get("name") or "").strip()

        if sec_name and _STD_STEEL_RE.match(sec_name):
            normalized_sec_name = sec_name.upper().replace("×", "X").replace("x", "X")
            m = _H_DIMS_RE.match(sec_name)
            if m:
                H_val = int(m.group(1))
                B_val = int(m.group(2))
                tw_val = int(m.group(3)) if m.group(3) else None
                tf_val = int(m.group(4)) if m.group(4) else None
                if not sec.get("height"):
                    sec["height"] = H_val
                if not sec.get("width"):
                    sec["width"] = B_val

                if tw_val and tf_val:
                    sec["type"] = "H"
                    props.setdefault("tw", tw_val)
                    props.setdefault("H", H_val)
                    props.setdefault("B1", B_val)
                    props.setdefault("B2", B_val)
                    props.setdefault("tf1", tf_val)
                    props.setdefault("tf2", tf_val)
                    props.pop("standard_steel_name", None)
                    sec["properties"] = props
                else:
                    # Write to both top-level (V2 canonical) and properties (legacy compat)
                    sec.setdefault("standard_steel_name", normalized_sec_name)
                    props.setdefault("standard_steel_name", normalized_sec_name)
                    sec["properties"] = props
                    if not sec.get("type") or sec.get("type") == "beam":
                        sec["type"] = "H"
            else:
                # Write to both top-level (V2 canonical) and properties (legacy compat)
                sec.setdefault("standard_steel_name", normalized_sec_name)
                props.setdefault("standard_steel_name", normalized_sec_name)
                sec["properties"] = props
                if not sec.get("type") or sec.get("type") == "beam":
                    sec["type"] = "H"
            continue

        if not sec.get("width") and "B" in props:
            sec["width"] = float(props["B"])
        if not sec.get("height") and "H" in props:
            sec["height"] = float(props["H"])
        if not sec.get("width") and "b" in props:
            sec["width"] = float(props["b"])
        if not sec.get("height") and "h" in props:
            sec["height"] = float(props["h"])
        if not sec.get("width") and not sec.get("height"):
            a = props.get("A", 0)
            if a and not props.get("B") and not props.get("H"):
                import math
                side = round(math.sqrt(float(a)) * 1000, 0)
                if side > 0:
                    sec["width"] = side
                    sec["height"] = side

    # --- Enrich elements with column type based on vertical (Z) orientation ---
    # NOTE: This block runs AFTER the V1->V2 coordinate remap above, so
    # n["z"] is already the vertical axis for both V1 and native V2 payloads.
    # dz = vertical delta → column; dx/dy dominant → beam.
    node_map = {n["id"]: n for n in nodes}
    for elem in v2.get("elements", []):
        if elem.get("type") in ("beam", "column"):
            nids = elem.get("nodes", [])
            if len(nids) >= 2:
                n1 = node_map.get(nids[0], {})
                n2 = node_map.get(nids[1], {})
                dz = abs(float(n2.get("z", 0)) - float(n1.get("z", 0)))
                dx = abs(float(n2.get("x", 0)) - float(n1.get("x", 0)))
                dy = abs(float(n2.get("y", 0)) - float(n1.get("y", 0)))
                if dz > 0 and dz >= max(dx, dy, 0.001):
                    elem["type"] = "column"
                elif elem.get("type") != "column":
                    elem["type"] = "beam"

    return v2


def run_analysis(model: Dict[str, Any], parameters: Dict[str, Any]) -> Dict[str, Any]:
    """Entry point called by the analysis registry.

    Parameters
    ----------
    model : dict
        Deserialized StructureModelV2 payload (raw dict).
    parameters : dict
        Analysis parameters forwarded from the API request.

    Returns
    -------
    dict
        AnalysisResult-shaped dict with status / summary / detailed / warnings.
    """
    parameters = parameters or {}
    yjk_python = _resolve_yjk_python()
    work_dir = _resolve_work_dir(parameters)
    timeout = _env_int("YJK_TIMEOUT_S", 600)

    # Write V2 model JSON to work directory.
    # `model` may arrive as a Pydantic object (StructureModelV1); serialize it first.
    model_dict = model.model_dump(mode="json") if hasattr(model, "model_dump") else model
    # The YJK converter expects V2 format. If the model is V1, convert it.
    model_dict = _ensure_v2_model(model_dict)
    model_path = work_dir / "model.json"
    model_path.write_text(json.dumps(model_dict, ensure_ascii=False), encoding="utf-8")

    # Locate the driver script (sibling of this file)
    driver_path = Path(__file__).resolve().parent / "yjk_driver.py"
    if not driver_path.is_file():
        raise RuntimeError(f"YJK driver script not found: {driver_path}")

    trace_id = parameters.get("traceId")
    run_meta = {
        "traceId": trace_id,
        "workDir": str(work_dir),
        "modelPath": str(model_path),
        "driverPath": str(driver_path),
        "yjkPython": yjk_python,
        "timeoutSeconds": timeout,
    }
    _write_json(work_dir / "run-meta.json", run_meta)

    # Build environment for the subprocess.
    # Ensure both YJKS_ROOT and YJK_PATH are set for SDK scripts / driver.
    env = os.environ.copy()
    root = _yjk_install_root()
    if root:
        if not str(env.get("YJKS_ROOT") or "").strip():
            env["YJKS_ROOT"] = root
        if not str(env.get("YJK_PATH") or "").strip():
            env["YJK_PATH"] = root
    for key in (
        "YJKS_EXE",
        "YJK_VERSION",
        "YJK_PYTHON_BIN",
        "YJK_INVISIBLE",
        "YJK_ATTACH_EXISTING",
        "YJK_ATTACH_PID",
        "YJK_CWD",
        "YJK_USE_LAUNCHER",
        "YJK_LAUNCHER_EXE",
        "YJK_LAUNCHER_CWD",
        "YJK_LAUNCHER_PREWARM",
        "YJK_LAUNCHER_PREWARM_S",
        "YJK_DIRECT_READY_TIMEOUT_S",
        "YJK_LAUNCHER_WAIT_S",
        "YJK_AUTO_IPC_DELAY_S",
        "YJK_AUTO_IPC_FOCUS_DELAY_S",
        "YJK_SKIP_AUTO_IPC",
    ):
        val = _env_text(key)
        if val:
            env[key] = val

    warnings: list[str] = []

    # Launch the driver under YJK's Python 3.10.  Keep stdout/stderr file-backed
    # instead of pipe-backed: yjks.exe is a GUI child process that can inherit
    # pipe handles and keep subprocess.run(capture_output=True) waiting for EOF
    # even after yjk_driver.py has emitted the final JSON and exited.
    stdout_path = work_dir / "driver.stdout.txt"
    stderr_path = work_dir / "driver.stderr.txt"
    driver_output_path = work_dir / "driver-output.json"
    try:
        with stdout_path.open("w", encoding="utf-8") as stdout_file, stderr_path.open(
            "w",
            encoding="utf-8",
        ) as stderr_file:
            proc = subprocess.Popen(
                [yjk_python, str(driver_path), str(model_path), str(work_dir)],
                stdin=subprocess.DEVNULL,
                stdout=stdout_file,
                stderr=stderr_file,
                env=env,
                cwd=str(work_dir),
                close_fds=True,
            )
            try:
                returncode = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
                stdout = _read_text(stdout_path)
                stderr = _read_text(stderr_path)
                _write_json(
                    work_dir / "driver-timeout.json",
                    {
                        **run_meta,
                        "timeoutSeconds": timeout,
                        "returncode": proc.returncode,
                        "stdout": stdout,
                        "stderr": stderr,
                    },
                )
                _raise_yjk_runtime_error(
                    f"YJK analysis timed out after {timeout}s",
                    work_dir=work_dir,
                    stdout_path=stdout_path,
                    stderr_path=stderr_path,
                    driver_output_path=driver_output_path,
                    stdout=stdout,
                    stderr=stderr,
                    detail={
                        "timeoutSeconds": timeout,
                        "returncode": proc.returncode,
                    },
                    extra_paths={
                        "driverTimeoutPath": work_dir / "driver-timeout.json",
                    },
                )
    except FileNotFoundError as exc:
        raise RuntimeError(f"Cannot launch YJK Python: {exc}")

    stdout = _read_text(stdout_path)
    stderr = _read_text(stderr_path)
    _write_json(
        work_dir / "driver-result.json",
        {
            **run_meta,
            "returncode": returncode,
            "stdout": stdout,
            "stderr": stderr,
            "driverOutputPath": str(driver_output_path),
        },
    )

    # Parse stdout as JSON result.
    # The driver writes only ONE JSON blob to stdout; all progress/debug
    # output goes to stderr so the user can see it in the backend log.
    stdout = stdout.strip()
    stderr = stderr.strip()

    if stderr:
        import logging
        logging.getLogger("yjk-runtime").info("YJK driver stderr:\n%s", stderr)

    # Prefer the driver-written UTF-8 output file. Stdout is kept only as a
    # compatibility fallback because YJK/YJKS may interleave progress text and
    # append more bytes after the JSON object.
    output = _read_json(driver_output_path)

    if returncode != 0 and not stdout and output is None:
        _raise_yjk_runtime_error(
            f"YJK driver exited with code {returncode}.",
            work_dir=work_dir,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            driver_output_path=driver_output_path,
            stdout=stdout,
            stderr=stderr,
            detail={"returncode": returncode},
        )

    if not stdout and output is None:
        _raise_yjk_runtime_error(
            "YJK driver produced no stdout output.",
            work_dir=work_dir,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            driver_output_path=driver_output_path,
            stdout=stdout,
            stderr=stderr,
            detail={"returncode": returncode},
        )

    output = output or _extract_last_json(stdout)
    if output is None:
        _raise_yjk_runtime_error(
            "YJK driver output is not valid JSON.",
            work_dir=work_dir,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            driver_output_path=driver_output_path,
            stdout=stdout,
            stderr=stderr,
            detail={"returncode": returncode},
        )

    status = output.get("status", "error")
    if status == "error":
        raw_error_detail = output.get("detailed", {})
        error_detail = raw_error_detail if isinstance(raw_error_detail, dict) else {}
        error_msg = error_detail.get("error", "Unknown YJK error")
        phase = error_detail.get("phase")
        command = error_detail.get("command")
        context = []
        if phase:
            context.append(f"phase={phase}")
        if command:
            context.append(f"command={command}")
        context_text = f" ({', '.join(context)})" if context else ""
        detail = {
            "returncode": returncode,
            "error": error_msg,
            **error_detail,
        }
        _raise_yjk_runtime_error(
            f"YJK analysis failed{context_text}: {error_msg}",
            work_dir=work_dir,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            driver_output_path=driver_output_path,
            stdout=stdout,
            stderr=stderr,
            output=output,
            detail=detail,
        )

    if stderr:
        warnings.append(f"YJK stderr: {stderr[:300]}")

    existing_warnings = output.get("warnings", [])
    if isinstance(existing_warnings, list):
        warnings.extend(existing_warnings)

    result_payload = {
        key: value
        for key, value in output.items()
        if key not in {"status", "warnings"}
    }
    existing_meta = result_payload.get("meta")
    result_payload["meta"] = {
        **(existing_meta if isinstance(existing_meta, dict) else {}),
        "traceId": trace_id,
        "workDir": str(work_dir),
        "runMetaPath": str(work_dir / "run-meta.json"),
        "driverResultPath": str(work_dir / "driver-result.json"),
        "driverOutputPath": str(driver_output_path),
    }
    return {
        "status": output.get("status", "success"),
        **result_payload,
        "warnings": warnings,
    }
