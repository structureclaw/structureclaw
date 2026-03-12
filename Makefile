SHELL := /bin/bash
UV_CACHE_DIR ?= /tmp/uv-cache
UV_PYTHON_INSTALL_DIR ?= /tmp/uv-python
CORE_PYTHON_VERSION ?= 3.11

.PHONY: help ensure-uv install setup-core-lite setup-core-full setup-core-lite-uv setup-core-full-uv dev-backend dev-frontend dev-core-lite dev-core-full build db-up db-down db-init docker-up docker-down local-up local-up-full local-up-uv local-up-full-uv local-up-noinfra local-down local-status health check-startup backend-regression core-regression doctor start start-full stop status logs sclaw-install up

help:
	@echo "Available targets:"
	@echo "  ensure-uv      Bootstrap uv into ~/.local/bin when missing"
	@echo "  install         Install frontend and backend npm dependencies"
	@echo "  setup-core-lite Create core .venv with lightweight dependencies via uv"
	@echo "  setup-core-full Create core .venv with full dependencies via uv"
	@echo "  setup-core-lite-uv Create core .venv with uv + Python $(CORE_PYTHON_VERSION) (lite deps)"
	@echo "  setup-core-full-uv Create core .venv with uv + Python $(CORE_PYTHON_VERSION) (full deps)"
	@echo "  dev-backend     Start backend in watch mode"
	@echo "  dev-frontend    Start frontend in dev mode"
	@echo "  dev-core-lite   Start analysis engine with lightweight deps"
	@echo "  dev-core-full   Start analysis engine with full deps"
	@echo "  build           Build frontend and backend"
	@echo "  db-up           Start postgres and redis only"
	@echo "  db-down         Stop postgres and redis"
	@echo "  db-init         Run Prisma migrations and seed"
	@echo "  docker-up       Start full docker compose stack"
	@echo "  docker-down     Stop full docker compose stack"
	@echo "  local-up        One-command local startup (lite core profile)"
	@echo "  local-up-full   One-command local startup (full core profile)"
	@echo "  local-up-uv     One-command local startup using uv-managed Python $(CORE_PYTHON_VERSION)"
	@echo "  local-up-full-uv One-command local startup (full core) using uv-managed Python $(CORE_PYTHON_VERSION)"
	@echo "  local-up-noinfra Start local app stack without starting postgres/redis docker containers"
	@echo "  local-down      Stop local app processes and infra"
	@echo "  local-status    Show local app process/health status"
	@echo "  health          Check local service health endpoints"
	@echo "  backend-regression Run backend + agent/chat contract regressions"
	@echo "  check-startup   Run local startup checks without launching the full stack"
	@echo "  core-regression Run core analysis regression checks (contract + cases + schema)"
	@echo "  doctor          Beginner alias of check-startup"
	@echo "  start           Beginner one-command startup (lite + uv)"
	@echo "  start-full      Beginner one-command startup (full + uv)"
	@echo "  stop            Beginner alias of local-down"
	@echo "  status          Beginner alias of local-status"
	@echo "  logs            Show logs (default: all services)"
	@echo "  sclaw-install   Install global sclaw command to ~/.local/bin"
	@echo "  up              Alias of docker-up"

ensure-uv:
	./scripts/ensure-uv.sh

install:
	npm install --prefix backend
	npm install --prefix frontend

setup-core-lite: ensure-uv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv venv --python $(CORE_PYTHON_VERSION) core/.venv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv pip install --python core/.venv/bin/python --link-mode=copy -r core/requirements-lite.txt

setup-core-full: ensure-uv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv venv --python $(CORE_PYTHON_VERSION) core/.venv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv pip install --python core/.venv/bin/python --link-mode=copy -r core/requirements.txt

setup-core-lite-uv: ensure-uv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv venv --python $(CORE_PYTHON_VERSION) core/.venv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv pip install --python core/.venv/bin/python --link-mode=copy -r core/requirements-lite.txt

setup-core-full-uv: ensure-uv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv venv --python $(CORE_PYTHON_VERSION) core/.venv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv pip install --python core/.venv/bin/python --link-mode=copy -r core/requirements.txt

dev-backend:
	npm run dev --prefix backend

dev-frontend:
	FRONTEND_PORT=$${FRONTEND_PORT:-30000} npm run dev --prefix frontend -- --port $$FRONTEND_PORT

dev-core-lite:
	CORE_PORT=$${CORE_PORT:-8001} core/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $$CORE_PORT --reload --app-dir core

dev-core-full:
	CORE_PORT=$${CORE_PORT:-8001} core/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $$CORE_PORT --reload --app-dir core

build:
	npm run build --prefix backend
	npm run build --prefix frontend

db-up:
	docker compose up -d postgres redis

db-down:
	docker compose stop postgres redis

db-init:
	npm run db:init --prefix backend

docker-up:
	docker compose up --build

docker-down:
	docker compose down

local-up:
	./scripts/dev-up.sh

local-up-full:
	./scripts/dev-up.sh full

local-up-uv:
	./scripts/dev-up.sh lite --uv

local-up-full-uv:
	./scripts/dev-up.sh full --uv

local-up-noinfra:
	./scripts/dev-up.sh lite --skip-infra

local-down:
	./scripts/dev-down.sh

local-status:
	./scripts/dev-status.sh

health:
	curl http://localhost:$${PORT:-8000}/health
	curl http://localhost:$${CORE_PORT:-8001}/health
	curl -I http://localhost:$${FRONTEND_PORT:-30000}

check-startup:
	./scripts/check-startup.sh

backend-regression:
	./scripts/check-backend-regression.sh

core-regression:
	./scripts/check-core-regression.sh

doctor: check-startup

start:
	./scripts/claw.sh start

start-full:
	./scripts/claw.sh start-full

stop:
	./scripts/claw.sh stop

status:
	./scripts/claw.sh status

logs:
	./scripts/claw.sh logs

sclaw-install:
	./sclaw install

up: docker-up
