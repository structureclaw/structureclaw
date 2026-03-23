#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/analysis-python-env.sh"
require_analysis_python

"$PYTHON_BIN" - <<'PY'
import asyncio

from fastapi import HTTPException
from converters.registry import get_converter, supported_formats
from structure_protocol.runtime import convert_structure_model_payload

TEXT = """
# minimal midas text
NODE,1,0,0,0
NODE,2,2,0,0
REST,1,1,1,1,1,1,1
REST,2,0,1,1,1,1,1
MAT,1,steel,200000,0.3,7850
SEC,1,S1,beam,0.01,0.0001,0.0001,0.00002,79000
ELEM,1,beam,1,2,1,1
LOADCASE,LC1,other
NLOAD,LC1,2,10,0,0,0,0,0
COMBO,ULS,LC1=1.0
""".strip()

async def run() -> None:
    exported = convert_structure_model_payload(
        model_payload={'text': TEXT},
        target_schema_version='1.0.0',
        source_format='midas-text-1',
        target_format='structuremodel-v1',
        supported_formats=supported_formats(),
        get_converter=get_converter,
    )
    model = exported['model']
    assert model['schema_version'] == '1.0.0'
    assert len(model['nodes']) == 2
    assert len(model['elements']) == 1

    reexport = convert_structure_model_payload(
        model_payload=model,
        target_schema_version='1.0.0',
        source_format='structuremodel-v1',
        target_format='midas-text-1',
        supported_formats=supported_formats(),
        get_converter=get_converter,
    )
    text2 = reexport['model'].get('text', '')
    assert 'NODE,1,0.0,0.0,0.0' in text2
    assert 'ELEM,1,beam,1,2,1,1' in text2
    print('[ok] midas-text convert import/export')

    try:
        convert_structure_model_payload(
            model_payload={'text': 'NODE,1,a,0,0'},
            target_schema_version='1.0.0',
            source_format='midas-text-1',
            target_format='structuremodel-v1',
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )
        raise SystemExit('Expected HTTPException for invalid number')
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        assert exc.status_code == 422
        assert detail.get('errorCode') == 'INVALID_STRUCTURE_MODEL'
        assert 'line 1' in (detail.get('message') or '')
        assert 'NODE.x' in (detail.get('message') or '')
        print('[ok] midas-text field-level error message')

asyncio.run(run())
PY
