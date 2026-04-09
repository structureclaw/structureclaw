# LLM Integration Test Conventions

- `backend/src/agent-skills/**/__tests__/**/*.test.mjs` is for ordinary skill tests.
  These tests must be deterministic and must not call a real external LLM provider.
- `backend/tests/agent.service.test.mjs` remains ordinary backend integration coverage.
  `svc.llm = null` and stubbed-LLM cases are still non-LLM tests.
- `tests/llm-integration/**` is the only place for real provider-backed LLM tests.

## Fixture Rules

- Every case in `tests/llm-integration/fixtures/test-cases.json` must declare `skillId`.
- `skillId` is used for targeted runs like:

```bash
node tests/runner.mjs llm-integration --skill frame
node tests/runner.mjs llm-integration extraction --skill beam
```

## Recommended Commands

```bash
npm run test:skills
npm run test:skill:frame
npm run test:llm
npm run test:llm:frame
```
