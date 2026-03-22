import { describe, expect, test } from '@jest/globals';
import { loadExecutableSkillProviders } from '../dist/agent-skills/shared/loader.js';

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
});
