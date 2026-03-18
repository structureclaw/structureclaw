import { describe, expect, test } from '@jest/globals';
import {
  executeCodeCheckDomain,
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

  test('should fallback to custom passthrough for unknown code', async () => {
    const calls = [];
    const engineClient = {
      post: async (path, payload) => {
        calls.push({ path, payload });
        return { data: { status: 'success', code: payload.code } };
      },
    };

    const result = await executeCodeCheckDomain(engineClient, {
      modelId: 'm2',
      code: 'ACI318',
      elements: ['E9'],
      context: {
        analysisSummary: {},
        utilizationByElement: {},
      },
    });

    expect(calls[0].payload.code).toBe('ACI318');
    expect(result.code).toBe('ACI318');
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
    expect(resolveCodeCheckDesignCodeFromSkillIds(['code-check-custom'])).toBeUndefined();
    expect(resolveCodeCheckDesignCodeFromSkillIds(['beam'])).toBeUndefined();
  });
});
