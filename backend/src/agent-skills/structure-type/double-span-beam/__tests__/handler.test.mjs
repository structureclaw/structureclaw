import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/double-span-beam/handler.js';

describe('double-span-beam handler', () => {
  test('detects chinese double-span continuous beam requests deterministically', () => {
    const match = handler.detectStructuralType({
      message: '双跨连续梁，总长12m，两跨各6m',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('double-span-beam');
    expect(match?.mappedType).toBe('double-span-beam');
  });
});
