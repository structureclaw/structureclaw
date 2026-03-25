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
  'python',
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
    const script = [
      'import importlib, sys',
      `sys.path.insert(0, r"${analysisPythonRoot}")`,
      'importlib.import_module("providers.opensees.runtime")',
    ].join('\n');
    const pythonCommand = resolvePythonCommand();

    const result = spawnSync(pythonCommand.executable, [...pythonCommand.args, '-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: analysisPythonRoot,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("No module named 'structure_protocol'");
  });
});
