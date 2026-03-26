#!/usr/bin/env bash
# CI/local: build .env for Docker SQLite, bring up compose stack, probe health, tear down.
# Uses .runtime/ci-docker-smoke.env (under .runtime/, gitignored) so the workspace .env is not overwritten.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

OUT_ENV="${STRUCTURECLAW_COMPOSE_ENV_FILE:-$ROOT_DIR/.runtime/ci-docker-smoke.env}"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

smoke_log() {
  printf '[ci-docker-smoke] %s\n' "$*"
}

read_env_value() {
  local file="$1"
  local key="$2"
  grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | tr -d '\r'
}

write_smoke_env() {
  mkdir -p "$(dirname "$OUT_ENV")"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "$line" ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
      printf '%s\n' "$line"
      continue
    fi
    case "$line" in
      DATABASE_URL=*) echo 'DATABASE_URL=file:/.runtime/data/structureclaw.db' ;;
      LLM_API_KEY=*) echo 'LLM_API_KEY=ci-dummy-key' ;;
      LLM_MODEL=*) echo 'LLM_MODEL=gpt-4-turbo-preview' ;;
      LLM_BASE_URL=*) echo 'LLM_BASE_URL=https://api.openai.com/v1' ;;
      NGINX_HTTP_PORT=*) echo 'NGINX_HTTP_PORT=18080' ;;
      NGINX_HTTPS_PORT=*) echo 'NGINX_HTTPS_PORT=18443' ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$ROOT_DIR/.env.example" > "$OUT_ENV"
}

cleanup() {
  smoke_log "docker compose down"
  docker compose -f "$COMPOSE_FILE" --env-file "$OUT_ENV" down --remove-orphans 2>/dev/null || true
}

trap cleanup EXIT

if [[ ! -f "$ROOT_DIR/.env.example" ]]; then
  smoke_log "missing .env.example"
  exit 1
fi

write_smoke_env
mkdir -p "$ROOT_DIR/.runtime/data"

smoke_log "docker compose config"
docker compose -f "$COMPOSE_FILE" --env-file "$OUT_ENV" config -q

smoke_log "docker compose up --build -d"
docker compose -f "$COMPOSE_FILE" --env-file "$OUT_ENV" up --build -d

BACKEND_PORT="$(read_env_value "$OUT_ENV" PORT)"
FRONTEND_PORT="$(read_env_value "$OUT_ENV" FRONTEND_PORT)"
if [[ -z "$BACKEND_PORT" ]]; then
  BACKEND_PORT="8000"
fi
if [[ -z "$FRONTEND_PORT" ]]; then
  FRONTEND_PORT="30000"
fi

BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}/health"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}/"

smoke_log "wait for backend ${BACKEND_URL}"
deadline=$((SECONDS + 300))
ok=0
while [[ "$SECONDS" -lt "$deadline" ]]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BACKEND_URL" || true)"
  if [[ "$code" == "200" ]]; then
    ok=1
    break
  fi
  sleep 3
done

if [[ "$ok" -ne 1 ]]; then
  smoke_log "backend health check failed"
  docker compose -f "$COMPOSE_FILE" --env-file "$OUT_ENV" ps || true
  exit 1
fi

smoke_log "probe frontend ${FRONTEND_URL}"
fcode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$FRONTEND_URL" || true)"
if [[ "$fcode" != "200" ]] && [[ "$fcode" != "307" ]] && [[ "$fcode" != "304" ]]; then
  smoke_log "frontend returned HTTP ${fcode} (continuing if backend ok)"
fi

smoke_log "docker compose smoke passed"
trap - EXIT
cleanup
