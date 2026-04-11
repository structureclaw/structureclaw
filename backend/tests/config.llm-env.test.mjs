import { describe, expect, test } from '@jest/globals';

const configModuleUrl = new URL('../dist/config/index.js', import.meta.url).href;

async function importConfigFresh() {
  return import(`${configModuleUrl}?ts=${Date.now()}-${Math.random()}`);
}

describe('backend llm env config', () => {
  test('uses direct OpenAI-compatible defaults without a legacy selector', async () => {
    const previous = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
    };

    process.env.LLM_API_KEY = '';
    process.env.LLM_MODEL = '';
    process.env.LLM_BASE_URL = '';

    try {
      const { config } = await importConfigFresh();
      expect(config.llmApiKey).toBe('');
      expect(config.llmModel).toBe('gpt-4-turbo-preview');
      expect(config.llmBaseUrl).toBe('https://api.openai.com/v1');
      expect('llmProvider' in config).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
