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
