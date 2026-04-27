import { describe, expect, test, jest, beforeEach } from '@jest/globals';

/**
 * agent-logger.ts provides structured logging helpers for the agent runtime.
 * We test truncate, createAgentLogger, logToolCall, logLlmCall, and getLogger.
 */

// ── Mock pino logger ────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(),
    level: 'info',
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('agent-logger', () => {
  test('truncate returns original string when short enough', async () => {
    const { truncate } = await import('../dist/utils/agent-logger.js');
    expect(truncate('hello', 10)).toBe('hello');
  });

  test('truncate caps and appends truncation marker', async () => {
    const { truncate } = await import('../dist/utils/agent-logger.js');
    const result = truncate('a'.repeat(3000), 2000);
    expect(result.length).toBeLessThan(2050);
    expect(result).toContain('[truncated');
    expect(result.startsWith('a'.repeat(2000))).toBe(true);
  });

  test('truncate uses default maxLen of 2000', async () => {
    const { truncate } = await import('../dist/utils/agent-logger.js');
    const result = truncate('b'.repeat(2500));
    expect(result.length).toBeLessThan(2100);
    expect(result).toContain('[truncated');
  });

  test('createAgentLogger returns child logger with traceId and conversationId', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockChild = createMockLogger();
      const mockRoot = { ...createMockLogger(), child: jest.fn().mockReturnValue(mockChild) };

      jest.unstable_mockModule('../dist/utils/logger.js', () => ({
        logger: mockRoot,
        createChildLogger: jest.fn(),
      }));

      const { createAgentLogger } = await import('../dist/utils/agent-logger.js');
      const result = createAgentLogger('trace-123', 'conv-456');

      expect(mockRoot.child).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: 'trace-123', conversationId: 'conv-456' }),
      );
      expect(result).toBe(mockChild);
    });
  });

  test('getLogger returns child logger from configurable._logger', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockChild = createMockLogger();

      jest.unstable_mockModule('../dist/utils/logger.js', () => ({
        logger: createMockLogger(),
      }));

      const { getLogger } = await import('../dist/utils/agent-logger.js');
      const result = getLogger({ _logger: mockChild });
      expect(result).toBe(mockChild);
    });
  });

  test('getLogger falls back to root logger when _logger is missing', async () => {
    const { getLogger } = await import('../dist/utils/agent-logger.js');
    // When no _logger is provided, should return a logger-like object
    const fallback = getLogger(undefined);
    expect(typeof fallback.info).toBe('function');
    expect(typeof fallback.error).toBe('function');
    expect(typeof fallback.child).toBe('function');

    const fallback2 = getLogger({});
    expect(typeof fallback2.info).toBe('function');

    const fallback3 = getLogger({ _logger: null });
    expect(typeof fallback3.info).toBe('function');
  });
});

describe('logToolCall', () => {
  test('info level logs tool name and duration', async () => {
    const { logToolCall } = await import('../dist/utils/agent-logger.js');
    const mockLog = createMockLogger();

    logToolCall(mockLog, { tool: 'detect_structure_type', durationMs: 150 });

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'detect_structure_type', durationMs: 150 }),
      expect.stringContaining('detect_structure_type'),
    );
    expect(mockLog.debug).not.toHaveBeenCalled();
    expect(mockLog.trace).not.toHaveBeenCalled();
  });

  test('debug level includes truncated input/output', async () => {
    const { logToolCall } = await import('../dist/utils/agent-logger.js');
    const mockLog = createMockLogger();

    logToolCall(mockLog, {
      tool: 'build_model',
      input: { foo: 'bar' },
      output: { result: 'ok' },
      durationMs: 200,
      level: 'debug',
    });

    expect(mockLog.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'build_model',
        durationMs: 200,
        input: expect.any(String),
        output: expect.any(String),
      }),
      expect.any(String),
    );
  });

  test('trace level includes full input/output', async () => {
    const { logToolCall } = await import('../dist/utils/agent-logger.js');
    const mockLog = createMockLogger();

    logToolCall(mockLog, {
      tool: 'run_analysis',
      input: { x: 1 },
      output: { y: 2 },
      durationMs: 300,
      level: 'trace',
    });

    expect(mockLog.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'run_analysis',
        input: expect.any(String),
        output: expect.any(String),
      }),
      expect.any(String),
    );
  });

  test('extra fields are spread into log entry', async () => {
    const { logToolCall } = await import('../dist/utils/agent-logger.js');
    const mockLog = createMockLogger();

    logToolCall(mockLog, {
      tool: 'detect_structure_type',
      durationMs: 100,
      extra: { skillId: 'frame', matchedKey: '框架' },
    });

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: 'frame', matchedKey: '框架' }),
      expect.any(String),
    );
  });
});

describe('logLlmCall', () => {
  test('info level logs model and duration', async () => {
    const { logLlmCall } = await import('../dist/utils/agent-logger.js');
    const mockLog = createMockLogger();

    logLlmCall(mockLog, { model: 'gpt-4o', durationMs: 2500 });

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', durationMs: 2500 }),
      expect.stringContaining('gpt-4o'),
    );
  });

  test('info level includes token counts when provided', async () => {
    const { logLlmCall } = await import('../dist/utils/agent-logger.js');
    const mockLog = createMockLogger();

    logLlmCall(mockLog, {
      model: 'glm-4',
      promptTokens: 500,
      completionTokens: 100,
      durationMs: 1200,
    });

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'glm-4',
        promptTokens: 500,
        completionTokens: 100,
        durationMs: 1200,
      }),
      expect.any(String),
    );
  });

  test('debug level includes truncated request/response', async () => {
    const { logLlmCall } = await import('../dist/utils/agent-logger.js');
    const mockLog = createMockLogger();

    logLlmCall(mockLog, {
      model: 'test',
      durationMs: 50,
      request: 'prompt text',
      response: 'response text',
      level: 'debug',
    });

    expect(mockLog.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.any(String),
        response: expect.any(String),
      }),
      expect.any(String),
    );
  });

  test('trace level includes full request/response', async () => {
    const { logLlmCall } = await import('../dist/utils/agent-logger.js');
    const mockLog = createMockLogger();

    logLlmCall(mockLog, {
      model: 'test',
      durationMs: 50,
      request: { messages: [] },
      response: { content: 'hello' },
      level: 'trace',
    });

    expect(mockLog.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.any(String),
        response: expect.any(String),
      }),
      expect.any(String),
    );
  });
});
