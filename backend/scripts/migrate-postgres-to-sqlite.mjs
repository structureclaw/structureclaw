#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import {
  buildPostAttachmentRows,
  buildPostTagRows,
  buildSkillTagRows,
  buildUserExpertiseRows,
  stripLegacyScalarLists,
} from './postgres-to-sqlite-lib.mjs';

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
  const hasUserExpertiseTable = await tableExists(client, 'user_expertise');
  const hasSkillTagsTable = await tableExists(client, 'skill_tags');
  const hasPostTagsTable = await tableExists(client, 'post_tags');
  const hasPostAttachmentsTable = await tableExists(client, 'post_attachments');
  const hasUsersExpertiseColumn = await columnExists(client, 'users', 'expertise');
  const hasSkillsTagsColumn = await columnExists(client, 'skills', 'tags');
  const hasPostsTagsColumn = await columnExists(client, 'posts', 'tags');
  const hasPostsAttachmentsColumn = await columnExists(client, 'posts', 'attachments');

  return {
    users: await queryRows(client, 'select * from "users" order by "createdAt" asc'),
    projects: await queryRows(client, 'select * from "projects" order by "createdAt" asc'),
    projectMembers: await queryRows(client, 'select * from "project_members" order by "joinedAt" asc'),
    structuralModels: await queryRows(client, 'select * from "structural_models" order by "createdAt" asc'),
    analyses: await queryRows(client, 'select * from "analyses" order by "createdAt" asc'),
    conversations: await queryRows(client, 'select * from "conversations" order by "createdAt" asc'),
    messages: await queryRows(client, 'select * from "messages" order by "createdAt" asc'),
    skills: await queryRows(client, 'select * from "skills" order by "createdAt" asc'),
    projectSkills: await queryRows(client, 'select * from "project_skills" order by "installedAt" asc'),
    skillReviews: await queryRows(client, 'select * from "skill_reviews" order by "createdAt" asc'),
    skillExecutions: await queryRows(client, 'select * from "skill_executions" order by "createdAt" asc'),
    posts: await queryRows(client, 'select * from "posts" order by "createdAt" asc'),
    comments: await queryRows(client, 'select * from "comments" order by "createdAt" asc'),
    postLikes: await queryRows(client, 'select * from "post_likes" order by "createdAt" asc'),
    userExpertise: hasUserExpertiseTable
      ? await queryRows(client, 'select * from "user_expertise" order by "userId" asc, "position" asc, "createdAt" asc')
      : (hasUsersExpertiseColumn ? [] : []),
    skillTags: hasSkillTagsTable
      ? await queryRows(client, 'select * from "skill_tags" order by "skillId" asc, "createdAt" asc')
      : (hasSkillsTagsColumn ? [] : []),
    postTags: hasPostTagsTable
      ? await queryRows(client, 'select * from "post_tags" order by "postId" asc, "createdAt" asc')
      : (hasPostsTagsColumn ? [] : []),
    postAttachments: hasPostAttachmentsTable
      ? await queryRows(client, 'select * from "post_attachments" order by "postId" asc, "position" asc, "createdAt" asc')
      : (hasPostsAttachmentsColumn ? [] : []),
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
  await prisma.postLike.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.postAttachment.deleteMany();
  await prisma.postTag.deleteMany();
  await prisma.post.deleteMany();
  await prisma.skillExecution.deleteMany();
  await prisma.skillReview.deleteMany();
  await prisma.projectSkill.deleteMany();
  await prisma.skillTag.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.analysis.deleteMany();
  await prisma.structuralModel.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.userExpertise.deleteMany();
  await prisma.user.deleteMany();
}

async function targetHasData(prisma) {
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.conversation.count(),
    prisma.skill.count(),
    prisma.post.count(),
  ]);
  return counts.some((count) => count > 0);
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
      const userExpertiseRows = buildUserExpertiseRows(source.users, source.userExpertise);
      const skillTagRows = buildSkillTagRows(source.skills, source.skillTags);
      const postTagRows = buildPostTagRows(source.posts, source.postTags);
      const postAttachmentRows = buildPostAttachmentRows(source.posts, source.postAttachments);

      await insertMany(prisma.user, normalizedSource.users);
      await insertMany(prisma.userExpertise, userExpertiseRows);
      await insertMany(prisma.project, normalizedSource.projects);
      await insertMany(prisma.projectMember, normalizedSource.projectMembers);
      await insertMany(prisma.structuralModel, normalizedSource.structuralModels);
      await insertMany(prisma.analysis, normalizedSource.analyses);
      await insertMany(prisma.conversation, normalizedSource.conversations);
      await insertMany(prisma.message, normalizedSource.messages);
      await insertMany(prisma.skill, normalizedSource.skills);
      await insertMany(prisma.skillTag, skillTagRows);
      await insertMany(prisma.projectSkill, normalizedSource.projectSkills);
      await insertMany(prisma.skillReview, normalizedSource.skillReviews);
      await insertMany(prisma.skillExecution, normalizedSource.skillExecutions);
      await insertMany(prisma.post, normalizedSource.posts);
      await insertMany(prisma.postTag, postTagRows);
      await insertMany(prisma.postAttachment, postAttachmentRows);
      await insertMany(prisma.comment, normalizedSource.comments);
      await insertMany(prisma.postLike, normalizedSource.postLikes);

      logSummary({
        users: source.users.length,
        userExpertise: userExpertiseRows.length,
        projects: source.projects.length,
        projectMembers: source.projectMembers.length,
        structuralModels: source.structuralModels.length,
        analyses: source.analyses.length,
        conversations: source.conversations.length,
        messages: source.messages.length,
        skills: source.skills.length,
        skillTags: skillTagRows.length,
        projectSkills: source.projectSkills.length,
        skillReviews: source.skillReviews.length,
        skillExecutions: source.skillExecutions.length,
        posts: source.posts.length,
        postTags: postTagRows.length,
        postAttachments: postAttachmentRows.length,
        comments: source.comments.length,
        postLikes: source.postLikes.length,
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
