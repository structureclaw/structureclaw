import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../.env');
const defaultSqliteDatabasePath = path.resolve(__dirname, '../.runtime/data/structureclaw.db');

dotenv.config({ path: rootEnvPath, quiet: true });

const databaseUrl = process.env.DATABASE_URL || `file:${defaultSqliteDatabasePath}`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  engine: 'classic',
  datasource: {
    url: databaseUrl,
  },
});
