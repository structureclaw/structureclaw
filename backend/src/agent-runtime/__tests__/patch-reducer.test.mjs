import { describe, expect, test } from '@jest/globals';
import { applyPatches } from '../../../dist/agent-runtime/patch-reducer.js';

describe('patch reducer', () => {
  const baseModel = { elements: [{ id: 'E1', section: 'W200' }], revision: 1 };

  test('applies enricher patches in priority order', () => {
    const patches = [
      { patchId: 'p2', patchKind: 'modelPatch', producerSkillId: 'material', baseModelRevision: 1, status: 'accepted', priority: 20, payload: { elements: [{ id: 'E1', material: 'Q235' }] }, reason: 'set material', conflicts: [], basedOn: [], createdAt: 100 },
      { patchId: 'p1', patchKind: 'modelPatch', producerSkillId: 'section', baseModelRevision: 1, status: 'accepted', priority: 10, payload: { elements: [{ id: 'E1', section: 'W250' }] }, reason: 'resize section', conflicts: [], basedOn: [], createdAt: 99 },
    ];
    const result = applyPatches(baseModel, patches);
    expect(result.model.elements[0].section).toBe('W250');
    expect(result.model.elements[0].material).toBe('Q235');
    expect(result.revision).toBe(2);
  });

  test('rejects patches with wrong baseModelRevision', () => {
    const patches = [
      { patchId: 'p1', patchKind: 'modelPatch', producerSkillId: 'section', baseModelRevision: 99, status: 'accepted', priority: 10, payload: {}, reason: 'stale', conflicts: [], basedOn: [], createdAt: 100 },
    ];
    const result = applyPatches(baseModel, patches);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].patchId).toBe('p1');
    expect(result.rejected[0].reason).toMatch(/baseModelRevision/);
  });

  test('conflicts detected when two patches write the same path', () => {
    const patches = [
      { patchId: 'p1', patchKind: 'modelPatch', producerSkillId: 'section', baseModelRevision: 1, status: 'accepted', priority: 10, payload: { elements: [{ id: 'E1', section: 'W250' }] }, reason: 'resize', conflicts: [], basedOn: [], createdAt: 100 },
      { patchId: 'p2', patchKind: 'modelPatch', producerSkillId: 'section-alt', baseModelRevision: 1, status: 'accepted', priority: 10, payload: { elements: [{ id: 'E1', section: 'W300' }] }, reason: 'resize alt', conflicts: [], basedOn: [], createdAt: 101 },
    ];
    const result = applyPatches(baseModel, patches);
    expect(result.conflicted).toHaveLength(1);
    expect(result.conflicted[0].patchId).toBe('p2');
  });

  test('skips non-accepted patches', () => {
    const patches = [
      { patchId: 'p1', patchKind: 'designPatch', producerSkillId: 'design', baseModelRevision: 1, status: 'proposed', priority: 10, payload: {}, reason: 'pending', conflicts: [], basedOn: [], createdAt: 100 },
    ];
    const result = applyPatches(baseModel, patches);
    expect(result.revision).toBe(1);
    expect(result.skipped).toHaveLength(1);
  });

  test('replace strategy overwrites entire key without conflict tracking', () => {
    const patches = [
      { patchId: 'p1', patchKind: 'modelPatch', producerSkillId: 'section', baseModelRevision: 1, status: 'accepted', priority: 10, payload: { elements: [{ id: 'E1', section: 'W200' }] }, mergeStrategy: { elements: 'replace' }, reason: 'replace elements', conflicts: [], basedOn: [], createdAt: 100 },
    ];
    const result = applyPatches({ elements: [{ id: 'E1', section: 'W100' }], revision: 1 }, patches);
    expect(result.model.elements).toEqual([{ id: 'E1', section: 'W200' }]);
    expect(result.conflicted).toHaveLength(0);
  });

  test('append strategy concatenates arrays', () => {
    const patches = [
      { patchId: 'p1', patchKind: 'modelPatch', producerSkillId: 'load', baseModelRevision: 1, status: 'accepted', priority: 10, payload: { loads: [{ id: 'L2', value: 10 }] }, mergeStrategy: { loads: 'append' }, reason: 'add load', conflicts: [], basedOn: [], createdAt: 100 },
    ];
    const result = applyPatches({ loads: [{ id: 'L1', value: 5 }], revision: 1 }, patches);
    expect(result.model.loads).toEqual([{ id: 'L1', value: 5 }, { id: 'L2', value: 10 }]);
  });
});
