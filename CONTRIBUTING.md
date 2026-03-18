# Contributing to StructureClaw

## Scope

This guide covers contribution workflow for frontend, backend, core engine, scripts, and docs.

## Before You Start

1. Read `README.md`, `docs/handbook.md`, and `docs/reference.md`.
2. Ensure local environment works:

```bash
make doctor
make start
make status
```

## Development Rules

- Keep changes focused and small.
- Preserve module boundaries (`frontend` / `backend` / `core`).
- Do not mix unrelated refactors into feature/fix PRs.
- Keep user-visible text bilingual (`en` and `zh`).

## Coding Expectations

- Backend: thin route handlers, orchestration in services.
- Frontend: avoid hardcoded single-language user text.
- Core: keep schema and regression fixtures deterministic.

## Validation Checklist

Run what is relevant to your change.

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

Cross-service contracts:

```bash
make backend-regression
make core-regression
```

## Commit and PR Style

Use conventional commit messages, for example:

- `feat(frontend): add bilingual report summary panel`
- `fix(backend): fallback unmatched skills to generic no-skill flow`
- `docs: refresh handbook and protocol reference`

PRs should include:

- What changed and why
- Impacted areas (`frontend`, `backend`, `core`, `scripts`, `docs`)
- Commands run and results
- API or contract sample payloads when relevant

## Security and Secrets

- Do not commit real secrets.
- Use `.env.example` templates for configuration docs.
- Keep production credentials outside repository.

## Language Counterpart

Chinese version: `CONTRIBUTING_CN.md`
