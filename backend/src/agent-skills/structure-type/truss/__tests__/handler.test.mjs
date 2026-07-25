import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/truss/handler.js';

const prattTrussPatch = {
  inferredType: 'truss',
  lengthM: 15,
  heightM: 2.5,
  bayCount: 5,
  loadKN: 10,
  loadType: 'point',
  loadPosition: 'top-nodes',
};

describe('truss handler', () => {
  test('detects truss requests deterministically', () => {
    const match = handler.detectStructuralType({
      message: '三角桁架，跨度12m，高3m',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('truss');
    expect(match?.mappedType).toBe('truss');
  });

  test('normalizes truss geometry from an llm draft patch', () => {
    const patch = handler.extractDraft({
      message: '三角桁架，跨度12m，高3m，4个节间，节点荷载20kN，做静力分析',
      llmDraftPatch: {
        inferredType: 'truss',
        lengthM: 12,
        heightM: 3,
        bayCount: 4,
        loadKN: 20,
      },
    });

    expect(patch.lengthM).toBe(12);
    expect(patch.heightM).toBe(3);
    expect(patch.bayCount).toBe(4);
    expect(patch.loadKN).toBe(20);
  });

  test('uses only structured engineeringDraft fields for extraction', () => {
    const patch = handler.extractDraft({
      message: 'A Pratt truss spans 15m, has 2.5m height and 5 panels, with 10kN loads at top chord nodes.',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          geometry: { lengthM: 12, heightM: 3, spanLengthsM: [3, 3, 3, 3] },
          loads: [
            { kind: 'point', magnitude: 20, unit: 'kN', direction: 'gravity', target: 'top-node' },
          ],
        },
      },
    });

    expect(patch.engineeringDraft).toBeDefined();
    expect(patch.lengthM).toBe(12);
    expect(patch.heightM).toBe(3);
    expect(patch.bayCount).toBe(4);
    expect(patch.loadKN).toBe(20);
    expect(patch.skillState).not.toEqual(expect.objectContaining({ trussTopology: 'pratt' }));
  });

  test('merges a follow-up top chord nodal load into an existing truss draft', () => {
    const initialPatch = handler.extractDraft({
      message: '我想设计一个跨度15m，高度3m的桁架，形式你推荐一下？',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          geometry: { lengthM: 15, heightM: 3 },
        },
      },
    });
    const initialState = handler.mergeState(undefined, initialPatch);

    expect(handler.computeMissing(initialState, 'execution').critical).toEqual(['loadKN']);

    const loadPatch = handler.extractDraft({
      message: '每个上弦节点荷载 10 kN',
      currentState: initialState,
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          loads: [
            {
              kind: 'nodal',
              magnitude: 10,
              unit: 'kN',
              direction: 'gravity',
              target: 'top chord nodes',
              location: { nodeRole: 'top' },
            },
          ],
        },
      },
    });
    const state = handler.mergeState(initialState, loadPatch);
    const model = handler.buildModel(state);

    expect(state.lengthM).toBe(15);
    expect(state.heightM).toBe(3);
    expect(state.loadKN).toBe(10);
    expect(state.loadType).toBe('point');
    expect(state.loadPosition).toBe('top-nodes');
    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(model).toBeDefined();
    expect(model.load_cases[0].loads.reduce((sum, load) => sum + Math.abs(load.fz), 0)).toBe(40);
  });

  test('does not infer truss topology when llm omits structured topology', () => {
    const patch = handler.extractDraft({
      message: 'Warren 桁架（首推，简洁经济）',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
        },
      },
    });
    const state = handler.mergeState(undefined, patch);

    expect(state.skillState?.trussTopology).toBeUndefined();
  });

  test('clears previous invalid load field when llm supplies structured nodal load', () => {
    const initialState = handler.mergeState(undefined, handler.extractDraft({
      message: '跨度15m，高度3m的桁架',
      llmDraftPatch: {
        inferredType: 'truss',
        lengthM: 15,
        heightM: 3,
        skillState: {
          invalidDraftFields: ['loadKN'],
        },
      },
    }));

    expect(handler.computeMissing(initialState, 'execution').critical).toContain('loadKN');

    const loadPatch = handler.extractDraft({
      message: '每个上弦节点 10 kN（典型轻钢屋盖）',
      currentState: initialState,
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          loads: [
            {
              kind: 'nodal',
              magnitude: 10,
              unit: 'kN',
              direction: 'gravity',
              target: 'top chord nodes',
              location: { nodeRole: 'top' },
            },
          ],
        },
      },
    });
    const state = handler.mergeState(initialState, loadPatch);

    expect(state.loadKN).toBe(10);
    expect(state.loadType).toBe('point');
    expect(state.loadPosition).toBe('top-nodes');
    expect(state.skillState?.invalidDraftFields).not.toContain('loadKN');
    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(handler.buildModel(state)?.load_cases[0].loads).toHaveLength(4);
  });

  test('builds a panelized planar truss model instead of a single bar', () => {
    const patch = handler.extractDraft({
      message: 'Pratt桁架，跨度15m，高2.5m，5个节间，每个上弦节点竖向荷载10kN，请分析',
      llmDraftPatch: prattTrussPatch,
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(model.nodes).toHaveLength(12);
    expect(model.elements).toHaveLength(21);
    expect(model.nodes.find((node) => node.id === 'B5')).toEqual(expect.objectContaining({ x: 15, z: 0 }));
    expect(model.nodes.find((node) => node.id === 'T0')).toEqual(expect.objectContaining({ z: 2.5 }));
    expect(model.load_cases[0].loads).toHaveLength(4);
    expect(model.load_cases[0].loads.reduce((sum, load) => sum + Math.abs(load.fz), 0)).toBe(40);
  });

  test('replaces revised top-chord loads when equivalent aliases preserve the old draft', () => {
    const initialPatch = handler.extractDraft({
      message: 'Apply 10kN downward at each interior top node.',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          geometry: { lengthM: 15, heightM: 2.5, spanLengthsM: [3, 3, 3, 3, 3] },
          loads: [
            {
              kind: 'nodal',
              magnitude: 10,
              unit: 'kN',
              direction: 'gravity',
              target: 'interior top chord nodes',
              location: { nodeRole: 'top' },
              caseId: 'LC1',
            },
          ],
          analysis: {
            loadCombinations: [{ id: 'ULS', factors: { LC1: 1 } }],
          },
        },
      },
    });
    const initialState = handler.mergeState(undefined, initialPatch);
    const revisedPatch = handler.extractDraft({
      message: 'Change each interior top-node load to 15kN.',
      currentState: initialState,
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          loads: [
            {
              kind: 'nodal',
              magnitude: 10,
              unit: 'kN',
              direction: 'gravity',
              target: 'interior top chord nodes',
              location: { nodeRole: 'top' },
              caseId: 'LC1',
            },
            {
              kind: 'point',
              magnitude: 15,
              unit: 'kN',
              direction: 'gravity',
              target: 'all internal upper chord joints',
              location: { nodeRole: 'top' },
              caseType: 'other',
            },
          ],
          analysis: {
            loadCombinations: [{ id: 'ULS', factors: { LC1: 1 } }],
          },
        },
      },
    });
    const state = handler.mergeState(initialState, revisedPatch);
    const model = handler.buildModel(state);

    expect(state.engineeringDraft.loads).toEqual([
      expect.objectContaining({ magnitude: 15, location: { nodeRole: 'top' } }),
    ]);
    expect(model.load_cases[0].loads).toHaveLength(4);
    expect(model.load_cases[0].loads.every((load) => load.fz === -15)).toBe(true);
  });

  test('preserves explicit truss topology and node-targeted loads', () => {
    const explicitMembers = [
      ['BC0', 'B0', 'B1'],
      ['BC1', 'B1', 'B2'],
      ['TC0', 'T0', 'T1'],
      ['TC1', 'T1', 'T2'],
      ['WV0', 'B0', 'T0'],
      ['WV1', 'B1', 'T1'],
      ['WV2', 'B2', 'T2'],
      ['WD0', 'T0', 'B1'],
      ['WD1', 'T1', 'B2'],
    ];
    const patch = handler.extractDraft({
      message: 'Use the explicitly listed truss nodes, members, supports, and loads.',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          geometry: { lengthM: 6, heightM: 2, spanLengthsM: [3, 3] },
          topology: {
            nodes: [
              { id: 'B0', x: 0, y: 0, z: 0, restraints: [true, false, true, false, false, false] },
              { id: 'B1', x: 3, y: 0, z: 0 },
              { id: 'B2', x: 6, y: 0, z: 0, restraints: [false, false, true, false, false, false] },
              { id: 'T0', x: 0, y: 0, z: 2 },
              { id: 'T1', x: 3, y: 0, z: 2 },
              { id: 'T2', x: 6, y: 0, z: 2 },
            ],
            members: explicitMembers.map(([id, start, end]) => ({ id, nodes: [start, end] })),
          },
          loads: [
            { kind: 'nodal', magnitude: 10, unit: 'kN', direction: 'gravity', target: 'B1' },
            { kind: 'nodal', magnitude: 20, unit: 'kN', direction: 'globalX', target: 'T1' },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(model.nodes).toHaveLength(6);
    expect(model.elements.map((element) => [element.id, ...element.nodes])).toEqual(explicitMembers);
    expect(model.load_cases[0].loads).toEqual([
      expect.objectContaining({ node: 'B1', fz: -10 }),
      expect.objectContaining({ node: 'T1', fx: 20 }),
    ]);
    expect(model.nodes.find((node) => node.id === 'B0')?.restraints).toEqual(
      [true, true, true, false, false, false],
    );
    expect(model.nodes.find((node) => node.id === 'B2')?.restraints).toEqual(
      [false, true, true, false, false, false],
    );
    expect(model.metadata).toEqual(expect.objectContaining({ topologySource: 'engineering-draft' }));
  });

  test('maps semantic interior top-chord loads onto explicit one-based node ids', () => {
    const nodes = [];
    const members = [];
    for (let index = 1; index <= 7; index += 1) {
      const x = (index - 1) * 3;
      nodes.push({
        id: `B${index}`,
        x,
        y: 0,
        z: 0,
        ...(index === 1
          ? { restraints: [true, true, true, false, false, false] }
          : index === 7
            ? { restraints: [false, true, true, false, false, false] }
            : {}),
      });
      nodes.push({ id: `T${index}`, x, y: 0, z: 3 });
      members.push({ id: `V${index}`, nodes: [`B${index}`, `T${index}`] });
      if (index < 7) {
        members.push({ id: `B${index}`, nodes: [`B${index}`, `B${index + 1}`] });
        members.push({ id: `T${index}`, nodes: [`T${index}`, `T${index + 1}`] });
      }
    }
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          geometry: { lengthM: 18, heightM: 3 },
          topology: { nodes, members },
          loads: [{
            kind: 'nodal',
            magnitude: 12,
            unit: 'kN',
            direction: 'gravity',
            target: 'interior top chord nodes',
            location: { nodeRole: 'top' },
          }],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.load_cases[0].loads).toEqual(
      ['T2', 'T3', 'T4', 'T5', 'T6'].map((node) => ({
        node,
        fz: -12,
        reference_frame: 'global',
      })),
    );
  });

  test('maps multiple coordinate-located chord loads one-to-one without expanding each load to the full chord', () => {
    const nodes = [];
    const members = [];
    for (let index = 0; index <= 4; index += 1) {
      const x = index * 2.75;
      nodes.push({
        id: `B${index}`,
        x,
        y: 0,
        z: 0,
        ...(index === 0
          ? { restraints: [true, true, true, false, false, false] }
          : index === 4
            ? { restraints: [false, true, true, false, false, false] }
            : {}),
      });
      nodes.push({ id: `T${index}`, x, y: 0, z: 2.2 });
      members.push({ id: `V${index}`, nodes: [`B${index}`, `T${index}`] });
      if (index < 4) {
        members.push({ id: `B${index}`, nodes: [`B${index}`, `B${index + 1}`] });
        members.push({ id: `T${index}`, nodes: [`T${index}`, `T${index + 1}`] });
      }
    }
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          geometry: { lengthM: 11, heightM: 2.2 },
          topology: { nodes, members },
          loads: [
            {
              kind: 'nodal',
              magnitude: 7,
              unit: 'kN',
              direction: 'gravity',
              target: 'node B1',
              location: { xM: 2.75, nodeRole: 'bottom' },
            },
            {
              kind: 'nodal',
              magnitude: 19,
              unit: 'kN',
              direction: 'gravity',
              target: 'node B3',
              location: { xM: 8.25, nodeRole: 'bottom' },
            },
          ],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.load_cases[0].loads).toEqual([
      { node: 'B1', fz: -7, reference_frame: 'global' },
      { node: 'B3', fz: -19, reference_frame: 'global' },
    ]);
  });

  test('defaults missing truss height from span while preserving model match scale', () => {
    const patch = handler.extractDraft({
      message: 'A triangular roof truss spans 15m with 5 panels and 10kN vertical nodal loads. Run static analysis.',
      llmDraftPatch: {
        inferredType: 'truss',
        lengthM: 15,
        bayCount: 5,
        loadKN: 10,
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);
    const zValues = model.nodes.map((node) => node.z);

    expect(state.heightM).toBeUndefined();
    expect(Math.max(...zValues)).toBe(2.5);
    expect(model.metadata).toEqual(expect.objectContaining({ heightDefaulted: true }));
  });

  test('defaults missing truss panel count for executable standard workflows', () => {
    const patch = handler.extractDraft({
      message: '三角桁架，跨度12m，高3m，节点荷载20kN，做静力分析',
      llmDraftPatch: {
        inferredType: 'truss',
        lengthM: 12,
        heightM: 3,
        loadKN: 20,
      },
    });
    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');
    const model = handler.buildModel(state);

    expect(missing.critical).toEqual([]);
    expect(state.bayCount).toBeUndefined();
    expect(model.metadata).toEqual(expect.objectContaining({
      panelCount: 4,
      panelCountDefaulted: true,
    }));
  });

  test('invalid truss height blocks model generation and asks for correction', () => {
    const patch = handler.extractDraft({
      message: '三角桁架跨度15m，高度0m，5个节间，节点荷载10kN，请分析',
      llmDraftPatch: {
        inferredType: 'truss',
        lengthM: 15,
        heightM: 0,
        bayCount: 5,
        loadKN: 10,
      },
    });
    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(missing.critical).toContain('heightM');
    expect(handler.buildModel(state)).toBeUndefined();
  });

  test('correcting an invalid truss height clears the previous blocking field', () => {
    const invalidPatch = handler.extractDraft({
      message: '三角桁架跨度15m，高度0m，5个节间，节点荷载10kN，请分析',
      llmDraftPatch: {
        inferredType: 'truss',
        lengthM: 15,
        heightM: 0,
        bayCount: 5,
        loadKN: 10,
      },
    });
    const invalidState = handler.mergeState(undefined, invalidPatch);
    const correctedPatch = handler.extractDraft({
      message: '高度改为2.5m',
      llmDraftPatch: { inferredType: 'truss', heightM: 2.5 },
    });
    const correctedState = handler.mergeState(invalidState, correctedPatch);

    expect(handler.computeMissing(correctedState, 'execution').critical).toEqual([]);
    expect(handler.buildModel(correctedState)?.metadata).toEqual(expect.objectContaining({ heightDefaulted: false }));
  });

  test('asks for clarification when llm reports a truss topology conflict', () => {
    const patch = handler.extractDraft({
      message: 'Please analyze a Pratt truss with no web members. It spans 15m, has 2.5m height, 5 panels, and 10kN nodal loads.',
      llmDraftPatch: {
        ...prattTrussPatch,
        skillState: {
          trussTopology: 'pratt',
          trussTopologyConflict: true,
          invalidDraftFields: ['trussTopology'],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(missing.critical).toContain('trussTopology');
    expect(handler.buildModel(state)).toBeUndefined();
  });

  test('does not clear a topology conflict reported only through draftIssues', () => {
    const patch = handler.extractDraft({
      message: 'Please analyze a Pratt truss with no web members.',
      llmDraftPatch: {
        ...prattTrussPatch,
        skillState: {
          trussTopology: 'pratt',
        },
        draftIssues: [{
          field: 'trussTopology',
          severity: 'conflict',
          reason: 'A Pratt truss requires web members.',
          question: 'Should web members be added?',
        }],
      },
    });
    const state = handler.mergeState(undefined, patch);

    expect(state.skillState?.invalidDraftFields).toContain('trussTopology');
    expect(handler.computeMissing(state, 'execution').critical).toContain('trussTopology');
    expect(handler.buildModel(state)).toBeUndefined();
  });

  test('preserves llm-reported truss guardrails', () => {
    const patch = handler.extractDraft({
      message: 'Please analyze a Pratt truss with no web members. It spans 15m, has 2.5m height, 5 panels, and 10kN nodal loads.',
      llmDraftPatch: {
        ...prattTrussPatch,
        skillState: {
          trussTopology: 'pratt',
          trussTopologyConflict: true,
          invalidDraftFields: ['trussTopology'],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);

    expect(state.skillState).toEqual(expect.objectContaining({
      trussTopology: 'pratt',
      trussTopologyConflict: true,
      invalidDraftFields: expect.arrayContaining(['trussTopology']),
    }));
    expect(handler.computeMissing(state, 'execution').critical).toContain('trussTopology');
    expect(handler.buildModel(state)).toBeUndefined();
  });

  test('honors llm-reported ambiguous load clarification', () => {
    const patch = handler.extractDraft({
      message: 'This 15m truss has 5 panels and nodal loads of either 10 tons or 10kN; I am not sure.',
      llmDraftPatch: {
        inferredType: 'truss',
        lengthM: 15,
        heightM: 2.5,
        bayCount: 5,
        skillState: { invalidDraftFields: ['loadKN'] },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(missing.critical).toContain('loadKN');
    expect(handler.buildModel(state)).toBeUndefined();
  });
});
