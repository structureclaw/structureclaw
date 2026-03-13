import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';

describe('admin database route', () => {
  let app;

  beforeAll(async () => {
    const { adminDatabaseRoutes } = await import('../dist/api/admin-database.js');
    app = Fastify();
    await app.register(adminDatabaseRoutes);
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns pgAdmin metadata without proxying database data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toEqual(expect.objectContaining({
      enabled: expect.any(Boolean),
      provider: 'pgadmin',
      url: expect.any(String),
      database: expect.objectContaining({
        host: expect.any(String),
        port: expect.any(String),
        database: expect.any(String),
      }),
    }));
  });
});
