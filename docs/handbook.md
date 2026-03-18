# StructureClaw Handbook

## 1. Purpose

This handbook is the practical guide for running, developing, validating, and extending StructureClaw.

Use this file for day-to-day engineering work. Use `docs/reference.md` for protocol-level details.

## 2. Project Scope

StructureClaw is an AI-assisted structural engineering platform with a monorepo architecture:

- `frontend`: Next.js 14 product and console UI
- `backend`: Fastify + Prisma API and agent orchestration
- `core`: FastAPI structural analysis engine (validation, conversion, analyze, code-check)

Primary workflow:

```text
natural language -> draft model -> validate -> analyze -> code-check -> report
```

## 3. Prerequisites

Recommended:

- Docker Engine / Docker Desktop
- Docker Compose v2

For local source development:

- Node.js 18+
- Python 3.11
- PostgreSQL 14+
- Redis 7+ (optional)

## 4. Repository Structure

```text
frontend/   Next.js application
backend/    Fastify API, Prisma schema, tests
core/       FastAPI engine, schemas, converters, FEM, regressions
scripts/    startup scripts and contract/regression validators
docs/       handbook and protocol reference
uploads/    generated report artifacts
```

## 5. Getting Started

### 5.1 Recommended path

```bash
make doctor
make start
make status
```

### 5.2 Common lifecycle commands

```bash
make logs
make stop
make restart
```

### 5.3 CLI alternative

```bash
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs all --follow
./sclaw stop
```

## 6. Environment and Configuration

Start with `.env.example`.

Important variables:

- Runtime: `NODE_ENV`, `PORT`, `FRONTEND_PORT`, `CORE_PORT`
- Data: `DATABASE_URL`, `REDIS_URL`
- LLM: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- Integration: `ANALYSIS_ENGINE_URL`, `CORS_ORIGINS`

Notes:

- `REDIS_URL=disabled` enables in-memory fallback mode in backend.
- `ANALYSIS_ENGINE_URL` can be omitted and derived from `CORE_PORT`.

## 7. Core Workflows

### 7.1 Chat and Agent execution

Main backend endpoints:

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`
- `POST /api/v1/agent/run`

Execution chain:

`text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

### 7.2 Analysis engine

Main core endpoints:

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`

## 8. StructureModel Governance

- Required baseline: `schema_version: "1.0.0"`
- Keep strict field naming for nodes/elements/materials/sections/loads
- Always validate models before analyze/code-check where possible

## 9. Skill and No-Skill Behavior

- Skills are enhancement layers, not a hard dependency for the full workflow.
- If selected skills do not match the request, fallback uses generic no-skill modeling.
- New user-visible copy must be provided in both English and Chinese.

## 10. Quality and Regression

### 10.1 Backend

```bash
npm run build --prefix backend
npm run lint --prefix backend
npm test --prefix backend -- --runInBand
```

### 10.2 Frontend

```bash
npm run build --prefix frontend
npm run type-check --prefix frontend
npm run test:run --prefix frontend
```

### 10.3 Core and contracts

```bash
make core-regression
make backend-regression
```

Useful targeted validators:

- `./scripts/validate-agent-orchestration.sh`
- `./scripts/validate-agent-tools-contract.sh`
- `./scripts/validate-chat-stream-contract.sh`
- `./scripts/validate-analyze-contract.sh`

## 11. Contributing Workflow

1. Create focused, small-scope changes.
2. Keep module boundaries intact.
3. Run targeted tests and required regression scripts.
4. Use clear conventional commit messages.
5. Document behavior changes in handbook/reference when needed.

Contribution details: `CONTRIBUTING.md`.

## 12. Troubleshooting

- If startup fails, run `make doctor` first.
- If DB-related tests fail locally, verify PostgreSQL connectivity from `DATABASE_URL`.
- If LLM flow degrades unexpectedly, confirm `LLM_PROVIDER` and API key env variables.
- If contracts fail, run the corresponding `scripts/validate-*.sh` script directly for focused diagnostics.

## 13. Related Documents

- Protocol reference: `docs/reference.md`
- Chinese handbook: `docs/handbook_CN.md`
- Chinese protocol reference: `docs/reference_CN.md`
- English overview: `README.md`
- Chinese overview: `README_CN.md`
