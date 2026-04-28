# StructureClaw 路线图

本路线图是 StructureClaw 发布方向的叙述版摘要。实时计划状态以 GitHub Projects 为准，具体条目的优先级、负责人和进度都应优先查看 Project。

- [v1.0.0 GitHub Project](https://github.com/orgs/structureclaw/projects/1)：首个稳定 npm 发布版
- [v1.1.0 GitHub Project](https://github.com/orgs/structureclaw/projects/3)：1.0 稳定化之后的下一条发布线

下面各节说明每条发布线的目标，不是发布承诺；随着运行时、引擎集成和用户反馈变化，优先级可能调整。

## 1.0.0 发布版

Project 重点：首个稳定 npm 发布版，以及完整的本地 chat-to-artifact 工作流。

Project 主题与代表 issue：

- Skill 架构与运行时骨架：builtin skill taxonomy、SkillHub 边界、manifest-first loading、code-owned tool registry，对应 [#38](https://github.com/structureclaw/structureclaw/issues/38)、[#57](https://github.com/structureclaw/structureclaw/issues/57)、[#162](https://github.com/structureclaw/structureclaw/issues/162)。
- Agent 执行模型：用 LangGraph ReAct runtime 替代确定性 planner pipeline，对应 [#154](https://github.com/structureclaw/structureclaw/issues/154)。
- 分析引擎与 schema：将 OpenSees 执行迁入 backend skills，定义 StructureModel V2，并稳定 OpenSees / PKPM / YJK 路径，对应 [#37](https://github.com/structureclaw/structureclaw/issues/37)、[#39](https://github.com/structureclaw/structureclaw/issues/39)、[#50](https://github.com/structureclaw/structureclaw/issues/50) 以及相关 engine PR。
- CLI、打包与运行时安装：统一 `sclaw` / `sclaw_cn`，支持首次运行配置，并完成稳定 npm 包发布，对应 [#40](https://github.com/structureclaw/structureclaw/issues/40)、[#165](https://github.com/structureclaw/structureclaw/issues/165)。
- 测试与发布信心：扩展 regression、smoke、LLM 与多环境安装验证，对应 [#42](https://github.com/structureclaw/structureclaw/issues/42)、[#118](https://github.com/structureclaw/structureclaw/issues/118)。
- 产品打磨与可观测性：console UX、前端可访问性、结构化日志、memory 与 conversation-scoped runtime 清理，对应 [#148](https://github.com/structureclaw/structureclaw/issues/148)、[#163](https://github.com/structureclaw/structureclaw/issues/163)、[#164](https://github.com/structureclaw/structureclaw/issues/164)。
- 文档收口：刷新双语仓库文档与 wiki 内容，对应 [#43](https://github.com/structureclaw/structureclaw/issues/43) 以及 v1.0.0 Project 中正在推进的文档刷新 PR。

## 1.0.x 稳定化

重点：在稳定 npm 发布版之后，保持 1.0 发布线可靠。

- 修复 `smoke-native`、`smoke-docker`、backend build/lint/Jest、frontend type-check/build、agent contract validation 暴露的回归。
- 保持 npm package metadata、CLI 行为和 `sclaw doctor` 诊断与真实 1.0 安装体验一致。
- 随着商业引擎边界情况暴露，持续维护 OpenSees、PKPM、YJK 的安装与排障说明。
- 当 API routes、skill metadata 或 engine 行为变化时，同步维护 docs 与 wiki。

## 1.1.0 发布线

Project 重点：基准测试丰富化与多模态文件输入。

- LLM benchmark 框架：用端到端 `llm-benchmark` 替代组件式 `llm-integration`，加入 LLM-as-Judge、自然语言断言、skill 命中追踪和 agent retry loop，对应 [#170](https://github.com/structureclaw/structureclaw/issues/170)、[#185](https://github.com/structureclaw/structureclaw/issues/185)。
- 文件上传与 data-input：增加浏览器 / workspace 文件上传、file-aware agent tools，以及面向 CSV/Excel、PDF、DXF、图片和后续 BIM 输入的数据读取技能，对应 [#169](https://github.com/structureclaw/structureclaw/issues/169)、[#184](https://github.com/structureclaw/structureclaw/issues/184)。
- 可视化技能：继续推进 visualization skill skeleton，并和现有 visualization extensions 的 registry 边界对齐，对应 v1.1.0 Project 中的 visualization PR。
- 文档一致性：通过 v1.1.0 Project 中的文档 PR 收口剩余双语翻译和 wiki 同步问题。
