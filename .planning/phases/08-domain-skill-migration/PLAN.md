# Phase 08 - Domain Skill Migration Plan

## Goal
- Reorganize skills by capability domains instead of only structure types.
- Keep OpenSees core execution path minimal and always available.
- Ensure no-skill mode can still complete LLM-driven input extraction and engine execution.

## Architecture Directive (Core Minimalism First)
- No-skill mode is the primary baseline path, not a degraded fallback.
- Core (`backend/src/services/agent.ts` + runtime orchestration) must stay generic and schema-oriented:
	- generic draft extraction,
	- generic missing-field detection,
	- generic model assembly/validation/execute pipeline,
	- session/protocol/persistence/observability.
- Core must not carry scenario keyword rules, structure-template branching, or structure-specific question templates.
- All structure-template matching, scenario routing, template defaults, and template-specific clarification must live in skill handlers.
- If `skillIds=[]`, core should never require selecting a predefined structure template before generating a model; it should generate when computable and only ask for truly missing fields.

## Execution Status (2026-03-17)
- P08-1 baseline is in place: capability matrix now carries domain-oriented metadata and frontend consumes grouped capability payload.
- P08-2 is actively landing with first implementation slice already coded:
	- Skill selection semantics are now explicit three-state behavior:
		- `skillIds === undefined`: auto default skills.
		- `skillIds === []`: strict no-skill mode.
		- `skillIds.length > 0`: explicit manual skill set.
	- Frontend now always sends `skillIds` to preserve no-skill intent across requests.
	- Backend no-skill path now attempts generic modeling via LLM+rule extraction merge, with LLM direct StructureModel v1 synthesis fallback when rule completeness is insufficient.
	- Auto-route behavior now prefers execute path in strict no-skill mode when model can be produced.
- Remaining P08-2 work is test hardening and observability polish (see Immediate Next Actions).

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

Current implementation progress (2026-03-17):
- Implemented: empty `skillIds` no longer falls back to default auto-loaded skills.
- Implemented: no-skill fallback draft builder in agent service (`textToModelDraftWithoutSkills`) with:
	- LLM extraction attempt,
	- deterministic rule extraction,
	- merged draft state,
	- optional LLM direct generic model generation (`tryLlmBuildGenericModel`) when critical fields remain.
- Implemented: no-skill clarification response path when draft cannot yet produce computable model.
- Implemented: route preference update to avoid chat-loop dead-end in no-skill mode.
- Pending: add dedicated no-skill contract script and regression assertions for fallback success and deterministic clarification.

P08-2a Core cleanup scope (must-do):
- Remove remaining template-enumeration prompts from no-skill flow.
- Remove remaining structure-specific stage wording from no-skill chat guidance.
- Keep no-skill missing fields schema-driven (geometry/topology/material/section/load/constraints) instead of template-driven labels.

P08-2b Skill ownership scope (must-do):
- Move scenario keyword matching and template-specific route heuristics behind skill runtime APIs only.
- Move template-specific load-position semantics entirely into structure-type skill handlers.
- Keep core route decision based on generic computability + missing-field status only.

Success criteria:
- No-skill request can reach analysis/report result or deterministic clarification.
- No route dead-end when no skills are loaded.
- Baseline skill pack is explicitly documented and can run without repository connectivity.
- Repository outages do not block baseline compute path.
- Core no-skill path has zero hardcoded structure template list in prompts/questions.
- Scenario matching and template heuristics are owned by skill layer only.

Validation:
- validate-agent-orchestration.sh
- validate-chat-message-routing.sh
- new no-skill fallback contract script
- New no-skill minimalism contract checks:
	- complete generic request in chat mode returns `ready` + `model` without template confirmation,
	- no-skill clarification questions contain missing-parameter semantics instead of template options,
	- no-skill execution route does not call skill scenario-matching branches.

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
1. Add `scripts/validate-no-skill-fallback-contract.sh` covering `skillIds=[]` execute/chat routes and deterministic clarification behavior.
2. Add no-skill contract case for generic complete request: no template-confirmation prompt, direct `ready` model.
3. Add no-skill contract case for generic incomplete request: clarify only missing schema fields (no template list).
4. Introduce observability reason codes: `generic_model_ready`, `generic_missing_fields`, `skill_template_route`.
5. Refactor remaining template keyword/label logic from core service into skill handlers/runtime.
6. Extend frontend debug panel to surface modeling source + route reason code in bilingual labels.
7. Complete frontend domain-grouped skill loading UX and external repository contract drafts.
