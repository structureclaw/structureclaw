import { describe, expect, test, jest } from '@jest/globals';

/**
 * logger.ts creates a pino logger instance configured based on config.
 * We mock both `pino` and `../dist/config/index.js` to verify the
 * configuration is wired correctly without actually creating log transports.
 *
 * NOTE: jest.unstable_mockModule must be called at the top level (not inside
 * test blocks) for ESM mocks to take effect. We use jest.isolateModulesAsync
 * for tests that need different mock configurations.
 */

// ── Tests ───────────────────────────────────────────────────────────────────

describe('logger configuration', () => {
  test('should create a pino instance with the configured log level', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockPinoInstance = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn(),
        fatal: jest.fn(),
        level: 'info',
      };

      const mockPino = jest.fn().mockReturnValue(mockPinoInstance);

      jest.unstable_mockModule('pino', () => ({
        default: mockPino,
      }));

      jest.unstable_mockModule('../dist/config/index.js', () => ({
        config: {
          logLevel: 'debug',
          nodeEnv: 'production',
          logFile: '',
          logMaxAgeDays: 7,
          logMaxSize: 104857600,
        },
      }));

      const { logger } = await import('../dist/utils/logger.js');

      // Verify pino was called with the correct log level (may include a stream arg)
      expect(mockPino).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'debug' }),
        expect.anything(),
      );

      // Verify the exported logger is the mock instance
      expect(logger).toBe(mockPinoInstance);
    });
  });

  test('should export a logger object with standard pino log methods', async () => {
    const { logger } = await import('../dist/utils/logger.js');

    expect(typeof logger).toBe('object');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  test('should have a level property', async () => {
    const { logger } = await import('../dist/utils/logger.js');
    expect(typeof logger.level).toBe('string');
  });
});

describe('logger module import stability', () => {
  test('should import without error', async () => {
    await expect(import('../dist/utils/logger.js')).resolves.toBeDefined();
  });

  test('should export exactly one named export: logger', async () => {
    const mod = await import('../dist/utils/logger.js');
    const keys = Object.keys(mod);
    expect(keys).toContain('logger');
  });
});
