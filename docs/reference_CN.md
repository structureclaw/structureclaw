# StructureClaw 参考文档

## 1. 文档定位

用于 API 集成、契约对齐和问题排查的协议参考文档。

## 2. Agent 执行契约

- 入口：`POST /api/v1/agent/run`
- 当前内部编排为能力驱动，并通过 LangGraph ReAct agent 执行。
- 执行链路：`detect_structure_type -> extract_draft_params -> build_model -> validate_model -> run_analysis -> run_code_check -> generate_report`

当前架构说明：

- 对外产品交互使用 chat-first 请求形态
- skill 与 tool 都是可选能力层
- 当前 LangGraph agent 设计见 `docs/agent-architecture_CN.md`

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
- `GET /engines`
- `GET /engines/:id`
- `POST /engines/:id/check`

内置 engine id：

| Engine id | Adapter | 说明 |
|---|---|---|
| `builtin-opensees` | `builtin-opensees` | OpenSeesPy 支持的分析技能 |
| `builtin-pkpm` | `builtin-pkpm` | 需要本机 PKPM/SATWE 运行环境与 `JWSCYCLE.exe` |
| `builtin-yjk` | `builtin-yjk` | 需要本机 YJK 8.0 运行环境与有效授权 |

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

## 6. 运行时 Settings 契约

StructureClaw 1.0 使用运行时 `settings.json` 作为用户配置文件。配置解析可概括为以下顺序：

1. `settings.json`
2. 部分环境变量兜底
3. 内置默认值

当对应配置缺失时，后端会读取 `PORT`、`FRONTEND_PORT`、`NODE_ENV` 作为兜底；`SCLAW_DATA_DIR` 会改变用于查找 `settings.json` 和数据文件的运行基础目录。

Admin settings 接口：

- `GET /api/v1/admin/settings`
- `PUT /api/v1/admin/settings`

Settings section：

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

返回字段会同时带上 value 和 source，便于 UI 展示当前有效值来自 runtime settings 还是默认值。

## 7. SkillHub 与用户扩展契约

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`
- `GET /api/v1/admin/skills`
- `POST /api/v1/admin/skills/reload`
- `GET /api/v1/admin/skills/:id`

用户运行目录下的扩展目录：

- `skills/<name>/skill.yaml`
- `skills/<name>/intent.md`、`draft.md`、`analysis.md`、`design.md` 等阶段文件
- `skills/<name>/handler.js`，用于可执行 handler
- `tools/<name>/tool.yaml`
- `tools/<name>/tool.js`

当 id 冲突时，内置 skill 优先。用户 tool 会在图构建时追加到已注册工具集合。

优先级规则：

- 用户手动开关（skill/tool enable/disable）优先级最高。
- 手动开关覆盖自动激活、默认集合与策略建议。
- 用户手动关闭的 skill 或 tool 必须立即失效，不允许被编排器调用。

## 8. 契约与回归命令

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

## 9. 相关文档

- 操作手册：`docs/handbook_CN.md`
- Agent 架构：`docs/agent-architecture_CN.md`
- 英文操作手册：`docs/handbook.md`
- 英文协议参考：`docs/reference.md`
- 技能加载机制：`docs/schema/skill-loading_CN.md`
- 技能加载机制（英文）：`docs/schema/skill-loading.md`
- 通用工具规格：`docs/schema/utility-tools_CN.md`
- 通用工具规格（英文）：`docs/schema/utility-tools.md`
- 英文 Agent 架构：`docs/agent-architecture.md`
