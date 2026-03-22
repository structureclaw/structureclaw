# Contributing to StructureClaw

## Scope

This guide covers contribution workflow for `frontend`, `backend`, `scripts`, and `docs`.

It is written for typical open source collaboration through a fork-and-pull-request model.

## Before You Start

1. Read [README.md](/home/openclaw/structureclaw/README.md), [docs/handbook.md](/home/openclaw/structureclaw/docs/handbook.md), and [docs/reference.md](/home/openclaw/structureclaw/docs/reference.md).
2. Make sure your local environment works:

```bash
make doctor
make start
make status
```

3. If your change touches chat, agent orchestration, reports, converters, or schema behavior, identify the matching validation script in `scripts/` before you start.

## Contribution Rules

- Keep changes focused and small.
- Preserve module boundaries across `frontend`, `backend`, and backend-hosted analysis skills.
- Do not mix unrelated refactors into feature or bug-fix PRs.
- Keep user-visible text bilingual in English and Chinese.
- Treat deterministic behavior as a feature: avoid casual changes to schemas, fixtures, regression outputs, or contract payloads.

## Recommended Git Workflow

The recommended workflow is intentionally simple and keeps your fork easy to maintain.

### 1. Keep `master` clean

Your fork's `master` should be used only to mirror the upstream repository. Do not develop directly on it.

Recommended one-time setup:

```bash
git remote add upstream <upstream-repository-url>
git fetch upstream
```

### 2. Create a feature branch for every change

For every feature, fix, or doc update:

```bash
git checkout master
git pull upstream master
git checkout -b my-feature
```

Recommended branch naming:

- `feat/short-description`
- `fix/short-description`
- `docs/short-description`
- `refactor/short-description`
- `test/short-description`

Examples:

- `feat/builtin-skill-taxonomy`
- `fix/chat-stream-fallback`
- `docs/refresh-contributing-guide`

### 3. Commit in small logical slices

- Commit implementation, tests, and docs in separate commits when that improves reviewability.
- Do not wait until the end of a long task to batch unrelated work into one commit.
- If a change naturally splits into multiple reviewable steps, keep that structure in git history.

Use conventional commits when possible:

- `feat(frontend): add bilingual report summary panel`
- `fix(backend): fallback unmatched skills to generic no-skill flow`
- `docs: refresh handbook and protocol reference`

### 4. Push your branch and open a PR

Open the PR from your feature branch, not from `master`.

```bash
git push origin my-feature
```

Use your branch to open a pull request against the upstream repository's `master`.

### 5. After a squash merge, clean up locally

If the PR is squash-merged, the cleanup flow should stay conflict-free:

```bash
git checkout master
git pull upstream master
git branch -d my-feature
```

Your local `master` should fast-forward cleanly. You do not need to rebase the already-merged feature branch. If you also want to clean up the remote branch in your fork:

```bash
git push origin --delete my-feature
```

## Development Expectations

### Repository boundaries

- Backend: keep route handlers thin; put orchestration and domain logic in services.
- Frontend: keep route/layout code in app routes and reusable UI in components.
- Analysis runtime: keep engine, schema, and regression behavior deterministic and scriptable.
- Scripts: prefer extending existing validation scripts instead of creating one-off local-only helpers.

### Language and UX rules

- Do not add new single-language user-facing flows.
- New UI copy, prompts, empty states, report-facing labels, and generated guidance should support both `en` and `zh`.
- Locale-sensitive output should follow the active frontend locale.

### Coding expectations

- TypeScript: strict mode, explicit types at important boundaries, thin API layers.
- Python: follow existing FastAPI and Pydantic style, keep logic readable and typed.
- Avoid broad incidental refactors unless the PR is explicitly scoped as a refactor.

## Validation Checklist

Run the checks that match your change.

Backend-focused:

```bash
npm run build --prefix backend
npm run lint --prefix backend
npm test --prefix backend -- --runInBand
```

Frontend-focused:

```bash
npm run build --prefix frontend
npm run type-check --prefix frontend
npm run test:run --prefix frontend
```

Analysis runtime and cross-service validation:

```bash
make backend-regression
make analysis-regression
```

Useful targeted validators:

```bash
./scripts/validate-agent-orchestration.sh
./scripts/validate-chat-stream-contract.sh
./scripts/validate-analyze-contract.sh
./scripts/validate-converter-api-contract.sh
```

Expectation by change type:

- Backend and contract work: cover success, failure, and missing-input behavior.
- Frontend work: run targeted tests plus `type-check`; run `build` for routing, layout, or provider changes.
- Analysis runtime work: keep regression fixtures stable and justify expected-output updates clearly.
- Docs-only changes: no code tests are required, but commands and file paths in the docs should be checked for accuracy.

## Pull Request Requirements

PR quality matters more than PR size, but small and reviewable PRs are strongly preferred.

### PR title

Use a clear title. Conventional-commit style is recommended:

- `feat(backend): split builtin skill runtime responsibilities`
- `fix(frontend): keep report locale consistent`
- `docs: clarify fork and PR workflow`

### PR description

Every PR should include:

- What changed
- Why the change is needed
- Impacted areas: `frontend`, `backend`, `scripts`, `docs`
- Commands run and their results
- Screenshots for UI changes when helpful
- Example request and response payloads when API or contract behavior changed
- Migration or compatibility notes when behavior changes are not fully backward-compatible

### PR scope

A good PR usually has one clear purpose:

- one feature
- one fix
- one refactor
- one docs improvement

Split the work if reviewers would otherwise need to evaluate unrelated risks in one PR.

### PR review expectations

- Be ready to update the PR in response to review feedback.
- If review feedback changes behavior, update tests or docs in the same branch.
- Do not force-push away discussion unless you are intentionally cleaning up history before merge.
- Keep review threads resolved only after the requested change is actually addressed.

### Draft PRs

Open a draft PR when:

- you want early feedback on direction
- the scope is valid but not yet fully tested
- an architectural decision needs review before full implementation

Convert the PR to ready-for-review only after the validation checklist is meaningfully complete.

## Security and Secrets

- Never commit live secrets, tokens, or private keys.
- Use `.env.example` and `backend/.env.example` as templates.
- Keep production credentials outside the repository.
- Document new configuration defaults when your change depends on them.

## Communication Tips

- If you are unsure whether a change belongs in backend API/services or backend-hosted analysis skills, explain your reasoning in the PR.
- If the change introduces new user-visible text, call out how bilingual support was handled.
- If the change updates a contract, mention which scripts or fixtures were used to validate it.

## Language Counterpart

Chinese version: [CONTRIBUTING_CN.md](/home/openclaw/structureclaw/CONTRIBUTING_CN.md)
