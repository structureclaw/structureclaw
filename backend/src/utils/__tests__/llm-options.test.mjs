import { describe, expect, test } from '@jest/globals';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

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

  test('passes DeepSeek V4 reasoning content back on assistant messages', async () => {
    const { attachDeepSeekReasoningContent, isDeepSeekV4Model } = await import('../../../dist/utils/llm.js');

    expect(isDeepSeekV4Model('deepseek-v4-pro')).toBe(true);
    expect(isDeepSeekV4Model('deepseek-reasoner')).toBe(false);

    const request = {
      model: 'deepseek-v4-pro',
      messages: [
        { role: 'user', content: 'Need weather.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function' }] },
        { role: 'tool', tool_call_id: 'call-1', content: 'Cloudy' },
        { role: 'assistant', content: 'Cloudy.' },
      ],
    };
    const sourceMessages = [
      new HumanMessage('Need weather.'),
      new AIMessage({
        content: '',
        additional_kwargs: { reasoning_content: 'Need to call a weather tool.' },
        tool_calls: [{ id: 'call-1', name: 'get_weather', args: {} }],
      }),
      new ToolMessage({ tool_call_id: 'call-1', content: 'Cloudy' }),
      new AIMessage({
        content: 'Cloudy.',
        additional_kwargs: { reasoning_content: 'The tool returned a forecast.' },
      }),
    ];

    const patched = attachDeepSeekReasoningContent(request, sourceMessages);

    expect(patched).not.toBe(request);
    expect(patched.messages[1]).toMatchObject({
      role: 'assistant',
      reasoning_content: 'Need to call a weather tool.',
    });
    expect(patched.messages[3]).toMatchObject({
      role: 'assistant',
      reasoning_content: 'The tool returned a forecast.',
    });
    expect(request.messages[1]).not.toHaveProperty('reasoning_content');
  });

  test('does not attach DeepSeek reasoning content when assistant counts diverge', async () => {
    const { attachDeepSeekReasoningContent } = await import('../../../dist/utils/llm.js');
    const request = {
      model: 'deepseek-v4-pro',
      messages: [
        { role: 'user', content: 'Need weather.' },
        { role: 'assistant', content: 'Cloudy.' },
      ],
    };
    const sourceMessages = [
      new HumanMessage('Need weather.'),
      new AIMessage({
        content: '',
        additional_kwargs: { reasoning_content: 'Need to call a weather tool.' },
        tool_calls: [{ id: 'call-1', name: 'get_weather', args: {} }],
      }),
      new ToolMessage({ tool_call_id: 'call-1', content: 'Cloudy' }),
      new AIMessage({
        content: 'Cloudy.',
        additional_kwargs: { reasoning_content: 'The tool returned a forecast.' },
      }),
    ];

    const patched = attachDeepSeekReasoningContent(request, sourceMessages);

    expect(patched).toBe(request);
    expect(request.messages[1]).not.toHaveProperty('reasoning_content');
  });
});
