# StructureClaw Reference (Wiki)

> This page mirrors `docs/reference.md`. When updating, keep both in sync.
> 中文版：[参考文档](Reference-CN)

## API Contracts

### Agent Run

- `POST /api/v1/agent/run` — modes: `chat`, `execute`, `auto`
- Chain: `text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

### Chat and Streaming

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`

Stream events: `start` → `interaction_update` (optional) → `result` → `done` (or `error`).

### Backend-Hosted Analysis

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`
- `GET /schema/converters`

### SkillHub

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`

## Validation Commands

All run via `node tests/runner.mjs validate <name>`. Full list: `node tests/runner.mjs validate --list`.

### Agent orchestration and protocol

- `validate-agent-orchestration`
- `validate-agent-no-skill-fallback`
- `validate-agent-tools-contract`
- `validate-agent-api-contract`
- `validate-agent-capability-matrix`

### SkillHub

- `validate-agent-skillhub-cli`
- `validate-agent-skillhub-contract`
- `validate-agent-skillhub-repository-down`

### Chat and messaging

- `validate-chat-stream-contract`
- `validate-chat-message-routing`

### Analysis and runtime

- `validate-analyze-contract`
- `validate-opensees-runtime-and-routing`

### Converter

- `validate-converter-api-contract`
- `validate-convert-batch`
- `validate-convert-passrate`
- `validate-convert-roundtrip`
- `validate-midas-text-converter`

### Code-check, report and schema

- `validate-code-check-traceability`
- `validate-report-template-contract`
- `validate-schema-migration`

### Regression

- `validate-static-regression`
- `validate-static-3d-regression`
- `validate-structure-examples`

### Dev startup

- `validate-dev-startup-guards`

## Regression Entrypoints

- `node tests/runner.mjs backend-regression`
- `node tests/runner.mjs analysis-regression`

## Reference Sources

- Full reference: https://github.com/structureclaw/structureclaw/blob/master/docs/reference.md
- Handbook: https://github.com/structureclaw/structureclaw/blob/master/docs/handbook.md
