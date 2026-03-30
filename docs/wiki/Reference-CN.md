# StructureClaw 参考文档 (Wiki)

> 本页镜像自 `docs/reference_CN.md`。更新时请同步修改。
> English: [Reference](Reference)

## API 契约

### Agent 执行

- `POST /api/v1/agent/run` — 模式：`chat`、`execute`、`auto`
- 链路：`text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

### Chat 与流式

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`

流式事件：`start` → `interaction_update`（可选）→ `result` → `done`（或 `error`）。

### 后端托管分析

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

## 校验命令

所有校验通过 `node tests/runner.mjs validate <name>` 执行。完整列表：`node tests/runner.mjs validate --list`。

### Agent 编排与协议

- `validate-agent-orchestration`
- `validate-agent-no-skill-fallback`
- `validate-agent-tools-contract`
- `validate-agent-api-contract`
- `validate-agent-capability-matrix`

### SkillHub

- `validate-agent-skillhub-cli`
- `validate-agent-skillhub-contract`
- `validate-agent-skillhub-repository-down`

### Chat 与消息

- `validate-chat-stream-contract`
- `validate-chat-message-routing`

### 分析与运行时

- `validate-analyze-contract`
- `validate-opensees-runtime-and-routing`

### 转换器

- `validate-converter-api-contract`
- `validate-convert-batch`
- `validate-convert-passrate`
- `validate-convert-roundtrip`
- `validate-midas-text-converter`

### 校核、报告与 Schema

- `validate-code-check-traceability`
- `validate-report-template-contract`
- `validate-schema-migration`

### 回归

- `validate-static-regression`
- `validate-static-3d-regression`
- `validate-structure-examples`

### 开发启动守卫

- `validate-dev-startup-guards`

## 回归入口

- `node tests/runner.mjs backend-regression`
- `node tests/runner.mjs analysis-regression`

## 规范来源

- 完整参考文档：https://github.com/structureclaw/structureclaw/blob/master/docs/reference_CN.md
- 使用手册：https://github.com/structureclaw/structureclaw/blob/master/docs/handbook_CN.md
