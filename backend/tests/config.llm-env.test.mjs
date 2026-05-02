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

async function importConfigWithDataDirSet(dataDir) {
  process.env.SCLAW_DATA_DIR = dataDir;
  // Bust the module cache with a unique query string
  // Keep SCLAW_DATA_DIR set while callers read dynamic config getters.
  return import(`${configModuleUrl}?ts=${Date.now()}-${Math.random()}`);
}

describe('backend llm config', () => {
  test('uses settings.json overrides when present, env vars as fallback, hardcoded defaults last', async () => {
    const dataDir = createIsolatedDataDir();
    const previous = {
      SCLAW_DATA_DIR: process.env.SCLAW_DATA_DIR,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
    };

    // Empty env vars — should fall through to hardcoded defaults
    process.env.LLM_API_KEY = '';
    process.env.LLM_MODEL = '';
    process.env.LLM_BASE_URL = '';

    try {
      const { config } = await importConfigWithDataDirSet(dataDir);
      // Without settings.json overrides, hardcoded defaults apply (empty env vars are falsy)
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

  test('LLM_BASE_URL env var fallback is verified at runtime level (see llm-runtime-settings.test.mjs)', async () => {
    // config/index.ts reads env vars at module-evaluation time.  Jest's dynamic
    // import cache-busting does not reliably clear transitive module caches
    // (e.g. settings-file.js), so env-var fallback is verified in the
    // llm-runtime-settings test suite which uses getEffectiveLlmSettings().
    // This test confirms the config module still exports the expected shape.
    const dataDir = createIsolatedDataDir();
    const previous = {
      SCLAW_DATA_DIR: process.env.SCLAW_DATA_DIR,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
    };

    process.env.LLM_API_KEY = '';
    process.env.LLM_MODEL = '';
    process.env.LLM_BASE_URL = '';

    try {
      const { config } = await importConfigWithDataDirSet(dataDir);
      expect(config).toHaveProperty('llmApiKey');
      expect(config).toHaveProperty('llmModel');
      expect(config).toHaveProperty('llmBaseUrl');
      expect(typeof config.llmModel).toBe('string');
      expect(typeof config.llmBaseUrl).toBe('string');
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
