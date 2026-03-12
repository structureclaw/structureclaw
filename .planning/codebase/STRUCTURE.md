# Codebase Structure

**Analysis Date:** 2026-03-12

## Top-Level Layout

```text
structureclaw/
├── backend/                  Fastify + Prisma API service
├── core/                     FastAPI structural analysis engine
├── frontend/                 Next.js application
├── scripts/                  local orchestration and regression scripts
├── docs/                     protocol, roadmap, and user-facing docs
├── .planning/codebase/       generated codebase map documents
├── .runtime/                 local process logs and pid files
├── uploads/                  generated artifacts such as reports
├── Makefile                  top-level developer command surface
├── docker-compose.yml        local infra/service orchestration
└── AGENTS.md                 repository-specific agent instructions
```

`backend/`, `core/`, and `frontend/` are separate applications. `scripts/` and `Makefile` are first-class operational code, not incidental helpers.

## `backend/`

### Role

`backend/` is the public API server and the main product orchestration layer. It owns:

- versioned REST/SSE contracts
- Prisma persistence
- Redis-backed caching with fallback behavior
- LLM-backed chat behavior
- agent tool orchestration and report generation

### Internal Layout

```text
backend/
├── src/
│   ├── api/                  route registration and request validation
│   ├── services/             business logic and orchestration
│   ├── utils/                infra helpers and shared adapters
│   ├── config/               env-driven config assembly
│   ├── types/                Fastify type augmentation
│   └── index.ts              server bootstrap
├── prisma/
│   ├── migrations/           migration history
│   ├── schema.prisma         database schema
│   └── seed.ts               seed logic
├── tests/                    Jest coverage for backend contracts/utilities
├── package.json
├── tsconfig.json
└── .eslintrc.cjs
```

### Important Files

- `backend/src/index.ts`: creates the Fastify instance, mounts plugins and routes, publishes `/health`.
- `backend/src/api/routes.ts`: central route registry under `/api/v1`.
- `backend/src/api/chat.ts`: chat and SSE transport.
- `backend/src/api/agent.ts`: execute-mode agent entrypoint and protocol endpoint.
- `backend/src/services/agent.ts`: orchestration-heavy core of the backend.
- `backend/src/services/chat.ts`: conversational LLM path with persistence.
- `backend/src/services/analysis.ts`: saved-analysis path bridging DB and Python core.
- `backend/src/config/index.ts`: environment normalization for ports, CORS, LLM provider, Redis, and engine URL.
- `backend/prisma/schema.prisma`: schema for users, projects, models, analyses, conversations, skills, and community.

### Placement Guidance

- New HTTP endpoints belong in `backend/src/api/<domain>.ts`.
- New route-invoked business logic belongs in `backend/src/services/<domain>.ts`.
- Shared infra code belongs in `backend/src/utils/`.
- New DB-backed features must update `backend/prisma/schema.prisma` and migration history.

## `core/`

### Role

`core/` is the Python engine for structure-model validation, conversion, analysis, and code-check/design behavior.

### Internal Layout

```text
core/
├── converters/               format adapters and registry
├── design/                   code check and basic design logic
├── fem/                      structural analysis implementations
├── regression/               golden regression cases
│   ├── static_2d/
│   └── static_3d/
├── schemas/                  canonical schema, examples, migrations
│   └── examples/
├── main.py                   FastAPI app and endpoint definitions
├── requirements.txt          full dependency profile
├── requirements-lite.txt     lighter local profile
└── Dockerfile
```

### Important Files

- `core/main.py`: publishes `/validate`, `/convert`, `/analyze`, `/code-check`, `/design/*`, and schema endpoints.
- `core/schemas/structure_model_v1.py`: canonical typed model used across converters and analyzers.
- `core/schemas/migrations.py`: schema-version migration helpers.
- `core/converters/registry.py`: supported converter registry.
- `core/converters/midas_text_v1_converter.py`: most format-specific adapter in the repo.
- `core/fem/static_analysis.py`: mature analysis path with OpenSeesPy and built-in solver fallbacks.
- `core/fem/dynamic_analysis.py` and `core/fem/seismic_analysis.py`: alternate analyzer entry points.
- `core/design/code_check.py`: deterministic code-check layer with traceability fields.

### Placement Guidance

- New canonical schema fields belong in `core/schemas/`.
- New import/export formats belong in `core/converters/` and then must be registered in `core/converters/registry.py`.
- New analysis families belong in `core/fem/`.
- New code-check or design logic belongs in `core/design/`.
- Any change to public engine payloads should be mirrored by script-based regression coverage in `scripts/`.

## `frontend/`

### Role

`frontend/` is the browser-facing application. It currently centers on the AI console workflow while also keeping a separate marketing route group.

### Internal Layout

```text
frontend/
├── src/
│   ├── app/
│   │   ├── (console)/        console route group
│   │   ├── (marketing)/      landing/marketing route group
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── providers.tsx
│   ├── components/
│   │   ├── chat/             console components
│   │   └── ui/               reusable UI primitives
│   └── lib/
│       ├── stores/           Zustand store setup and slices
│       ├── fonts.ts
│       ├── i18n.ts
│       └── utils.ts
├── tests/                    Vitest component/integration/style tests
├── scripts/
│   └── fs-rename-fallback.cjs
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── components.json
└── .eslintrc.json
```

### Important Files

- `frontend/src/app/layout.tsx`: top-level shell and metadata.
- `frontend/src/app/providers.tsx`: global providers for QueryClient, theme, toast, and store context.
- `frontend/src/app/(console)/console/page.tsx`: console page entry.
- `frontend/src/components/chat/ai-console.tsx`: main interactive feature surface.
- `frontend/src/lib/stores/context.tsx`: SSR-safe Zustand provider wiring.
- `frontend/src/lib/stores/slices/preferences.ts`: current store slice.

### Placement Guidance

- New pages/routes belong in `frontend/src/app/`.
- Shared UI belongs in `frontend/src/components/`.
- Design-system primitives belong in `frontend/src/components/ui/`.
- Shared client utilities and state helpers belong in `frontend/src/lib/`.
- Feature tests should land under `frontend/tests/` in the closest matching sub-area.

## `scripts/`

### Role

`scripts/` is the repository’s operational spine. These scripts do more than convenience work; they encode expected startup order and regression strategy.

### Structure

Key orchestration scripts:

- `scripts/claw.sh`: human-facing command hub.
- `scripts/dev-up.sh`: bootstraps infra and starts local services.
- `scripts/dev-down.sh`: tears down local services.
- `scripts/dev-status.sh`: process and health status.
- `scripts/check-startup.sh`: cross-stack startup verification.
- `scripts/ensure-uv.sh`: Python environment bootstrap helper.

Key regression/contract scripts:

- `scripts/check-backend-regression.sh`
- `scripts/check-core-regression.sh`
- `scripts/validate-agent-api-contract.sh`
- `scripts/validate-agent-orchestration.sh`
- `scripts/validate-agent-tools-contract.sh`
- `scripts/validate-chat-message-routing.sh`
- `scripts/validate-chat-stream-contract.sh`
- `scripts/validate-analyze-contract.sh`
- `scripts/validate-code-check-traceability.sh`
- `scripts/validate-converter-api-contract.sh`
- `scripts/validate-convert-roundtrip.sh`
- `scripts/validate-midas-text-converter.sh`
- `scripts/validate-schema-migration.sh`
- `scripts/validate-structure-examples.sh`
- `scripts/validate-static-regression.sh`
- `scripts/validate-static-3d-regression.sh`
- `scripts/validate-convert-batch.sh`
- `scripts/validate-convert-passrate.sh`
- `scripts/validate-report-template-contract.sh`

Batch tooling:

- `scripts/convert-batch.py`: bulk conversion/reporting helper for model conversion workflows.

### Placement Guidance

- New cross-stack checks should be added here, not hidden inside ad hoc local commands.
- If a backend/core contract changes, the corresponding `validate-*` script should usually be updated in the same change.

## `docs/`

### Role

`docs/` contains product and protocol documents tied to the implemented system.

Current notable files:

- `docs/agent-stream-protocol.md`: SSE event contract for execute-mode streaming.
- `docs/development-roadmap.md`: as-is/to-be roadmap and quality gates.
- `docs/user-manual.md`: user-facing documentation.

These are reference docs, not generated artifacts, so changes here should track actual implemented behavior.

## Other Important Top-Level Areas

### `.planning/codebase/`

Generated repository maps used by orchestration and planning workflows. Multiple workers may update different docs here concurrently, so ownership discipline matters.

### `.runtime/`

Local-only runtime state written by dev scripts:

- pid files
- service logs
- current session process metadata

### `uploads/`

Artifact output area used by backend report generation and similar runtime outputs. This is operational state, not source code.

### `docker-compose.yml`

Defines the local composed environment, especially PostgreSQL and Redis, and complements script-driven local startup.

### `Makefile`

The stable top-level command surface:

- `make doctor`
- `make start`
- `make stop`
- `make status`
- `make core-regression`
- `make backend-regression`

When onboarding or automating locally, start here before dropping to raw scripts.

## Source-of-Truth Files by Concern

### API surface

- `backend/src/api/routes.ts`
- `backend/src/api/*.ts`
- `core/main.py`

### Domain model

- `core/schemas/structure_model_v1.py`
- `backend/prisma/schema.prisma`

### Agent protocol

- `backend/src/services/agent.ts`
- `backend/src/api/agent.ts`
- `docs/agent-stream-protocol.md`
- `scripts/validate-agent-*.sh`

### Startup and developer workflow

- `Makefile`
- `scripts/claw.sh`
- `scripts/dev-up.sh`
- `scripts/check-startup.sh`

## Extension Map

For common work, add code in these locations:

- New backend resource: `backend/src/api/` + `backend/src/services/` + Prisma if persistent.
- New engine analysis feature: `core/fem/` + `core/main.py` dispatch + regression script/case.
- New converter: `core/converters/` + `core/converters/registry.py` + conversion validation script.
- New frontend workflow: `frontend/src/app/` route + `frontend/src/components/` feature code + `frontend/tests/`.
- New operational guarantee: `scripts/validate-*.sh` and possibly `Makefile`.

## Structural Hotspots

The repo is broad, but a few directories dominate change impact:

- `backend/src/services/`
- `core/schemas/`
- `core/fem/`
- `frontend/src/components/chat/`
- `scripts/`

If a change crosses one of these hotspots and a public contract, assume follow-on updates are needed in docs and regression scripts.
