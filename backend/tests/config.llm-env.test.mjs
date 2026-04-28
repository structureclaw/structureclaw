import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const configModuleUrl = new URL('../dist/config/index.js', import.meta.url).href;

function createIsolatedDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-config-test-'));
  // Create empty settings.json so config reads defaults
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}', 'utf8');
  return dir;
}

function cleanupIsolatedDataDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function importConfigFresh(dataDir) {
  const prev = process.env.SCLAW_DATA_DIR;
  process.env.SCLAW_DATA_DIR = dataDir;
  try {
    // Bust the module cache with a unique query string
    return await import(`${configModuleUrl}?ts=${Date.now()}-${Math.random()}`);
  } finally {
    if (prev === undefined) {
      delete process.env.SCLAW_DATA_DIR;
    } else {
      process.env.SCLAW_DATA_DIR = prev;
    }
  }
}

describe('backend llm config', () => {
  test('uses settings.json overrides when present, hardcoded defaults otherwise', async () => {
    const dataDir = createIsolatedDataDir();
    const previous = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
    };

    process.env.LLM_API_KEY = '';
    process.env.LLM_MODEL = '';
    process.env.LLM_BASE_URL = '';

    try {
      const { config } = await importConfigFresh(dataDir);
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
      cleanupIsolatedDataDir(dataDir);
    }
  });

  test('settings.json is the only user config source, no env fallback', async () => {
    const dataDir = createIsolatedDataDir();
    const previous = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
    };

    process.env.LLM_API_KEY = 'env-key-should-be-ignored';
    process.env.LLM_MODEL = 'env-model-should-be-ignored';
    process.env.LLM_BASE_URL = 'http://env-should-be-ignored';

    try {
      const { config } = await importConfigFresh(dataDir);
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
      cleanupIsolatedDataDir(dataDir);
    }
  });
});
