#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');
const generatedDir = path.join(backendDir, 'src', 'generated', 'prisma');

if (!fs.existsSync(generatedDir)) {
  process.exit(0);
}

const RELATIVE_IMPORT_RE = /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g;

function addJsExtension(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const patched = content.replace(RELATIVE_IMPORT_RE, (match, prefix, importPath, suffix) => {
    if (importPath.endsWith('.js') || importPath.endsWith('.ts')) return match;
    return `${prefix}${importPath}.js${suffix}`;
  });
  if (patched !== content) {
    fs.writeFileSync(filePath, patched, 'utf8');
  }
}

function walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      addJsExtension(fullPath);
    }
  }
}

walkDir(generatedDir);
console.log('[ok] patched Prisma generated imports with .js extensions');
