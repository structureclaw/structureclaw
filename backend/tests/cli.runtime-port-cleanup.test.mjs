import { describe, expect, jest, test } from '@jest/globals';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cliMain = require('../../scripts/cli/main.js');
const nodePath = require('node:path');
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

  test('isProjectOwnedPortProcess tolerates windows-resolved roots for slash-only command lines', () => {
    const resolveSpy = jest.spyOn(nodePath, 'resolve').mockReturnValue('C:\\workspace\\structureclaw');

    expect(runtime.isProjectOwnedPortProcess({
      pid: 1234,
      commandLine: 'node /workspace/structureclaw/backend/server.js',
      rootDir: '/workspace/structureclaw',
      allowedPids: new Set(),
    })).toBe(true);

    resolveSpy.mockRestore();
  });

  test('getPortCleanupOptions keeps project-owned orphan cleanup enabled by default', () => {
    expect(
      cliMain.getPortCleanupOptions(
        { rootDir: '/workspace/structureclaw' },
        {},
        [4321],
      ),
    ).toEqual({
      allowedPids: [4321],
      allowForeign: false,
      allowProjectOwned: true,
      rootDir: '/workspace/structureclaw',
    });

    expect(
      cliMain.getPortCleanupOptions(
        { rootDir: '/workspace/structureclaw' },
        { SCLAW_FORCE_PORT_CLEANUP: '1' },
        [],
      ),
    ).toEqual({
      allowedPids: [],
      allowForeign: true,
      allowProjectOwned: true,
      rootDir: '/workspace/structureclaw',
    });
  });
});
