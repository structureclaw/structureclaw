import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/double-span-beam/handler.js';

describe('double-span-beam handler', () => {
  test('detects chinese double-span continuous beam requests deterministically', () => {
    const match = handler.detectStructuralType({
      message: '双跨连续梁，总长12m，两跨各6m',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('double-span-beam');
    expect(match?.mappedType).toBe('double-span-beam');
  });

  test('routes multi-span continuous beams away from plain beam handling', () => {
    const match = handler.detectStructuralType({
      message: '三跨连续梁，跨度4m、5m、4m，均布荷载15kN/m，做静力分析',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('double-span-beam');
    expect(match?.mappedType).toBe('double-span-beam');
  });

  test('builds unequal continuous beam spans with distributed and point loads', () => {
    const patch = handler.extractDraft({
      message: '不等跨连续梁，跨度4m和7m，均布荷载10kN/m，在长跨跨中作用集中力30kN，做静力分析',
      llmDraftPatch: { inferredType: 'double-span-beam' },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(state.skillState).toEqual(expect.objectContaining({
      spanLengthsM: [4, 7],
      distributedLoadKNM: 10,
      pointLoadKN: 30,
      pointLoadSpanIndex: 2,
    }));
    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(model.metadata.geometry.spanLengthsM).toEqual([4, 7]);
    expect(model.nodes.map((node) => node.x)).toEqual([0, 4, 7.5, 11]);
    expect(model.load_cases[0].loads).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'distributed', wz: -10 }),
      { node: '3', fz: -30 },
    ]));
  });
});
