import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/beam/handler.js';

describe('beam handler', () => {
  test('detects beam requests deterministically', () => {
    const match = handler.detectStructuralType({
      message: '一根简支梁，跨度6米',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('beam');
    expect(match?.mappedType).toBe('beam');
  });

  test('builds combined beam loads from engineeringDraft', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { lengthM: 12 },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'line', magnitude: 15, unit: 'kN/m', direction: 'gravity', target: 'beam' },
            { kind: 'point', magnitude: 50, unit: 'kN', direction: 'gravity', target: 'beam', location: { xM: 4 } },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(state.lengthM).toBe(12);
    expect(state.skillState.extractionSource).toBe('engineering-draft');
    expect(model.nodes.map((node) => node.x)).toEqual([0, 4, 12]);
    expect(model.elements).toHaveLength(2);
    expect(model.load_cases[0].loads).toEqual(expect.arrayContaining([
      { type: 'distributed', element: '1', wz: -15, wy: 0 },
      { type: 'distributed', element: '2', wz: -15, wy: 0 },
      { node: '2', fz: -50 },
    ]));
  });

  test('keeps ordinary beam defaults deterministic', () => {
    const [question] = handler.buildQuestions(
      ['loadType'],
      ['loadType'],
      { inferredType: 'beam', updatedAt: 0 },
      'zh',
    );

    expect(question.suggestedValue).toBe('distributed');
    expect(question.question).toContain('均布荷载');
  });

  test('does not auto-fill supportType for ordinary beams — left to question proposals', () => {
    const patch = handler.extractDraft({
      message: '一根梁，长6米，20kN均布荷载',
      llmDraftPatch: {
        inferredType: 'beam',
        lengthM: 6,
        loadKN: 20,
        loadType: 'distributed',
      },
    });

    expect(patch.supportType).toBeUndefined();
    expect(patch.loadPosition).toBe('full-span');
  });

  test('preserves cantilever support from structured boundary data', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { lengthM: 4 },
          boundary: { supportType: 'cantilever' },
          loads: [{ kind: 'point', magnitude: 10, unit: 'kN', direction: 'gravity', target: 'end' }],
        },
      },
    });

    expect(patch.supportType).toBe('cantilever');
  });
});
