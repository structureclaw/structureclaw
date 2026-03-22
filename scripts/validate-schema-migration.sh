#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/analysis-python-env.sh"
require_analysis_python

"$PYTHON_BIN" - <<'PY'
import asyncio
import json
from pathlib import Path
import sys

from fastapi import HTTPException

from api import ConvertRequest, convert_structure_model

sample_file = Path('backend/src/agent-skills/analysis-execution/python/examples/model_01_single_beam.json')
source = json.loads(sample_file.read_text(encoding='utf-8'))

async def run() -> None:
    migrated = await convert_structure_model(ConvertRequest(
        model=source,
        source_format='structuremodel-v1',
        target_format='structuremodel-v1',
        target_schema_version='1.0.1',
    ))
    model = migrated['model']
    assert model['schema_version'] == '1.0.1'
    assert 'schema_migration' in model.get('metadata', {})
    assert model['metadata']['schema_migration']['from'] == '1.0.0'
    assert model['metadata']['schema_migration']['to'] == '1.0.1'
    print('[ok] schema migration 1.0.0 -> 1.0.1')

    try:
        await convert_structure_model(ConvertRequest(
            model=source,
            source_format='structuremodel-v1',
            target_format='structuremodel-v1',
            target_schema_version='2.0.0',
        ))
        raise AssertionError('unsupported schema should fail')
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert detail.get('errorCode') == 'UNSUPPORTED_TARGET_SCHEMA'
    print('[ok] unsupported target schema rejected')

asyncio.run(run())
PY
