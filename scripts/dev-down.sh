#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.runtime/pids"

terminate_pid_tree() {
  local pid="$1"
  local label="$2"

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  echo "Stopping $label (pid $pid)..."
  kill -TERM -- "-$pid" >/dev/null 2>&1 || kill -TERM "$pid" >/dev/null 2>&1 || true
  for _ in {1..10}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  kill -KILL -- "-$pid" >/dev/null 2>&1 || kill -KILL "$pid" >/dev/null 2>&1 || true
}

stop_service() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  if [[ ! -f "$pid_file" ]]; then
    echo "$name is not tracked."
    return 0
  fi
  local pid
  pid="$(cat "$pid_file")"
  terminate_pid_tree "$pid" "$name"
  rm -f "$pid_file"
}

stop_service "frontend"
stop_service "backend"

echo "Stopping local infrastructure..."
docker compose -f "$ROOT_DIR/docker-compose.yml" stop redis >/dev/null 2>&1 || true

echo "Local stack stopped."
