import { describe, expect, test } from '@jest/globals';
import { buildChatModelOptions } from '../dist/utils/llm.js';
import { planNextStepWithLlm } from '../dist/services/agent-router.js';

describe('LLM planner wiring', () => {
  test('buildChatModelOptions forwards the configured apiKey to ChatOpenAI', () => {
    const options = buildChatModelOptions({
      llmApiKey: 'test-key',
      llmModel: 'glm-5-turbo',
      llmTimeoutMs: 180000,
      llmMaxRetries: 0,
      llmBaseUrl: 'https://example.com/v1',
    }, 0.1);

    expect(options.apiKey).toBe('test-key');
    expect(Object.prototype.hasOwnProperty.call(options, 'openAIApiKey')).toBe(false);
    expect(options.configuration?.baseURL).toBe('https://example.com/v1');
  });

  test('planNextStepWithLlm surfaces planner unavailability when the LLM call fails', async () => {
    const fakeLlm = {
      invoke: async () => {
        throw new Error('Missing credentials');
      },
    };

    await expect(planNextStepWithLlm(
      fakeLlm,
      '设计一个简支梁，跨度10m，梁中间荷载1kN',
      {
        locale: 'zh',
        skillIds: ['opensees-static', 'generic'],
        hasModel: false,
        activeToolIds: new Set(['draft_model', 'run_analysis']),
      },
      async () => ({
        criticalMissing: ['inferredType'],
        nonCriticalMissing: ['analysisType'],
        defaultProposals: [],
      }),
    )).rejects.toThrow('LLM_PLANNER_UNAVAILABLE');
  });
});
