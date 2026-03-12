# Technology Stack

**Analysis Date:** 2026-03-12
**Scope:** full repository scan across `backend/`, `core/`, `frontend/`, `scripts/`, `docs/`, root orchestration files

## Runtime Baseline

- Node.js is the JavaScript runtime for `backend/` and `frontend/`.
  - `backend/package.json` requires `node >=18.0.0`.
  - Docker images use `node:20-alpine` in `backend/Dockerfile` and `frontend/Dockerfile`.
- Python 3.11 is the runtime for the analysis engine in `core/`.
  - `core/Dockerfile` uses `python:3.11-slim`.
  - `Makefile` pins `CORE_PYTHON_VERSION ?= 3.11`.
- Bash is part of the operational surface.
  - Repo automation is concentrated in `scripts/*.sh`, `sclaw`, and `Makefile`.

## Languages By Area

- TypeScript
  - Backend application code in `backend/src/**/*.ts`.
  - Frontend app code in `frontend/src/**/*.ts` and `frontend/src/**/*.tsx`.
  - Prisma seed in `backend/prisma/seed.ts`.
- Python
  - Analysis API and engineering logic in `core/main.py`, `core/fem/`, `core/design/`, `core/schemas/`, and `core/converters/`.
- Shell
  - Local lifecycle, regression, and validation commands in `scripts/`.
- SQL
  - Prisma migration SQL in `backend/prisma/migrations/20260308000100_init/migration.sql`.
- Markdown
  - Product and protocol docs in `README.md`, `PROJECT.md`, `ROADMAP.md`, and `docs/*.md`.

## Backend Stack (`backend/`)

### Framework and execution

- Fastify 4.26.2 powers the HTTP API in `backend/src/index.ts`.
- Development uses `tsx watch` via `backend/package.json`.
- Production builds with `tsc` to `dist/` and starts with `node dist/index.js`.
- API documentation is generated with `@fastify/swagger` and `@fastify/swagger-ui`.

### Core libraries

- Prisma 5.12.0
  - Schema in `backend/prisma/schema.prisma`.
  - Client bootstrap in `backend/src/utils/database.ts`.
- Zod 3.22.4
  - Request/runtime validation in route files such as `backend/src/api/chat.ts` and `backend/src/api/agent.ts`.
- Axios 1.6.8
  - Internal HTTP client used by the agent orchestration layer in `backend/src/services/agent.ts`.
- ioredis 5.3.2
  - Cache/session backend with memory fallback in `backend/src/utils/redis.ts`.
- Pino 8.19.0 + `pino-pretty`
  - Structured logging in `backend/src/utils/logger.ts`.

### AI and orchestration layer

- `langchain` 0.1.36 plus `@langchain/openai` power LLM-backed chat/agent execution.
- `openai` 4.33.0 is also installed, but the active model factory is `backend/src/utils/llm.ts`.
- Current backend config supports three provider modes in `backend/src/config/index.ts`:
  - `openai`
  - `zhipu`
  - `openai-compatible`
- Recent console/backend work is reflected in the agent stack:
  - OpenClaw-style agent protocol lives in `backend/src/services/agent.ts`.
  - HTTP entrypoints are in `backend/src/api/agent.ts`.
  - SSE chat streaming is implemented in `backend/src/api/chat.ts`.
  - Protocol reference is documented in `docs/agent-stream-protocol.md`.

### Data model

- PostgreSQL is the only declared primary database.
- Prisma models cover:
  - users, projects, project membership
  - structural models and analyses
  - conversations and messages
  - skills, reviews, executions
  - community posts, comments, likes
- The schema is monolithic and shared by all backend modules in `backend/prisma/schema.prisma`.

## Core Analysis Stack (`core/`)

### Web/API layer

- FastAPI 0.110.1 exposes the analysis service in `core/main.py`.
- Uvicorn 0.29.0 is the runtime server.
- Pydantic 2.6.4 defines request/response and structural model schemas.

### Engineering and numeric libraries

- `openseespy==3.5.1.6`
- `numpy==1.26.4`
- `scipy==1.12.0`
- `pynite==0.0.84`
- `ananstruct==1.1.0`

These back the domain code in `core/fem/static_analysis.py`, `core/fem/dynamic_analysis.py`, `core/fem/seismic_analysis.py`, `core/design/concrete.py`, `core/design/steel.py`, and `core/design/code_check.py`.

### Schema and converter layer

- Native schema is `StructureModelV1` in `core/schemas/structure_model_v1.py`.
- Schema migration helpers are in `core/schemas/migrations.py`.
- Format conversion registry lives in `core/converters/registry.py`.
- Supported converter families are implemented in:
  - `core/converters/simple_v1_converter.py`
  - `core/converters/compact_v1_converter.py`
  - `core/converters/midas_text_v1_converter.py`
  - `core/converters/v1_converter.py`

### Python dependency profiles

- Full dependency set: `core/requirements.txt`.
- Lightweight local profile: `core/requirements-lite.txt`.
- Local bootstrap prefers `uv` through `scripts/ensure-uv.sh` and `Makefile`.

## Frontend Stack (`frontend/`)

### Framework and build

- Next.js 14.1.4 with App Router structure under `frontend/src/app/`.
- React 18.2.0 and React DOM 18.2.0.
- TypeScript 5.4.3 with `frontend/tsconfig.json`.
- `frontend/next.config.js` injects `NEXT_PUBLIC_API_URL` from the repo root `.env`.

### UI and state

- Tailwind CSS 3.4.3 via `frontend/tailwind.config.js`.
- Radix primitives:
  - `@radix-ui/react-separator`
  - `@radix-ui/react-slot`
- Component utility stack:
  - `class-variance-authority`
  - `clsx`
  - `tailwind-merge`
- Theme handling via `next-themes`.
- Toasts via `sonner`.
- Server/client data layer via `@tanstack/react-query`.
- Client state via Zustand in `frontend/src/lib/stores/`.

### Current UI shape

- Marketing route group: `frontend/src/app/(marketing)/`.
- Console route group: `frontend/src/app/(console)/`.
- The active engineering console is centered on `frontend/src/components/chat/ai-console.tsx`.
- The console consumes streaming agent output and renders:
  - conversation history
  - interaction/clarification prompts
  - analysis results
  - markdown reports

## Tooling, QA, and Developer Workflow

- Root workflow is standardized through `Makefile`.
- Local startup orchestration:
  - `scripts/dev-up.sh`
  - `scripts/dev-down.sh`
  - `scripts/dev-status.sh`
  - `scripts/claw.sh`
- Sanity and regression entrypoints:
  - `scripts/check-startup.sh`
  - `scripts/check-backend-regression.sh`
  - `scripts/check-core-regression.sh`
- Backend tests use Jest from `backend/jest.config.cjs`.
- Frontend tests use Vitest + Testing Library from `frontend/vitest.config.ts` and `frontend/tests/`.
- Core quality gates are mostly contract/regression scripts rather than a deep in-repo pytest suite.

## Container and Deployment Stack

- `docker-compose.yml` defines a five-service stack:
  - `postgres`
  - `redis`
  - `backend`
  - `analysis-engine`
  - `frontend`
  - plus `nginx` as the reverse proxy
- Nginx config is mounted from `docker/nginx/nginx.conf`.
- Persistent volumes are declared for Postgres and Redis.
- Backend mounts `./uploads` into the container for generated artifacts and uploads.

## Configuration Surface

- Root `.env` is the shared source of truth for local startup.
- Backend config loader is `backend/src/config/index.ts`.
- Important backend knobs include:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `JWT_SECRET`
  - `LLM_PROVIDER`
  - `LLM_API_KEY`
  - `LLM_MODEL`
  - `LLM_BASE_URL`
  - `OPENAI_API_KEY`
  - `ZAI_API_KEY`
  - `ANALYSIS_ENGINE_URL`
  - `CORS_ORIGINS`
- Frontend public config is currently limited to `NEXT_PUBLIC_API_URL`.

## Practical Stack Notes

- The repo is polyglot but operationally simple: a Node API, a Python analysis engine, and a Next.js UI tied together with Docker Compose and shell scripts.
- Backend service boundaries are HTTP-first, not event-driven.
- The newest architectural pressure point is the agent/console path, where `backend/src/services/agent.ts`, `backend/src/api/chat.ts`, `docs/agent-stream-protocol.md`, and `frontend/src/components/chat/ai-console.tsx` now form a coherent product slice that should be treated as a first-class subsystem in future mapping and refactoring.
