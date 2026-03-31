import { describe, expect, test } from '@jest/globals';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..');
const require = createRequire(import.meta.url);
const runtime = require(path.join(repoRoot, 'scripts', 'cli', 'runtime.js'));
const {
  ALIAS_TO_COMMAND,
  COMMAND_NAMES,
} = require(path.join(repoRoot, 'scripts', 'cli', 'command-manifest.js'));
const analysisRequirementsPath = path.join(
  repoRoot,
  'backend',
  'src',
  'agent-skills',
  'analysis',
  'runtime',
  'requirements.txt',
);
const analysisPythonRoot = path.join(
  repoRoot,
  'backend',
  'src',
  'agent-skills',
  'analysis',
  'runtime',
);

describe('sclaw runtime analysis python paths', () => {
  test('should resolve setup-analysis-python to the current analysis requirements file', () => {
    const paths = runtime.resolvePaths(repoRoot);

    expect(paths.analysisPythonRoot).toBe(analysisPythonRoot);
    expect(paths.analysisRequirementsFile).toBe(analysisRequirementsPath);
    expect(paths.analysisRequirementsFile).not.toContain('analysis-execution/python/requirements.txt');
    expect(paths.dataInputSkillRoot).toContain(path.join('backend', 'src', 'agent-skills', 'data-input'));
    expect(paths.materialSkillRoot).toContain(path.join('backend', 'src', 'agent-skills', 'material'));
  });

  test('should expose docker lifecycle commands through sclaw (smoke moved to tests/runner.mjs)', () => {
    expect(COMMAND_NAMES.has('docker-install')).toBe(true);
    expect(COMMAND_NAMES.has('docker-start')).toBe(true);
    expect(COMMAND_NAMES.has('docker-stop')).toBe(true);
    expect(COMMAND_NAMES.has('docker-status')).toBe(true);
    expect(COMMAND_NAMES.has('docker-logs')).toBe(true);
    expect(COMMAND_NAMES.has('test-smoke-native')).toBe(false);
    expect(COMMAND_NAMES.has('test-smoke-docker')).toBe(false);
    expect(COMMAND_NAMES.has('local-up-noinfra')).toBe(false);
    expect(ALIAS_TO_COMMAND.get('local-up-noinfra')).toBe('start');
  });

  test('should isolate local sqlite databases by startup profile', () => {
    const doctorUrl = runtime.buildScopedSqliteDatabaseUrl(repoRoot, 'doctor');
    const startUrl = runtime.buildScopedSqliteDatabaseUrl(repoRoot, 'start');

    expect(doctorUrl).toContain(path.join('.runtime', 'data', 'structureclaw.doctor.db').replace(/\\/gu, '/'));
    expect(startUrl).toContain(path.join('.runtime', 'data', 'structureclaw.start.db').replace(/\\/gu, '/'));
    expect(doctorUrl).not.toBe(startUrl);
  });

  test('should override configured sqlite database with the scoped startup database', () => {
    const env = {
      DATABASE_URL: 'file:../../.runtime/data/structureclaw.db',
    };

    const resolved = runtime.ensureLocalSqliteConfig(repoRoot, env, () => {}, { profileName: 'doctor' });

    expect(resolved).toContain(path.join('.runtime', 'data', 'structureclaw.doctor.db').replace(/\\/gu, '/'));
    expect(env.DATABASE_URL).toBe(resolved);
  });
});
