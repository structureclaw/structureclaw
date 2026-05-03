import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/generic/handler.js';

describe('generic structure-type handler', () => {
  test('normalizes generic beam aliases from LLM extraction output', () => {
    const patch = handler.extractDraft({
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
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
      message: '设计一个简支梁，跨度10m，梁中间荷载1kN',
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

  test('does not let explicit unknown block inference from the message', () => {
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
      inferredType: 'beam',
      lengthM: 10,
      loadKN: 1,
      loadType: 'point',
      loadPosition: 'midspan',
    }));
  });
});
