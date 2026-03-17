# Phase 08 - Domain Skill Migration Plan

## Goal
- Reorganize skills by capability domains instead of only structure types.
- Keep OpenSees core execution path minimal and always available.
- Ensure no-skill mode can still complete LLM-driven input extraction and engine execution.

## Migration Principles
- Easy to hard migration order.
- Prefer migrating existing stable capabilities first.
- Keep API compatibility and regression green at each phase.
- Skill loading is optional enhancement, never a hard prerequisite to compute.
- Current roadmap only guarantees baseline/core skills in-repo; advanced or long-tail skills are delivered through a skill repository.

## Baseline vs. Skill Repository Strategy
- Baseline/core skills: shipped in current codebase, always available after deployment.
- Extended skills: published in skill repository and loaded on demand.
- Runtime must support both static bundled skills and dynamically loaded repository skills under one capability-matrix contract.
- Frontend must support browsing/selecting/loading skills from repository by domain category.

## External SkillHub Mode (ClawHub Style)
- Skill repository can be fully external to this GitHub repository.
- Use CLI-first workflow for extension skills: search, install, enable, disable, uninstall.
- Baseline/core skills remain in-repo and always bootable; extension skills are fetched from SkillHub at runtime or install time.
- Skill package metadata must include: id, version, domain, capabilities, compatibility, checksum/signature, i18n labels.
- Runtime must verify signature/checksum before activation and keep local cache for offline reuse.

Compatibility contract requirements:
- Each extension skill must declare `minCoreVersion` and `skillApiVersion`.
- Core runtime must reject incompatible skills with deterministic reason codes.
- If a loaded skill becomes incompatible after upgrade, runtime falls back to baseline skills and marks the skill as disabled.

Suggested CLI surface:
- sclaw skill search <keyword>
- sclaw skill install <skill-id>
- sclaw skill enable <skill-id>
- sclaw skill disable <skill-id>
- sclaw skill uninstall <skill-id>
- sclaw skill list --installed

## Frontend Skill Loading Requirement
- Frontend must support domain-grouped skill selection and loading, not only flat skill lists.
- Users should be able to quickly select skills by category and load selected categories/skills in one flow.
- Domain grouping and labels must stay bilingual (`en` and `zh`) and align with backend capability-matrix metadata.

## Target Domain Categories
1. Structure-Type Skills
2. Material and Constitutive Skills
3. Geometry Input Skills
4. Load and Boundary Skills
5. Analysis Strategy Skills
6. Code-Check Skills
7. Result Postprocess Skills
8. Visualization Skills
9. Report and Export Skills
10. Generic Fallback Skills

## Phase Split (Easy -> Hard)

### P08-1: Taxonomy and Metadata Baseline (Easy)
- Introduce domain metadata on skill manifests: `domain`, `requires`, `conflicts`, `priority`, `capabilities`.
- Keep current handlers functional while adding metadata only.
- Build compatibility matrix v2 using domain metadata.
- Expose stable domain grouping payload for frontend grouped skill picker.
- Define common skill metadata schema for both bundled skills and external SkillHub packages.

Success criteria:
- Every existing skill has a domain assignment.
- Capability matrix can render domain-level grouping.
- Frontend can consume domain-grouped skill metadata without hardcoded local mapping.
- Bundled and repository skills share one metadata contract.

Validation:
- backend build
- validate-agent-capability-matrix.sh

---

### P08-2: No-Skill Generic Fallback Hardening (Easy-Medium)
- Treat empty skill selection as first-class supported mode.
- Route to generic fallback extraction + conservative default policy + core engine execution.
- Add explicit contract tests for empty `skillIds` path.
- Define baseline skill pack boundary and repository extension boundary.
- Add repository-down fallback policy (analysis remains available with baseline skills only).

Success criteria:
- No-skill request can reach analysis/report result or deterministic clarification.
- No route dead-end when no skills are loaded.
- Baseline skill pack is explicitly documented and can run without repository connectivity.
- Repository outages do not block baseline compute path.

Validation:
- validate-agent-orchestration.sh
- validate-chat-message-routing.sh
- new no-skill fallback contract script

---

### P08-3: Report/Export and Visualization Domainization (Medium)
- Finalize report/export as domain skill chain (current partial migration baseline).
- Move visualization payload shaping/annotation strategy behind visualization skill hooks.
- Keep frontend behavior stable while switching to domain entry points.
- Implement frontend domain-grouped skill picker UX for load-time selection and batch loading.
- Stage A (P08-3a): implement frontend grouped picker + installed-skill loading flow first.
- Stage B (P08-3b): implement external SkillHub integration (browse/filter/search/install/enable lifecycle).

Success criteria:
- Report and visualization can be enabled/disabled by domain skill selection.
- Existing report and visualization contracts stay green.
- Frontend supports category-level and skill-level selection when loading skills.
- Frontend can load installed extension skills and reflect loaded state in picker (P08-3a).
- Frontend + CLI search/install/enable flow works end-to-end with external SkillHub (P08-3b).

Validation:
- validate-report-template-contract.sh
- frontend targeted visualization tests
- frontend skill-picker interaction tests (group select and mixed select)
- installed-skill loading test (load/unload lifecycle from installed catalog) (P08-3a)
- repository loading contract test (skill metadata fetch + load/unload lifecycle) (P08-3b)
- CLI integration test (search/install/enable/disable/uninstall) (P08-3b)
- security tests: reject bad signature, reject checksum mismatch, allow offline cached install reuse

---

### P08-4: Geometry + Load/Boundary Domain Migration (Medium-High)
- Consolidate natural-language geometry extraction into geometry domain skills.
- Consolidate load/boundary parsing and normalization into load-boundary domain skills.
- Preserve current structure-type handlers as orchestrators over domain outputs.

Success criteria:
- Geometry and load/boundary extraction are callable independently from structure-type skills.
- Existing draft quality/regression does not degrade.

Validation:
- validate-agent-skills-contract.sh
- validate-agent-orchestration.sh

---

### P08-5: Material/Constitutive and Analysis Strategy Migration (High)
- Introduce material/constitutive skill interfaces and default material cards.
- Move analysis strategy policy (static/dynamic/seismic/nonlinear tuning) to domain skill layer.
- Maintain OpenSees core as execution backend only.

Success criteria:
- Material and analysis strategy can be selected independently from structure type.
- Capability matrix includes domain-level compatibility for analysis type.

Validation:
- backend regression
- analysis contract scripts

---

### P08-6: Code-Check and Postprocess Full Migration (Highest)
- Move code-check orchestration and clause mapping to code-check domain skills.
- Move envelope/governing-case/key-metric logic to postprocess domain skills.
- Keep cross-domain traceability in one output schema.

Success criteria:
- Code-check and postprocess are fully pluggable by domain skill.
- Traceability and summary outputs remain backward compatible.

Validation:
- validate-code-check-traceability.sh
- validate-report-template-contract.sh
- backend regression

## Delivery Strategy
- One phase per small PR series.
- Each phase must include: implementation + contract updates + regression proof.
- Do not start next phase until current phase acceptance criteria are green.
- Baseline mode must remain fully usable when repository service is unavailable.

## Immediate Next Actions
1. Implement P08-1 metadata fields and domain mapping on existing skills.
2. Add no-skill fallback contract script skeleton for P08-2.
3. Extend capability-matrix payload with domain group summaries.
4. Draft frontend grouped-skill selection UX states (empty, partial, full-category select).
5. Draft skill repository API contract (list/filter/install/load/unload) with bilingual labels.
6. Draft external SkillHub CLI contract and security policy (signature/checksum verification).
7. Draft compatibility spec (`minCoreVersion`, `skillApiVersion`, incompatibility reason codes, downgrade fallback).
