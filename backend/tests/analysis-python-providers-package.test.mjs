import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..');
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

function resolvePythonCommand() {
  if (process.env.PYTHON_FOR_TEST) {
    return { executable: process.env.PYTHON_FOR_TEST, args: [] };
  }
  if (process.platform === 'win32') {
    return { executable: 'py', args: ['-3'] };
  }
  return { executable: 'python3', args: [] };
}

describe('analysis python providers package', () => {
  test('should not require structure_protocol just to start the opensees runtime module', () => {
    const pythonCommand = resolvePythonCommand();

    const result = spawnSync(pythonCommand.executable, [...pythonCommand.args, openseesProbePath, '--json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: analysisPythonRoot,
      },
    });

    expect([0, 1]).toContain(result.status);
    expect(result.stderr).not.toContain("No module named 'structure_protocol'");
    expect(result.stdout).not.toContain("No module named 'structure_protocol'");
  });
});
