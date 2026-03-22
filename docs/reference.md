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

## 7. Contract Validation Scripts

Primary orchestration and protocol scripts:

- `./scripts/validate-agent-orchestration.sh`
- `./scripts/validate-agent-no-skill-fallback.sh`
- `./scripts/validate-agent-tools-contract.sh`
- `./scripts/validate-agent-api-contract.sh`
- `./scripts/validate-chat-stream-contract.sh`
- `./scripts/validate-chat-message-routing.sh`
- `./scripts/validate-report-template-contract.sh`

Regression entrypoints:

- `make backend-regression`
- `make analysis-regression`

## 8. Related Docs

- Operational guide: `docs/handbook.md`
- Chinese operational guide: `docs/handbook_CN.md`
- Chinese protocol reference: `docs/reference_CN.md`
