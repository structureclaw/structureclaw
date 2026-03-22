# StructureClaw 使用手册

## 1. 文档定位

本文档用于指导 StructureClaw 的运行、开发、验证与扩展。

日常工程协作请以本文档为主；协议字段与契约细节请参考 `docs/reference_CN.md`。

## 2. 项目范围

StructureClaw 是一个 AI 协同结构工程平台，采用单仓多服务架构：

- `frontend`：Next.js 14 前端与控制台
- `backend`：Fastify + Prisma API、Agent 编排层，以及托管式 Python 结构分析运行时

主流程：

```text
自然语言需求 -> 建模草案 -> 校验 -> 分析 -> 校核 -> 报告
```

## 3. 环境要求

推荐的本地环境：

- Node.js 18+
- Python 3.11

可选：

- Docker Engine / Docker Desktop
- Docker Compose v2
- Redis 7+（仅在你显式启用 `REDIS_URL` 时需要）

## 4. 仓库结构

```text
frontend/   Next.js 前端应用
backend/    Fastify API、agent skills、托管分析运行时、Prisma 模型、后端测试
scripts/    启动脚本与契约/回归校验脚本
docs/       手册与协议参考文档
uploads/    报告工件输出目录
```

## 5. 快速上手

### 5.1 推荐路径

```bash
make doctor
make start
make status
```

`make start` 是 SQLite 本地优先的启动路径，会直接从源码启动 frontend 和 backend，不会调用 Docker。

### 5.2 常用生命周期命令

```bash
make logs
make stop
make restart
```

### 5.3 CLI 方式

```bash
./sclaw doctor
./sclaw start
./sclaw status
./sclaw logs all --follow
./sclaw stop
```

### 5.4 Windows PowerShell

```powershell
.\make.ps1 doctor
.\make.ps1 start
.\make.ps1 status
.\make.ps1 logs all --follow
.\make.ps1 stop
```

`make.ps1` 是 Windows 原生的本地开发入口；如果使用 `cmd.exe`，也可以通过仓库里的 `make.cmd` 进行转发启动。

## 6. 环境变量与配置

请基于 `.env.example` 配置。

关键变量：

- 运行时：`NODE_ENV`、`PORT`、`FRONTEND_PORT`
- 数据层：`DATABASE_URL`、`REDIS_URL`
- LLM：`LLM_PROVIDER`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_BASE_URL`
- 集成：`ANALYSIS_PYTHON_BIN`、`ANALYSIS_ENGINE_MANIFEST_PATH`、`CORS_ORIGINS`

说明：

- `DATABASE_URL` 默认指向 `.runtime/data` 下的本地 SQLite 文件。
- `REDIS_URL=disabled` 时后端使用内存降级缓存。
- `ANALYSIS_PYTHON_BIN` 默认指向 `backend/.venv/bin/python`。

## 7. 核心工作流

### 7.1 Chat 与 Agent 执行

后端主要入口：

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`
- `POST /api/v1/agent/run`

执行链路：

`text-to-model-draft -> convert -> validate -> analyze -> code-check -> report`

### 7.2 Backend 托管分析运行时

由 backend 暴露的兼容接口：

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`
- `GET /engines`

## 8. StructureModel 治理

- 必须使用 `schema_version: "1.0.0"`
- 节点/单元/材料/截面/荷载字段命名必须严格一致
- 建议先 `validate` 再 `analyze` 与 `code-check`

## 9. Skill 与 no-skill 策略

- Skill 是增强层，不是唯一执行路径。
- 已选技能未匹配场景时，回退到通用 no-skill 建模。
- 所有新增用户可见文案必须同时支持中文和英文。

## 10. 质量保障与回归

### 10.1 后端

```bash
npm run build --prefix backend
npm run lint --prefix backend
npm test --prefix backend -- --runInBand
```

### 10.2 前端

```bash
npm run build --prefix frontend
npm run type-check --prefix frontend
npm run test:run --prefix frontend
```

### 10.3 分析运行时与契约

```bash
make analysis-regression
make backend-regression
```

常用定向校验：

- `./scripts/validate-agent-orchestration.sh`
- `./scripts/validate-agent-tools-contract.sh`
- `./scripts/validate-chat-stream-contract.sh`
- `./scripts/validate-analyze-contract.sh`

## 11. 贡献流程

1. 变更保持小步、聚焦。
2. 严守模块边界。
3. 运行定向测试与必要回归。
4. 使用清晰的 conventional commit 信息。
5. 行为变更要同步更新手册或参考文档。

贡献细节：`CONTRIBUTING_CN.md`。

## 12. 故障排查

- 启动异常优先执行 `make doctor`。
- 数据库相关测试失败时，先检查 `DATABASE_URL` 是否以 `file:` 开头，并且指向本地可写路径。
- LLM 流程异常时，检查 `LLM_PROVIDER` 与 API Key。
- 契约失败时，直接运行对应 `scripts/validate-*.sh` 进行定向诊断。

## 13. 相关文档

- 协议参考：`docs/reference_CN.md`
- 英文手册：`docs/handbook.md`
- 英文协议参考：`docs/reference.md`
- 中文总览：`README_CN.md`
- 英文总览：`README.md`
