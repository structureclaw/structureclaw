import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const converterDir = path.join(
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
    if (found) return found;
  }

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

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

const pythonCommand = resolvePythonCommand();

describe('YJK RC frame converter', () => {
  if (!pythonCommand) {
    test.skip('converts reinforced-concrete frame sections with YJK DataFunc (no Python on PATH)', () => {});
    return;
  }

  test('converts reinforced-concrete frame sections with YJK DataFunc', () => {
    const stubsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-yjk-api-'));
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-yjk-rc-'));

    try {
      writeFile(
        path.join(stubsDir, 'YJKAPI.py'),
        [
          'import os',
          'calls = []',
          '',
          'class DataFunc:',
          '    def StdFlr_Generate(self, height_mm, dead, live):',
          '        calls.append({"method": "StdFlr_Generate", "height_mm": height_mm, "dead": dead, "live": live})',
          '        return {"std_floor": len(calls)}',
          '',
          '    def ColSect_Def(self, mat, kind, shape_val, name):',
          '        calls.append({"method": "ColSect_Def", "mat": mat, "kind": kind, "shape_val": shape_val, "name": name})',
          '        return {"id": "col-section"}',
          '',
          '    def BeamSect_Def(self, mat, kind, shape_val, name):',
          '        calls.append({"method": "BeamSect_Def", "mat": mat, "kind": kind, "shape_val": shape_val, "name": name})',
          '        return {"id": "beam-section"}',
          '',
          '    def node_generate(self, xspans, yspans, std_flr):',
          '        calls.append({"method": "node_generate", "xspans": xspans, "yspans": yspans})',
          '        return [[f"N{row}_{col}" for col in range(len(xspans))] for row in range(len(yspans))]',
          '',
          '    def column_arrange(self, nodelist, section):',
          '        calls.append({"method": "column_arrange", "section": section})',
          '        return [[1, 2], [3, 4]]',
          '',
          '    def grid_generate(self, nodelist, dx, dy):',
          '        calls.append({"method": "grid_generate", "dx": dx, "dy": dy})',
          '        return {"direction": "x" if dx == 0 and dy == 1 else "y"}',
          '',
          '    def beam_arrange(self, grid, section):',
          '        calls.append({"method": "beam_arrange", "grid": grid, "section": section})',
          '        return [[101], [102]] if grid.get("direction") == "x" else [[201], [202]]',
          '',
          '    def Floors_Assemb(self, start_mm, std_flr, count, height_mm):',
          '        calls.append({"method": "Floors_Assemb", "start_mm": start_mm, "count": count, "height_mm": height_mm})',
          '',
          '    def DbModel_Assign(self):',
          '        calls.append({"method": "DbModel_Assign"})',
          '',
          '    def GetDbModelData(self):',
          '        calls.append({"method": "GetDbModelData"})',
          '        return {"model": "stub"}',
          '',
          'class Hi_AddToAndReadYjk:',
          '    def __init__(self, model):',
          '        self.model = model',
          '        calls.append({"method": "Hi_AddToAndReadYjk", "model": model})',
          '',
          '    def CreateYDB(self, work_dir, filename):',
          '        calls.append({"method": "CreateYDB", "filename": filename})',
          '        with open(os.path.join(work_dir, filename), "w", encoding="utf-8") as f:',
          '            f.write("stub ydb")',
          '',
        ].join('\n'),
      );

      const model = {
        schema_version: '2.0.0',
        unit_system: 'SI',
        project: { name: 'rc_frame_test', extra: { designCode: 'GB50010' } },
        materials: [
          { id: '1', name: 'C30', grade: 'C30', category: 'concrete', E: 30000, fc: 14.3 },
          { id: '2', name: 'HRB400', grade: 'HRB400', category: 'rebar', fy: 360 },
        ],
        sections: [
          {
            id: '1',
            name: '400X400',
            type: 'rectangular',
            purpose: 'column',
            width: 400,
            height: 400,
            shape: { kind: 'rectangular', B: 400, H: 400 },
          },
          {
            id: '2',
            name: '250X600',
            type: 'rectangular',
            purpose: 'beam',
            width: 250,
            height: 600,
            shape: { kind: 'rectangular', B: 250, H: 600 },
          },
        ],
        nodes: [
          { id: 'N0_0', x: 0, y: 0, z: 0 },
          { id: 'N0_1', x: 6, y: 0, z: 0 },
          { id: 'N1_0', x: 0, y: 0, z: 3, story: 'F1' },
          { id: 'N1_1', x: 6, y: 0, z: 3, story: 'F1' },
        ],
        elements: [
          { id: 'C1', type: 'column', nodes: ['N0_0', 'N1_0'], material: '1', section: '1', story: 'F1' },
          { id: 'C2', type: 'column', nodes: ['N0_1', 'N1_1'], material: '1', section: '1', story: 'F1' },
          { id: 'B3', type: 'beam', nodes: ['N1_0', 'N1_1'], material: '1', section: '2', story: 'F1' },
        ],
        stories: [
          {
            id: 'F1',
            height: 3,
            elevation: 0,
            floor_loads: [{ type: 'dead', value: 16.67 }],
          },
        ],
      };

      const script = [
        'import json, os, sys',
        `sys.path.insert(0, ${JSON.stringify(stubsDir)})`,
        `sys.path.insert(1, ${JSON.stringify(converterDir)})`,
        'import yjk_converter',
        'from YJKAPI import calls',
        'model = json.loads(sys.stdin.read())',
        `work_dir = ${JSON.stringify(workDir)}`,
        'ydb_path = yjk_converter.convert_v2_to_ydb(model, work_dir, "rc.ydb")',
        'with open(os.path.join(work_dir, "mapping.json"), "r", encoding="utf-8") as f:',
        '    mapping = json.load(f)',
        'print(json.dumps({"ydbExists": os.path.exists(ydb_path), "calls": calls, "mapping": mapping}, ensure_ascii=False))',
      ].join('\n');

      const result = spawnSync(
        pythonCommand.executable,
        [...pythonCommand.args, '-c', script],
        {
          input: JSON.stringify(model),
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONPATH: [stubsDir, converterDir, process.env.PYTHONPATH]
              .filter(Boolean)
              .join(path.delimiter),
          },
          windowsHide: process.platform === 'win32',
        },
      );

      if (result.status !== 0) {
        throw new Error(`converter failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      }

      const payloadLine = result.stdout
        .trim()
        .split(/\r?\n/)
        .reverse()
        .find((line) => line.trim().startsWith('{'));
      expect(payloadLine).toBeTruthy();
      const payload = JSON.parse(payloadLine);
      const colSectionCall = payload.calls.find((call) => call.method === 'ColSect_Def');
      const beamSectionCall = payload.calls.find((call) => call.method === 'BeamSect_Def');

      expect(payload.ydbExists).toBe(true);
      expect(colSectionCall).toMatchObject({
        mat: 6,
        kind: 1,
        shape_val: '400,400',
        name: '400X400',
      });
      expect(beamSectionCall).toMatchObject({
        mat: 6,
        kind: 1,
        shape_val: '250,600',
        name: '250X600',
      });
      expect(payload.calls.map((call) => call.method)).toEqual(expect.arrayContaining([
        'node_generate',
        'column_arrange',
        'beam_arrange',
        'Floors_Assemb',
        'CreateYDB',
      ]));
      expect(payload.mapping.sections['1']).toMatchObject({
        role: 'column',
        yjk_mat_type: 6,
        yjk_kind: 1,
        shape_val: '400,400',
      });
      expect(payload.mapping.sections['2']).toMatchObject({
        role: 'beam',
        yjk_mat_type: 6,
        yjk_kind: 1,
        shape_val: '250,600',
      });
    } finally {
      fs.rmSync(stubsDir, { recursive: true, force: true });
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
