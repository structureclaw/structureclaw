# Phase 09: No-Skill Generic LLM Mode

## Goal
Turn no-skill mode into a truly generic, LLM-first path with no scenario/template matching logic in core no-skill runtime.

## Execution Priority
Phase-09 execution order is strict:
1. First remove redundant no-skill tests that rely on deterministic template assumptions and do not validate generic capability.
2. Then stabilize no-skill contract tests around orchestration boundaries (clarification, gating, validate/analyze flow).
3. Only after test cleanup is complete, schedule and execute the next implementation package.

Next-step planning after WP5 cleanup is gated and must not start early.

## Problem Statement
Current no-skill runtime still contains domain-template assumptions (beam-oriented parsing, support/load-position heuristics, template-oriented inferredType coercion, and hardcoded model skeletons). This violates the target architecture:
- no-skill: generic orchestration + validation + clarification only
- skill: scenario/template/domain-specific behavior

## Guardrails
- No scenario-specific regex matching in no-skill path.
- No hardcoded structural template synthesis in no-skill path.
- No implicit inferredType promotion (for example unknown -> beam) in no-skill path.
- Keep core deterministic in protocol and persistence behavior.
- Keep bilingual user-visible prompts (en/zh).

## Target Architecture
- no-skill runtime responsibilities:
  - LLM-first extraction into neutral draft hints.
  - LLM-first model generation into StructureModel JSON.
  - schema/shape validation, sanitization, and safe rejection.
  - generic clarification questions when model is not computable.
- skill runtime responsibilities:
  - all template/domain matching and deterministic template synthesis.
  - domain-specific missing-field logic and guided questions.

## Work Packages

### WP1: Remove Template Matchers From No-Skill Runtime
Scope:
- Remove rule-based scenario extraction and template-specific regex blocks from no-skill runtime.
- Remove support/load-position heuristic derivations that imply known templates.

Files:
- backend/src/services/agent-noskill-runtime.ts
- backend/src/services/agent.ts (call-site adjustments)

Acceptance:
- no-skill runtime contains no beam/truss/portal/double-span regex/template resolver.

### WP2: Remove Hardcoded Template Model Builders From No-Skill Runtime
Scope:
- Remove hardcoded beam-like model constructor from no-skill runtime.
- Keep only generic LLM-generated model path plus model-shape validation.

Files:
- backend/src/services/agent-noskill-runtime.ts
- backend/tests/agent.service.test.mjs

Acceptance:
- no-skill path does not construct template-specific node/element defaults.
- when LLM cannot produce a computable model, system asks for generic clarification instead of forcing template assumptions.

### WP3: Move Template Logic To Skill Plugins (Or Delete)
Scope:
- For each removed no-skill template behavior, either:
  - place behavior in an explicit skill plugin, or
  - delete behavior if no longer needed.

Files:
- backend/src/services/agent-skills/**
- backend/src/services/agent-skills/index.ts

Acceptance:
- all remaining template behaviors are discoverable under agent-skills only.

### WP4: Generic Clarification Contract
Scope:
- Define strict generic clarification when no-skill LLM output is insufficient.
- Clarification must not mention or suggest a fixed template unless user explicitly requests one.

Files:
- backend/src/services/agent.ts
- backend/src/services/agent-noskill-runtime.ts
- backend/tests/agent.service.test.mjs

Acceptance:
- prompts/questions are template-agnostic in no-skill mode.

### WP5: Validation and Regression Matrix
Scope:
- Add/adjust tests to enforce generic no-skill behavior.
- Remove template-only tests that primarily verify deterministic template synthesis in no-skill mode.
- Keep contract tests that verify orchestration, safety boundaries, and fallback behavior.

Required tests:
- no-skill should not infer beam from support/load wording alone.
- no-skill should not emit template-anchored missing fields.
- no-skill should accept arbitrary structural intent and request generic computability details.
- skill-enabled flows retain existing deterministic template behavior.
- no-skill tests should focus on protocol contracts (clarification, execute gating, validate/analyze chaining), not LLM quality scoring.

De-scope tests (for phase-09 no-skill path):
- remove tests that assert fixed template geometry/topology from plain natural language in no-skill mode.
- remove tests that depend on deterministic template tokens as a proxy for LLM capability.

Must keep tests:
- no-skill clarification remains template-agnostic.
- no-skill execute gating behaves correctly with/without computable model.
- no-skill validate/analyze tool-chain contracts remain stable.
- repository-down fallback contract remains green.

Commands:
- npm run build --prefix backend
- npm test --prefix backend -- backend/tests/agent.service.test.mjs --runInBand

## Suggested Commit Slices
1. test(agent): prune redundant no-skill template-driven tests
2. test(agent): enforce no-skill generic contract coverage only
3. refactor(agent): remove remaining no-skill template coupling
4. feat(agent-skills): absorb moved template behavior into skills
5. docs(planning): finalize phase-09 outcomes

## Progress Tracking
Execution status is tracked in a dedicated file:
- .planning/phases/09-noskill-generic-llm/STATUS.md

## Post-Cleanup Next Plan
Precondition: test-cleanup gate satisfied (template-driven no-skill tests removed, targeted/backend regressions green).

Step 1:
- tighten no-skill execute path to avoid compatibility template fallback as default behavior.
- keep behavior strictly generic: computable model -> execute, non-computable model -> generic clarification.

Step 2:
- inventory remaining template-coupled behavior in core no-skill path and migrate/delete it.
- ensure any deterministic template synthesis is discoverable only under agent-skills.

Step 3:
- add/adjust contract tests only at orchestration boundary (not LLM quality).
- enforce no-skill/skill boundary with explicit assertions.

Step 4:
- run `npm test --prefix backend -- --runInBand backend/tests/agent.service.test.mjs` and `make backend-regression` after each implementation slice.

## Exit Criteria
- no-skill path is LLM-first and template-agnostic.
- template matching/synthesis exists only in skill modules.
- regression suite passes with explicit no-skill generic guarantees.
- no-skill redundant template-driven tests are removed before any next-step phase expansion.
