from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

CURRENT_DIR = Path(__file__).resolve().parent

path_str = str(CURRENT_DIR)
if path_str not in sys.path:
    sys.path.insert(0, path_str)

from runtime import run_code_check  # noqa: E402


def _ok(payload: Any) -> None:
    print(json.dumps({"ok": True, "data": payload}, ensure_ascii=False))


def _error(error_code: str, message: str, *, status_code: int = 500, detail: Any = None) -> None:
    print(json.dumps({
        "ok": False,
        "errorCode": error_code,
        "message": message,
        "statusCode": status_code,
        "detail": detail,
    }, ensure_ascii=False))


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        _error("EMPTY_REQUEST", "Worker received an empty request", status_code=400)
        return 1

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        _error("INVALID_JSON", f"Invalid worker JSON: {error}", status_code=400)
        return 1

    action = payload.get("action")
    if action != "code_check":
        _error("UNKNOWN_ACTION", f"Unknown worker action: {action}", status_code=400)
        return 1

    request = dict(payload.get("input") or {})
    try:
        _ok(run_code_check(
            str(request.get("model_id", "")),
            str(request.get("code", "")),
            list(request.get("elements") or []),
            dict(request.get("context") or {}),
        ))
        return 0
    except Exception as error:  # noqa: BLE001
        _error("WORKER_EXECUTION_FAILED", str(error), detail={"type": type(error).__name__})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
