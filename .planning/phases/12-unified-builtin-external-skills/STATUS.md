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
- [ ] Shared package metadata types implemented in backend code
- [ ] Shared provider base types implemented in backend code
- [x] Class provider contract defined for `code-check`
- [x] Class provider contract defined for `structure-modeling`
- [ ] Shared provider loader skeleton implemented
- [ ] Built-in provider loading wired through shared loader
- [ ] External SkillHub executable provider loading implemented
- [x] `code-check` migrated to built-in + external provider registry
- [ ] Scenario-driven classes migrated to shared provider pipeline
- [x] Regression coverage added for provider merge/order/fallback/exclusion
- [ ] No-skill fallback re-verified against new provider architecture

## Work Package Status
- [ ] WP1 Define Shared Package and Provider Base Types
- [ ] WP2 Define Provider Contract Per Skill Class
- [ ] WP3 Build Shared Provider Loader Pipeline
- [x] WP4 Migrate `code-check` To Class Provider Registry
- [ ] WP5 Migrate Scenario-Driven Skill Classes
- [ ] WP6 Upgrade SkillHub To Executable Provider Packages
- [ ] WP7 Regression Matrix and Failure Isolation

## Completed This Iteration
- Created Phase 12 planning and status tracking around skill classes rather than one universal handler.
- Confirmed `code-check` as the first migrated class and completed its built-in provider registry plus external merge seam.
- Landed the `CodeCheckRuleProvider` contract and moved design-code resolution onto merged provider ordering.
- Removed standalone design-code ownership from the target analysis-settings flow; selected `code-check` skills now drive code-check execution.
- Added regression coverage for provider ordering, explicit unsupported-standard failure, and merged-provider routing behavior.
- Confirmed `structure-modeling` already has an explicit class contract in backend runtime code, but it is not yet migrated onto the broader Phase 12 built-in/external provider architecture.

## Next Actions (Priority Order)
1. Create a dedicated `structure-modeling/PLAN.md` and `structure-modeling/STATUS.md` to make the next class migration explicit.
2. Extract truly shared package metadata and provider-base types so `code-check` and `structure-modeling` stop relying on separate class-local representations.
3. Build a shared provider loader skeleton that can host both built-in packages and future SkillHub executable providers.
4. Decide how `structure-modeling` manifests/handlers should map onto the shared Phase 12 provider pipeline without breaking no-skill mode.
5. Re-verify no-skill fallback and failure isolation against the new provider architecture once the shared loader exists.

## Open Questions
- Should built-in skills be represented as package manifests on disk, or only normalized at runtime?
- What on-disk layout should installed executable SkillHub packages use?
- Which classes should support external execution first after `code-check`?
- How much of `generic-fallback` should remain a skill class versus a protected core capability?

## Exit Gate
All items below must be true:
- [ ] shared package model is defined
- [x] at least one class provider registry is implemented
- [x] runtime can merge built-in and external providers for that class
- [ ] no-skill fallback remains covered by tests

Gate status: in progress; `code-check` class migration is complete, while shared provider infrastructure, SkillHub executable loading, and no-skill re-verification remain pending.
