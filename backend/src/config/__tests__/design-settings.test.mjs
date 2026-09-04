import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';

// Isolate the settings file so host machines with a real design section
// cannot influence these tests.
const previousDataDir = process.env.SCLAW_DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-design-settings-'));
process.env.SCLAW_DATA_DIR = tempDir;

const DESIGN_ENV_VARS = [
  'DESIGN_MAX_ITERATIONS',
  'DESIGN_AI_STRUCTURE_ENABLED',
  'DESIGN_AI_STRUCTURE_BASE_URL',
  'DESIGN_AI_STRUCTURE_API_KEY',
  'DESIGN_AI_STRUCTURE_ENDPOINT_PATH',
  'DESIGN_AI_STRUCTURE_TIMEOUT_MS',
  'DESIGN_AI_STRUCTURE_MAX_RETRIES',
  'DESIGN_AI_STRUCTURE_ESTIMATED_COST_PER_CALL',
];
const previousEnv = Object.fromEntries(DESIGN_ENV_VARS.map((name) => [name, process.env[name]]));
for (const name of DESIGN_ENV_VARS) delete process.env[name];

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.SCLAW_DATA_DIR;
  else process.env.SCLAW_DATA_DIR = previousDataDir;
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeSettings(content) {
  fs.writeFileSync(path.join(tempDir, 'settings.json'), content, 'utf8');
}

describe('design settings resolution', () => {
  test('falls back to documented defaults (service disabled)', async () => {
    const { resolveDesignSettings } = await import('../../../dist/config/design-settings.js');
    const settings = resolveDesignSettings();
    expect(settings.maxIterations).toBe(10);
    expect(settings.aiStructure.enabled).toBe(false);
    expect(settings.aiStructure.baseUrl).toBe('https://ai-structure.com');
    expect(settings.aiStructure.endpointPath).toBe('/api/v1/design/optimize');
    expect(settings.aiStructure.timeoutMs).toBe(30000);
    expect(settings.aiStructure.maxRetries).toBe(2);
    expect(settings.aiStructure.apiKey).toBeUndefined();
  });

  test('DESIGN_* environment variables override defaults', async () => {
    process.env.DESIGN_MAX_ITERATIONS = '5';
    process.env.DESIGN_AI_STRUCTURE_ENABLED = 'true';
    process.env.DESIGN_AI_STRUCTURE_BASE_URL = 'https://mirror.example.com/';
    process.env.DESIGN_AI_STRUCTURE_API_KEY = 'env-key';
    process.env.DESIGN_AI_STRUCTURE_ENDPOINT_PATH = 'design/optimize';
    try {
      const { resolveDesignSettings } = await import('../../../dist/config/design-settings.js');
      const settings = resolveDesignSettings();
      expect(settings.maxIterations).toBe(5);
      expect(settings.aiStructure.enabled).toBe(true);
      // trailing slash stripped, endpoint path normalized to start with '/'
      expect(settings.aiStructure.baseUrl).toBe('https://mirror.example.com');
      expect(settings.aiStructure.endpointPath).toBe('/design/optimize');
      expect(settings.aiStructure.apiKey).toBe('env-key');
    } finally {
      for (const name of DESIGN_ENV_VARS) delete process.env[name];
    }
  });

  test('settings.json overrides environment variables', async () => {
    process.env.DESIGN_AI_STRUCTURE_ENABLED = 'true';
    process.env.DESIGN_AI_STRUCTURE_BASE_URL = 'https://env.example.com';
    writeSettings(`{
      "design": {
        "maxIterations": 7,
        "aiStructure": {
          "enabled": false,
          "baseUrl": "https://file.example.com",
          "apiKey": "file-key",
          "timeoutMs": 45000,
          "estimatedCostPerCall": 0.2
        }
      }
    }`);
    try {
      const { resolveDesignSettings } = await import('../../../dist/config/design-settings.js');
      const settings = resolveDesignSettings();
      expect(settings.maxIterations).toBe(7);
      expect(settings.aiStructure.enabled).toBe(false);
      expect(settings.aiStructure.baseUrl).toBe('https://file.example.com');
      expect(settings.aiStructure.apiKey).toBe('file-key');
      expect(settings.aiStructure.timeoutMs).toBe(45000);
      expect(settings.aiStructure.estimatedCostPerCall).toBe(0.2);
    } finally {
      delete process.env.DESIGN_AI_STRUCTURE_ENABLED;
      delete process.env.DESIGN_AI_STRUCTURE_BASE_URL;
      fs.rmSync(path.join(tempDir, 'settings.json'), { force: true });
    }
  });

  test('invalid values fall back to safe defaults', async () => {
    writeSettings(`{ "design": { "maxIterations": 0, "aiStructure": { "timeoutMs": -5, "maxRetries": 1.9 } } }`);
    try {
      const { resolveDesignSettings } = await import('../../../dist/config/design-settings.js');
      const settings = resolveDesignSettings();
      expect(settings.maxIterations).toBe(10); // 0 → floor clamps to default
      expect(settings.aiStructure.timeoutMs).toBe(30000);
      expect(settings.aiStructure.maxRetries).toBe(1);
    } finally {
      fs.rmSync(path.join(tempDir, 'settings.json'), { force: true });
    }
  });
});
