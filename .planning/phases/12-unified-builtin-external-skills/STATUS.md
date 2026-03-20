# Phase 12 Status Ledger

Updated: 2026-03-20
Owner: backend-agent

## Current Execution Rule
- Keep the design centered on skill classes, not a single universal runtime interface.
- Require one pluggable provider contract within each class.
- Share package lifecycle and provider-loading infrastructure across classes.

## Architectural Position
- Top-level folders under `backend/src/agent-skills` are the right skill-class boundary.
- Built-in and SkillHub skills should normalize into the same package model.
- Runtime should load class providers through one common pipeline.
- `structure-modeling`, `code-check`, `geometry-input`, `report-export`, and similar classes may keep different execution contracts.
- No-skill remains outside the pluggable-skill dependency path and must stay operational with zero loaded providers.

## Checklist
- [x] Phase 12 planning track created
- [x] Phase 12 converted to `PLAN.md + STATUS.md`
- [x] Core architectural direction documented
- [x] Skill-class boundary identified from `backend/src/agent-skills`
- [x] Principle established: class-to-class differences allowed, within-class contract must be pluggable
- [x] First migration target selected: `code-check`
- [x] Shared package metadata types implemented in backend code
- [x] Shared provider base types implemented in backend code
- [x] Class provider contract defined for `code-check`
- [x] Class provider contract defined for `structure-modeling`
- [x] Shared provider loader skeleton implemented
- [x] Built-in provider loading wired through shared loader
- [x] Executable-provider package layout and import/validate hooks implemented
- [x] `code-check` migrated to built-in + external provider registry
- [x] First scenario-driven class (`structure-modeling`) migrated to the shared provider pipeline
- [x] Regression coverage added for provider merge/order/fallback/exclusion
- [x] No-skill fallback re-verified against the new provider architecture

## Work Package Status
- [x] WP1 Define Shared Package and Provider Base Types
- [x] WP2 Define Provider Contract Per Skill Class
- [x] WP3 Build Shared Provider Loader Pipeline
- [x] WP4 Migrate `code-check` To Class Provider Registry
- [x] WP5 Migrate First Scenario-Driven Skill Class
- [x] WP6 Define Executable Provider Package Shape and Loading Hooks
- [x] WP7 Regression Matrix and Failure Isolation

## Completed This Iteration
- Created Phase 12 planning and status tracking around skill classes rather than one universal handler.
- Confirmed `code-check` as the first migrated class and completed its built-in provider registry plus external merge seam.
- Landed the `CodeCheckRuleProvider` contract and moved design-code resolution onto merged provider ordering.
- Removed standalone design-code ownership from the target analysis-settings flow; selected `code-check` skills now drive code-check execution.
- Added regression coverage for provider ordering, explicit unsupported-standard failure, and merged-provider routing behavior.
- Confirmed `structure-modeling` already has an explicit class contract in backend runtime code, but it is not yet migrated onto the broader Phase 12 built-in/external provider architecture.
- Added a dedicated `structure-modeling` class planning track so the next migration target now has explicit `PLAN.md + STATUS.md` coverage.
- Added initial `structure-modeling` provider metadata and built-in provider registry wiring so runtime selection now flows through a class registry without changing built-in behavior.
- Added shared provider base types so `code-check` and `structure-modeling` no longer define separate copies of the same core provider metadata shape.
- Added shared package metadata normalization for built-in manifests and SkillHub catalog entries, and wired current services onto that package layer.
- Added a shared provider loader skeleton and routed both `code-check` and `structure-modeling` built-in provider loading through it.
- Defined the first executable package layout in SkillHub metadata and added package-entrypoint import/validate hooks plus an initial `structure-modeling` external-provider loading path.
- Re-ran provider-loader regression coverage and the no-skill fallback validation script to confirm the shared provider migration still preserves no-skill isolation.

## Closure Decision
Phase 12 is closed for the current repository scope.

What is considered complete now:
- the shared package, provider, and loader architecture is in place;
- `code-check` and `structure-modeling` both run through the shared provider pipeline;
- executable-provider entrypoint contracts exist and are validated at import time;
- no-skill behavior remains isolated and regression-verified.

What is intentionally deferred:
- wiring executable-provider loading to real installed SkillHub package directories;
- enabling runtime loading from actual external skill packages once those packages exist;
- expanding the executable-provider import path to more classes after the first real external package appears.

## Deferred Follow-Ups
1. Wire the shared executable-provider loader to real installed SkillHub package locations once the first external package exists.
2. Extend `code-check` onto the executable-provider import/validate path after the installed-package layout is finalized.
3. Re-check compatibility, integrity, and enable/disable enforcement inside executable-provider resolution when runtime package loading becomes real.
4. Re-run no-skill and provider-failure isolation checks once installed-package loading is active.

## Open Questions
- Should built-in skills be represented as package manifests on disk, or only normalized at runtime?
- What on-disk layout should installed executable SkillHub packages use?
- Which classes should support external execution first after `code-check`?
- How much of `generic-fallback` should remain a skill class versus a protected core capability?

## Exit Gate
All items below must be true:
- [x] shared package model is defined
- [x] at least one class provider registry is implemented
- [x] runtime can merge built-in and external providers for that class
- [x] no-skill fallback remains covered by tests

Gate status: closed for the current scope; shared provider infrastructure, class migrations, executable-provider hooks, and no-skill regression coverage are complete, while real installed-package loading is explicitly deferred until external SkillHub packages exist.
