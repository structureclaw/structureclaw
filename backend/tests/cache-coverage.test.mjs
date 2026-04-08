import { describe, expect, test } from '@jest/globals';
import { config } from '../dist/config/index.js';

/**
 * cache.ts tests
 *
 * The cache module is a process-local TTL store used for lightweight model
 * caching and agent interaction sessions. It must not depend on Redis or any
 * external service configuration.
 */

describe('cache module', () => {
  test('should not expose redis configuration', () => {
    expect('redisUrl' in config).toBe(false);
  });

  test('should import without error', async () => {
    const mod = await import('../dist/utils/cache.js');
    expect(mod).toBeDefined();
  });

  test('should export cache object with expected methods', async () => {
    const { cache } = await import('../dist/utils/cache.js');
    expect(typeof cache.get).toBe('function');
    expect(typeof cache.setex).toBe('function');
    expect(typeof cache.del).toBe('function');
    expect(typeof cache.ping).toBe('function');
    expect(typeof cache.quit).toBe('function');
  });
});

describe('cache in-memory store: get / setex', () => {
  test('should return null for a key that was never set', async () => {
    const { cache } = await import('../dist/utils/cache.js');
    const result = await cache.get(`test-nonexistent-${Date.now()}`);
    expect(result).toBeNull();
  });

  test('should store and retrieve a value', async () => {
    const { cache } = await import('../dist/utils/cache.js');
    const key = `test-setget-${Date.now()}`;
    const value = 'hello-world';

    const setResult = await cache.setex(key, 60, value);
    expect(setResult).toBe('OK');

    const getResult = await cache.get(key);
    expect(getResult).toBe(value);
  });

  test('should return null for an expired key', async () => {
    const { cache } = await import('../dist/utils/cache.js');
    const key = `test-expire-${Date.now()}`;

    await cache.setex(key, 1, 'short-lived');
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = await cache.get(key);
    expect(result).toBeNull();
  });

  test('should overwrite an existing key', async () => {
    const { cache } = await import('../dist/utils/cache.js');
    const key = `test-overwrite-${Date.now()}`;

    await cache.setex(key, 60, 'first');
    await cache.setex(key, 60, 'second');

    const result = await cache.get(key);
    expect(result).toBe('second');
  });
});

describe('cache in-memory store: del', () => {
  test('should delete a key and return 1', async () => {
    const { cache } = await import('../dist/utils/cache.js');
    const key = `test-del-${Date.now()}`;

    await cache.setex(key, 60, 'to-be-deleted');
    const delResult = await cache.del(key);
    expect(delResult).toBe(1);

    const getResult = await cache.get(key);
    expect(getResult).toBeNull();
  });
});

describe('cache utility no-op lifecycle methods', () => {
  test('should return PONG from ping', async () => {
    const { cache } = await import('../dist/utils/cache.js');
    const result = await cache.ping();
    expect(result).toBe('PONG');
  });

  test('should resolve without error from quit', async () => {
    const { cache } = await import('../dist/utils/cache.js');
    await expect(cache.quit()).resolves.toBeUndefined();
  });
});
