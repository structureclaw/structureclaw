# StructureClaw 使用手册

## 1. 文档定位

本文档用于指导 StructureClaw 的运行、开发、验证与扩展。

日常工程协作请以本文档为主；协议字段与契约细节请参考 `docs/reference_CN.md`，目标 Agent 架构请参考 `docs/agent-architecture_CN.md`。

## 2. 项目范围

StructureClaw 是一个 AI 协同结构工程平台，采用单仓多服务架构：

- `frontend`：Next.js 14 前端与控制台
- `backend`：Fastify + Prisma API、Agent 编排层，以及托管式 Python 结构分析运行时

主流程：

```text
自然语言需求 -> draft_model -> validate_model -> run_analysis -> run_code_check -> generate_report
```

## 3. 环境要求

推荐的本地环境：

- Node.js 18+
- Python 3.12

可选：

- Docker Engine / Docker Desktop
- Docker Compose v2

## 4. 仓库结构

```text
frontend/   Next.js 前端应用
backend/    Fastify API、agent skills、托管分析运行时、Prisma 模型、后端测试
scripts/    启动脚本与契约/回归校验脚本
docs/       手册与协议参考文档
.runtime/   本地运行数据、日志与报告工件输出目录
```

## 5. 快速上手

### 5.0 Node.js 安装（可选）

如果你还没有安装 Node.js，可以先运行自动安装脚本：

```bash
bash ./scripts/install-node-linux.sh
```

Windows PowerShell（首次安装建议使用管理员权限）：

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/install-node-windows.ps1
```

### 5.1 推荐路径

```bash
./sclaw doctor
./sclaw start
./sclaw status
```

`./sclaw start` 是 SQLite 本地优先的启动路径，会直接从源码启动 frontend 和 backend，不会调用 Docker。

### 5.2 常用生命周期命令

```bash
./sclaw logs
./sclaw stop
./sclaw restart
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
node .\sclaw doctor
node .\sclaw start
node .\sclaw status
node .\sclaw logs all --follow
node .\sclaw stop
```

如果要走 Docker 方式的 Windows 新手路径，直接使用 `node .\sclaw docker-install`、`node .\sclaw docker-start` 和 `node .\sclaw docker-stop`。

### 5.5 SkillHub CLI

通过命令行管理可安装技能：

```bash
./sclaw skill list                          # 列出已安装的技能
./sclaw skill search <keyword> [domain]     # 搜索技能仓库
./sclaw skill install <skill-id>            # 安装技能
./sclaw skill enable <skill-id>             # 启用已安装的技能
./sclaw skill disable <skill-id>            # 禁用技能
./sclaw skill uninstall <skill-id>          # 卸载技能
```

### 5.6 国内镜像 CLI 入口

`sclaw_cn` 与 `sclaw` 使用同一套子命令，并在未显式配置时自动使用国内镜像默认值。

```bash
./sclaw_cn doctor
./sclaw_cn setup-analysis-python
./sclaw_cn docker-start
```

`sclaw_cn` 默认镜像配置：

- `PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`
- `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com`
- `DOCKER_REGISTRY_MIRROR=docker.m.daocloud.io/`

以上变量都可在 `.env` 或 shell 环境变量中覆盖。

## 6. 环境变量与配置

请基于 `.env.example` 配置。

关键变量：

- 运行时：`NODE_ENV`、`PORT`、`FRONTEND_PORT`
- 数据层：`DATABASE_URL`
- LLM：`LLM_API_KEY`、`LLM_MODEL`、`LLM_BASE_URL`（OpenAI-compatible 接口）
- 集成：`ANALYSIS_PYTHON_BIN`、`ANALYSIS_ENGINE_MANIFEST_PATH`、`CORS_ORIGINS`

说明：

- `./sclaw start` 和 `./sclaw restart` 默认使用 `.runtime/data/structureclaw.start.db`；`./sclaw doctor` 使用 `.runtime/data/structureclaw.doctor.db`，确保启动预检与实际运行库隔离。
- 后端的 agent 会话与模型缓存使用当前进程内存存储。
- `ANALYSIS_PYTHON_BIN` 默认指向 `backend/.venv/bin/python`。

## 7. 核心工作流

### 7.1 Chat 与 Agent 执行

后端主要入口：

- `POST /api/v1/chat/message`
- `POST /api/v1/chat/stream`
- `POST /api/v1/agent/run`

当前执行链路：

`draft_model -> convert_model -> validate_model -> run_analysis -> run_code_check -> generate_report`

架构说明：

- 对外产品交互应继续收口到单一 chat-first 入口。
- Skill 与 Tool 都属于可选能力层。
- 目标能力驱动架构见 `docs/agent-architecture_CN.md`。

### 7.2 Backend 托管分析运行时

由 backend 暴露的执行端点：

- `POST /validate`
- `POST /convert`
- `POST /analyze`
- `POST /code-check`
- `GET /engines`

## 8. StructureModel 治理

- 必须使用 `schema_version: "1.0.0"`
- 节点/单元/材料/截面/荷载字段命名必须严格一致
- 建议先执行 `validate_model`，再执行 `run_analysis` 与 `run_code_check`

## 9. Skill 与 base chat 策略

- Skill 与 Tool 都是可选能力层，不是基础聊天的硬依赖。
- 当没有启用任何工程 skill 时，StructureClaw 应停留在 base chat 路径。
- `structure-type` 是工程入口技能域。
- 目标架构中会在该域内内置 `structure-type/generic` 兜底 skill。
- 所有新增用户可见文案必须同时支持中文和英文。

内置技能域（位于 `backend/src/agent-skills/`）：

| 领域 | 说明 |
|---|---|
| `structure-type` | 结构类型识别（梁、框架、桁架、门式刚架等） |
| `analysis` | OpenSees 与 Simplified 分析执行 |
| `code-check` | 设计规范校核 |
| `data-input` | 结构化数据输入解析 |
| `design` | 结构设计辅助 |
| `drawing` | 图纸与可视化生成 |
| `general` | 通用工程技能与共享工作流辅助 |
| `load-boundary` | 荷载与边界条件处理 |
| `material` | 材料属性管理 |
| `report-export` | 报告生成与导出 |
| `result-postprocess` | 分析结果后处理 |
| `section` | 截面属性计算 |
| `validation` | 模型校验 |
| `visualization` | 三维模型可视化 |

上表表示的是稳定 taxonomy，不代表这些 domain 今天都已经完整接入运行时主流程。

当前实现成熟度请查看 [skill-runtime-status_CN.md](./skill-runtime-status_CN.md)，其中区分了哪些 domain 目前是 `active`、`partial`、`discoverable` 或 `reserved`。

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
node tests/runner.mjs analysis-regression
node tests/runner.mjs backend-regression
```

常用定向校验：

- `node tests/runner.mjs validate validate-agent-orchestration`
- `node tests/runner.mjs validate validate-agent-tools-contract`
- `node tests/runner.mjs validate validate-chat-stream-contract`
- `node tests/runner.mjs validate validate-analyze-contract`

## 11. 贡献流程

1. 变更保持小步、聚焦。
2. 严守模块边界。
3. 运行定向测试与必要回归。
4. 使用清晰的 conventional commit 信息。
5. 行为变更要同步更新手册或参考文档。

贡献细节：`CONTRIBUTING_CN.md`。

## 12. 故障排查

- 启动异常优先执行 `./sclaw doctor`。
- 数据库相关测试失败时，先检查 `DATABASE_URL` 是否以 `file:` 开头，并且指向本地可写路径。
- LLM 流程异常时，检查 `LLM_BASE_URL`、`LLM_MODEL` 与 API Key。
- 契约失败时，直接运行对应 `node tests/runner.mjs validate <name>` 进行定向诊断。

## 13. 相关文档

- 协议参考：`docs/reference_CN.md`
- Agent 架构：`docs/agent-architecture_CN.md`
- Skill 运行时状态：`docs/skill-runtime-status_CN.md`
- 英文手册：`docs/handbook.md`
- 英文协议参考：`docs/reference.md`
- 英文 Agent 架构：`docs/agent-architecture.md`
- 英文 Skill 运行时状态：`docs/skill-runtime-status.md`
- 中文总览：`README_CN.md`
- 英文总览：`README.md`
