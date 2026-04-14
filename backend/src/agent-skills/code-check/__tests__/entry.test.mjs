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
});
