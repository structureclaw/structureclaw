import { describe, expect, test } from '@jest/globals';

const baseConfig = {
  llmApiKey: 'test-key',
  llmModel: 'glm-5-turbo',
  llmTimeoutMs: 30000,
  llmMaxRetries: 1,
  llmBaseUrl: 'https://example.com/v1',
};

describe('LLM model options', () => {
  test('keeps streaming available by default', async () => {
    const { buildChatModelOptions } = await import('../../../dist/utils/llm.js');

    const options = buildChatModelOptions(baseConfig, 0.2);

    expect(options.disableStreaming).toBe(false);
    expect(options.streaming).toBeUndefined();
  });

  test('can disable LangChain invoke streaming for graph-state correctness', async () => {
    const { buildChatModelOptions } = await import('../../../dist/utils/llm.js');

    const options = buildChatModelOptions(baseConfig, 0, { disableStreaming: true });

    expect(options.disableStreaming).toBe(true);
    expect(options.streaming).toBe(false);
    expect(options.modelName).toBe('glm-5-turbo');
    expect(options.configuration.baseURL).toBe('https://example.com/v1');
  });
});
