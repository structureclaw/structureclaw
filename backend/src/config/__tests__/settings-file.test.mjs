import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';

function withTempSettingsDir(settingsText, callback) {
  const previousDataDir = process.env.SCLAW_DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-settings-'));
  process.env.SCLAW_DATA_DIR = tempDir;
  fs.writeFileSync(path.join(tempDir, 'settings.json'), settingsText, 'utf8');

  return Promise.resolve()
    .then(() => callback(tempDir))
    .finally(() => {
      if (previousDataDir === undefined) {
        delete process.env.SCLAW_DATA_DIR;
      } else {
        process.env.SCLAW_DATA_DIR = previousDataDir;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

describe('settings file', () => {
  test('reads settings.json with comments without falling back to env settings', async () => {
    await withTempSettingsDir(`{
      "server": { "port": 31415 },
      // Keep an old provider config as a note.
      // "llm": { "model": "glm-5-turbo" },
      "llm": {
        "baseUrl": "https://llmapi.paratera.com",
        /* current provider */
        "model": "DeepSeek-V4-Pro",
        "apiKey": "test-key"
      }
    }`, async () => {
      const { readSettingsFile } = await import('../../../dist/config/settings-file.js');

      const settings = readSettingsFile();

      expect(settings?.llm).toMatchObject({
        baseUrl: 'https://llmapi.paratera.com',
        model: 'DeepSeek-V4-Pro',
        apiKey: 'test-key',
      });
    });
  });

  test('reads independent vision model settings', async () => {
    await withTempSettingsDir(`{
      "llm": {
        "baseUrl": "https://text.example.com/v1",
        "model": "glm-5-turbo",
        "apiKey": "text-key"
      },
      "vision": {
        "baseUrl": "https://vision.example.com/v1",
        "model": "glm-4.5v",
        "apiKey": "vision-key"
      }
    }`, async () => {
      const { readSettingsFile } = await import('../../../dist/config/settings-file.js');

      const settings = readSettingsFile();

      expect(settings?.llm?.model).toBe('glm-5-turbo');
      expect(settings?.vision).toMatchObject({
        baseUrl: 'https://vision.example.com/v1',
        model: 'glm-4.5v',
        apiKey: 'vision-key',
      });
    });
  });

  test('settings-file can be imported before config without a circular init error', async () => {
    await withTempSettingsDir(`{
      "llm": {
        "baseUrl": "https://example.com/v1",
        "model": "test-model",
        "apiKey": "test-key"
      }
    }`, async () => {
      const { readSettingsFile } = await import('../../../dist/config/settings-file.js');
      const { config } = await import('../../../dist/config/index.js');

      expect(readSettingsFile()?.llm?.model).toBe('test-model');
      expect(config.llmModel).toBe('test-model');
    });
  });

  test('throws before update when an existing settings file is malformed', async () => {
    await withTempSettingsDir(`{
      "server": { "port": 31415 },
      "llm":
    }`, async (tempDir) => {
      const { readSettingsFile, readSettingsFileForUpdate } = await import('../../../dist/config/settings-file.js');

      expect(readSettingsFile()).toBeNull();
      let updateError;
      try {
        readSettingsFileForUpdate();
      } catch (error) {
        updateError = error;
      }
      expect(updateError).toBeInstanceOf(Error);
      expect(updateError.message).toMatch(/refusing to overwrite existing settings/);
      expect(updateError.message).not.toContain(tempDir);
    });
  });
});
