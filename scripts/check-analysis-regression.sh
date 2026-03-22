#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Analysis regression checks"

echo
echo "==> OpenSees runtime and routing"
./scripts/validate-opensees-runtime-and-routing.sh

echo
echo "==> Analyze response contract"
./scripts/validate-analyze-contract.sh

echo
echo "==> Code-check traceability"
./scripts/validate-code-check-traceability.sh

echo
echo "==> Static regression cases"
./scripts/validate-static-regression.sh

echo
echo "==> Static 3D regression cases"
./scripts/validate-static-3d-regression.sh

echo
echo "==> StructureModel v1 examples"
./scripts/validate-structure-examples.sh

echo
echo "==> Convert round-trip"
./scripts/validate-convert-roundtrip.sh

echo
echo "==> Midas-text converter"
./scripts/validate-midas-text-converter.sh

echo
echo "==> Converter API contract"
./scripts/validate-converter-api-contract.sh

echo
echo "==> Schema migration"
./scripts/validate-schema-migration.sh

echo
echo "==> Batch convert report"
./scripts/validate-convert-batch.sh

echo
echo "==> Convert round-trip pass rate"
./scripts/validate-convert-passrate.sh

echo
echo "Analysis regression checks passed."
