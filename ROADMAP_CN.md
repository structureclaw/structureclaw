# StructureClaw 路线图

## 愿景

StructureClaw 正在从一个可运行的 AI 协同结构工程单仓项目，演进为一个边界更清晰、能力更稳定的平台。这个平台的长期目标围绕三个支柱展开：

- 以技能为中心的编排层，能够把工程意图转化为可重复执行的设计、计算、规范校验、报告导出和可视化流程。
- 稳定且可扩展的结构模型契约，用来衔接用户输入、内置技能、外部 SkillHub 包和下游分析引擎。
- 更统一的多端开发与运维体验，使 Windows、Linux、macOS 和 Docker 环境下的安装、启动、验证和维护更加一致。

本路线图的重点不是重新定义仓库已经具备的能力，而是在保留现有回归稳定性与双语原则的前提下，把这些基础能力平台化、体系化。当前最高优先级是 SKILL 分类和运行时边界重构；多端统一按渐进方式推进，系统性的文档更新放在架构趋于稳定之后。

## 当前状态

StructureClaw 已经具备较完整的基础设施与产品雏形：

- 已形成由 `frontend`、`backend`、`scripts`、`docs` 组成的单仓架构，分析能力托管在 backend skill 体系内。
- 已存在从模型草案生成到 `validate -> analyze -> code-check -> report` 的主流程。
- 后端已经通过 `POST /api/v1/agent/run` 和 `POST /api/v1/chat/*` 提供 agent 与聊天入口。
- 后端托管的分析运行时已经通过 `POST /validate`、`POST /convert`、`POST /analyze`、`POST /code-check` 提供稳定接口。
- `backend/src/agent-skills` 下已经具备 builtin skill 基础，包括结构建模、几何输入、荷载与边界、材料、本构、分析策略、规范校验、报告导出、后处理、可视化、runtime 和 generic fallback。
- 已有面向 SkillHub、agent orchestration、chat stream、report contract、converter contract 和回归验证的脚本与接口。
- 已同时具备 `make` 工作流和 `sclaw` / `scripts/claw.sh` 统一入口方向的基础。
- 已形成中英文双语文档和双语用户可见内容的默认要求。

因此，下面的路线图重点是把这些“已经存在但尚未完全体系化”的能力沉淀为长期可维护的平台能力。

## 当前重点

### 技能架构与运行时边界

- 将 SKILL 分类与边界重构设为仓库当前阶段的首要任务。
- 持续完善 `backend/src/agent-skills` 中的结构分析运行时，尤其是当前更像平台技能而非纯引擎内部逻辑的 OpenSeesPy 相关能力。
- 围绕完整工程链路补齐 builtin skill 的边界划分，包括设计、计算、规范校验、报告导出和可视化等能力域。
- 明确 builtin skill 与 external SkillHub 的职责划分，使加载、注册、能力发现、回退机制和生命周期约束更加清晰。
- 强化 skill runtime 契约，确保新增技能不会破坏现有 generic fallback / no-skill 路径。

### 结构模型与交换格式契约

- 在现有 `StructureModel` 基线之上，定义更清晰的 v1 结构计算 JSON 规范，使其能够覆盖 YJK、PKPM 等主流软件所需的关键参数形态。
- 保留后续扩展位，让未来的转换器和引擎适配器都能围绕同一通用模型演进，而不是过早绑定单一求解器格式。
- 补充关于 schema 演进、校验要求和引擎转换边界的治理约束。

### 平台稳定性基础

- 在内部重构过程中保持现有公开接口语义稳定。
- 在 skill 与 runtime 重构期间继续保留 agent orchestration、chat stream、analyze/code-check/report 和结构校验等关键回归路径。
- 其他平台层面的改进，仅在能够直接降低 skill 重构风险或帮助其落地时同步推进。

## 下一阶段

### 统一多端入口

- 继续以 `sclaw` 为核心收敛 Windows、Linux、macOS 上的开发与运维入口，但采用渐进式推进，避免 CLI 工作反过来阻塞 skill 重构。
- 在基础 CLI 形态足够稳定后，再补充 `sclaw_cn`，为简体中文用户提供更适合国内网络环境的镜像源和初始化体验。
- 将 `make.*`、`scripts/` 和 Windows 辅助脚本中的常用能力逐步并入统一 CLI，同时在过渡期内持续保留 Docker 作为正式支持的部署方式。
- 将 Docker 相关生命周期能力，包括 Windows 上的安装、启动、停止场景，分阶段统一到命令行入口中，而不是要求一次性迁移完成。

### 开发者体验与验证

- 减少脚本碎片化，保留必要的契约/回归校验脚本，同时把重复性的运维操作收敛到 CLI。
- 让安装、启动、健康检查、回归验证和环境诊断在原生环境与 Docker 环境中都能更一致地执行。
- 在工具链演进过程中，保持 `StructureModel v1`、`POST /api/v1/agent/run`、`POST /api/v1/chat/*`、`POST /validate`、`POST /convert`、`POST /analyze`、`POST /code-check` 的对外语义稳定。

## 后续阶段

### 技能生态扩展

- 将 skill 体系扩展到更丰富的数据读取能力，包括 CAD 转换、Revit 转换、BIM 导入、图片转模型、PDF 多形态解析等。
- 增加面向结构类型的技能，例如住宅剪力墙、框架、框架-剪力墙、特殊结构、输电塔等工程场景。
- 继续完善材料、截面、荷载与边界、验证、计算、计算后处理、规范校验、报告导出、出图、前端可视化和通用 runtime 工具等技能矩阵。
- 按规范族持续扩展中国规范校验能力，如 GB、JGJ 等，而不是把全部规则塞入单体实现。

### 质量、覆盖率与文档体系

- 提升 backend、frontend、CLI 和编排流程相关的单元测试、集成测试与 runner 级覆盖率。
- 增加 Windows 与 Linux 在原生安装和 Docker 安装两种模式下的安装与启动验证。
- 在 skill 架构和 CLI 方向相对稳定之后，再系统更新 `README.md`、`README_CN.md`、`docs/handbook.md`、`docs/handbook_CN.md`、`docs/reference.md`、`docs/reference_CN.md`，避免文档频繁返工。
- 将仓库文档方向同步到 GitHub wiki。
- 在替代说明完善后，删除 `docs/windows-wsl2-setup.md` 等过时文档。

### 项目运营

- 建立更清晰的 issue、PR、discussion triage 机制，让 roadmap 的执行、评审和优先级管理更加可见。

## 跨阶段质量门槛

以下原则贯穿所有阶段：

- 所有新增用户可见流程、生成内容、提示词、报告、空状态和引导文案都必须同时支持英文和中文。
- skill 的扩展不能破坏现有的 no-skill fallback 行为。
- 结构 JSON 的演进必须保持可回归、可脚本化、足够确定性。
- agent orchestration、chat stream、analyze、code-check、report 和 converter 的契约验证，应继续作为重大改动的验收条件。
- Windows、Linux 和 Docker 路径都必须被视为一等验证目标。
- 文档更新需要及时跟随架构和工作流变化，保证 handbook 与 reference 继续是可信的操作文档。
