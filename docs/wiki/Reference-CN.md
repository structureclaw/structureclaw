# StructureClaw 参考文档 (Wiki)

> 本页镜像自 `docs/reference_CN.md`。更新时请同步修改。
> English: [Reference](Reference)

## API 契约

### Agent 执行

- `POST /api/v1/agent/run` — chat-first 编排入口
- 链路：`text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

### Chat 与流式

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`

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

### 当前阶段能力边界（2026-04）

- 当前 skill：全部按内置 skill 运行。
- 外接 skill：指 SkillHub 技能包；该通道为预留能力，尚未投入生产执行链。
- 当前 tool：统一按外接 tool 治理。
- 内置 tool：指平台基础能力（如 read/write）；该通道当前为预留能力。

优先级规则：

- 用户手动开关（skill/tool enable/disable）优先级最高。
- 手动开关覆盖自动激活、默认集合与策略建议。
- 用户手动关闭的 skill 或 tool 必须立即失效，不允许被编排器调用。

## 校验命令

所有校验通过 `node tests/runner.mjs validate <name>` 执行。完整列表：`node tests/runner.mjs validate --list`。

### Agent 编排与协议

- `validate-agent-orchestration`
- `validate-agent-base-chat-fallback`
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
- `validate-report-narrative-contract`
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
