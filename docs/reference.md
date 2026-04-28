# StructureClaw Reference

## 1. Purpose

Protocol and contract quick reference for API integration, troubleshooting, and regression alignment.

## 2. Agent Run Contract

- Endpoint: `POST /api/v1/agent/run`
- Current orchestration is capability-driven and runs through the LangGraph ReAct agent.
- Execution chain: `detect_structure_type -> extract_draft_params -> build_model -> validate_model -> run_analysis -> run_code_check -> generate_report`

Current architecture notes:

- public product interaction uses the chat-first request shape
- skills and tools are optional capability layers
- see `docs/agent-architecture.md` for the current LangGraph agent design

Key result observability fields:

- `traceId`
- `startedAt`
- `completedAt`
- `durationMs`
- `metrics`
- `toolCalls`

Minimal request example:

```json
{
  "message": "Run static analysis and generate report",
  "context": {
    "modelFormat": "structuremodel-v1",
    "model": {
      "schema_version": "1.0.0",
      "unit_system": "SI",
      "nodes": [],
      "elements": [],
      "materials": [],
      "sections": [],
      "load_cases": [],
      "load_combinations": []
    }
  }
}
```

## 3. Chat and Streaming Contract

Endpoints:

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`

Notes:

- `chat/message` and `chat/stream` no longer accept a public `mode` field.
- chat requests are always single-entry; the backend decides whether the turn remains conversational or invokes tools.

Typical stream event sequence:

1. `start`
2. `interaction_update` (optional)
3. `result`
4. `done`

Failure path emits: `error`.

## 4. Backend-Hosted Analysis Contract

Main endpoints:

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`
- `GET /schema/converters`
- `GET /engines`
- `GET /engines/:id`
- `POST /engines/:id/check`

Built-in engine ids:

| Engine id | Adapter | Notes |
|---|---|---|
| `builtin-opensees` | `builtin-opensees` | OpenSeesPy-backed analysis skills |
| `builtin-pkpm` | `builtin-pkpm` | Requires local PKPM/SATWE runtime and `JWSCYCLE.exe` |
| `builtin-yjk` | `builtin-yjk` | Requires local YJK 8.0 runtime and valid authorization |

## 5. StructureModel v1 Baseline

Required baseline shape:

```json
{
  "schema_version": "1.0.0",
  "unit_system": "SI",
  "nodes": [],
  "elements": [],
  "materials": [],
  "sections": [],
  "load_cases": [],
  "load_combinations": []
}
```

Practical rules:

- Keep strict field names.
- Keep element references aligned with node/material/section IDs.
- Prefer `validate_model` before `run_analysis` when possible.

## 6. Runtime Settings Contract

StructureClaw 1.0 uses runtime `settings.json` as the user-facing configuration file. Configuration resolution can be summarized as:

1. `settings.json`
2. Selected environment-variable fallbacks
3. Built-in defaults

When the corresponding setting is absent, the backend reads `PORT`, `FRONTEND_PORT`, and `NODE_ENV` as fallbacks. `SCLAW_DATA_DIR` changes the runtime base directory used to locate `settings.json` and data files.

Admin settings endpoints:

- `GET /api/v1/admin/settings`
- `PUT /api/v1/admin/settings`

Settings sections:

- `server`
- `llm`
- `database`
- `logging`
- `analysis`
- `storage`
- `cors`
- `agent`
- `pkpm`
- `yjk`

Each returned field includes a value and source label so the UI can explain whether the effective value came from runtime settings or defaults.

## 7. SkillHub and User Extension Contract

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`
- `GET /api/v1/admin/skills`
- `POST /api/v1/admin/skills/reload`
- `GET /api/v1/admin/skills/:id`

User extension directories under the runtime data directory:

- `skills/<name>/skill.yaml`
- `skills/<name>/intent.md`, `draft.md`, `analysis.md`, `design.md` as needed
- `skills/<name>/handler.js` for executable handlers
- `tools/<name>/tool.yaml`
- `tools/<name>/tool.js`

Built-in skills take priority on id collisions. User tools are appended to the registered tool set at graph build time.

Priority rule:

- User manual toggles (skill/tool enable/disable) have the highest priority.
- Manual toggles override automatic activation, default sets, and policy suggestions.
- Any skill or tool manually disabled by the user must become immediately unavailable to the orchestrator.

## 8. Contract Validation Commands

Contract checks and grouped regressions run via `node tests/runner.mjs ...` (not `sclaw`). List validation names with `node tests/runner.mjs validate --list`.

Agent orchestration and protocol:

- `node tests/runner.mjs validate validate-agent-orchestration`
- `node tests/runner.mjs validate validate-agent-base-chat-fallback`
- `node tests/runner.mjs validate validate-agent-tools-contract`
- `node tests/runner.mjs validate validate-agent-api-contract`
- `node tests/runner.mjs validate validate-agent-capability-matrix`

SkillHub:

- `node tests/runner.mjs validate validate-agent-skillhub-cli`
- `node tests/runner.mjs validate validate-agent-skillhub-contract`
- `node tests/runner.mjs validate validate-agent-skillhub-repository-down`

Chat and messaging:

- `node tests/runner.mjs validate validate-chat-stream-contract`
- `node tests/runner.mjs validate validate-chat-message-routing`

Analysis and runtime:

- `node tests/runner.mjs validate validate-analyze-contract`
- `node tests/runner.mjs validate validate-opensees-runtime-and-routing`

Converter:

- `node tests/runner.mjs validate validate-converter-api-contract`
- `node tests/runner.mjs validate validate-convert-batch`
- `node tests/runner.mjs validate validate-convert-passrate`
- `node tests/runner.mjs validate validate-convert-roundtrip`
- `node tests/runner.mjs validate validate-midas-text-converter`

Code-check, report and schema:

- `node tests/runner.mjs validate validate-code-check-traceability`
- `node tests/runner.mjs validate validate-report-narrative-contract`
- `node tests/runner.mjs validate validate-schema-migration`

Regression:

- `node tests/runner.mjs validate validate-static-regression`
- `node tests/runner.mjs validate validate-static-3d-regression`
- `node tests/runner.mjs validate validate-structure-examples`

Dev startup:

- `node tests/runner.mjs validate validate-dev-startup-guards`

Regression entrypoints:

- `node tests/runner.mjs backend-regression`
- `node tests/runner.mjs analysis-regression`

## 9. Related Docs

- Operational guide: `docs/handbook.md`
- Agent architecture: `docs/agent-architecture.md`
- Chinese operational guide: `docs/handbook_CN.md`
- Chinese protocol reference: `docs/reference_CN.md`
- Skill loading mechanism: `docs/schema/skill-loading.md`
- Skill loading mechanism (Chinese): `docs/schema/skill-loading_CN.md`
- Utility tools specification: `docs/schema/utility-tools.md`
- Utility tools specification (Chinese): `docs/schema/utility-tools_CN.md`
- Chinese agent architecture: `docs/agent-architecture_CN.md`
