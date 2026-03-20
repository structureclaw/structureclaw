#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ensure_sqlite_regression_database_url() {
  local fallback_database_url="file:$ROOT_DIR/.runtime/data/structureclaw-regression.db"
  mkdir -p "$ROOT_DIR/.runtime/data"

  if [[ -z "${DATABASE_URL:-}" ]]; then
    export DATABASE_URL="$fallback_database_url"
    echo "[info] DATABASE_URL is not set; using SQLite regression fallback."
    return
  fi

  if [[ "${DATABASE_URL}" != file:* ]]; then
    echo "[info] DATABASE_URL='${DATABASE_URL}' is not a SQLite file URL; using SQLite regression fallback."
    export DATABASE_URL="$fallback_database_url"
  fi
}

ensure_sqlite_regression_database_url

echo "Backend regression checks"

echo
echo "==> Backend regression database sync"
npm run db:deploy --prefix backend >/dev/null
echo "[ok] Backend regression database sync"

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
echo "==> Agent SkillHub contract"
./scripts/validate-agent-skillhub-contract.sh

echo
echo "==> Agent SkillHub CLI integration contract"
./scripts/validate-agent-skillhub-cli.sh

echo
echo "==> Agent SkillHub repository-down fallback contract"
./scripts/validate-agent-skillhub-repository-down.sh

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
npm run db:validate --prefix backend

echo
echo "Backend regression checks passed."
