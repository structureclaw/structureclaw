# Phase 09: No-Skill Generic LLM Mode

## Goal
Turn no-skill mode into a truly generic, LLM-first path with no scenario/template matching logic in core no-skill runtime.

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

Required tests:
- no-skill should not infer beam from support/load wording alone.
- no-skill should not emit template-anchored missing fields.
- no-skill should accept arbitrary structural intent and request generic computability details.
- skill-enabled flows retain existing deterministic template behavior.

Commands:
- npm run build --prefix backend
- npm test --prefix backend -- backend/tests/agent.service.test.mjs --runInBand

## Suggested Commit Slices
1. refactor(agent): remove no-skill rule/template extraction
2. refactor(agent): remove no-skill hardcoded model synthesis
3. feat(agent-skills): absorb moved template behavior into skills
4. test(agent): enforce template-agnostic no-skill contract
5. docs(planning): finalize phase-09 outcomes

## Exit Criteria
- no-skill path is LLM-first and template-agnostic.
- template matching/synthesis exists only in skill modules.
- regression suite passes with explicit no-skill generic guarantees.
