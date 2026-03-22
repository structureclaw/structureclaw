#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/analysis-python-env.sh"
require_analysis_python

"$PYTHON_BIN" - <<'PY'
import json
from pathlib import Path
import sys

from schemas.structure_model_v1 import StructureModelV1

base = Path('backend/src/agent-skills/analysis-execution/python/examples')
files = sorted(base.glob('*.json'))
if not files:
    raise SystemExit('No example files found under backend/src/agent-skills/analysis-execution/python/examples')

minimum_expected = 20
if len(files) < minimum_expected:
    raise SystemExit(
        f'Need at least {minimum_expected} examples for roadmap baseline, found {len(files)}'
    )

ok = 0
for fp in files:
    payload = json.loads(fp.read_text(encoding='utf-8'))
    StructureModelV1.model_validate(payload)
    ok += 1
    print(f'[ok] {fp.name}')

print(f'Validated {ok} StructureModel v1 examples.')
PY
