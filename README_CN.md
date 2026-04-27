# StructureClaw 中文总览

面向 AEC 场景的 AI 协同结构工程工作台。

## Demo

https://github.com/user-attachments/assets/031fe757-551d-4775-ab3f-0411037ad5ae

## 项目能力

- 从自然语言需求到分析工件的结构工程闭环
- 统一编排链路：建模草案 -> 校验 -> 分析 -> 校核 -> 报告
- 可安装 CLI 与 Web 工作台：`npm install -g structureclaw && sclaw start`
- 安装版单进程运行：后端直接托管导出的前端静态资源
- 单平台能力栈：Web 前端、后端编排 API、Agent runtime、后端托管的 Python 分析运行时
- 内置 OpenSees、PKPM SATWE、YJK 静力分析路径
- 具备回归脚本与契约校验脚本，支持可重复验证

## 架构概览

```text
浏览器 UI
  -> Fastify 后端（API + 安装版静态前端托管）
  -> LangGraph Agent runtime
  -> skill/tool 能力层
  -> Python 分析运行时（OpenSees / PKPM / YJK 适配器）
  -> 报告 / 指标 / 工件输出
```

主要目录：

- `frontend/`：Next.js 14 前端
- `backend/`：Fastify API、Agent/Chat 编排、Prisma，以及分析执行宿主
- `scripts/`：启动脚本与 `sclaw` / `sclaw_cn` CLI 实现
- `tests/`：回归入口（`node tests/runner.mjs ...`）、安装冒烟，以及原生冒烟后在 CI 中执行的前端 type-check、Vitest 与 lint
- `docs/`：手册与协议参考文档

## 快速启动

### npm 安装版

普通用户推荐全局安装 CLI，并让 `sclaw doctor` 创建运行工作区：

```bash
npm install -g structureclaw
sclaw doctor
sclaw start
```

安装版会把用户数据放在 Unix-like 系统的 `~/.structureclaw/` 或 Windows 的应用数据目录中。数据库、日志、报告、分析生成文件、`settings.json`、用户技能和用户工具都不会写入只读的 npm 包目录。

### 源码开发版

仓库开发时，在源码目录使用本地 CLI：

```bash
./sclaw doctor
./sclaw start
./sclaw status
```

源码模式把运行数据放在 `.runtime/`，并以开发进程启动 backend/frontend。

如果你还没有安装 Node.js，可以先运行自动安装脚本：

```bash
bash ./scripts/install-node-linux.sh
```

Windows PowerShell（首次安装建议使用管理员权限）：

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/install-node-windows.ps1
```

国内镜像流程（子命令与 `sclaw` 一致，但默认启用国内镜像）：

```bash
./sclaw_cn doctor
./sclaw_cn start
./sclaw_cn status
```

补充说明：

- SQLite 是默认本地数据库。安装版解析到用户运行数据目录，源码模式解析到 `.runtime/data/`。
- `sclaw doctor` 会自动准备 Python 分析环境。安装版的虚拟环境位于用户运行数据目录，而不是 `node_modules`。
- 旧的源码目录 `.runtime/` 数据可以迁移到安装版运行目录。
- 旧 `.env` 中的配置会尽量迁移到 `settings.json`；`.env` 仍作为高级用法和 CI 的 fallback。
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

Windows 现在可以直接使用 Docker 启动完整栈，适合不想先手动安装本地 Node.js 和 Python 的新手。

推荐步骤：

1. 安装并启动 Docker Desktop。
2. 首次启动如果提示启用 WSL 2 或容器功能，按向导完成后重启 Docker Desktop。
3. 在项目根目录运行交互式 Docker 引导命令：

```powershell
node .\sclaw docker-install
```

如果是 CI 或脚本化环境，使用非交互方式：

```powershell
node .\sclaw docker-install --non-interactive --llm-base-url https://api.openai.com/v1 --llm-api-key <your-key> --llm-model gpt-4.1
```

启动完成后，常用入口如下：

- 前端：`http://localhost:31416`
- 后端健康检查：`http://localhost:31415/health`
- 分析接口：`http://localhost:31415/analyze`
- 数据库状态页：`http://localhost:31416/console/database`

停止容器：

```powershell
node .\sclaw docker-stop
```

或：

```bash
docker compose down
```

## 配置

StructureClaw 1.0 以 `settings.json` 作为主要用户配置文件。前端 General Settings 面板会通过后端 admin API 写入同一份配置，并显示每个字段来自 runtime settings、`.env` 还是内置默认值。

配置优先级：

1. 运行时 `settings.json`
2. `.env` / shell 环境变量
3. 内置默认值

重要 `settings.json` section：

- `server`：端口、host、请求体大小
- `llm`：OpenAI-compatible base URL、模型、API key、超时、重试
- `logging`：应用日志级别、LLM 日志、日志轮转
- `analysis`：Python 运行时路径、超时、引擎 manifest 路径
- `storage`：报告目录与上传大小
- `agent`：workspace root、checkpoint、shell tool 策略
- `pkpm`：SATWE/JWSCYCLE 路径与工作目录
- `yjk`：安装根目录、可执行文件、内置 Python、工作目录、版本、超时、无界面模式

`.env.example` 仍保留为自动化和源码开发的环境变量参考。

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
