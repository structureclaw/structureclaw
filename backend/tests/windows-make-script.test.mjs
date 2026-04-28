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

  test('should expose lifecycle commands and aliases', () => {
    expect(COMMAND_NAMES.has('test-smoke-native')).toBe(false);
    expect(COMMAND_NAMES.has('test-smoke-docker')).toBe(false);
    expect(COMMAND_NAMES.has('local-up-noinfra')).toBe(false);
    expect(ALIAS_TO_COMMAND.get('local-up-noinfra')).toBe('start');
  });

  test('should isolate local sqlite databases by startup profile', () => {
    const doctorUrl = runtime.buildScopedSqliteDatabaseUrl(repoRoot, 'doctor');
    const startUrl = runtime.buildScopedSqliteDatabaseUrl(repoRoot, 'start');

    expect(doctorUrl).toContain('structureclaw.doctor.db');
    expect(startUrl).toContain('structureclaw.start.db');
    expect(doctorUrl).not.toBe(startUrl);
  });

  test('should override configured sqlite database with the scoped startup database', () => {
    const env = {
      DATABASE_URL: 'file:../../.structureclaw/data/structureclaw.db',
    };

    const resolved = runtime.ensureLocalSqliteConfig(repoRoot, env, () => {}, { profileName: 'doctor' });

    expect(resolved).toContain('structureclaw.doctor.db');
    expect(env.DATABASE_URL).toBe(resolved);
  });
});
