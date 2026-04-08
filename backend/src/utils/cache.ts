type CacheEntry = {
  value: string;
  expiresAt: number;
};

const memoryCache = new Map<string, CacheEntry>();

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
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
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
    memoryCache.delete(key);
    return 1;
  },

  async ping(): Promise<'PONG'> {
    return 'PONG';
  },

  async quit(): Promise<void> {
  },
};
