from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_SRC = CURRENT_DIR.parents[2]

for path in (
    CURRENT_DIR.parent,
    BACKEND_SRC / "agent-skills" / "data-input",
):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)

from converters.registry import get_converter, supported_formats  # noqa: E402
from structure_protocol.runtime import (  # noqa: E402
    convert_structure_model_payload,
    get_structure_model_schema,
    validate_structure_model_payload,
)


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
    try:
        if action == "structure_model_schema":
            _ok(get_structure_model_schema())
            return 0
        if action == "converter_schema":
            _ok({
                "supportedFormats": supported_formats(),
                "defaultSourceFormat": "structuremodel-v1",
                "defaultTargetFormat": "structuremodel-v1",
                "warning": None,
            })
            return 0
        if action == "validate":
            _ok(validate_structure_model_payload(dict(payload.get("input") or {}).get("model") or {}))
            return 0
        if action == "convert":
            request = dict(payload.get("input") or {})
            _ok(convert_structure_model_payload(
                request.get("model") or {},
                str(request.get("target_schema_version", "1.0.0")),
                str(request.get("source_format", "structuremodel-v1")),
                str(request.get("target_format", "structuremodel-v1")),
                supported_formats(),
                get_converter,
            ))
            return 0
        _error("UNKNOWN_ACTION", f"Unknown worker action: {action}", status_code=400)
        return 1
    except HTTPException as error:
        detail = error.detail
        if isinstance(detail, dict):
            _error(
                str(detail.get("errorCode") or f"HTTP_{error.status_code}"),
                str(detail.get("message") or detail),
                status_code=error.status_code,
                detail=detail,
            )
        else:
            _error(f"HTTP_{error.status_code}", str(detail), status_code=error.status_code, detail=detail)
        return 1
    except ValidationError as error:
        _error(
            "VALIDATION_ERROR",
            "Validation failed",
            status_code=422,
            detail=error.errors(include_context=False),
        )
        return 1
    except Exception as error:  # noqa: BLE001
        _error("WORKER_EXECUTION_FAILED", str(error), detail={"type": type(error).__name__})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
