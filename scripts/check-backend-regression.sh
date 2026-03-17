#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Backend regression checks"

echo
echo "==> Backend build"
npm run build --prefix backend

echo
echo "==> Backend lint"
npm run lint --prefix backend

echo
echo "==> Backend test"
npm test --prefix backend -- --runInBand

echo
echo "==> Agent orchestration regression"
./scripts/validate-agent-orchestration.sh

echo
echo "==> Agent no-skill fallback contract"
./scripts/validate-agent-no-skill-fallback.sh

echo
echo "==> Agent tools protocol contract"
./scripts/validate-agent-tools-contract.sh

echo
echo "==> Agent API contract regression"
./scripts/validate-agent-api-contract.sh

echo
echo "==> Agent capability matrix contract"
./scripts/validate-agent-capability-matrix.sh

echo
echo "==> Chat stream contract regression"
./scripts/validate-chat-stream-contract.sh

echo
echo "==> Chat message routing contract"
./scripts/validate-chat-message-routing.sh

echo
echo "==> Report template contract"
./scripts/validate-report-template-contract.sh

echo
echo "==> Prisma schema validate"
if [[ -z "${DATABASE_URL:-}" ]]; then
  export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/structureclaw"
  echo "[info] DATABASE_URL is not set; using fallback for prisma validate."
fi
npm run db:validate --prefix backend

echo
echo "Backend regression checks passed."
