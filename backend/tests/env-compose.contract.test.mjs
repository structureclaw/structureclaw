import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const { COMMANDS, ALIAS_TO_COMMAND } = require(path.join(repoRoot, 'scripts', 'cli', 'command-manifest.js'));

describe('docker-compose contract', () => {
  test('docker-compose.yml exists and is valid YAML', () => {
    const composePath = path.join(repoRoot, 'docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);
    const compose = fs.readFileSync(composePath, 'utf8');
    expect(compose).toContain('services:');
  });

  test('docker-install CLI documents the non-interactive LLM bootstrap flags', () => {
    const dockerInstall = COMMANDS.find((command) => command.name === 'docker-install');

    expect(dockerInstall).toBeDefined();
    expect(dockerInstall.usage).toContain('sclaw docker-install');
    expect(dockerInstall.usage).toContain('--non-interactive');
    expect(dockerInstall.usage).not.toContain('--llm-provider');
    expect(dockerInstall.usage).toContain('--llm-base-url <url>');
    expect(dockerInstall.usage).toContain('--llm-api-key <key>');
    expect(dockerInstall.usage).toContain('--llm-model <name>');
    expect(dockerInstall.usage).toContain('--skip-api-test');
    expect(ALIAS_TO_COMMAND.get('install-docker')).toBe('docker-install');
  });
});
