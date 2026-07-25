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
      { type: 'distributed', element: '1', wz: -15, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '2', wz: -15, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '3', wz: -15, wy: 0, reference_frame: 'global' },
      { node: '2', fz: -50, reference_frame: 'global' },
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

  test('blocks execution when the LLM identifies an ambiguous beam load type', () => {
    const patch = handler.extractDraft({
      message: 'Check a pinned-roller beam with a 7.4m span and an unspecified 31.5 load.',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { lengthM: 6 },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { magnitude: 20, direction: 'gravity' },
          ],
        },
        draftIssues: [{
          field: 'loadType',
          value: 20,
          severity: 'ambiguous',
          reason: 'The load unit/type is missing.',
          question: 'Is the load a 20 kN point load or a 20 kN/m distributed load?',
        }],
      },
    });
    const state = handler.mergeState(undefined, patch);

    expect(state.skillState?.invalidDraftFields).toContain('loadType');
    expect(handler.computeMissing(state, 'execution').critical).toContain('loadType');
    expect(handler.buildModel(state)).toBeUndefined();
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
    expect(model.nodes[0].restraints).toEqual([true, true, true, false, false, false]);
    expect(model.nodes[1].restraints).toBeUndefined();
    expect(model.nodes[2].restraints).toEqual([false, true, true, false, false, false]);
    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -20, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '2', wz: -20, wy: 0, reference_frame: 'global' },
    ]);
  });

  test('keeps loads on explicitly targeted analysis segments of one physical span', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { lengthM: 6 },
          topology: {
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0 },
              { id: 'N2', x: 3, y: 0, z: 0 },
              { id: 'N3', x: 6, y: 0, z: 0 },
            ],
            members: [
              { id: 'E1', nodes: ['N1', 'N2'] },
              { id: 'E2', nodes: ['N2', 'N3'] },
            ],
          },
          boundary: { supportType: 'simply-supported', supportPositionsM: [0, 6] },
          loads: [
            {
              kind: 'line',
              magnitude: 20,
              unit: 'kN/m',
              direction: 'gravity',
              target: 'E1',
              location: { spanIndex: 1 },
            },
            {
              kind: 'line',
              magnitude: 20,
              unit: 'kN/m',
              direction: 'gravity',
              target: 'E2',
              location: { spanIndex: 2 },
            },
          ],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -20, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '2', wz: -20, wy: 0, reference_frame: 'global' },
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
    expect(model.nodes[0].restraints).toEqual([true, true, true, false, false, false]);
    expect(model.nodes[2].restraints).toEqual([false, true, true, false, false, false]);
    expect(model.nodes[3].restraints).toBeUndefined();
    expect(model.elements).toHaveLength(3);
    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -15, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '2', wz: -15, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '3', wz: -15, wy: 0, reference_frame: 'global' },
    ]);
  });

  test('honors LLM-provided support coordinates for a right-overhang beam', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [5, 1.5] },
          boundary: {
            supportType: 'simply-supported',
            supportPositionsM: [0, 5],
          },
          loads: [
            { kind: 'line', magnitude: 15, unit: 'kN/m', direction: 'gravity', target: 'beam' },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(model.nodes.map((node) => node.x)).toEqual([0, 3.25, 5, 6.5]);
    expect(model.nodes[0].restraints).toEqual([true, true, true, false, false, false]);
    expect(model.nodes[2].restraints).toEqual([false, true, true, false, false, false]);
    expect(model.nodes[3].restraints).toBeUndefined();
  });

  test('applies member-targeted distributed loads only to the requested segment', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [3, 3] },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'line', magnitude: 20, unit: 'kN/m', direction: 'gravity', target: 'beam', location: { spanIndex: 1 } },
            { kind: 'line', magnitude: 20, unit: 'kN/m', direction: 'gravity', target: 'beam', location: { spanIndex: 2 } },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(state.engineeringDraft.loads.map((load) => load.location.spanIndex)).toEqual([1, 2]);
    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -20, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '2', wz: -20, wy: 0, reference_frame: 'global' },
    ]);
  });

  test('does not duplicate distributed loads already targeted to explicit topology members', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { lengthM: 8 },
          topology: {
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0 },
              { id: 'N2', x: 4, y: 0, z: 0 },
              { id: 'N3', x: 8, y: 0, z: 0 },
            ],
            members: [
              { id: 'M1', nodes: ['N1', 'N2'] },
              { id: 'M2', nodes: ['N2', 'N3'] },
            ],
          },
          boundary: { supportType: 'simply-supported', supportPositionsM: [0, 8] },
          loads: [
            { kind: 'distributed', magnitude: 15, unit: 'kN/m', direction: 'gravity', target: 'M1' },
            { kind: 'distributed', magnitude: 15, unit: 'kN/m', direction: 'gravity', target: 'M2' },
          ],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -15, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '2', wz: -15, wy: 0, reference_frame: 'global' },
    ]);
  });

  test('uses one-based span indices for a load on only the second span', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [3, 4] },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'line', magnitude: 12, unit: 'kN/m', direction: 'gravity', target: 'beam', location: { spanIndex: 2 } },
          ],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '2', wz: -12, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '3', wz: -12, wy: 0, reference_frame: 'global' },
    ]);
  });

  test('applies a physical-span line load across analysis subdivisions in that span', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [6] },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'line', magnitude: 20, unit: 'kN/m', direction: 'gravity', target: 'beam', location: { spanIndex: 1 } },
            { kind: 'point', magnitude: 30, unit: 'kN', direction: 'gravity', target: 'beam', location: { xM: 3 } },
          ],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.nodes.map((node) => node.x)).toEqual([0, 3, 6]);
    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -20, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '2', wz: -20, wy: 0, reference_frame: 'global' },
      { node: '2', fz: -30, reference_frame: 'global' },
    ]);
  });

  test('prefers an explicit physical span over a reused analysis-member target', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { lengthM: 12, spanLengthsM: [12] },
          topology: {
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0 },
              { id: 'N2', x: 4, y: 0, z: 0 },
              { id: 'N3', x: 6, y: 0, z: 0 },
              { id: 'N4', x: 12, y: 0, z: 0 },
            ],
            members: [
              { id: 'M1', nodes: ['N1', 'N2'] },
              { id: 'M2', nodes: ['N2', 'N3'] },
              { id: 'M3', nodes: ['N3', 'N4'] },
            ],
          },
          boundary: { supportType: 'simply-supported', supportPositionsM: [0, 12] },
          loads: [
            {
              kind: 'line',
              magnitude: 15,
              unit: 'kN/m',
              direction: 'gravity',
              target: 'M1',
              location: { spanIndex: 1 },
            },
            {
              kind: 'point',
              magnitude: 50,
              unit: 'kN',
              direction: 'gravity',
              target: 'N2',
              location: { xM: 4, spanIndex: 1 },
            },
          ],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.nodes.map((node) => node.x)).toEqual([0, 4, 6, 12]);
    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -15, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '2', wz: -15, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '3', wz: -15, wy: 0, reference_frame: 'global' },
      { node: '2', fz: -50, reference_frame: 'global' },
    ]);
  });

  test('does not duplicate an unchanged full-span load during a multi-turn point-load update', () => {
    const initialPatch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { lengthM: 6 },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'distributed', magnitude: 20, unit: 'kN/m', direction: 'gravity', target: 'beam', location: { spanIndex: 1 } },
          ],
        },
      },
    });
    const initialState = handler.mergeState(undefined, initialPatch);
    const updatePatch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          loads: [
            { kind: 'distributed', magnitude: 20, unit: 'kN/m', direction: 'gravity', target: 'beam' },
            { kind: 'point', magnitude: 30, unit: 'kN', direction: 'gravity', target: 'beam', location: { xM: 3, nodeRole: 'midspan' } },
          ],
        },
      },
    });
    const updatedState = handler.mergeState(initialState, updatePatch);
    const model = handler.buildModel(updatedState);

    expect(updatedState.engineeringDraft.loads).toHaveLength(2);
    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: '1', wz: -20, wy: 0, reference_frame: 'global' },
      { type: 'distributed', element: '2', wz: -20, wy: 0, reference_frame: 'global' },
      { node: '2', fz: -30, reference_frame: 'global' },
    ]);
  });

  test('resolves a point-load node target through explicit beam topology', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [3, 3] },
          topology: {
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0 },
              { id: 'N2', x: 3, y: 0, z: 0 },
              { id: 'N3', x: 6, y: 0, z: 0 },
            ],
          },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'point', magnitude: 30, unit: 'kN', direction: 'gravity', target: 'N2' },
          ],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.load_cases[0].loads).toEqual([
      { node: '2', fz: -30, reference_frame: 'global' },
    ]);
  });

  test('blocks contradictory point-load node and coordinate evidence', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [4, 2, 6] },
          topology: {
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0 },
              { id: 'N2', x: 4, y: 0, z: 0 },
              { id: 'N3', x: 6, y: 0, z: 0 },
              { id: 'N4', x: 12, y: 0, z: 0 },
            ],
          },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'point', magnitude: 50, unit: 'kN', direction: 'gravity', target: 'N2', location: { xM: 6 } },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);

    expect(state.draftIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'loadPosition', severity: 'conflict' }),
    ]));
    expect(handler.computeMissing(state, 'execution').critical).toContain('loadPosition');
    expect(handler.buildModel(state)).toBeUndefined();
  });

  test('replaces a contradictory semantic point load when the next turn confirms its target', () => {
    const initialPatch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [4, 2, 6] },
          topology: {
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0 },
              { id: 'N2', x: 4, y: 0, z: 0 },
              { id: 'N3', x: 6, y: 0, z: 0 },
              { id: 'N4', x: 12, y: 0, z: 0 },
            ],
          },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'point', magnitude: 50, unit: 'kN', direction: 'gravity', target: 'N2', location: { xM: 6 } },
          ],
        },
      },
    });
    const conflictedState = handler.mergeState(undefined, initialPatch);
    const correctionPatch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          loads: [
            { kind: 'point', magnitude: 50, unit: 'kN', direction: 'gravity', target: 'N2' },
          ],
        },
      },
    });
    const correctedState = handler.mergeState(conflictedState, correctionPatch);
    const model = handler.buildModel(correctedState);

    expect(correctedState.engineeringDraft.loads).toHaveLength(1);
    expect(correctedState.engineeringDraft.loads[0].location).toBeUndefined();
    expect(correctedState.loadPositionM).toBe(4);
    expect(correctedState.skillState.invalidDraftFields).toBeUndefined();
    expect(correctedState.draftIssues).toBeUndefined();
    expect(handler.computeMissing(correctedState, 'execution').critical).not.toContain('loadPosition');
    expect(model.load_cases[0].loads).toEqual([
      { node: '2', fz: -50, reference_frame: 'global' },
    ]);
  });

  test('applies an explicit legacy coordinate correction to the semantic point load', () => {
    const initialPatch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [4, 2, 6] },
          topology: {
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0 },
              { id: 'N2', x: 4, y: 0, z: 0 },
              { id: 'N3', x: 6, y: 0, z: 0 },
              { id: 'N4', x: 12, y: 0, z: 0 },
            ],
          },
          boundary: { supportType: 'simply-supported' },
          loads: [
            { kind: 'point', magnitude: 50, unit: 'kN', direction: 'gravity', target: 'N2', location: { xM: 6 } },
          ],
        },
      },
    });
    const conflictedState = handler.mergeState(undefined, initialPatch);
    const correctedState = handler.mergeState(conflictedState, { loadPositionM: 4 });
    const model = handler.buildModel(correctedState);

    expect(correctedState.engineeringDraft.loads).toEqual([
      expect.objectContaining({ target: 'N2', location: { xM: 4 } }),
    ]);
    expect(correctedState.skillState.invalidDraftFields).toBeUndefined();
    expect(correctedState.draftIssues).toBeUndefined();
    expect(model.load_cases[0].loads).toEqual([
      { node: '2', fz: -50, reference_frame: 'global' },
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
