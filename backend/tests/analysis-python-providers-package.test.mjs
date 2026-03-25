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

describe('analysis python providers package', () => {
  test('should not require structure_protocol just to start the opensees runtime module', () => {
    const script = [
      'import runpy, sys',
      `sys.path.insert(0, r"${analysisPythonRoot}")`,
      'runpy.run_module("providers.opensees.runtime", run_name="__main__")',
    ].join('\n');

    const result = spawnSync('python3', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: analysisPythonRoot,
      },
    });

    expect(result.stderr).not.toContain("No module named 'structure_protocol'");
  });
});
