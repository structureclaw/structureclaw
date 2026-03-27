# StructureClaw 参考文档

## 1. 文档定位

用于 API 集成、契约对齐和问题排查的协议参考文档。

## 2. Agent 执行契约

- 入口：`POST /api/v1/agent/run`
- 模式：`chat`、`execute`、`auto`
- 执行链路：`text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

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

## 3. Chat 与流式契约

入口：

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`

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
- 建议先校验再分析。

## 6. SkillHub 契约

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`

## 7. 契约与回归命令

契约与分组回归通过 `node tests/runner.mjs ...` 执行（不再挂在 `sclaw` 上）。列出全部校验名：`node tests/runner.mjs validate --list`。

核心命令：

- `node tests/runner.mjs validate validate-agent-orchestration`
- `node tests/runner.mjs validate validate-agent-no-skill-fallback`
- `node tests/runner.mjs validate validate-agent-tools-contract`
- `node tests/runner.mjs validate validate-agent-api-contract`
- `node tests/runner.mjs validate validate-chat-stream-contract`
- `node tests/runner.mjs validate validate-chat-message-routing`
- `node tests/runner.mjs validate validate-report-template-contract`

回归入口：

- `node tests/runner.mjs backend-regression`
- `node tests/runner.mjs analysis-regression`

## 8. 相关文档

- 操作手册：`docs/handbook_CN.md`
- 英文操作手册：`docs/handbook.md`
- 英文协议参考：`docs/reference.md`
