import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';

async function withTempRuntime(settingsText, callback) {
  const previousDataDir = process.env.SCLAW_DATA_DIR;
  const previousApiKey = process.env.LLM_API_KEY;
  const previousModel = process.env.LLM_MODEL;
  const previousBaseUrl = process.env.LLM_BASE_URL;
  const previousVisionApiKey = process.env.LLM_VISION_API_KEY;
  const previousVisionModel = process.env.LLM_VISION_MODEL;
  const previousVisionBaseUrl = process.env.LLM_VISION_BASE_URL;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-llm-runtime-'));
  process.env.SCLAW_DATA_DIR = tempDir;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_VISION_API_KEY;
  delete process.env.LLM_VISION_MODEL;
  delete process.env.LLM_VISION_BASE_URL;
  if (settingsText !== undefined) {
    fs.writeFileSync(path.join(tempDir, 'settings.json'), settingsText, 'utf8');
  }

  try {
    await callback(tempDir);
  } finally {
    if (previousDataDir === undefined) delete process.env.SCLAW_DATA_DIR;
    else process.env.SCLAW_DATA_DIR = previousDataDir;
    if (previousApiKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousApiKey;
    if (previousModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = previousModel;
    if (previousBaseUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = previousBaseUrl;
    if (previousVisionApiKey === undefined) delete process.env.LLM_VISION_API_KEY;
    else process.env.LLM_VISION_API_KEY = previousVisionApiKey;
    if (previousVisionModel === undefined) delete process.env.LLM_VISION_MODEL;
    else process.env.LLM_VISION_MODEL = previousVisionModel;
    if (previousVisionBaseUrl === undefined) delete process.env.LLM_VISION_BASE_URL;
    else process.env.LLM_VISION_BASE_URL = previousVisionBaseUrl;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('LLM runtime settings', () => {
  test('reports env token source separately from saved settings token', async () => {
    await withTempRuntime(`{
      "llm": {
        "baseUrl": "https://example.com/v1",
        "model": "test-model"
      }
    }`, async () => {
      process.env.LLM_API_KEY = 'env-token';
      const { getPublicLlmSettings } = await import('../../../dist/config/llm-runtime.js');

      const settings = getPublicLlmSettings();

      expect(settings.hasApiKey).toBe(true);
      expect(settings.apiKeySource).toBe('env');
      expect(settings.hasOverrides).toBe(true);
    });
  });

  test('replace token writes apiKey while preserving other settings sections', async () => {
    await withTempRuntime(`{
      "server": { "port": 31415 },
      // old provider note
      "llm": {
        "baseUrl": "https://old.example.com/v1",
        "model": "old-model"
      },
      "yjk": {
        "installRoot": "C:/YJKS/YJKS_8_0_0"
      }
    }`, async (tempDir) => {
      const { updateRuntimeLlmSettings } = await import('../../../dist/config/llm-runtime.js');

      updateRuntimeLlmSettings({
        baseUrl: 'https://new.example.com/v1',
        model: 'new-model',
        apiKeyMode: 'replace',
        apiKey: 'saved-token',
      });

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir, 'settings.json'), 'utf8'));
      expect(saved.server.port).toBe(31415);
      expect(saved.yjk.installRoot).toBe('C:/YJKS/YJKS_8_0_0');
      expect(saved.llm).toMatchObject({
        baseUrl: 'https://new.example.com/v1',
        model: 'new-model',
        apiKey: 'saved-token',
      });
    });
  });

  test('requires an explicit vision model before creating vision settings', async () => {
    await withTempRuntime(`{
      "llm": {
        "baseUrl": "https://text.example.com/v1",
        "model": "glm-5-turbo",
        "apiKey": "text-token"
      }
    }`, async () => {
      const { getEffectiveVisionLlmSettings, getPublicVisionLlmSettings } = await import('../../../dist/config/llm-runtime.js');

      expect(getEffectiveVisionLlmSettings()).toBeNull();
      const settings = getPublicVisionLlmSettings();
      expect(settings.model).toBe('');
      expect(settings.hasApiKey).toBe(true);
      expect(settings.apiKeySource).toBe('llm');
    });
  });

  test('uses independent vision model with inherited token and base URL', async () => {
    await withTempRuntime(`{
      "llm": {
        "baseUrl": "https://text.example.com/v1",
        "model": "glm-5-turbo",
        "apiKey": "text-token"
      },
      "vision": {
        "model": "glm-4.5v"
      }
    }`, async () => {
      const { getEffectiveVisionLlmSettings, getPublicVisionLlmSettings } = await import('../../../dist/config/llm-runtime.js');

      const effective = getEffectiveVisionLlmSettings();
      expect(effective).toMatchObject({
        llmApiKey: 'text-token',
        llmModel: 'glm-4.5v',
        llmBaseUrl: 'https://text.example.com/v1',
      });
      const settings = getPublicVisionLlmSettings();
      expect(settings.modelSource).toBe('runtime');
      expect(settings.baseUrlSource).toBe('llm');
      expect(settings.apiKeySource).toBe('llm');
    });
  });

  test('updates vision model without requiring a separate base URL or token', async () => {
    await withTempRuntime(`{
      "server": { "port": 31415 },
      "llm": {
        "baseUrl": "https://text.example.com/v1",
        "model": "glm-5-turbo",
        "apiKey": "text-token"
      }
    }`, async (tempDir) => {
      const { updateRuntimeVisionLlmSettings, getEffectiveVisionLlmSettings } = await import('../../../dist/config/llm-runtime.js');

      updateRuntimeVisionLlmSettings({
        model: 'glm-4.5v',
        apiKeyMode: 'keep',
      });

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir, 'settings.json'), 'utf8'));
      expect(saved.server.port).toBe(31415);
      expect(saved.vision).toEqual({ model: 'glm-4.5v' });
      expect(getEffectiveVisionLlmSettings()).toMatchObject({
        llmApiKey: 'text-token',
        llmBaseUrl: 'https://text.example.com/v1',
        llmModel: 'glm-4.5v',
      });
    });
  });

  test('clears dedicated vision base URL back to inherited LLM settings', async () => {
    await withTempRuntime(`{
      "llm": {
        "baseUrl": "https://text.example.com/v1",
        "model": "glm-5-turbo",
        "apiKey": "text-token"
      },
      "vision": {
        "baseUrl": "https://vision.example.com/v1",
        "model": "glm-4.5v"
      }
    }`, async (tempDir) => {
      const { updateRuntimeVisionLlmSettings, getEffectiveVisionLlmSettings } = await import('../../../dist/config/llm-runtime.js');

      updateRuntimeVisionLlmSettings({
        baseUrl: '',
        model: 'glm-4.5v',
        apiKeyMode: 'keep',
      });

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir, 'settings.json'), 'utf8'));
      expect(saved.vision).toEqual({ model: 'glm-4.5v' });
      expect(getEffectiveVisionLlmSettings()).toMatchObject({
        llmBaseUrl: 'https://text.example.com/v1',
        llmModel: 'glm-4.5v',
      });
    });
  });
});
