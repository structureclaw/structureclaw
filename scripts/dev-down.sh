#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.runtime/pids"
ROOT_ENV_FILE="$ROOT_DIR/.env"
CORE_PORT=8001

if [[ -f "$ROOT_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_ENV_FILE"
  set +a
  CORE_PORT="${CORE_PORT:-8001}"
fi

list_descendants() {
  local pid="$1"
  local child

  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi

  for child in $(pgrep -P "$pid" || true); do
    echo "$child"
    list_descendants "$child"
  done
}

terminate_pid_tree() {
  local pid="$1"
  local label="$2"
  local descendants

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  echo "Stopping $label (pid $pid)..."
  descendants="$(list_descendants "$pid" | tr '\n' ' ')"

  # Services are started in their own session, so the pid is also the
  # process-group leader. Fall back to killing the single pid if needed.
  kill -TERM -- "-$pid" >/dev/null 2>&1 || kill -TERM "$pid" >/dev/null 2>&1 || true
  if [[ -n "$descendants" ]]; then
    kill -TERM $descendants >/dev/null 2>&1 || true
  fi

  for _ in {1..10}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "$label did not exit after SIGTERM; forcing shutdown."
  kill -KILL -- "-$pid" >/dev/null 2>&1 || kill -KILL "$pid" >/dev/null 2>&1 || true
  if [[ -n "$descendants" ]]; then
    kill -KILL $descendants >/dev/null 2>&1 || true
  fi
}

stop_orphan_matches() {
  local name="$1"
  local pattern="$2"

  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi

  local pids
  pids="$(pgrep -f "$pattern" || true)"

  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "Cleaning up orphaned $name process(es): $pids"
  local pid
  for pid in $pids; do
    terminate_pid_tree "$pid" "$name orphan"
  done
}

stop_service() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    terminate_pid_tree "$pid" "$name"
    rm -f "$pid_file"
  else
    echo "$name is not tracked."
  fi
}

stop_service "frontend"
stop_service "backend"
stop_service "core"

stop_orphan_matches "frontend" "$ROOT_DIR/frontend/node_modules/.bin/next dev"
stop_orphan_matches "backend" "$ROOT_DIR/backend/node_modules/.bin/tsx watch src/index.ts"
stop_orphan_matches "core" "$ROOT_DIR/core/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $CORE_PORT --reload --app-dir core"

echo "Stopping local infrastructure..."
docker compose -f "$ROOT_DIR/docker-compose.yml" stop redis >/dev/null 2>&1 || true

echo "Local stack stopped."
