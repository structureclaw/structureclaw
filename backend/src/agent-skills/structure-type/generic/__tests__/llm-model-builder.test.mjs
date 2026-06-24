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
    expect(prompt).toContain('global-z-up coordinates');
    expect(prompt).toContain('Create explicit nodes at supports');
    expect(prompt).toContain('check the total applied load');
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

  test('repairs likely 2D y-up coordinates without moving valid z loads', async () => {
    const fakeLlm = {
      async invoke() {
        return {
          content: JSON.stringify({
            schema_version: '2.0.0',
            unit_system: 'SI',
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0, restraints: [true, true, false, false, false, true] },
              { id: 'N2', x: 6, y: 0, z: 0 },
              { id: 'N3', x: 0, y: 4 },
              { id: 'N4', x: 6, y: 4, z: 0 },
            ],
            elements: [
              { id: 'E1', type: 'beam', nodes: ['N1', 'N3'], material: 'M1', section: 'S1' },
              { id: 'E2', type: 'beam', nodes: ['N2', 'N4'], material: 'M1', section: 'S1' },
              { id: 'E3', type: 'beam', nodes: ['N3', 'N4'], material: 'M1', section: 'S1' },
            ],
            load_cases: [
              {
                id: 'LC1',
                type: 'other',
                loads: [
                  { type: 'nodal', node: 'N4', fx: 50, fy: 0, fz: 0 },
                  { type: 'distributed', element: 'E3', wy: -8, wz: 0 },
                  { type: 'nodal', node: 'N3', fy: 0, fz: -10 },
                  { type: 'nodal', node: 'N4', mz: 5, my: 0 },
                ],
              },
            ],
          }),
        };
      },
    };

    const model = await tryBuildGenericModelWithLlm(
      fakeLlm,
      'Single-bay lateral frame, span 6m, height 4m, lateral 50kN.',
      { inferredType: 'generic', updatedAt: 0 },
      'en',
    );

    expect(model.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'N1', x: 0, y: 0, z: 0, restraints: [true, false, true, false, true, false] }),
      expect.objectContaining({ id: 'N3', x: 0, y: 0, z: 4 }),
      expect.objectContaining({ id: 'N4', x: 6, y: 0, z: 4 }),
    ]));
    expect(model.load_cases[0].loads[0]).toMatchObject({ fx: 50, fy: 0, fz: 0 });
    expect(model.load_cases[0].loads[1]).toMatchObject({ wy: 0, wz: -8 });
    expect(model.load_cases[0].loads[2]).toMatchObject({ fy: 0, fz: -10 });
    expect(model.load_cases[0].loads[3]).toMatchObject({ mz: 0, my: 5 });
    expect(model.metadata).toMatchObject({
      coordinateSemantics: 'global-z-up',
      coordinateRepair: 'swapped-y-z-for-2d-vertical-model',
    });
  });
});
