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

from fastapi import HTTPException

from converters.registry import get_converter, supported_formats
from structure_protocol.runtime import convert_structure_model_payload

sample_file = Path('backend/src/skill-shared/python/structure_protocol/examples/model_01_single_beam.json')
source = json.loads(sample_file.read_text(encoding='utf-8'))

async def run() -> None:
    migrated = convert_structure_model_payload(
        model_payload=source,
        target_schema_version='1.0.1',
        source_format='structuremodel-v1',
        target_format='structuremodel-v1',
        supported_formats=supported_formats(),
        get_converter=get_converter,
    )
    model = migrated['model']
    assert model['schema_version'] == '1.0.1'
    assert 'schema_migration' in model.get('metadata', {})
    assert model['metadata']['schema_migration']['from'] == '1.0.0'
    assert model['metadata']['schema_migration']['to'] == '1.0.1'
    print('[ok] schema migration 1.0.0 -> 1.0.1')

    try:
        convert_structure_model_payload(
            model_payload=source,
            target_schema_version='2.0.0',
            source_format='structuremodel-v1',
            target_format='structuremodel-v1',
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )
        raise AssertionError('unsupported schema should fail')
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert detail.get('errorCode') == 'UNSUPPORTED_TARGET_SCHEMA'
    print('[ok] unsupported target schema rejected')

asyncio.run(run())
PY
