import { describe, expect, test } from '@jest/globals';
import { tryBuildGenericModelWithLlm } from '../dist/agent-skills/structure-type/generic/llm-model-builder.js';

describe('tryBuildGenericModelWithLlm', () => {
  test('stamps canonical coordinate metadata onto metadata-free generic models', async () => {
    const llm = {
      invoke: async () => ({
        content: JSON.stringify({
          schema_version: '1.0.0',
          unit_system: 'SI',
          nodes: [
            { id: 'N1', x: 0, y: 0, z: 0 },
            { id: 'N2', x: 10, y: 0, z: 0 },
          ],
          elements: [
            { id: 'E1', type: 'beam', nodes: ['N1', 'N2'] },
          ],
          materials: [],
          sections: [],
          load_cases: [{ id: 'LC1', loads: [] }],
          load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
        }),
      }),
    };

    const model = await tryBuildGenericModelWithLlm(
      llm,
      '设计一个简支梁，跨度10m，梁中间荷载1kN',
      {
        inferredType: 'beam',
        skillId: 'generic',
        structuralTypeKey: 'beam',
        updatedAt: Date.now(),
      },
      'zh',
    );

    expect(model).toBeDefined();
    expect(model.metadata.coordinateSemantics).toBe('global-z-up');
    expect(model.metadata.frameDimension).toBe('2d');
    expect(model.metadata.inferredType).toBe('beam');
  });
});
