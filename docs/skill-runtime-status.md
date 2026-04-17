# Skill Runtime Status

This document records the current implementation state of the skill system.

It complements [agent-architecture.md](./agent-architecture.md): the 14 domains there are the stable taxonomy, while this file tracks what is actually wired into today's runtime.

## Current Domain Matrix

Current status is derived from:

- [backend/src/services/agent-capability.ts](../backend/src/services/agent-capability.ts)
- builtin `skill.yaml` files under `backend/src/agent-skills/`
- remaining runtime handler modules under `backend/src/agent-skills/`

| Domain | `runtimeStatus` in current code | Manifest-backed skills | Legacy skill modules | Current state |
|---|---|---:|---:|---|
| `structure-type` | `active` | 6 | 6 | Main entry domain. Runtime loading now uses `skill.yaml` + `handler.ts`. |
| `analysis` | `active` | 7 | 0 | Fully manifest-backed builtin skills with per-skill `runtime.py`. |
| `code-check` | `active` | 4 | 0 | Manifest-backed skills. Execution still runs through shared domain adapters/runtime. |
| `validation` | `partial` | 1 | 0 | Manifest-backed and runtime-connected, but still narrow in scope. |
| `report-export` | `partial` | 1 | 0 | Runtime-connected placeholder domain. Current builtin asset is mostly manifest metadata. |
| `load-boundary` | `discoverable` | 10 | 0 | Catalog-visible builtin skills. Not yet auto-participating in the main runtime binder. |
| `visualization` | `discoverable` | 3 | 0 | Catalog-visible builtin skills with prompt assets, but no per-skill runtime modules today. |
| `section` | `discoverable` | 3 | 3 | Catalog-visible and runtime-loadable from `skill.yaml` + `handler.ts`, but not auto-activated by the main runtime binder. |
| `data-input` | `reserved` | 0 | 0 | Taxonomy slot only in current repo state. |
| `design` | `partial` | 0 | 0 | Phase 3.5 added design feedback propose/accept via the scheduler. Full design loop (iteration, multi-proposal) pending. |
| `drawing` | `partial` | 0 | 0 | Scheduler path exists for drawing artifact planning, but the drawing tool is not yet implemented. |
| `general` | `reserved` | 0 | 0 | Taxonomy slot only in current repo state. |
| `material` | `reserved` | 0 | 0 | Taxonomy slot only in current repo state. |
| `result-postprocess` | `active` | 0 | 0 | Phase 5 stabilized the postprocess artifact through the scheduler. Participates in main orchestration. |

## Important Caveats

- A domain being listed under `backend/src/agent-skills/` does not guarantee main-flow participation.
- A manifest-backed skill is not automatically executable. Some domains are catalog-visible first, then runtime-wired later.
- `section` is no longer outside the catalog path, but it remains a discoverable-only domain rather than a main-flow participant.

## Asset Snapshot

| Domain | Asset note |
|---|---|
| `analysis` | 7 skills with `skill.yaml` + `intent.md` + per-skill `runtime.py` |
| `code-check` | 4 skills with `skill.yaml` + `intent.md`; execution uses shared domain runtime |
| `structure-type` | 6 skills with `skill.yaml` + `handler.ts`; 5 also include `draft.md` + `analysis.md` + `design.md`, while `generic` stays intent-only |
| `validation` | 1 skill with `skill.yaml` + `intent.md` + `runtime.py` |
| `report-export` | 1 skill with `skill.yaml` only |
| `load-boundary` | 10 skills with `skill.yaml`; 9 also have `intent.md` + `runtime.py`; `nodal-constraint` is manifest-only |
| `visualization` | 3 skills with `skill.yaml` + `intent.md`; no per-skill runtime modules |
| `section` | 3 skills with `skill.yaml` + `intent.md` + `handler.ts` + `runtime.py` |
| `drawing` | 2 skills with `skill.yaml` + `intent.md`; no per-skill runtime modules yet |

## Recommended Cleanup Order

1. Keep contributor docs focused on a minimum viable builtin skill layout instead of the current "full asset pack" ideal.
2. Reduce naming overlap between agent skills and the older `LegacySkillCatalogService` / `/api/v1/skills` catalog path.
