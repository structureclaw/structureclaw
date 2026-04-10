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

  test('fills length from chinese span wording when llm omits it', () => {
    const patch = handler.extractDraft({
      message: '三角桁架，跨度12m，高3m，节点荷载20kN，做静力分析',
      llmDraftPatch: {
        inferredType: 'truss',
        loadKN: 20,
      },
    });

    expect(patch.lengthM).toBe(12);
    expect(patch.loadKN).toBe(20);
  });
});
