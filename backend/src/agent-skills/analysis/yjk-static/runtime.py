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
    Defaults to ``<tempdir>/yjk_projects``.
YJK_VERSION : str, optional
    YJK version string passed to ControlConfig.  Default ``8.0.0``.
YJK_TIMEOUT_S : str, optional
    Subprocess timeout in seconds.  Default ``600``.
YJK_INVISIBLE : str, optional
    Set to ``"1"`` to launch YJK headlessly (no GUI window).
    Default ``"0"`` — YJK GUI is visible so the user can observe the run.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict

from contracts import EngineNotAvailableError


def _yjk_install_root() -> str:
    """Resolve install root: ``YJK_PATH`` if set, else ``YJKS_ROOT``."""
    return (os.getenv("YJK_PATH", "").strip() or os.getenv("YJKS_ROOT", "").strip())


def _resolve_yjk_python() -> str:
    """Return the path to YJK's bundled Python 3.10 executable."""
    explicit = os.getenv("YJK_PYTHON_BIN", "").strip()
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

    python_exe = Path(root) / "Python310" / "python.exe"
    if not python_exe.is_file():
        raise EngineNotAvailableError(
            engine="yjk",
            reason=f"YJK Python 3.10 not found at {python_exe}",
        )
    return str(python_exe)


def _resolve_work_dir() -> Path:
    """Return a per-run subdirectory under YJK_WORK_DIR.

    YJK_WORK_DIR should be set by the user so that generated project files,
    .OUT results, and logs land in a known, reviewable location.
    Falls back to the system temp directory when unset (not recommended).
    """
    import warnings
    base = os.getenv("YJK_WORK_DIR", "").strip()
    if not base:
        fallback = str(Path(tempfile.gettempdir()) / "yjk_projects")
        warnings.warn(
            "YJK_WORK_DIR is not set; using system temp directory as fallback: "
            f"{fallback}. Set YJK_WORK_DIR in .env to a persistent location.",
            stacklevel=2,
        )
        base = fallback
    project_name = f"sc_{uuid.uuid4().hex[:8]}"
    work = Path(base) / project_name
    work.mkdir(parents=True, exist_ok=True)
    return work


def _extract_last_json(text: str) -> dict | None:
    """Extract the last complete JSON object from text.

    YJK's Python runtime may print non-JSON lines (copyright banners,
    init messages) to stdout before our _emit_json() call.  We scan
    backwards for the last '{' ... '}' block that parses cleanly.
    """
    # Fast path: the whole string is valid JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Scan for the last '{' and try progressively larger suffixes
    last_brace = text.rfind('{')
    if last_brace == -1:
        return None
    try:
        return json.loads(text[last_brace:])
    except json.JSONDecodeError:
        pass

    # Fallback: try each line from the end
    lines = text.splitlines()
    for i in range(len(lines) - 1, -1, -1):
        candidate = '\n'.join(lines[i:]).strip()
        if candidate.startswith('{'):
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue
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
    yjk_python = _resolve_yjk_python()
    work_dir = _resolve_work_dir()
    timeout = int(os.getenv("YJK_TIMEOUT_S", "600").strip() or "600")

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

    # Build environment for the subprocess.
    # Ensure both YJKS_ROOT and YJK_PATH are set for SDK scripts / driver.
    env = os.environ.copy()
    root = _yjk_install_root()
    if root:
        env.setdefault("YJKS_ROOT", root)
        env.setdefault("YJK_PATH", root)
    for key in ("YJKS_EXE", "YJK_VERSION", "YJK_PYTHON_BIN", "YJK_INVISIBLE"):
        val = os.getenv(key, "").strip()
        if val:
            env[key] = val

    warnings: list[str] = []

    # Launch the driver under YJK's Python 3.10
    try:
        result = subprocess.run(
            [yjk_python, str(driver_path), str(model_path), str(work_dir)],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            cwd=str(work_dir),
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"YJK analysis timed out after {timeout}s")
    except FileNotFoundError as exc:
        raise RuntimeError(f"Cannot launch YJK Python: {exc}")

    # Parse stdout as JSON result.
    # The driver writes only ONE JSON blob to stdout; all progress/debug
    # output goes to stderr so the user can see it in the backend log.
    stdout = result.stdout.strip()
    stderr = result.stderr.strip()

    if stderr:
        import logging
        logging.getLogger("yjk-runtime").info("YJK driver stderr:\n%s", stderr)

    if result.returncode != 0 and not stdout:
        stderr_snippet = stderr[:800] if stderr else "(no stderr)"
        raise RuntimeError(
            f"YJK driver exited with code {result.returncode}.\n"
            f"stderr: {stderr_snippet}"
        )

    if not stdout:
        stderr_snippet = stderr[:800] if stderr else "(no stderr)"
        raise RuntimeError(
            f"YJK driver produced no stdout output.\n"
            f"stderr: {stderr_snippet}"
        )

    # YJK's Python runtime may print non-JSON text (copyright banners,
    # init messages) to stdout before our _emit_json() call.  Extract
    # the last complete JSON object from stdout so those lines don't
    # break parsing.
    output = _extract_last_json(stdout)
    if output is None:
        raise RuntimeError(
            f"YJK driver output is not valid JSON.\n"
            f"stdout (first 500 chars): {stdout[:500]}\n"
            f"stderr (first 500 chars): {stderr[:500]}"
        )

    status = output.get("status", "error")
    if status == "error":
        error_msg = output.get("detailed", {}).get("error", "Unknown YJK error")
        raise RuntimeError(f"YJK analysis failed: {error_msg}")

    if stderr:
        warnings.append(f"YJK stderr: {stderr[:300]}")

    existing_warnings = output.get("warnings", [])
    if isinstance(existing_warnings, list):
        warnings.extend(existing_warnings)

    return {
        "status": output.get("status", "success"),
        "summary": output.get("summary", {}),
        "data": output.get("data", {}),
        "detailed": output.get("detailed", {}),
        "warnings": warnings,
    }
