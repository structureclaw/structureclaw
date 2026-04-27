import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(
  repoRoot,
  'backend',
  'src',
  'agent-skills',
  'analysis',
  'runtime',
);

function probePython(executable, args) {
  const result = spawnSync(executable, [...args, '-c', 'import sys; sys.exit(0)'], {
    encoding: 'utf8',
    windowsHide: process.platform === 'win32',
  });
  return result.status === 0 ? { executable, args } : null;
}

function resolvePythonCommand() {
  if (process.env.PYTHON_FOR_TEST) {
    const found = probePython(process.env.PYTHON_FOR_TEST, []);
    if (found) {
      return found;
    }
  }
  const venvPython =
    process.platform === 'win32'
      ? path.join(repoRoot, 'backend', '.venv', 'Scripts', 'python.exe')
      : path.join(repoRoot, 'backend', '.venv', 'bin', 'python');
  const candidates =
    process.platform === 'win32'
      ? [
          [venvPython, []],
          ['py', ['-3']],
          ['python', []],
          ['python3', []],
        ]
      : [
          [venvPython, []],
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

function resolvePythonExecutable(command) {
  if (!command) {
    return null;
  }
  const result = spawnSync(
    command.executable,
    [...command.args, '-c', 'import sys; print(sys.executable)'],
    {
      encoding: 'utf8',
      windowsHide: process.platform === 'win32',
    },
  );
  const executable = result.stdout.trim();
  return result.status === 0 && executable && fs.existsSync(executable) ? executable : null;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

const pythonCommand = resolvePythonCommand();
const pythonExecutable = resolvePythonExecutable(pythonCommand);

describe('analysis YJK engine registry', () => {
  if (!pythonCommand || !pythonExecutable) {
    test.skip('should probe YJK environment and YJKAPI imports (no Python on PATH)', () => {});
    return;
  }

  test('should probe YJK environment and YJKAPI imports', () => {
    const fakeYjkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-yjk-root-'));
    const stubsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-yjk-stubs-'));

    try {
      writeFile(path.join(fakeYjkRoot, 'yjks.exe'), '');
      writeFile(
        path.join(fakeYjkRoot, 'YJKAPI.py'),
        'class DataFunc:\n    pass\n\nclass YJKSControl:\n    pass\n',
      );

      writeFile(path.join(stubsDir, 'httpx.py'), '');
      writeFile(path.join(stubsDir, 'yaml.py'), 'def safe_load(_text):\n    return {}\n');
      writeFile(
        path.join(stubsDir, 'fastapi.py'),
        'class HTTPException(Exception):\n    def __init__(self, status_code, detail=None):\n        super().__init__(str(detail))\n        self.status_code = status_code\n        self.detail = detail\n',
      );
      writeFile(
        path.join(stubsDir, 'contracts.py'),
        'AnalysisResult = dict\nclass EngineNotAvailableError(Exception):\n    pass\n',
      );
      writeFile(
        path.join(stubsDir, 'skill_loader.py'),
        'class SkillNotLoadedError(Exception):\n    pass\n\ndef build_missing_skill_detail(error, capability=None):\n    return {"message": str(error), "capability": capability}\n\ndef load_skill_symbol(*_args, **_kwargs):\n    raise SkillNotLoadedError("not loaded")\n',
      );
      writeFile(path.join(stubsDir, 'structure_protocol', '__init__.py'), '');
      writeFile(
        path.join(stubsDir, 'structure_protocol', 'migrations.py'),
        'def migrate_v1_to_v2(payload):\n    return payload\n',
      );
      writeFile(
        path.join(stubsDir, 'structure_protocol', 'structure_model_v2.py'),
        'class StructureModelV2:\n    @classmethod\n    def model_validate(cls, payload):\n        return cls()\n',
      );

      const script = [
        'import json',
        'from registry import AnalysisEngineRegistry',
        'registry = AnalysisEngineRegistry("test", "0.0.0")',
        'probe = registry._probe_yjk()',
        'reason = registry._yjk_unavailable_reason()',
        'print(json.dumps({"probe": probe, "reason": reason}, ensure_ascii=False))',
      ].join('\n');

      const result = spawnSync(
        pythonCommand.executable,
        [...pythonCommand.args, '-c', script],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONPATH: [stubsDir, runtimeDir, process.env.PYTHONPATH]
              .filter(Boolean)
              .join(path.delimiter),
            YJK_PATH: fakeYjkRoot,
            YJKS_ROOT: '',
            YJKS_EXE: '',
            YJK_PYTHON_BIN: pythonExecutable,
          },
          windowsHide: process.platform === 'win32',
        },
      );

      expect(result.status).toBe(0);
      const payloadLine = result.stdout
        .trim()
        .split(/\r?\n/)
        .reverse()
        .find((line) => line.trim().startsWith('{'));
      expect(payloadLine).toBeTruthy();
      const payload = JSON.parse(payloadLine);
      expect(payload.reason).toBeNull();
      expect(payload.probe.passed).toBe(true);
      expect(payload.probe.steps.map((step) => step.name)).toContain('YJKAPI import');
      expect(JSON.stringify(payload.probe.steps)).toContain('DataFunc');
      expect(JSON.stringify(payload.probe.steps)).toContain('YJKSControl');
    } finally {
      fs.rmSync(fakeYjkRoot, { recursive: true, force: true });
      fs.rmSync(stubsDir, { recursive: true, force: true });
    }
  });
});
