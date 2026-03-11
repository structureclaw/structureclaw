# StructureClaw 项目总览

## 1. 项目定位

StructureClaw 是一个面向 AEC 行业的智能结构设计与分析平台，目标是把自然语言输入、结构模型生成与转换、结构分析、规范校核、报告输出串成统一闭环。

当前仓库是一个单仓多服务工程，主要包含三层运行单元：

- `frontend`：Next.js 前端界面与控制台
- `backend`：Fastify + Prisma API 与 Agent 编排层
- `core`：FastAPI 结构分析与格式转换引擎

从现状看，这个仓库已经是“可运行、可联调、可回归”的工程化 MVP，但还不是完整的生产级产品。

## 2. 当前核心能力

- 基于自然语言的 Agent 工具链编排
- `chat / execute / auto` 三种请求模式
- 结构模型校验与格式转换
- `static / dynamic / seismic / nonlinear` 分析入口
- 基础规范校核与设计接口
- 带 `traceId`、耗时指标、工件输出的可追溯执行结果

当前主链路可概括为：

```text
前端 / 控制台
  -> 后端 API (/api/v1/chat/*, /api/v1/agent/*)
  -> AgentService 编排
  -> Core 引擎 (/validate, /convert, /analyze, /code-check)
  -> 报告 / 指标 / 工件
```

## 3. 仓库结构

```text
.
├── frontend/   Next.js 前端、控制台页面、组件测试
├── backend/    Fastify API、Prisma 模型、Agent/Chat/Project 服务
├── core/       FastAPI 引擎、有限元分析、转换器、结构模型 Schema
├── scripts/    本地启动、回归、契约校验脚本
├── docs/       深度产品文档与协议文档
├── docker/     Nginx 与容器运行配置
├── uploads/    生成报告等工件输出目录
├── Makefile    开发命令统一入口
└── sclaw       CLI 入口
```

## 4. 运行分层

### 前端

- Next.js 14 App Router
- 路由分组：`(marketing)` 与 `(console)`
- Tailwind CSS + Radix UI 组件体系
- Vitest + Testing Library 测试体系

### 后端

- Fastify HTTP 服务
- Prisma + PostgreSQL 数据层
- Redis 缓存，支持内存降级
- Agent 工作流：`text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

### 核心计算层

- FastAPI 服务，提供校验、转换、分析、校核接口
- `StructureModelV1` 作为核心数据边界
- 内置回退求解路径 + 外部结构分析库支持

## 5. 开发与验证方式

常用本地命令：

```bash
make doctor
make start
make status
make stop
make backend-regression
make core-regression
```

仓库中已经具备的主要验证资产：

- Backend Jest 测试
- Frontend Vitest 测试
- Core 2D/3D 静力黄金算例回归
- `scripts/` 下的契约与冒烟脚本

## 6. 当前工程判断

这个仓库的优势已经比较明确：

- 多服务骨架完整，能本地联调
- 主链路 API 和契约验证较齐全
- 结构工程领域边界清晰

当前主要短板也很明确：

- 根目录缺少统一的项目说明与协作文档
- 前后端代码风格还未完全统一
- Python 工具链配置尚未集中化
- 路线图主要存在于 `docs/`，缺少面向协作者的根目录摘要版

## 7. 建议的协作原则

- 把 `frontend`、`backend`、`core` 视为独立交付单元，但共享同一领域模型
- 任何 API 契约调整都应尽量配套脚本或测试验证
- 在没有统一格式化方案前，优先遵循子项目已有风格，避免大规模无关重排
- 根目录文档负责新人入门，`docs/` 负责深入说明和协议细节
