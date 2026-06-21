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
    expect(model.nodes.map((node) => node.x)).toEqual([0, 4, 6, 12]);
    expect(model.elements).toHaveLength(3);
    expect(model.load_cases[0].loads).toEqual(expect.arrayContaining([
      { type: 'distributed', element: '1', wz: -15, wy: 0 },
      { type: 'distributed', element: '2', wz: -15, wy: 0 },
      { type: 'distributed', element: '3', wz: -15, wy: 0 },
      { node: '2', fz: -50 },
    ]));
  });

  test('preserves semantic draft issues for clarification', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { lengthM: 6 },
        },
        draftIssues: [{
          field: 'loadKN',
          severity: 'ambiguous',
          reason: 'Load unit is ambiguous.',
        }],
        skillState: { invalidDraftFields: ['loadKN'] },
      },
    });

    expect(patch.draftIssues).toEqual([{
      field: 'loadKN',
      severity: 'ambiguous',
      reason: 'Load unit is ambiguous.',
    }]);
    expect(patch.skillState?.invalidDraftFields).toContain('loadKN');
  });

  test('adds a midspan result node for semantic distributed beam loads', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { lengthM: 6 },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'line', magnitude: 20, unit: 'kN/m', direction: 'gravity', target: 'beam' },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(model.nodes.map((node) => node.x)).toEqual([0, 3, 6]);
    expect(model.elements).toHaveLength(2);
    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, false]);
    expect(model.nodes[1].restraints).toBeUndefined();
    expect(model.nodes[2].restraints).toEqual([false, true, true, true, true, false]);
    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -20, wy: 0 },
      { type: 'distributed', element: '2', wz: -20, wy: 0 },
    ]);
  });

  test('places explicit intermediate supports for semantic overhanging beams', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [5, 1.5] },
          boundary: { supportType: 'simply-supported', supportPositionsM: [0, 5] },
          loads: [
            { kind: 'line', magnitude: 15, unit: 'kN/m', direction: 'gravity', target: 'beam' },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(state.lengthM).toBe(6.5);
    expect(model.nodes.map((node) => node.x)).toEqual([0, 3.25, 5, 6.5]);
    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, false]);
    expect(model.nodes[2].restraints).toEqual([false, true, true, true, true, false]);
    expect(model.nodes[3].restraints).toBeUndefined();
    expect(model.elements).toHaveLength(3);
    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -15, wy: 0 },
      { type: 'distributed', element: '2', wz: -15, wy: 0 },
      { type: 'distributed', element: '3', wz: -15, wy: 0 },
    ]);
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
