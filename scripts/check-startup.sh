#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

EXIT_CODE=0

ensure_uv() {
  "$ROOT_DIR/scripts/ensure-uv.sh"
  export PATH="${UV_INSTALL_DIR:-$HOME/.local/bin}:$PATH"
}

run_check() {
  local name="$1"
  local command="$2"

  echo
  echo "==> $name"
  if bash -lc "$command"; then
    echo "[ok] $name"
  else
    echo "[fail] $name"
    EXIT_CODE=1
  fi
}

run_optional_check() {
  local name="$1"
  local command="$2"

  echo
  echo "==> $name"
  if bash -lc "$command"; then
    echo "[ok] $name"
  else
    echo "[warn] $name"
  fi
}

echo "StructureClaw startup checks"
echo "Workspace: $ROOT_DIR"

ensure_uv

run_check "Backend regression" "./scripts/check-backend-regression.sh"
run_check "Startup self-healing guards" "./scripts/validate-dev-startup-guards.sh"
run_check "Frontend type-check" "npm run type-check --prefix frontend"
run_check "Frontend lint" "npm run lint --prefix frontend"
run_check "Frontend style pipeline guard" "npm run test:run --prefix frontend -- tests/postcss-config.test.ts"
run_optional_check "Frontend build (optional)" "npm run build --prefix frontend"

if [[ ! -x core/.venv/bin/python ]]; then
  echo
  echo "==> Core environment bootstrap"
  if make setup-core-full; then
    echo "[ok] Core environment bootstrap"
  else
    echo "[fail] Core environment bootstrap"
    EXIT_CODE=1
  fi
fi

if [[ -x core/.venv/bin/python ]]; then
  CORE_PYTHON="core/.venv/bin/python"
elif [[ -x core/.venv-uv-lite/bin/python ]]; then
  CORE_PYTHON="core/.venv-uv-lite/bin/python"
else
  CORE_PYTHON=""
fi

if [[ -n "$CORE_PYTHON" ]]; then
  run_check "Core import" "$CORE_PYTHON -c \"import sys; sys.path.insert(0, 'core'); import main; print(main.app.title)\""
  if [[ "$CORE_PYTHON" == "core/.venv/bin/python" ]]; then
    run_check "OpenSees runtime smoke test" "PYTHONPATH=core $CORE_PYTHON -m engines.opensees_runtime --json"
  fi
  run_check "Core simplified analysis" "$CORE_PYTHON -c \"import sys; sys.path.insert(0, 'core'); from main import AnalysisRequest, analyze; from schemas.structure_model_v1 import StructureModelV1, Node, Element, Material, Section; import asyncio; req=AnalysisRequest(type='static', model=StructureModelV1(nodes=[Node(id='1',x=0,y=0,z=0,restraints=[True,True,True,True,True,True]),Node(id='2',x=0,y=0,z=3)], elements=[Element(id='1',type='beam',nodes=['1','2'],material='1',section='1')], materials=[Material(id='1',name='steel',E=200000,nu=0.3,rho=7850,fy=345)], sections=[Section(id='1',name='W',type='beam',properties={'A':0.01,'E':200000,'Iz':0.0001,'Iy':0.0001,'G':79000,'J':0.0001})]), parameters={}); result=asyncio.run(analyze(req)); print(result.success)\""
  run_check "Core analyze response contract" "./scripts/validate-analyze-contract.sh"
  run_check "Core code-check traceability" "./scripts/validate-code-check-traceability.sh"
  run_check "Core static regression" "./scripts/validate-static-regression.sh"
  run_check "Core static 3D regression" "./scripts/validate-static-3d-regression.sh"
  run_check "Core schema examples validation" "./scripts/validate-structure-examples.sh"
  run_check "Core convert round-trip" "./scripts/validate-convert-roundtrip.sh"
  run_check "Core midas-text converter" "./scripts/validate-midas-text-converter.sh"
  run_check "Core converter api contract" "./scripts/validate-converter-api-contract.sh"
  run_check "Core schema migration" "./scripts/validate-schema-migration.sh"
  run_check "Core batch convert report" "./scripts/validate-convert-batch.sh"
  run_check "Core convert pass rate" "./scripts/validate-convert-passrate.sh"
else
  echo
  echo "==> Core checks"
  echo "[skip] No Python environment found at core/.venv or core/.venv-uv-lite"
  EXIT_CODE=1
fi

echo
if [[ "$EXIT_CODE" -eq 0 ]]; then
  echo "All startup checks passed."
else
  echo "Startup checks finished with failures."
fi

exit "$EXIT_CODE"
