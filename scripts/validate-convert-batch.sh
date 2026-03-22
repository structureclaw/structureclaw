#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/analysis-python-env.sh"
require_analysis_python

TMP_DIR="$(mktemp -d /tmp/structureclaw-batch-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/input" "$TMP_DIR/output"
cp backend/src/agent-skills/analysis-execution/python/examples/model_03_simple_truss.json "$TMP_DIR/input/valid.json"
cat > "$TMP_DIR/input/invalid.json" <<'JSON'
{
  "schema_version": "1.0.0",
  "nodes": [{"id": "1", "x": 0, "y": 0, "z": 0}],
  "elements": [{"id": "1", "type": "beam", "nodes": ["1", "2"], "material": "1", "section": "1"}],
  "materials": [],
  "sections": [],
  "load_cases": [],
  "load_combinations": []
}
JSON

REPORT_FILE="$TMP_DIR/report.json"

"$PYTHON_BIN" scripts/convert-batch.py \
  --input-dir "$TMP_DIR/input" \
  --output-dir "$TMP_DIR/output" \
  --report "$REPORT_FILE" \
  --source-format structuremodel-v1 \
  --target-format compact-1 \
  --allow-failures

"$PYTHON_BIN" - <<'PY' "$REPORT_FILE" "$TMP_DIR/output/valid.json"
import json
import sys
from pathlib import Path

report_file = Path(sys.argv[1])
valid_output = Path(sys.argv[2])
report = json.loads(report_file.read_text(encoding='utf-8'))

assert report['summary']['total'] == 2
assert report['summary']['success'] == 1
assert report['summary']['failed'] == 1
assert valid_output.exists()

failed_items = [item for item in report['items'] if item['status'] == 'failed']
assert len(failed_items) == 1
assert failed_items[0]['errorCode'] in {'INVALID_STRUCTURE_MODEL', 'HTTP_422'}
failure_dist = report['summary'].get('failureByErrorCode') or {}
assert isinstance(failure_dist, dict)
assert failure_dist.get(failed_items[0]['errorCode']) == 1
print('[ok] convert batch report with mixed success/failure')
PY
