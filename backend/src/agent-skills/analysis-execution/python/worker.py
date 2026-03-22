from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict

from fastapi import HTTPException
from pydantic import ValidationError

CURRENT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = CURRENT_DIR.parents[2]

for path in (
    CURRENT_DIR,
    SKILL_ROOT / "geometry-input",
    SKILL_ROOT / "code-check",
    SKILL_ROOT / "material-constitutive",
):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)

from api import (  # noqa: E402
    AnalysisRequest,
    CodeCheckRequest,
    ConvertRequest,
    ValidateRequest,
    analyze,
    check_analysis_engine,
    code_check,
    converter_schema,
    convert_structure_model,
    get_analysis_engine,
    list_analysis_engines,
    structure_model_schema,
    validate_structure_model,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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


def _handle_http_exception(error: HTTPException) -> None:
    detail = error.detail
    if isinstance(detail, dict):
        error_code = detail.get("errorCode") or detail.get("code") or f"HTTP_{error.status_code}"
        message = detail.get("message") or str(detail)
    else:
        error_code = f"HTTP_{error.status_code}"
        message = str(detail)
    _error(str(error_code), message, status_code=error.status_code, detail=detail)


def _handle_validation_error(error: ValidationError) -> None:
    _error(
        "VALIDATION_ERROR",
        "Validation failed",
        status_code=422,
        detail=error.errors(),
    )


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
        if action == "list_engines":
            _ok(asyncio.run(list_analysis_engines()))
            return 0
        if action == "get_engine":
            _ok(asyncio.run(get_analysis_engine(str(payload["engineId"]))))
            return 0
        if action == "check_engine":
            _ok(asyncio.run(check_analysis_engine(str(payload["engineId"]))))
            return 0
        if action == "validate":
            request = ValidateRequest.model_validate(payload["input"])
            _ok(asyncio.run(validate_structure_model(request)))
            return 0
        if action == "structure_model_schema":
            _ok(asyncio.run(structure_model_schema()))
            return 0
        if action == "converter_schema":
            _ok(asyncio.run(converter_schema()))
            return 0
        if action == "convert":
            request = ConvertRequest.model_validate(payload["input"])
            _ok(asyncio.run(convert_structure_model(request)))
            return 0
        if action == "analyze":
            request = AnalysisRequest.model_validate(payload["input"])
            _ok(asyncio.run(analyze(request)).model_dump(mode="json"))
            return 0
        if action == "code_check":
            request = CodeCheckRequest.model_validate(payload["input"])
            _ok(asyncio.run(code_check(request)))
            return 0
        _error("UNKNOWN_ACTION", f"Unknown worker action: {action}", status_code=400)
        return 1
    except HTTPException as error:
        _handle_http_exception(error)
        return 1
    except ValidationError as error:
        _handle_validation_error(error)
        return 1
    except Exception as error:  # noqa: BLE001
        logger.exception("Python analysis worker failed")
        _error("WORKER_EXECUTION_FAILED", str(error), detail={"type": type(error).__name__})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
