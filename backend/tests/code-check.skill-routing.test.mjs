import { describe, expect, test } from '@jest/globals';
import {
  executeCodeCheckDomain,
  listCodeCheckRuleProviders,
  resolveCodeCheckDesignCodeFromSkillIds,
} from '../dist/agent-skills/code-check/entry.js';

describe('code-check per-standard skill routing', () => {
  test('should route GB50017 alias to gb50017 skill and canonical code', async () => {
    const calls = [];
    const engineClient = {
      post: async (path, payload) => {
        calls.push({ path, payload });
        return { data: { status: 'success', code: payload.code } };
      },
    };

    const result = await executeCodeCheckDomain(engineClient, {
      modelId: 'm1',
      code: 'gb50017-2017',
      elements: ['E1'],
      context: {
        analysisSummary: {},
        utilizationByElement: {},
      },
    });

    expect(calls[0].path).toBe('/code-check');
    expect(calls[0].payload.code).toBe('GB50017');
    expect(result.code).toBe('GB50017');
  });

  test('should reject unknown code-check standards explicitly', async () => {
    const calls = [];
    const engineClient = {
      post: async (path, payload) => {
        calls.push({ path, payload });
        return { data: { status: 'success', code: payload.code } };
      },
    };

    await expect(executeCodeCheckDomain(engineClient, {
      modelId: 'm2',
      code: 'ACI318',
      elements: ['E9'],
      context: {
        analysisSummary: {},
        utilizationByElement: {},
      },
    })).rejects.toThrow('Unsupported code-check standard: ACI318');
    expect(calls).toHaveLength(0);
  });

  test('should dispatch each supported standard independently', async () => {
    const calls = [];
    const engineClient = {
      post: async (path, payload) => {
        calls.push({ path, payload });
        return { data: { status: 'success', code: payload.code } };
      },
    };

    await executeCodeCheckDomain(engineClient, {
      modelId: 'm3',
      code: 'GB50010-2010',
      elements: ['E1'],
      context: { analysisSummary: {}, utilizationByElement: {} },
    });
    await executeCodeCheckDomain(engineClient, {
      modelId: 'm4',
      code: 'GB50011-2010',
      elements: ['E1'],
      context: { analysisSummary: {}, utilizationByElement: {} },
    });
    await executeCodeCheckDomain(engineClient, {
      modelId: 'm5',
      code: 'JGJ3-2010',
      elements: ['E1'],
      context: { analysisSummary: {}, utilizationByElement: {} },
    });

    expect(calls[0].payload.code).toBe('GB50010');
    expect(calls[1].payload.code).toBe('GB50011');
    expect(calls[2].payload.code).toBe('JGJ3');
  });

  test('should resolve design code from selected code-check skill ids', () => {
    expect(resolveCodeCheckDesignCodeFromSkillIds(['beam', 'code-check-gb50010'])).toBe('GB50010');
    expect(resolveCodeCheckDesignCodeFromSkillIds(['code-check-jgj3'])).toBe('JGJ3');
    expect(resolveCodeCheckDesignCodeFromSkillIds(['beam'])).toBeUndefined();
  });

  test('should expose built-in providers in deterministic order', () => {
    const providers = listCodeCheckRuleProviders();

    expect(providers.map((provider) => provider.id)).toEqual([
      'code-check-gb50017',
      'code-check-gb50010',
      'code-check-gb50011',
      'code-check-jgj3',
    ]);
  });

  test('should merge external providers by priority into deterministic order', () => {
    const externalRule = {
      skillId: 'code-check-ext',
      designCode: 'EXT001',
      matches: (code) => code === 'EXT001',
      execute: async () => ({ source: 'external' }),
    };

    const providers = listCodeCheckRuleProviders({
      externalProviders: [{
        id: externalRule.skillId,
        domain: 'code-check',
        source: 'skillhub',
        priority: 115,
        rule: externalRule,
      }],
    });

    expect(providers.map((provider) => provider.id)).toEqual([
      'code-check-gb50017',
      'code-check-gb50010',
      'code-check-ext',
      'code-check-gb50011',
      'code-check-jgj3',
    ]);
    expect(resolveCodeCheckDesignCodeFromSkillIds(['code-check-ext'], {
      externalProviders: [{
        id: externalRule.skillId,
        domain: 'code-check',
        source: 'skillhub',
        priority: 115,
        rule: externalRule,
      }],
    })).toBe('EXT001');
  });
});
