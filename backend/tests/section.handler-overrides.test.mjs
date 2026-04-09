import { describe, expect, test } from '@jest/globals';
import { handler as commonHandler } from '../dist/agent-skills/section/section-common/handler.js';
import { handler as bridgeHandler } from '../dist/agent-skills/section/section-bridge/handler.js';
import { handler as irregularHandler } from '../dist/agent-skills/section/section-irregular/handler.js';

describe('section handler explicit type overrides', () => {
  test('common handler should parse geometry using explicit sectionType profile', () => {
    const draft = commonHandler.parseProvidedValues({
      message: 'use default section',
      sectionType: 'pipe',
    });

    expect(draft.sectionType).toBe('pipe');
    expect(draft.d).toBe(219);
    expect(draft.t).toBe(8);
  });

  test('bridge handler should honor explicit sectionType over inferred message', () => {
    const draft = bridgeHandler.parseProvidedValues({
      message: 'please use box girder',
      sectionType: 't-girder',
    });

    expect(draft.sectionType).toBe('t-girder');
    expect(draft.h).toBe(1600);
    expect(draft.b).toBe(1000);
  });

  test('irregular handler should honor explicit sectionType over inferred message', () => {
    const draft = irregularHandler.parseProvidedValues({
      message: 'this is a tapered box request',
      sectionType: 'section-with-opening',
    });

    expect(draft.sectionType).toBe('section-with-opening');
    expect(draft.openingWidth).toBe(240);
    expect(draft.openingHeight).toBe(240);
  });
});
