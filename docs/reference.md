# StructureClaw Reference

## 1. Purpose

Protocol and contract quick reference for API integration, troubleshooting, and regression alignment.

## 2. Agent Run Contract

- Endpoint: `POST /api/v1/agent/run`
- Modes: `chat`, `execute`, `auto`
- Execution chain: `text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

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
  "mode": "auto",
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
- `POST /api/v1/chat/execute`

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
- Validate before analysis when possible.

## 6. SkillHub Contract

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`

## 7. Contract Validation Commands

Contract checks and grouped regressions run via `node tests/runner.mjs ...` (not `sclaw`). List validation names with `node tests/runner.mjs validate --list`.

Agent orchestration and protocol:

- `node tests/runner.mjs validate validate-agent-orchestration`
- `node tests/runner.mjs validate validate-agent-no-skill-fallback`
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
- `node tests/runner.mjs validate validate-report-template-contract`
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
- Chinese operational guide: `docs/handbook_CN.md`
- Chinese protocol reference: `docs/reference_CN.md`
