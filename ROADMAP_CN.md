# StructureClaw 路线图

本路线图说明 1.0.0 发布线和首个稳定 npm 版本之后的计划。它不是发布承诺；随着运行时、引擎集成和用户反馈变化，优先级可能调整。

## 1.0.0 发布版

重点：可安装的本地工程工作台，以及完整的 chat-to-artifact 闭环。

- 通过 `@structureclaw/structureclaw` 进行 npm 安装
- `sclaw doctor` 首次运行配置
- SQLite 本地运行时与 settings 管理
- `~/.structureclaw/` 运行数据目录
- OpenSees 静力、动力、地震、非线性分析路径
- PKPM 与 YJK 商业引擎适配，通过显式选择启用
- SkillHub 搜索与手动启用/禁用流程
- regression、smoke、LLM integration 测试入口
- 中英文 README、手册、参考文档、贡献指南、安全策略和路线图

## 1.0.x 稳定化

重点：在不改变核心架构的前提下，让日常使用更可预期。

- 在 README 与手册中补充更丰富的可复制 demo prompt
- 为 chat、analysis、settings API 补充更多 request/response 示例
- 拆出 OpenSees、PKPM、YJK 的引擎安装与排障指南
- 更清晰的报告导出产物与示例
- 强化 Python、uv、商业引擎路径、授权缺失时的诊断
- 改进 docs/wiki 同步流程
- 补充 Node.js、Python、Windows、Docker、PKPM、YJK 兼容说明

## 1.1 及之后

重点：扩展模型覆盖面和插件式能力。

- 扩展 StructureModel V2 对墙、支撑、荷载组合和引擎专有扩展的覆盖
- 更多 skill domain 从 `discoverable` 进入 `active`
- 更丰富的可视化和报告后处理
- 更强的用户自定义 skills/tools 打包与校验能力
- 更清晰的 API versioning 与 schema migration 策略

