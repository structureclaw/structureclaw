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
from api import AnalysisRequest, analyze
from schemas.structure_model_v1 import StructureModelV1, Node, Element, Material, Section

model = StructureModelV1(
    schema_version='1.0.0',
    nodes=[
        Node(id='1', x=0, y=0, z=0, restraints=[True, True, True, True, True, True]),
        Node(id='2', x=0, y=0, z=3),
    ],
    elements=[Element(id='1', type='beam', nodes=['1', '2'], material='1', section='1')],
    materials=[Material(id='1', name='steel', E=200000, nu=0.3, rho=7850, fy=345)],
    sections=[
        Section(
            id='1',
            name='W',
            type='beam',
            properties={'A': 0.01, 'E': 200000, 'Iz': 0.0001, 'Iy': 0.0001, 'G': 79000, 'J': 0.0001},
        )
    ],
)

ok_request = AnalysisRequest(type='static', model=model, parameters={})
ok_result = asyncio.run(analyze(ok_request)).model_dump()
required = {'schema_version', 'analysis_type', 'success', 'error_code', 'message', 'data', 'meta'}
missing = required - set(ok_result.keys())
if missing:
    raise SystemExit(f'Missing analyze envelope fields: {sorted(missing)}')
if ok_result['success'] is not True:
    raise SystemExit('Expected success=true for static request')
if ok_result['analysis_type'] != 'static':
    raise SystemExit(f"Expected analysis_type=static, got {ok_result['analysis_type']}")
if ok_result['schema_version'] != '1.0.0':
    raise SystemExit(f"Expected schema_version=1.0.0, got {ok_result['schema_version']}")
required_meta = {'engineId', 'engineName', 'engineVersion', 'engineKind', 'selectionMode', 'timestamp'}
missing_meta = required_meta - set(ok_result['meta'].keys())
if missing_meta:
    raise SystemExit(f'meta fields required: {sorted(missing_meta)}')
print('[ok] analyze success envelope contract')

truss_3d_model = StructureModelV1(
    schema_version='1.0.0',
    nodes=[
        Node(id='1', x=0, y=1, z=0, restraints=[True, True, True, False, False, False]),
        Node(id='2', x=2, y=1, z=0, restraints=[False, True, True, False, False, False]),
    ],
    elements=[Element(id='1', type='truss', nodes=['1', '2'], material='1', section='1')],
    materials=[Material(id='1', name='steel', E=200000, nu=0.3, rho=7850)],
    sections=[Section(id='1', name='A1', type='rod', properties={'A': 0.01})],
    load_cases=[{'id': 'LC1', 'type': 'other', 'loads': [{'node': '2', 'fx': 10.0}]}],
    load_combinations=[],
)

truss_3d_request = AnalysisRequest(type='static', model=truss_3d_model, parameters={'loadCaseIds': ['LC1']})
truss_3d_result = asyncio.run(analyze(truss_3d_request)).model_dump()
if truss_3d_result['success'] is not True:
    raise SystemExit('Expected success=true for 3D truss request')
data = truss_3d_result.get('data', {})
if data.get('analysisMode') != 'linear_3d_truss':
    raise SystemExit(f"Expected analysisMode=linear_3d_truss, got {data.get('analysisMode')}")
required_data_fields = {'displacements', 'forces', 'reactions', 'envelope', 'summary'}
missing_data = required_data_fields - set(data.keys())
if missing_data:
    raise SystemExit(f'Missing analyze data fields for 3D truss: {sorted(missing_data)}')
required_envelope_fields = {
    'maxAbsDisplacement',
    'maxAbsAxialForce',
    'maxAbsShearForce',
    'maxAbsMoment',
    'maxAbsReaction',
}
missing_envelope = required_envelope_fields - set((data.get('envelope') or {}).keys())
if missing_envelope:
    raise SystemExit(f'Missing envelope fields for 3D truss: {sorted(missing_envelope)}')
print('[ok] analyze 3d truss envelope contract')

frame_3d_model = StructureModelV1(
    schema_version='1.0.0',
    nodes=[
        Node(id='1', x=0, y=0, z=0, restraints=[True, True, True, True, True, True]),
        Node(id='2', x=0, y=3, z=2, restraints=[True, False, False, True, False, False]),
    ],
    elements=[Element(id='1', type='beam', nodes=['1', '2'], material='1', section='1')],
    materials=[Material(id='1', name='steel', E=200000, nu=0.3, rho=7850)],
    sections=[Section(id='1', name='B1', type='beam', properties={'A': 0.01, 'Iy': 0.0001, 'Iz': 0.0001, 'J': 0.00002, 'G': 79000})],
    load_cases=[{'id': 'LC1', 'type': 'other', 'loads': [{'node': '2', 'fy': 6.0, 'fz': 4.0}]}],
    load_combinations=[],
)

frame_3d_request = AnalysisRequest(
    type='static',
    model=frame_3d_model,
    parameters={'loadCaseIds': ['LC1']},
    engineId='builtin-simplified',
)
frame_3d_result = asyncio.run(analyze(frame_3d_request)).model_dump()
if frame_3d_result['success'] is not True:
    raise SystemExit('Expected success=true for 3D frame request')
if frame_3d_result.get('data', {}).get('analysisMode') != 'linear_3d_frame':
    raise SystemExit(f"Expected analysisMode=linear_3d_frame, got {frame_3d_result.get('data', {}).get('analysisMode')}")
print('[ok] analyze 3d frame envelope contract')

simplified_planar_beam_model = StructureModelV1(
    schema_version='1.0.0',
    nodes=[
        Node(id='1', x=0, y=0, z=0, restraints=[True, True, True, True, True, True]),
        Node(id='2', x=5, y=0, z=0),
        Node(id='3', x=10, y=0, z=0),
    ],
    elements=[
        Element(id='1', type='beam', nodes=['1', '2'], material='1', section='1'),
        Element(id='2', type='beam', nodes=['2', '3'], material='1', section='1'),
    ],
    materials=[Material(id='1', name='steel', E=200000, nu=0.3, rho=7850)],
    sections=[Section(id='1', name='B1', type='beam', properties={'A': 0.01, 'Iy': 0.0001, 'Iz': 0.0002, 'J': 0.00002, 'G': 79000})],
    load_cases=[{'id': 'LC1', 'type': 'other', 'loads': [{'node': '3', 'fy': -10.0}]}],
    load_combinations=[],
)

simplified_planar_request = AnalysisRequest(
    type='static',
    model=simplified_planar_beam_model,
    parameters={'loadCaseIds': ['LC1']},
    engineId='builtin-simplified',
)
simplified_planar_result = asyncio.run(analyze(simplified_planar_request)).model_dump()
if simplified_planar_result['success'] is not True:
    raise SystemExit('Expected success=true for simplified planar beam request')
simplified_data = simplified_planar_result.get('data', {})
if simplified_data.get('analysisMode') != 'linear_2d_frame':
    raise SystemExit(f"Expected simplified planar beam analysisMode=linear_2d_frame, got {simplified_data.get('analysisMode')}")
if simplified_data.get('plane') != 'xy':
    raise SystemExit(f"Expected simplified planar beam plane=xy, got {simplified_data.get('plane')}")
tip_disp = simplified_data.get('displacements', {}).get('3', {})
if abs(float(tip_disp.get('uy', 0.0))) <= 0.0:
    raise SystemExit(f"Expected non-zero simplified planar beam uy displacement, got {tip_disp}")
if abs(float(tip_disp.get('uz', 0.0))) > 1e-9:
    raise SystemExit(f"Expected near-zero simplified planar beam uz displacement, got {tip_disp}")
print('[ok] analyze simplified planar beam routes to 2d xy frame')

bad_request = AnalysisRequest(type='unknown', model=model, parameters={})
try:
    asyncio.run(analyze(bad_request))
    raise SystemExit('Expected HTTPException for invalid analysis type')
except HTTPException as exc:
    if exc.status_code != 400:
        raise SystemExit(f'Expected HTTP 400, got {exc.status_code}')
    detail = exc.detail if isinstance(exc.detail, dict) else {}
    if detail.get('errorCode') != 'INVALID_ANALYSIS_TYPE':
        raise SystemExit(f"Expected INVALID_ANALYSIS_TYPE, got {detail.get('errorCode')}")
    print('[ok] analyze invalid type error contract')
PY
