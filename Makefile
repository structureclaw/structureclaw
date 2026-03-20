ifeq ($(OS),Windows_NT)
SHELL := cmd
WINDOWS_PS := powershell -NoProfile -ExecutionPolicy Bypass -File .\make.ps1
else
SHELL := /bin/bash
UV_CACHE_DIR ?= /tmp/uv-cache
UV_PYTHON_INSTALL_DIR ?= /tmp/uv-python
endif
CORE_PYTHON_VERSION ?= 3.11

.PHONY: help ensure-uv install setup-core-full setup-core-full-uv dev-backend dev-frontend dev-core-full build db-up db-down db-init docker-up docker-down local-up local-up-uv local-up-noinfra local-down local-status health check-startup backend-regression core-regression doctor start restart stop status logs sclaw-install up

help:
	@echo "Available targets:"
	@echo "  ensure-uv      Bootstrap uv into ~/.local/bin when missing"
	@echo "  install         Install frontend and backend npm dependencies"
	@echo "  setup-core-full Create core .venv with full dependencies via uv"
	@echo "  setup-core-full-uv Create core .venv with uv + Python $(CORE_PYTHON_VERSION) (full deps)"
	@echo "  dev-backend     Start backend in watch mode"
	@echo "  dev-frontend    Start frontend in dev mode"
	@echo "  dev-core-full   Start analysis engine with full deps"
	@echo "  build           Build frontend and backend"
	@echo "  db-up           Start optional local infra (redis only)"
	@echo "  db-down         Stop optional local infra (redis only)"
	@echo "  db-init         Run SQLite schema sync and seed"
	@echo "  docker-up       Start full docker compose stack"
	@echo "  docker-down     Stop full docker compose stack"
	@echo "  local-up        One-command local startup (full core profile)"
	@echo "  local-up-uv     One-command local startup using uv-managed Python $(CORE_PYTHON_VERSION)"
	@echo "  local-up-noinfra Start local app stack without starting optional infra containers"
	@echo "  local-down      Stop local app processes and infra"
	@echo "  local-status    Show local app process/health status"
	@echo "  health          Check local service health endpoints"
	@echo "  backend-regression Run backend + agent/chat contract regressions"
	@echo "  check-startup   Run local startup checks without launching the full stack"
	@echo "  core-regression Run core analysis regression checks (contract + cases + schema)"
	@echo "  doctor          Beginner alias of check-startup"
	@echo "  start           Beginner one-command local startup (SQLite, no Docker)"
	@echo "  restart         Restart the local stack with the default startup profile"
	@echo "  stop            Beginner alias of local-down"
	@echo "  status          Beginner alias of local-status"
	@echo "  logs            Show logs (default: all services)"
	@echo "  sclaw-install   Install global sclaw command to ~/.local/bin"
	@echo "  up              Alias of docker-up"

ifeq ($(OS),Windows_NT)
ensure-uv:
	$(WINDOWS_PS) ensure-uv

install:
	$(WINDOWS_PS) install

setup-core-full:
	$(WINDOWS_PS) setup-core-full

setup-core-full-uv:
	$(WINDOWS_PS) setup-core-full-uv

dev-backend:
	$(WINDOWS_PS) dev-backend

dev-frontend:
	$(WINDOWS_PS) dev-frontend

dev-core-full:
	$(WINDOWS_PS) dev-core-full

build:
	$(WINDOWS_PS) build

db-up:
	$(WINDOWS_PS) db-up

db-down:
	$(WINDOWS_PS) db-down

db-init:
	$(WINDOWS_PS) db-init

docker-up:
	$(WINDOWS_PS) docker-up

docker-down:
	$(WINDOWS_PS) docker-down

local-up:
	$(WINDOWS_PS) local-up

local-up-uv:
	$(WINDOWS_PS) local-up-uv

local-up-noinfra:
	$(WINDOWS_PS) local-up-noinfra

local-down:
	$(WINDOWS_PS) local-down

local-status:
	$(WINDOWS_PS) local-status

health:
	$(WINDOWS_PS) health

check-startup:
	$(WINDOWS_PS) check-startup

backend-regression:
	$(WINDOWS_PS) backend-regression

core-regression:
	$(WINDOWS_PS) core-regression

doctor: check-startup

start:
	$(WINDOWS_PS) start

restart:
	$(WINDOWS_PS) restart

stop:
	$(WINDOWS_PS) stop

status:
	$(WINDOWS_PS) status

logs:
	$(WINDOWS_PS) logs

sclaw-install:
	$(WINDOWS_PS) sclaw-install

up: docker-up
else
ensure-uv:
	./scripts/ensure-uv.sh

install:
	npm install --prefix backend
	npm install --prefix frontend

setup-core-full: ensure-uv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv venv --python $(CORE_PYTHON_VERSION) core/.venv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv pip install --python core/.venv/bin/python --link-mode=copy -r core/requirements.txt

setup-core-full-uv: ensure-uv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv venv --python $(CORE_PYTHON_VERSION) core/.venv
	UV_CACHE_DIR=$(UV_CACHE_DIR) UV_PYTHON_INSTALL_DIR=$(UV_PYTHON_INSTALL_DIR) PATH="$(HOME)/.local/bin:$$PATH" uv pip install --python core/.venv/bin/python --link-mode=copy -r core/requirements.txt

dev-backend:
	npm run dev --prefix backend

dev-frontend:
	FRONTEND_PORT=$${FRONTEND_PORT:-30000} npm run dev --prefix frontend -- --port $$FRONTEND_PORT

dev-core-full:
	CORE_PORT=$${CORE_PORT:-8001} core/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $$CORE_PORT --reload --app-dir core

build:
	npm run build --prefix backend
	npm run build --prefix frontend

db-up:
	docker compose up -d redis

db-down:
	docker compose stop redis

db-init:
	npm run db:init --prefix backend

docker-up:
	docker compose up --build

docker-down:
	docker compose down

local-up:
	./scripts/dev-up.sh full

local-up-uv:
	./scripts/dev-up.sh full --uv

local-up-noinfra:
	./scripts/dev-up.sh full --skip-infra

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

restart:
	./scripts/claw.sh restart

stop:
	./scripts/claw.sh stop

status:
	./scripts/claw.sh status

logs:
	./scripts/claw.sh logs

sclaw-install:
	./sclaw install

up: docker-up
endif
