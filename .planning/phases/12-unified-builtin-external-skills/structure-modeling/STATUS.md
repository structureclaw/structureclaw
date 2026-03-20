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
- [x] Structure-modeling provider metadata types added in backend code
- [x] Built-in runtime resolution migrated to a structure-modeling provider registry
- [x] External provider loading seam added for structure-modeling
- [x] Built-in and external provider merge ordering implemented for structure-modeling
- [x] Regression coverage added for structure-modeling provider ordering/filter/merge behavior
- [x] No-skill fallback re-verified against the new structure-modeling provider architecture

## Work Package Status
- [x] WP1 Document and Normalize the Existing Class Contract
- [x] WP2 Add Structure-Modeling Provider Metadata and Registry Types
- [x] WP3 Refactor Built-In Runtime Resolution Through a Class Provider Registry
- [x] WP4 Add External Provider Loading Seam
- [x] WP5 Preserve No-Skill Isolation and Unknown-Scenario Fallback
- [x] WP6 Add Regression Coverage

## Current Notes
- `structure-modeling` is already the repository's main scenario-driven skill class and currently powers beam, double-span-beam, frame, portal-frame, and truss flows.
- The class already has a mature runtime contract in code through `SkillManifest` and `SkillHandler`, plus manifest/handler stage files on disk.
- Built-in loading now passes through an explicit structure-modeling provider registry and uses the shared package/provider/loader layer introduced for Phase 12.
- `AgentSkillRegistry` currently applies two important semantics that the migration must preserve: explicit `skillIds` filtering and `autoLoadByDefault` when no `skillIds` are provided.
- `AgentService` still protects no-skill mode by bypassing the structure-modeling runtime entirely and calling `textToModelDraftWithoutSkills()`.
- Existing tests now cover provider ordering, explicit skill filtering, external-provider merge ordering, and a class-specific executable-provider import/validate path for `structure-modeling`.
- The executable-provider path is intentionally left at the hook/interface layer for now; real installed-package directory wiring is deferred until an external structure-modeling package actually exists.

## Closure Decision
`structure-modeling` is closed for the current Phase 12 scope.

What is complete now:
- class-specific provider metadata and registry routing are in place;
- built-in behavior remains covered while provider ordering and filtering now flow through the shared provider pipeline;
- the class has a validated executable-provider import seam for future external packages;
- no-skill remains isolated and regression-verified.

What is deferred:
- loading executable providers from real installed SkillHub package directories;
- runtime enable/disable wiring for actual external structure-modeling packages;
- any product behavior change beyond the current built-in scenario flows.

## Validation Snapshot
- [x] Existing backend tests cover built-in structure-modeling scenarios in `backend/tests/agent.service.test.mjs`
- [x] Existing regression script covers deterministic no-skill behavior in `scripts/validate-agent-no-skill-fallback.sh`
- [x] Dedicated provider-registry validation exists for `structure-modeling`

## Deferred Follow-Ups
1. Resolve executable providers from real installed package locations once the first external structure-modeling package exists.
2. Carry install-state and enable/disable checks into runtime executable-provider resolution for that package layout.
3. Re-run no-skill and provider-failure isolation checks after real installed-package loading is introduced.

## Exit Gate
- [x] class plan exists
- [x] current class contract is documented
- [x] provider metadata exists in backend code
- [x] built-in resolution is routed through a class provider registry
- [x] registry can merge built-in and external providers
- [x] existing built-in behavior remains regression-covered through the migration
- [x] no-skill fallback remains isolated and regression-covered against the new provider architecture

Gate status: closed for the current scope; structure-modeling is migrated onto the shared provider architecture with validated executable-provider hooks, and real installed-package loading is deferred until external packages exist.
