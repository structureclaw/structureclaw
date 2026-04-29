#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendDir, '..');
const prismaDir = path.join(backendDir, 'prisma');
const schemaPath = path.join(prismaDir, 'schema.prisma');
// Canonical data dir: SCLAW_DATA_DIR || ~/.structureclaw (see backend/src/config/index.ts)
const defaultDatabasePath = path.join(os.homedir(), '.structureclaw', 'data', 'structureclaw.db');
const prismaCliPath = path.join(backendDir, 'node_modules', 'prisma', 'build', 'index.js');

function normalizeDatabaseUrl(databaseUrl) {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) {
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
    : path.resolve(prismaDir, location);

  return `file:${normalizedPath}${query}`;
}

function runPrisma(args, databaseUrl) {
  const prismaArgs = args[0] === 'prisma' ? args.slice(1) : args;
  const result = spawnSync(process.execPath, [prismaCliPath, ...prismaArgs], {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    if (result.error) {
      console.error(result.error.message);
    }
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }

  return result.stdout ?? '';
}

const configuredUrl = process.env.DATABASE_URL || `file:${defaultDatabasePath}`;
const databaseUrl = normalizeDatabaseUrl(configuredUrl);

if (!databaseUrl.startsWith('file:')) {
  console.error(`[error] SQLite sync only supports file: DATABASE_URL values. Received: ${databaseUrl}`);
  process.exit(1);
}

const databasePath = databaseUrl.slice('file:'.length).split('?')[0];
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const useExistingDatabase = fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0;
const diffArgs = useExistingDatabase
  ? ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', schemaPath, '--script']
  : ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema', schemaPath, '--script'];

const migrationSql = runPrisma(diffArgs, databaseUrl);
const trimmedSql = migrationSql.trim();

if (!trimmedSql || trimmedSql === '-- This is an empty migration.') {
  console.log(`[ok] SQLite schema already in sync at ${databasePath}`);
  process.exit(0);
}

const tempSqlPath = path.join(os.tmpdir(), `structureclaw-sqlite-sync-${process.pid}.sql`);
fs.writeFileSync(tempSqlPath, migrationSql, 'utf8');

try {
  runPrisma(['prisma', 'db', 'execute', '--file', tempSqlPath], databaseUrl);
} finally {
  fs.rmSync(tempSqlPath, { force: true });
}

console.log(`[ok] SQLite schema synced at ${databasePath}`);
