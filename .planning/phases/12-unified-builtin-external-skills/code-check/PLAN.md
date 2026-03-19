# Phase 12 Class Plan: Code Check

## Goal
Migrate `backend/src/agent-skills/code-check` from a built-in-only ordered registry to a class-specific provider registry that supports:
- built-in code-check skills;
- future external SkillHub code-check skills;
- deterministic ordering;
- explicit unknown-standard failure;
- skill-driven code-check selection instead of analysis-setting-driven design-code input.

## Product Direction
For `code-check`, the design standard should no longer appear as a generic analysis setting.

The intended UX direction is:
- analysis settings should keep analysis concerns only, such as analysis type and report preferences;
- design standard selection should move fully into `code-check` skill selection;
- if no `code-check` skill is selected, the system should treat code-check as not explicitly requested rather than silently defaulting to `GB50017`;
- any remaining raw `designCode` field should be treated as a compatibility bridge only, not the target product model.

This class plan therefore covers not only providerization of `code-check`, but also the shift from `designCode` as a free-form analysis parameter to `code-check` as a first-class skill class.

## Why Code Check First
`code-check` is the best first class to migrate because:
- it is already a clearly isolated skill class;
- all members of the class are the same kind of runtime object: rule providers;
- ordering is already explicit in the current design;
- it is easier to make pluggable than `structure-modeling`, which affects the main conversation runtime more broadly.

## Current State
The class currently uses a hardcoded registry in [`backend/src/agent-skills/code-check/registry.ts`](/data1/openclaw/workspace/projects/10structureclaw/dev/structureclaw/backend/src/agent-skills/code-check/registry.ts):
- built-in rules are imported directly;
- rule order defines match precedence;
- unknown standards should now fail explicitly instead of falling through to a hidden passthrough rule;
- `resolveCodeCheckDesignCodeFromSkillIds()` depends on the registry order to infer the selected design code from enabled skill IDs.

Beyond the registry itself, the product still treats `designCode` as an analysis setting in several places:
- frontend analysis settings expose a dedicated design-code field;
- backend agent execution still resolves `designCode` from session/context and finally falls back to `GB50017`;
- policy and interaction logic still ask for `designCode` as if it were a generic parameter.

This works for built-in rules, but it is not aligned with the target architecture where code-check is a skill class rather than a generic analysis setting.

## Core Target
Within the `code-check` class:
- every rule implementation must be pluggable through one common provider contract;
- built-in and external rules must participate in the same ordered registry;
- unknown standards must fail explicitly and predictably;
- provider loading failure must skip the bad provider without breaking the rest of code-check execution.

Within the product model:
- selected `code-check` skills become the source of truth for design-standard choice;
- analysis settings stop exposing a standalone design-code input;
- backend execution resolves code-check behavior from selected skills and explicit code-check intent, not from a default analysis setting field.

## Class Contract

### Runtime Contract
The existing rule shape is already close to the correct class contract:
- `skillId`
- `designCode?`
- `matches(code: string): boolean`
- `execute(engineClient, input, engineId?): Promise<unknown>`

The migration should preserve this rule-level contract and wrap it in provider metadata rather than redesigning it completely.

### Provider Metadata
Add class-level provider metadata around each rule:
- `id`
- `domain: 'code-check'`
- `source: 'builtin' | 'skillhub'`
- `priority`
- `fallback`
- `manifest`
- `rule`

### Registry Rules
- providers participate in ordered matching;
- tie-breaks must be deterministic;
- duplicate or overlapping rules must be resolved by explicit precedence rules;
- design-code mapping from selected skill IDs must use the same merged provider list;
- there must be a clean "no code-check selected" state instead of forcing a hidden default code.

## Proposed Ordering Rules
1. Exclude disabled, incompatible, invalid, or failed-to-load providers.
2. Sort providers by:
   - `priority` ascending or descending, but choose one rule and document it consistently
   - then `source` preference if needed
   - then `id` for stable ordering
3. If no provider matches the requested design code, fail explicitly instead of silently routing to a passthrough provider.

Recommended rule:
- lower `priority` number = higher precedence

## Package Model For Code Check
Built-in and external code-check packages should normalize into one package model with:
- `id`
- `domain: 'code-check'`
- `version`
- `skillApiVersion`
- `source`
- `capabilities`
- `entrypoints.codeCheck`
- `compatibility`
- optional `designCodes`
- optional `priority`

## Target Runtime Flow
1. Resolve built-in code-check providers.
2. Resolve installed and enabled SkillHub code-check packages.
3. Validate compatibility and integrity for external packages before import.
4. Import each provider entrypoint lazily.
5. Validate provider shape.
6. Merge providers using code-check ordering rules.
7. Use the merged registry for:
   - rule resolution by design code
   - design-code inference from selected skill IDs
   - future provider inspection/debugging
8. Treat the selected code-check skill set as the primary input for whether code-check runs and which standard it uses.

## Migration Scope

### In Scope
- `code-check` provider metadata and registry abstraction
- built-in provider registration refactor
- design-code mapping through merged providers
- removal of standalone design-code analysis setting from the target product flow
- backend migration away from default `GB50017` when no code-check skill is selected
- compatibility plan for any remaining raw `designCode` inputs
- tests for ordering, unknown-standard failure, and merge behavior
- loader seam for future SkillHub external providers

### Out of Scope
- public SkillHub package format finalized for all classes
- dynamic install flow for real third-party code
- changing the Python code-check execution semantics

## Work Packages

### WP1: Define `code-check` Provider Types
Scope:
- add `CodeCheckRuleProvider` and related metadata types;
- keep `CodeCheckRule` intact or minimally adjusted.

Acceptance:
- built-in rules can be expressed as providers without changing runtime behavior.

### WP2: Refactor Built-In Registry To Provider Registry
Scope:
- replace the direct `CodeCheckRule[]` list with built-in provider definitions;
- derive ordered rules from providers.

Acceptance:
- rule resolution remains backward compatible;
- unsupported design codes fail explicitly.

### WP3: Add External Provider Loading Seam
Scope:
- add a registry hook or loader interface that can later supply external code-check providers;
- keep the first implementation safe even if external loading returns an empty list.

Acceptance:
- built-in and external provider arrays can be merged through one function.

### WP4: Preserve Design-Code Resolution Semantics
Scope:
- update `resolveCodeCheckDesignCodeFromSkillIds()` to use merged provider ordering;
- ensure selected built-in skills still map to the expected design code.

Acceptance:
- current behavior remains stable for existing built-in skill IDs.

### WP5: Move Design Standard Ownership From Analysis Settings To Skills
Scope:
- remove the standalone design-code control from analysis settings UI;
- stop treating `designCode` as a first-class generic analysis parameter in the target flow;
- make selected `code-check` skills the source of truth for design-standard selection;
- replace the hidden fallback `GB50017` behavior with explicit code-check intent and explicit skill selection;
- keep compatibility handling only where needed during migration.

Acceptance:
- analysis settings no longer present design standard as a generic field;
- executing analysis without a selected `code-check` skill does not silently force a code-check standard;
- code-check execution, when requested, uses the selected skill-derived standard.

### WP6: Add Regression Coverage
Required tests:
- built-in rule order remains deterministic;
- unknown design codes fail explicitly;
- selected skill IDs resolve to the expected design code;
- invalid or disabled external providers are excluded from the merged registry;
- provider load failure does not break built-in code-check behavior;
- analysis settings no longer expose design-code input in the target UI path;
- backend does not silently default to `GB50017` when no code-check skill is selected;
- selected code-check skills drive code-check execution semantics end to end.

Acceptance:
- targeted backend tests cover the class contract and merge semantics.

## Files Expected To Change
- `backend/src/agent-skills/code-check/registry.ts`
- `backend/src/agent-skills/code-check/rule.ts`
- `backend/src/agent-skills/code-check/entry.ts`
- `backend/src/services/agent.ts`
- `backend/src/services/agent-policy.ts`
- `frontend/src/components/chat/ai-console.tsx`
- `frontend/src/lib/i18n.ts`
- new helper files under `backend/src/agent-skills/code-check/` as needed
- backend tests covering code-check resolution behavior
- frontend tests covering analysis-settings rendering behavior

## Suggested Commit Slices
1. `docs(planning): add phase 12 code-check class plan`
2. `refactor(code-check): add provider types and built-in provider registry`
3. `refactor(code-check): merge design-code resolution through providers`
4. `refactor(agent): move design standard ownership from analysis settings to code-check skills`
5. `test(code-check): cover provider ordering, explicit unknown-code failure, and skill-driven code-check behavior`

## Validation
- `npm run build --prefix backend`
- `npm test --prefix backend -- --runInBand`
- targeted code-check tests if split into a dedicated file

## Exit Criteria
- `code-check` has a documented class-specific provider contract;
- built-in rules are registered as providers rather than a raw hardcoded rule list;
- registry logic supports a future external provider source;
- design-standard selection belongs to code-check skill selection rather than analysis settings;
- backend no longer silently defaults to `GB50017` when no code-check skill is selected;
- ordering and unknown-standard failure behavior are covered by tests.
