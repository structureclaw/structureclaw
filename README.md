# StructureClaw

[中文说明](./README_CN.md)

> An AI-assisted structural engineering workspace for AEC workflows.

## Overview

StructureClaw is a monorepo that combines a conversational frontend, an orchestration backend, and a structural analysis engine. The project is designed to connect a practical engineering loop:

- natural-language request intake
- model drafting, conversion, and validation
- structural analysis and code checking
- report generation with execution traceability

The repository is currently an engineering MVP suitable for local development, service integration, regression validation, and iterative product work.

## Repository Layout

```text
structureclaw/
├── frontend/              # Next.js 14 web app
├── backend/               # Fastify API + agent orchestration
├── core/                  # FastAPI analysis engine
├── docker/                # Nginx and container-related config
├── docs/                  # Product and engineering documentation
├── scripts/               # Dev, validation, and regression scripts
├── .env.example           # Shared environment example
├── Makefile               # Main developer entrypoints
└── docker-compose.yml
```

## Architecture

```text
Browser / UI
  -> /api/v1/chat/message | /stream | /execute or /api/v1/agent/run
  -> backend AgentService
  -> core /validate /convert /analyze /code-check
  -> reports, metrics, artifacts
```

Main components:

- `frontend`: Next.js 14, React 18, Tailwind CSS, conversational `/console` workspace
- `backend`: Fastify, Prisma, PostgreSQL, optional Redis, agent/chat routing
- `core`: FastAPI, Python 3.11+, structure model validation/conversion/analysis

## Key Capabilities

- Conversational engineering workflow with chat-first analysis execution
- Agent orchestration loop for `draft -> convert -> validate -> analyze -> code-check -> report`
- Chat and execute API modes, including SSE streaming
- Conversation-scoped clarification and context continuation
- Observable execution metadata such as `traceId`, timestamps, and duration
- JSON / Markdown report output, with file output support under `uploads/reports`

## Requirements

Recommended:

- Docker Engine / Docker Desktop
- Docker Compose v2

For local source development:

- Node.js 18+
- Python 3.11
- PostgreSQL 14+
- Redis 7+ optional
- `curl` or `wget` for the initial `uv` bootstrap

## Quick Start

The default local path is:

```bash
make doctor
make start
make status
```

Useful commands:

- `make stop`
- `make logs`
- `make backend-regression`
- `make core-regression`

You can also use the project CLI:

```bash
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs all --follow
./sclaw stop
```

To install `sclaw` globally:

```bash
make sclaw-install
```

## How To Submit A New Skill

StructureClaw supports two submission paths:

1. Baseline skill (in-repo, via PR)
2. SkillHub extension (external, on-demand install)

### Path A: Baseline Skill (PR to this repo)

Use this path only for core/common capabilities that should ship by default.

Minimum checklist:

- Add a new skill folder under [backend/src/agent-skills](backend/src/agent-skills)
- Provide `manifest.ts`, `handler.ts`, and stage markdown files (`intent.md`, `draft.md`, `analysis.md`, `design.md` when applicable)
- Include required metadata fields in manifest: `domain`, `requires`, `conflicts`, `capabilities`, `priority`, `compatibility.minCoreVersion`, `compatibility.skillApiVersion`
- Keep user-facing text bilingual (`en` + `zh`)
- Run regression scripts before opening PR

Recommended validation:

```bash
npm run build --prefix backend
./scripts/validate-agent-skills-contract.sh
./scripts/validate-agent-capability-matrix.sh
```

### Path B: SkillHub Extension (recommended for long-tail features)

Use this path for optional or domain-specific skills that should not be bundled into this repository.

Current status note:

- The SkillHub workflow (`search/install/enable/disable/uninstall`) is already implemented end-to-end.
- The current catalog entries are example/demo entries used to validate contracts and UX flows.
- Real external repository-backed package distribution is the next implementation step.

Current SkillHub workflow:

- Search: `./scripts/claw.sh skill search <keyword> [domain]`
- Install: `./scripts/claw.sh skill install <skill-id>`
- Enable: `./scripts/claw.sh skill enable <skill-id>`
- Disable: `./scripts/claw.sh skill disable <skill-id>`
- Uninstall: `./scripts/claw.sh skill uninstall <skill-id>`
- List installed: `./scripts/claw.sh skill list`

Current SkillHub API contract (backend):

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`

Note:

- Baseline skills remain in-repo and always available.
- SkillHub extensions are designed to be distributed externally (Git/release/service registry) and loaded on demand.

## Environment

The root `.env` is shared by frontend, backend, local scripts, and Docker Compose.

Typical variables:

```bash
NODE_ENV=development
HOST=0.0.0.0
PORT=30010
FRONTEND_PORT=30000
CORE_PORT=30011
NEXT_PUBLIC_API_URL=http://localhost:30010
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/structureclaw
REDIS_URL=disabled
PGADMIN_DEFAULT_EMAIL=admin@structureclaw.dev
PGADMIN_DEFAULT_PASSWORD=structureclaw
PGADMIN_PORT=5050
LLM_PROVIDER=zhipu
LLM_API_KEY=
LLM_MODEL=glm-5
LLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
```

Notes:

- `REDIS_URL=disabled` enables in-memory fallback mode in the backend.
- `PGADMIN_PORT` controls the local pgAdmin entrypoint. By default, open `http://localhost:5050`.
- `PGADMIN_ENABLED=false` skips pgAdmin startup during `make start` while keeping PostgreSQL startup intact.
- pgAdmin is intended for local development and test environments only.
- `ANALYSIS_ENGINE_URL` can be left blank and derived from `CORE_PORT`.
- `CORS_ORIGINS` can be left blank and derived from `FRONTEND_PORT` and `PORT`.

## Database Admin

For local PostgreSQL inspection, the repository now includes pgAdmin in the Docker stack.

Quick start:

```bash
docker compose up -d postgres pgadmin
```

Or use the standard local flow:

```bash
make start
```

Then open:

- pgAdmin: `http://localhost:5050` (or the port configured through `PGADMIN_PORT`)
- Console entry page: `/console/database`

The default pgAdmin server list already includes the compose `postgres` service as `StructureClaw PostgreSQL`.

If the Docker registry is slow or blocked in your environment, `make start` will now continue without pgAdmin and print a warning. You can retry later with:

```bash
docker compose up -d pgadmin
```

## Main Endpoints

Backend:

- `GET /health`
- `GET /docs`
- `POST /api/v1/agent/run`
- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`

Core:

- `GET /health`
- `GET /schema/converters`
- `POST /convert`
- `POST /validate`
- `POST /analyze`
- `POST /code-check`

## Documentation

- [User Manual](./docs/user-manual.md)
- [Development Roadmap](./docs/development-roadmap.md)
- [Agent Stream Protocol](./docs/agent-stream-protocol.md)
- [Tech Stack](./TECH_STACK.md)

## Status

This repository is positioned as a working MVP rather than a finished product. The current codebase is intended to be usable for:

- local multi-service development
- interface and contract validation
- backend/core regression checks
- iterative product and workflow refinement

## License

MIT. See `LICENSE`.
