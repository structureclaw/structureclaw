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

  test('builds column model from engineeringDraft loads and section data', () => {
    const patch = handler.extractDraft({
      message: '',
      locale: 'zh',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'column',
          geometry: { heightM: 4.2 },
          material: { family: 'concrete' },
          sections: { column: '450x450mm' },
          loads: [
            { kind: 'nodal', magnitude: 600, unit: 'kN', direction: 'gravity', target: 'top-node' },
            { kind: 'nodal', magnitude: 30, unit: 'kN', direction: 'globalX', target: 'top-node' },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(state.inferredType).toBe('column');
    expect(state.heightM).toBe(4.2);
    expect(state.loadKN).toBe(600);
    expect(state.skillState).toEqual(expect.objectContaining({
      materialFamily: 'concrete',
      sectionWidthM: 0.45,
      sectionDepthM: 0.45,
    }));
    expect(model.nodes).toHaveLength(2);
    expect(model.elements).toHaveLength(1);
    expect(model.load_cases[0].loads).toEqual([
      { node: '2', fz: -600 },
      { node: '2', fx: 30 },
    ]);
  });
});
