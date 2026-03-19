# Phase 12: Unified Built-In and Extendable Agent Skills

## Goal
Build one consistent extension architecture for all `backend/src/agent-skills` domains so that:
- every skill class supports both built-in skills and external SkillHub skills;
- each class has one stable, pluggable provider contract within the class;
- different classes are allowed to keep different runtime semantics where the business model truly differs;
- no-skill mode remains a first-class fallback and never depends on SkillHub availability.

## Core Target
This phase exists to establish the long-term migration target for the entire skill system.

The target is:
- treat each top-level folder under `backend/src/agent-skills` as one skill class;
- migrate every skill class so that built-in skills and external SkillHub skills use the same package lifecycle and loading pipeline;
- require all skills within the same class to implement one common class-specific provider contract;
- allow different classes to keep different provider contracts when their runtime responsibilities differ;
- keep `no-skill` and baseline core analysis executable even when no skills or no external skills are available.

In short:
- unify across classes at the package/loading level;
- standardize within each class at the provider-contract level;
- do not force one universal runtime interface across all classes.

This is the reference objective for all later class-by-class migrations in Phase 12.

## Phase Layout
Phase 12 uses this structure:
- top-level `PLAN.md` and `STATUS.md` capture the shared architecture and overall migration progress;
- each skill class gets its own subfolder under Phase 12;
- each class subfolder maintains its own `PLAN.md` and `STATUS.md`;
- class migrations should proceed one class at a time against the shared Phase 12 target.

Initial class folders:
- `code-check/`

## Core Principle
The project goal is not "one universal skill handler for everything".

The correct target is:
- unify at the package and provider-resolution layer;
- specialize at the domain-class contract layer.

In practice this means:
- all skill classes share the same package lifecycle, source model, compatibility checks, enable/disable state, and loading pipeline;
- each skill class defines its own provider interface;
- all skills within the same class must be interchangeable through that class contract.

This is the cleanest fit for the repository because `structure-modeling`, `code-check`, `report-export`, and `material-constitutive` do not behave the same, but each category internally should be pluggable.

## Problem Statement
Current skill behavior is partially unified and partially ad hoc:
- `runtime/loader.ts` discovers built-in scenario-style skills from local `manifest` + `handler` modules;
- `code-check` uses a local ordered registry with hardcoded imports;
- SkillHub currently manages catalog, install state, compatibility, and integrity, but does not yet load executable providers into the runtime;
- several top-level skill classes exist in `backend/src/agent-skills`, but there is not yet one shared model for how built-in and external implementations participate in each class.

This leaves a gap:
- built-in skills work;
- external skills can be cataloged and enabled administratively;
- but external skills do not yet cleanly join class-specific runtime execution.

## Non-Negotiable Rules
- No-skill mode stays production-safe and executable with zero enabled skills.
- SkillHub outage, install failure, integrity failure, or provider import failure must not block core analyze flow.
- Every skill class must define one stable provider contract for all members of that class.
- A class contract must be minimal and natural to that class; do not force unrelated classes into one oversized interface.
- Ordering, precedence, conflict resolution, and fallback rules must be explicit.
- User-visible text from any skill path must remain bilingual (`en` and `zh`).
- Built-in behavior should remain backward compatible unless a migration explicitly changes it.

## Target Architecture

### Layer 1: Skill Package Model
All skills, built-in or SkillHub, should normalize into one package model.

Required package fields:
- `id`
- `domain`
- `version`
- `skillApiVersion`
- `source` (`builtin` or `skillhub`)
- `capabilities`
- `compatibility`
- `entrypoints`
- `enabledByDefault` or install-state equivalent

Recommended fields:
- `priority`
- `requires`
- `conflicts`
- `supportedLocales`
- class-specific metadata such as `designCodes`, `materialFamilies`, `analysisTypes`

SkillHub owns:
- catalog metadata
- install/uninstall
- enable/disable
- compatibility evaluation
- integrity checks
- installed package location

Runtime owns:
- provider import
- provider validation
- provider merge
- execution ordering
- failure isolation

### Layer 2: Skill Class Provider Contracts
Each top-level skill class under `backend/src/agent-skills` should define its own pluggable provider contract.

Shared provider metadata:
- `id`
- `domain`
- `source`
- `priority`
- `manifest`

But execution methods differ by class.

### Layer 3: Unified Provider Resolution Pipeline
All classes should load through one common flow:

1. Resolve built-in packages for a class.
2. Resolve installed and enabled SkillHub packages for that class.
3. Validate compatibility and integrity before import.
4. Import class entrypoints lazily.
5. Validate provider shape against the class contract.
6. Merge built-in and external providers.
7. Apply deterministic ordering, conflict, and fallback rules.
8. Expose a class-specific registry to backend services.

## Skill Class Model
The repository already suggests the right skill classes:

1. `structure-modeling`
2. `material-constitutive`
3. `geometry-input`
4. `load-boundary`
5. `analysis-strategy`
6. `code-check`
7. `result-postprocess`
8. `visualization`
9. `report-export`
10. `generic-fallback`

The right standard is:
- cross-class consistency in packaging and loading;
- within-class consistency in provider contract;
- no requirement that class A and class B expose the same runtime methods.

## Recommended Provider Contracts By Class

### 1. Structure Modeling
Nature:
- scenario detection
- draft extraction/merge
- missing-field computation
- clarification questions
- model generation

Contract shape:
- `detectScenario`
- `parseProvidedValues`
- `extractDraft`
- `mergeState`
- `computeMissing`
- `mapLabels`
- `buildQuestions`
- `buildDefaultProposals?`
- `buildModel`
- `resolveStage?`

This is close to the current `SkillHandler` model and should remain the reference contract for scenario-driven classes.

### 2. Material Constitutive
Nature:
- material family detection or normalization
- constitutive defaults
- material parameter completion
- code-linked material constraints

Contract should be narrower than structure-modeling:
- `matchesMaterialFamily`
- `normalizeMaterialInput`
- `computeMissingMaterialFields`
- `buildMaterialQuestions`
- `buildMaterialDefinition`

Do not force full scenario/draft handler semantics here unless truly needed.

### 3. Geometry Input
Nature:
- geometry conversion and normalization
- possibly import adapters from text/CAD/table-like sources

Contract:
- `matchesGeometryInput`
- `convertGeometry`
- `validateGeometry`
- `normalizeGeometry`

This should behave more like a converter provider than a conversation skill.

### 4. Load Boundary
Nature:
- load/boundary interpretation, defaults, validation, normalization

Contract:
- `matchesLoadBoundaryContext`
- `extractLoadBoundaryPatch`
- `computeMissingLoadBoundaryFields`
- `buildLoadBoundaryQuestions`
- `buildLoadBoundaryDefinition`

### 5. Analysis Strategy
Nature:
- analysis policy recommendation
- design situation advice
- parameter defaults

Contract:
- `matchesAnalysisIntent`
- `recommendAnalysisPlan`
- `buildAnalysisQuestions?`
- `applyAnalysisDefaults`

This is a policy provider, not a model generator.

### 6. Code Check
Nature:
- ordered rule matching
- design code mapping
- execution dispatch
- fallback behavior

Contract:
- `matches`
- `execute`
- `designCode?`
- `skillId`

Plus provider-level metadata:
- `priority`
- `fallback`
- `source`

This class must preserve explicit ordering and a hard fallback-last rule.

### 7. Result Postprocess
Nature:
- result summarization
- metric extraction
- controlling-case reduction

Contract:
- `matchesPostprocessContext`
- `summarizeResults`
- `extractKeyMetrics`
- `buildControllingCases?`

### 8. Visualization
Nature:
- chart/table/hint generation for analysis results

Contract:
- `matchesVisualizationContext`
- `buildVisualizationHints`
- `buildArtifacts?`

### 9. Report Export
Nature:
- narrative template generation
- bilingual labels
- report section composition

Contract:
- `matchesReportContext`
- `buildNarrative`
- `buildSections`
- `buildLocalizedLabels`

### 10. Generic Fallback
Nature:
- generic no-skill or low-skill fallback behaviors

Contract:
- keep very small and guarded;
- must never absorb domain-specific deterministic logic again.

## Why This Fits The Project
This matches the repository's actual intent:
- the core product is a structural analysis platform;
- skills are domain capability modules, not just UI prompt packs;
- the system should be extensible by category;
- each category is a family of interchangeable implementations.

So the most aligned approach is:
- treat each top-level folder under `backend/src/agent-skills` as a skill class;
- define one provider interface per class;
- make all implementations in that class pluggable through that interface;
- share package loading and lifecycle across all classes.

This preserves architectural clarity:
- differences between classes stay explicit;
- differences inside a class become disciplined and replaceable.

## Work Packages

### WP1: Define Shared Package and Provider Base Types
Scope:
- add shared `SkillPackageManifest`, `SkillPackageSource`, `ProviderBase`, and provider-loading result types;
- separate package metadata from class-specific provider contracts.

Acceptance:
- built-in and SkillHub packages can be represented through one normalized package model.

### WP2: Define Provider Contract Per Skill Class
Scope:
- create explicit provider interfaces for each top-level skill class;
- keep class contracts minimal and natural.

Acceptance:
- every skill class has a documented pluggable interface;
- all members of a class can be loaded through that interface.

### WP3: Build Shared Provider Loader Pipeline
Scope:
- add runtime infrastructure that resolves built-in and external packages, validates them, imports providers lazily, and merges them by class.

Acceptance:
- backend services can request providers by class without caring whether they came from built-in code or SkillHub.

### WP4: Migrate `code-check` To Class Provider Registry
Scope:
- convert hardcoded rule registry to a built-in + external provider registry;
- preserve explicit ordering and last-resort fallback.

Acceptance:
- `code-check` becomes the first class with full pluggable provider semantics.

### WP5: Migrate Scenario-Driven Skill Classes
Scope:
- migrate `structure-modeling`, then adjacent scenario/policy/report classes onto the shared provider loading model.

Acceptance:
- current built-in runtime behavior continues through the new provider pipeline.

### WP6: Upgrade SkillHub To Executable Provider Packages
Scope:
- extend SkillHub beyond metadata/state management to load installed enabled packages as class providers.

Acceptance:
- at least one external skill can participate in runtime through the same class contract as built-in skills.

### WP7: Regression Matrix and Failure Isolation
Scope:
- add tests for merge behavior, conflicts, exclusion, provider failure isolation, and no-skill fallback.

Acceptance:
- provider failures are contained;
- built-in-only and built-in+external execution paths are both covered.

## Recommended Migration Order
1. Shared package/provider types.
2. `code-check` provider registry.
3. Shared provider loader infrastructure.
4. `structure-modeling` migration.
5. Adjacent classes: `analysis-strategy`, `report-export`, `material-constitutive`.
6. Converter-style classes: `geometry-input`, `load-boundary`, `result-postprocess`, `visualization`.
7. External executable SkillHub packages.

## First Slice Recommendation
The best first implementation slice is still `code-check`, but with a clearer architectural reason:
- it is already a real class;
- all members of the class are the same kind of thing: rule providers;
- ordering and fallback are unavoidable, so the contract becomes honest immediately;
- it proves the built-in + external merge model without forcing the whole conversation runtime to change.

## Risks
- Forcing every class into today's `SkillHandler` shape will create accidental complexity.
- Over-generalizing too early will blur boundaries between scenario skills, policy skills, converter skills, and rule engines.
- External executable packages increase runtime risk unless loading is lazy and failure-isolated.
- Domain migration without class-level contract tests will reintroduce hidden coupling.

## Exit Criteria
- every top-level skill class has a documented provider contract;
- runtime resolves built-in and external providers through one shared loading pipeline;
- at least one class supports executable SkillHub providers in production code;
- no-skill mode remains intact and tested;
- class-level ordering/conflict/fallback rules are explicit and covered.

## Suggested Commits
1. `docs(planning): convert phase 12 to plan and status tracking`
2. `refactor(agent-skills): add shared package and provider base types`
3. `refactor(code-check): adopt class provider registry`
4. `refactor(agent-skills): add shared provider loader`
5. `feat(skillhub): load executable class providers`
6. `test(agent-skills): cover builtin and external provider behavior`
