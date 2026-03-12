#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"
ROOT_ENV_FILE="$ROOT_DIR/.env"
FRONTEND_PORT="${FRONTEND_PORT:-30000}"
BACKEND_PORT="${PORT:-8000}"
CORE_PORT="${CORE_PORT:-8001}"
CORE_PROFILE="lite"
CORE_ENV_MANAGER="uv"
SKIP_INFRA=0
SKIP_DB_INIT=0
UV_LOCAL_BIN="${UV_INSTALL_DIR:-$HOME/.local/bin}"

print_usage() {
  cat <<'EOF'
Usage: ./scripts/dev-up.sh [lite|full] [--uv] [--skip-infra] [--skip-db-init]

Options:
  lite            Start core with lightweight Python dependencies (default)
  full            Start core with full Python dependencies
  --uv            Create core/.venv with uv-managed Python 3.11
  --skip-infra    Do not start postgres/redis via docker compose
  --skip-db-init  Skip Prisma migrate+seed
EOF
}

for arg in "$@"; do
  case "$arg" in
    lite|full)
      CORE_PROFILE="$arg"
      ;;
    --uv)
      CORE_ENV_MANAGER="uv"
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
    CORE_PORT="${CORE_PORT:-8001}"
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

require_command() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    echo "$hint"
    exit 1
  fi
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

ensure_uv() {
  "$ROOT_DIR/scripts/ensure-uv.sh"
  export PATH="$UV_LOCAL_BIN:$PATH"
  require_command "uv" "uv bootstrap finished but the command is still unavailable."
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

core_module_available() {
  local module_name="$1"
  if [[ ! -x "$ROOT_DIR/core/.venv/bin/python" ]]; then
    return 1
  fi

  "$ROOT_DIR/core/.venv/bin/python" - "$module_name" <<'PY' >/dev/null 2>&1
import importlib.util
import sys

module = sys.argv[1]
sys.exit(0 if importlib.util.find_spec(module) else 1)
PY
}

should_reset_frontend_cache() {
  local log_file="$LOG_DIR/frontend.log"

  if [[ ! -f "$log_file" ]]; then
    return 1
  fi

  if grep -Fq "Cannot find module './" "$log_file" && grep -Fq ".next/server/webpack-runtime.js" "$log_file"; then
    return 0
  fi

  return 1
}

reset_frontend_cache_if_needed() {
  local frontend_pid_file="$PID_DIR/frontend.pid"

  if is_pid_running "$frontend_pid_file"; then
    return 0
  fi

  if should_reset_frontend_cache; then
    echo "Detected stale frontend build artifacts from previous session; resetting frontend/.next..."
    rm -rf "$ROOT_DIR/frontend/.next"
  fi
}

is_redis_enabled() {
  local redis_url=""
  local raw_line=""
  local line=""
  local value=""

  if [[ -f "$ROOT_ENV_FILE" ]]; then
    while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
      line="${raw_line#"${raw_line%%[![:space:]]*}"}"
      [[ -z "$line" || "${line:0:1}" == "#" || "$line" != *=* ]] && continue

      if [[ "${line%%=*}" == "REDIS_URL" ]]; then
        value="${line#*=}"
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
        redis_url="$value"
      fi
    done <"$ROOT_ENV_FILE"
  fi

  [[ -n "$redis_url" && "${redis_url,,}" != "disabled" ]]
}

docker_ready() {
  docker info >/dev/null 2>&1
}

wait_for_postgres() {
  echo "Waiting for PostgreSQL..."
  for _ in {1..30}; do
    if docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
      echo "PostgreSQL is ready."
      return 0
    fi
    sleep 2
  done

  echo "PostgreSQL did not become ready in time."
  return 1
}

ensure_file "$ROOT_DIR/.env" "$ROOT_DIR/.env.example"
load_root_env

require_command "node" "Install Node.js 18+ and retry."
require_command "npm" "Install npm and retry."
ensure_uv

ensure_npm_dependencies "$ROOT_DIR/backend" "backend"
ensure_npm_dependencies "$ROOT_DIR/frontend" "frontend"

if [[ ! -x "$ROOT_DIR/core/.venv/bin/python" ]] || ! core_module_available "uvicorn"; then
  recreate_core_venv=0
  if [[ ! -x "$ROOT_DIR/core/.venv/bin/python" ]]; then
    echo "Creating Python virtual environment for core ($CORE_PROFILE)..."
  else
    echo "Core virtual environment exists but is missing required modules; reinstalling core dependencies ($CORE_PROFILE)..."
    recreate_core_venv=1
  fi

  if [[ "$recreate_core_venv" -eq 1 ]]; then
    echo "Removing stale core virtual environment at core/.venv..."
    rm -rf "$ROOT_DIR/core/.venv"
  fi

  if [[ "$CORE_ENV_MANAGER" == "uv" ]]; then
    if [[ "$CORE_PROFILE" == "full" ]]; then
      make -C "$ROOT_DIR" setup-core-full-uv
    else
      make -C "$ROOT_DIR" setup-core-lite-uv
    fi
  else
    echo "Using Python 3.11 managed by uv."
    if [[ "$CORE_PROFILE" == "full" ]]; then
      make -C "$ROOT_DIR" setup-core-full-uv
    else
      make -C "$ROOT_DIR" setup-core-lite-uv
    fi
  fi
fi

if [[ "$SKIP_INFRA" -eq 0 ]]; then
  require_command "docker" "Install Docker and Docker Compose plugin, or rerun with --skip-infra."

  if ! docker_ready; then
    echo "Docker daemon is not reachable."
    echo "Start Docker Desktop/service, or rerun with --skip-infra if you already have PostgreSQL/Redis."
    exit 1
  fi

  echo "Starting local infrastructure..."
  compose_services=(postgres)
  if is_redis_enabled; then
    compose_services+=(redis)
  else
    echo "Redis is disabled in .env; skipping redis container startup."
  fi
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d "${compose_services[@]}"
  wait_for_postgres
else
  echo "Skipping local postgres/redis startup (--skip-infra)."
fi

if [[ "$SKIP_DB_INIT" -eq 0 ]]; then
  echo "Running database migrations and seed..."
  npm run db:init --prefix "$ROOT_DIR/backend"
else
  echo "Skipping database init (--skip-db-init)."
fi

start_service "backend" "npm run dev --prefix backend"
reset_frontend_cache_if_needed
start_service "frontend" "npm run dev --prefix frontend -- --port $FRONTEND_PORT"
start_service "core" "core/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $CORE_PORT --reload --app-dir core"

echo
echo "Local stack started."
echo "Logs: $LOG_DIR"
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo "Backend:  http://localhost:$BACKEND_PORT (GET / returns 404 by design; use /health)"
echo "Core:     http://localhost:$CORE_PORT"
echo "Use ./scripts/dev-status.sh to inspect services."
