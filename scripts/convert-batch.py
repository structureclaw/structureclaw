#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import HTTPException


ROOT_DIR = Path(__file__).resolve().parent.parent
PYTHON_ROOT = ROOT_DIR / "backend" / "src" / "agent-skills" / "analysis-execution" / "python"
sys.path.insert(0, str(PYTHON_ROOT))
sys.path.insert(0, str(ROOT_DIR / "backend" / "src" / "agent-skills" / "geometry-input"))
sys.path.insert(0, str(ROOT_DIR / "backend" / "src" / "agent-skills" / "code-check"))
sys.path.insert(0, str(ROOT_DIR / "backend" / "src" / "agent-skills" / "material-constitutive"))

from api import ConvertRequest, convert_structure_model  # noqa: E402


@dataclass
class BatchResult:
    file: str
    status: str
    output_file: str | None = None
    error_code: str | None = None
    message: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Batch convert structure model files with report output.")
    parser.add_argument("--input-dir", required=True, help="Directory containing source JSON files.")
    parser.add_argument("--output-dir", required=True, help="Directory to write converted JSON files.")
    parser.add_argument("--report", required=True, help="Path to write batch report JSON.")
    parser.add_argument("--source-format", default="structuremodel-v1")
    parser.add_argument("--target-format", required=True)
    parser.add_argument("--target-schema-version", default="1.0.0")
    parser.add_argument("--allow-failures", action="store_true", help="Do not fail process when conversion errors exist.")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def convert_one_file(
    source_file: Path,
    output_dir: Path,
    source_format: str,
    target_format: str,
    target_schema_version: str,
) -> BatchResult:
    try:
        payload = json.loads(source_file.read_text(encoding="utf-8"))
    except Exception as exc:
        return BatchResult(
            file=source_file.name,
            status="failed",
            error_code="INVALID_JSON",
            message=str(exc),
        )

    request = ConvertRequest(
        model=payload,
        source_format=source_format,
        target_format=target_format,
        target_schema_version=target_schema_version,
    )

    try:
        result = await convert_structure_model(request)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
        return BatchResult(
            file=source_file.name,
            status="failed",
            error_code=detail.get("errorCode", f"HTTP_{exc.status_code}"),
            message=detail.get("message", "conversion failed"),
        )
    except Exception as exc:
        return BatchResult(
            file=source_file.name,
            status="failed",
            error_code="CONVERT_EXECUTION_FAILED",
            message=str(exc),
        )

    output_file = output_dir / source_file.name
    output_file.write_text(json.dumps(result["model"], ensure_ascii=False, indent=2), encoding="utf-8")
    return BatchResult(
        file=source_file.name,
        status="ok",
        output_file=str(output_file),
    )


async def run() -> int:
    args = parse_args()
    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    report_path = Path(args.report).resolve()

    if not input_dir.exists():
        print(f"Input directory does not exist: {input_dir}", file=sys.stderr)
        return 2

    output_dir.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    source_files = sorted(input_dir.glob("*.json"))
    started_at = utc_now()
    results: List[BatchResult] = []
    for source_file in source_files:
        results.append(
            await convert_one_file(
                source_file=source_file,
                output_dir=output_dir,
                source_format=args.source_format,
                target_format=args.target_format,
                target_schema_version=args.target_schema_version,
            )
        )

    success_count = sum(1 for item in results if item.status == "ok")
    failed_count = len(results) - success_count
    failure_by_error_code: Dict[str, int] = {}
    for item in results:
        if item.status != "failed":
            continue
        code = item.error_code or "UNKNOWN"
        failure_by_error_code[code] = failure_by_error_code.get(code, 0) + 1

    report: Dict[str, Any] = {
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "sourceFormat": args.source_format,
        "targetFormat": args.target_format,
        "targetSchemaVersion": args.target_schema_version,
        "inputDir": str(input_dir),
        "outputDir": str(output_dir),
        "summary": {
            "total": len(results),
            "success": success_count,
            "failed": failed_count,
            "failureByErrorCode": failure_by_error_code,
        },
        "items": [
            {
                "file": item.file,
                "status": item.status,
                "outputFile": item.output_file,
                "errorCode": item.error_code,
                "message": item.message,
            }
            for item in results
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[batch] total={len(results)} success={success_count} failed={failed_count}")
    print(f"[batch] report={report_path}")
    if failed_count > 0 and not args.allow_failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
