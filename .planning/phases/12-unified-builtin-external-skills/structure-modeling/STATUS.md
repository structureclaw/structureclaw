# Phase 12 Class Status: Structure Modeling

Updated: 2026-03-20
Owner: backend-agent

## Checklist
- [x] `structure-modeling` selected as the next Phase 12 class migration
- [x] Class-level plan created
- [x] Current built-in runtime behavior documented
- [x] Class target defined: built-in + external provider registry with no-skill isolation
- [x] Existing class contract identified in backend code through `SkillManifest` + `SkillHandler`
- [x] Built-in manifests/handlers already load through the current runtime loader
- [x] Selected-skill filtering and auto-load semantics identified as migration constraints
- [x] No-skill bypass boundary documented
- [ ] Structure-modeling provider metadata types added in backend code
- [ ] Built-in runtime resolution migrated to a structure-modeling provider registry
- [ ] External provider loading seam added for structure-modeling
- [ ] Built-in and external provider merge ordering implemented for structure-modeling
- [ ] Regression coverage added for structure-modeling provider merge/filter/failure behavior
- [ ] No-skill fallback re-verified against the new structure-modeling provider architecture

## Work Package Status
- [x] WP1 Document and Normalize the Existing Class Contract
- [ ] WP2 Add Structure-Modeling Provider Metadata and Registry Types
- [ ] WP3 Refactor Built-In Runtime Resolution Through a Class Provider Registry
- [ ] WP4 Add External Provider Loading Seam
- [ ] WP5 Preserve No-Skill Isolation and Unknown-Scenario Fallback
- [ ] WP6 Add Regression Coverage

## Current Notes
- `structure-modeling` is already the repository's main scenario-driven skill class and currently powers beam, double-span-beam, frame, portal-frame, and truss flows.
- The class already has a mature runtime contract in code through `SkillManifest` and `SkillHandler`, plus manifest/handler stage files on disk.
- Built-in loading today is real and deterministic, but it is still a built-in runtime plugin system rather than a Phase 12 class provider registry shared with future external providers.
- `AgentSkillRegistry` currently applies two important semantics that the migration must preserve: explicit `skillIds` filtering and `autoLoadByDefault` when no `skillIds` are provided.
- `AgentService` still protects no-skill mode by bypassing the structure-modeling runtime entirely and calling `textToModelDraftWithoutSkills()`.
- Existing tests cover many built-in structure-modeling behaviors, but they do not yet cover built-in/external provider merge behavior for this class.

## Validation Snapshot
- [x] Existing backend tests cover built-in structure-modeling scenarios in `backend/tests/agent.service.test.mjs`
- [x] Existing regression script covers deterministic no-skill behavior in `scripts/validate-agent-no-skill-fallback.sh`
- [ ] Dedicated provider-registry validation exists for `structure-modeling`

## Exit Gate
- [x] class plan exists
- [x] current class contract is documented
- [ ] provider metadata exists in backend code
- [ ] built-in resolution is routed through a class provider registry
- [ ] registry can merge built-in and external providers
- [ ] existing built-in behavior remains regression-covered through the migration
- [ ] no-skill fallback remains isolated and regression-covered against the new provider architecture

Gate status: planning complete; implementation not started beyond documenting the current built-in runtime contract and migration constraints.
