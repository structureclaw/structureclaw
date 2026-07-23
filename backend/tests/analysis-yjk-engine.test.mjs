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
const yjkStaticDir = path.join(
  repoRoot,
  'backend',
  'src',
  'agent-skills',
  'analysis',
  'yjk-static',
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

  test('reinvokes an existing YJK launcher to refresh authorization', () => {
    const script = [
      'import json',
      'from types import SimpleNamespace',
      'import yjk_driver as driver',
      'spawned = []',
      'steps = []',
      'driver._find_yjk_launcher = lambda _root: r"C:\\YJKS\\YjkLauncher.exe"',
      'driver._get_launcher_processes = lambda: [{"Id": 101}]',
      'driver._popen_gui_detached = lambda args, cwd: spawned.append({"args": args, "cwd": cwd}) or SimpleNamespace(pid=202)',
      'driver._env_path = lambda _name: None',
      'driver._env_float = lambda _name, _default: 0.0',
      'driver._record_step = lambda target, **entry: target.append(entry)',
      'ok = driver._prewarm_yjk_launcher(r"C:\\YJKS", steps)',
      'print(json.dumps({"ok": ok, "spawned": spawned, "steps": steps}))',
    ].join('\n');

    const result = spawnSync(
      pythonCommand.executable,
      [...pythonCommand.args, '-c', script],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONPATH: [yjkStaticDir, process.env.PYTHONPATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
        windowsHide: process.platform === 'win32',
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.ok).toBe(true);
    expect(payload.spawned).toHaveLength(1);
    expect(payload.spawned[0].args).toEqual(['C:\\YJKS\\YjkLauncher.exe']);
    expect(payload.steps[0].pid).toBe(202);
  });

  test('accepts only exact story-derived nodal duplicates of YJK floor loads', () => {
    const script = [
      'import copy, json',
      'import runtime',
      'xs = [0.0, 6.0]',
      'ys = [0.0, 5.0]',
      'nodes = []',
      'for z, story in ((0.0, None), (3.6, "F1")):',
      '    for x in xs:',
      '        for y in ys:',
      '            node = {"id": f"N_{x}_{y}_{z}", "x": x, "y": y, "z": z, "restraints": [z == 0.0] * 6}',
      '            if story is not None: node["story"] = story',
      '            nodes.append(node)',
      'elements = []',
      'for x in xs:',
      '    for y in ys:',
      '        elements.append({"id": f"C_{x}_{y}", "type": "column", "nodes": [f"N_{x}_{y}_0.0", f"N_{x}_{y}_3.6"], "material": "MC", "section": "SC", "story": "F1"})',
      'for y in ys:',
      '    elements.append({"id": f"BX_{y}", "type": "beam", "nodes": [f"N_0.0_{y}_3.6", f"N_6.0_{y}_3.6"], "material": "MB", "section": "SB", "story": "F1"})',
      'for x in xs:',
      '    elements.append({"id": f"BY_{x}", "type": "beam", "nodes": [f"N_{x}_0.0_3.6", f"N_{x}_5.0_3.6"], "material": "MB", "section": "SB", "story": "F1"})',
      'loads = [{"type": "nodal", "node": f"N_{x}_{y}_3.6", "fz": -90.0, "story": "F1", "source": "story_floor_loads", "load_kind": "dead", "reference_frame": "global"} for x in xs for y in ys]',
      'model = {"nodes": nodes, "elements": elements, "materials": [{"id": "MC", "category": "concrete"}, {"id": "MB", "category": "concrete"}], "sections": [{"id": "SC"}, {"id": "SB"}], "stories": [{"id": "F1", "elevation": 0.0, "height": 3.6, "floor_loads": [{"type": "dead", "value": 12.0}], "dead_load": 12.0}], "load_cases": [{"id": "D", "loads": loads}]}',
      'runtime._validate_yjk_grid_conversion_scope(model)',
      'def rejected(candidate):',
      '    try:',
      '        runtime._validate_yjk_grid_conversion_scope(candidate)',
      '    except ValueError as error:',
      '        return str(error)',
      '    return None',
      'wrong_total = copy.deepcopy(model)',
      'wrong_total["load_cases"][0]["loads"][0]["fz"] = -80.0',
      'explicit = copy.deepcopy(model)',
      'explicit["load_cases"][0]["loads"][0]["source"] = "user_explicit"',
      'print(json.dumps({"wrongTotal": rejected(wrong_total), "explicit": rejected(explicit)}))',
    ].join('\n');

    const result = spawnSync(
      pythonCommand.executable,
      [...pythonCommand.args, '-c', script],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONPATH: [yjkStaticDir, runtimeDir, process.env.PYTHONPATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
        windowsHide: process.platform === 'win32',
      },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.wrongTotal).toContain('conflicts with dead_load');
    expect(payload.explicit).toContain('other nodal/member loads are unsupported');
  });
});
