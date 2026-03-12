# Architecture

**Analysis Date:** 2026-03-12

## System Shape

StructureClaw is a polyglot three-application system with local orchestration around it:

- `frontend/`: Next.js 14 App Router UI for the AI console and marketing shell.
- `backend/`: Fastify API that owns HTTP contracts, persistence, LLM/chat behavior, and agent orchestration.
- `core/`: FastAPI analysis engine that owns structural model validation, format conversion, analysis, and code-check/design logic.
- `scripts/` and `Makefile`: developer workflow, process supervision, environment bootstrap, and regression entry points.
- `docs/`: product and protocol documentation that mirrors the implemented contracts.

The highest-value architectural boundary is:

`frontend` -> HTTP/SSE -> `backend` -> HTTP -> `core`

The backend is not a passive proxy. It contains domain logic, routing decisions, persistence, and report generation. The Python core is a compute/validation service with a narrower contract surface.

## Primary Entry Points

### Frontend

- `frontend/src/app/layout.tsx`: root HTML shell, fonts, providers wiring.
- `frontend/src/app/providers.tsx`: initializes React Query, Zustand provider, theme provider, and toast host.
- `frontend/src/app/(console)/console/page.tsx`: console route that renders the AI console.
- `frontend/src/app/(marketing)/page.tsx`: landing/marketing route group entry.

### Backend

- `backend/src/index.ts`: Fastify bootstrap, plugin registration, Swagger, `/health`, graceful shutdown.
- `backend/src/api/routes.ts`: mounts all versioned route modules under `/api/v1`.

### Core

- `core/main.py`: FastAPI bootstrap and all published engine endpoints.

### Operations

- `Makefile`: top-level command hub used by contributors.
- `scripts/claw.sh`: beginner-friendly command hub for `doctor/start/status/stop/logs`.
- `scripts/dev-up.sh`: local process manager for frontend/backend/core plus optional infra bootstrap.
- `scripts/check-startup.sh`: cross-stack verification and regression gate.

## Runtime Layers

### 1. Presentation Layer

The UI is contained under `frontend/src/` and is currently centered on one main workflow: the AI console in `frontend/src/components/chat/ai-console.tsx`.

Responsibilities:

- Render the chat/execution console and result panels.
- Maintain client-side archived conversations in `localStorage`.
- Parse streamed backend events into UI state.
- Collect optional model JSON and execution options before backend submission.

State composition:

- React local state handles console interaction and streamed message/result state.
- React Query is provisioned globally in `frontend/src/app/providers.tsx`, but the current console logic is mostly manual fetch/state driven.
- Zustand store in `frontend/src/lib/stores/context.tsx` and `frontend/src/lib/stores/slices/preferences.ts` is used for app preferences and SSR-safe shared state.

### 2. API / Orchestration Layer

The Fastify application in `backend/src/` owns the public product contract.

Key route modules:

- `backend/src/api/chat.ts`
- `backend/src/api/agent.ts`
- `backend/src/api/analysis.ts`
- `backend/src/api/project.ts`
- `backend/src/api/skill.ts`
- `backend/src/api/user.ts`
- `backend/src/api/community.ts`

Key service modules:

- `backend/src/services/chat.ts`: conversational LLM path with persisted messages and LangChain memory.
- `backend/src/services/agent.ts`: execute-mode orchestration, missing-parameter interaction, tool-call telemetry, report assembly, artifact writing.
- `backend/src/services/analysis.ts`: persisted model/analysis CRUD plus calls into the core engine.
- `backend/src/services/project.ts`, `user.ts`, `skill.ts`, `community.ts`: CRUD/domain surfaces around the Prisma data model.

Patterns in this layer:

- Request validation is done in route modules with `zod`.
- Business logic is kept in service classes instead of route handlers.
- Infra access is centralized in utils/config modules:
  - `backend/src/config/index.ts`
  - `backend/src/utils/database.ts`
  - `backend/src/utils/redis.ts`
  - `backend/src/utils/llm.ts`
  - `backend/src/utils/logger.ts`
  - `backend/src/utils/llm-error.ts`

### 3. Compute / Domain Engine Layer

The Python service in `core/` is a contract-driven engine with these published responsibilities:

- Schema validation via `POST /validate`
- Format normalization and conversion via `POST /convert`
- Analysis execution via `POST /analyze`
- Code check via `POST /code-check`
- Simple section design endpoints such as `POST /design/beam`
- Contract introspection via `GET /schema/structure-model-v1` and `GET /schema/converters`

Its internal modules are partitioned by concern:

- `core/schemas/`: canonical data model and migration helpers.
- `core/converters/`: format adapter layer and registry.
- `core/fem/`: analyzers and fallback solvers.
- `core/design/`: code-check and sizing/design helpers.
- `core/regression/`: golden input cases used by shell-scripted regression checks.

### 4. Persistence / Cache Layer

Persistent and ephemeral state are split intentionally:

- PostgreSQL via Prisma stores users, projects, structural models, analyses, conversations, messages, skills, and community entities.
- Redis caches selected backend objects and execution state where available.
- The backend explicitly supports degraded operation when Redis is disabled through `REDIS_URL=disabled`.

Main schema source:

- `backend/prisma/schema.prisma`

Important persisted entities:

- `Conversation` and `Message` support chat history.
- `StructuralModel` and `Analysis` support saved engineering artifacts.
- `Project`, `Skill`, `Post`, `Comment`, and related join tables support the broader platform surface.

## Data Flow

### Chat Flow

1. The user sends a message from `frontend/src/components/chat/ai-console.tsx`.
2. The frontend calls `POST /api/v1/chat/message` or `POST /api/v1/chat/stream`.
3. `backend/src/api/chat.ts` decides whether the request stays in chat mode or escalates to execute mode.
4. For pure chat:
   - `backend/src/services/chat.ts` loads or creates a `Conversation`.
   - LangChain `ConversationChain` uses the configured model from `backend/src/utils/llm.ts`.
   - User and assistant messages are persisted through Prisma.
5. The frontend renders either the full response or streamed tokens/events.

### Execute / Agent Flow

1. The frontend submits execute intent through `POST /api/v1/agent/run` or `POST /api/v1/chat/stream` with `mode=execute|auto`.
2. `backend/src/services/agent.ts` determines whether enough model/parameter context exists.
3. If information is missing, the agent returns structured `interaction` payloads instead of hard-failing.
4. When ready, the backend runs a tool chain around these logical steps:
   - `text-to-model-draft`
   - `convert`
   - `validate`
   - `analyze`
   - `code-check`
   - `report`
5. Conversion, validation, analysis, and code-check steps call `core/main.py` over HTTP using `axios`.
6. The backend aggregates tool timing, outputs, summary response text, and optional report artifacts under `uploads/reports`.
7. The frontend renders tool outcome, analysis summary, and markdown report panels.

### Saved Analysis Flow

1. Backend model/analysis routes call `backend/src/services/analysis.ts`.
2. Structural model JSON is saved in PostgreSQL as `Json` columns.
3. Redis caches some model lookups.
4. `runAnalysis()` posts a normalized structure payload to `POST /analyze` on the core service.
5. Results are written back to the `Analysis` record.

## Contract Boundaries

### Frontend to Backend

The backend is the sole browser-facing API surface. The frontend does not call the Python engine directly.

Notable public contracts:

- `/api/v1/chat/message`
- `/api/v1/chat/stream`
- `/api/v1/chat/execute`
- `/api/v1/agent/run`
- `/api/v1/agent/tools`
- `/api/v1/analysis/*`

The SSE behavior for execute-mode chat is documented in `docs/agent-stream-protocol.md` and implemented in `backend/src/api/chat.ts`.

### Backend to Core

The backend treats the Python service as a domain engine with explicit, narrow endpoints:

- `/validate`
- `/convert`
- `/analyze`
- `/code-check`
- `/schema/structure-model-v1`
- `/schema/converters`

This keeps Python-specific implementation details out of the browser-facing contract and lets backend services enrich responses with persistence, interaction state, and report packaging.

## Canonical Model and Format Strategy

The central data contract is `StructureModelV1` in `core/schemas/structure_model_v1.py`.

Important consequences:

- The core validates cross-reference integrity between nodes, elements, materials, and sections.
- Converters normalize foreign formats into V1 first, then export from V1 to target formats.
- Backend agent execution assumes V1-compatible model exchange when talking to the core.
- Migration helpers in `core/schemas/migrations.py` are the place to evolve schema versions without fragmenting downstream tools.

This is the strongest architectural seam in the repository and the right extension point for future model-centric work.

## Failure and Degradation Strategy

Several subsystems are designed to degrade instead of stop the entire stack:

- Missing Redis: backend falls back away from Redis-backed behavior.
- Missing LLM key: chat returns a deterministic fallback message rather than crashing the API.
- Missing OpenSeesPy: `core/fem/static_analysis.py` falls back to simplified built-in solvers and finally a zero-result mode.
- Invalid models or unknown formats: the core returns structured 4xx responses with error codes, not opaque failures.
- Execute-mode missing parameters: agent returns clarification/interaction state instead of generic errors.

This is deliberate: the repo prioritizes operability and contract continuity over perfect feature availability in every environment.

## Directory-Level Layering Rules

### Backend

- `backend/src/api/`: transport and request validation.
- `backend/src/services/`: orchestration and domain behavior.
- `backend/src/utils/`: infrastructure adapters and shared helpers.
- `backend/src/config/`: environment-driven configuration.
- `backend/prisma/`: database schema, migration history, and seed.

Route files should not absorb business logic that belongs in services.

### Core

- `core/main.py`: HTTP boundary only.
- `core/schemas/`: canonical types.
- `core/converters/`: format adapters around canonical types.
- `core/fem/`: analysis implementations.
- `core/design/`: code and design checks.

Domain logic should stay out of `core/main.py` beyond endpoint dispatch and response shaping.

### Frontend

- `frontend/src/app/`: route tree and layouts.
- `frontend/src/components/`: reusable view components.
- `frontend/src/lib/`: state, utilities, fonts, i18n helpers.

The console UI currently concentrates a lot of feature logic in `frontend/src/components/chat/ai-console.tsx`; that file is effectively the frontend application shell for execution workflows.

## Operational Architecture

Local development assumes a script-managed, multi-process environment:

- `scripts/dev-up.sh` installs dependencies, prepares Python envs, optionally starts Docker infra, runs Prisma init, and launches frontend/backend/core into `.runtime/`.
- `scripts/dev-down.sh` and `scripts/dev-status.sh` manage local process lifecycle.
- `scripts/check-startup.sh` composes backend, frontend, and core verification into one gate.
- `scripts/check-backend-regression.sh` and `scripts/check-core-regression.sh` further divide stack-specific validation.

The repo therefore has two parallel architectures:

- product runtime architecture across frontend/backend/core
- contributor workflow architecture across scripts/Make targets/regression suites

Both matter when changing contracts or startup behavior.

## Architectural Hotspots

These files currently carry disproportionate system weight:

- `backend/src/services/agent.ts`: agent protocol, orchestration policy, interaction model, reporting, and core integration.
- `backend/src/api/chat.ts`: mode switching between conversational and execute paths plus SSE handling.
- `core/main.py`: engine contract surface and endpoint dispatch.
- `core/fem/static_analysis.py`: most mature analysis implementation plus fallback solver behavior.
- `frontend/src/components/chat/ai-console.tsx`: primary end-user workflow composition.

Changes in these files tend to have cross-cutting impact and should be paired with contract/regression updates.
