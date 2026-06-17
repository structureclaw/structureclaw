import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/truss/handler.js';

describe('truss handler', () => {
  test('detects truss requests deterministically', () => {
    const match = handler.detectStructuralType({
      message: '三角桁架，跨度12m，高3m',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('truss');
    expect(match?.mappedType).toBe('truss');
  });

  test('fills truss geometry from chinese span wording when llm omits it', () => {
    const patch = handler.extractDraft({
      message: '三角桁架，跨度12m，高3m，4个节间，节点荷载20kN，做静力分析',
      llmDraftPatch: {
        inferredType: 'truss',
        loadKN: 20,
      },
    });

    expect(patch.lengthM).toBe(12);
    expect(patch.heightM).toBe(3);
    expect(patch.bayCount).toBe(4);
    expect(patch.loadKN).toBe(20);
  });

  test('extracts english truss height, panels, and top chord loading', () => {
    const patch = handler.extractDraft({
      message: 'A Pratt truss spans 15m, has 2.5m height and 5 panels, with 10kN loads at top chord nodes.',
      llmDraftPatch: { inferredType: 'truss' },
    });

    expect(patch.lengthM).toBe(15);
    expect(patch.heightM).toBe(2.5);
    expect(patch.bayCount).toBe(5);
    expect(patch.loadKN).toBe(10);
    expect(patch.loadType).toBe('point');
    expect(patch.loadPosition).toBe('top-nodes');
    expect(patch.skillState).toEqual(expect.objectContaining({
      trussTopology: 'pratt',
      trussLoadChord: 'top',
    }));
  });

  test('builds a panelized planar truss model instead of a single bar', () => {
    const patch = handler.extractDraft({
      message: 'Pratt桁架，跨度15m，高2.5m，5个节间，每个上弦节点竖向荷载10kN，请分析',
      llmDraftPatch: { inferredType: 'truss' },
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
      llmDraftPatch: { inferredType: 'truss' },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);
    const zValues = model.nodes.map((node) => node.z);

    expect(state.heightM).toBeUndefined();
    expect(Math.max(...zValues)).toBe(2.5);
    expect(model.metadata).toEqual(expect.objectContaining({ heightDefaulted: true }));
  });

  test('invalid truss height blocks model generation and asks for correction', () => {
    const patch = handler.extractDraft({
      message: '三角桁架跨度15m，高度0m，5个节间，节点荷载10kN，请分析',
      llmDraftPatch: { inferredType: 'truss' },
    });
    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(missing.critical).toContain('heightM');
    expect(handler.buildModel(state)).toBeUndefined();
  });

  test('correcting an invalid truss height clears the previous blocking field', () => {
    const invalidPatch = handler.extractDraft({
      message: '三角桁架跨度15m，高度0m，5个节间，节点荷载10kN，请分析',
      llmDraftPatch: { inferredType: 'truss' },
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

  test('asks for clarification when a truss topology conflicts with missing web members', () => {
    const patch = handler.extractDraft({
      message: 'Please analyze a Pratt truss with no web members. It spans 15m, has 2.5m height, 5 panels, and 10kN nodal loads.',
      llmDraftPatch: { inferredType: 'truss' },
    });
    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(missing.critical).toContain('trussTopology');
    expect(handler.buildModel(state)).toBeUndefined();
  });

  test('keeps rule-derived truss guardrails when llm returns an empty skill state', () => {
    const patch = handler.extractDraft({
      message: 'Please analyze a Pratt truss with no web members. It spans 15m, has 2.5m height, 5 panels, and 10kN nodal loads.',
      llmDraftPatch: {
        inferredType: 'truss',
        skillState: {},
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

  test('treats ambiguous ton or kN load wording as a load clarification', () => {
    const patch = handler.extractDraft({
      message: 'This 15m truss has 5 panels and nodal loads of either 10 tons or 10kN; I am not sure.',
      llmDraftPatch: { inferredType: 'truss' },
    });
    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(missing.critical).toContain('loadKN');
    expect(handler.buildModel(state)).toBeUndefined();
  });
});
