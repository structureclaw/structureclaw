# Phase 12 Status Ledger

Updated: 2026-03-19
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
- [ ] Class provider contract defined for `code-check`
- [ ] Class provider contract defined for `structure-modeling`
- [ ] Shared provider loader skeleton implemented
- [ ] Built-in provider loading wired through shared loader
- [ ] External SkillHub executable provider loading implemented
- [ ] `code-check` migrated to built-in + external provider registry
- [ ] Scenario-driven classes migrated to shared provider pipeline
- [ ] Regression coverage added for provider merge/order/fallback/exclusion
- [ ] No-skill fallback re-verified against new provider architecture

## Work Package Status
- [ ] WP1 Define Shared Package and Provider Base Types
- [ ] WP2 Define Provider Contract Per Skill Class
- [ ] WP3 Build Shared Provider Loader Pipeline
- [ ] WP4 Migrate `code-check` To Class Provider Registry
- [ ] WP5 Migrate Scenario-Driven Skill Classes
- [ ] WP6 Upgrade SkillHub To Executable Provider Packages
- [ ] WP7 Regression Matrix and Failure Isolation

## Completed This Iteration
- Created Phase 12 planning track for unified built-in and external agent skills.
- Reframed the architecture around skill classes rather than one universal handler.
- Recorded the repository-aligned principle: class-to-class differences are acceptable; within each class, providers must be pluggable through one contract.
- Defined the first migration target as `code-check` because it is the clearest ordered rule class and the lowest-risk place to prove built-in + external merging.
- Switched this phase to `PLAN.md + STATUS.md` tracking mode for easier monitoring.

## Next Actions (Priority Order)
1. Define normalized package metadata types shared by built-in and SkillHub skills.
2. Write class-level provider interfaces starting with `code-check` and `structure-modeling`.
3. Build the shared provider loader skeleton with built-in loading only.
4. Migrate `code-check` onto the new class provider registry.
5. Add regression tests for ordering, fallback, provider merge, and provider exclusion.

## Open Questions
- Should built-in skills be represented as package manifests on disk, or only normalized at runtime?
- What on-disk layout should installed executable SkillHub packages use?
- Which classes should support external execution first after `code-check`?
- How much of `generic-fallback` should remain a skill class versus a protected core capability?

## Exit Gate
All items below must be true:
- [ ] shared package model is defined
- [ ] at least one class provider registry is implemented
- [ ] runtime can merge built-in and external providers for that class
- [ ] no-skill fallback remains covered by tests

Gate status: not started.
