import { describe, expect, test } from '@jest/globals';
import { containsAny, parsePointList } from '../dist/agent-skills/section/shared.js';

describe('section shared utils', () => {
  test('parsePointList should keep zero and negative coordinates', () => {
    const points = parsePointList([
      [-10, 0],
      { x: 5, y: -3 },
      { X: 0, Y: 7 },
    ]);

    expect(points).toEqual([
      { x: -10, y: 0 },
      { x: 5, y: -3 },
      { x: 0, y: 7 },
    ]);
  });

  test('containsAny should be case and punctuation tolerant after normalization', () => {
    expect(containsAny('Beam，Column Profile', ['column'])).toBe(true);
    expect(containsAny('桥梁 截面', ['桥梁'])).toBe(true);
  });
});
