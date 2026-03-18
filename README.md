# StructureClaw

AI-assisted structural engineering workspace for AEC workflows.

## What You Get

- Conversational engineering workflow from natural language to analysis artifacts
- Unified orchestration loop: draft -> validate -> analyze -> code-check -> report
- Web UI, API backend, and Python analysis engine in one monorepo
- Regression and contract scripts for repeatable engineering validation

## Architecture

```text
frontend (Next.js)
	-> backend (Fastify + Prisma + Agent orchestration)
	-> core (FastAPI analysis engine)
	-> reports / metrics / artifacts
```

Main directories:

- `frontend/`: Next.js 14 application
- `backend/`: Fastify API, agent/chat flows, Prisma integration
- `core/`: FastAPI structural validation/conversion/analysis engine
- `scripts/`: startup helpers and contract/regression checks
- `docs/`: user handbook and protocol references

## Quick Start

Recommended local flow:

```bash
make doctor
make start
make status
```

Useful follow-up commands:

```bash
make logs
make stop
make backend-regression
make core-regression
```

CLI alternative:

```bash
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs all --follow
./sclaw stop
```

## Environment

Copy and adjust environment variables from `.env.example`.

Key variables include:

- `PORT`, `FRONTEND_PORT`, `CORE_PORT`
- `DATABASE_URL`, `REDIS_URL`
- `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- `ANALYSIS_ENGINE_URL` (can be auto-derived)

## API Entrypoints

Backend:

- `POST /api/v1/agent/run`
- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`

Core:

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`

## Engineering Principles

- Skills are enhancement layers, not the only execution path.
- Unmatched selected skills fall back to generic no-skill modeling.
- User-visible content must support both English and Chinese.
- Keep module boundaries explicit across frontend/backend/core.

## Documentation

- English handbook: `docs/handbook.md`
- Chinese handbook: `docs/handbook_CN.md`
- English reference: `docs/reference.md`
- Chinese reference: `docs/reference_CN.md`
- Chinese overview: `README_CN.md`
- Contribution guide: `CONTRIBUTING.md`

## Contributing

Please read `CONTRIBUTING.md` before opening a PR.

## License

MIT. See `LICENSE`.
