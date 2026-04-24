# StructureClaw Reference

## 1. Purpose

Protocol and contract quick reference for API integration, troubleshooting, and regression alignment.

## 2. Agent Run Contract

- Endpoint: `POST /api/v1/agent/run`
- Current orchestration is capability-driven; planner outcomes converge on `reply`, `ask`, and `tool_call`
- Execution chain: `detect_structure_type -> extract_draft_params -> build_model -> validate_model -> run_analysis -> run_code_check -> generate_report`

Architecture direction:

- public product interaction should converge on a single chat-first request shape
- skills and tools are optional capability layers
- see `docs/agent-architecture.md` for the target capability-driven design

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

## 6. SkillHub Contract

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`

## 6.1 Current-Phase Capability Boundary (2026-04)

- Current skills: all shipped skills run as built-in skills.
- External skills: SkillHub packages; this channel is reserved and not yet active in production execution chains.
- Current tools: managed uniformly as external tools.
- Built-in tools: platform foundation capabilities (for example, read/write); this channel is currently reserved.

Priority rule:

- User manual toggles (skill/tool enable/disable) have the highest priority.
- Manual toggles override automatic activation, default sets, and policy suggestions.
- Any skill or tool manually disabled by the user must become immediately unavailable to the orchestrator.

## 7. Contract Validation Commands

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

## 8. Related Docs

- Operational guide: `docs/handbook.md`
- Agent architecture: `docs/agent-architecture.md`
- Chinese operational guide: `docs/handbook_CN.md`
- Chinese protocol reference: `docs/reference_CN.md`
- Skill loading mechanism: `docs/schema/skill-loading.md`
- Skill loading mechanism (Chinese): `docs/schema/skill-loading_CN.md`
- Utility tools specification: `docs/schema/utility-tools.md`
- Utility tools specification (Chinese): `docs/schema/utility-tools_CN.md`
- Chinese agent architecture: `docs/agent-architecture_CN.md`
