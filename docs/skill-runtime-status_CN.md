# Skill 运行时状态

本文记录当前仓库里 skill 系统的实际实现状态。

它是 [agent-architecture_CN.md](./agent-architecture_CN.md) 的补充：架构文档里的 14 个 domain 是稳定 taxonomy，这里描述的是今天真正接入到运行时的成熟度。

## 当前 Domain 矩阵

当前状态依据以下来源整理：

- [backend/src/services/agent-capability.ts](../backend/src/services/agent-capability.ts)
- `backend/src/agent-skills/` 下的 builtin `skill.yaml`
- `backend/src/agent-skills/` 下仍参与运行时的 handler 模块

| Domain | 当前代码中的 `runtimeStatus` | Manifest-backed skill 数 | Legacy skill 模块数 | 当前状态 |
|---|---|---:|---:|---|
| `structure-type` | `active` | 6 | 6 | 主入口 domain。运行时加载现在直接使用 `skill.yaml` + `handler.ts`。 |
| `analysis` | `active` | 7 | 0 | 已完整 manifest 化，且每个 skill 都有独立 `runtime.py`。 |
| `code-check` | `active` | 4 | 0 | 已 manifest 化，但执行仍走共享的 domain adapter/runtime。 |
| `validation` | `partial` | 1 | 0 | 已接入运行时，但能力面仍较窄。 |
| `report-export` | `partial` | 1 | 0 | 已接入运行时，但当前 builtin 资产基本仍是 manifest 占位。 |
| `load-boundary` | `discoverable` | 10 | 0 | builtin skill 已进入 catalog，但还没有自动参与主 runtime binder。 |
| `visualization` | `discoverable` | 3 | 0 | builtin skill 已可发现，也有 prompt 资产，但今天还没有 per-skill runtime 模块。 |
| `section` | `discoverable` | 3 | 3 | 已进入 catalog，并可通过 `skill.yaml` + `handler.ts` 参与运行时加载，但还不会自动进入主 binder。 |
| `data-input` | `reserved` | 0 | 0 | 当前仓库状态下仅保留 taxonomy 槽位。 |
| `design` | `partial` | 0 | 0 | 阶段 3.5 通过调度器增加了设计反馈 propose/accept。完整设计循环（迭代、多方案）待实现。 |
| `drawing` | `partial` | 0 | 0 | 调度器已具备 drawing 工件规划路径，但 drawing tool 尚未实现。 |
| `general` | `reserved` | 0 | 0 | 当前仓库状态下仅保留 taxonomy 槽位。 |
| `material` | `reserved` | 0 | 0 | 当前仓库状态下仅保留 taxonomy 槽位。 |
| `result-postprocess` | `active` | 0 | 0 | 阶段 5 通过调度器稳定了 postprocess 工件。已参与主编排。 |

## 关键说明

- `backend/src/agent-skills/` 里存在某个 domain，并不等于它已经进入主流程。
- 某个 skill 已经有 manifest，也不等于它已经可执行。有些 domain 目前只是先进入 catalog，再逐步接入 runtime。
- `section` 已不再游离于当前 catalog 链路之外，但它仍属于 discoverable-only domain，而不是主流程 participant。

## 资产快照

| Domain | 资产情况 |
|---|---|
| `analysis` | 7 个 skill，均包含 `skill.yaml` + `intent.md` + 独立 `runtime.py` |
| `code-check` | 4 个 skill，均包含 `skill.yaml` + `intent.md`；执行走共享 domain runtime |
| `structure-type` | 6 个 skill，均包含 `skill.yaml` + `handler.ts`；其中 5 个还包含 `draft.md` + `analysis.md` + `design.md`，`generic` 目前仍是 intent-only |
| `validation` | 1 个 skill，包含 `skill.yaml` + `intent.md` + `runtime.py` |
| `report-export` | 1 个 skill，目前只有 `skill.yaml` |
| `load-boundary` | 10 个 skill 均有 `skill.yaml`；其中 9 个还有 `intent.md` + `runtime.py`；`nodal-constraint` 只有 manifest |
| `visualization` | 3 个 skill，均有 `skill.yaml` + `intent.md`；暂无 per-skill runtime 模块 |
| `section` | 3 个 skill，均有 `skill.yaml` + `intent.md` + `handler.ts` + `runtime.py` |
| `drawing` | 2 个 skill，均有 `skill.yaml` + `intent.md`；暂无 per-skill runtime 模块 |

## 建议的清理顺序

1. 先把贡献者文档收敛到“最小可用 skill 模板”，不要继续默认要求完整资产包。
2. 继续收敛 agent skill 与旧 `LegacySkillCatalogService` / `/api/v1/skills` catalog 路径的命名边界。
