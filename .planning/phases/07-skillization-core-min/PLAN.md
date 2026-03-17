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
- Verified: backend build + frontend type-check + `validate-agent-api-contract.sh` + backend regression.
- Next: document reason-code contract in docs and pin a small frontend rendering test for filtered-reason text.

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
