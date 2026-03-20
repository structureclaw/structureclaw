#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');
const prismaClientDir = path.join(backendDir, 'node_modules', '.prisma', 'client');
const packageJsonPath = path.join(prismaClientDir, 'package.json');

if (!fs.existsSync(prismaClientDir)) {
  process.exit(0);
}

const existingPackageJson = fs.existsSync(packageJsonPath)
  ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  : {};

const packageJson = {
  ...existingPackageJson,
  type: 'commonjs',
};

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
console.log(`[ok] ensured CommonJS package boundary at ${packageJsonPath}`);
