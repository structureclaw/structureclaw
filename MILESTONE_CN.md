# 当前里程碑

## 里程碑 1：Skill 分类与运行时重构

这个里程碑是 StructureClaw 当前阶段的最高优先级目标。核心任务是让 skill 体系成为工程工作流的主要架构骨架，同时保持现有公开契约稳定，避免因为并行推进过多大项而分散重心。

## 目标

交付一个边界更清晰的 builtin skill 架构，使其能够支撑设计、计算、规范校验、报告导出和可视化等完整工程链路，同时保留现有 fallback 路径和 API 行为。

## 范围内事项

- 重新整理 `backend/src/agent-skills` 下的 skill 分类，使现有类别更贴近工程工作流和后续扩展路径。
- 将 agent-facing 结构分析能力完全迁入 `backend/src/agent-skills`，尤其是 OpenSeesPy 执行链路及相关转换层。
- 明确 builtin skill 与 external SkillHub 的职责边界。
- 强化 skill runtime 在注册、加载、能力发现、执行与回退机制上的契约。
- 推进 v1 结构计算 JSON 基线，使其足以支撑 skill 化编排和未来多引擎适配。
- 保持 `POST /api/v1/agent/run`、`POST /api/v1/chat/*`、`POST /validate`、`POST /convert`、`POST /analyze`、`POST /code-check` 的现有语义稳定。

## 本里程碑暂不重点处理

- 不做一次性完成的 `sclaw` 多端入口总迁移。
- 不做 README、handbook、reference、wiki 的全量文档重写。
- 不在这一阶段追求所有未来 skill 方向一次到位，例如 CAD、Revit、BIM、出图 API 和完整规范矩阵。

这些事项可以少量跟进，但不应抢占 skill 重构的主优先级。

## 交付物

- 一套重新梳理后的 builtin skill 分类结构，以及更清晰的领域边界。
- 一条明确的 backend-hosted 执行路径，用于承载 agent 调用的 OpenSeesPy 及相关结构分析能力。
- builtin skill 与 external SkillHub 的稳定运行时约束。
- 与 skill 架构对齐的 v1 结构计算 JSON 方向说明。
- 对 orchestration、fallback、analyze/code-check/report 和结构校验链路保持回归信心。

## 验收标准

- 仓库能够清楚回答哪些职责属于 backend API/services，哪些职责属于 `backend/src/agent-skills`。
- builtin skill 分类能够体现目标工作流，而不是零散工具的集合。
- 在 skill 缺失、未命中或部分迁移时，no-skill fallback 仍然正常工作。
- 关键契约与回归脚本在重构后仍能通过，或至少在迁移过程中有清晰的兼容与验收说明。
- 本里程碑中新产生或更新的用户可见输出仍然保持中英文双语。

## 配套推进事项

- 仅在有助于 skill 重构验证或运维时，渐进推进 `sclaw` 统一入口。
- 持续补充能增强迁移信心的定向测试。
- 将大范围文档重写延后到重构基本稳定之后，避免反复返工。
