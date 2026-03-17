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
