# Repository Guidelines

## Project Structure & Module Organization
- `backend/`: Fastify + Prisma API layer (routes in `src/api`, business logic in `src/services`, shared utilities in `src/utils`).
- `core/`: FastAPI analysis engine and structural schemas (`schemas/`, `fem/`, `design/`, `regression/`).
- `frontend/`: Next.js app (UI and client logic under `src/`).
- `scripts/`: operational and regression scripts (`check-startup.sh`, `check-core-regression.sh`, `validate-*`).
- `docs/`: roadmap and protocol documentation.

Keep new features modular: API contract in `api/`, orchestration/domain logic in `services/`, and reusable helpers in `utils/`.

## Build, Test, and Development Commands
- `make doctor`: startup checks (build/lint/tests + core regression checks).
- `make start` / `make stop` / `make status`: local one-command lifecycle.
- `make core-regression`: run core contract + static cases + schema + convert round-trip.
- `npm run build --prefix backend`: compile backend TypeScript.
- `npm run lint --prefix backend`: run ESLint.
- `./scripts/validate-agent-orchestration.sh`: validate agent protocol and orchestration paths.

Example local flow:
```bash
make doctor
make start
make core-regression
```

## Coding Style & Naming Conventions
- TypeScript: strict mode, ES modules, 2-space indentation, semicolons.
- Python: follow existing Pydantic/FastAPI style and clear typed models.
- Naming:
  - files: lowercase with clear domain names (`agent.ts`, `analysis.ts`),
  - classes: `PascalCase`,
  - functions/vars: `camelCase`,
  - constants: `UPPER_SNAKE_CASE`.
- Use existing linters; avoid introducing alternate formatters without team agreement.

## Testing Guidelines
- Backend: Jest (`npm test --prefix backend -- --runInBand`) plus lint/build gates.
- Core/Agent regressions are script-driven; keep tests deterministic.
- Add/extend validation scripts when introducing new tool steps, schema fields, or response contracts.
- Prefer scenario-based checks (success/failure/missing-input) for agent workflows.

## Commit & Pull Request Guidelines
- Follow conventional-style commit messages seen in history, e.g.:
  - `feat: add multi-provider llm config with zhipu support`
  - `feat: formalize agent tool protocol schemas`
- Make small, logical commits as you go. Do not wait until the end of a long task to commit unrelated changes together.
- PRs should include:
  - what changed and why,
  - impacted modules (`backend/core/frontend/scripts/docs`),
  - verification commands run and results,
  - sample request/response for API behavior changes.

## Security & Configuration Tips
- Never commit real API keys or secrets.
- Use `.env.example` / `backend/.env.example` as templates.
- For LLM provider switching, prefer `LLM_PROVIDER` + `LLM_API_KEY` (or `ZAI_API_KEY` for Zhipu) and document defaults in PRs.
