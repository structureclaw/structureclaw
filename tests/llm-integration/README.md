# LLM Integration Test Conventions

- `backend/src/agent-skills/**/__tests__/**/*.test.mjs` is for ordinary skill tests.
  These tests must be deterministic and must not call a real external LLM service.
- `backend/tests/agent.service.test.mjs` remains ordinary backend integration coverage.
  `svc.llm = null` and stubbed-LLM cases are still non-LLM tests.
- `tests/llm-integration/**` is the only place for real external LLM integration tests.

## Fixture Rules

- Real LLM cases live next to the owning skill under `backend/src/agent-skills/**/__llm_tests__/`.
- Skill-aware fixtures should use the v2 shape:
  - document-level `family`
  - `scenarios[]`
  - `scenarioId`
  - per-variant `enabledSkillIds`, `fallbackPolicy`, and `expect`
- Legacy v1 fixtures with `testCases[]` and `assertions` are still supported, but new work should use v2.
- Targeted runs can filter by `family`, `variant`, and `scenario`. `--skill` remains a compatibility alias for `--family`.

```bash
node tests/runner.mjs llm-integration --family frame
node tests/runner.mjs llm-integration pipeline --family frame --variant specific
node tests/runner.mjs llm-integration extraction --family beam --scenario beam-basic
node tests/runner.mjs llm-integration pipeline --family frame --variant generic --output tests/.artifacts/frame-generic.json
```

## Recommended Commands

```bash
npm run test:skills
npm run test:skill:beam
npm run test:skill:frame
npm run test:skill:portal-frame
npm run test:llm
npm run test:llm:beam
npm run test:llm:frame
npm run test:llm:portal-frame
node --test tests/llm-integration/lib/*.test.cjs
```
