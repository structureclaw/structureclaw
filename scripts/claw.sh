#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_LOG_DIR="$ROOT_DIR/.runtime/logs"

print_help() {
  cat <<'EOF'
StructureClaw command hub

Usage:
  ./scripts/claw.sh doctor
  ./scripts/claw.sh start
  ./scripts/claw.sh restart
  ./scripts/claw.sh stop
  ./scripts/claw.sh status
  ./scripts/claw.sh logs [frontend|backend|all] [--follow]
  ./scripts/claw.sh skill search <keyword> [domain]
  ./scripts/claw.sh skill install <skill-id>
  ./scripts/claw.sh skill enable <skill-id>
  ./scripts/claw.sh skill disable <skill-id>
  ./scripts/claw.sh skill uninstall <skill-id>
  ./scripts/claw.sh skill list

Commands:
  doctor      Run startup checks (without starting full stack)
  start       Recommended for beginners (backend-hosted analysis runtime, no Docker)
  restart     Restart local services with the default startup profile (no Docker)
  stop        Stop local services and local infra
  status      Show service runtime + health checks
  logs        Show runtime logs from .runtime/logs
  skill       Manage external SkillHub skills (search/install/enable/disable/uninstall/list)
EOF
}

skill_api_base() {
  echo "${SCLAW_API_BASE:-http://localhost:8000}"
}

run_skill_command() {
  local subcommand="${2:-}"
  local api_base
  api_base="$(skill_api_base)"

  case "$subcommand" in
    search)
      local keyword="${3:-}"
      local domain="${4:-}"
      if [[ -z "$keyword" ]]; then
        echo "Usage: ./scripts/claw.sh skill search <keyword> [domain]"
        exit 1
      fi
      if [[ -n "$domain" ]]; then
        curl -sS -G "${api_base}/api/v1/agent/skillhub/search" --data-urlencode "q=$keyword" --data-urlencode "domain=$domain"
      else
        curl -sS -G "${api_base}/api/v1/agent/skillhub/search" --data-urlencode "q=$keyword"
      fi
      echo
      ;;
    install|enable|disable|uninstall)
      local skill_id="${3:-}"
      if [[ -z "$skill_id" ]]; then
        echo "Usage: ./scripts/claw.sh skill ${subcommand} <skill-id>"
        exit 1
      fi
      curl -sS -X POST "${api_base}/api/v1/agent/skillhub/${subcommand}" \
        -H 'Content-Type: application/json' \
        -d "{\"skillId\":\"${skill_id}\"}"
      echo
      ;;
    list)
      curl -sS "${api_base}/api/v1/agent/skillhub/installed"
      echo
      ;;
    *)
      echo "Usage:"
      echo "  ./scripts/claw.sh skill search <keyword> [domain]"
      echo "  ./scripts/claw.sh skill install <skill-id>"
      echo "  ./scripts/claw.sh skill enable <skill-id>"
      echo "  ./scripts/claw.sh skill disable <skill-id>"
      echo "  ./scripts/claw.sh skill uninstall <skill-id>"
      echo "  ./scripts/claw.sh skill list"
      exit 1
      ;;
  esac
}

service_log_path() {
  local service="$1"
  case "$service" in
    frontend|backend)
      echo "$RUNTIME_LOG_DIR/$service.log"
      ;;
    *)
      return 1
      ;;
  esac
}

latest_session_start_line() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  grep -n "^=== \\[" "$file" | tail -1 | cut -d: -f1
}

print_recent_log_session() {
  local file="$1"
  local session_line=""

  session_line="$(latest_session_start_line "$file" || true)"
  if [[ -n "$session_line" ]]; then
    sed -n "${session_line},\$p" "$file" | tail -n 120
  else
    tail -n 80 "$file"
  fi
}

show_logs() {
  local target="${1:-all}"
  local follow="${2:-}"
  local -a files=()

  mkdir -p "$RUNTIME_LOG_DIR"

  if [[ "$target" == "all" ]]; then
    files=(
      "$RUNTIME_LOG_DIR/frontend.log"
      "$RUNTIME_LOG_DIR/backend.log"
    )
  else
    files=("$(service_log_path "$target")")
  fi

  for file in "${files[@]}"; do
    if [[ ! -f "$file" ]]; then
      echo "Log file not found yet: $file"
    fi
  done

  if [[ "$follow" == "--follow" ]]; then
    for file in "${files[@]}"; do
      if [[ -f "$file" ]]; then
        echo "----- $(basename "$file") latest session -----"
        print_recent_log_session "$file"
      fi
    done
    echo "----- follow mode: streaming full logs -----"
    tail -n 80 -f "${files[@]}"
  else
    for file in "${files[@]}"; do
      if [[ -f "$file" ]]; then
        echo "----- $(basename "$file") latest session -----"
        print_recent_log_session "$file"
      fi
    done
  fi
}

command_name="${1:-help}"
case "$command_name" in
  doctor)
    "$ROOT_DIR/scripts/check-startup.sh"
    ;;
  start)
    "$ROOT_DIR/scripts/dev-up.sh" --uv --skip-infra
    ;;
  restart)
    "$ROOT_DIR/scripts/dev-down.sh"
    "$ROOT_DIR/scripts/dev-up.sh" --uv --skip-infra
    ;;
  stop)
    "$ROOT_DIR/scripts/dev-down.sh"
    ;;
  status)
    "$ROOT_DIR/scripts/dev-status.sh"
    ;;
  logs)
    show_logs "${2:-all}" "${3:-}"
    ;;
  skill)
    run_skill_command "$@"
    ;;
  -h|--help|help)
    print_help
    ;;
  *)
    echo "Unknown command: $command_name"
    echo
    print_help
    exit 1
    ;;
esac
