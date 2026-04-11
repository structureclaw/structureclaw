# StructureClaw Agent Guide

## Repository Snapshot
- `backend/`: Fastify + Prisma API service. Route handlers live in `src/api`, orchestration and domain logic live in `src/services`, infrastructure helpers live in `src/utils`. Backend-hosted analysis runtime lives under `src/agent-skills/analysis-execution`.
- `frontend/`: Next.js 14 app. App routes live under `src/app`, reusable UI in `src/components`, client state and i18n helpers in `src/lib`.
- `scripts/cli/`: internal implementation for the `sclaw` command surface. Prefer `./sclaw ...` over calling script paths directly.
- `tests/`: regression suite, install smoke, and `node tests/runner.mjs` entrypoint.
- `docs/`: user-facing and protocol documentation such as the stream protocol and roadmap.

## Working Rules
- Preserve module boundaries. New API surface belongs in `backend/src/api`; coordination logic belongs in `backend/src/services`; shared helpers belong in `backend/src/utils`.
- Keep frontend changes localized. Route/layout concerns belong in `frontend/src/app`, reusable components in `frontend/src/components`, and cross-cutting client logic in `frontend/src/lib`.
- Bilingual support is mandatory for every new user-visible feature. New UI copy, empty states, errors, prompts, templates, guidance text, and report-facing labels must ship in both `en` and `zh`.
- Do not add new single-language user-facing flows. If a feature produces user-visible text from backend chat, agent, or report paths, the implementation must include locale propagation and locale-aware backend templates in the same change.
- Treat the frontend locale as the single source of truth for new interactions. Once a user selects a language, all newly generated user-visible text in that interaction must follow that locale without mixing languages.
- Keep analysis-runtime changes deterministic. Structural examples, regression fixtures, and converters should remain scriptable and reproducible.
- Commit discipline is mandatory: make small, logical commits as you go, and do it promptly.
- Do not wait until the end of a long task to bundle unrelated work into one commit.
- When a task naturally splits into implementation, tests, docs, or follow-up cleanup, prefer separate commits with clear boundaries.

## Build, Run, and Verify
- Preferred local health flow:
 - `./sclaw doctor`
 - `./sclaw start`
 - `node tests/runner.mjs analysis-regression`
- Useful lifecycle commands:
 - `./sclaw start`, `./sclaw restart`
 - `./sclaw stop`
 - `./sclaw status`
 - `./sclaw logs`
- Backend:
  - `npm run build --prefix backend`
  - `npm run lint --prefix backend`
  - `npm test --prefix backend -- --runInBand`
- Frontend:
  - `npm run build --prefix frontend`
  - `npm run type-check --prefix frontend`
  - `npm run test:run --prefix frontend`
- Analysis and contract validation (via `tests/runner.mjs`):
  - `node tests/runner.mjs analysis-regression`
  - `node tests/runner.mjs check backend-regression`
  - `node tests/runner.mjs validate validate-agent-orchestration`
  - `node tests/runner.mjs validate validate-chat-stream-contract`
  - `node tests/runner.mjs validate validate-analyze-contract`
- Install smoke (mirrors `.github/workflows/install-smoke.yml`; `smoke-docker` needs Docker):
  - `node tests/runner.mjs smoke-native`
  - `node tests/runner.mjs smoke-docker`
- Optional npm aliases (root `package.json`): `npm run regression:backend`, `npm run regression:analysis`, `npm run smoke:native`, `npm run smoke:docker`.

### Migration: former `sclaw` regression commands

| Former | Use instead |
|--------|-------------|
| `./sclaw validate <name>` | `node tests/runner.mjs validate <name>` |
| `./sclaw validate --list` | `node tests/runner.mjs validate --list` |
| `./sclaw check <name>` | `node tests/runner.mjs check <name>` |
| `./sclaw check --list` | `node tests/runner.mjs check --list` |
| `./sclaw backend-regression` | `node tests/runner.mjs backend-regression` |
| `./sclaw analysis-regression` | `node tests/runner.mjs analysis-regression` |
| `./sclaw test-smoke-native` | `node tests/runner.mjs smoke-native` |
| `./sclaw test-smoke-docker` | `node tests/runner.mjs smoke-docker` |

## Coding Expectations
- TypeScript:
  - strict mode, ES modules, 2-space indentation, semicolons
  - prefer explicit types at API and store boundaries
  - keep route handlers thin and push logic into services
- Python:
  - follow existing FastAPI and Pydantic style
  - keep schema and regression code readable and typed
- Naming:
  - files: lowercase domain names such as `agent.ts`, `analysis.ts`
  - classes: `PascalCase`
  - functions and variables: `camelCase`
  - constants: `UPPER_SNAKE_CASE`
- Frontend specifics:
  - preserve the existing Next.js app-router structure
  - reuse the current i18n/theme/store infrastructure instead of adding parallel mechanisms
  - route all new user-visible copy through the existing i18n system; do not hardcode single-language strings in components, layouts, or client flows
  - make locale-sensitive formatting follow the active locale for dates, numbers, summaries, and generated display text
  - prefer design-token and theme-aware styling over fixed light/dark hardcoding

## Testing Expectations
- Prefer repository scripts when a script already captures the intended regression.
- For backend and contract work, cover success, failure, and missing-input scenarios.
- For frontend work, run targeted Vitest checks plus `type-check`; run `build` when layout, routing, or provider behavior changes.
- For new user-visible frontend features, verify both `en` and `zh` paths. Cover the key rendered copy or interaction behavior in tests instead of validating only one locale.
- For analysis runtime work, keep regression fixtures deterministic and avoid changing expected outputs casually.
- If a change affects chat, agent orchestration, report output, converters, or schema migration, extend or run the matching `node tests/runner.mjs validate <name>` check.

## Commit and PR Guidance
- Follow conventional commit style, for example:
  - `feat(frontend): add bilingual light and dark experience`
  - `fix(frontend): stop chat auto-scroll from locking wheel`
  - `docs: map existing codebase`
- Commit in small batches with clean boundaries and do not postpone commits once a logical slice is complete.
- Preferred sequence when applicable:
  - implementation changes first
  - tests in a separate commit when that improves reviewability
  - docs or workflow-note follow-ups in their own commit
- PRs should state:
  - what changed and why
  - impacted areas (`backend`, `frontend`, `scripts`, `docs`)
  - commands run and results
  - sample request/response when API behavior changed

## Security and Config
- Never commit live secrets, tokens, or private keys.
- Use `.env.example` as the template.
- Backend runtime depends on environment configuration for the OpenAI-compatible LLM interface and infrastructure; document any new defaults or required variables.
- When documenting LLM setup, prefer the existing OpenAI-compatible `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` pattern.
