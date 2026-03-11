# StructureClaw

[English README](./README.md)

> 面向 AEC（Architecture, Engineering, Construction）行业的智能结构设计与分析助手平台。

## 项目概述

StructureClaw 是一个“LLM + 工程计算工具链”的多服务系统，目标是把结构工程常见流程串成统一闭环：

- 自然语言需求输入
- 结构模型生成/转换/校验
- 结构分析与规范校核
- 可追溯报告输出与执行指标观测

当前仓库已具备可联调的工程化 MVP，适合本地开发、接口集成、回归验证与后续扩展。

## 核心特性

- `🤖 Agent 编排闭环`: `text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`
- `🔁 Chat/Execute 双模式`: `chat | execute | auto` 路由，支持同步与 SSE 流式
- `🧩 会话级缺参澄清`: 基于 `conversationId` 的多轮补参与状态延续
- `📊 可观测执行结果`: `traceId/startedAt/completedAt/durationMs` + 工具耗时聚合指标
- `🧱 统一结构模型`: `StructureModel v1` + 校验 + 转换 + `v1.x` 迁移骨架
- `📄 报告导出`: 支持 JSON/Markdown，`reportOutput=file` 可落盘到 `uploads/reports`

## 当前状态（MVP）

这个仓库目前已经整理成可运行的多服务原型，包含：

- `frontend`: Next.js 14 前端
- `backend`: Fastify + Prisma + Redis/Postgres 接入的 API 服务
- `core`: FastAPI 结构分析引擎
- `docker-compose.yml`: 编排数据库、缓存、前后端和 Nginx

目前更接近“可运行的工程化 MVP”而不是完整产品，部分模块仍是最小实现，但核心开发链路已可跑通并可回归。

## 技术架构

```text
┌───────────────────────────────────────────────────────────────┐
│                       StructureClaw                           │
├───────────────────────────────────────────────────────────────┤
│ Frontend (Next.js 14)            │ API Layer (Fastify)        │
│ - React 18                        │ - TypeScript               │
│ - Tailwind CSS                    │ - Prisma ORM               │
│ - 调试控制台 (/console)           │ - Agent/Chat/Project 等路由│
├───────────────────────────────────────────────────────────────┤
│ Core Engine (FastAPI, Python 3.11+)                          │
│ - StructureModel schema/validate/convert                     │
│ - analyze / code-check / design                              │
├───────────────────────────────────────────────────────────────┤
│ Data & Runtime                                                │
│ - PostgreSQL (业务数据)                                       │
│ - Redis/内存降级缓存                                           │
│ - Docker Compose / Make / sclaw CLI                          │
└───────────────────────────────────────────────────────────────┘
```

请求主链路：

```text
Browser/UI
  -> /api/v1/chat/message|stream|execute 或 /api/v1/agent/run
  -> Backend AgentService
  -> Core /validate /convert /analyze /code-check
  -> Report + Metrics + Artifacts
```

## 目录结构

```text
structureclaw/
├── backend/                 # Fastify API + Prisma
├── core/                    # FastAPI 分析引擎
├── frontend/                # Next.js 前端
├── docker/                  # Nginx 配置
├── docs/                    # 预留文档目录
├── plugins/                 # 预留插件目录
├── services/                # 预留微服务目录
├── tests/                   # 预留测试目录
├── .env.example             # Docker Compose 用环境变量示例
├── Makefile                 # 常用开发命令
└── docker-compose.yml
```

## 环境要求

推荐直接使用 Docker（门槛最低）：

- Docker Engine / Docker Desktop
- Docker Compose v2

本地源码开发（非 Docker）时需要：

- Node.js >= 18
- `curl` 或 `wget`（用于首次自动安装 `uv`）
- PostgreSQL >= 14（必须）
- Redis >= 7（可选，不启用时自动降级内存缓存）

## 快速开始

### 30 秒上手（默认推荐）

第一次进入仓库，只需要这 3 条命令：

```bash
make doctor
make start
make status
```

补充：

- `make doctor`: 启动前自检（会自动安装 `uv` 并补齐 `core/.venv`，不拉起完整服务）
- `make start`: 新手默认启动（会自动安装 `uv`，再创建并使用 uv 管理的 Python 3.11）
- `make status`: 查看进程和健康状态
- `make stop`: 停止本地服务和基础设施
- `make logs`: 查看日志（默认 frontend/backend/core）

### 命令入口（独立 CLI）

仓库根目录内可直接使用：

```bash
./sclaw help
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs all --follow
./sclaw stop
```

安装为全局命令（更像 openclaw）：

```bash
make sclaw-install
sclaw version
sclaw start
```

也支持 npm 全局安装（安装后可直接用 `sclaw`）：

```bash
npm install -g .
sclaw version
sclaw start
```

### 进阶场景

1. 完整分析依赖（非 lite）：

```bash
make start-full
```

2. 继续使用兼容保留的旧命令：

```bash
make local-up-uv
make local-up-full-uv
make local-down
make local-status
```

3. Docker 全容器栈：

```bash
cp .env.example .env
make up
```

4. 手动分步启动（调试某个服务）：

```bash
make install
make ensure-uv
make db-init
make setup-core-lite
make dev-backend
make dev-frontend
make dev-core-lite
```

## 最常用命令

```bash
make doctor
make start
make status
make stop
make logs
```

后端回归（CI 同步入口）：

```bash
make backend-regression
```

Core 回归：

```bash
make core-regression
```

启动后访问：

- Web: `http://localhost:<FRONTEND_PORT>`
- API: `http://localhost:<PORT>`
- API Docs: `http://localhost:<PORT>/docs`
- Analysis Engine: `http://localhost:<CORE_PORT>`

## 开发文档

- 当前版本完整说明书：`docs/user-manual.md`
- 开发路线与已完成功能清单：`docs/development-roadmap.md`
- Agent 流式执行协议：`docs/agent-stream-protocol.md`
- 批量转换验证脚本：`scripts/validate-convert-batch.sh`
- Schema 迁移验证脚本：`scripts/validate-schema-migration.sh`
- 转换通过率验证脚本：`scripts/validate-convert-passrate.sh`
- 转换器 API 契约脚本：`scripts/validate-converter-api-contract.sh`
- 报告模板契约脚本：`scripts/validate-report-template-contract.sh`
- 后端回归入口脚本：`scripts/check-backend-regression.sh`

## 环境变量

### 根目录 `.env`

前端、后端、本地启动脚本、`docker compose` 统一使用根目录 `.env`：

```bash
NODE_ENV=development
HOST=0.0.0.0
PORT=8000
FRONTEND_PORT=3000
CORE_PORT=8001
NEXT_PUBLIC_API_URL=http://localhost:<PORT>
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/structureclaw
REDIS_URL=disabled
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
LLM_PROVIDER=openai
LLM_API_KEY=
LLM_MODEL=
LLM_BASE_URL=
ANALYSIS_ENGINE_URL=
CORS_ORIGINS=
OPENAI_API_KEY=
ZAI_API_KEY=
```

说明：

- 未配置可用 LLM Key 时（`LLM_API_KEY/OPENAI_API_KEY/ZAI_API_KEY`），聊天接口自动降级提示
- `REDIS_URL=disabled` 表示禁用 Redis，后端自动降级为内存缓存
- `PORT` 控制后端端口
- `FRONTEND_PORT` 控制前端本地 dev 端口
- `CORE_PORT` 控制分析引擎本地端口
- `NEXT_PUBLIC_API_URL` 控制前端请求后端地址
- `ANALYSIS_ENGINE_URL` 留空时，自动按 `CORE_PORT` 推导为 `http://localhost:<CORE_PORT>`
- `CORS_ORIGINS` 留空时，自动按 `FRONTEND_PORT` 和 `PORT` 推导
- 智谱示例（兼容 OpenAI 接口）：
```bash
LLM_PROVIDER=zhipu
ZAI_API_KEY=your-zhipu-key
# 可选覆盖
# LLM_MODEL=glm-4-plus
# LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
```
参考文档：`https://docs.bigmodel.cn/cn/guide/start/introduction`

### Prisma 初始化

后端现在已经包含：

- `backend/prisma/migrations/20260308000100_init/migration.sql`
- `backend/prisma/seed.ts`

常用命令：

```bash
npm run db:validate --prefix backend
npm run db:deploy --prefix backend
npm run db:seed --prefix backend
npm run db:init --prefix backend
```

## 已验证的运行状态

2026-03-09 在当前环境已验证：

- 后端可成功编译
- 后端 lint 可运行
- 后端测试命令可运行（当前含 Agent 服务回归测试）
- Prisma schema 校验通过
- `make backend-regression` 全通过（构建/lint/test + Agent/Chat 契约回归）
- 前端类型检查通过
- 前端 lint 通过
- 前端 `next build` 可通过（已内置 `EXDEV` rename 兼容补丁）
- `uv 0.10.8` 可创建 Python 3.11 环境
- `core` 可在 lite 依赖下导入并执行简化静力分析
- Core 静力回归覆盖 2D + 3D truss/3D frame 最小子集（单工况/组合/批量包络/弯曲工况）算例
- `make doctor`（等价于 `make check-startup`）可通过

## 当前阶段可用性确认（2026-03-09）

当前代码已达到“可直接使用的工程化 MVP”状态，可用于本地联调、接口对接和回归验证：

- Agent 执行闭环可用：`text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`
- Chat/Agent 双入口可用：`/api/v1/agent/run`、`/api/v1/chat/execute`、`/api/v1/chat/message`、`/api/v1/chat/stream`
- 会话级缺参澄清可用：同一 `conversationId` 支持多轮补参与继续建模
- 执行可观测性可用：`traceId/startedAt/completedAt/durationMs` + 工具耗时聚合指标
- 回归入口可用：`make backend-regression`、`make core-regression`、`make doctor`

当前不属于“完整产品版”：

- 结构分析目前以 2D 线弹性 MVP 为主，3D 与高级工况能力仍在后续阶段
- 外部工程格式转换尚未完成首批高频格式接入（当前以内部标准与简化格式为主）

说明：

- 在当前机器上 Docker daemon 无访问权限，因此未能在本机完成 `make local-up` 的全链路实启；如你的环境 Docker 可用，该流程应可直接跑通。
- 前端构建已通过 `frontend/scripts/fs-rename-fallback.cjs` 规避当前文件系统上的 `EXDEV`（跨设备 rename）问题，`make doctor` 可完成可选 `next build` 检查。
- 当前沙箱不允许本地监听端口，因此这里未直接完成 `uvicorn` 端口绑定验证；已通过导入和分析调用确认 `core` 进程本身可启动。

## 当前已实现的主要接口

### Backend

- `GET /health`
- `GET /docs`
- `GET /api/v1`
- `POST /api/v1/agent/run`
- `GET /api/v1/agent/tools`
- `POST /api/v1/chat/execute`
- `POST /api/v1/chat/stream` (`mode=chat|execute|auto`)
- `agent/run` 已支持最小文本草模（梁/双跨梁/平面桁架/门式刚架）与会话级缺参澄清补数
- `agent/run` 已支持 `analyze -> code-check -> report` 闭环（可按上下文开关）
- `agent/run` 报告支持 `reportOutput=file` 落盘至 `uploads/reports/`
- `GET /api/v1/users/*`
- `GET /api/v1/projects/*`
- `GET /api/v1/skills/*`
- `GET /api/v1/community/*`
- `GET /api/v1/analysis/*`

常用端点（建议优先调试）：

- `GET /api/v1/agent/tools`
- `POST /api/v1/agent/run`
- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`
- `GET /health`
- `GET /docs`

### Core

- `GET /`
- `GET /health`
- `GET /schema/converters`
- `POST /convert`（支持 `structuremodel-v1`、`simple-1`、`compact-1`、`midas-text-1`）
- `POST /validate`
- `POST /analyze`
- `POST /code-check`
- `POST /design/beam`
- `POST /design/column`
- `POST /code-check` 支持可追溯校核字段（`clause/formula/inputs/utilization`）

## 已知说明

- 当前部分后端业务实现属于“最小可运行版本”，用于确保启动链路、数据流和接口结构可用
- 如果未配置 Redis，后端会使用内存缓存降级模式
- `core/requirements.txt` 包含较重的工程分析依赖，首次安装可能较慢
- `core/requirements-lite.txt` 适合本地快速起服务，但不代表具备完整分析能力
- 对新手来说，最省事的路径是先 `make doctor`，再 `make start`

## 后续建议

适合下一步继续完善的方向：

1. 补齐 3D 静力线弹性能力与黄金算例回归（阶段 B 深化）
2. 接入首个外部工程格式转换器（阶段 C）
3. 增强报告模板（结构化章节、可读性与可追溯展示）
4. 持续收敛 Agent 工具协议与观测指标（面向生产可运维）

## 许可证

本项目采用 MIT 许可证，详见 `LICENSE`。
