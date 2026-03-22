#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/analysis-python-env.sh"
require_analysis_python

"$PYTHON_BIN" - <<'PY'
import asyncio
import json
import math
from pathlib import Path
import sys

from api import AnalysisRequest, analyze


def get_by_path(obj, dotted):
    cur = obj
    for part in dotted.split('.'):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            raise KeyError(f"Path not found: {dotted}")
    return cur


base = Path('backend/src/agent-skills/analysis-execution/python/regression/static_3d')
cases = sorted(base.glob('case_*.json'))
if not cases:
    raise SystemExit('No 3D regression case files found')

for fp in cases:
    payload = json.loads(fp.read_text(encoding='utf-8'))
    req_payload = dict(payload['request'])
    # Keep the static regression baseline deterministic across environments.
    req_payload['engineId'] = 'builtin-simplified'
    req = AnalysisRequest.model_validate(req_payload)
    result = asyncio.run(analyze(req)).model_dump(mode='json')

    if result.get('success') is not True:
      raise SystemExit(f"{fp.name}: analyze failed: {result.get('message')}")

    tol = float(payload.get('abs_tolerance', 1e-6))
    for path, expected in payload.get('expected', {}).items():
        actual = get_by_path(result, path)
        if isinstance(expected, str):
            if actual != expected:
                raise SystemExit(f"{fp.name}: {path} expected '{expected}', got '{actual}'")
            continue
        actual_f = float(actual)
        expected_f = float(expected)
        if not math.isfinite(actual_f):
            raise SystemExit(f"{fp.name}: {path} is not finite: {actual}")
        if abs(actual_f - expected_f) > tol:
            raise SystemExit(
                f"{fp.name}: {path} mismatch, expected {expected_f}, got {actual_f}, tol {tol}"
            )

    print(f"[ok] {fp.name}")

print(f"Validated {len(cases)} static 3D regression cases.")
PY
