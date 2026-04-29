import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve database URL from settings.json, falling back to default SQLite path
// Canonical data dir resolution: SCLAW_DATA_DIR || ~/.structureclaw (see backend/src/config/index.ts)
function resolveDatabaseUrl(): string {
  const userDataDir = process.env.SCLAW_DATA_DIR || path.join(os.homedir(), '.structureclaw');
  const settingsPath = path.join(userDataDir, 'settings.json');

  try {
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (raw?.database?.url && typeof raw.database.url === 'string') {
        return raw.database.url.trim();
      }
    }
  } catch {
    // Fall through to default
  }

  const defaultSqliteDatabasePath = path.join(userDataDir, 'data', 'structureclaw.db');
  return `file:${defaultSqliteDatabasePath}`;
}

const databaseUrl = process.env.DATABASE_URL || resolveDatabaseUrl();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
