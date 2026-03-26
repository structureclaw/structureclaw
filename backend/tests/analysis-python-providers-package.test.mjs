import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const analysisPythonRoot = path.join(
  repoRoot,
  'backend',
  'src',
  'agent-skills',
  'analysis',
  'runtime',
);
const openseesProbePath = path.join(
  repoRoot,
  'backend',
  'src',
  'agent-skills',
  'analysis',
  'opensees-static',
  'opensees_runtime.py',
);

function probePython(executable, args) {
  const r = spawnSync(executable, [...args, '-c', 'import sys; sys.exit(0)'], {
    encoding: 'utf8',
    windowsHide: process.platform === 'win32',
  });
  return r.status === 0 ? { executable, args } : null;
}

function resolvePythonCommand() {
  if (process.env.PYTHON_FOR_TEST) {
    const found = probePython(process.env.PYTHON_FOR_TEST, []);
    if (found) {
      return found;
    }
  }
  const candidates =
    process.platform === 'win32'
      ? [
          ['py', ['-3']],
          ['python', []],
          ['python3', []],
        ]
      : [
          ['python3', []],
          ['python', []],
        ];
  for (const [executable, args] of candidates) {
    const found = probePython(executable, args);
    if (found) {
      return found;
    }
  }
  return null;
}

const resolvedPython = resolvePythonCommand();

describe('analysis python providers package', () => {
  if (!resolvedPython) {
    test.skip(
      'should not require structure_protocol just to start the opensees runtime module (no Python on PATH)',
      () => {},
    );
    return;
  }

  test('should not require structure_protocol just to start the opensees runtime module', () => {
    const result = spawnSync(
      resolvedPython.executable,
      [...resolvedPython.args, openseesProbePath, '--json'],
      {
        encoding: 'utf8',
        windowsHide: process.platform === 'win32',
        env: {
          ...process.env,
          PYTHONPATH: analysisPythonRoot,
        },
      },
    );

    if (result.error) {
      throw new Error(
        `spawnSync failed: ${result.error.message} (executable=${resolvedPython.executable})`,
      );
    }
    expect([0, 1]).toContain(result.status);
    expect(result.stderr).not.toContain("No module named 'structure_protocol'");
    expect(result.stdout).not.toContain("No module named 'structure_protocol'");
  });
});
