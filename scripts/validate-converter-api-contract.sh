#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/analysis-python-env.sh"
require_analysis_python

"$PYTHON_BIN" - <<'PY'
import asyncio
import sys

from fastapi import HTTPException

from api import ConvertRequest, converter_schema, convert_structure_model

EXPECTED_FORMATS = {'structuremodel-v1', 'simple-1', 'compact-1', 'midas-text-1'}

async def run() -> None:
    schema = await converter_schema()
    supported = set(schema.get('supportedFormats', []))
    missing = EXPECTED_FORMATS - supported
    if missing:
        raise AssertionError(f'/schema/converters missing formats: {sorted(missing)}')
    assert schema.get('defaultSourceFormat') == 'structuremodel-v1'
    assert schema.get('defaultTargetFormat') == 'structuremodel-v1'
    print('[ok] converter schema contract')

    try:
        await convert_structure_model(ConvertRequest(
            model={},
            source_format='unsupported-format',
            target_format='structuremodel-v1',
        ))
        raise AssertionError('unsupported source format should fail')
    except HTTPException as exc:
        assert exc.status_code == 400
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert detail.get('errorCode') == 'UNSUPPORTED_SOURCE_FORMAT'
        assert 'supportedFormats' in detail
    print('[ok] convert unsupported source format contract')

    try:
        await convert_structure_model(ConvertRequest(
            model={},
            source_format='structuremodel-v1',
            target_format='unsupported-format',
        ))
        raise AssertionError('unsupported target format should fail')
    except HTTPException as exc:
        assert exc.status_code == 400
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert detail.get('errorCode') == 'UNSUPPORTED_TARGET_FORMAT'
        assert 'supportedFormats' in detail
    print('[ok] convert unsupported target format contract')

    invalid_midas = {
        'text': '\n'.join([
            'NODE,1,0,0,0',
            'NODE,2,1,0,0',
            'MAT,1,STEEL,200000,0.3,7850,345',
            'SEC,1,S1,beam,INVALID_A',
            'ELM,1,beam,1,2,1,1',
        ])
    }
    try:
        await convert_structure_model(ConvertRequest(
            model=invalid_midas,
            source_format='midas-text-1',
            target_format='structuremodel-v1',
        ))
        raise AssertionError('invalid midas field should fail')
    except HTTPException as exc:
        assert exc.status_code == 422
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert detail.get('errorCode') == 'INVALID_STRUCTURE_MODEL'
        message = detail.get('message', '')
        assert isinstance(message, str) and 'line' in message and 'A' in message
    print('[ok] convert field-level parse error contract')

asyncio.run(run())
PY
