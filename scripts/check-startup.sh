#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

EXIT_CODE=0

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

run_check "Legacy PostgreSQL auto-migration" "./scripts/auto-migrate-legacy-postgres.sh"
run_check "Backend regression" "./scripts/check-backend-regression.sh"
run_check "Frontend type-check" "npm run type-check --prefix frontend"
run_check "Frontend lint" "npm run lint --prefix frontend"
run_optional_check "Frontend build (optional)" "npm run build --prefix frontend"

if [[ ! -x backend/.venv/bin/python ]]; then
  echo
  echo "==> Analysis Python environment bootstrap"
  if make setup-analysis-python; then
    echo "[ok] Analysis Python environment bootstrap"
  else
    echo "[fail] Analysis Python environment bootstrap"
    EXIT_CODE=1
  fi
fi

source "$ROOT_DIR/scripts/analysis-python-env.sh"
if [[ -x backend/.venv/bin/python ]]; then
  require_analysis_python
  run_check "Analysis runtime import" "\"$PYTHON_BIN\" -c \"import api; print(api.app.title)\""
  run_check "OpenSees runtime smoke test" "\"$PYTHON_BIN\" -m providers.opensees.runtime --json"
  run_check "Analyze response contract" "./scripts/validate-analyze-contract.sh"
  run_check "Code-check traceability" "./scripts/validate-code-check-traceability.sh"
  run_check "Static regression" "./scripts/validate-static-regression.sh"
  run_check "Static 3D regression" "./scripts/validate-static-3d-regression.sh"
  run_check "Structure examples validation" "./scripts/validate-structure-examples.sh"
  run_check "Convert round-trip" "./scripts/validate-convert-roundtrip.sh"
  run_check "Midas-text converter" "./scripts/validate-midas-text-converter.sh"
  run_check "Converter api contract" "./scripts/validate-converter-api-contract.sh"
  run_check "Schema migration" "./scripts/validate-schema-migration.sh"
  run_check "Batch convert report" "./scripts/validate-convert-batch.sh"
  run_check "Convert pass rate" "./scripts/validate-convert-passrate.sh"
else
  echo
  echo "==> Analysis runtime checks"
  echo "[skip] No Python environment found at backend/.venv"
  EXIT_CODE=1
fi

echo
if [[ "$EXIT_CODE" -eq 0 ]]; then
  echo "All startup checks passed."
else
  echo "Startup checks finished with failures."
fi

exit "$EXIT_CODE"
