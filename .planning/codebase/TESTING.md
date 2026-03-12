# Testing And Validation Map

## Scope

This repository uses three different quality layers:

- framework tests for `backend/`
- framework tests for `frontend/`
- script-driven contract and regression validation for `core/` and cross-service flows

The most important quality signal is not a single test runner. It is the composition of Make targets and validation scripts in `scripts/`.

## Primary Entry Points

- `make doctor` and `make check-startup` run the broadest local quality sweep through `scripts/check-startup.sh`.
- `make backend-regression` runs backend build, lint, Jest, and contract scripts through `scripts/check-backend-regression.sh`.
- `make core-regression` runs core contract and regression checks through `scripts/check-core-regression.sh`.
- `npm test --prefix backend -- --runInBand` runs backend Jest suites.
- `npm run test:run --prefix frontend` runs frontend Vitest suites once.

## Backend Testing

### Framework And Config

- Framework: Jest 29 with ESM support enabled from `backend/package.json`.
- Command: `NODE_OPTIONS=--experimental-vm-modules jest --passWithNoTests`.
- Config file: `backend/jest.config.cjs`.
- Environment: `node`.
- Discovery pattern: `backend/tests/**/*.test.mjs`.

### Suite Layout

- Backend tests live outside source under `backend/tests/`.
- Tests import compiled output from `backend/dist/`, not TypeScript source. Examples:
  - `backend/tests/agent.service.test.mjs`
  - `backend/tests/llm-error.test.mjs`
- This means backend build health is a prerequisite for meaningful test execution and is explicitly run in `scripts/check-backend-regression.sh`.

### Test Structure

- Tests use `describe` and `test` from `@jest/globals`.
- Assertions are behavior-oriented, not snapshot-based.
- Common assertion targets:
  - orchestration success or failure flags
  - presence and status of `toolCalls`
  - mapped error codes
  - generated artifact files

### Mocking Patterns

- Instance-level mutation is the dominant unit-test seam:
  - `svc.llm = null`
  - `svc.engineClient.post = async (...) => ...`
- Tests build fake HTTP failures by attaching `response.data.errorCode` to thrown `Error` objects, matching production Axios-style behavior in `backend/tests/agent.service.test.mjs`.
- There is no heavy mocking framework layer. Mocks are plain objects, reassigned methods, or prototype overrides.

### What Backend Tests Emphasize

- closed-loop orchestration in `backend/tests/agent.service.test.mjs`
- error classification in `backend/tests/llm-error.test.mjs`
- artifact side effects, including file cleanup after assertions

## Frontend Testing

### Framework And Config

- Framework: Vitest 4 configured in `frontend/vitest.config.ts`.
- Environment: `jsdom`.
- Setup file: `frontend/tests/setup.ts`.
- Discovery pattern: `frontend/tests/**/*.test.ts` and `frontend/tests/**/*.test.tsx`.
- Supporting libraries:
  - `@testing-library/react`
  - `@testing-library/jest-dom`
  - `@testing-library/user-event`

### Suite Layout

- Tests are grouped by concern under `frontend/tests/`:
  - component tests in `frontend/tests/components/`
  - integration tests in `frontend/tests/integration/`
  - accessibility tests in `frontend/tests/accessibility/`
  - store tests in `frontend/tests/stores/`
  - style/config guards at the top level such as `frontend/tests/postcss-config.test.ts`

### What Frontend Tests Cover

- UI primitives and variant classes:
  - `frontend/tests/components/button.test.tsx`
  - `frontend/tests/components/input.test.tsx`
  - `frontend/tests/components/card.test.tsx`
- route-level rendering and shell composition:
  - `frontend/tests/integration/home-page.test.tsx`
  - `frontend/tests/integration/console-page.test.tsx`
  - `frontend/tests/integration/route-groups.test.tsx`
- semantics and accessibility basics:
  - `frontend/tests/accessibility/semantic.test.tsx`
- store/provider behavior:
  - `frontend/tests/stores/context.test.tsx`
  - `frontend/tests/stores/slices/preferences.test.ts`
- design-system and build-pipeline guards:
  - `frontend/tests/design-tokens.test.ts`
  - `frontend/tests/tailwind-config.test.ts`
  - `frontend/tests/postcss-config.test.ts`
  - `frontend/tests/glassmorphism.test.ts`

### Mocking And Environment Setup

- Shared DOM polyfills live in `frontend/tests/setup.ts` for Radix and jsdom gaps:
  - pointer capture methods
  - `scrollIntoView`
  - `getBoundingClientRect`
  - `clientWidth` and `clientHeight`
  - `ResizeObserver`
  - `EventSource`
- Per-test mocking typically uses Vitest primitives:
  - `vi.spyOn(globalThis, 'fetch')`
  - `vi.mock('next-themes', ...)`
  - `vi.restoreAllMocks()` in `afterEach`
- Async UI behavior usually uses `findBy...`, `waitFor`, or `userEvent`.
- Tests prefer accessible queries (`getByRole`, `findByRole`, `getByPlaceholderText`) over DOM selectors, except when verifying semantic button presence in `frontend/tests/accessibility/semantic.test.tsx`.

### Frontend Test Style

- Many suites include requirement IDs in titles, such as `(COMP-01)`, `(PAGE-01)`, `(CONS-13)`, or `(ACCS-03)`.
- Assertions commonly check exact Tailwind classes, so UI refactors that only restyle components can break tests.
- Several “integration” tests are really module/render integration tests rather than browser E2E tests; they render components directly in jsdom.

## Core Validation

### Testing Model

- The Python core does not currently expose a first-class `pytest` suite in the repository tree even though `pytest` is listed in `core/requirements.txt`.
- Quality is enforced mainly through executable validation scripts under `scripts/` plus JSON fixture sets in:
  - `core/regression/static_2d/`
  - `core/regression/static_3d/`
  - `core/schemas/examples/`

### Contract Scripts

- `scripts/validate-analyze-contract.sh` imports `core/main.py` directly and asserts response envelope shape, error codes, and required nested fields.
- `scripts/validate-code-check-traceability.sh` checks code-check traceability payloads.
- `scripts/validate-converter-api-contract.sh` and `scripts/validate-schema-migration.sh` validate converter and schema compatibility behavior.
- `scripts/validate-convert-roundtrip.sh`, `scripts/validate-convert-batch.sh`, and `scripts/validate-convert-passrate.sh` validate converter fidelity and reporting.

### Regression Fixture Scripts

- `scripts/validate-static-regression.sh` iterates through every `case_*.json` in `core/regression/static_2d/`, validates `request`, runs `analyze`, and compares dotted result paths against expected values within tolerance.
- `scripts/validate-static-3d-regression.sh` does the same for `core/regression/static_3d/`.
- `scripts/validate-structure-examples.sh` validates every example model in `core/schemas/examples/` and enforces a minimum example count.

### Execution Pattern

- Scripts choose `core/.venv-uv-lite/bin/python` first, then `core/.venv/bin/python`.
- Inline Python uses `sys.path.insert(0, 'core')` so imports resolve against repository packages without an installed distribution.
- Failures raise `SystemExit` with precise mismatch messages; there is no snapshot approval workflow.

## Cross-Service Contract Validation

These scripts matter as much as unit tests because they pin API and orchestration behavior:

- `scripts/validate-agent-orchestration.sh`
- `scripts/validate-agent-tools-contract.sh`
- `scripts/validate-agent-api-contract.sh`
- `scripts/validate-chat-stream-contract.sh`
- `scripts/validate-chat-message-routing.sh`
- `scripts/validate-report-template-contract.sh`
- `scripts/validate-agent-online-smoke.sh`

Observed patterns:

- backend code is built first with `npm run build --prefix backend >/dev/null`
- inline Node scripts import compiled modules from `backend/dist/`
- Fastify apps are created in-process and exercised with `app.inject(...)`
- service methods are often monkey-patched at the prototype level, for example:
  - `AgentService.prototype.run = async function mockRun(...) { ... }`
  - `AgentService.prototype.runStream = async function *mockRunStream(...) { ... }`
  - `ChatService.prototype.sendMessage = async function mockSendMessage(...) { ... }`
- assertions target payload shape, propagated trace IDs, CORS headers, SSE framing, and context pass-through

## Orchestrator Scripts And Quality Gates

### `scripts/check-backend-regression.sh`

Runs, in order:

- backend build
- backend lint
- backend Jest
- agent orchestration regression
- agent tools protocol contract
- agent API contract
- chat stream contract
- chat message routing contract
- report template contract
- Prisma schema validation

### `scripts/check-core-regression.sh`

Runs, in order:

- analyze response contract
- code-check traceability
- static 2D regression
- static 3D regression
- StructureModel example validation
- convert round-trip
- midas-text converter
- converter API contract
- schema migration
- batch convert report
- convert pass rate

### `scripts/check-startup.sh`

This is the broadest local gate. It composes:

- backend regression
- startup self-healing guard validation
- frontend type-check
- frontend lint
- frontend style pipeline guard via `frontend/tests/postcss-config.test.ts`
- optional frontend build
- core import and simplified analysis smoke checks
- the major core regression/contract scripts

## Practical Testing Guidance

- If you change backend runtime behavior, run `make backend-regression`; Jest alone is not enough because API and SSE contracts live in shell scripts.
- If you change frontend markup, text, or utility classes, run `npm run test:run --prefix frontend`; many tests assert specific accessible text and Tailwind classes.
- If you change core envelopes, schema fields, converters, or analysis outputs, run `make core-regression`; regression scripts inspect exact nested fields and tolerances.
- If you change startup flows or local lifecycle behavior, run `make doctor` or at least `scripts/check-startup.sh`.
- Keep new tests deterministic. The existing suite strongly prefers inline fixtures, direct method replacement, fixed timestamps, and local app injection over networked integration.
