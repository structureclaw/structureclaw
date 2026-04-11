# LLM Provider Removal Design

## Goal

Remove `LLM_PROVIDER` from StructureClaw so every LLM integration path uses the same OpenAI-compatible configuration surface:

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`

The runtime behavior should stay the same for default values. The cleanup should be complete across backend config, CLI setup, Docker, tests, and docs.

## Current State

- Backend config reads `LLM_PROVIDER` and uses it to branch between `openai`, `zhipu`, and `openai-compatible`.
- CLI `docker-install` prompts for and persists `LLM_PROVIDER`.
- Docker passes `LLM_PROVIDER` into the backend container.
- Tests and docs still treat provider selection as part of the supported configuration contract.
- Actual model invocation already uses `@langchain/openai` and a configurable base URL.

## Design

### Configuration Contract

The backend configuration contract becomes:

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_RETRIES`

`LLM_PROVIDER` is removed entirely. No compatibility read, no warning path, and no env write-back.

### Backend Runtime

- Delete provider parsing and normalization from `backend/src/config/index.ts`.
- Keep the existing default model and default base URL values unchanged.
- Keep `createChatModel()` behavior unchanged: no API key means no LLM client.
- Keep OpenAI-compatible invocation through `@langchain/openai`.

### CLI and Docker

- Remove `--llm-provider` from the CLI manifest and docker-install flow.
- Remove the interactive provider prompt.
- Persist only `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` to `.env`.
- Remove `LLM_PROVIDER` from `docker-compose.yml`.

### Tests

- Update regression, integration, smoke, and frontend test env setup to stop setting or asserting `LLM_PROVIDER`.
- Keep tests focused on the surviving three-variable contract.
- Add a regression assertion where useful so the cleanup does not regress.

### Documentation

- Update `.env.example`, README, handbook docs, and related setup references.
- Replace provider-selection wording with OpenAI-compatible wording.
- Keep bilingual docs aligned where the same setup surface is described in both languages.

## Risks and Mitigations

- Risk: hidden test or script dependency on `LLM_PROVIDER`.
  Mitigation: search-based cleanup plus targeted verification for backend, frontend, and regression entrypoints.

- Risk: docs drift between English and Chinese.
  Mitigation: update both language variants in the same change.

## Testing Strategy

- Run targeted backend regression coverage for env validation behavior.
- Run CLI-adjacent regression coverage where `docker-install` contract is exercised.
- Run frontend type-check if test env wiring changes there.
- Re-scan the repository for `LLM_PROVIDER` after implementation to confirm removal.
