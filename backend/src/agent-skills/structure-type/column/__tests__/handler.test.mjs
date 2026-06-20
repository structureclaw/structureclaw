import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/column/handler.js';

describe('column handler', () => {
  test('detects standalone concrete column requests', () => {
    const match = handler.detectStructuralType({
      message: '独立混凝土柱，截面400x400mm，高度4.5m，柱顶轴向荷载500kN，做静力分析',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('column');
    expect(match?.mappedType).toBe('column');
  });

  test('extracts column height, section, material, and top axial load', () => {
    const patch = handler.extractDraft({
      message: '独立混凝土柱，截面400x400mm，高度4.5m，柱顶轴向荷载500kN，做静力分析',
      locale: 'zh',
      llmDraftPatch: { inferredType: 'column' },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(state.inferredType).toBe('column');
    expect(state.heightM).toBe(4.5);
    expect(state.loadKN).toBe(500);
    expect(state.skillState).toEqual(expect.objectContaining({
      materialFamily: 'concrete',
      sectionWidthM: 0.4,
      sectionDepthM: 0.4,
    }));
    expect(model.nodes).toHaveLength(2);
    expect(model.elements).toHaveLength(1);
    expect(model.load_cases[0].loads).toEqual([{ node: '2', fz: -500 }]);
  });
});
