# StructureClaw 中文总览

面向 AEC 场景的 AI 协同结构工程工作台。

## Demo

https://github.com/user-attachments/assets/031fe757-551d-4775-ab3f-0411037ad5ae

## 项目能力

- 从自然语言需求到分析工件的结构工程闭环
- 统一编排链路：建模草案 -> 校验 -> 分析 -> 校核 -> 报告
- 单仓能力栈：Web 前端、后端编排 API、后端托管的 Python 分析运行时
- 具备回归脚本与契约校验脚本，支持可重复验证

## 架构概览

```text
frontend (Next.js)
	-> backend (Fastify + Prisma + Agent 编排 + 分析运行时宿主)
	-> backend/src/agent-skills/analysis-execution/python
	-> 报告/指标/工件输出
```

主要目录：

- `frontend/`：Next.js 14 前端
- `backend/`：Fastify API、Agent/Chat 编排、Prisma，以及分析执行宿主
- `scripts/`：启动脚本与 `sclaw` / `sclaw_cn` CLI 实现
- `tests/`：回归入口（`node tests/runner.mjs ...`）、安装冒烟，以及原生冒烟后在 CI 中执行的前端 type-check、Vitest 与 lint
- `docs/`：手册与协议参考文档

## 快速启动

如果你还没有安装 Node.js，可以先运行自动安装脚本：

```bash
bash ./scripts/install-node-linux.sh
```

Windows PowerShell（首次安装建议使用管理员权限）：

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/install-node-windows.ps1
```

推荐本地流程：

```bash
./sclaw doctor
./sclaw start
./sclaw status
```

国内镜像流程（子命令与 `sclaw` 一致，但默认启用国内镜像）：

```bash
./sclaw_cn doctor
./sclaw_cn start
./sclaw_cn status
```

补充说明：

- 本地默认数据库现在是 SQLite。`./sclaw start` 默认使用 `.runtime/data/structureclaw.start.db`，`./sclaw doctor` 默认使用 `.runtime/data/structureclaw.doctor.db`，这样预检不会碰当前实际运行库。
- `./sclaw doctor` 不再要求你预先安装系统级 Python 3.12。缺失时会先确保 `uv` 可用，并自动准备带 Python 3.12 的 `backend/.venv`；在 Windows 上，如果系统未安装 `winget`，则会提示你手动安装 `uv`。
- 如果你原来的本地 `.env` 还把 `DATABASE_URL` 指向本地 PostgreSQL，`./sclaw doctor` 和 `./sclaw start` 会先自动迁移到 SQLite，再把 `.env` 改写成 SQLite 默认配置，同时把原 PostgreSQL 地址保留到 `POSTGRES_SOURCE_DATABASE_URL`。
- 第一次自动迁移时，还会生成一个类似 `.env.pre-sqlite-migration.<timestamp>.bak` 的本地备份文件。
- `sclaw_cn` 在未显式配置时会自动使用国内镜像默认值：`PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`、`NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`，以及通过 `DOCKER_REGISTRY_MIRROR` 指定的 Docker 镜像前缀。
- 你可以在 `.env` 或 shell 环境中覆盖镜像变量：`PIP_INDEX_URL`、`NPM_CONFIG_REGISTRY`、`DOCKER_REGISTRY_MIRROR`、`APT_MIRROR`。

常用后续命令：

```bash
./sclaw logs
./sclaw stop
node tests/runner.mjs backend-regression
node tests/runner.mjs analysis-regression
```

使用 CLI 内建批量转换命令处理结构模型 JSON，并输出汇总报告：

```bash
./sclaw convert-batch --input-dir tmp/input --output-dir tmp/output --report tmp/report.json --target-format compact-1
```

Windows PowerShell：

```powershell
node .\sclaw doctor
node .\sclaw start
node .\sclaw status
node .\sclaw logs all --follow
node .\sclaw stop
```

### Windows / Docker 新手说明

Windows 现在可以直接使用 Docker 启动完整栈，适合不想先手动安装本地 Node.js、Python 和数据库环境的新手。

推荐步骤：

1. 安装并启动 Docker Desktop。
2. 首次启动如果提示启用 WSL 2 或容器功能，按向导完成后重启 Docker Desktop。
3. 在项目根目录运行交互式 Docker 引导命令：

```powershell
node .\sclaw docker-install
```

如果是 CI 或脚本化环境，使用非交互方式：

```powershell
node .\sclaw docker-install --non-interactive --llm-provider openai --llm-base-url https://api.openai.com/v1 --llm-api-key <your-key> --llm-model gpt-4.1
```

启动完成后，常用入口如下：

- 前端：`http://localhost:30000`
- 后端健康检查：`http://localhost:30010/health`
- 分析接口：`http://localhost:30010/analyze`
- 数据库状态页：`http://localhost:30000/console/database`

停止容器：

```powershell
node .\sclaw docker-stop
```

或：

```bash
docker compose down
```

## 环境变量

请基于 `.env.example` 配置本地环境。

关键变量包括：

- `PORT`、`FRONTEND_PORT`
- `DATABASE_URL`、`POSTGRES_SOURCE_DATABASE_URL`、`REDIS_URL`
- `LLM_PROVIDER`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_BASE_URL`
- `ANALYSIS_PYTHON_BIN`、`ANALYSIS_PYTHON_TIMEOUT_MS`、`ANALYSIS_ENGINE_MANIFEST_PATH`

## 主要 API 入口

后端：

- `POST /api/v1/agent/run`
- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/chat/execute`

后端托管分析：

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`

## 核心原则

- Skill 是增强层，不是唯一执行路径。
- 已选技能未匹配时回退到通用 no-skill 建模。
- 所有用户可见内容必须支持中英文双语。
- 保持前端、后端、分析技能模块边界清晰。

## 文档入口

- 中文手册：`docs/handbook_CN.md`
- 英文手册：`docs/handbook.md`
- 中文参考：`docs/reference_CN.md`
- 英文参考：`docs/reference.md`
- 英文总览：`README.md`
- 中文贡献指南：`CONTRIBUTING_CN.md`

## 参与贡献

提交 PR 前请先阅读 `CONTRIBUTING_CN.md`。

## 许可证

MIT，详见 `LICENSE`。
