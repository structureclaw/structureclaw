import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const { COMMANDS, ALIAS_TO_COMMAND } = require(path.join(repoRoot, 'scripts', 'cli', 'command-manifest.js'));

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

  test('docker-install CLI documents the non-interactive LLM bootstrap flags', () => {
    const dockerInstall = COMMANDS.find((command) => command.name === 'docker-install');

    expect(dockerInstall).toBeDefined();
    expect(dockerInstall.usage).toContain('sclaw docker-install');
    expect(dockerInstall.usage).toContain('--non-interactive');
    expect(dockerInstall.usage).toContain('--llm-provider <name>');
    expect(dockerInstall.usage).toContain('--llm-base-url <url>');
    expect(dockerInstall.usage).toContain('--llm-api-key <key>');
    expect(dockerInstall.usage).toContain('--llm-model <name>');
    expect(dockerInstall.usage).toContain('--skip-api-test');
    expect(ALIAS_TO_COMMAND.get('install-docker')).toBe('docker-install');
  });
});
