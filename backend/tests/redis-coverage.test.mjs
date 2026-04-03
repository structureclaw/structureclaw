import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';

/**
 * redis.ts tests
 *
 * The redis module creates a Redis client at module-load time based on
 * config.redisUrl. When redisUrl is empty (the default), it falls back to
 * an in-memory Map cache. We test the memory-only path by importing the
 * module as-is (the test environment has no Redis URL configured).
 *
 * Because the memory cache is module-scoped, each test must be careful about
 * key collisions. We use unique key prefixes per test.
 */

// ---------------------------------------------------------------------------
// Module import stability
// ---------------------------------------------------------------------------

describe('redis module', () => {
  test('should import without error', async () => {
    const mod = await import('../dist/utils/redis.js');
    expect(mod).toBeDefined();
  });

  test('should export redis object with expected methods', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    expect(typeof redis.get).toBe('function');
    expect(typeof redis.setex).toBe('function');
    expect(typeof redis.del).toBe('function');
    expect(typeof redis.ping).toBe('function');
    expect(typeof redis.quit).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// In-memory cache operations (no Redis URL configured)
// ---------------------------------------------------------------------------

describe('redis in-memory cache: get / setex', () => {
  test('should return null for a key that was never set', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const result = await redis.get(`test-nonexistent-${Date.now()}`);
    expect(result).toBeNull();
  });

  test('should store and retrieve a value', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-setget-${Date.now()}`;
    const value = 'hello-world';

    const setResult = await redis.setex(key, 60, value);
    expect(setResult).toBe('OK');

    const getResult = await redis.get(key);
    expect(getResult).toBe(value);
  });

  test('should return null for an expired key', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-expire-${Date.now()}`;

    // Set with a very short TTL (1 second)
    await redis.setex(key, 1, 'short-lived');

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = await redis.get(key);
    expect(result).toBeNull();
  });

  test('should store empty string value', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-empty-${Date.now()}`;

    await redis.setex(key, 60, '');
    const result = await redis.get(key);
    expect(result).toBe('');
  });

  test('should overwrite an existing key', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-overwrite-${Date.now()}`;

    await redis.setex(key, 60, 'first');
    await redis.setex(key, 60, 'second');

    const result = await redis.get(key);
    expect(result).toBe('second');
  });

  test('should store JSON string values', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-json-${Date.now()}`;
    const value = JSON.stringify({ foo: 'bar', count: 42 });

    await redis.setex(key, 60, value);
    const result = await redis.get(key);
    expect(JSON.parse(result)).toEqual({ foo: 'bar', count: 42 });
  });

  test('should handle Unicode and special characters', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-unicode-${Date.now()}`;
    const value = '\u8BBE\u8BA1\u7ED3\u6784 \u2714\uFE0F special: <>&"\'';

    await redis.setex(key, 60, value);
    const result = await redis.get(key);
    expect(result).toBe(value);
  });

  test('should handle long values', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-long-${Date.now()}`;
    const value = 'X'.repeat(100000);

    await redis.setex(key, 60, value);
    const result = await redis.get(key);
    expect(result).toBe(value);
    expect(result.length).toBe(100000);
  });
});

// ---------------------------------------------------------------------------
// del operation
// ---------------------------------------------------------------------------

describe('redis in-memory cache: del', () => {
  test('should delete a key and return 1', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-del-${Date.now()}`;

    await redis.setex(key, 60, 'to-be-deleted');
    const delResult = await redis.del(key);
    expect(delResult).toBe(1);

    const getResult = await redis.get(key);
    expect(getResult).toBeNull();
  });

  test('should return 1 when deleting a non-existent key', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-delnonexist-${Date.now()}`;
    const delResult = await redis.del(key);
    expect(delResult).toBe(1);
  });

  test('should allow re-setting a key after deletion', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-redel-${Date.now()}`;

    await redis.setex(key, 60, 'first');
    await redis.del(key);
    await redis.setex(key, 60, 'second');

    const result = await redis.get(key);
    expect(result).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// ping operation
// ---------------------------------------------------------------------------

describe('redis ping', () => {
  test('should return PONG', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const result = await redis.ping();
    expect(result).toBe('PONG');
  });
});

// ---------------------------------------------------------------------------
// quit operation
// ---------------------------------------------------------------------------

describe('redis quit', () => {
  test('should resolve without error when no Redis client is configured', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    await expect(redis.quit()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TTL expiry edge cases
// ---------------------------------------------------------------------------

describe('redis TTL edge cases', () => {
  test('should correctly compute expiry from ttlSeconds', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-ttl-${Date.now()}`;

    // 2-second TTL
    await redis.setex(key, 2, 'ttl-test');

    // Should still be present after 1 second
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await redis.get(key)).toBe('ttl-test');

    // Should be gone after 2.5 seconds
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(await redis.get(key)).toBeNull();
  });

  test('should handle zero TTL (immediate expiry)', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-zttl-${Date.now()}`;

    await redis.setex(key, 0, 'instant');

    // TTL of 0 means it expires at Date.now() + 0 = already expired
    const result = await redis.get(key);
    // Because memoryGet checks Date.now() >= entry.expiresAt, and the
    // timestamp is now or in the past, this should return null.
    expect(result).toBeNull();
  });

  test('should handle large TTL values', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const key = `test-largettl-${Date.now()}`;

    // 30 days in seconds (similar to production TTL)
    await redis.setex(key, 2592000, 'long-lived');
    const result = await redis.get(key);
    expect(result).toBe('long-lived');
  });
});

// ---------------------------------------------------------------------------
// Multiple keys independence
// ---------------------------------------------------------------------------

describe('redis multiple keys', () => {
  test('should handle multiple independent keys', async () => {
    const { redis } = await import('../dist/utils/redis.js');
    const prefix = `test-multi-${Date.now()}-`;

    await redis.setex(`${prefix}a`, 60, 'alpha');
    await redis.setex(`${prefix}b`, 60, 'beta');
    await redis.setex(`${prefix}c`, 60, 'gamma');

    expect(await redis.get(`${prefix}a`)).toBe('alpha');
    expect(await redis.get(`${prefix}b`)).toBe('beta');
    expect(await redis.get(`${prefix}c`)).toBe('gamma');

    await redis.del(`${prefix}b`);

    expect(await redis.get(`${prefix}a`)).toBe('alpha');
    expect(await redis.get(`${prefix}b`)).toBeNull();
    expect(await redis.get(`${prefix}c`)).toBe('gamma');
  });
});
