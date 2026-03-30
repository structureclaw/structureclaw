# 概览

StructureClaw 是一个面向 AEC 工作流的 AI 协同结构工程工作台。

## 架构

- `frontend/`：Next.js 14 前端应用，含 Three.js 3D 可视化
- `backend/`：Fastify API、Agent 编排、LLM 集成、Prisma ORM，以及托管式分析运行时
- `scripts/`：`sclaw` CLI 入口与命令实现
- `docs/`：使用手册、协议参考文档与 Wiki 源文件

## 技能体系

技能从 `backend/src/agent-skills/` 自动发现和加载，采用双层架构：

- **Markdown 意图层**：含 YAML frontmatter 的 `.md` 文件，定义触发条件、阶段和元数据
- **TypeScript 处理层**：`manifest.ts` + `handler.ts` 对，实现场景检测、草案提取和模型构建

内置技能域：

| 领域 | 说明 |
|---|---|
| `structure-type` | 结构类型识别（梁、框架、桁架、门式刚架、框剪、住宅剪力墙、输电塔等） |
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

- 本地源码流程：`./sclaw doctor`、`./sclaw start`、`./sclaw status`
- Windows PowerShell：`node .\sclaw doctor`、`node .\sclaw start`、`node .\sclaw status`
- Docker 流程：`./sclaw docker-install` 然后 `./sclaw docker-start`

## 规范来源

- README：https://github.com/structureclaw/structureclaw/blob/master/README_CN.md
- 手册：https://github.com/structureclaw/structureclaw/blob/master/docs/handbook_CN.md
- 参考文档：https://github.com/structureclaw/structureclaw/blob/master/docs/reference_CN.md
