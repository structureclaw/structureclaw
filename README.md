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
- `scripts/`: startup helpers and the `sclaw` / `sclaw_cn` CLI implementation
- `tests/`: regression runner (`node tests/runner.mjs ...`), install smoke, and CI-covered frontend checks (type-check, Vitest, lint) after native smoke
- `docs/`: user handbook and protocol references

## Quick Start

If Node.js is not installed yet, use the helper installer script first:

```bash
bash ./scripts/install-node-linux.sh
```

Windows PowerShell (run as Administrator for first-time package install):

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/install-node-windows.ps1
```

Recommended local flow:

```bash
./sclaw doctor
./sclaw start
./sclaw status
```

China mirror flow (same subcommands, mirror defaults enabled):

```bash
./sclaw_cn doctor
./sclaw_cn start
./sclaw_cn status
```

Notes:

- SQLite is now the default local database. `./sclaw start` uses `.runtime/data/structureclaw.start.db`, and `./sclaw doctor` uses `.runtime/data/structureclaw.doctor.db` so preflight checks do not touch the active local runtime database.
- `./sclaw doctor` no longer requires a preinstalled system Python 3.12. It will ensure `uv` and prepare `backend/.venv` with Python 3.12 automatically when needed. On Windows, this automatic setup currently requires `winget`; if `winget` is unavailable, install `uv` manually before running `./sclaw doctor`.
- If your old local `.env` still points `DATABASE_URL` at a local PostgreSQL instance, `./sclaw doctor` and `./sclaw start` will auto-migrate that data into SQLite, rewrite `.env` to the SQLite default, and keep the original PostgreSQL URL in `POSTGRES_SOURCE_DATABASE_URL`.
- That first auto-migration also creates a local backup file like `.env.pre-sqlite-migration.<timestamp>.bak`.
- `sclaw_cn` defaults to China mirror settings when unset: `PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`, `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`, and Docker mirror prefix via `DOCKER_REGISTRY_MIRROR`.
- You can override mirror values in `.env` or shell environment (`PIP_INDEX_URL`, `NPM_CONFIG_REGISTRY`, `DOCKER_REGISTRY_MIRROR`, `APT_MIRROR`).

Useful follow-up commands:

```bash
./sclaw logs
./sclaw stop
node tests/runner.mjs backend-regression
node tests/runner.mjs analysis-regression
```

Use the built-in CLI batch convert command to transform structure model JSON files and write a summary report:

```bash
./sclaw convert-batch --input-dir tmp/input --output-dir tmp/output --report tmp/report.json --target-format compact-1
```

Windows PowerShell:

```powershell
node .\sclaw doctor
node .\sclaw start
node .\sclaw status
node .\sclaw logs all --follow
node .\sclaw stop
```

### Windows / Docker Quick Start

Windows users can now start the full stack directly with Docker, which is the easiest path for beginners who do not want to install local Node.js and Python first.

Recommended steps:

1. Install and start Docker Desktop.
2. If Docker Desktop asks you to enable WSL 2 or required container features on first launch, follow the setup wizard and restart Docker Desktop.
3. Run the interactive Docker bootstrap command from the project root:

```powershell
node .\sclaw docker-install
```

For CI or scripted setup, use the non-interactive variant:

```powershell
node .\sclaw docker-install --non-interactive --llm-provider openai --llm-base-url https://api.openai.com/v1 --llm-api-key <your-key> --llm-model gpt-4.1
```

Once the stack is ready, the main entrypoints are:

- Frontend: `http://localhost:30000`
- Backend health check: `http://localhost:30010/health`
- Analysis routes: `http://localhost:30010/analyze`
- Database status page: `http://localhost:30000/console/database`

To stop the containers:

```bash
node .\sclaw docker-stop
```

Or:

```bash
docker compose down
```

## Environment

Copy and adjust environment variables from `.env.example`.

Key variables include:

- `PORT`, `FRONTEND_PORT`
- `DATABASE_URL`, `POSTGRES_SOURCE_DATABASE_URL`
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
