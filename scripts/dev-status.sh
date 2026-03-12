#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.runtime/pids"
LOG_DIR="$ROOT_DIR/.runtime/logs"
ROOT_ENV_FILE="$ROOT_DIR/.env"
FRONTEND_PORT=30000
BACKEND_PORT=8000
CORE_PORT=8001

if [[ -f "$ROOT_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_ENV_FILE"
  set +a
  FRONTEND_PORT="${FRONTEND_PORT:-30000}"
  BACKEND_PORT="${PORT:-8000}"
  CORE_PORT="${CORE_PORT:-8001}"
fi

latest_session_header() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  grep "^=== \\[" "$file" | tail -1 || true
}

show_service() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"
  local header=""
  header="$(latest_session_header "$log_file")"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "$name: running (pid $pid)"
      if [[ -n "$header" ]]; then
        echo "  session: $header"
      fi
      return 0
    fi
    echo "$name: stale pid file"
    if [[ -n "$header" ]]; then
      echo "  last session: $header"
    fi
    return 0
  fi

  echo "$name: stopped"
  if [[ -n "$header" ]]; then
    echo "  last session: $header"
  fi
}

show_service "backend"
show_service "frontend"
show_service "core"

echo
echo "Health checks:"
curl -sf "http://localhost:$BACKEND_PORT/health" >/dev/null && echo "backend: healthy" || echo "backend: unavailable"
curl -sf "http://localhost:$CORE_PORT/health" >/dev/null && echo "core: healthy" || echo "core: unavailable"
curl -sfI "http://localhost:$FRONTEND_PORT" >/dev/null && echo "frontend: healthy" || echo "frontend: unavailable"
