#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${POSTGRES_SOURCE_DATABASE_URL:-}" ]]; then
  cat <<'EOF'
Missing POSTGRES_SOURCE_DATABASE_URL.

Example:
  POSTGRES_SOURCE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/structureclaw \
  DATABASE_URL=file:/absolute/path/to/structureclaw.db \
  ./scripts/migrate-postgres-to-sqlite.sh --force
EOF
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -z "${SQLITE_TARGET_DATABASE_URL:-}" ]]; then
  export DATABASE_URL="file:$ROOT_DIR/.runtime/data/structureclaw.db"
fi

exec node "$ROOT_DIR/backend/scripts/migrate-postgres-to-sqlite.mjs" "$@"
