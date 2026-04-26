#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { stripLegacyScalarLists } from './postgres-to-sqlite-lib.mjs';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendDir, '..');

function printUsage() {
  console.log(`Usage:
  POSTGRES_SOURCE_DATABASE_URL=postgresql://... ./sclaw db-import-postgres [--force] [--no-backup]

Options:
  --source <url>   Override the PostgreSQL source URL
  --target <url>   Override the SQLite target URL (must use file:)
  --force          Replace existing target data after creating a backup
  --no-backup      Skip backup creation when --force is used
`);
}

function parseArgs(argv) {
  const args = {
    force: false,
    backup: true,
    sourceUrl: process.env.POSTGRES_SOURCE_DATABASE_URL || '',
    targetUrl: process.env.SQLITE_TARGET_DATABASE_URL || process.env.DATABASE_URL || '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') {
      args.force = true;
    } else if (arg === '--no-backup') {
      args.backup = false;
    } else if (arg === '--source') {
      args.sourceUrl = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--target') {
      args.targetUrl = argv[index + 1] || '';
      index += 1;
    } else if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`[error] Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  if (!args.targetUrl) {
    args.targetUrl = `file:${path.join(repoRoot, '.runtime', 'data', 'structureclaw.db')}`;
  }

  return args;
}

function normalizeSqliteUrl(databaseUrl) {
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
    : path.resolve(path.join(backendDir, 'prisma'), location);

  return `file:${normalizedPath}${query}`;
}

function sqlitePathFromUrl(databaseUrl) {
  return databaseUrl.slice('file:'.length).split('?')[0];
}

function runNodeScript(scriptPath, env) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: backendDir,
    env: {
      ...process.env,
      ...env,
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function tableExists(client, tableName) {
  const result = await client.query(
    'select exists(select 1 from information_schema.tables where table_schema = $1 and table_name = $2) as exists',
    ['public', tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function columnExists(client, tableName, columnName) {
  const result = await client.query(
    'select exists(select 1 from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = $3) as exists',
    ['public', tableName, columnName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function queryRows(client, sql) {
  const result = await client.query(sql);
  return result.rows;
}

async function loadSourceData(client) {
  return {
    structuralModels: await queryRows(client, 'select * from "structural_models" order by "createdAt" asc'),
    analyses: await queryRows(client, 'select * from "analyses" order by "createdAt" asc'),
    conversations: await queryRows(client, 'select * from "conversations" order by "createdAt" asc'),
    messages: await queryRows(client, 'select * from "messages" order by "createdAt" asc'),
  };
}

async function insertMany(delegate, rows) {
  if (!rows.length) {
    return;
  }

  const chunkSize = 200;
  for (let index = 0; index < rows.length; index += chunkSize) {
    await delegate.createMany({
      data: rows.slice(index, index + chunkSize),
    });
  }
}

async function clearTarget(prisma) {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.analysis.deleteMany();
  await prisma.structuralModel.deleteMany();
}

async function targetHasData(prisma) {
  const count = await prisma.conversation.count();
  return count > 0;
}

function ensureSourceUrl(sourceUrl) {
  if (!sourceUrl) {
    console.error('[error] Missing PostgreSQL source URL. Set POSTGRES_SOURCE_DATABASE_URL or pass --source.');
    printUsage();
    process.exit(1);
  }

  if (!sourceUrl.startsWith('postgresql://') && !sourceUrl.startsWith('postgres://')) {
    console.error(`[error] Source URL must be PostgreSQL. Received: ${sourceUrl}`);
    process.exit(1);
  }
}

function ensureTargetUrl(targetUrl) {
  if (!targetUrl.startsWith('file:')) {
    console.error(`[error] Target URL must use file:. Received: ${targetUrl}`);
    process.exit(1);
  }
}

function maybeBackupTarget(targetPath) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const backupPath = `${targetPath}.bak-${timestamp}`;
  fs.copyFileSync(targetPath, backupPath);
  console.log(`[info] Backed up existing SQLite database to ${backupPath}`);
}

function logSummary(summary) {
  for (const [name, count] of Object.entries(summary)) {
    console.log(`[ok] migrated ${name}: ${count}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureSourceUrl(args.sourceUrl);
  const targetUrl = normalizeSqliteUrl(args.targetUrl);
  ensureTargetUrl(targetUrl);

  const targetPath = sqlitePathFromUrl(targetUrl);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (args.force && args.backup && fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
    maybeBackupTarget(targetPath);
  }

  runNodeScript(path.join(__dirname, 'sync-sqlite-schema.mjs'), { DATABASE_URL: targetUrl });

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: targetUrl,
      },
    },
  });

  try {
    if (await targetHasData(prisma)) {
      if (!args.force) {
        console.error('[error] Target SQLite database already contains data. Re-run with --force to replace it.');
        process.exit(1);
      }

      await clearTarget(prisma);
    }

    const sourceClient = new Client({
      connectionString: args.sourceUrl,
    });
    await sourceClient.connect();

    try {
      const source = await loadSourceData(sourceClient);
      const normalizedSource = stripLegacyScalarLists(source);

      const structuralModels = normalizedSource.structuralModels.filter(
        (row) => typeof row.conversationId === 'string' && row.conversationId.length > 0,
      );
      const skippedStructuralModels = normalizedSource.structuralModels.length - structuralModels.length;
      if (skippedStructuralModels > 0) {
        console.warn(`[warn] skipped ${skippedStructuralModels} structural model rows without conversationId`);
      }

      await insertMany(prisma.structuralModel, structuralModels);
      await insertMany(prisma.analysis, normalizedSource.analyses);
      await insertMany(prisma.conversation, normalizedSource.conversations);
      await insertMany(prisma.message, normalizedSource.messages);

      logSummary({
        structuralModels: structuralModels.length,
        analyses: source.analyses.length,
        conversations: source.conversations.length,
        messages: source.messages.length,
      });
    } finally {
      await sourceClient.end();
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[error] PostgreSQL to SQLite migration failed.');
  console.error(error);
  process.exit(1);
});
