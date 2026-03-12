# External Integrations

**Analysis Date:** 2026-03-12
**Scope:** runtime integrations, cross-service contracts, external providers, operational dependencies

## Integration Topology

- `frontend/` talks to `backend/` over HTTP using `NEXT_PUBLIC_API_URL` from `frontend/next.config.js`.
- `backend/` talks to:
  - PostgreSQL through Prisma in `backend/src/utils/database.ts`
  - Redis through `ioredis` in `backend/src/utils/redis.ts`
  - the Python analysis engine over HTTP from `backend/src/services/agent.ts`
  - external LLM providers through the LangChain OpenAI-compatible client in `backend/src/utils/llm.ts`
- `core/` exposes engineering endpoints consumed by the backend agent and analysis routes.
- `docker-compose.yml` wires the local default network and service hostnames.

## Frontend -> Backend

### Base URL and transport

- The browser client resolves the API base from `NEXT_PUBLIC_API_URL`.
- Default local value is `http://localhost:8000` in both `frontend/next.config.js` and `frontend/src/components/chat/ai-console.tsx`.
- The frontend currently uses fetch/SSE patterns in the console rather than a generated client SDK.

### Active user-facing integration points

- Console page entrypoint: `frontend/src/app/(console)/console/page.tsx`
- Main console component: `frontend/src/components/chat/ai-console.tsx`
- Providers stack: `frontend/src/app/providers.tsx`

### Backend endpoints the UI is designed around

- Chat flow:
  - `POST /api/v1/chat/message`
  - `POST /api/v1/chat/stream`
  - `POST /api/v1/chat/conversation`
  - `GET /api/v1/chat/conversation/:id`
  - `GET /api/v1/chat/conversations`
- Agent flow:
  - `GET /api/v1/agent/tools`
  - `POST /api/v1/agent/run`
- Analysis/project/community routes are also registered from `backend/src/api/routes.ts`, but the current console refresh is centered on chat and agent execution.

### Streaming protocol

- Streaming transport is POST-based SSE from `backend/src/api/chat.ts`.
- Reference contract is maintained in `docs/agent-stream-protocol.md`.
- Event types currently documented and handled:
  - `start`
  - `interaction_update`
  - `result`
  - `done`
  - `error`
- The frontend parses incremental frames because native `EventSource` does not support POST.

## Backend -> Core Analysis Engine

### Connection model

- Client is an Axios instance in `backend/src/services/agent.ts`.
- Base URL comes from `ANALYSIS_ENGINE_URL` in `backend/src/config/index.ts`.
- Default local URL is `http://localhost:8001`.
- Docker Compose points backend to `http://analysis-engine:8001`.

### Core endpoints currently relied on

- `POST /validate`
  - validates and summarizes a structural model
- `POST /convert`
  - normalizes supported formats into the repo’s schema path
- `POST /analyze`
  - executes `static`, `dynamic`, `seismic`, or `nonlinear` analysis
- `POST /code-check`
  - runs code compliance checks
- `POST /design/beam`
  - concrete beam sizing endpoint
- `POST /design/column`
  - concrete column sizing endpoint
- `GET /schema/structure-model-v1`
  - exposes JSON schema for the native model
- `GET /schema/converters`
  - exposes supported converter formats

### Contract sources

- Service implementation: `core/main.py`
- Conversion registry: `core/converters/registry.py`
- Schema definition: `core/schemas/structure_model_v1.py`
- Validation scripts:
  - `scripts/validate-analyze-contract.sh`
  - `scripts/validate-converter-api-contract.sh`
  - `scripts/validate-convert-roundtrip.sh`
  - `scripts/validate-schema-migration.sh`

### Behavior to remember

- The backend agent composes multi-step runs around core tools such as `convert`, `validate`, `analyze`, `code-check`, and `report`.
- Missing Redis does not block agent execution because session caching falls back to in-memory state in `backend/src/utils/redis.ts`.
- Missing LLM credentials do not remove the agent endpoint, but they constrain the orchestration path to rule-based behavior or failure paths depending on the request.

## Backend -> LLM Providers

### Supported provider modes

- `openai`
- `zhipu`
- `openai-compatible`

Provider selection is normalized in `backend/src/config/index.ts`.

### Implementation details

- Model factory: `backend/src/utils/llm.ts`
- Downstream users:
  - `backend/src/services/chat.ts`
  - `backend/src/services/agent.ts`
- The integration is intentionally OpenAI-compatible even for non-OpenAI providers because it runs through `@langchain/openai`.

### Credentials and defaults

- Common fields:
  - `LLM_PROVIDER`
  - `LLM_API_KEY`
  - `LLM_MODEL`
  - `LLM_BASE_URL`
  - `LLM_TIMEOUT_MS`
  - `LLM_MAX_RETRIES`
- OpenAI compatibility path:
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `OPENAI_BASE_URL`
- Zhipu compatibility path:
  - `ZAI_API_KEY`
  - default model `glm-4-plus`
  - default base URL `https://open.bigmodel.cn/api/paas/v4/`
- OpenAI default base URL is `https://api.openai.com/v1`.

### Why this matters

- Recent backend changes made provider selection a first-class config path rather than a single-provider assumption.
- The chat and agent APIs should therefore be treated as provider-agnostic at the HTTP contract level, while runtime behavior still depends on key availability and remote API latency.

## Backend -> PostgreSQL

- Prisma datasource is defined in `backend/prisma/schema.prisma`.
- Connection string is `DATABASE_URL`.
- Local Docker default from `docker-compose.yml` is `postgresql://postgres:postgres@postgres:5432/structureclaw`.
- Local non-Docker default in config is `postgresql://postgres:postgres@localhost:5432/structureclaw`.
- Migration and bootstrap commands:
  - `npm run db:migrate --prefix backend`
  - `npm run db:deploy --prefix backend`
  - `npm run db:seed --prefix backend`
  - `npm run db:init --prefix backend`

## Backend -> Redis

- Client wrapper: `backend/src/utils/redis.ts`
- Primary use: lightweight cache/session state for agent interaction flow
- Env key: `REDIS_URL`
- Docker default: `redis://redis:6379`
- Local disable mode: set `REDIS_URL=disabled`
- Failure mode: graceful fallback to process-local `Map`, which keeps development usable but removes cross-process/session durability

## File System and Artifact Integrations

- Upload/artifact root is controlled by `UPLOAD_DIR` in `backend/src/config/index.ts`.
- Default path is `./uploads`.
- Docker mounts `./uploads:/app/uploads` for persistence from the host.
- Agent report generation in `backend/src/services/agent.ts` can emit inline results or file artifacts depending on `reportOutput`.

## Container and Infra Integrations

- `docker-compose.yml` provisions:
  - `postgres:15-alpine`
  - `redis:7-alpine`
  - backend from `backend/Dockerfile`
  - analysis engine from `core/Dockerfile`
  - frontend from `frontend/Dockerfile`
  - `nginx:alpine`
- Nginx config is mounted from `docker/nginx/nginx.conf`.
- Service discovery is container-name/network based inside the compose network `structureclaw-network`.

## Scripted Verification and Operational Hooks

- Startup and regression orchestration:
  - `scripts/check-startup.sh`
  - `scripts/check-backend-regression.sh`
  - `scripts/check-core-regression.sh`
- Agent/chat contract checks:
  - `scripts/validate-agent-api-contract.sh`
  - `scripts/validate-agent-tools-contract.sh`
  - `scripts/validate-agent-orchestration.sh`
  - `scripts/validate-chat-stream-contract.sh`
  - `scripts/validate-chat-message-routing.sh`
- Core conversion and regression checks:
  - `scripts/validate-convert-batch.sh`
  - `scripts/validate-convert-passrate.sh`
  - `scripts/validate-midas-text-converter.sh`
  - `scripts/validate-static-regression.sh`
  - `scripts/validate-static-3d-regression.sh`

These scripts are part of the integration story because they codify the expected contracts between services rather than only testing isolated functions.

## Observability and Access Patterns

- Backend health endpoint in `backend/src/index.ts` checks:
  - database connectivity with Prisma raw SQL
  - Redis reachability with `ping()`
- Core health endpoint is `GET /health` in `core/main.py`.
- Frontend health is probed operationally via HTTP checks in `scripts/dev-status.sh`.
- API docs are exposed from the backend at `/docs` through Swagger UI.

## Not Present

- No third-party auth provider integration is wired yet despite JWT library presence.
- No message queue, event bus, or webhook infrastructure is present.
- No cloud object storage integration is configured; artifact persistence is local filesystem only.
- No dedicated observability SaaS integration is visible for traces, metrics, or error capture.

## Practical Integration Notes

- The repo is still an internal-service monolith split across HTTP boundaries, not a distributed platform.
- The highest-value integration surface today is the console-to-agent-to-core execution chain:
  - `frontend/src/components/chat/ai-console.tsx`
  - `backend/src/api/chat.ts`
  - `backend/src/services/agent.ts`
  - `core/main.py`
- If that chain changes, the docs in `docs/agent-stream-protocol.md` and the shell contract checks in `scripts/validate-*.sh` need to be updated in lockstep.
