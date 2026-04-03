import { describe, expect, test } from '@jest/globals';
import { loadExecutableSkillProviders, summarizeSkillLoadResult } from '../dist/skill-shared/loader.js';

describe('shared executable skill provider loader', () => {
  test('should load executable providers when entrypoint import and validation succeed', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [{
        id: 'pkg-ok',
        domain: 'code-check',
        version: '1.0.0',
        source: 'skillhub',
        capabilities: [],
        compatibility: {
          minRuntimeVersion: '0.1.0',
          skillApiVersion: 'v1',
        },
        entrypoints: {
          codeCheck: 'dist/code-check.js',
        },
        enabledByDefault: false,
      }],
      entrypointKey: 'codeCheck',
      importModule: async () => ({ providerId: 'ext-provider' }),
      validateModule: () => [],
      buildProvider: (module) => ({
        id: module.providerId,
        domain: 'code-check',
        source: 'skillhub',
        priority: 10,
      }),
    });

    expect(result.failures).toEqual([]);
    expect(result.providers.map((provider) => provider.id)).toEqual(['ext-provider']);
  });

  test('should report missing entrypoint and invalid provider failures', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [
        {
          id: 'pkg-missing',
          domain: 'code-check',
          version: '1.0.0',
          source: 'skillhub',
          capabilities: [],
          compatibility: {
            minRuntimeVersion: '0.1.0',
            skillApiVersion: 'v1',
          },
          entrypoints: {},
          enabledByDefault: false,
        },
        {
          id: 'pkg-invalid',
          domain: 'code-check',
          version: '1.0.0',
          source: 'skillhub',
          capabilities: [],
          compatibility: {
            minRuntimeVersion: '0.1.0',
            skillApiVersion: 'v1',
          },
          entrypoints: {
            codeCheck: 'dist/code-check.js',
          },
          enabledByDefault: false,
        },
      ],
      entrypointKey: 'codeCheck',
      importModule: async () => ({ broken: true }),
      validateModule: (_module, pkg) => (pkg.id === 'pkg-invalid' ? ['provider export missing'] : []),
      buildProvider: () => ({
        id: 'unused',
        domain: 'code-check',
        source: 'skillhub',
        priority: 10,
      }),
    });

    expect(result.providers).toEqual([]);
    expect(result.failures.map((failure) => ({
      packageId: failure.packageId,
      stage: failure.stage,
      reason: failure.reason,
    }))).toEqual([
      {
        packageId: 'pkg-missing',
        stage: 'entrypoint',
        reason: 'missing_entrypoint',
      },
      {
        packageId: 'pkg-invalid',
        stage: 'validate',
        reason: 'invalid_provider',
      },
    ]);
  });

  test('should report import_failed when importModule throws an Error', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [{
        id: 'pkg-crash',
        domain: 'code-check',
        version: '2.0.0',
        source: 'skillhub',
        capabilities: [],
        compatibility: {
          minRuntimeVersion: '0.1.0',
          skillApiVersion: 'v1',
        },
        entrypoints: {
          codeCheck: 'dist/broken.js',
        },
        enabledByDefault: false,
      }],
      entrypointKey: 'codeCheck',
      importModule: async () => { throw new Error('Module not found: dist/broken.js'); },
      buildProvider: () => ({
        id: 'unused',
        domain: 'code-check',
        source: 'skillhub',
        priority: 10,
      }),
    });

    expect(result.providers).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      packageId: 'pkg-crash',
      packageVersion: '2.0.0',
      stage: 'import',
      reason: 'import_failed',
    });
    expect(result.failures[0].detail).toContain('Module not found');
  });

  test('should capture non-Error thrown values as import_failed detail', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [{
        id: 'pkg-string-throw',
        domain: 'code-check',
        version: '1.0.0',
        source: 'skillhub',
        capabilities: [],
        compatibility: {
          minRuntimeVersion: '0.1.0',
          skillApiVersion: 'v1',
        },
        entrypoints: {
          codeCheck: 'dist/thing.js',
        },
        enabledByDefault: false,
      }],
      entrypointKey: 'codeCheck',
      importModule: async () => { throw 'network timeout'; },
      buildProvider: () => ({
        id: 'unused',
        domain: 'code-check',
        source: 'skillhub',
        priority: 10,
      }),
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].detail).toBe('network timeout');
  });

  test('should return empty providers and failures when packages list is empty', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [],
      entrypointKey: 'codeCheck',
      importModule: async () => ({}),
      buildProvider: () => ({
        id: 'unused',
        domain: 'code-check',
        source: 'skillhub',
        priority: 10,
      }),
    });

    expect(result.providers).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  test('should skip validation when validateModule is not provided', async () => {
    const result = await loadExecutableSkillProviders({
      packages: [{
        id: 'pkg-no-validate',
        domain: 'code-check',
        version: '1.0.0',
        source: 'skillhub',
        capabilities: [],
        compatibility: {
          minRuntimeVersion: '0.1.0',
          skillApiVersion: 'v1',
        },
        entrypoints: {
          codeCheck: 'dist/code-check.js',
        },
        enabledByDefault: false,
      }],
      entrypointKey: 'codeCheck',
      importModule: async () => ({ providerId: 'no-validate-provider' }),
      buildProvider: (module) => ({
        id: module.providerId,
        domain: 'code-check',
        source: 'skillhub',
        priority: 10,
      }),
    });

    expect(result.failures).toEqual([]);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].id).toBe('no-validate-provider');
  });
});

describe('summarizeSkillLoadResult', () => {
  test('should summarize a successful load with no failures', () => {
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

  test('should group failures by reason and include details', () => {
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

  test('should handle empty result', () => {
    const summary = summarizeSkillLoadResult({
      providers: [],
      failures: [],
    });

    expect(summary.loaded).toBe(0);
    expect(summary.failed).toBe(0);
  });
});
