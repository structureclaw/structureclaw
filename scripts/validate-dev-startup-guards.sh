#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT_DIR/scripts/dev-up.sh"
CHECK_STARTUP_TARGET="$ROOT_DIR/scripts/check-startup.sh"

assert_contains() {
  local pattern="$1"
  local message="$2"
  if ! rg -q "$pattern" "$TARGET"; then
    echo "[fail] $message"
    exit 1
  fi
}

assert_contains_in_file() {
  local file="$1"
  local pattern="$2"
  local message="$3"
  if ! rg -q "$pattern" "$file"; then
    echo "[fail] $message"
    exit 1
  fi
}

echo "Validating startup self-healing guards..."

assert_contains "ensure_npm_dependencies\\(" "missing npm dependency self-healing function"
assert_contains "lock_snapshot" "missing lockfile snapshot drift detection"
assert_contains "require_analysis_python" "missing analysis Python guard"
assert_contains "reset_frontend_cache_if_needed" "missing frontend cache recovery hook"
assert_contains "Cannot find module '\\./" "missing frontend chunk corruption detection signature"
assert_contains "starting %s" "missing session header for log isolation"
assert_contains "auto-migrate-legacy-postgres\\.sh" "missing legacy postgres auto-migration hook in dev-up"
assert_contains_in_file "$CHECK_STARTUP_TARGET" "auto-migrate-legacy-postgres\\.sh" "missing legacy postgres auto-migration hook in check-startup"

echo "[ok] startup self-healing guards are present"
