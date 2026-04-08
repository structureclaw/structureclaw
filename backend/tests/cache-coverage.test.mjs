import { afterEach, describe, expect, jest, test } from '@jest/globals';
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

  test('should evict the oldest entries when the cache exceeds its max size', async () => {
    const { cache, MAX_CACHE_ENTRIES } = await import('../dist/utils/cache.js');
    const prefix = `test-max-size-${Date.now()}-`;

    for (let index = 0; index < MAX_CACHE_ENTRIES + 1; index += 1) {
      await cache.setex(`${prefix}${index}`, 60, `value-${index}`);
    }

    expect(await cache.get(`${prefix}0`)).toBeNull();
    expect(await cache.get(`${prefix}${MAX_CACHE_ENTRIES}`)).toBe(`value-${MAX_CACHE_ENTRIES}`);
  });

  test('should refresh an updated key before applying overflow eviction', async () => {
    jest.resetModules();
    const { cache, MAX_CACHE_ENTRIES } = await import('../dist/utils/cache.js');
    const prefix = `test-refresh-order-${Date.now()}-`;

    for (let index = 0; index < MAX_CACHE_ENTRIES; index += 1) {
      await cache.setex(`${prefix}${index}`, 60, `value-${index}`);
    }

    await cache.setex(`${prefix}0`, 60, 'refreshed');
    await cache.setex(`${prefix}overflow`, 60, 'overflow');

    expect(await cache.get(`${prefix}0`)).toBe('refreshed');
    expect(await cache.get(`${prefix}1`)).toBeNull();
    expect(await cache.get(`${prefix}overflow`)).toBe('overflow');
  });
});

describe('cache in-memory store: background sweep', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('should prune expired entries even if they are never read again', async () => {
    jest.useFakeTimers();
    jest.resetModules();

    const { cache, CACHE_SWEEP_INTERVAL_MS, getCacheEntryCount } = await import('../dist/utils/cache.js');
    const key = `test-sweep-${Date.now()}`;

    await cache.setex(key, 1, 'short-lived');
    expect(getCacheEntryCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(getCacheEntryCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(CACHE_SWEEP_INTERVAL_MS);
    expect(getCacheEntryCount()).toBe(0);
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

  test('should return 0 when deleting a key that does not exist', async () => {
    const { cache } = await import('../dist/utils/cache.js');

    const delResult = await cache.del(`test-del-missing-${Date.now()}`);
    expect(delResult).toBe(0);
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
