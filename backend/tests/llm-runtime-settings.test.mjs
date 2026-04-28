import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';

// Import compiled modules — these are singletons in module cache.
// Tests use SCLAW_DATA_DIR to control where settings.json is read/written.
// Each test sets SCLAW_DATA_DIR BEFORE the first import, then invalidates caches.
const llmRuntimeUrl = new URL('../dist/config/llm-runtime.js', import.meta.url).href;
const settingsFileUrl = new URL('../dist/config/settings-file.js', import.meta.url).href;
const configUrl = new URL('../dist/config/index.js', import.meta.url).href;

async function getModules() {
  // Use cache-busting query to force fresh module evaluation
  // Must bust all three modules since config/index.js is the root that reads settings
  const cacheBust = `?_=${Date.now()}-${Math.random()}`;
  const config = await import(`${configUrl}${cacheBust}`);
  const settingsFile = await import(`${settingsFileUrl}${cacheBust}`);
  const llmRuntime = await import(`${llmRuntimeUrl}${cacheBust}`);
  return { llmRuntime, settingsFile, config };
}

describe('backend runtime llm settings', () => {
  test('uses runtime settings from settings.json and reports runtime sources', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structureclaw-llm-settings-'));
    const previous = {
      SCLAW_DATA_DIR: process.env.SCLAW_DATA_DIR,
    };

    process.env.SCLAW_DATA_DIR = tempDir;

    const settingsPath = path.join(tempDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      llm: { apiKey: 'runtime-secret', model: 'runtime-model', baseUrl: 'https://runtime.example.com/v1' },
    }));

    try {
      const { llmRuntime } = await getModules();
      expect(llmRuntime.getEffectiveLlmSettings()).toMatchObject({
        llmApiKey: 'runtime-secret',
        llmModel: 'runtime-model',
        llmBaseUrl: 'https://runtime.example.com/v1',
      });
      expect(llmRuntime.getPublicLlmSettings()).toMatchObject({
        hasApiKey: true, apiKeyMasked: '********',
        model: 'runtime-model', baseUrl: 'https://runtime.example.com/v1',
        hasOverrides: true, baseUrlSource: 'runtime', modelSource: 'runtime', apiKeySource: 'runtime',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  test('keeps the previous runtime api key when apiKeyMode is keep', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structureclaw-llm-settings-'));
    const previous = {
      SCLAW_DATA_DIR: process.env.SCLAW_DATA_DIR,
    };

    process.env.SCLAW_DATA_DIR = tempDir;

    const settingsPath = path.join(tempDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      llm: { apiKey: 'runtime-secret', model: 'runtime-model', baseUrl: 'https://runtime.example.com/v1' },
    }));

    try {
      const { llmRuntime } = await getModules();
      llmRuntime.updateRuntimeLlmSettings({
        baseUrl: 'https://updated.example.com/v1',
        model: 'updated-model',
        apiKeyMode: 'keep',
      });

      const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(stored.llm).toMatchObject({
        apiKey: 'runtime-secret', model: 'updated-model', baseUrl: 'https://updated.example.com/v1',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  test('removes runtime api key when apiKeyMode is inherit and reports unset', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structureclaw-llm-settings-'));
    const previous = {
      SCLAW_DATA_DIR: process.env.SCLAW_DATA_DIR,
    };

    process.env.SCLAW_DATA_DIR = tempDir;

    const settingsPath = path.join(tempDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      llm: { apiKey: 'runtime-secret', model: 'runtime-model', baseUrl: 'https://runtime.example.com/v1' },
    }));

    try {
      const { llmRuntime } = await getModules();
      llmRuntime.updateRuntimeLlmSettings({
        baseUrl: 'https://runtime.example.com/v1', model: 'runtime-model', apiKeyMode: 'inherit',
      });

      const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(stored.llm).toMatchObject({ model: 'runtime-model', baseUrl: 'https://runtime.example.com/v1' });
      expect(stored.llm).not.toHaveProperty('apiKey');
      // After removing the API key, it's unset (no env fallback)
      expect(llmRuntime.getEffectiveLlmSettings()).toMatchObject({
        llmApiKey: '', llmModel: 'runtime-model', llmBaseUrl: 'https://runtime.example.com/v1',
      });
      expect(llmRuntime.getPublicLlmSettings()).toMatchObject({
        hasApiKey: false, apiKeySource: 'unset',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  test('returns default values when all overrides are removed', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structureclaw-llm-settings-'));
    const previous = {
      SCLAW_DATA_DIR: process.env.SCLAW_DATA_DIR,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
    };

    // Ensure env vars are cleared so defaults apply
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
    process.env.SCLAW_DATA_DIR = tempDir;

    const settingsPath = path.join(tempDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      llm: { apiKey: 'runtime-secret', model: 'runtime-model', baseUrl: 'https://runtime.example.com/v1' },
    }));

    try {
      const { llmRuntime } = await getModules();
      llmRuntime.clearRuntimeLlmSettings();
      // After clearing, the settings file may be deleted or have empty llm section
      expect(llmRuntime.getPublicLlmSettings()).toMatchObject({
        baseUrl: 'https://api.openai.com/v1', model: 'gpt-4-turbo-preview',
        hasApiKey: false, apiKeySource: 'unset', hasOverrides: false,
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  test('env vars are used as fallback when no settings.json overrides', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structureclaw-llm-settings-'));
    const previous = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      SCLAW_DATA_DIR: process.env.SCLAW_DATA_DIR,
    };

    // Set env vars that should be used as fallback
    process.env.LLM_API_KEY = 'env-secret';
    process.env.LLM_MODEL = 'env-model';
    process.env.LLM_BASE_URL = 'https://env-fallback.example.com/v1';
    process.env.SCLAW_DATA_DIR = tempDir;

    // No settings.json — env vars provide fallback
    try {
      const { llmRuntime } = await getModules();
      expect(llmRuntime.getEffectiveLlmSettings()).toMatchObject({
        llmApiKey: '',
        llmModel: 'env-model',
        llmBaseUrl: 'https://env-fallback.example.com/v1',
      });
      expect(llmRuntime.getPublicLlmSettings()).toMatchObject({
        baseUrl: 'https://env-fallback.example.com/v1',
        model: 'env-model',
        hasApiKey: false,
        apiKeySource: 'unset',
        hasOverrides: false,
        baseUrlSource: 'default',
        modelSource: 'default',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
