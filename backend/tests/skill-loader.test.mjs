import { describe, it, expect } from '@jest/globals';
import {
  parseVersion,
  isVersionGreater,
  evaluateSkillCompatibility,
  compareSkillProviders,
  loadSkillProviders,
  resolveSkillDependencies,
  loadExecutableSkillProviders,
  summarizeSkillLoadResult,
} from '../dist/skill-shared/loader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(id, priority = 50, source = 'builtin') {
  return { id, domain: 'demo', source, priority };
}

function makePackage(id, { requires = [], conflicts = [] } = {}) {
  return [
    id,
    {
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
    },
  ];
}

function makePkg(id, overrides = {}) {
  return {
    id,
    domain: 'code-check',
    version: '1.0.0',
    source: 'skillhub',
    capabilities: [],
    compatibility: { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
    entrypoints: {},
    enabledByDefault: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. parseVersion
// ---------------------------------------------------------------------------

describe('parseVersion', () => {
  it('should parse a standard three-part semver', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  it('should parse a two-part version', () => {
    expect(parseVersion('2.5')).toEqual([2, 5]);
  });

  it('should parse a single-part (major-only) version', () => {
    expect(parseVersion('3')).toEqual([3]);
  });

  it('should strip a lowercase "v" prefix', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
  });

  it('should strip an uppercase "V" prefix', () => {
    expect(parseVersion('V4.0.0')).toEqual([4, 0, 0]);
  });

  it('should trim leading and trailing whitespace', () => {
    expect(parseVersion('  1.0.0  ')).toEqual([1, 0, 0]);
  });

  it('should trim whitespace around a v-prefixed version', () => {
    expect(parseVersion('  v2.1.0 ')).toEqual([2, 1, 0]);
  });

  it('should return an empty array for an empty string', () => {
    expect(parseVersion('')).toEqual([]);
  });

  it('should filter out non-numeric segments', () => {
    expect(parseVersion('1.beta.3')).toEqual([1, 3]);
  });

  it('should filter out NaN segments produced by non-numeric strings', () => {
    expect(parseVersion('a.b.c')).toEqual([]);
  });

  it('should handle a version with trailing dot', () => {
    expect(parseVersion('1.2.')).toEqual([1, 2]);
  });

  it('should handle a version with leading dot', () => {
    expect(parseVersion('.1.2')).toEqual([1, 2]);
  });

  it('should handle zero-padded segments', () => {
    expect(parseVersion('01.02.03')).toEqual([1, 2, 3]);
  });

  it('should handle large version numbers', () => {
    expect(parseVersion('100.200.300')).toEqual([100, 200, 300]);
  });

  it('should filter out Infinity and NaN from parsed parts', () => {
    // "Infinity" is parsed by parseInt as NaN
    expect(parseVersion('1.Infinity.3')).toEqual([1, 3]);
  });

  it('should parse a four-part version', () => {
    expect(parseVersion('1.2.3.4')).toEqual([1, 2, 3, 4]);
  });

  it('should handle a numeric string without dots', () => {
    expect(parseVersion('42')).toEqual([42]);
  });

  it('should handle version "0.0.0"', () => {
    expect(parseVersion('0.0.0')).toEqual([0, 0, 0]);
  });

  it('should handle version with mixed valid and empty segments', () => {
    expect(parseVersion('1..3')).toEqual([1, 3]);
  });
});

// ---------------------------------------------------------------------------
// 2. isVersionGreater
// ---------------------------------------------------------------------------

describe('isVersionGreater', () => {
  it('should return true when required major is greater', () => {
    expect(isVersionGreater('2.0.0', '1.0.0')).toBe(true);
  });

  it('should return false when required major is less', () => {
    expect(isVersionGreater('1.0.0', '2.0.0')).toBe(false);
  });

  it('should return false when versions are equal', () => {
    expect(isVersionGreater('1.0.0', '1.0.0')).toBe(false);
  });

  it('should compare minor version when major is equal', () => {
    expect(isVersionGreater('1.2.0', '1.1.0')).toBe(true);
    expect(isVersionGreater('1.1.0', '1.2.0')).toBe(false);
  });

  it('should compare patch version when major and minor are equal', () => {
    expect(isVersionGreater('1.0.2', '1.0.1')).toBe(true);
    expect(isVersionGreater('1.0.1', '1.0.2')).toBe(false);
  });

  it('should treat missing segments as zero', () => {
    expect(isVersionGreater('1.0.1', '1.0')).toBe(true);
    expect(isVersionGreater('1.0', '1.0.1')).toBe(false);
    expect(isVersionGreater('1.0.0', '1')).toBe(false);
    expect(isVersionGreater('1', '1.0.0')).toBe(false);
  });

  it('should handle single-part versions', () => {
    expect(isVersionGreater('2', '1')).toBe(true);
    expect(isVersionGreater('1', '2')).toBe(false);
    expect(isVersionGreater('1', '1')).toBe(false);
  });

  it('should handle empty string versions (both empty means equal)', () => {
    expect(isVersionGreater('', '')).toBe(false);
  });

  it('should treat empty required as not greater than a real version', () => {
    expect(isVersionGreater('', '1.0.0')).toBe(false);
  });

  it('should treat a real required as greater than empty current', () => {
    expect(isVersionGreater('1.0.0', '')).toBe(true);
  });

  it('should handle v-prefixed versions', () => {
    expect(isVersionGreater('v2.0.0', 'v1.0.0')).toBe(true);
    expect(isVersionGreater('v1.0.0', 'v1.0.0')).toBe(false);
  });

  it('should handle mixed v-prefix usage', () => {
    expect(isVersionGreater('v2.0.0', '1.0.0')).toBe(true);
    expect(isVersionGreater('2.0.0', 'v1.0.0')).toBe(true);
  });

  it('should compare four-part versions correctly', () => {
    expect(isVersionGreater('1.0.0.1', '1.0.0.0')).toBe(true);
    expect(isVersionGreater('1.0.0.0', '1.0.0.1')).toBe(false);
  });

  it('should return false when all parsed parts are identical regardless of length', () => {
    expect(isVersionGreater('1.0', '1.0.0')).toBe(false);
    expect(isVersionGreater('1.0.0', '1.0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. compareSkillProviders
// ---------------------------------------------------------------------------

describe('compareSkillProviders', () => {
  it('should return negative when left has lower priority with desc order', () => {
    const left = makeProvider('a', 10);
    const right = makeProvider('b', 90);
    // desc order: higher priority comes first, so right (90) beats left (10)
    expect(compareSkillProviders(left, right, 'desc')).toBeGreaterThan(0);
  });

  it('should return positive when left has higher priority with desc order', () => {
    const left = makeProvider('a', 90);
    const right = makeProvider('b', 10);
    expect(compareSkillProviders(left, right, 'desc')).toBeLessThan(0);
  });

  it('should return negative when left has lower priority with asc order', () => {
    const left = makeProvider('a', 10);
    const right = makeProvider('b', 90);
    // asc order: lower priority comes first
    expect(compareSkillProviders(left, right, 'asc')).toBeLessThan(0);
  });

  it('should return positive when left has higher priority with asc order', () => {
    const left = makeProvider('a', 90);
    const right = makeProvider('b', 10);
    expect(compareSkillProviders(left, right, 'asc')).toBeGreaterThan(0);
  });

  it('should prefer builtin over skillhub when priorities are equal', () => {
    const builtin = makeProvider('a', 50, 'builtin');
    const skillhub = makeProvider('b', 50, 'skillhub');
    expect(compareSkillProviders(builtin, skillhub)).toBeLessThan(0);
    expect(compareSkillProviders(skillhub, builtin)).toBeGreaterThan(0);
  });

  it('should fall back to alphabetical id comparison when priority and source match', () => {
    const alpha = makeProvider('alpha', 50, 'builtin');
    const beta = makeProvider('beta', 50, 'builtin');
    expect(compareSkillProviders(alpha, beta)).toBeLessThan(0);
    expect(compareSkillProviders(beta, alpha)).toBeGreaterThan(0);
  });

  it('should return 0 when providers are identical in priority, source, and id', () => {
    const a = makeProvider('same-id', 50, 'builtin');
    const b = makeProvider('same-id', 50, 'builtin');
    expect(compareSkillProviders(a, b)).toBe(0);
  });

  it('should default to desc priority order when priorityOrder is omitted', () => {
    const high = makeProvider('high', 90);
    const low = makeProvider('low', 10);
    // desc: higher first, so high < low in sort terms
    expect(compareSkillProviders(high, low)).toBeLessThan(0);
  });

  it('should handle asc priority order with equal priorities', () => {
    const a = makeProvider('a', 50);
    const b = makeProvider('b', 50);
    // With asc, equal priority means same priority diff, so source/id breaks tie
    expect(compareSkillProviders(a, b, 'asc')).toBeLessThan(0);
  });

  it('should compare two skillhub providers by id when priorities equal', () => {
    const a = makeProvider('x-skill', 50, 'skillhub');
    const b = makeProvider('y-skill', 50, 'skillhub');
    expect(compareSkillProviders(a, b)).toBeLessThan(0);
    expect(compareSkillProviders(b, a)).toBeGreaterThan(0);
  });

  it('should give builtin precedence even with asc order', () => {
    const builtin = makeProvider('a', 50, 'builtin');
    const skillhub = makeProvider('b', 50, 'skillhub');
    // priority same with asc -> diff is 0, source tiebreak still prefers builtin
    expect(compareSkillProviders(builtin, skillhub, 'asc')).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. resolveSkillDependencies
// ---------------------------------------------------------------------------

describe('resolveSkillDependencies', () => {
  it('should accept all providers with no requires or conflicts', () => {
    const providers = [makeProvider('a'), makeProvider('b')];
    const packages = new Map([makePackage('a'), makePackage('b')]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.rejected).toEqual([]);
  });

  it('should accept a provider whose requires are satisfied', () => {
    const providers = [makeProvider('a'), makeProvider('b')];
    const packages = new Map([makePackage('a', { requires: ['b'] }), makePackage('b')]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.rejected).toEqual([]);
  });

  it('should reject a provider with unmet requires', () => {
    const providers = [makeProvider('a')];
    const packages = new Map([makePackage('a', { requires: ['missing-dep'] })]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      providerId: 'a',
      reason: 'unmet_requires',
    });
    expect(result.rejected[0].detail).toContain('missing-dep');
  });

  it('should reject a provider conflicting with another loaded provider', () => {
    const providers = [makeProvider('a'), makeProvider('b')];
    const packages = new Map([
      makePackage('a', { conflicts: ['b'] }),
      makePackage('b'),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['b']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe('conflict_detected');
    expect(result.rejected[0].detail).toContain('b');
  });

  it('should accept providers not found in the packages map', () => {
    const providers = [makeProvider('a'), makeProvider('unknown')];
    const packages = new Map([makePackage('a')]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a', 'unknown']);
    expect(result.rejected).toEqual([]);
  });

  it('should handle empty providers list', () => {
    const packages = new Map([makePackage('a')]);
    const result = resolveSkillDependencies([], packages);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('should handle empty packages map', () => {
    const providers = [makeProvider('a'), makeProvider('b')];
    const result = resolveSkillDependencies(providers, new Map());

    expect(result.accepted.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.rejected).toEqual([]);
  });

  it('should reject a provider with multiple unmet requires', () => {
    const providers = [makeProvider('a')];
    const packages = new Map([makePackage('a', { requires: ['dep-x', 'dep-y'] })]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].detail).toContain('dep-x');
    expect(result.rejected[0].detail).toContain('dep-y');
  });

  it('should propagate rejections: if B is rejected, A requiring B is also rejected', () => {
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

  it('should not self-conflict when provider id appears in its own conflicts list', () => {
    const providers = [makeProvider('a')];
    const packages = new Map([makePackage('a', { conflicts: ['a'] })]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a']);
    expect(result.rejected).toEqual([]);
  });

  it('should handle transitive requires: C requires B, B requires A, all present', () => {
    const providers = [makeProvider('a'), makeProvider('b'), makeProvider('c')];
    const packages = new Map([
      makePackage('a'),
      makePackage('b', { requires: ['a'] }),
      makePackage('c', { requires: ['b'] }),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    expect(result.rejected).toEqual([]);
  });

  it('should handle transitive requires: C requires B, B requires A, A missing', () => {
    const providers = [makeProvider('b'), makeProvider('c')];
    const packages = new Map([
      makePackage('b', { requires: ['a'] }),
      makePackage('c', { requires: ['b'] }),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    // B is rejected because A is missing; C is then rejected because B was removed
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((r) => r.providerId).sort()).toEqual(['b', 'c']);
  });

  it('should handle mutual conflicts: both providers conflict with each other', () => {
    const providers = [makeProvider('a', 90), makeProvider('b', 80)];
    const packages = new Map([
      makePackage('a', { conflicts: ['b'] }),
      makePackage('b', { conflicts: ['a'] }),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    // a has higher priority and is processed first; b conflicts with a -> b rejected
    // But a also conflicts with b; since b is still in the set when a is checked, a is rejected too.
    // The iterative loop will resolve this: both get rejected or one survives based on iteration order.
    expect(result.rejected.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle a provider with empty requires array', () => {
    const providers = [makeProvider('a')];
    const packages = new Map([makePackage('a', { requires: [] })]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a']);
    expect(result.rejected).toEqual([]);
  });

  it('should handle a provider with empty conflicts array', () => {
    const providers = [makeProvider('a')];
    const packages = new Map([makePackage('a', { conflicts: [] })]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id)).toEqual(['a']);
    expect(result.rejected).toEqual([]);
  });

  it('should reject a provider conflicting with multiple other providers', () => {
    const providers = [makeProvider('a'), makeProvider('b'), makeProvider('c')];
    const packages = new Map([
      makePackage('a', { conflicts: ['b', 'c'] }),
      makePackage('b'),
      makePackage('c'),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted.map((p) => p.id).sort()).toEqual(['b', 'c']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].providerId).toBe('a');
    expect(result.rejected[0].detail).toContain('b');
    expect(result.rejected[0].detail).toContain('c');
  });

  it('should handle a chain where rejecting one cascades to others', () => {
    // a requires b, b requires c, c requires d, d is missing
    const providers = [makeProvider('a'), makeProvider('b'), makeProvider('c')];
    const packages = new Map([
      makePackage('a', { requires: ['b'] }),
      makePackage('b', { requires: ['c'] }),
      makePackage('c', { requires: ['d'] }),
    ]);
    const result = resolveSkillDependencies(providers, packages);

    expect(result.accepted).toEqual([]);
    // All three should be rejected due to the chain
    expect(result.rejected.map((r) => r.providerId).sort()).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// 5. summarizeSkillLoadResult
// ---------------------------------------------------------------------------

describe('summarizeSkillLoadResult', () => {
  it('should summarize a successful load with no failures', () => {
    const summary = summarizeSkillLoadResult({
      providers: [
        { id: 'a', domain: 'demo', source: 'builtin', priority: 50 },
        { id: 'b', domain: 'demo', source: 'builtin', priority: 40 },
      ],
      failures: [],
    });

    expect(summary.loaded).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.failuresByReason).toEqual({});
    expect(summary.failureDetails).toEqual([]);
  });

  it('should group failures by reason and include details', () => {
    const summary = summarizeSkillLoadResult({
      providers: [{ id: 'ok', domain: 'demo', source: 'builtin', priority: 50 }],
      failures: [
        {
          packageId: 'pkg-a',
          packageVersion: '1.0.0',
          domain: 'code-check',
          source: 'skillhub',
          stage: 'entrypoint',
          reason: 'missing_entrypoint',
        },
        {
          packageId: 'pkg-b',
          packageVersion: '1.0.0',
          domain: 'code-check',
          source: 'skillhub',
          stage: 'import',
          reason: 'import_failed',
          detail: 'Module not found',
        },
        {
          packageId: 'pkg-c',
          packageVersion: '1.0.0',
          domain: 'code-check',
          source: 'skillhub',
          stage: 'entrypoint',
          reason: 'missing_entrypoint',
        },
      ],
    });

    expect(summary.loaded).toBe(1);
    expect(summary.failed).toBe(3);
    expect(summary.failuresByReason).toEqual({
      missing_entrypoint: 2,
      import_failed: 1,
    });
    expect(summary.failureDetails).toHaveLength(3);
    expect(summary.failureDetails[1]).toMatchObject({
      packageId: 'pkg-b',
      reason: 'import_failed',
      detail: 'Module not found',
    });
  });

  it('should handle empty providers and failures', () => {
    const summary = summarizeSkillLoadResult({ providers: [], failures: [] });

    expect(summary.loaded).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.failuresByReason).toEqual({});
    expect(summary.failureDetails).toEqual([]);
  });

  it('should handle failures without detail field', () => {
    const summary = summarizeSkillLoadResult({
      providers: [],
      failures: [
        {
          packageId: 'pkg-no-detail',
          packageVersion: '1.0.0',
          domain: 'code-check',
          source: 'skillhub',
          stage: 'entrypoint',
          reason: 'missing_entrypoint',
        },
      ],
    });

    expect(summary.failed).toBe(1);
    expect(summary.failureDetails).toHaveLength(1);
    expect(summary.failureDetails[0]).toMatchObject({
      packageId: 'pkg-no-detail',
      reason: 'missing_entrypoint',
      detail: undefined,
    });
  });

  it('should count multiple different failure reasons correctly', () => {
    const summary = summarizeSkillLoadResult({
      providers: [],
      failures: [
        {
          packageId: 'pkg-1',
          packageVersion: '1.0.0',
          domain: 'code-check',
          source: 'skillhub',
          stage: 'entrypoint',
          reason: 'missing_entrypoint',
        },
        {
          packageId: 'pkg-2',
          packageVersion: '1.0.0',
          domain: 'code-check',
          source: 'skillhub',
          stage: 'import',
          reason: 'import_failed',
          detail: 'some error',
        },
        {
          packageId: 'pkg-3',
          packageVersion: '1.0.0',
          domain: 'code-check',
          source: 'skillhub',
          stage: 'validate',
          reason: 'invalid_provider',
          detail: 'bad export',
        },
      ],
    });

    expect(summary.failuresByReason).toEqual({
      missing_entrypoint: 1,
      import_failed: 1,
      invalid_provider: 1,
    });
    expect(summary.failureDetails).toHaveLength(3);
  });

  it('should preserve failure detail strings', () => {
    const summary = summarizeSkillLoadResult({
      providers: [],
      failures: [
        {
          packageId: 'pkg-1',
          packageVersion: '1.0.0',
          domain: 'demo',
          source: 'skillhub',
          stage: 'import',
          reason: 'import_failed',
          detail: 'SyntaxError: Unexpected token',
        },
      ],
    });

    expect(summary.failureDetails[0].detail).toBe('SyntaxError: Unexpected token');
  });
});

// ---------------------------------------------------------------------------
// 6. evaluateSkillCompatibility (additional coverage)
// ---------------------------------------------------------------------------

describe('evaluateSkillCompatibility', () => {
  it('should return compatible when runtime version equals minimum', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      '0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(true);
    expect(result.reasonCodes).toEqual([]);
  });

  it('should return compatible when runtime version exceeds minimum', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '0.1.0', skillApiVersion: 'v1' },
      '1.0.0',
      'v1',
    );
    expect(result.compatible).toBe(true);
  });

  it('should detect runtime version incompatibility', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '9.0.0', skillApiVersion: 'v1' },
      '0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(false);
    expect(result.reasonCodes).toContain('runtime_version_incompatible');
  });

  it('should detect skill API version incompatibility', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '0.1.0', skillApiVersion: 'v2' },
      '0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(false);
    expect(result.reasonCodes).toContain('skill_api_version_incompatible');
  });

  it('should detect both incompatibilities simultaneously', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: '9.0.0', skillApiVersion: 'v2' },
      '0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(false);
    expect(result.reasonCodes).toEqual([
      'runtime_version_incompatible',
      'skill_api_version_incompatible',
    ]);
  });

  it('should handle v-prefixed runtime versions', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: 'v0.1.0', skillApiVersion: 'v1' },
      'v0.1.0',
      'v1',
    );
    expect(result.compatible).toBe(true);
  });

  it('should detect incompatibility with v-prefixed versions', () => {
    const result = evaluateSkillCompatibility(
      { minRuntimeVersion: 'v2.0.0', skillApiVersion: 'v1' },
      'v1.0.0',
      'v1',
    );
    expect(result.compatible).toBe(false);
    expect(result.reasonCodes).toContain('runtime_version_incompatible');
  });
});

// ---------------------------------------------------------------------------
// 7. loadExecutableSkillProviders (additional edge cases)
// ---------------------------------------------------------------------------

describe('loadExecutableSkillProviders', () => {
  it('should default packages to empty array when omitted', async () => {
    const result = await loadExecutableSkillProviders({
      entrypointKey: 'codeCheck',
      importModule: async () => ({}),
      buildProvider: () => ({ id: 'x', domain: 'demo', source: 'builtin', priority: 10 }),
    });

    expect(result.providers).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('should handle entrypoint key that exists but is undefined', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [
        makePkg('pkg-undef', { entrypoints: { codeCheck: undefined } }),
      ],
      entrypointKey: 'codeCheck',
      importModule: async () => ({}),
      buildProvider: () => ({ id: 'x', domain: 'demo', source: 'builtin', priority: 10 }),
    });

    expect(result.providers).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe('missing_entrypoint');
  });

  it('should build provider from module and package after successful validation', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [
        makePkg('pkg-ok', { entrypoints: { handler: 'dist/handler.js' } }),
      ],
      entrypointKey: 'handler',
      importModule: async () => ({ name: 'test-module' }),
      validateModule: () => [],
      buildProvider: (module, pkg) => ({
        id: `${pkg.id}-provider`,
        domain: pkg.domain,
        source: 'skillhub',
        priority: 10,
      }),
    });

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].id).toBe('pkg-ok-provider');
  });

  it('should include all failure metadata fields', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [
        makePkg('pkg-meta', {
          version: '3.1.0',
          domain: 'code-check',
          source: 'skillhub',
          entrypoints: {},
        }),
      ],
      entrypointKey: 'main',
      importModule: async () => ({}),
      buildProvider: () => ({ id: 'x', domain: 'demo', source: 'builtin', priority: 10 }),
    });

    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0];
    expect(failure.packageId).toBe('pkg-meta');
    expect(failure.packageVersion).toBe('3.1.0');
    expect(failure.domain).toBe('code-check');
    expect(failure.source).toBe('skillhub');
    expect(failure.stage).toBe('entrypoint');
    expect(failure.reason).toBe('missing_entrypoint');
  });

  it('should join multiple validation errors with semicolons in detail', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [
        makePkg('pkg-bad', { entrypoints: { main: 'dist/main.js' } }),
      ],
      entrypointKey: 'main',
      importModule: async () => ({}),
      validateModule: () => ['missing export A', 'missing export B'],
      buildProvider: () => ({ id: 'x', domain: 'demo', source: 'builtin', priority: 10 }),
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].detail).toBe('missing export A; missing export B');
    expect(result.failures[0].reason).toBe('invalid_provider');
    expect(result.failures[0].stage).toBe('validate');
  });

  it('should process multiple packages sequentially', async () => {
    const callOrder = [];
    const result = await loadExecutableSkillProviders({
      packages: [
        makePkg('first', { entrypoints: { run: 'a.js' } }),
        makePkg('second', { entrypoints: { run: 'b.js' } }),
      ],
      entrypointKey: 'run',
      importModule: async (spec, pkg) => {
        callOrder.push(pkg.id);
        return { providerId: `${pkg.id}-prov` };
      },
      buildProvider: (mod) => ({
        id: mod.providerId,
        domain: 'demo',
        source: 'skillhub',
        priority: 10,
      }),
    });

    expect(callOrder).toEqual(['first', 'second']);
    expect(result.providers.map((p) => p.id)).toEqual(['first-prov', 'second-prov']);
  });
});
