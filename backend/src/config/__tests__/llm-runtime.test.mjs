import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';

async function withTempRuntime(settingsText, callback) {
  const previousDataDir = process.env.SCLAW_DATA_DIR;
  const previousApiKey = process.env.LLM_API_KEY;
  const previousModel = process.env.LLM_MODEL;
  const previousBaseUrl = process.env.LLM_BASE_URL;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-llm-runtime-'));
  process.env.SCLAW_DATA_DIR = tempDir;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_BASE_URL;
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
});
