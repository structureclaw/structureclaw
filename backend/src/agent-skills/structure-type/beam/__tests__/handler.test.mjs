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
});
