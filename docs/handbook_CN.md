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
- Python 3.12

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

内置技能域（位于 `backend/src/agent-skills/`）：

| 领域 | 说明 |
|---|---|
| `structure-type` | 结构类型识别（梁、框架、桁架、门式刚架等） |
| `analysis` | OpenSees 与 Simplified 分析执行 |
| `code-check` | 设计规范校核 |
| `data-input` | 结构化数据输入解析 |
| `design` | 结构设计辅助 |
| `drawing` | 图纸与可视化生成 |
| `load-boundary` | 荷载与边界条件处理 |
| `material` | 材料属性管理 |
| `report-export` | 报告生成与导出 |
| `result-postprocess` | 分析结果后处理 |
| `section` | 截面属性计算 |
| `validation` | 模型校验 |
| `visualization` | 三维模型可视化 |

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
- LLM 流程异常时，检查 `LLM_PROVIDER` 与 API Key。
- 契约失败时，直接运行对应 `node tests/runner.mjs validate <name>` 进行定向诊断。

## 13. 相关文档

- 协议参考：`docs/reference_CN.md`
- 英文手册：`docs/handbook.md`
- 英文协议参考：`docs/reference.md`
- 中文总览：`README_CN.md`
- 英文总览：`README.md`
