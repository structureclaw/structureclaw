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

  test('builds unequal continuous beam spans with structured distributed and point loads', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'double-span-beam',
          geometry: { spanLengthsM: [4, 7] },
          loads: [
            { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', target: 'beam' },
            { kind: 'point', magnitude: 30, unit: 'kN', direction: 'gravity', target: 'beam', location: { spanIndex: 2 } },
          ],
        },
      },
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
