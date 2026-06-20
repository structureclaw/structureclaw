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

  test('uses engineeringDraft without natural parser overrides', () => {
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
