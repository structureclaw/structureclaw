import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';

describe('admin database route', () => {
  let app;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:/tmp/structureclaw-admin-route-test.db';
    const { adminDatabaseRoutes } = await import('../dist/api/admin-database.js');
    app = Fastify();
    await app.register(adminDatabaseRoutes);
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    await app.close();
  });

  test('returns sqlite database status metadata', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toEqual(expect.objectContaining({
      enabled: expect.any(Boolean),
      provider: 'sqlite',
      mode: 'local-file',
      database: expect.objectContaining({
        provider: 'sqlite',
        databaseUrl: expect.stringMatching(/^file:/),
        databasePath: expect.any(String),
        directoryPath: expect.any(String),
        exists: expect.any(Boolean),
        writable: expect.any(Boolean),
        sizeBytes: expect.any(Number),
      }),
    }));
  });
});
