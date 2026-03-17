# Phase 07 - Skillization Core Minimization Plan

## Goal
- Move domain strategies out of `backend/src/services/agent.ts` into skill runtime/policy modules.
- Keep core orchestration minimal: session state, tool gateway, protocol, persistence, observability.

## Scope (Ordered)
1. PR-1: Extract non-structural policy inference and normalization from `agent.ts`.
2. PR-2: Move interaction questions/default proposals into skill handlers/runtime.
3. PR-3: Unify unsupported/fallback scenario detection source.
4. PR-4: Replace `shouldRouteToExecute` hardcoded keywords with skill-driven routing recommendation.
5. PR-5: Skillize report narrative templates; core keeps data aggregation only.
6. PR-6: Build capability matrix (skill x engine) and expose to frontend for valid combinations.

## PR-1 Concrete Tasks
- Introduce a policy module under `backend/src/services/` for:
  - `inferAnalysisType`
  - `inferCodeCheckIntent`
  - `inferDesignCode`
  - `inferReportIntent`
  - `normalizeAnalysisType`
  - `normalizeReportFormat`
  - `normalizeReportOutput`
- Rewire `AgentService` to delegate these decisions.
- Preserve existing behavior and contract.

## PR-1 Progress
- Done: `backend/src/services/agent-policy.ts` created and wired into `AgentService`.
- Done: Policy inference and normalization moved out of `agent.ts`.
- Done: Non-structural default proposals, stage label mapping, missing-label mapping, question templates, and stage resolution moved to policy service.
- Verified: backend build + `validate-agent-skills-contract.sh` + `validate-agent-orchestration.sh` + `validate-chat-stream-contract.sh`.

## PR-2 Progress (In Progress)
- Done: `SkillHandler` now supports optional `buildDefaultProposals` hook.
- Done: `AgentSkillRuntime` now exposes structural default proposal generation and prefers handler-level proposals.
- Done: all current structural handlers (`beam`, `double-span-beam`, `frame`, `portal-frame`, `truss`) are wired to provide structural default proposals via runtime hook.
- Done: handler-level default proposal values/reasons are now skill-specific (no longer one-size-fits-all legacy defaults):
  - `beam`: default to distributed + full-span for baseline beam load modeling.
  - `double-span-beam`: default to distributed + full-span for coupled two-span response.
  - `truss`: default to point load + top-nodes to match nodal force idealization.
  - `portal-frame`: default to distributed + full-span to align with common roof load expression.
  - `frame`: default `frameDimension` now inferred from state hints (`2d`/`3d`) with specialized bilingual reasons.
- Done: handler-level question phrasing now overrides legacy baseline for key fields (load type/position, support assumptions, and frame 2D/3D guidance), with bilingual copy.
- Done: structural handlers now build question baselines directly from fallback primitives (`buildInteractionQuestions`) instead of `legacy` wrappers.
- Done: removed unused `legacy` question/default-proposal wrappers to reduce coupling surface.
- Done: `agent.ts` now merges structural defaults from skill runtime with non-structural defaults from policy service.
- Verified: backend build + `validate-agent-orchestration.sh` + `validate-agent-skills-contract.sh`.
- Next: start PR-3 and unify unsupported/fallback detection source between `registry` and rule helpers.

## PR-3 Progress (In Progress)
- Done: unsupported scenario keyword detection is now shared from `fallback.ts` via `detectUnsupportedScenarioByRules`.
- Done: `AgentSkillRegistry.detectScenario` now consumes shared helpers (`detectUnsupportedScenarioByRules`, `buildUnknownScenario`) instead of local duplicated rules.
- Done: removed deprecated `detectScenarioByRules` branch from `fallback.ts` to avoid parallel scenario-routing logic.
- Goal: continue reducing duplicated scenario semantics by converging any remaining fallback-only scenario mapping branches.

## PR-4 Progress (In Progress)
- Done: added skill-runtime routing recommendation API (`shouldPreferExecute`) derived from detected scenario support level and mapped type.
- Done: `AgentService` auto mode now routes by skill-runtime recommendation instead of keyword-based `shouldRouteToExecute` heuristic.
- Done: chat API routes now call `AgentService.shouldPreferExecute` (async) for auto-mode routing, reusing conversation draft context when available.
- Done: added stage-aware guard in `AgentService.shouldPreferExecute`; when current session is still in `intent/model/loads` due to critical missing fields, auto mode prefers chat.
- Done: non-structural stage hints now contribute to route decisions; if analysis/code-check/report preferences are still missing and user has not approved auto-decide, auto mode prefers chat.
- Done: interaction payload now includes explicit route telemetry (`routeHint`, `routeReason`) for frontend traceability.
- Goal: evaluate whether route telemetry should be normalized to stable reason codes in addition to localized text.

## PR-5 Progress (In Progress)
- Done: report markdown narrative rendering has been moved out of `agent.ts` into `backend/src/services/agent-skills/report-template.ts` (skill runtime fallback template).
- Done: `AgentSkillRuntime` now exposes `buildReportNarrative(...)`, enabling per-skill narrative overrides through optional `SkillHandler.buildReportNarrative`.
- Done: `AgentService.generateReport(...)` now keeps report data aggregation only (summary/key metrics/traceability/controlling cases) and delegates narrative rendering to skill runtime.
- Done: frame skill now provides its own report narrative override (appends frame-specific guidance section in bilingual markdown output).
- Done: beam / truss / portal-frame skills now provide their own narrative overrides with bilingual scenario-specific guidance sections.
- Done: double-span-beam now has an independent continuous-beam narrative section (no longer implicitly inheriting beam narrative).
- Verified: backend build + `validate-report-template-contract.sh` + `validate-agent-orchestration.sh` + `validate-agent-skills-contract.sh`.
- Next: evaluate whether any scenario should expose report reason codes to align with PR-4 route telemetry normalization direction.

## PR-6 Progress (In Progress)
- Done: added backend capability matrix service (`backend/src/services/agent-capability.ts`) that combines skill manifests with engine catalog manifests.
- Done: exposed `GET /api/v1/agent/capability-matrix` for frontend consumption.
- Done: frontend AI console now fetches capability matrix and constrains selectable engines to skill-compatible enabled engines.
- Done: when a previously selected engine becomes incompatible with current skill selection, selector falls back to `auto`.
- Done: engine picker now explicitly shows that candidates are filtered by selected skills and displays an empty-compatible-candidates hint.
- Done: added contract script `scripts/validate-agent-capability-matrix.sh` and wired it into backend regression flow.
- Done: capability matrix now exposes per-skill filtered-engine reason codes; frontend renders filtered-out engines with localized reason text.
- Done: documented capability-matrix reason-code contract in `docs/analysis-engine-skills.md`.
- Done: added frontend rendering test for filtered-out engine reasons (`frontend/tests/components/console/ai-console-engine-filter.test.tsx`).
- Done: capability matrix now accepts optional `analysisType` query and includes `analysis_type_mismatch` reason evaluation.
- Done: frontend requests capability matrix with current analysis type and surfaces analysis-type mismatch reasons via localized text.
- Done: frontend engine issue evaluation now prefers capability-matrix reason payload, using local checks only as fallback.
- Verified: backend build + frontend type-check + `validate-agent-api-contract.sh` + backend regression.
- Next: decide whether to expose analysis-type compatibility badges directly in engine cards for quick visual scanning.

## Validation
- `npm run lint --prefix backend`
- `npm test --prefix backend -- --runInBand`
- `./scripts/validate-agent-skills-contract.sh`
- `./scripts/validate-agent-orchestration.sh`
- `./scripts/validate-chat-stream-contract.sh`

## Acceptance
- `agent.ts` shrinks and no longer contains policy keyword heuristics/normalization internals.
- API behavior remains backward compatible.
- Regression scripts pass.

## Next Stage Baseline (Domain Skill Taxonomy)

### Guiding Principle
- Skills are organized by capability domains (not only by structure type).
- Skill loading is optional enhancement; it must not block core analysis execution.
- When no domain skill is loaded, the system must still run via LLM-driven generic input extraction and core engine execution.

### Domain Skill Categories
1. Structure-Type Skills
  - Scenario identification and type-specific templates (beam/frame/truss/plate-shell, etc.).
  - Type-specific defaults and modeling constraints.
2. Material and Constitutive Skills
  - Material cards, constitutive model selection, damping/degradation parameters.
3. Geometry Input Skills
  - Natural-language geometry parsing, parametric generation, model import/conversion adapters.
4. Load and Boundary Skills
  - Load case/combination interpretation, boundary condition extraction and consistency checks.
5. Analysis Strategy Skills
  - Static/dynamic/seismic/nonlinear strategy selection and solver/step parameterization.
6. Code-Check Skills
  - Design code clause mapping, utilization checks, traceability output.
7. Result Postprocess Skills
  - Envelopes, governing cases, key engineering indicators, anomaly diagnostics.
8. Visualization Skills
  - Model/result rendering payload shaping, annotation and comparison interaction helpers.
9. Report and Export Skills
  - Narrative templates, review summaries, JSON/Markdown/PDF export styles.
10. Generic Fallback Skills
  - Minimum computable input extraction and conservative defaulting when no other skills are loaded.

### No-Skill Fallback Policy (Mandatory)
- If user loads no domain skills, route to generic fallback path automatically.
- Use LLM extraction to produce minimum computable model input.
- Ask clarification for critical missing fields; allow conservative auto-decide when user approves.
- Execute core OpenSees pipeline directly and return baseline analysis/report outputs.

### Execution Plan (Proposed)
1. Define domain-skill protocol and dependency/conflict metadata (`requires`, `conflicts`, `priority`).
2. Add no-skill fallback contract tests to guarantee non-blocking execution path.
3. Migrate current functionality to domain categories incrementally while keeping API compatibility.

## Handoff
- Next execution phase is tracked in `.planning/phases/08-domain-skill-migration/PLAN.md`.
