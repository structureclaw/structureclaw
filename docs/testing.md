# Testing Taxonomy

This page is the canonical test map for StructureClaw. It defines what each test category owns, which command runs it, and where CI workflows are allowed to overlap.

This document clarifies the current test system for issue #234 and is updated when workflow boundaries change.

## Category Definitions

| Category | Owns | Does not own | Primary command |
| --- | --- | --- | --- |
| Unit | Pure functions, small helpers, reducers, schema parsing, local component behavior | Process startup, real browser flows, real LLM calls | `npm test --prefix backend -- --runInBand` or `npm run test:run --prefix frontend` |
| Integration | One bounded subsystem with mocked or local dependencies, such as a route handler with service behavior or a rendered page with providers | Full install/startup, real external services, model-quality scoring | Backend Jest or frontend Vitest integration config |
| E2E | User-visible browser workflows against a running app | Deterministic engineering regression, deep backend contracts, LLM quality benchmarks | `npm run test:e2e --prefix frontend` |
| Regression | Deterministic behavior that must not drift across changes, especially engineering analysis and backend contract bundles | Exploratory browser checks, real model quality | `node tests/runner.mjs backend-regression` or `node tests/runner.mjs analysis-regression` |
| Validation | Named contract and schema checks that can be selected individually | Broad build/lint/test bundles | `node tests/runner.mjs validate <name>` |
| Smoke | Install, setup, build, and lifecycle compatibility checks on supported platforms | Owning unit, integration, or E2E coverage | `node tests/runner.mjs smoke-native` |
| LLM integration | Legacy real-LLM and routing integration checks | Long-term agent quality scoring | `node tests/runner.mjs llm-integration` |
| LLM benchmark | Real LangGraph agent quality checks with scenario scoring | Fast deterministic unit or contract coverage | `node tests/runner.mjs llm-benchmark` |

## Test Ownership

| Location | Category owner | Runner |
| --- | --- | --- |
| `backend/tests/*.test.mjs` | Backend unit or backend integration, depending on fixture scope | `npm test --prefix backend -- --runInBand` |
| `backend/src/**/__tests__/*.test.mjs` | Backend unit or focused subsystem integration | `npm test --prefix backend -- --runInBand` |
| `backend/src/agent-skills/**/__tests__/*` | Skill unit, handler, or skill integration coverage | `npm test --prefix backend -- --runInBand` or skill-specific npm scripts |
| `frontend/tests/*.test.ts(x)` plus `frontend/tests/lib/**`, `frontend/tests/stores/**`, and non-console `frontend/tests/components/**` | Frontend unit and configuration coverage | `npm run test:run --prefix frontend` |
| `frontend/tests/components/console/**` | Frontend integration coverage for the composed AI console, capability hydration, streamed responses, and provider-backed interactions | `npm run test:run:integration --prefix frontend` |
| `frontend/tests/accessibility/semantic.test.tsx` | Semantic/accessibility integration smoke for the composed console page | `npm run test:run:integration --prefix frontend` |
| `frontend/tests/integration/**` | Frontend integration coverage for pages, providers, and route groups | `npm run test:run:integration --prefix frontend` |
| `frontend/tests/e2e/**` | Playwright browser E2E coverage | `npm run test:e2e --prefix frontend` |
| `tests/regression/backend-validations.js` | Named validation contracts | `node tests/runner.mjs validate <name>` |
| `tests/regression/backend-regression.js` | Backend regression bundle | `node tests/runner.mjs backend-regression` |
| `tests/regression/analysis-runner.py` | Analysis regression fixtures | `node tests/runner.mjs analysis-regression` |
| `tests/smoke/**` | Native install and build smoke checks | `node tests/runner.mjs smoke-native` |
| `tests/llm-integration/**` | Legacy LLM integration harness and helper unit tests | `node tests/runner.mjs llm-integration` plus local helper tests |
| `tests/llm-benchmark/**` | LangGraph agent benchmark scenarios and scoring | `node tests/runner.mjs llm-benchmark` |

## CI Workflow Boundaries

| Workflow | Purpose | Notes |
| --- | --- | --- |
| `.github/workflows/backend-regression.yml` | Backend regression on Linux and Windows | Runs the backend regression bundle through `tests/runner.mjs`. |
| `.github/workflows/frontend-regression.yml` | Frontend static and unit regression on Linux and Windows | Runs frontend type-check, lint, and unit Vitest coverage. |
| `.github/workflows/analysis-regression.yml` | Deterministic analysis regression on Linux and Windows | Builds the backend, sets up analysis Python, and runs analysis fixtures. |
| `.github/workflows/e2e.yml` | Playwright browser workflows | Triggered on `master`, manually, or by `/test-e2e` comments from allowed users. |
| `.github/workflows/install-smoke.yml` | Native install/build compatibility smoke | Calls `node tests/runner.mjs smoke-native`; frontend and backend static checks live in their own regression workflows. |
| `.github/workflows/llm-integration.yml` | Real LLM integration checks | Triggered on `master`, manually, or by `/test-llm` comments from allowed users. |
| `.github/workflows/publish-npm.yml` | Release gate before publishing | Repeats selected checks to protect releases. It does not own new coverage. |

## Frontend Vitest Split

The frontend has two Vitest configs with mutually exclusive ownership:

- `frontend/vitest.config.ts` owns fast unit/configuration coverage and explicitly excludes `tests/integration/**`, `tests/components/console/**`, `tests/accessibility/**`, and `tests/e2e/**`.
- `frontend/vitest.integration.config.ts` owns app-route/provider/console integration coverage and includes `tests/integration/**/*.test.tsx`, `tests/components/console/**/*.test.tsx`, and `tests/accessibility/semantic.test.tsx`.
- New console shell tests, provider-backed page tests, or tests that need the integration backend fixture should go into the integration runner even if they render React components.

## Choosing A Test

Use the smallest category that proves the behavior:

- Backend logic or route behavior: add or run targeted Jest tests, then run `node tests/runner.mjs backend-regression` if contracts can be affected.
- Frontend component or state behavior: add or run Vitest tests, plus `npm run type-check --prefix frontend`. Use the integration Vitest runner for console shell, provider-backed page, route, or accessibility coverage.
- Browser behavior across pages: use Playwright E2E.
- Engineering analysis output, converter behavior, schema contracts, or agent orchestration payloads: use named validations or analysis regression.
- CLI setup, install, build, and platform compatibility: use smoke tests.
- Real LLM agent quality: use the LLM benchmark path. Keep model-quality assertions out of deterministic unit and E2E tests.

## Overlap Policy

- Each test file should have one category owner and one primary runner.
- CI workflows may call bundles for gating, but a duplicated command in CI does not transfer ownership.
- Release and smoke workflows may repeat build, lint, or test commands as compatibility gates. Do not add new category-specific assertions there unless the workflow itself is the target.
- Do not use E2E tests to cover deterministic backend contracts or engineering fixtures.
- Do not use unit, validation, or E2E tests to judge real LLM answer quality. Use `tests/llm-benchmark/**`.
- When adding coverage for follow-up test issues, place the new test under the owning category first, then only wire CI if that category is missing from CI.

## Current Gaps Made Explicit

- E2E currently covers browser-level workflows such as navigation, i18n/theme, capabilities, database admin, and console chat smoke. It is not a full agent quality suite.
- Frontend integration tests have a dedicated local command, but are not wired into CI until the integration runner is stable.
- `install-smoke.yml` now owns native install/build compatibility only.
- `llm-integration` and `llm-benchmark` both touch real LLM behavior today. New agent-quality scenarios should prefer the benchmark path.
- Issue #234 should settle boundaries and documentation first. Separate coverage-expansion issues should add the missing tests.
