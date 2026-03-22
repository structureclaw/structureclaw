#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"
ROOT_ENV_FILE="$ROOT_DIR/.env"
FRONTEND_PORT="${FRONTEND_PORT:-30000}"
BACKEND_PORT="${PORT:-8000}"
SKIP_INFRA=0
SKIP_DB_INIT=0

print_usage() {
  cat <<'EOF'
Usage: ./scripts/dev-up.sh [--uv] [--skip-infra] [--skip-db-init]

Options:
  --uv            Create backend/.venv with uv-managed Python 3.11
  --skip-infra    Do not start optional infra services via docker compose
  --skip-db-init  Skip SQLite schema sync+seed
EOF
}

for arg in "$@"; do
  case "$arg" in
    --uv)
      ;;
    --skip-infra)
      SKIP_INFRA=1
      ;;
    --skip-db-init)
      SKIP_DB_INIT=1
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      print_usage
      exit 1
      ;;
  esac
done

mkdir -p "$LOG_DIR" "$PID_DIR"

ensure_file() {
  local target="$1"
  local example="$2"
  if [[ ! -f "$target" && -f "$example" ]]; then
    cp "$example" "$target"
    echo "Created $target from example."
  fi
}

load_root_env() {
  if [[ -f "$ROOT_ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ROOT_ENV_FILE"
    set +a
    FRONTEND_PORT="${FRONTEND_PORT:-30000}"
    BACKEND_PORT="${PORT:-8000}"
  fi
}

is_pid_running() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    rm -f "$pid_file"
  fi
  return 1
}

start_service() {
  local name="$1"
  local command="$2"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if is_pid_running "$pid_file"; then
    echo "$name is already running (pid $(cat "$pid_file"))."
    return 0
  fi

  printf '=== [%s] starting %s ===\n' "$(date -Iseconds)" "$name" >"$log_file"
  echo "Starting $name..."
  setsid bash -lc "cd \"$ROOT_DIR\" && exec $command" >>"$log_file" 2>&1 &
  echo $! >"$pid_file"
}

ensure_npm_dependencies() {
  local project_dir="$1"
  local project_name="$2"
  local lockfile="$project_dir/package-lock.json"
  local node_modules_dir="$project_dir/node_modules"
  local lock_snapshot="$node_modules_dir/.package-lock.snapshot"
  local needs_install=0

  if [[ ! -d "$node_modules_dir" ]]; then
    needs_install=1
  elif [[ -f "$lockfile" ]]; then
    if [[ ! -f "$lock_snapshot" ]] || ! cmp -s "$lockfile" "$lock_snapshot"; then
      needs_install=1
    fi
  fi

  if [[ "$needs_install" -eq 1 ]]; then
    echo "Installing $project_name dependencies..."
    npm ci --prefix "$project_dir"
    if [[ -f "$lockfile" ]]; then
      mkdir -p "$node_modules_dir"
      cp "$lockfile" "$lock_snapshot"
    fi
  fi
}

is_redis_enabled() {
  local redis_url=""
  if [[ -f "$ROOT_ENV_FILE" ]]; then
    redis_url="$(grep '^REDIS_URL=' "$ROOT_ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  fi
  [[ -n "$redis_url" && "${redis_url,,}" != "disabled" ]]
}

ensure_file "$ROOT_DIR/.env" "$ROOT_DIR/.env.example"
load_root_env
ensure_npm_dependencies "$ROOT_DIR/backend" "backend"
ensure_npm_dependencies "$ROOT_DIR/frontend" "frontend"

"$ROOT_DIR/scripts/auto-migrate-legacy-postgres.sh"

if [[ ! -x "$ROOT_DIR/backend/.venv/bin/python" ]]; then
  echo "Creating backend/.venv for analysis runtime..."
  make -C "$ROOT_DIR" setup-analysis-python
fi

source "$ROOT_DIR/scripts/analysis-python-env.sh"
require_analysis_python

if ! "$PYTHON_BIN" -m providers.opensees.runtime --json >/dev/null 2>&1; then
  echo "OpenSees runtime check failed in backend/.venv."
  echo "Run: PYTHONPATH=\"$PYTHONPATH\" \"$PYTHON_BIN\" -m providers.opensees.runtime --json"
  exit 1
fi

if [[ "$SKIP_INFRA" -eq 0 ]] && is_redis_enabled; then
  echo "Starting optional local infrastructure..."
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d redis
fi

if [[ "$SKIP_DB_INIT" -eq 0 ]]; then
  mkdir -p "$ROOT_DIR/.runtime/data"
  echo "Running SQLite schema sync and seed..."
  npm run db:init --prefix "$ROOT_DIR/backend"
fi

start_service "backend" "npm run dev --prefix backend"
start_service "frontend" "npm run dev --prefix frontend -- --port $FRONTEND_PORT"

echo
echo "Local stack started."
echo "Logs: $LOG_DIR"
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo "Backend:  http://localhost:$BACKEND_PORT"
echo "Use ./scripts/dev-status.sh to inspect services."
