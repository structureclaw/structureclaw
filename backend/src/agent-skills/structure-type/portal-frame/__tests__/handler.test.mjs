import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/portal-frame/handler.js';

describe('portal-frame handler', () => {
  test('detects portal-frame requests deterministically', () => {
    const match = handler.detectStructuralType({
      message: '门式刚架，跨度18m，高度6m',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('portal-frame');
    expect(match?.mappedType).toBe('portal-frame');
  });

  test('keeps portal-frame load-position guidance deterministic', () => {
    const [question] = handler.buildQuestions(
      ['loadPosition'],
      ['loadPosition'],
      { inferredType: 'portal-frame', updatedAt: 0 },
      'zh',
    );

    expect(question.suggestedValue).toBe('full-span');
    expect(question.question).toContain('full-span');
  });
});
