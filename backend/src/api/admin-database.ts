import { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';

function readDatabaseTarget() {
  try {
    const url = new URL(config.databaseUrl);
    return {
      host: url.hostname || 'localhost',
      port: url.port || '5432',
      database: url.pathname.replace(/^\//, '') || 'structureclaw',
    };
  } catch {
    return {
      host: 'localhost',
      port: '5432',
      database: 'structureclaw',
    };
  }
}

export async function adminDatabaseRoutes(fastify: FastifyInstance) {
  fastify.get('/status', {
    schema: {
      tags: ['Admin'],
      summary: 'Get pgAdmin status metadata',
    },
  }, async () => ({
    enabled: config.pgAdminEnabled,
    provider: 'pgadmin',
    url: config.pgAdminUrl,
    defaultEmail: config.pgAdminDefaultEmail,
    database: readDatabaseTarget(),
  }));
}
