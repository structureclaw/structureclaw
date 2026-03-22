#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.runtime/pids"
LOG_DIR="$ROOT_DIR/.runtime/logs"
ROOT_ENV_FILE="$ROOT_DIR/.env"
FRONTEND_PORT=30000
BACKEND_PORT=8000

if [[ -f "$ROOT_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_ENV_FILE"
  set +a
  FRONTEND_PORT="${FRONTEND_PORT:-30000}"
  BACKEND_PORT="${PORT:-8000}"
fi

show_service() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "$name: running (pid $pid)"
      [[ -f "$log_file" ]] && grep "^=== \\[" "$log_file" | tail -1 | sed 's/^/  session: /'
      return 0
    fi
    echo "$name: stale pid file"
    return 0
  fi

  echo "$name: stopped"
}

show_service "backend"
show_service "frontend"

echo
echo "Health checks:"
curl -sf "http://localhost:$BACKEND_PORT/health" >/dev/null && echo "backend: healthy" || echo "backend: unavailable"
curl -sfI "http://localhost:$FRONTEND_PORT" >/dev/null && echo "frontend: healthy" || echo "frontend: unavailable"
