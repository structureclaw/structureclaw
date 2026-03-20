#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_ENV_FILE="$ROOT_DIR/.env"
SQLITE_DATABASE_URL_REL="file:../../.runtime/data/structureclaw.db"
SQLITE_DATABASE_URL_ABS="file:$ROOT_DIR/.runtime/data/structureclaw.db"

read_env_value() {
  local key="$1"
  local file="$2"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  awk -v key="$key" '
    BEGIN { FS="=" }
    /^[[:space:]]*#/ { next }
    $1 == key {
      value = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^"/, "", value)
      gsub(/"$/, "", value)
      gsub(/^'\''/, "", value)
      gsub(/'\''$/, "", value)
      print value
      exit
    }
  ' "$file"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  local tmp_file

  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ ("^" key "=") {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$file" > "$tmp_file"
  mv "$tmp_file" "$file"
}

is_local_postgres_url() {
  local database_url="$1"

  node - "$database_url" <<'NODE'
const urlValue = process.argv[2] || '';

try {
  const parsed = new URL(urlValue);
  const host = (parsed.hostname || '').toLowerCase();
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
  process.exit(localHosts.has(host) ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

if [[ ! -f "$ROOT_ENV_FILE" ]]; then
  exit 0
fi

legacy_database_url="$(read_env_value "DATABASE_URL" "$ROOT_ENV_FILE")"

if [[ -z "$legacy_database_url" || "$legacy_database_url" == file:* ]]; then
  exit 0
fi

if [[ "$legacy_database_url" != postgres://* && "$legacy_database_url" != postgresql://* ]]; then
  exit 0
fi

if ! is_local_postgres_url "$legacy_database_url"; then
  echo "[fail] .env still points DATABASE_URL at a non-local PostgreSQL host."
  echo "[fail] Automatic migration is limited to local legacy sources. Migrate this database manually first."
  exit 1
fi

echo "[info] Detected legacy local PostgreSQL DATABASE_URL in .env."
echo "[info] Migrating data into SQLite at $SQLITE_DATABASE_URL_ABS ..."

mkdir -p "$ROOT_DIR/.runtime/data"
POSTGRES_SOURCE_DATABASE_URL="$legacy_database_url" DATABASE_URL="$SQLITE_DATABASE_URL_ABS" \
  "$ROOT_DIR/scripts/migrate-postgres-to-sqlite.sh" --force

timestamp="$(date +%Y%m%d%H%M%S)"
backup_path="$ROOT_ENV_FILE.pre-sqlite-migration.$timestamp.bak"
cp "$ROOT_ENV_FILE" "$backup_path"

set_env_value "DATABASE_URL" "$SQLITE_DATABASE_URL_REL" "$ROOT_ENV_FILE"
set_env_value "POSTGRES_SOURCE_DATABASE_URL" "$legacy_database_url" "$ROOT_ENV_FILE"

echo "[ok] Legacy PostgreSQL config migrated to SQLite."
echo "[info] Original .env backed up to $backup_path"
