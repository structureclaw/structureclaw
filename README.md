# StructureClaw

AI-assisted structural engineering workspace for AEC workflows.

## Demo

https://github.com/user-attachments/assets/031fe757-551d-4775-ab3f-0411037ad5ae

## What You Get

- Conversational engineering workflow from natural language to analysis artifacts
- Unified orchestration loop: draft -> validate -> analyze -> code-check -> report
- Web UI, API backend, and backend-hosted Python analysis runtime in one monorepo
- Regression and contract scripts for repeatable engineering validation

## Architecture

```text
frontend (Next.js)
	-> backend (Fastify + Prisma + Agent orchestration + analysis runtime host)
	-> backend/src/agent-skills/analysis-execution/python
	-> reports / metrics / artifacts
```

Main directories:

- `frontend/`: Next.js 14 application
- `backend/`: Fastify API, agent/chat flows, Prisma integration, and analysis execution host
- `scripts/`: startup helpers and contract/regression checks
- `docs/`: user handbook and protocol references

## Quick Start

Recommended local flow:

```bash
make doctor
make start
make status
```

Notes:

- SQLite is now the default local database. A fresh setup writes to `.runtime/data/structureclaw.db`.
- If your old local `.env` still points `DATABASE_URL` at a local PostgreSQL instance, `make doctor` and `make start` will auto-migrate that data into SQLite, rewrite `.env` to the SQLite default, and keep the original PostgreSQL URL in `POSTGRES_SOURCE_DATABASE_URL`.
- That first auto-migration also creates a local backup file like `.env.pre-sqlite-migration.<timestamp>.bak`.

Useful follow-up commands:

```bash
make logs
make stop
make backend-regression
make analysis-regression
```

CLI alternative:

```bash
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs all --follow
./sclaw stop
```

### Windows / Docker Quick Start

Windows users can now start the full stack directly with Docker, which is the easiest path for beginners who do not want to install local Node.js, Python, PostgreSQL, and Redis first.

Recommended steps:

1. Install and start Docker Desktop.
2. If Docker Desktop asks you to enable WSL 2 or required container features on first launch, follow the setup wizard and restart Docker Desktop.
3. Create `.env` from `.env.example` in the project root, and at minimum fill in `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL`.
4. Start the full stack with Docker Compose:

```bash
make docker-up
```

If your Windows environment does not have `make`, run:

```bash
docker compose up --build
```

Once the stack is ready, the main entrypoints are:

- Frontend: `http://localhost:30000`
- Backend health check: `http://localhost:30010/health`
- Analysis routes: `http://localhost:30010/analyze`
- Database status page: `http://localhost:30000/console/database`

To stop the containers:

```bash
make docker-down
```

Or:

```bash
docker compose down
```

## Environment

Copy and adjust environment variables from `.env.example`.

Key variables include:

- `PORT`, `FRONTEND_PORT`
- `DATABASE_URL`, `POSTGRES_SOURCE_DATABASE_URL`, `REDIS_URL`
- `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- `ANALYSIS_PYTHON_BIN`, `ANALYSIS_PYTHON_TIMEOUT_MS`, `ANALYSIS_ENGINE_MANIFEST_PATH`

## API Entrypoints

Backend:

- `POST /api/v1/agent/run`
- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`

Backend-hosted analysis:

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`

## Engineering Principles

- Skills are enhancement layers, not the only execution path.
- Unmatched selected skills fall back to generic no-skill modeling.
- User-visible content must support both English and Chinese.
- Keep module boundaries explicit across frontend/backend/analysis skills.

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
