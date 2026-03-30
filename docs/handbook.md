# StructureClaw Handbook

## 1. Purpose

This handbook is the practical guide for running, developing, validating, and extending StructureClaw.

Use this file for day-to-day engineering work. Use `docs/reference.md` for protocol-level details.

## 2. Project Scope

StructureClaw is an AI-assisted structural engineering platform with a monorepo architecture:

- `frontend`: Next.js 14 product and console UI
- `backend`: Fastify + Prisma API, agent orchestration, and the hosted Python analysis runtime

Primary workflow:

```text
natural language -> draft model -> validate -> analyze -> code-check -> report
```

## 3. Prerequisites

Recommended local setup:

- Node.js 18+
- Python 3.12

Optional:

- Docker Engine / Docker Desktop
- Docker Compose v2
- Redis 7+ (only if you explicitly enable `REDIS_URL`)

## 4. Repository Structure

```text
frontend/   Next.js application
backend/    Fastify API, agent skills, hosted analysis runtime, Prisma schema, tests
scripts/    startup scripts and contract/regression validators
docs/       handbook and protocol reference
.runtime/   local runtime data, logs, and generated report artifacts
```

## 5. Getting Started

### 5.0 Node.js setup (optional)

If Node.js is not installed yet, use the helper installer script first:

```bash
bash ./scripts/install-node-linux.sh
```

Windows PowerShell (run as Administrator for first-time package install):

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/install-node-windows.ps1
```

### 5.1 Recommended path

```bash
./sclaw doctor
./sclaw start
./sclaw status
```

`./sclaw start` is the SQLite local-first startup path. It starts frontend and backend from source and does not invoke Docker.

### 5.2 Common lifecycle commands

```bash
./sclaw logs
./sclaw stop
./sclaw restart
```

### 5.3 CLI alternative

```bash
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs all --follow
./sclaw stop
```

### 5.4 Windows PowerShell

```powershell
node .\sclaw doctor
node .\sclaw start
node .\sclaw status
node .\sclaw logs all --follow
node .\sclaw stop
```

For Docker-based Windows onboarding, use `node .\sclaw docker-install`, `node .\sclaw docker-start`, and `node .\sclaw docker-stop`.

### 5.5 SkillHub CLI

Manage installable skills from the command line:

```bash
./sclaw skill list                          # list installed skills
./sclaw skill search <keyword> [domain]     # search the skill registry
./sclaw skill install <skill-id>            # install a skill
./sclaw skill enable <skill-id>             # enable an installed skill
./sclaw skill disable <skill-id>            # disable a skill
./sclaw skill uninstall <skill-id>          # uninstall a skill
```

## 6. Environment and Configuration

Start with `.env.example`.

Important variables:

- Runtime: `NODE_ENV`, `PORT`, `FRONTEND_PORT`
- Data: `DATABASE_URL`, `REDIS_URL`
- LLM: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- Integration: `ANALYSIS_PYTHON_BIN`, `ANALYSIS_ENGINE_MANIFEST_PATH`, `CORS_ORIGINS`

Notes:

- `DATABASE_URL` defaults to a local SQLite file under `.runtime/data`.
- `REDIS_URL=disabled` enables in-memory fallback mode in backend.
- `ANALYSIS_PYTHON_BIN` defaults to `backend/.venv/bin/python`.

## 7. Primary Workflows

### 7.1 Chat and Agent execution

Main backend endpoints:

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`
- `POST /api/v1/agent/run`

Execution chain:

`text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

### 7.2 Backend-hosted analysis runtime

Compatibility endpoints exposed by backend:

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`
- `GET /engines`

## 8. StructureModel Governance

- Required baseline: `schema_version: "1.0.0"`
- Keep strict field naming for nodes/elements/materials/sections/loads
- Always validate models before analyze/code-check where possible

## 9. Skill and No-Skill Behavior

- Skills are enhancement layers, not a hard dependency for the full workflow.
- If selected skills do not match the request, fallback uses generic no-skill modeling.
- New user-visible copy must be provided in both English and Chinese.

Built-in skill domains under `backend/src/agent-skills/`:

| Domain | Description |
|---|---|
| `structure-type` | Structural type recognition (beam, frame, truss, portal-frame, etc.) |
| `analysis` | OpenSees and Simplified analysis execution |
| `code-check` | Design code compliance checking |
| `data-input` | Structured data input parsing |
| `design` | Structural design assistance |
| `drawing` | Drawing and visualization generation |
| `load-boundary` | Load and boundary condition handling |
| `material` | Material property management |
| `report-export` | Report generation and export |
| `result-postprocess` | Post-processing of analysis results |
| `section` | Cross-section property calculation |
| `validation` | Model validation checks |
| `visualization` | 3D model visualization |

## 10. Quality and Regression

### 10.1 Backend

```bash
npm run build --prefix backend
npm run lint --prefix backend
npm test --prefix backend -- --runInBand
```

### 10.2 Frontend

```bash
npm run build --prefix frontend
npm run type-check --prefix frontend
npm run test:run --prefix frontend
```

### 10.3 Analysis runtime and contracts

```bash
node tests/runner.mjs analysis-regression
node tests/runner.mjs backend-regression
```

Useful targeted validators:

- `node tests/runner.mjs validate validate-agent-orchestration`
- `node tests/runner.mjs validate validate-agent-tools-contract`
- `node tests/runner.mjs validate validate-chat-stream-contract`
- `node tests/runner.mjs validate validate-analyze-contract`

## 11. Contributing Workflow

1. Create focused, small-scope changes.
2. Keep module boundaries intact.
3. Run targeted tests and required regression scripts.
4. Use clear conventional commit messages.
5. Document behavior changes in handbook/reference when needed.

Contribution details: `CONTRIBUTING.md`.

## 12. Troubleshooting

- If startup fails, run `./sclaw doctor` first.
- If DB-related tests fail locally, verify that `DATABASE_URL` starts with `file:` and points to a writable local path.
- If LLM flow degrades unexpectedly, confirm `LLM_PROVIDER` and API key env variables.
- If contracts fail, run the corresponding `node tests/runner.mjs validate <name>` command directly for focused diagnostics.

## 13. Related Documents

- Protocol reference: `docs/reference.md`
- Chinese handbook: `docs/handbook_CN.md`
- Chinese protocol reference: `docs/reference_CN.md`
- English overview: `README.md`
- Chinese overview: `README_CN.md`
