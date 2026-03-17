# Phase 09 Status Ledger

Updated: 2026-03-18
Owner: backend-agent

## Current Execution Rule
- First complete no-skill test cleanup for redundant template-driven assertions.
- Do not expand to next-step implementation planning until cleanup + regression validation are complete.

## Work Package Status
- WP1 Remove Template Matchers From No-Skill Runtime: completed
- WP2 Remove Hardcoded Template Model Builders From No-Skill Runtime: completed
- WP3 Move Template Logic To Skill Plugins (Or Delete): in progress
- WP4 Generic Clarification Contract: completed
- WP5 Validation and Regression Matrix: in progress (priority)

## Completed This Iteration
- Added orchestration fallback: when skill path remains `unknown` and cannot build a model, backend now falls back to generic no-skill LLM JSON model generation instead of hard-blocking on scenario clarification.
- Added regression test to verify unknown skill scenario falls back to generic LLM JSON generation under a restricted skill set.
- Simplified no-skill draft normalization to a minimal generic state (`inferredType=unknown` + timestamps), removing retained structure-specific draft parameters.
- Removed no-skill providedValues parameter merge/carry-over behavior for structural fields; no-skill now avoids persisting structure-template draft values.
- Removed no-skill LLM extraction/merge pipeline from `agent.ts`; no-skill now uses direct generic model JSON generation path only.
- Re-aligned no-skill boundary tests to enforce that structural template parameters are not persisted in generic core state.
- Added one retry for no-skill generic LLM JSON generation when first output is non-JSON/invalid, while preserving generic core behavior.
- Added explicit de-scope policy for template-only no-skill tests in phase plan.
- Added strict execution order: test cleanup first, then next-step planning.
- Added dedicated status ledger file for phase tracking.
- Pruned template-driven deterministic synthesis tests from backend/tests/agent.service.test.mjs.
- Removed no-skill execute compatibility rule-based fallback from core runtime.
- Removed no-skill runtime helper functions that performed deterministic template-like synthesis.
- Removed residual template-coupled span inference from no-skill draft-state merge.
- Removed template-oriented wording from no-skill LLM extraction prompt constraints.
- Forced no-skill draft merge path to keep inferredType pinned to unknown.
- Removed no-skill supportType/frameBaseSupportType parsing from LLM extraction and state merge path.
- Removed no-skill categorical loadPosition parsing and state merge; keep numeric loadPositionM only.
- Removed no-skill inferredType from extraction prompt constraints and prior context payload.
- Removed no-skill categorical loadType parsing and state merge; keep numeric load magnitude only.
- Hardened no-skill state normalization to strip carried-over skill metadata fields from existing state.
- Removed explicit no-skill template placeholder writes (supportType/frameBaseSupportType/loadType/loadPosition set to undefined) from normalize/merge/extract paths.
- Routed no-skill providedValues through generic sanitizer path (no skillRuntime applyProvidedValues) and cleared scenario carry-over.
- Added no-skill session-level sanitization on run/snapshot entry to purge residual scenario metadata when switching from skill mode.
- Updated no-skill extractionMode semantics to preserve LLM-first labeling whenever an LLM is configured, even when extraction parsing falls back.
- Updated repository-down contract to use explicit computable model input (deterministic, non-LLM-dependent).
- Added explicit boundary test: no-skill execute must stay blocked when computable model is unavailable.
- Added explicit boundary test: no-skill must keep inferredType unknown even when LLM extraction returns a template type.
- Added explicit boundary test: no-skill must ignore template support fields even when LLM extraction returns them.
- Added explicit boundary test: no-skill must ignore categorical loadPosition even when LLM extraction returns it.
- Added explicit boundary test: no-skill must ignore categorical loadType even when LLM extraction returns it.
- Added explicit boundary test: no-skill state normalization must strip skill metadata from persisted state.
- Strengthened no-skill boundary test to assert template placeholders are absent from persisted state object (not only undefined reads).
- Added explicit boundary test: no-skill providedValues must not reintroduce skill metadata or scenario state.
- Added explicit boundary test: switching existing conversation from skill mode to no-skill must clear detected scenario/support-note carry-over.
- Added explicit boundary test: no-skill keeps extractionMode=llm when LLM extraction falls back but LLM model path is attempted.
- Verified `npm test --prefix backend -- --runInBand backend/tests/agent.service.test.mjs` is green (42/42).
- Verified `make backend-regression` is green.

## Next Actions (Priority Order)
1. Keep and strengthen contract tests: clarification, execute gating, validate/analyze chain, repository-down fallback.
2. Continue inventory/migration of remaining deterministic template behavior into explicit skill plugins only.
3. Add boundary tests that prevent template logic from re-entering no-skill runtime.
4. Re-run targeted/backend regression after each slice.

Latest validation snapshot:
- `npm test --prefix backend -- --runInBand backend/tests/agent.service.test.mjs`: green (51/51)
- `make backend-regression`: green

## Exit Gate For Next-Step Planning
All items below must be true:
- template-driven no-skill test cases are removed or rewritten as generic contracts;
- targeted backend tests are green;
- backend regression is green.

Gate status: satisfied (2026-03-18).
