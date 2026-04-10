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

  test('preserves cantilever support when the message explicitly says cantilever', () => {
    const patch = handler.extractDraft({
      message: '悬臂梁，长4米，端部集中力10kN',
      llmDraftPatch: {
        inferredType: 'beam',
        lengthM: 4,
        loadKN: 10,
        loadType: 'point',
      },
    });

    expect(patch.supportType).toBe('cantilever');
  });
});
