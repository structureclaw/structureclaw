#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/analysis-python-env.sh"
require_analysis_python

"$PYTHON_BIN" - <<'PY'
import asyncio
import sys

from api import CodeCheckRequest, code_check

async def run() -> None:
    result = await code_check(CodeCheckRequest(
        model_id='trace-demo',
        code='GB50017',
        elements=['E1'],
        context={
            'analysisSummary': {'analysisType': 'static', 'success': True},
            'utilizationByElement': {'E1': {'正应力': 0.73}},
        },
    ))

    assert result['traceability']['modelId'] == 'trace-demo'
    assert result['traceability']['analysisSummary']['analysisType'] == 'static'
    detail = result['details'][0]
    item = detail['checks'][0]['items'][0]
    assert item['clause']
    assert item['formula']
    assert item['inputs']['demand'] >= 0
    assert item['utilization'] >= 0
    print('[ok] code-check traceability contract')

asyncio.run(run())
PY
