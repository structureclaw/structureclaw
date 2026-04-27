# StructureClaw

AI-assisted structural engineering workspace for AEC workflows.

## Demo

https://github.com/user-attachments/assets/031fe757-551d-4775-ab3f-0411037ad5ae

## What You Get

- Conversational engineering workflow from natural language to analysis artifacts
- Unified orchestration loop: draft -> validate -> analyze -> code-check -> report
- Installable CLI and web workspace: `npm install -g structureclaw && sclaw start`
- Single-process installed mode where the backend serves the exported frontend
- Web UI, API backend, agent runtime, and backend-hosted Python analysis runtime in one platform
- Built-in analysis paths for OpenSees, PKPM SATWE, and YJK static workflows
- Regression and contract scripts for repeatable engineering validation

## Architecture

```text
browser UI
  -> Fastify backend (API + static frontend in installed mode)
  -> LangGraph agent runtime
  -> skill/tool layers
  -> Python analysis runtime (OpenSees / PKPM / YJK adapters)
  -> reports / metrics / artifacts
```

Main directories:

- `frontend/`: Next.js 14 application
- `backend/`: Fastify API, agent/chat flows, Prisma integration, and analysis execution host
- `scripts/`: startup helpers and the `sclaw` / `sclaw_cn` CLI implementation
- `tests/`: regression runner (`node tests/runner.mjs ...`), install smoke, and CI-covered frontend checks (type-check, Vitest, lint) after native smoke
- `docs/`: user handbook and protocol references

## Quick Start

### Install from npm

For normal use, install the CLI globally and let `sclaw doctor` create the runtime workspace:

```bash
npm install -g structureclaw
sclaw doctor
sclaw start
```

Installed mode stores user data under `~/.structureclaw/` on Unix-like systems and the platform application-data directory on Windows. This keeps databases, logs, reports, generated analysis files, `settings.json`, user skills, and user tools out of the read-only package directory.

### Run from source

For repository development, clone the repo and use the source checkout CLI:

```bash
./sclaw doctor
./sclaw start
./sclaw status
```

Source mode keeps runtime data under `.runtime/` and runs backend/frontend as development processes.

If Node.js is not installed yet, use the helper installer script first:

```bash
bash ./scripts/install-node-linux.sh
```

Windows PowerShell (run as Administrator for first-time package install):

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/install-node-windows.ps1
```

China mirror flow (same subcommands, mirror defaults enabled):

```bash
./sclaw_cn doctor
./sclaw_cn start
./sclaw_cn status
```

Notes:

- SQLite is the default local database. Installed mode resolves it under the user runtime data directory; source mode resolves it under `.runtime/data/`.
- `sclaw doctor` prepares the Python analysis environment automatically. In installed mode the virtual environment is created under the user runtime data directory instead of `node_modules`.
- Existing source-checkout `.runtime/` data can be migrated into the installed-mode runtime directory.
- Legacy `.env` values are migrated into `settings.json` when possible. `.env` remains a fallback for advanced and CI usage.
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
node .\sclaw docker-install --non-interactive --llm-base-url https://api.openai.com/v1 --llm-api-key <your-key> --llm-model gpt-4.1
```

Once the stack is ready, the main entrypoints are:

- Frontend: `http://localhost:31416`
- Backend health check: `http://localhost:31415/health`
- Analysis routes: `http://localhost:31415/analyze`
- Database status page: `http://localhost:31416/console/database`

To stop the containers:

```bash
node .\sclaw docker-stop
```

Or:

```bash
docker compose down
```

## Configuration

StructureClaw 1.0 uses `settings.json` as the primary user-facing configuration file. The General Settings panel writes the same settings through the backend admin API and shows whether each value comes from runtime settings, `.env`, or built-in defaults.

Configuration precedence:

1. Runtime `settings.json`
2. `.env` / shell environment
3. Built-in defaults

Important `settings.json` sections:

- `server`: ports, host, request body limit
- `llm`: OpenAI-compatible base URL, model, API key, timeout, retries
- `logging`: application log level, LLM logging, log rotation
- `analysis`: Python runtime path, timeout, engine manifest path
- `storage`: reports directory and upload size
- `agent`: workspace root, checkpoints, shell-tool policy
- `pkpm`: SATWE/JWSCYCLE path and work directory
- `yjk`: install root, executable, bundled Python, work directory, version, timeout, headless mode

`.env.example` remains the environment-variable reference for automation and source-checkout development.

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
