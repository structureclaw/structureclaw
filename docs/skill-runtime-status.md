# Skill Runtime Status

This document records the current implementation state of the skill system.

It complements [agent-architecture.md](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/docs/agent-architecture.md): the 14 domains there are the stable taxonomy, while this file tracks what is actually wired into today's runtime.

## Current Domain Matrix

Current status is derived from:

- [backend/src/services/agent-capability.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/agent-capability.ts)
- builtin `skill.yaml` files under `backend/src/agent-skills/`
- legacy section modules that still exist outside the manifest-first catalog

| Domain | `runtimeStatus` in current code | Manifest-backed skills | Legacy skill modules | Current state |
|---|---|---:|---:|---|
| `structure-type` | `active` | 6 | 6 | Main entry domain. Manifest-first for catalog identity, but handler layer still keeps `manifest.ts`. |
| `analysis` | `active` | 7 | 0 | Fully manifest-backed builtin skills with per-skill `runtime.py`. |
| `code-check` | `active` | 4 | 0 | Manifest-backed skills. Execution still runs through shared domain adapters/runtime. |
| `validation` | `partial` | 1 | 0 | Manifest-backed and runtime-connected, but still narrow in scope. |
| `report-export` | `partial` | 1 | 0 | Runtime-connected placeholder domain. Current builtin asset is mostly manifest metadata. |
| `load-boundary` | `discoverable` | 10 | 0 | Catalog-visible builtin skills. Not yet auto-participating in the main runtime binder. |
| `visualization` | `discoverable` | 3 | 0 | Catalog-visible builtin skills with prompt assets, but no per-skill runtime modules today. |
| `section` | `discoverable` | 3 | 3 | Catalog-visible after manifest migration. Runtime handlers still keep `manifest.ts` during the transition. |
| `data-input` | `discoverable` | 0 | 0 | Taxonomy slot only in current repo state. |
| `design` | `discoverable` | 0 | 0 | Taxonomy slot only in current repo state. |
| `drawing` | `discoverable` | 0 | 0 | Taxonomy slot only in current repo state. |
| `general` | `discoverable` | 0 | 0 | Taxonomy slot only in current repo state. |
| `material` | `discoverable` | 0 | 0 | Taxonomy slot only in current repo state. |
| `result-postprocess` | `discoverable` | 0 | 0 | Taxonomy slot only in current repo state. |

## Important Caveats

- The architecture documents define `reserved` as a valid status, but the current implementation in [agent-capability.ts](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/services/agent-capability.ts) does not emit `reserved` for any domain yet.
- A domain being listed under `backend/src/agent-skills/` does not guarantee main-flow participation.
- A manifest-backed skill is not automatically executable. Some domains are catalog-visible first, then runtime-wired later.
- `section` is the main outlier: it still ships useful runtime code, but it is outside the current `skill.yaml` catalog path.

## Asset Snapshot

| Domain | Asset note |
|---|---|
| `analysis` | 7 skills with `skill.yaml` + `intent.md` + per-skill `runtime.py` |
| `code-check` | 4 skills with `skill.yaml` + `intent.md`; execution uses shared domain runtime |
| `structure-type` | 6 skills with `skill.yaml`; runtime still also uses `manifest.ts` + `handler.ts` |
| `validation` | 1 skill with `skill.yaml` + `intent.md` + `runtime.py` |
| `report-export` | 1 skill with `skill.yaml` only |
| `load-boundary` | 10 skills with `skill.yaml`; 9 also have `intent.md` + `runtime.py`; `nodal-constraint` is manifest-only |
| `visualization` | 3 skills with `skill.yaml` + `intent.md`; no per-skill runtime modules |
| `section` | 3 skills with `skill.yaml` + `intent.md` + `manifest.ts` + `handler.ts` + `runtime.py` |

## Recommended Cleanup Order

1. Collapse `section` from its mixed `skill.yaml` + `manifest.ts` transition state into one manifest-first contract.
2. Decide whether taxonomy-only domains should stay `discoverable` or move to explicit `reserved` status in code.
3. Keep contributor docs focused on a minimum viable builtin skill layout instead of the current "full asset pack" ideal.
4. Reduce naming overlap between agent skills and the older `SkillService` / `/api/skill` path.
