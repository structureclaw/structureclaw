# StructureClaw 参考文档

## 1. 文档定位

用于 API 集成、契约对齐和问题排查的协议参考文档。

## 2. Agent 执行契约

- 入口：`POST /api/v1/agent/run`
- 当前内部编排已切换为能力驱动，planner 结果收敛为 `reply`、`ask` 和 `tool_call`
- 执行链路：`detect_structure_type -> extract_draft_params -> build_model -> validate_model -> run_analysis -> run_code_check -> generate_report`

架构方向：

- 对外产品交互应收口为单一 chat-first 请求形态
- skill 与 tool 都是可选能力层
- 目标能力驱动设计见 `docs/agent-architecture_CN.md`

结果侧关键可观测字段：

- `traceId`
- `startedAt`
- `completedAt`
- `durationMs`
- `metrics`
- `toolCalls`

最小请求示例：

```json
{
  "message": "执行静力分析并生成报告",
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

## 3. Chat 与流式契约

入口：

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`

说明：

- `chat/message` 与 `chat/stream` 不再接收公开 `mode` 字段。
- chat 请求统一为单入口，由后端自行决定本轮继续对话还是触发 tool。

典型流式事件顺序：

1. `start`
2. `interaction_update`（可选）
3. `result`
4. `done`

异常路径事件：`error`。

## 4. Backend 托管分析契约

核心接口：

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`
- `GET /schema/converters`

## 5. StructureModel v1 基线

最小结构：

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

实践规则：

- 字段名必须严格匹配。
- 单元引用必须与节点/材料/截面 ID 对齐。
- 建议优先执行 `validate_model` 再执行 `run_analysis`。

## 6. SkillHub 契约

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`

## 6.1 当前阶段能力边界（2026-04）

- 当前 skill：全部按内置 skill 运行。
- 外接 skill：指 SkillHub 技能包；该通道为预留能力，尚未投入生产执行链。
- 当前 tool：统一按外接 tool 治理。
- 内置 tool：指平台基础能力（如 read/write）；该通道当前为预留能力。

优先级规则：

- 用户手动开关（skill/tool enable/disable）优先级最高。
- 手动开关覆盖自动激活、默认集合与策略建议。
- 用户手动关闭的 skill 或 tool 必须立即失效，不允许被编排器调用。

## 7. 契约与回归命令

契约与分组回归通过 `node tests/runner.mjs ...` 执行（不再挂在 `sclaw` 上）。列出全部校验名：`node tests/runner.mjs validate --list`。

Agent 编排与协议：

- `node tests/runner.mjs validate validate-agent-orchestration`
- `node tests/runner.mjs validate validate-agent-base-chat-fallback`
- `node tests/runner.mjs validate validate-agent-tools-contract`
- `node tests/runner.mjs validate validate-agent-api-contract`
- `node tests/runner.mjs validate validate-agent-capability-matrix`

SkillHub：

- `node tests/runner.mjs validate validate-agent-skillhub-cli`
- `node tests/runner.mjs validate validate-agent-skillhub-contract`
- `node tests/runner.mjs validate validate-agent-skillhub-repository-down`

Chat 与消息：

- `node tests/runner.mjs validate validate-chat-stream-contract`
- `node tests/runner.mjs validate validate-chat-message-routing`

分析与运行时：

- `node tests/runner.mjs validate validate-analyze-contract`
- `node tests/runner.mjs validate validate-opensees-runtime-and-routing`

转换器：

- `node tests/runner.mjs validate validate-converter-api-contract`
- `node tests/runner.mjs validate validate-convert-batch`
- `node tests/runner.mjs validate validate-convert-passrate`
- `node tests/runner.mjs validate validate-convert-roundtrip`
- `node tests/runner.mjs validate validate-midas-text-converter`

校核、报告与 Schema：

- `node tests/runner.mjs validate validate-code-check-traceability`
- `node tests/runner.mjs validate validate-report-narrative-contract`
- `node tests/runner.mjs validate validate-schema-migration`

回归：

- `node tests/runner.mjs validate validate-static-regression`
- `node tests/runner.mjs validate validate-static-3d-regression`
- `node tests/runner.mjs validate validate-structure-examples`

开发启动守卫：

- `node tests/runner.mjs validate validate-dev-startup-guards`

回归入口：

- `node tests/runner.mjs backend-regression`
- `node tests/runner.mjs analysis-regression`

## 8. 相关文档

- 操作手册：`docs/handbook_CN.md`
- Agent 架构：`docs/agent-architecture_CN.md`
- 英文操作手册：`docs/handbook.md`
- 英文协议参考：`docs/reference.md`
- 技能加载机制：`docs/schema/skill-loading_CN.md`
- 技能加载机制（英文）：`docs/schema/skill-loading.md`
- 通用工具规格：`docs/schema/utility-tools_CN.md`
- 通用工具规格（英文）：`docs/schema/utility-tools.md`
- 英文 Agent 架构：`docs/agent-architecture.md`
