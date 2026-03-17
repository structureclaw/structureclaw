# Phase 08 Migration Checklist

## Readiness Gates
- [x] Domain taxonomy confirmed (10 categories)
- [x] Existing skill inventory mapped to domains
- [x] No-skill fallback path contract defined
- [x] Baseline/core skill pack scope confirmed (in-repo only)
- [x] Skill repository extension scope confirmed (out-of-repo on-demand)
- [x] External SkillHub mode confirmed (repository independent from this GitHub repo)

## P08-1
- [x] Add `domain` metadata to all current skill manifests
- [x] Add `requires/conflicts/priority/capabilities` metadata fields
- [x] Update capability matrix output to include domain summaries
- [x] Expose domain-grouped payload for frontend skill picker (no hardcoded map)
- [x] Unify metadata contract for bundled skills and SkillHub packages
- [x] Add compatibility contract fields: `minCoreVersion`, `skillApiVersion`
- [x] Add incompatibility reason codes and fallback behavior contract

## P08-2
- [x] Add contract test: empty skillIds in chat mode
- [x] Add contract test: empty skillIds in execute/auto mode
- [x] Verify deterministic clarification or successful execution
- [x] Baseline skill pack documented and runnable without repository connectivity
- [x] Repository-down fallback verified (baseline compute still available)

## P08-3
- [x] Report/export domain hooks completed
- [ ] Visualization domain hooks completed
- [x] Frontend remains backward compatible
- [x] Frontend supports domain-category selection + skill-level mixed selection when loading skills
- [x] Add frontend interaction tests for group select / clear / mixed select
- [x] P08-3a completed: installed-skill catalog loading flow is stable
- [x] Frontend can browse/filter extension skills from skill repository by domain
- [x] Frontend can load/unload repository skills and show loaded state
- [x] Add repository loading lifecycle tests (fetch/list/load/unload)
- [x] Provide CLI workflow: search/install/enable/disable/uninstall
- [x] Add CLI integration tests for external SkillHub
- [x] P08-3b completed: external SkillHub integration flow is stable
- [x] Security test: bad signature is rejected
- [x] Security test: checksum mismatch is rejected
- [x] Security test: offline cache reuse works for installed skills

## P08-4
- [x] Geometry extraction separated into geometry domain layer
- [x] Load/boundary extraction separated into load-boundary domain layer
- [x] Structure-type handlers consume domain outputs

## P08-5
- [x] Material/constitutive skill interface implemented
- [x] Analysis strategy skill interface implemented
- [x] Capability matrix includes analysis strategy compatibility

## P08-6
- [x] Code-check orchestration migrated to code-check domain
- [x] Postprocess metrics/envelope/governing cases migrated
- [x] Output schema compatibility preserved

## Done Definition
- [ ] All phase validations pass
- [x] make backend-regression passes
- [ ] Plan and docs synced
- [ ] Baseline mode works when skill repository is unavailable
- [ ] External SkillHub path works without storing extension skills in this GitHub repo
- [ ] Incompatible extension skills auto-disable and do not block baseline execution
