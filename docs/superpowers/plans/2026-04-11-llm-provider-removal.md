# LLM Provider Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `LLM_PROVIDER` from the repository and standardize all LLM configuration on the existing OpenAI-compatible `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` variables.

**Architecture:** Collapse backend configuration to a single OpenAI-compatible path, then remove provider-specific CLI, Docker, test, and documentation references. Preserve current default model and base URL behavior while deleting provider-based branching.

**Tech Stack:** TypeScript, Node.js CLI scripts, Fastify backend, Docker Compose, Vitest/regression scripts, Markdown docs

---

### Task 1: Lock the backend config contract with tests

**Files:**
- Modify: `tests/regression/backend-validations.js`
- Test: `tests/regression/backend-validations.js`

- [ ] **Step 1: Write a failing regression test**

```js
test("backend config ignores provider selection and uses direct defaults", async () => {
  delete process.env.LLM_PROVIDER;
  process.env.LLM_API_KEY = "";
  process.env.LLM_MODEL = "";
  process.env.LLM_BASE_URL = "";
  // import config module fresh and assert default model/base URL only depend on direct envs
});
```

- [ ] **Step 2: Run the targeted regression to verify it fails**

Run: `node tests/runner.mjs validate validate-analyze-contract`
Expected: FAIL or existing targeted backend validation failure because the repo still exposes provider-based behavior.

- [ ] **Step 3: Implement minimal backend config cleanup**

```ts
const llmApiKey = process.env.LLM_API_KEY || '';
const llmModel = process.env.LLM_MODEL || 'gpt-4-turbo-preview';
const llmBaseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
```

- [ ] **Step 4: Re-run the targeted backend/regression command**

Run: `node tests/runner.mjs validate validate-analyze-contract`
Expected: PASS for the targeted contract path.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/index.ts tests/regression/backend-validations.js
git commit -m "refactor(backend): remove llm provider branching"
```

### Task 2: Remove CLI and Docker provider inputs

**Files:**
- Modify: `scripts/cli/main.js`
- Modify: `scripts/cli/command-manifest.js`
- Modify: `docker-compose.yml`
- Test: `tests/smoke/install-smoke.cjs`

- [ ] **Step 1: Write failing CLI/smoke assertions**

```js
// Update smoke expectations so only LLM_BASE_URL / LLM_API_KEY / LLM_MODEL are required.
// Remove any assertion or fixture that expects LLM_PROVIDER persistence.
```

- [ ] **Step 2: Run the targeted smoke-related test to verify it fails**

Run: `node tests/runner.mjs smoke-native`
Expected: FAIL because docker-install still requires or persists `LLM_PROVIDER`.

- [ ] **Step 3: Implement minimal CLI and Docker cleanup**

```js
// Remove --llm-provider parsing, prompting, persistence, and logging.
// Remove LLM_PROVIDER from docker-compose environment.
```

- [ ] **Step 4: Re-run the targeted smoke-related test**

Run: `node tests/runner.mjs smoke-native`
Expected: PASS for the affected install flow.

- [ ] **Step 5: Commit**

```bash
git add scripts/cli/main.js scripts/cli/command-manifest.js docker-compose.yml tests/smoke/install-smoke.cjs
git commit -m "refactor(cli): remove llm provider setup"
```

### Task 3: Remove provider references from tests and docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `README_CN.md`
- Modify: `docs/handbook.md`
- Modify: `docs/handbook_CN.md`
- Modify: `tests/llm-integration/lib/context.js`
- Modify: `tests/llm-integration/runner.cjs`
- Modify: `tests/regression/backend-regression.js`
- Modify: `frontend/playwright.config.ts`

- [ ] **Step 1: Write failing expectation updates**

```js
// Remove provider fields from test env fixtures and output assertions.
// Update docs snapshots / string expectations if any exist.
```

- [ ] **Step 2: Run focused verification commands to verify failures**

Run: `node tests/runner.mjs backend-regression`
Expected: FAIL while provider references still exist.

Run: `npm run type-check --prefix frontend`
Expected: PASS or expose any frontend env typing fallout that must be fixed.

- [ ] **Step 3: Implement remaining cleanup**

```md
LLM: `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
Uses an OpenAI-compatible API surface.
```

- [ ] **Step 4: Re-run verification**

Run: `node tests/runner.mjs backend-regression`
Expected: PASS

Run: `npm run type-check --prefix frontend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md README_CN.md docs/handbook.md docs/handbook_CN.md tests/llm-integration/lib/context.js tests/llm-integration/runner.cjs tests/regression/backend-regression.js frontend/playwright.config.ts
git commit -m "docs: remove llm provider references"
```
