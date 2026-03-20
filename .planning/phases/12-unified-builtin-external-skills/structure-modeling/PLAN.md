# Phase 12 Class Plan: Structure Modeling

## Goal
Migrate `backend/src/agent-skills/structure-modeling` from the current built-in manifest-and-handler runtime into a class-specific provider architecture that supports:
- built-in structure-modeling skills;
- future external SkillHub structure-modeling skills;
- deterministic provider selection and fallback;
- class-local scenario detection, draft extraction, clarification, and model assembly;
- strict isolation from no-skill mode.

## Current Scope Closure Rule
This class plan does not require a real external structure-modeling package before it can close.

For the current repository scope, `structure-modeling` is considered complete when:
- built-in runtime resolution is routed through a class provider registry;
- the class participates in the shared package/provider/loader architecture;
- executable-provider entrypoint contracts and validation hooks exist for future external packages;
- no-skill isolation and built-in regression coverage remain intact.

Real installed-package discovery and runtime loading are deferred until the first external structure-modeling package exists.

## Product Direction
For `structure-modeling`, the product goal is not to replace the current scenario-driven interaction model.

The intended direction is:
- keep `structure-modeling` as the main skill class responsible for structure-type intent detection and structure-specific draft/model generation;
- keep current built-in scenario UX behavior for beam, frame, portal-frame, truss, and double-span-beam backward compatible during migration;
- let selected skills and auto-load behavior determine which structure-modeling providers participate in detection and draft generation;
- keep no-skill mode outside the structure-modeling provider dependency path so the generic LLM fallback still works when no skills are selected or no providers can load.

## Why Structure Modeling Next
`structure-modeling` is the next Phase 12 class to formalize because:
- it is already the repository's most mature scenario-driven skill class;
- it already has a real contract in code through `SkillManifest` + `SkillHandler`;
- it drives the primary chat and execute experience more directly than any other class;
- it is the highest-value place to prove that the shared Phase 12 provider model can coexist with protected no-skill behavior.

## Current State
The class currently lives under `backend/src/agent-skills/structure-modeling` and already exposes built-in skills such as:
- `beam`
- `double-span-beam`
- `frame`
- `portal-frame`
- `truss`

Current runtime behavior:
- markdown stage files (`intent.md`, `draft.md`, `analysis.md`, `design.md`) and module files (`manifest.ts`, `handler.ts`) are discovered from disk by the shared `runtime/loader.ts`;
- `AgentSkillRegistry` resolves enabled plugins from built-in runtime bundles, using `autoLoadByDefault` when `skillIds` are omitted and using explicit selection when `skillIds` are provided;
- `AgentSkillRuntime` uses the resolved plugin to perform scenario detection, draft extraction, missing-field assessment, question building, default proposals, and model assembly;
- `AgentService` bypasses the runtime entirely in no-skill mode and calls `textToModelDraftWithoutSkills()`.

This means `structure-modeling` already has:
- a strong built-in contract;
- deterministic built-in loading semantics;
- explicit no-skill separation.

But it does not yet have:
- a Phase 12 provider registry that merges built-in and external structure-modeling providers through one class-specific provider model;
- executable SkillHub package loading for this class;
- explicit provider-level ordering/conflict rules beyond the current built-in manifest priority ordering;
- regression coverage for built-in/external merge and provider failure isolation.

## Core Target
Within the `structure-modeling` class:
- every scenario-driven structure skill must be pluggable through one class-specific provider contract;
- built-in and external structure-modeling skills must participate in the same provider registry;
- provider ordering, conflict handling, and fallback behavior must be deterministic;
- provider load failure must exclude only the bad provider and must not break the rest of structure-modeling behavior.

Within the product/runtime model:
- selected structure-modeling skills should continue to control scenario detection and draft/model generation;
- built-in behavior should remain backward compatible during migration;
- no-skill mode must remain independent and production-safe even if the structure-modeling provider registry is empty or broken.

## Class Contract

### Runtime Contract
The current `SkillHandler` shape is already the right starting point for `structure-modeling`.

Current contract responsibilities:
- `detectScenario`
- `parseProvidedValues`
- `extractDraft`
- `mergeState`
- `computeMissing`
- `mapLabels`
- `buildQuestions`
- `buildDefaultProposals?`
- `buildReportNarrative?`
- `buildModel`
- `resolveStage?`

The migration should preserve this scenario-driven contract rather than inventing a second abstraction for the same runtime behavior.

### Provider Metadata
The class should wrap the existing `SkillManifest` + `SkillHandler` pair in explicit provider metadata suitable for Phase 12:
- `id`
- `domain: 'structure-modeling'` or equivalent class identifier once shared provider base types exist
- `source: 'builtin' | 'skillhub'`
- `priority`
- `manifest`
- `handler`
- optional compatibility/fallback/conflict metadata normalized through the shared package layer

### Registry Rules
- providers are filtered by enabled/disabled state and compatibility before use;
- explicit `skillIds` selection must continue to narrow the active provider set;
- when `skillIds` are omitted, only providers with built-in auto-load semantics should participate by default;
- tie-breaks must be deterministic;
- provider load failure must not block no-skill mode or other valid structure-modeling providers;
- if no provider matches, runtime should fall back to the existing unknown-scenario path rather than silently fabricating a structure type.

## Package Model For Structure Modeling
Built-in and external structure-modeling packages should normalize into one class-compatible package model with:
- `id`
- `domain`
- `version`
- `skillApiVersion`
- `source`
- `capabilities`
- `compatibility`
- `entrypoints.structureModeling`
- `scenarioKeys`
- `priority`
- optional `requires`
- optional `conflicts`
- optional `supportedLocales`
- optional structure-modeling metadata such as `structureType`, `supportedAnalysisTypes`, `materialFamilies`

The current `SkillManifest` already covers much of this shape for built-in skills, but Phase 12 still needs a shared package/provider mapping that also works for SkillHub executable packages.

## Target Runtime Flow
1. Resolve built-in structure-modeling packages.
2. Resolve installed and enabled SkillHub structure-modeling packages.
3. Validate compatibility and integrity before import.
4. Import provider entrypoints lazily.
5. Validate provider shape against the `structure-modeling` class contract.
6. Merge built-in and external providers using explicit ordering/conflict rules.
7. Use the merged provider registry for:
   - scenario detection
   - selected-skill filtering
   - draft extraction and merge
   - missing-field assessment and questions
   - model assembly
8. Keep no-skill mode on its separate execution path without depending on any provider registry result.

## Migration Scope

### In Scope
- documenting and formalizing the current `structure-modeling` class contract;
- introducing explicit provider metadata around built-in manifests/handlers;
- defining a provider registry and merge seam for built-in plus future external providers;
- preserving selected-skill and auto-load semantics during migration;
- preserving no-skill isolation and unknown-scenario fallback behavior;
- adding regression coverage for provider ordering, selected-skill filtering, provider failure isolation, and no-skill protection.

### Out of Scope
- redesigning the current structure-modeling conversation UX;
- replacing the protected no-skill generic model builder;
- shipping the final SkillHub executable package format for all classes;
- wiring runtime imports to real installed SkillHub package directories before an external structure-modeling package exists;
- changing core FEM model schemas outside what provider migration requires.

## Work Packages

### WP1: Document and Normalize the Existing Class Contract
Scope:
- capture the current `SkillManifest` + `SkillHandler` responsibilities as the structure-modeling class contract;
- define how existing built-in manifests/handlers map to Phase 12 package/provider concepts.

Acceptance:
- the class contract is explicit enough to migrate built-in and future external providers without changing behavior.

### WP2: Add Structure-Modeling Provider Metadata and Registry Types
Scope:
- define class-specific provider metadata around existing manifests/handlers;
- keep current handler behavior intact.

Acceptance:
- built-in structure-modeling skills can be represented as providers without changing user-visible runtime behavior.

### WP3: Refactor Built-In Runtime Resolution Through a Class Provider Registry
Scope:
- route built-in structure-modeling skills through a class provider registry rather than directly through ad hoc runtime plugin lists;
- preserve current selected-skill and auto-load semantics.

Acceptance:
- existing beam/frame/portal-frame/truss/double-span-beam flows remain backward compatible.

### WP4: Add External Provider Loading Seam
Scope:
- add a safe structure-modeling external-provider seam even if the first implementation returns no providers;
- define provider merge and deterministic ordering rules.

Acceptance:
- built-in and external structure-modeling providers can be merged through one registry function.

### WP5: Preserve No-Skill Isolation and Unknown-Scenario Fallback
Scope:
- ensure no-skill mode still bypasses structure-modeling providers entirely;
- ensure provider failure or an empty provider registry still yields current unknown-scenario behavior instead of a hard runtime failure.

Acceptance:
- no-skill mode remains executable and deterministic with zero structure-modeling providers.

### WP6: Add Regression Coverage
Required tests:
- built-in provider selection order remains deterministic;
- explicit `skillIds` filtering still works;
- omitted `skillIds` still follow auto-load semantics;
- provider load failure excludes only the failing provider;
- no provider match still returns the unknown-scenario path;
- no-skill mode remains isolated from structure-modeling provider failures;
- existing built-in structure-modeling chat and execute flows stay backward compatible.

Acceptance:
- targeted backend tests and scripts cover class-specific provider behavior plus no-skill protection.

## Files Expected To Change
- `backend/src/agent-skills/runtime/types.ts`
- `backend/src/agent-skills/runtime/loader.ts`
- `backend/src/agent-skills/runtime/registry.ts`
- `backend/src/agent-skills/runtime/index.ts`
- `backend/src/services/agent.ts`
- new helper files under `backend/src/agent-skills/structure-modeling/` as needed
- backend tests covering structure-modeling provider resolution behavior
- `scripts/validate-agent-no-skill-fallback.sh` if additional provider-isolation checks are added

## Suggested Commit Slices
1. `docs(planning): add phase 12 structure-modeling class plan`
2. `refactor(structure-modeling): add provider metadata and registry types`
3. `refactor(runtime): route built-in structure-modeling skills through provider registry`
4. `refactor(runtime): add external structure-modeling provider seam`
5. `test(structure-modeling): cover provider ordering, filtering, and no-skill isolation`

## Validation
- `npm run build --prefix backend`
- `npm test --prefix backend -- --runInBand backend/tests/agent.service.test.mjs`
- `./scripts/validate-agent-no-skill-fallback.sh`

## Exit Criteria
- `structure-modeling` has a documented class-specific provider contract;
- built-in manifests/handlers are represented through explicit provider metadata;
- built-in resolution runs through a class provider registry;
- the registry can merge built-in and external providers for this class;
- existing built-in behavior remains backward compatible;
- no-skill mode remains isolated and regression-covered.

Installed-package loading for real external packages is an explicit follow-up, not part of this class plan's closure criteria.
