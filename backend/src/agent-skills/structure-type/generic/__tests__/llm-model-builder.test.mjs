import { describe, expect, test } from '@jest/globals';
import { buildGenericModelPrompt } from '../../../../../dist/agent-skills/structure-type/generic/llm-model-prompt.js';
import { tryBuildGenericModelWithLlm } from '../../../../../dist/agent-skills/structure-type/generic/llm-model-builder.js';

describe('generic LLM model builder', () => {
  test('prompts for StructureModel V2 and kN-based loads', () => {
    const prompt = buildGenericModelPrompt(
      'Build a 12m beam with 20kN/m uniform load',
      { inferredType: 'beam', updatedAt: 0 },
      'en',
    );

    expect(prompt).toContain('StructureModel V2');
    expect(prompt).toContain('"schema_version":"2.0.0"');
    expect(prompt).toContain('point forces are kN');
    expect(prompt).toContain('distributed member loads are kN/m');
    expect(prompt).not.toContain('StructureModel v1');
    expect(prompt).not.toContain('-10000');
  });

  test('canonicalizes legacy schema and explicit newton load units from LLM output', async () => {
    const fakeLlm = {
      async invoke() {
        return {
          content: JSON.stringify({
            schema_version: '1.0.0',
            unit_system: 'SI',
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0 },
              { id: 'N2', x: 12, y: 0, z: 0 },
            ],
            elements: [
              { id: 'E1', type: 'beam', nodes: ['N1', 'N2'], material: 'M1', section: 'S1' },
            ],
            load_cases: [
              {
                id: 'LC1',
                type: 'other',
                loads: [
                  { type: 'nodal_force', node: 'N2', fz: -230000, unit: 'N' },
                  { type: 'nodal_force', node: 'N2', fz: -230, unit: 'N' },
                  { type: 'line_load', element: 'E1', wz: -20000, forceUnit: 'npermeter', units: 'N/m' },
                  { type: 'nodal_force', node: 'N1', fz: '   ', unit: 'N' },
                ],
              },
            ],
          }),
        };
      },
    };

    const model = await tryBuildGenericModelWithLlm(
      fakeLlm,
      'Build a 12m beam with a 230kN point load',
      { inferredType: 'beam', updatedAt: 0 },
      'en',
    );

    expect(model.schema_version).toBe('2.0.0');
    expect(model.unit_system).toBe('SI');
    expect(model.load_cases[0].loads[0]).toMatchObject({
      type: 'nodal',
      node: 'N2',
      fz: -230,
      unit: 'kN',
    });
    expect(model.load_cases[0].loads[1]).toMatchObject({
      type: 'nodal',
      node: 'N2',
      fz: -230,
      unit: 'kN',
    });
    expect(model.load_cases[0].loads[2]).toMatchObject({
      type: 'distributed',
      element: 'E1',
      wz: -20,
      unit: 'kN/m',
    });
    expect(model.load_cases[0].loads[2].forceUnit).toBeUndefined();
    expect(model.load_cases[0].loads[2].units).toBeUndefined();
    expect(model.load_cases[0].loads[3]).toMatchObject({
      type: 'nodal',
      node: 'N1',
      fz: '   ',
      unit: 'kN',
    });
  });
});
