import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function envExampleKeys(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      continue;
    }
    const eq = t.indexOf('=');
    if (eq > 0) {
      keys.add(t.slice(0, eq).trim());
    }
  }
  return keys;
}

/**
 * Interpolation refs like ${VAR} with no :-default in docker-compose.yml (service config only).
 */
function composeVarsWithoutDefault(composeText) {
  const required = new Set();
  const lines = composeText.split(/\r?\n/);
  let inShell = false;
  for (const line of lines) {
    if (/^\s+-\s+\|\s*$/.test(line)) {
      inShell = true;
      continue;
    }
    if (inShell) {
      if (/^\s{4}[a-zA-Z_][a-zA-Z0-9_]*:/.test(line)) {
        inShell = false;
      }
      else {
        continue;
      }
    }
    const re = /\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (!m[0].includes(':-')) {
        required.add(m[1]);
      }
    }
  }
  return required;
}

describe('env example vs docker-compose contract', () => {
  test('.env.example defines keys required by docker-compose (no default)', () => {
    const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
    const example = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    const keys = envExampleKeys(example);
    const needed = composeVarsWithoutDefault(compose);
    for (const name of needed) {
      expect(keys.has(name)).toBe(true);
    }
  });

  test('install.ps1 NonInteractive parameters remain documented in script', () => {
    const install = fs.readFileSync(path.join(repoRoot, 'install.ps1'), 'utf8');
    expect(install).toContain('[switch]$NonInteractive');
    expect(install).toContain('$LLMProvider');
    expect(install).toContain('$LLMBaseUrl');
    expect(install).toContain('$LLMApiKey');
    expect(install).toContain('$LLMModel');
  });
});
