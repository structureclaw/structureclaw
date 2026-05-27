import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function probePython(executable, args) {
  const result = spawnSync(executable, [...args, '-c', 'import sys; sys.exit(0)'], {
    encoding: 'utf8',
    windowsHide: process.platform === 'win32',
  });
  return result.status === 0 ? { executable, args } : null;
}

function resolvePythonCommand() {
  const candidates = process.platform === 'win32'
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
    if (found) return found;
  }
  return null;
}

describe('YJK driver authorization detection', () => {
  const python = resolvePythonCommand();

  if (!python) {
    test.skip('detects authorization failure windows from reused YJK processes (no Python)', () => {});
    return;
  }

  test('detects authorization failure windows from reused YJK processes', () => {
    const script = String.raw`
import importlib.util
from pathlib import Path

driver_path = Path(r"${repoRoot}") / "backend" / "src" / "agent-skills" / "analysis" / "yjk-static" / "yjk_driver.py"
spec = importlib.util.spec_from_file_location("yjk_driver_under_test", driver_path)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

driver._get_yjks_processes = lambda: [
    {"Id": 10, "MainWindowTitle": "授权检测失败"},
    {"Id": 11, "MainWindowTitle": "YJK main"},
]

state = driver._wait_for_direct_launch_state({10}, 1.0)
assert state["state"] == "auth_failed", state
assert state["pid"] == 10, state
print("ok")
`;

    const result = spawnSync(python.executable, [...python.args, '-c', script], {
      encoding: 'utf8',
      windowsHide: process.platform === 'win32',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });
});
