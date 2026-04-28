# 概览

StructureClaw 是一个面向 AEC 工作流的 AI 协同结构工程工作台。

## 架构

- `frontend/`：Next.js 14 前端应用，含 Three.js 3D 可视化
- `backend/`：Fastify API、安装版静态前端托管、Agent 编排、LLM 集成、Prisma ORM，以及托管式分析运行时
- `scripts/`：`sclaw` CLI 入口与命令实现
- `docs/`：使用手册、协议参考文档与 Wiki 源文件

## 技能体系

技能从 `backend/src/agent-skills/` 自动发现和加载，当前采用 manifest-first 架构：

- **静态元数据层**：`skill.yaml` 是 skill 身份、domain 与 capabilities 的真源
- **内容层**：`intent.md`、`draft.md`、`analysis.md`、`design.md` 等阶段 Markdown 提供提示词与说明内容
- **运行时层**：`handler.ts`、`runtime.py` 等可执行模块实现 skill 行为，但不再重新定义静态身份

内置技能域：

| 领域 | 说明 |
|---|---|
| `structure-type` | 结构类型识别（梁、框架、桁架、门式刚架，以及通用兜底路径） |
| `analysis` | OpenSees、PKPM 与 YJK 分析执行 |
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

上表表示的是平台稳定 taxonomy。当前运行时成熟度请单独参考 [../skill-runtime-status_CN.md](../skill-runtime-status_CN.md)。

## SkillHub

SkillHub 是可扩展的技能管理系统，支持在运行时安装、启用、禁用和卸载技能。

CLI 命令：

```bash
./sclaw skill list                          # 列出已安装的技能
./sclaw skill search <keyword> [domain]     # 搜索技能仓库
./sclaw skill install <skill-id>            # 安装技能
./sclaw skill enable <skill-id>             # 启用已安装的技能
./sclaw skill disable <skill-id>            # 禁用技能
./sclaw skill uninstall <skill-id>          # 卸载技能
```

API 接口：

- `GET /api/v1/agent/skillhub/search`
- `GET /api/v1/agent/skillhub/installed`
- `POST /api/v1/agent/skillhub/install`
- `POST /api/v1/agent/skillhub/enable`
- `POST /api/v1/agent/skillhub/disable`
- `POST /api/v1/agent/skillhub/uninstall`

## 主流程

`自然语言 -> 模型草案 -> 校验 -> 分析 -> 规范校核 -> 报告`

## 推荐启动方式

- npm 安装版：`npm install -g @structureclaw/structureclaw`、`sclaw doctor`、`sclaw start`
- 本地源码流程：`./sclaw doctor`、`./sclaw start`、`./sclaw status`
- Windows PowerShell：`node .\sclaw doctor`、`node .\sclaw start`、`node .\sclaw status`

## 规范来源

- README：https://github.com/structureclaw/structureclaw/blob/master/README_CN.md
- 手册：https://github.com/structureclaw/structureclaw/blob/master/docs/handbook_CN.md
- 参考文档：https://github.com/structureclaw/structureclaw/blob/master/docs/reference_CN.md
