# Phase 08 Migration Checklist

## Readiness Gates
- [ ] Domain taxonomy confirmed (10 categories)
- [ ] Existing skill inventory mapped to domains
- [ ] No-skill fallback path contract defined

## P08-1
- [ ] Add `domain` metadata to all current skill manifests
- [ ] Add `requires/conflicts/priority/capabilities` metadata fields
- [ ] Update capability matrix output to include domain summaries

## P08-2
- [ ] Add contract test: empty skillIds in chat mode
- [ ] Add contract test: empty skillIds in execute/auto mode
- [ ] Verify deterministic clarification or successful execution

## P08-3
- [ ] Report/export domain hooks completed
- [ ] Visualization domain hooks completed
- [ ] Frontend remains backward compatible

## P08-4
- [ ] Geometry extraction separated into geometry domain layer
- [ ] Load/boundary extraction separated into load-boundary domain layer
- [ ] Structure-type handlers consume domain outputs

## P08-5
- [ ] Material/constitutive skill interface implemented
- [ ] Analysis strategy skill interface implemented
- [ ] Capability matrix includes analysis strategy compatibility

## P08-6
- [ ] Code-check orchestration migrated to code-check domain
- [ ] Postprocess metrics/envelope/governing cases migrated
- [ ] Output schema compatibility preserved

## Done Definition
- [ ] All phase validations pass
- [ ] make backend-regression passes
- [ ] Plan and docs synced
