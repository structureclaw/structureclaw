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

from converters.registry import get_converter, supported_formats
from structure_protocol.runtime import convert_structure_model_payload

sample_file = Path('backend/src/skill-shared/python/structure_protocol/examples/model_03_simple_truss.json')
source = json.loads(sample_file.read_text(encoding='utf-8'))

async def run() -> None:
    original = source

    for external_format in ('simple-1', 'compact-1', 'midas-text-1'):
        exported = convert_structure_model_payload(
            model_payload=source,
            target_schema_version='1.0.0',
            source_format='structuremodel-v1',
            target_format=external_format,
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )

        imported = convert_structure_model_payload(
            model_payload=exported['model'],
            target_schema_version='1.0.0',
            source_format=external_format,
            target_format='structuremodel-v1',
            supported_formats=supported_formats(),
            get_converter=get_converter,
        )

        round_trip = imported['model']
        assert round_trip['schema_version'] == '1.0.0'
        assert len(original['nodes']) == len(round_trip['nodes'])
        assert len(original['elements']) == len(round_trip['elements'])
        assert {n['id'] for n in original['nodes']} == {n['id'] for n in round_trip['nodes']}
        assert {e['id'] for e in original['elements']} == {e['id'] for e in round_trip['elements']}

        print(f'[ok] convert round-trip structuremodel-v1 -> {external_format} -> structuremodel-v1')

asyncio.run(run())
PY
