# Current Milestone

## Milestone 1: Skill Taxonomy and Runtime Refactor

This milestone defines the current highest-priority execution target for StructureClaw. Its goal is to make the skill system the primary architectural backbone for the engineering workflow, while keeping public contracts stable and avoiding broad parallel refactors that would dilute focus.

## Objective

Deliver a clearer built-in skill architecture that can support the end-to-end workflow of design, calculation, code-check, report export, and visualization, while preserving the existing fallback path and current API behavior.

## In Scope

- Reorganize the skill taxonomy under `backend/src/agent-skills` so the current categories map more directly to the engineering workflow and future expansion path.
- Complete the migration of agent-facing structural analysis logic into `backend/src/agent-skills`, especially OpenSeesPy-oriented execution and related transformation layers.
- Define and document the boundary between built-in skills and external SkillHub packages.
- Tighten the skill runtime contract for registration, loading, capability discovery, execution, and fallback behavior.
- Advance the v1 structural calculation JSON baseline enough to support skill-oriented orchestration and future engine adapters.
- Preserve existing behavior for `POST /api/v1/agent/run`, `POST /api/v1/chat/*`, `POST /validate`, `POST /convert`, `POST /analyze`, and `POST /code-check`.

## Out of Scope for This Milestone

- A full one-shot migration of all multi-platform entrypoints into `sclaw`.
- A full documentation rewrite across README, handbook, reference, and wiki.
- Exhaustive expansion of all future skill domains such as CAD, Revit, BIM, drawing APIs, and the full standards matrix.

These items may continue in small supporting increments, but they should not take priority over the skill refactor.

## Deliverables

- A revised built-in skill taxonomy with clearer domain ownership.
- A defined backend-hosted execution path for agent-invoked OpenSeesPy and related structural analysis capabilities.
- Stable runtime expectations for built-in skills and external SkillHub packages.
- A documented v1 structural calculation JSON direction aligned with the skill architecture.
- Regression confidence for orchestration, fallback, analyze/code-check/report flows, and structure validation.

## Acceptance Criteria

- The repository has a clear answer to which responsibilities belong in backend API/services versus `backend/src/agent-skills`.
- The built-in skill categories reflect the intended workflow rather than a loose collection of utilities.
- No-skill fallback still works when selected skills are absent, unmatched, or partially migrated.
- Existing key contracts and regression scripts still pass or remain explicitly accounted for during the refactor.
- New or updated user-visible outputs produced during this milestone remain bilingual.

## Supporting Work

- Continue unifying `sclaw` gradually only where it directly helps validate or operate the skill refactor.
- Continue targeted test additions that increase confidence in the migration.
- Defer broad document rewrites until the refactor shape is stable enough to avoid repeated churn.
