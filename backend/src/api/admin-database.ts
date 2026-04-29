import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prismaSchemaDir = path.resolve(__dirname, '../../prisma');

function normalizeDatabaseUrl(databaseUrl: string) {
  if (!databaseUrl.startsWith('file:')) {
    return databaseUrl;
  }

  const suffix = databaseUrl.slice('file:'.length);
  const queryIndex = suffix.indexOf('?');
  const location = queryIndex >= 0 ? suffix.slice(0, queryIndex) : suffix;
  const query = queryIndex >= 0 ? suffix.slice(queryIndex) : '';

  if (!location) {
    return databaseUrl;
  }

  const normalizedPath = path.isAbsolute(location)
    ? location
    : path.resolve(prismaSchemaDir, location);

  return `file:${normalizedPath}${query}`;
}

function readDatabaseTarget() {
  const normalizedUrl = normalizeDatabaseUrl(config.databaseUrl);
  if (!normalizedUrl.startsWith('file:')) {
    return {
      provider: 'unknown',
      mode: 'external',
      databaseUrl: normalizedUrl,
      databasePath: '',
      directoryPath: '',
      exists: false,
      writable: false,
      sizeBytes: 0,
    };
  }

  const databasePath = normalizedUrl.slice('file:'.length).split('?')[0];
  const directoryPath = path.dirname(databasePath);
  const exists = fs.existsSync(databasePath);
  const sizeBytes = exists ? fs.statSync(databasePath).size : 0;

  let writable;
  try {
    fs.mkdirSync(directoryPath, { recursive: true });
    fs.accessSync(directoryPath, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }

  return {
    provider: 'sqlite',
    mode: 'local-file',
    databaseUrl: normalizedUrl,
    databasePath,
    directoryPath,
    exists,
    writable,
    sizeBytes,
  };
}

export async function adminDatabaseRoutes(fastify: FastifyInstance) {
  fastify.get('/status', {
    schema: {
      tags: ['Admin'],
      summary: 'Get database status metadata',
    },
  }, async () => {
    const database = readDatabaseTarget();
    return {
      enabled: database.provider === 'sqlite',
      provider: database.provider,
      mode: database.mode,
      database,
    };
  });
}
