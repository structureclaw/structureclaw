import { describe, expect, test } from '@jest/globals';
import { buildCodeCheckInput } from '../../../../dist/agent-skills/code-check/entry.js';

describe('buildCodeCheckInput', () => {
  test('prefers postprocessed artifact context over raw analysis summary', () => {
    const input = buildCodeCheckInput({
      traceId: 'trace-1',
      designCode: 'GB50017',
      model: { elements: [{ id: 'E1' }] },
      analysis: { success: true },
      analysisParameters: {},
      postprocessedResult: {
        utilizationByElement: { E1: 0.92 },
        controllingCases: { E1: 'LC2' },
      },
    });

    expect(input.context.utilizationByElement).toEqual({ E1: 0.92 });
  });

  test('enriches element context with material and section records', () => {
    const input = buildCodeCheckInput({
      traceId: 'trace-2',
      designCode: 'GB50010',
      model: {
        materials: [
          { id: '1', grade: 'C30', category: 'concrete' },
          { id: '2', grade: 'HRB400', category: 'rebar' },
        ],
        sections: [
          { id: '1', name: '400X400', type: 'rectangular', purpose: 'column' },
          { id: '2', name: '250X600', type: 'rectangular', purpose: 'beam' },
        ],
        elements: [
          {
            id: 'C1',
            type: 'column',
            nodes: ['N0_0', 'N1_0'],
            material: '1',
            section: '1',
            concrete_grade: 'C30',
            rebar_grade: 'HRB400',
            story: 'F1',
          },
        ],
      },
      analysis: { success: true },
      analysisParameters: {},
    });

    expect(input.elements).toEqual(['C1']);
    expect(input.context.elementContextById.C1).toMatchObject({
      id: 'C1',
      type: 'column',
      materialId: '1',
      sectionId: '1',
      material: { id: '1', grade: 'C30', category: 'concrete' },
      section: { id: '1', name: '400X400', type: 'rectangular', purpose: 'column' },
      concreteGrade: 'C30',
      rebarGrade: 'HRB400',
      story: 'F1',
    });
  });

  test('preserves pre-resolved material and section objects', () => {
    const material = { id: 'm1', grade: 'C30', category: 'concrete' };
    const section = { id: 's1', name: '500X250', type: 'rectangular' };
    const input = buildCodeCheckInput({
      traceId: 'trace-3',
      designCode: 'GB50010',
      model: {
        elements: [
          {
            id: 'B1',
            type: 'beam',
            material,
            section,
          },
        ],
      },
      analysis: { success: true },
      analysisParameters: {},
    });

    expect(input.context.elementContextById.B1).toMatchObject({
      material,
      section,
    });
  });
});
