import { describe, expect, test } from '@jest/globals';

/**
 * json.ts only re-exports TypeScript types from @prisma/client/runtime/library.
 * The compiled JS is `export {}` — there is no runtime logic to test.
 * We verify the module loads cleanly and exports nothing at runtime.
 */

describe('json utils (type-only module)', () => {
  test('should import the module without error', async () => {
    const mod = await import('../dist/utils/json.js');
    // The module only re-exports TS types; at runtime it exports nothing.
    expect(Object.keys(mod)).toEqual([]);
  });

  test('should have no runtime exports', async () => {
    const mod = await import('../dist/utils/json.js');
    expect(mod).toBeDefined();
    expect(typeof mod).toBe('object');
    // No function or value exports expected
    const values = Object.values(mod);
    expect(values).toHaveLength(0);
  });
});
