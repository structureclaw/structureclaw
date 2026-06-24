import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/generic/handler.js';

describe('generic structure-type handler', () => {
  test('normalizes generic beam aliases from LLM extraction output', () => {
    const patch = handler.extractDraft({
      message: '这条用户消息不参与参数抽取',
      locale: 'zh',
      llmDraftPatch: {
        componentType: 'beam',
        supportCondition: 'simply supported',
        span: 10,
        pointLoads: [
          {
            force: 1,
            position: 5,
          },
        ],
      },
      structuralTypeMatch: {
        key: 'unknown',
        mappedType: 'unknown',
        skillId: 'generic',
        supportLevel: 'fallback',
      },
    });

    expect(patch).toEqual(expect.objectContaining({
      inferredType: 'beam',
      lengthM: 10,
      supportType: 'simply-supported',
      loadKN: 1,
      loadType: 'point',
      loadPosition: 'midspan',
      loadPositionM: 5,
    }));
    expect(patch.skillState?.genericDraft).toEqual(expect.objectContaining({
      componentType: 'beam',
    }));
  });

  test('merges normalized aliases into a generic draft without requiring clarification', () => {
    const patch = handler.extractDraft({
      message: '这条用户消息不参与参数抽取',
      locale: 'zh',
      llmDraftPatch: {
        componentType: 'beam',
        supportCondition: 'simply supported',
        span: 10,
        pointLoads: [{ value: 1, position: 5 }],
      },
      structuralTypeMatch: {
        key: 'unknown',
        mappedType: 'unknown',
        skillId: 'generic',
        supportLevel: 'fallback',
      },
    });

    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(state).toEqual(expect.objectContaining({
      inferredType: 'beam',
      skillId: 'generic',
      structuralTypeKey: 'beam',
      lengthM: 10,
      loadKN: 1,
    }));
    expect(missing.critical).toEqual([]);
  });

  test('uses LLM engineeringDraft structure type while staying on generic skill', () => {
    const patch = handler.extractDraft({
      message: '这条用户消息不参与参数抽取',
      locale: 'en',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'truss',
          geometry: {
            lengthM: '18',
            heightM: '3',
            spanLengthsM: ['3', '3', '3', '3', '3', '3'],
          },
          loads: [
            {
              kind: 'nodal',
              magnitude: '12',
              unit: 'kN',
              direction: 'gravity',
              target: 'top-chord-node',
              location: { xM: '3' },
            },
          ],
          analysis: { type: 'static' },
        },
      },
      structuralTypeMatch: {
        key: 'unknown',
        mappedType: 'unknown',
        skillId: 'generic',
        supportLevel: 'fallback',
      },
    });

    const state = handler.mergeState(undefined, patch);
    const missing = handler.computeMissing(state, 'execution');

    expect(patch).toEqual(expect.objectContaining({
      inferredType: 'truss',
      lengthM: 18,
      heightM: 3,
      bayCount: 6,
      loadKN: 12,
    }));
    expect(state).toEqual(expect.objectContaining({
      inferredType: 'truss',
      skillId: 'generic',
      structuralTypeKey: 'truss',
    }));
    expect(state.engineeringDraft?.structureType).toBe('truss');
    expect(state.skillState?.genericDraft).toEqual(expect.objectContaining({
      engineeringDraft: expect.objectContaining({ structureType: 'truss' }),
    }));
    expect(missing.critical).toEqual([]);
  });

  test('maps LLM steel-frame engineeringDraft to generic frame family', () => {
    const patch = handler.extractDraft({
      message: '这条用户消息不参与参数抽取',
      locale: 'zh',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'steel-frame',
          geometry: {
            storyHeightsM: [3.3, 3.3],
            bayWidthsM: [6],
          },
          loads: [
            {
              kind: 'line',
              magnitude: 15,
              unit: 'kN/m',
              direction: 'gravity',
              target: 'floor',
            },
          ],
        },
      },
      structuralTypeMatch: {
        key: 'unknown',
        mappedType: 'unknown',
        skillId: 'generic',
        supportLevel: 'fallback',
      },
    });

    const state = handler.mergeState(undefined, patch);

    expect(state).toEqual(expect.objectContaining({
      inferredType: 'frame',
      skillId: 'generic',
      structuralTypeKey: 'frame',
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 1,
    }));
    expect(state.engineeringDraft?.structureType).toBe('steel-frame');
    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
  });

  test('maps explicit generic engineeringDraft aliases without scanning user text', () => {
    const portalPatch = handler.extractDraft({
      message: 'unused',
      locale: 'en',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'portal',
          geometry: {
            spanLengthsM: [18],
            heightM: 6,
          },
          loads: [{ kind: 'line', magnitude: 8, unit: 'kN/m', direction: 'gravity' }],
        },
      },
      structuralTypeMatch: {
        key: 'unknown',
        mappedType: 'unknown',
        skillId: 'generic',
        supportLevel: 'fallback',
      },
    });
    const girderPatch = handler.extractDraft({
      message: 'unused',
      locale: 'en',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'girder',
          geometry: { lengthM: 12 },
          loads: [{ kind: 'line', magnitude: 5, unit: 'kN/m', direction: 'gravity' }],
        },
      },
      structuralTypeMatch: {
        key: 'unknown',
        mappedType: 'unknown',
        skillId: 'generic',
        supportLevel: 'fallback',
      },
    });

    expect(portalPatch).toEqual(expect.objectContaining({
      inferredType: 'portal-frame',
      spanLengthM: 18,
      heightM: 6,
      loadKN: 8,
    }));
    expect(girderPatch).toEqual(expect.objectContaining({
      inferredType: 'beam',
      lengthM: 12,
      loadKN: 5,
    }));
  });

  test('does not infer draft parameters from the raw message', () => {
    const patch = handler.extractDraft({
      message: '简支梁，跨度10m，梁中间荷载1kN',
      locale: 'zh',
      llmDraftPatch: {
        inferredType: 'unknown',
        span: 10,
        pointLoads: [{ value: 1, position: 5 }],
      },
      structuralTypeMatch: {
        key: 'unknown',
        mappedType: 'unknown',
        skillId: 'generic',
        supportLevel: 'fallback',
      },
    });

    expect(patch).toEqual(expect.objectContaining({
      lengthM: 10,
      loadKN: 1,
      loadType: 'point',
      loadPosition: 'midspan',
    }));
    expect(patch.inferredType).toBeUndefined();
  });
});
