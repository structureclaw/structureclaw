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

Success criteria:
- Every existing skill has a domain assignment.
- Capability matrix can render domain-level grouping.

Validation:
- backend build
- validate-agent-capability-matrix.sh

---

### P08-2: No-Skill Generic Fallback Hardening (Easy-Medium)
- Treat empty skill selection as first-class supported mode.
- Route to generic fallback extraction + conservative default policy + core engine execution.
- Add explicit contract tests for empty `skillIds` path.

Success criteria:
- No-skill request can reach analysis/report result or deterministic clarification.
- No route dead-end when no skills are loaded.

Validation:
- validate-agent-orchestration.sh
- validate-chat-message-routing.sh
- new no-skill fallback contract script

---

### P08-3: Report/Export and Visualization Domainization (Medium)
- Finalize report/export as domain skill chain (current partial migration baseline).
- Move visualization payload shaping/annotation strategy behind visualization skill hooks.
- Keep frontend behavior stable while switching to domain entry points.

Success criteria:
- Report and visualization can be enabled/disabled by domain skill selection.
- Existing report and visualization contracts stay green.

Validation:
- validate-report-template-contract.sh
- frontend targeted visualization tests

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

## Immediate Next Actions
1. Implement P08-1 metadata fields and domain mapping on existing skills.
2. Add no-skill fallback contract script skeleton for P08-2.
3. Extend capability-matrix payload with domain group summaries.
