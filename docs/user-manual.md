# StructureClaw 使用说明书（当前版本）

最后更新：2026-03-11
适用版本：仓库主干当前代码（`0.1.0` 代）

## 1. 文档目标

本说明书用于说明当前代码已经具备的全部可用功能，以及对应使用方式。  
定位为“工程化 MVP 使用手册”，覆盖：

- 如何启动和验证系统
- 每个模块当前可用功能
- 主要 API 的请求方式与参数
- 回归测试和可用性检查
- 已知边界与注意事项

## 2. 系统组成与当前状态

当前仓库由 3 个核心服务 + 1 个前端组成：

- `frontend`：Next.js 前端原型（页面骨架 + 基础交互）
- `backend`：Fastify API 聚合层（业务入口、Agent 编排、会话、项目、社区等）
- `core`：FastAPI 分析引擎（模型校验、转换、分析、校核、设计）
- `postgres`/`redis`：数据与缓存依赖（Redis 可禁用并自动降级内存缓存）

当前阶段状态：**可直接使用的工程化 MVP**（可联调、可回归、可验证），但不是完整商业产品。

## 3. 环境准备

推荐环境：

- Node.js >= 18
- `curl` 或 `wget`（用于首次自动安装 `uv`）
- PostgreSQL >= 14
- Redis >= 7（可选）

关键环境变量：

- 根目录 `.env`：前端、后端、本地脚本、Docker 共用
- `PORT`：后端端口
- `FRONTEND_PORT`：前端本地开发端口
- `CORE_PORT`：分析引擎端口
- `NEXT_PUBLIC_API_URL`：前端请求后端地址
- `ANALYSIS_ENGINE_URL`：后端访问分析引擎地址；留空时自动按 `CORE_PORT` 推导
- `DATABASE_URL`
- `REDIS_URL`（可设 `disabled`）
- `LLM_PROVIDER`、`LLM_API_KEY`、`ZAI_API_KEY`、`OPENAI_API_KEY`
- `CORS_ORIGINS`：留空时自动按 `FRONTEND_PORT` 和 `PORT` 推导

## 4. 启动方式

### 4.1 一键方式（推荐）

```bash
make doctor
make start
make status
```

说明：

- `make doctor` 会自动安装 `uv`（若缺失），并使用 `uv` 创建 `core/.venv`
- 不再要求宿主机预装 Python

常用管理命令：

```bash
make stop
make logs
```

默认访问地址由根目录 `.env` 控制：

- Web：`http://localhost:<FRONTEND_PORT>`
- API：`http://localhost:<PORT>`
- API Docs：`http://localhost:<PORT>/docs`
- Analysis Engine：`http://localhost:<CORE_PORT>`

### 4.2 CLI 方式（与 openclaw 风格接近）

```bash
./sclaw help
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs all --follow
./sclaw stop
```

安装为全局命令：

```bash
make sclaw-install
sclaw version
```

### 4.3 手动分步方式（调试场景）

```bash
make install
make ensure-uv
make db-init
make setup-core-full
make dev-backend
make dev-frontend
make dev-core-full
```

## 5. 功能总览（当前已实现）

### 5.1 Agent 编排能力（核心）

主入口：

- `POST /api/v1/agent/run`
- `GET /api/v1/agent/tools`

当前工具链：

`text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

关键能力：

- 文本草模（LLM+规则混合，可降级）
- 缺参澄清与会话级补参（`conversationId`）
- 自动分析、自动规范校核、自动报告
- 报告落盘导出（`context.reportOutput=file`）
- 链路可观测字段：
  - `traceId`
  - `startedAt`
  - `completedAt`
  - `durationMs`
  - `metrics`（工具计数与耗时聚合）

### 5.2 Chat 能力

主入口：

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`（SSE）
- `POST /api/v1/chat/execute`（直接走 Agent 编排）
- `POST /api/v1/chat/conversation`
- `GET /api/v1/chat/conversation/:id`
- `GET /api/v1/chat/conversations`

`mode` 语义：

- `chat`：纯对话，不触发工具链
- `execute`：强制走 Agent 工具链
- `auto`：有 `context.model` 则走 execute；否则走 chat

说明：

- 未配置 LLM Key 时，聊天自动降级为固定提示，其他 API 可继续使用
- `traceId` 可由请求侧透传到 Agent 执行链路

### 5.3 Analysis 业务 API（Backend）

路由前缀：`/api/v1/analysis`

- `POST /models` 创建结构模型
- `GET /models/:id` 获取结构模型
- `POST /tasks` 创建分析任务
- `POST /tasks/:id/run` 运行分析任务（调用 core `/analyze`）
- `GET /tasks/:id/results` 获取分析结果
- `POST /code-check` 发起规范校核（透传 core `/code-check`）

### 5.4 Core 分析引擎（Python）

可用端点：

- `GET /`
- `GET /health`
- `GET /schema/structure-model-v1`
- `GET /schema/converters`
- `POST /validate`
- `POST /convert`
- `POST /analyze`（`static/dynamic/seismic/nonlinear`）
- `POST /code-check`
- `POST /design/beam`
- `POST /design/column`

当前分析能力重点：

- 静力线弹性 MVP：2D truss + 2D frame
- 支持节点力/均布荷载/组合/批量工况
- 输出位移、内力、反力与控制包络
- 支持转换 round-trip 与通过率校验
- 格式转换已支持 `midas-text-1` 最小子集（节点/单元/材料/截面/节点荷载/组合）
- 已覆盖转换器 API 契约回归（`/schema/converters` 与 `/convert` 错误码）

### 5.5 业务模块 API（Backend）

统一前缀：`/api/v1`

- Users：`/users/register`、`/users/login`、`/users/me` 等
- Projects：创建/列表/详情/更新/删除/成员/统计
- Skills：内置技能、技能管理、安装、执行、评分
- Community：帖子、评论、点赞、知识库、标签、搜索

说明：本地开发模式下，部分服务会自动补齐 demo 用户/项目，降低联调门槛。

### 5.6 前端

- Next.js 原型可启动与构建
- 支持接入后端 API
- 目前以功能联通为主，非最终产品 UI

## 6. 关键用法示例

### 6.1 查询 Agent 工具协议

```bash
curl -s http://localhost:<PORT>/api/v1/agent/tools | jq .
```

### 6.2 触发 Agent 执行闭环

```bash
curl -s -X POST http://localhost:<PORT>/api/v1/agent/run \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "请对模型做静力分析并按GB50017校核，生成报告",
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
      "autoCodeCheck": true,
      "includeReport": true,
      "reportFormat": "both",
      "reportOutput": "file"
    }
  }' | jq .
```

报告文件输出目录：

- `uploads/reports/<traceId>.json`
- `uploads/reports/<traceId>.md`

### 6.3 Chat `auto` 路由示例

- 不带模型：走纯聊天
- 带 `context.model`：自动走执行链路

```bash
curl -s -X POST http://localhost:<PORT>/api/v1/chat/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我分析","mode":"auto"}' | jq .
```

```bash
curl -s -X POST http://localhost:<PORT>/api/v1/chat/message \
  -H 'Content-Type: application/json' \
  -d '{
    "message":"帮我分析",
    "mode":"auto",
    "context":{"model":{"schema_version":"1.0.0","nodes":[],"elements":[],"materials":[],"sections":[]}}
  }' | jq .
```

### 6.4 Core 模型校验示例

```bash
curl -s -X POST http://localhost:<CORE_PORT>/validate \
  -H 'Content-Type: application/json' \
  -d '{"model":{"schema_version":"1.0.0","nodes":[],"elements":[],"materials":[],"sections":[],"load_cases":[],"load_combinations":[]}}' | jq .
```

## 7. 回归与可用性检查

### 7.1 Backend 回归（建议每次改动后执行）

```bash
make backend-regression
```

覆盖：

- backend build/lint/test
- agent 编排回归
- agent tools 协议契约
- agent/chat API 契约
- chat stream 契约
- chat message 路由契约
- 报告模板契约（摘要/关键指标/条文追溯/控制工况）
- prisma schema validate

### 7.2 Core 回归

```bash
make core-regression
```

覆盖：

- analyze 响应契约
- 静力黄金算例（2D + 3D 最小子集）
- schema 样例校验
- convert round-trip
- midas-text 转换器导入/导出与字段级报错
- converter API 契约（`/schema/converters` 与 `/convert` 错误码）
- schema migration
- batch convert（含 `failureByErrorCode` 失败分布）与通过率

### 7.3 全量自检

```bash
make doctor
```

## 8. 运行产物与日志

- 运行日志：`.runtime/logs/`
  - `frontend.log`
  - `backend.log`
  - `core.log`
- 报告导出：`uploads/reports/`

查看日志：

```bash
make logs
./sclaw logs all --follow
```

说明：
- `make logs`/`sclaw logs` 默认优先显示各服务“最近一次启动会话”日志，减少旧错误干扰。
- 后端 `GET /` 返回 404 属于预期（请使用 `/health` 验证健康状态）。
- 文档中的 `<PORT>/<FRONTEND_PORT>/<CORE_PORT>` 请替换为你根目录 `.env` 中的实际值。

### 8.1 常见前端排障

如果页面“可访问但没有任何样式”：

1. 确认 `frontend/postcss.config.js` 存在，且包含 `tailwindcss` 与 `autoprefixer`。  
2. 清理前端构建缓存并重启：

```bash
make stop
rm -rf frontend/.next
make start
```

3. 强制刷新浏览器缓存（`Ctrl+Shift+R`）。

如果控制台出现：

`Warning: Extra attributes from the server: inject_video_svd`

通常是浏览器扩展注入属性导致，不是服务端业务错误。可用无扩展隐身窗口复测以排除噪音。

## 9. 已知边界（当前版本）

- 分析能力已覆盖 2D + 3D 最小线弹性场景，更高阶分析待扩展
- 外部工程格式已接入 `midas-text-1` 最小子集，更多高频格式待扩展
- 前端仍以原型为主，复杂业务交互与设计系统待深化
- 当前强调“可跑通 + 可回归 + 可扩展”的工程基线

## 10. 快速自检清单（交付前）

1. `make backend-regression` 通过  
2. `make core-regression` 通过  
3. `make doctor` 通过  
4. `POST /api/v1/agent/run` 能返回 `traceId + metrics`  
5. `reportOutput=file` 能在 `uploads/reports` 看到产物  
