import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';

const llmSettingsModuleUrl = new URL('../dist/config/llm-runtime.js', import.meta.url).href;

async function importLlmRuntimeFresh() {
  return import(`${llmSettingsModuleUrl}?ts=${Date.now()}-${Math.random()}`);
}

describe('backend runtime llm settings', () => {
  test('uses runtime settings ahead of env defaults and reports runtime sources in public output', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structureclaw-llm-settings-'));
    const settingsPath = path.join(tempDir, 'llm-settings.json');
    const previous = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_SETTINGS_PATH: process.env.LLM_SETTINGS_PATH,
    };

    process.env.LLM_API_KEY = 'env-secret';
    process.env.LLM_MODEL = 'env-model';
    process.env.LLM_BASE_URL = 'https://env.example.com/v1';
    process.env.LLM_SETTINGS_PATH = settingsPath;

    fs.writeFileSync(settingsPath, JSON.stringify({
      apiKey: 'runtime-secret',
      model: 'runtime-model',
      baseUrl: 'https://runtime.example.com/v1',
    }));

    try {
      const {
        getEffectiveLlmSettings,
        getPublicLlmSettings,
      } = await importLlmRuntimeFresh();

      expect(getEffectiveLlmSettings()).toMatchObject({
        llmApiKey: 'runtime-secret',
        llmModel: 'runtime-model',
        llmBaseUrl: 'https://runtime.example.com/v1',
      });
      expect(getPublicLlmSettings()).toMatchObject({
        hasApiKey: true,
        apiKeyMasked: '********',
        model: 'runtime-model',
        baseUrl: 'https://runtime.example.com/v1',
        hasOverrides: true,
        baseUrlSource: 'runtime',
        modelSource: 'runtime',
        apiKeySource: 'runtime',
      });
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

  test('keeps the previous runtime api key when apiKeyMode is keep', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structureclaw-llm-settings-'));
    const settingsPath = path.join(tempDir, 'llm-settings.json');
    const previous = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_SETTINGS_PATH: process.env.LLM_SETTINGS_PATH,
    };

    process.env.LLM_API_KEY = '';
    process.env.LLM_MODEL = 'env-model';
    process.env.LLM_BASE_URL = 'https://env.example.com/v1';
    process.env.LLM_SETTINGS_PATH = settingsPath;

    fs.writeFileSync(settingsPath, JSON.stringify({
      apiKey: 'runtime-secret',
      model: 'runtime-model',
      baseUrl: 'https://runtime.example.com/v1',
    }));

    try {
      const {
        updateRuntimeLlmSettings,
      } = await importLlmRuntimeFresh();

      updateRuntimeLlmSettings({
        baseUrl: 'https://updated.example.com/v1',
        model: 'updated-model',
        apiKeyMode: 'keep',
      });

      expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toMatchObject({
        apiKey: 'runtime-secret',
        model: 'updated-model',
        baseUrl: 'https://updated.example.com/v1',
      });
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

  test('falls back to the env api key when runtime token override is removed', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structureclaw-llm-settings-'));
    const settingsPath = path.join(tempDir, 'llm-settings.json');
    const previous = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_SETTINGS_PATH: process.env.LLM_SETTINGS_PATH,
    };

    process.env.LLM_API_KEY = 'env-secret';
    process.env.LLM_MODEL = 'env-model';
    process.env.LLM_BASE_URL = 'https://env.example.com/v1';
    process.env.LLM_SETTINGS_PATH = settingsPath;

    fs.writeFileSync(settingsPath, JSON.stringify({
      apiKey: 'runtime-secret',
      model: 'runtime-model',
      baseUrl: 'https://runtime.example.com/v1',
    }));

    try {
      const {
        getEffectiveLlmSettings,
        getPublicLlmSettings,
        updateRuntimeLlmSettings,
      } = await importLlmRuntimeFresh();

      updateRuntimeLlmSettings({
        baseUrl: 'https://runtime.example.com/v1',
        model: 'runtime-model',
        apiKeyMode: 'inherit',
      });

      const storedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(storedSettings).toMatchObject({
        model: 'runtime-model',
        baseUrl: 'https://runtime.example.com/v1',
      });
      expect(storedSettings).not.toHaveProperty('apiKey');
      expect(getEffectiveLlmSettings()).toMatchObject({
        llmApiKey: 'env-secret',
        llmModel: 'runtime-model',
        llmBaseUrl: 'https://runtime.example.com/v1',
      });
      expect(getPublicLlmSettings()).toMatchObject({
        hasApiKey: true,
        apiKeyMasked: '********',
        apiKeySource: 'env',
      });
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

  test('deletes the runtime settings file when all overrides are removed', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structureclaw-llm-settings-'));
    const settingsPath = path.join(tempDir, 'llm-settings.json');
    const previous = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_SETTINGS_PATH: process.env.LLM_SETTINGS_PATH,
    };

    process.env.LLM_API_KEY = 'env-secret';
    process.env.LLM_MODEL = 'env-model';
    process.env.LLM_BASE_URL = 'https://env.example.com/v1';
    process.env.LLM_SETTINGS_PATH = settingsPath;

    fs.writeFileSync(settingsPath, JSON.stringify({
      apiKey: 'runtime-secret',
      model: 'runtime-model',
      baseUrl: 'https://runtime.example.com/v1',
    }));

    try {
      const {
        clearRuntimeLlmSettings,
        getPublicLlmSettings,
      } = await importLlmRuntimeFresh();

      clearRuntimeLlmSettings();

      expect(fs.existsSync(settingsPath)).toBe(false);
      expect(getPublicLlmSettings()).toMatchObject({
        baseUrl: 'https://env.example.com/v1',
        model: 'env-model',
        hasApiKey: true,
        apiKeySource: 'env',
        hasOverrides: false,
      });
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
