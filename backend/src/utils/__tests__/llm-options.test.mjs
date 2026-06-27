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

    expect(options.temperature).toBe(0.2);
    expect(options.disableStreaming).toBe(false);
    expect(options.streaming).toBeUndefined();
  });

  test('can omit temperature for configured OpenAI-compatible model aliases', async () => {
    const previous = process.env.LLM_OMIT_TEMPERATURE_MODELS;
    process.env.LLM_OMIT_TEMPERATURE_MODELS = 'claude-opus-4-8';
    try {
      const { buildChatModelOptions, shouldOmitTemperature } = await import('../../../dist/utils/llm.js');

      const claudeOptions = buildChatModelOptions({
        ...baseConfig,
        llmModel: 'claude-opus-4-8',
      }, 0);
      const glmOptions = buildChatModelOptions(baseConfig, 0);

      expect(shouldOmitTemperature('claude-opus-4-8')).toBe(true);
      expect(claudeOptions).not.toHaveProperty('temperature');
      expect(glmOptions.temperature).toBe(0);
    } finally {
      if (previous === undefined) {
        delete process.env.LLM_OMIT_TEMPERATURE_MODELS;
      } else {
        process.env.LLM_OMIT_TEMPERATURE_MODELS = previous;
      }
    }
  });

  test('does not omit temperature for broad substring-only alias matches', async () => {
    const previous = process.env.LLM_OMIT_TEMPERATURE_MODELS;
    process.env.LLM_OMIT_TEMPERATURE_MODELS = 'claude,gpt,a';
    try {
      const { buildChatModelOptions, shouldOmitTemperature } = await import('../../../dist/utils/llm.js');

      const claudeOptions = buildChatModelOptions({
        ...baseConfig,
        llmModel: 'claude-opus-4-8',
      }, 0);
      const wrappedClaudeOptions = buildChatModelOptions({
        ...baseConfig,
        llmModel: 'my-claude-wrapper',
      }, 0);
      const broadSubstringOptions = buildChatModelOptions({
        ...baseConfig,
        llmModel: 'paratera-model',
      }, 0);

      expect(shouldOmitTemperature('claude-opus-4-8')).toBe(true);
      expect(claudeOptions).not.toHaveProperty('temperature');
      expect(wrappedClaudeOptions.temperature).toBe(0);
      expect(broadSubstringOptions.temperature).toBe(0);
    } finally {
      if (previous === undefined) {
        delete process.env.LLM_OMIT_TEMPERATURE_MODELS;
      } else {
        process.env.LLM_OMIT_TEMPERATURE_MODELS = previous;
      }
    }
  });

  test('can disable LangChain invoke streaming for graph-state correctness', async () => {
    const { buildChatModelOptions } = await import('../../../dist/utils/llm.js');

    const options = buildChatModelOptions(baseConfig, 0, { disableStreaming: true });

    expect(options.disableStreaming).toBe(true);
    expect(options.streaming).toBe(false);
    expect(options.modelName).toBe('glm-5-turbo');
    expect(options.configuration.baseURL).toBe('https://example.com/v1');
  });

  test('resolves Anthropic provider from explicit env or native base URL', async () => {
    const previous = process.env.LLM_PROVIDER;
    try {
      const { resolveLlmProvider } = await import('../../../dist/utils/llm.js');

      process.env.LLM_PROVIDER = 'anthropic';
      expect(resolveLlmProvider(baseConfig)).toBe('anthropic');

      process.env.LLM_PROVIDER = 'openai-compatible';
      expect(resolveLlmProvider({
        ...baseConfig,
        llmModel: 'claude-opus-4-8',
        llmBaseUrl: 'https://api.anthropic.com',
      })).toBe('openai-compatible');

      delete process.env.LLM_PROVIDER;
      expect(resolveLlmProvider({
        ...baseConfig,
        llmModel: 'claude-opus-4-8',
        llmBaseUrl: 'https://api.anthropic.com/v1',
      })).toBe('anthropic');

      expect(resolveLlmProvider({
        ...baseConfig,
        llmBaseUrl: 'https://notanthropic.com/v1',
      })).toBe('openai-compatible');
    } finally {
      if (previous === undefined) {
        delete process.env.LLM_PROVIDER;
      } else {
        process.env.LLM_PROVIDER = previous;
      }
    }
  });

  test('routes Claude model names to Anthropic even with custom base URLs', async () => {
    const previous = process.env.LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
    try {
      const { resolveLlmProvider } = await import('../../../dist/utils/llm.js');

      expect(resolveLlmProvider({
        ...baseConfig,
        llmModel: 'claude-opus-4-8',
        llmBaseUrl: 'https://api.aicodemirror.com/api/claudecode/v1',
      })).toBe('anthropic');
    } finally {
      if (previous === undefined) {
        delete process.env.LLM_PROVIDER;
      } else {
        process.env.LLM_PROVIDER = previous;
      }
    }
  });

  test('builds Anthropic options and normalizes official v1 base URL', async () => {
    const { buildAnthropicChatModelOptions, normalizeAnthropicBaseUrl } = await import('../../../dist/utils/llm.js');

    const options = buildAnthropicChatModelOptions({
      ...baseConfig,
      llmModel: 'claude-opus-4-8',
      llmBaseUrl: 'https://api.anthropic.com/v1',
    }, 0, { disableStreaming: true });

    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com');
    expect(normalizeAnthropicBaseUrl('https://api.aicodemirror.com/api/claudecode/v1'))
      .toBe('https://api.aicodemirror.com/api/claudecode');
    expect(options).toMatchObject({
      model: 'claude-opus-4-8',
      apiKey: 'test-key',
      maxRetries: 1,
      disableStreaming: true,
      streaming: false,
      anthropicApiUrl: 'https://api.anthropic.com',
      clientOptions: {
        timeout: 30000,
      },
      temperature: 0,
    });
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
