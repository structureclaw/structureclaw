import { describe, expect, test } from '@jest/globals';
import { resolveSkillDependencies, loadSkillProviders } from '../dist/skill-shared/loader.js';

function makeProvider(id, priority = 50) {
  return { id, domain: 'demo', source: 'builtin', priority };
}

function makePackage(id, { requires = [], conflicts = [] } = {}) {
  return [id, {
    id,
    domain: 'demo',
    version: '1.0.0',
    source: 'builtin',
    capabilities: [],
    compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
    entrypoints: {},
    enabledByDefault: true,
    requires,
    conflicts,
  }];
}

describe('resolveSkillDependencies', () => {
  test('should accept all providers when no requires or conflicts are declared', () => {
    const providers = [makeProvider('a'), makeProvider('b')];
    const packages = new Map([makePackage('a'), makePackage('b')]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.rejected).toEqual([]);
  });

  test('should accept a provider whose requires are all satisfied', () => {
    const providers = [makeProvider('a'), makeProvider('b')];
    const packages = new Map([
      makePackage('a', { requires: ['b'] }),
      makePackage('b'),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.rejected).toEqual([]);
  });

  test('should reject a provider with unmet requires', () => {
    const providers = [makeProvider('a')];
    const packages = new Map([
      makePackage('a', { requires: ['missing-dep'] }),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      providerId: 'a',
      reason: 'unmet_requires',
    });
    expect(result.rejected[0].detail).toContain('missing-dep');
  });

  test('should reject a provider that conflicts with a loaded provider', () => {
    const providers = [makeProvider('a'), makeProvider('b')];
    const packages = new Map([
      makePackage('a', { conflicts: ['b'] }),
      makePackage('b'),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['b']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      providerId: 'a',
      reason: 'conflict_detected',
    });
    expect(result.rejected[0].detail).toContain('b');
  });

  test('should accept providers not found in the packages map', () => {
    const providers = [makeProvider('a'), makeProvider('unknown')];
    const packages = new Map([makePackage('a')]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a', 'unknown']);
    expect(result.rejected).toEqual([]);
  });

  test('should handle empty providers list', () => {
    const packages = new Map([makePackage('a')]);
    const result = resolveSkillDependencies([], packages);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  test('should handle empty packages map', () => {
    const providers = [makeProvider('a'), makeProvider('b')];
    const result = resolveSkillDependencies(providers, new Map());

    expect(result.accepted.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.rejected).toEqual([]);
  });

  test('should reject a provider with multiple unmet requires', () => {
    const providers = [makeProvider('a')];
    const packages = new Map([
      makePackage('a', { requires: ['dep-x', 'dep-y'] }),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].detail).toContain('dep-x');
    expect(result.rejected[0].detail).toContain('dep-y');
  });

  test('should reject only the conflicting provider and keep the other', () => {
    const providers = [makeProvider('x', 90), makeProvider('y', 80)];
    const packages = new Map([
      makePackage('x', { conflicts: ['y'] }),
      makePackage('y'),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['y']);
    expect(result.rejected.map((r) => r.providerId)).toEqual(['x']);
  });

  test('should handle packages with undefined requires and conflicts gracefully', () => {
    const providers = [makeProvider('a')];
    const packages = new Map([[
      'a', {
        id: 'a',
        domain: 'demo',
        version: '1.0.0',
        source: 'builtin',
        capabilities: [],
        compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
        entrypoints: {},
        enabledByDefault: true,
      },
    ]]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a']);
    expect(result.rejected).toEqual([]);
  });

  test('should propagate rejections: if B is rejected, A requiring B is also rejected', () => {
    const providers = [makeProvider('a'), makeProvider('b'), makeProvider('c')];
    const packages = new Map([
      makePackage('a', { requires: ['b'] }),
      makePackage('b', { conflicts: ['c'] }),
      makePackage('c'),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['c']);
    expect(result.rejected.map((r) => r.providerId).sort()).toEqual(['a', 'b']);
  });

  test('should not self-conflict when provider id appears in its own conflicts list', () => {
    const providers = [makeProvider('a')];
    const packages = new Map([
      makePackage('a', { conflicts: ['a'] }),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a']);
    expect(result.rejected).toEqual([]);
  });
});

describe('loadSkillProviders with dependency resolution', () => {
  test('should skip dependency resolution when packages option is not provided', () => {
    const providers = loadSkillProviders({
      builtInProviders: [makeProvider('a'), makeProvider('b')],
    });

    expect(providers.map((p) => p.id)).toEqual(['a', 'b']);
  });

  test('should reject providers with unmet requires when packages map is provided', () => {
    const providers = loadSkillProviders({
      builtInProviders: [makeProvider('a', 90), makeProvider('b', 80)],
      packages: new Map([
        makePackage('a', { requires: ['missing'] }),
        makePackage('b'),
      ]),
    });

    expect(providers.map((p) => p.id)).toEqual(['b']);
  });

  test('should reject conflicting providers when packages map is provided', () => {
    const providers = loadSkillProviders({
      builtInProviders: [makeProvider('x', 90), makeProvider('y', 80)],
      packages: new Map([
        makePackage('x', { conflicts: ['y'] }),
        makePackage('y'),
      ]),
    });

    expect(providers.map((p) => p.id)).toEqual(['y']);
  });

  test('should apply finalize after dependency resolution', () => {
    const providers = loadSkillProviders({
      builtInProviders: [
        { ...makeProvider('a', 90), fallback: false },
        { ...makeProvider('b', 80), fallback: true },
        { ...makeProvider('c', 70), fallback: false },
      ],
      packages: new Map([
        makePackage('a'),
        makePackage('b'),
        makePackage('c'),
      ]),
      finalize: (sorted) => {
        const primary = sorted.filter((p) => !p.fallback);
        const fallback = sorted.filter((p) => p.fallback);
        return [...primary, ...fallback];
      },
    });

    expect(providers.map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });
});
