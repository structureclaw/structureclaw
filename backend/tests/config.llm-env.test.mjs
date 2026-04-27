import { describe, expect, test } from '@jest/globals';

const configModuleUrl = new URL('../dist/config/index.js', import.meta.url).href;

async function importConfigFresh() {
  return import(`${configModuleUrl}?ts=${Date.now()}-${Math.random()}`);
}

describe('backend llm config', () => {
  test('uses settings.json overrides when present, hardcoded defaults otherwise', async () => {
    // Clear any env vars that might influence old behavior
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
      // Without settings.json overrides, hardcoded defaults apply
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

  test('settings.json is the only user config source, no env fallback', async () => {
    // Even with env vars set, they should NOT affect config
    const previous = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
    };

    process.env.LLM_API_KEY = 'env-key-should-be-ignored';
    process.env.LLM_MODEL = 'env-model-should-be-ignored';
    process.env.LLM_BASE_URL = 'http://env-should-be-ignored';

    try {
      const { config } = await importConfigFresh();
      // Env vars should NOT override — only settings.json matters
      expect(config.llmApiKey).toBe('');
      expect(config.llmModel).toBe('gpt-4-turbo-preview');
      expect(config.llmBaseUrl).toBe('https://api.openai.com/v1');
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
