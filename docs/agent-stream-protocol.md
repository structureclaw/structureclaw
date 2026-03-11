# Agent Stream Protocol

最后更新：2026-03-11

## 1. 目标

定义 `POST /api/v1/chat/stream` 在 `mode=execute`（或 `mode=auto` 且带模型）时的 SSE 事件格式，便于前端稳定消费 Agent 执行链路。

## 2. 请求

```json
{
  "message": "请做静力分析",
  "mode": "execute",
  "traceId": "trace-demo-001",
  "context": {
    "modelFormat": "structuremodel-v1",
    "model": {
      "schema_version": "1.0.0",
      "nodes": [],
      "elements": [],
      "materials": [],
      "sections": []
    },
    "analysisType": "static",
    "autoAnalyze": true,
    "parameters": {}
  }
}
```

`mode` 语义：
- `chat`: 纯对话流，不触发工具。
- `execute`: 强制 Agent 工具流。
- `auto`: 有 `context.model` 则执行工具流，否则纯对话流。

## 3. SSE 事件

服务端统一以 `data: <json>\n\n` 推送，结束标志为 `data: [DONE]`。

### 3.1 `start`

```json
{
  "type": "start",
  "content": {
    "traceId": "4c5ac6de-6bbf-4d81-8a5f-5ef6f61391d0",
    "mode": "execute",
    "conversationId": "conv-001",
    "startedAt": "2026-03-09T02:00:00.000Z"
  }
}
```

### 3.2 `result`

```json
{
  "type": "result",
  "content": {
    "traceId": "4c5ac6de-6bbf-4d81-8a5f-5ef6f61391d0",
    "startedAt": "2026-03-09T02:00:00.000Z",
    "completedAt": "2026-03-09T02:00:00.187Z",
    "durationMs": 187,
    "success": true,
    "mode": "rule-based",
    "needsModelInput": false,
    "plan": ["校验模型字段与引用完整性", "执行 static 分析并返回摘要"],
    "toolCalls": [
      { "tool": "validate", "input": { "model": {} }, "output": {} },
      { "tool": "analyze", "input": { "type": "static", "model": {}, "parameters": {} }, "output": {} }
    ],
    "response": "分析完成。"
  }
}
```

### 3.3 `interaction_update`

在执行链路进入参数确认阶段时，服务端可先推送交互状态，再推送 `result`：

```json
{
  "type": "interaction_update",
  "content": {
    "state": "confirming",
    "stage": "model",
    "turnId": "turn-001",
    "questions": [],
    "pending": {
      "criticalMissing": ["跨度/长度（m）"],
      "nonCriticalMissing": ["分析类型（static/dynamic/seismic/nonlinear）"]
    }
  }
}
```

### 3.4 `done`

```json
{ "type": "done" }
```

### 3.5 `error`

```json
{ "type": "error", "error": "..." }
```

## 4. 前端状态机建议

- 收到 `start`：展示“Agent 开始执行”。
- 收到 `result`：一次性渲染 `plan/toolCalls/response`。
- 收到 `done`：结束加载状态。
- 收到 `error`：结束加载并展示错误。
- 收到 `[DONE]`：关闭 SSE 连接。

## 5. 最小消费示例

```ts
const es = new EventSource('/api/v1/chat/stream'); // 实际需用 fetch + readable stream 发送 POST

// 推荐实现：fetch('/api/v1/chat/stream', { method: 'POST', body })
// 逐行解析 "data:" 前缀的 SSE 帧
```

说明：当前后端为 POST SSE，浏览器原生 `EventSource` 不支持 POST，前端应使用 `fetch` 流式读取实现 SSE 帧解析。
