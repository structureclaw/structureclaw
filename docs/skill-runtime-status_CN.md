# Skill 运行时状态

本文记录当前仓库里 skill 系统的实际实现状态。

它是 [agent-architecture_CN.md](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/docs/agent-architecture_CN.md) 的补充：架构文档里的 14 个 domain 是稳定 taxonomy，这里描述的是今天真正接入到运行时的成熟度。

## 当前 Domain 矩阵

当前状态依据以下来源整理：

- [backend/src/services/agent-capability.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/agent-capability.ts)
- `backend/src/agent-skills/` 下的 builtin `skill.yaml`
- 尚未进入 manifest-first catalog 的 legacy `section` 模块

| Domain | 当前代码中的 `runtimeStatus` | Manifest-backed skill 数 | Legacy skill 模块数 | 当前状态 |
|---|---|---:|---:|---|
| `structure-type` | `active` | 6 | 6 | 主入口 domain。catalog 身份已 manifest-first，但 handler 层仍保留 `manifest.ts`。 |
| `analysis` | `active` | 7 | 0 | 已完整 manifest 化，且每个 skill 都有独立 `runtime.py`。 |
| `code-check` | `active` | 4 | 0 | 已 manifest 化，但执行仍走共享的 domain adapter/runtime。 |
| `validation` | `partial` | 1 | 0 | 已接入运行时，但能力面仍较窄。 |
| `report-export` | `partial` | 1 | 0 | 已接入运行时，但当前 builtin 资产基本仍是 manifest 占位。 |
| `load-boundary` | `discoverable` | 10 | 0 | builtin skill 已进入 catalog，但还没有自动参与主 runtime binder。 |
| `visualization` | `discoverable` | 3 | 0 | builtin skill 已可发现，也有 prompt 资产，但今天还没有 per-skill runtime 模块。 |
| `section` | `discoverable` | 3 | 3 | 已进入 catalog，但运行时 handler 层在过渡期仍保留 `manifest.ts`。 |
| `data-input` | `discoverable` | 0 | 0 | 当前仓库状态下仅保留 taxonomy 槽位。 |
| `design` | `discoverable` | 0 | 0 | 当前仓库状态下仅保留 taxonomy 槽位。 |
| `drawing` | `discoverable` | 0 | 0 | 当前仓库状态下仅保留 taxonomy 槽位。 |
| `general` | `discoverable` | 0 | 0 | 当前仓库状态下仅保留 taxonomy 槽位。 |
| `material` | `discoverable` | 0 | 0 | 当前仓库状态下仅保留 taxonomy 槽位。 |
| `result-postprocess` | `discoverable` | 0 | 0 | 当前仓库状态下仅保留 taxonomy 槽位。 |

## 关键说明

- 架构文档里定义了 `reserved`，但当前 [agent-capability.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/agent-capability.ts) 还没有对任何 domain 实际输出 `reserved`。
- `backend/src/agent-skills/` 里存在某个 domain，并不等于它已经进入主流程。
- 某个 skill 已经有 manifest，也不等于它已经可执行。有些 domain 目前只是先进入 catalog，再逐步接入 runtime。
- `section` 是当前最明显的例外：运行时代码还在，但不属于当前 `skill.yaml` catalog 链路。

## 资产快照

| Domain | 资产情况 |
|---|---|
| `analysis` | 7 个 skill，均包含 `skill.yaml` + `intent.md` + 独立 `runtime.py` |
| `code-check` | 4 个 skill，均包含 `skill.yaml` + `intent.md`；执行走共享 domain runtime |
| `structure-type` | 6 个 skill，均包含 `skill.yaml`；运行时仍同时依赖 `manifest.ts` + `handler.ts` |
| `validation` | 1 个 skill，包含 `skill.yaml` + `intent.md` + `runtime.py` |
| `report-export` | 1 个 skill，目前只有 `skill.yaml` |
| `load-boundary` | 10 个 skill 均有 `skill.yaml`；其中 9 个还有 `intent.md` + `runtime.py`；`nodal-constraint` 只有 manifest |
| `visualization` | 3 个 skill，均有 `skill.yaml` + `intent.md`；暂无 per-skill runtime 模块 |
| `section` | 3 个 skill，均有 `skill.yaml` + `intent.md` + `manifest.ts` + `handler.ts` + `runtime.py` |

## 建议的清理顺序

1. 先把 `section` 从当前 `skill.yaml` + `manifest.ts` 的混合过渡态收敛成单一 manifest-first 合同。
2. 再决定 taxonomy-only domain 在代码里究竟继续保持 `discoverable`，还是显式改成 `reserved`。
3. 最后把贡献者文档收敛到“最小可用 skill 模板”，不要继续默认要求完整资产包。
4. 继续收敛 agent skill 与旧 `SkillService` / `/api/skill` 这两套命名重叠。
