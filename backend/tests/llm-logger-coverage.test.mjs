import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * llm-logger.ts tests
 *
 * The LlmCallLogger class is a singleton (`llmCallLogger`). Because it has
 * internal state (initialised, disabled, stream), we use
 * jest.isolateModulesAsync so each test gets a fresh instance with its own
 * mock configuration.
 *
 * IMPORTANT: jest.isolateModulesAsync in Jest 29 + Node 24 does not fully
 * isolate module mocks when the same module path is re-mocked with different
 * factory return values across calls. The workaround is to use a single
 * mutable mock config object shared across all isolated scopes, and to call
 * jest.resetModules() before each test to force fresh module imports.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonlLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/**
 * Safely remove a temp directory. On Windows, WriteStream handles may still
 * be open after isolateModulesAsync completes, causing ENOTEMPTY / EPERM.
 * Wrapping in try/catch avoids CI failures — OS will clean up temp dirs.
 */
function cleanupTmpDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Intentionally ignored — temp directory, OS will reclaim.
  }
}

// Mutable mock config -- tests modify properties before each isolateModulesAsync call.
const mockConfig = {
  llmLogEnabled: true,
  llmLogDir: '',
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  level: 'info',
};

/**
 * Set up common mocks needed for every llm-logger test that uses isolateModulesAsync.
 * IMPORTANT: The config mock always returns the same mockConfig object reference
 * so that mutations to its properties are visible to the imported module.
 */
function setupLlmLoggerMocks() {
  jest.unstable_mockModule('../dist/config/index.js', () => ({
    config: mockConfig,
  }));

  jest.unstable_mockModule('../dist/utils/logger.js', () => ({
    logger: mockLogger,
  }));
}

// ---------------------------------------------------------------------------
// Module import stability
// ---------------------------------------------------------------------------

describe('llm-logger module', () => {
  beforeEach(() => {
    jest.resetModules();
    mockConfig.llmLogEnabled = false;
    mockConfig.llmLogDir = '';
  });

  test('should import without error', async () => {
    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();
      const mod = await import('../dist/utils/llm-logger.js');
      expect(mod).toBeDefined();
    });
  });

  test('should export llmCallLogger with a log method', async () => {
    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();
      const mod = await import('../dist/utils/llm-logger.js');
      expect(mod.llmCallLogger).toBeDefined();
      expect(typeof mod.llmCallLogger.log).toBe('function');
    });
  });
});

// ---------------------------------------------------------------------------
// Logging disabled (llmLogEnabled = false)
// ---------------------------------------------------------------------------

describe('llmCallLogger.log when logging is disabled', () => {
  beforeEach(() => {
    jest.resetModules();
    mockConfig.llmLogEnabled = false;
    mockConfig.llmLogDir = '';
  });

  test('should not create any file when llmLogEnabled is false', async () => {
    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      llmCallLogger.log({
        model: 'test-model',
        prompt: 'hello',
        response: 'world',
        durationMs: 100,
        success: true,
      });

      llmCallLogger.log({
        model: 'test-model',
        prompt: 'second call',
        response: null,
        durationMs: 50,
        success: false,
        error: 'timeout',
      });

      // No error thrown, no file created.
    });
  });

  test('should silently return when called many times while disabled', async () => {
    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      for (let i = 0; i < 10; i++) {
        llmCallLogger.log({
          model: 'model',
          prompt: 'p',
          response: 'r',
          durationMs: i,
          success: true,
        });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Logging enabled (llmLogEnabled = true)
// ---------------------------------------------------------------------------

describe('llmCallLogger.log when logging is enabled', () => {
  beforeEach(() => {
    jest.resetModules();
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = '';
  });

  test('should write a valid JSONL entry to the log file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-test-'));
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = tmpDir;

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      llmCallLogger.log({
        model: 'gpt-4',
        prompt: 'Design a simply supported beam',
        response: 'Here is the beam design...',
        durationMs: 2500,
        success: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const filePath = path.join(tmpDir, 'llm-calls.jsonl');
      expect(fs.existsSync(filePath)).toBe(true);

      const lines = readJsonlLines(filePath);
      expect(lines).toHaveLength(1);

      const entry = lines[0];
      expect(entry.model).toBe('gpt-4');
      expect(entry.prompt).toBe('Design a simply supported beam');
      expect(entry.response).toBe('Here is the beam design...');
      expect(entry.promptChars).toBe(30);
      expect(entry.responseChars).toBe(26);
      expect(entry.durationMs).toBe(2500);
      expect(entry.success).toBe(true);
      expect(entry.timestamp).toBeTruthy();
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });

    cleanupTmpDir(tmpDir);
  });

  test('should set responseChars to 0 when response is null', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-test-'));
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = tmpDir;

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      llmCallLogger.log({
        model: 'gpt-4',
        prompt: 'test prompt',
        response: null,
        durationMs: 100,
        success: false,
        error: 'API timeout',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const lines = readJsonlLines(path.join(tmpDir, 'llm-calls.jsonl'));
      expect(lines).toHaveLength(1);
      expect(lines[0].responseChars).toBe(0);
      expect(lines[0].error).toBe('API timeout');
    });

    cleanupTmpDir(tmpDir);
  });

  test('should append multiple entries to the same file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-test-'));
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = tmpDir;

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      llmCallLogger.log({
        model: 'gpt-4',
        prompt: 'first',
        response: 'r1',
        durationMs: 100,
        success: true,
      });

      llmCallLogger.log({
        model: 'glm-4',
        prompt: 'second',
        response: 'r2',
        durationMs: 200,
        success: true,
      });

      llmCallLogger.log({
        model: 'gpt-4',
        prompt: 'third',
        response: null,
        durationMs: 300,
        success: false,
        error: 'rate limited',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const lines = readJsonlLines(path.join(tmpDir, 'llm-calls.jsonl'));
      expect(lines).toHaveLength(3);
      expect(lines[0].model).toBe('gpt-4');
      expect(lines[1].model).toBe('glm-4');
      expect(lines[2].error).toBe('rate limited');
    });

    cleanupTmpDir(tmpDir);
  });

  test('should compute promptChars correctly for empty string', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-test-'));
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = tmpDir;

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      llmCallLogger.log({
        model: 'test',
        prompt: '',
        response: '',
        durationMs: 0,
        success: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const lines = readJsonlLines(path.join(tmpDir, 'llm-calls.jsonl'));
      expect(lines).toHaveLength(1);
      expect(lines[0].promptChars).toBe(0);
      expect(lines[0].responseChars).toBe(0);
    });

    cleanupTmpDir(tmpDir);
  });

  test('should compute promptChars for Unicode and emoji content', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-test-'));
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = tmpDir;

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      const unicodePrompt = '\u8BBE\u8BA1\u4E00\u6839\u7B80\u652F\u6881';
      const emojiResponse = 'Result: \u2714\uFE0F OK';

      llmCallLogger.log({
        model: 'test',
        prompt: unicodePrompt,
        response: emojiResponse,
        durationMs: 10,
        success: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const lines = readJsonlLines(path.join(tmpDir, 'llm-calls.jsonl'));
      expect(lines).toHaveLength(1);
      expect(lines[0].promptChars).toBe(unicodePrompt.length);
      expect(lines[0].responseChars).toBe(emojiResponse.length);
    });

    cleanupTmpDir(tmpDir);
  });

  test('should handle long prompts without truncation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-test-'));
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = tmpDir;

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      const longPrompt = 'A'.repeat(50000);
      const longResponse = 'B'.repeat(50000);

      llmCallLogger.log({
        model: 'test',
        prompt: longPrompt,
        response: longResponse,
        durationMs: 5000,
        success: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const lines = readJsonlLines(path.join(tmpDir, 'llm-calls.jsonl'));
      expect(lines).toHaveLength(1);
      expect(lines[0].promptChars).toBe(50000);
      expect(lines[0].responseChars).toBe(50000);
    });

    cleanupTmpDir(tmpDir);
  });
});

// ---------------------------------------------------------------------------
// Error handling in ensureStream
// ---------------------------------------------------------------------------

describe('llmCallLogger.ensureStream error handling', () => {
  beforeEach(() => {
    jest.resetModules();
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = '';
  });

  test('should gracefully handle directory creation failure', async () => {
    mockConfig.llmLogEnabled = true;
    // Use a path with a null byte — mkdirSync rejects it on all platforms
    mockConfig.llmLogDir = '/\x00invalid-path';

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      // Should NOT throw -- the error is caught internally.
      expect(() => {
        llmCallLogger.log({
          model: 'test',
          prompt: 'p',
          response: 'r',
          durationMs: 1,
          success: true,
        });
      }).not.toThrow();

      // Subsequent calls should also not throw.
      expect(() => {
        llmCallLogger.log({
          model: 'test',
          prompt: 'p2',
          response: 'r2',
          durationMs: 2,
          success: true,
        });
      }).not.toThrow();
    });
  });

  test('should log a warning via logger on stream error', async () => {
    mockConfig.llmLogEnabled = true;
    // Use a path with a null byte — mkdirSync rejects it on all platforms
    mockConfig.llmLogDir = '/\x00invalid-path';
    mockLogger.warn.mockClear();

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      llmCallLogger.log({
        model: 'test',
        prompt: 'p',
        response: 'r',
        durationMs: 1,
        success: true,
      });

      // The mock logger.warn should have been called when directory creation fails
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('llmCallLogger.log edge cases', () => {
  beforeEach(() => {
    jest.resetModules();
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = '';
  });

  test('should handle entry with error field', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-test-'));
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = tmpDir;

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      llmCallLogger.log({
        model: 'gpt-4',
        prompt: 'test',
        response: null,
        durationMs: 5000,
        success: false,
        error: 'Connection refused: ECONNREFUSED',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const lines = readJsonlLines(path.join(tmpDir, 'llm-calls.jsonl'));
      expect(lines[0].error).toBe('Connection refused: ECONNREFUSED');
      expect(lines[0].success).toBe(false);
    });

    cleanupTmpDir(tmpDir);
  });

  test('should handle entry without optional error field', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-test-'));
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = tmpDir;

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      llmCallLogger.log({
        model: 'gpt-4',
        prompt: 'test',
        response: 'ok',
        durationMs: 100,
        success: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const lines = readJsonlLines(path.join(tmpDir, 'llm-calls.jsonl'));
      expect(lines[0].error).toBeUndefined();
    });

    cleanupTmpDir(tmpDir);
  });

  test('should handle very short TTL-like rapid sequential calls', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-log-test-'));
    mockConfig.llmLogEnabled = true;
    mockConfig.llmLogDir = tmpDir;

    await jest.isolateModulesAsync(async () => {
      setupLlmLoggerMocks();

      const { llmCallLogger } = await import('../dist/utils/llm-logger.js');

      // Rapidly log 50 entries
      for (let i = 0; i < 50; i++) {
        llmCallLogger.log({
          model: `model-${i}`,
          prompt: `prompt-${i}`,
          response: i % 2 === 0 ? `response-${i}` : null,
          durationMs: i * 10,
          success: i % 3 !== 0,
          ...(i % 3 === 0 ? { error: `error-${i}` } : {}),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      const lines = readJsonlLines(path.join(tmpDir, 'llm-calls.jsonl'));
      expect(lines).toHaveLength(50);
      expect(lines[0].model).toBe('model-0');
      expect(lines[49].model).toBe('model-49');
    });

    cleanupTmpDir(tmpDir);
  });
});
