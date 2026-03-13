#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -x core/.venv/bin/python ]]; then
  echo "core/.venv/bin/python is required for OpenSees validation" >&2
  exit 1
fi

PYTHONPATH=core core/.venv/bin/python - <<'PY'
import asyncio
import math
import sys
import types

sys.path.insert(0, 'core')

from engines.opensees_runtime import get_opensees_runtime_issue
from engines.registry import AnalysisEngineRegistry
from main import AnalysisRequest, analyze
from schemas.structure_model_v1 import StructureModelV1


def assert_true(condition, message):
    if not condition:
        raise SystemExit(message)


def run_request(payload, engine_id='builtin-opensees'):
    request = AnalysisRequest.model_validate(
        {
            'type': 'static',
            'model': payload,
            'parameters': {'loadCaseIds': ['LC1']},
            'engineId': engine_id,
        }
    )
    return asyncio.run(analyze(request)).model_dump(mode='json')


issue = get_opensees_runtime_issue()
assert_true(issue is None, f'OpenSees runtime unavailable: {issue}')
print('[ok] OpenSees runtime smoke test')

cantilever = {
    'schema_version': '1.0.0',
    'nodes': [
        {'id': '1', 'x': 0.0, 'y': 0.0, 'z': 0.0, 'restraints': [True, False, True, False, True, False]},
        {'id': '2', 'x': 5.0, 'y': 0.0, 'z': 0.0},
        {'id': '3', 'x': 10.0, 'y': 0.0, 'z': 0.0},
    ],
    'elements': [
        {'id': '1', 'type': 'beam', 'nodes': ['1', '2'], 'material': '1', 'section': '1'},
        {'id': '2', 'type': 'beam', 'nodes': ['2', '3'], 'material': '1', 'section': '1'},
    ],
    'materials': [{'id': '1', 'name': 'steel', 'E': 205000.0, 'nu': 0.3, 'rho': 7850}],
    'sections': [{'id': '1', 'name': 'B1', 'type': 'beam', 'properties': {'A': 0.01, 'Iy': 0.0001, 'Iz': 0.0001, 'J': 0.0001, 'G': 79000}}],
    'load_cases': [{'id': 'LC1', 'type': 'other', 'loads': [{'node': '3', 'fy': -10.0}]}],
    'load_combinations': [],
}

cantilever_result = run_request(cantilever)
assert_true(cantilever_result['success'] is True, f"Cantilever OpenSees analysis failed: {cantilever_result['message']}")
assert_true(cantilever_result['data']['analysisMode'] == 'opensees_2d_frame', f"Unexpected cantilever analysisMode: {cantilever_result['data']['analysisMode']}")
tip_uz = float(cantilever_result['data']['displacements']['3']['uz'])
assert_true(math.isfinite(tip_uz) and tip_uz < 0.0, f'Cantilever tip displacement invalid: {tip_uz}')
assert_true('1' in cantilever_result['data']['reactions'], 'Cantilever reactions missing at fixed support')
print('[ok] cantilever beam solves with builtin-opensees')

simply_supported = {
    'schema_version': '1.0.0',
    'nodes': [
        {'id': '1', 'x': 0.0, 'y': 0.0, 'z': 0.0, 'restraints': [True, False, True, False, False, False]},
        {'id': '2', 'x': 3.0, 'y': 0.0, 'z': 0.0},
        {'id': '3', 'x': 6.0, 'y': 0.0, 'z': 0.0, 'restraints': [False, False, True, False, False, False]},
    ],
    'elements': [
        {'id': '1', 'type': 'beam', 'nodes': ['1', '2'], 'material': '1', 'section': '1'},
        {'id': '2', 'type': 'beam', 'nodes': ['2', '3'], 'material': '1', 'section': '1'},
    ],
    'materials': [{'id': '1', 'name': 'steel', 'E': 205000.0, 'nu': 0.3, 'rho': 7850}],
    'sections': [{'id': '1', 'name': 'B1', 'type': 'beam', 'properties': {'A': 0.01, 'Iy': 0.0001, 'Iz': 0.0001, 'J': 0.0001, 'G': 79000}}],
    'load_cases': [{'id': 'LC1', 'type': 'other', 'loads': [{'node': '2', 'fy': -20.0}]}],
    'load_combinations': [],
}

simply_supported_result = run_request(simply_supported)
assert_true(simply_supported_result['success'] is True, f"Simply-supported OpenSees analysis failed: {simply_supported_result['message']}")
assert_true(simply_supported_result['data']['analysisMode'] == 'opensees_2d_frame', f"Unexpected simply-supported analysisMode: {simply_supported_result['data']['analysisMode']}")
midspan_uz = float(simply_supported_result['data']['displacements']['2']['uz'])
assert_true(math.isfinite(midspan_uz) and midspan_uz < 0.0, f'Simply-supported midspan displacement invalid: {midspan_uz}')
print('[ok] simply-supported beam solves with builtin-opensees')

portal_frame = {
    'schema_version': '1.0.0',
    'nodes': [
        {'id': '1', 'x': 0.0, 'y': 0.0, 'z': 0.0, 'restraints': [True, True, True, True, True, True]},
        {'id': '2', 'x': 8.0, 'y': 0.0, 'z': 0.0, 'restraints': [True, True, True, True, True, True]},
        {'id': '3', 'x': 0.0, 'y': 4.0, 'z': 0.0},
        {'id': '4', 'x': 8.0, 'y': 4.0, 'z': 0.0},
    ],
    'elements': [
        {'id': '1', 'type': 'beam', 'nodes': ['1', '3'], 'material': '1', 'section': '1'},
        {'id': '2', 'type': 'beam', 'nodes': ['3', '4'], 'material': '1', 'section': '1'},
        {'id': '3', 'type': 'beam', 'nodes': ['4', '2'], 'material': '1', 'section': '1'},
    ],
    'materials': [{'id': '1', 'name': 'steel', 'E': 205000.0, 'nu': 0.3, 'rho': 7850}],
    'sections': [{'id': '1', 'name': 'PF1', 'type': 'beam', 'properties': {'A': 0.02, 'Iy': 0.0002, 'Iz': 0.0002, 'J': 0.0002, 'G': 79000}}],
    'load_cases': [{'id': 'LC1', 'type': 'other', 'loads': [{'node': '3', 'fy': -5.0}, {'node': '4', 'fy': -5.0}]}],
    'load_combinations': [],
}

portal_result = run_request(portal_frame)
assert_true(portal_result['success'] is True, f"Portal-frame OpenSees analysis failed: {portal_result['message']}")
assert_true(portal_result['data']['analysisMode'] == 'opensees_2d_frame', f"Unexpected portal-frame analysisMode: {portal_result['data']['analysisMode']}")
roof_uy = float(portal_result['data']['displacements']['3']['uy'])
assert_true(math.isfinite(roof_uy) and roof_uy < 0.0, f'Portal-frame roof displacement invalid: {roof_uy}')
print('[ok] portal frame solves with builtin-opensees')

registry = AnalysisEngineRegistry('StructureClaw Analysis Engine', '0.1.0')
model = StructureModelV1.model_validate(simply_supported)


def fake_execute(self, selection, analysis_type, model, parameters, engine_id):
    if selection.engine['id'] == 'builtin-opensees':
        raise RuntimeError('simulated runtime failure')
    return {
        'status': 'success',
        'analysisMode': 'linear_2d_frame',
        'displacements': {},
        'forces': {},
        'reactions': {},
        'envelope': {},
        'summary': {},
    }


registry._execute_analysis_selection = types.MethodType(fake_execute, registry)

auto_result = registry.run_analysis('static', model, {'loadCaseIds': ['LC1']}, None)
assert_true(auto_result['meta']['engineId'] == 'builtin-simplified', f"Expected fallback engine, got {auto_result['meta']['engineId']}")
assert_true(auto_result['meta']['selectionMode'] == 'fallback', f"Expected fallback selectionMode, got {auto_result['meta']['selectionMode']}")
assert_true(auto_result['meta']['fallbackFrom'] == 'builtin-opensees', f"Expected fallbackFrom builtin-opensees, got {auto_result['meta']['fallbackFrom']}")
print('[ok] auto engine falls back on runtime failure')

try:
    registry.run_analysis('static', model, {'loadCaseIds': ['LC1']}, 'builtin-opensees')
except RuntimeError as error:
    assert_true('simulated runtime failure' in str(error), f'Unexpected manual failure reason: {error}')
    print('[ok] manual engine selection does not fall back')
else:
    raise SystemExit('Manual builtin-opensees selection should not fall back')
PY
