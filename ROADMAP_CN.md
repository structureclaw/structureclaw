# StructureClaw 路线图

本路线图说明 1.0 线的演进方向。它不是发布承诺；随着运行时、引擎集成和用户反馈变化，优先级可能调整。

## 1.0 Alpha

重点：可安装的本地运行时，以及可靠的工程闭环。

- 通过 `@structureclaw/structureclaw@alpha` 进行 npm 安装
- `sclaw doctor` 首次运行配置
- SQLite 本地运行时与 settings 管理
- OpenSees 静力、动力、地震、非线性分析路径
- PKPM 与 YJK 商业引擎适配，通过显式选择启用
- SkillHub 搜索与手动启用/禁用流程
- regression、smoke、LLM integration 测试入口

## 1.0 Beta

重点：更顺滑的首次体验和更清晰的产物。

- README 与手册提供可直接复制的 demo prompt
- 为 chat、analysis、settings API 补充更完整的 request/response 示例
- 拆出 OpenSees、PKPM、YJK 的引擎安装与排障指南
- 更清晰的报告导出产物与示例
- 强化 Python、uv、商业引擎路径、授权缺失时的诊断
- 改进 docs/wiki 同步流程

## 1.0 Stable

重点：可预期的日常使用。

- 稳定版 npm `latest` 安装，无需 `@alpha`
- 明确 Node.js、Python、Windows、Docker、PKPM、YJK 兼容矩阵
- 完整社区治理文件与发布检查清单
- 更稳健的运行数据迁移行为
- 更清晰的 API versioning 与 schema migration 策略

## 1.0 之后

- 扩展 StructureModel V2 对墙、支撑、荷载组合和引擎专有扩展的覆盖
- 更多 skill domain 从 `discoverable` 进入 `active`
- 更丰富的可视化和报告后处理
- 更强的用户自定义 skills/tools 打包与校验能力

