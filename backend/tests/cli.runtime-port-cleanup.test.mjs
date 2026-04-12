import { describe, expect, test } from '@jest/globals';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runtime = require('../../scripts/cli/runtime.js');

describe('cli runtime port cleanup guards', () => {
  test('normalizePortNumber accepts valid ports and rejects unsafe values', () => {
    expect(runtime.normalizePortNumber(8000)).toBe(8000);
    expect(runtime.normalizePortNumber('30000')).toBe(30000);
    expect(runtime.normalizePortNumber('0')).toBeNull();
    expect(runtime.normalizePortNumber('65536')).toBeNull();
    expect(runtime.normalizePortNumber('abc')).toBeNull();
    expect(runtime.normalizePortNumber('30000; Stop-Process -Id 1')).toBeNull();
  });

  test('isProjectOwnedPortProcess allows tracked pids and project-root command lines only', () => {
    expect(runtime.isProjectOwnedPortProcess({
      pid: 1234,
      commandLine: 'node /workspace/structureclaw/backend/server.js',
      rootDir: '/workspace/structureclaw',
      allowedPids: new Set(),
    })).toBe(true);

    expect(runtime.isProjectOwnedPortProcess({
      pid: 5678,
      commandLine: 'node /some/other/project/server.js',
      rootDir: '/workspace/structureclaw',
      allowedPids: new Set([5678]),
    })).toBe(true);

    expect(runtime.isProjectOwnedPortProcess({
      pid: 9999,
      commandLine: 'node /some/other/project/server.js',
      rootDir: '/workspace/structureclaw',
      allowedPids: new Set(),
    })).toBe(false);
  });
});
