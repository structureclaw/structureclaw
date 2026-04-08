type CacheEntry = {
  value: string;
  expiresAt: number;
};

export const MAX_CACHE_ENTRIES = 1024;
export const CACHE_SWEEP_INTERVAL_MS = 60_000;

const memoryCache = new Map<string, CacheEntry>();

function pruneExpiredEntries(now = Date.now()): void {
  for (const [key, entry] of memoryCache.entries()) {
    if (now >= entry.expiresAt) {
      memoryCache.delete(key);
    }
  }
}

function pruneOverflowEntries(): void {
  while (memoryCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    memoryCache.delete(oldestKey);
  }
}

const evictionInterval = setInterval(() => {
  pruneExpiredEntries();
}, CACHE_SWEEP_INTERVAL_MS);

evictionInterval.unref?.();

function memoryGet(key: string): string | null {
  const entry = memoryCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() >= entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function memorySetex(key: string, ttlSeconds: number, value: string): void {
  if (ttlSeconds <= 0) {
    memoryCache.delete(key);
    return;
  }
  pruneExpiredEntries();
  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  }
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  pruneOverflowEntries();
}

export const cache = {
  async get(key: string): Promise<string | null> {
    return memoryGet(key);
  },

  async setex(key: string, ttlSeconds: number, value: string): Promise<'OK'> {
    memorySetex(key, ttlSeconds, value);
    return 'OK';
  },

  async del(key: string): Promise<number> {
    pruneExpiredEntries();
    return memoryCache.delete(key) ? 1 : 0;
  },

  async ping(): Promise<'PONG'> {
    return 'PONG';
  },

  async quit(): Promise<void> {
  },
};

export function getCacheEntryCount(): number {
  return memoryCache.size;
}
