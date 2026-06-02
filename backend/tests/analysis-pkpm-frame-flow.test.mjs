import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConcreteFrameModel } from '../dist/agent-skills/structure-type/concrete-frame/model.js';
import { buildFrameModel } from '../dist/agent-skills/structure-type/frame/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const pkpmDir = path.join(repoRoot, 'backend', 'src', 'agent-skills', 'analysis', 'pkpm-static');
const runtimeSupportDir = path.join(repoRoot, 'backend', 'src', 'agent-skills', 'analysis', 'runtime');
const skillSharedPythonRoot = path.join(repoRoot, 'backend', 'src', 'skill-shared', 'python');

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

function writePkpmApiStub(stubsDir) {
  writeFile(
    path.join(stubsDir, 'httpx.py'),
    [
      'class Client:',
      '    def __init__(self, *args, **kwargs): pass',
      '    def __enter__(self): return self',
      '    def __exit__(self, *args): return False',
      '    def post(self, *args, **kwargs): raise RuntimeError("httpx stub is not available in this test")',
    ].join('\n'),
  );

  writeFile(
    path.join(stubsDir, 'yaml.py'),
    'def safe_load(*args, **kwargs): return {}\n',
  );

  writeFile(
    path.join(stubsDir, 'fastapi.py'),
    [
      'class HTTPException(Exception):',
      '    def __init__(self, status_code=None, detail=None):',
      '        self.status_code = status_code',
      '        self.detail = detail',
      '        super().__init__(detail)',
    ].join('\n'),
  );

  writeFile(path.join(stubsDir, 'structure_protocol', '__init__.py'), '');
  writeFile(
    path.join(stubsDir, 'structure_protocol', 'migrations.py'),
    'def migrate_v1_to_v2(model): return model\n',
  );
  writeFile(
    path.join(stubsDir, 'structure_protocol', 'structure_model_v2.py'),
    [
      'class StructureModelV2:',
      '    def __init__(self, **data): self.data = data',
      '    def model_dump(self, **kwargs): return dict(self.data)',
    ].join('\n'),
  );

  writeFile(
    path.join(stubsDir, 'contracts.py'),
    [
      'class EngineNotAvailableError(RuntimeError):',
      '    def __init__(self, engine, reason):',
      '        self.engine = engine',
      '        self.reason = reason',
      '        super().__init__(f"Engine {engine!r} unavailable: {reason}")',
      'AnalysisResult = dict',
    ].join('\n'),
  );

  writeFile(
    path.join(stubsDir, 'APIPyInterface.py'),
    [
      'calls = []',
      '',
      'class SteelGrade:',
      '    Q235 = "Q235"',
      '    Q345 = "Q345"',
      '    Q355 = "Q355"',
      '    Q390 = "Q390"',
      '    Q420 = "Q420"',
      '    Q460 = "Q460"',
      '',
      'class ConcreteGrade:',
      '    C20 = "C20"',
      '    C25 = "C25"',
      '    C30 = "C30"',
      '    C35 = "C35"',
      '    C40 = "C40"',
      '',
      'class SectionKind:',
      '    IDSec_Rectangle = "IDSec_Rectangle"',
      '    IDSec_I = "IDSec_I"',
      '    IDSec_Box = "IDSec_Box"',
      '    IDSec_Tube = "IDSec_Tube"',
      '    IDSec_Circle = "IDSec_Circle"',
      '    IDSec_T = "IDSec_T"',
      '    IDSec_L = "IDSec_L"',
      '',
      'class SpecialColumn:',
      '    IDSp_Constrain_Support = "IDSp_Constrain_Support"',
      '',
      'class SectionShape:',
      '    def __init__(self):',
      '        self.fields = {}',
      '    def _set(self, key, val):',
      '        self.fields[key] = val',
      '        calls.append({"method": f"SectionShape.Set_{key}", "value": val})',
      '    def Set_B(self, val): self._set("B", val)',
      '    def Set_H(self, val): self._set("H", val)',
      '    def Set_U(self, val): self._set("U", val)',
      '    def Set_T(self, val): self._set("T", val)',
      '    def Set_D(self, val): self._set("D", val)',
      '    def Set_F(self, val): self._set("F", val)',
      '    def Set_M(self, val): self._set("M", val)',
      '    def as_dict(self): return dict(self.fields)',
      '',
      'class ColumnSection:',
      '    def __init__(self): self.user = None; self.standard = None',
      '    def SetUserSect(self, kind, shape):',
      '        self.user = {"kind": kind, "shape": shape.as_dict()}',
      '        calls.append({"method": "ColumnSection.SetUserSect", **self.user})',
      '    def SetStandSteelSect(self, name, shape=None):',
      '        self.standard = name',
      '        calls.append({"method": "ColumnSection.SetStandSteelSect", "name": name})',
      '',
      'class BeamSection:',
      '    def __init__(self): self.user = None; self.standard = None',
      '    def SetUserSect(self, kind, shape):',
      '        self.user = {"kind": kind, "shape": shape.as_dict()}',
      '        calls.append({"method": "BeamSection.SetUserSect", **self.user})',
      '    def SetStandSteelSect(self, name, shape=None):',
      '        self.standard = name',
      '        calls.append({"method": "BeamSection.SetStandSteelSect", "name": name})',
      '',
      'class ProjectPara:',
      '    def SetParaInt(self, key, value):',
      '        calls.append({"method": "ProjectPara.SetParaInt", "key": key, "value": value})',
      '    def SetParaDouble(self, key, value):',
      '        calls.append({"method": "ProjectPara.SetParaDouble", "key": key, "value": value})',
      '',
      'class Node:',
      '    def __init__(self, node_id): self.node_id = node_id',
      '    def GetID(self): return self.node_id',
      '',
      'class Net:',
      '    def __init__(self, net_id): self.net_id = net_id',
      '    def GetID(self): return self.net_id',
      '',
      'class Column:',
      '    def __init__(self, pmid): self.pmid = pmid',
      '    def SetConcreteGrade(self, grade): calls.append({"method": "Column.SetConcreteGrade", "grade": grade, "pmid": self.pmid})',
      '    def SetSteelGrade(self, grade): calls.append({"method": "Column.SetSteelGrade", "grade": grade, "pmid": self.pmid})',
      '    def SetSpecial(self, key, value): calls.append({"method": "Column.SetSpecial", "key": key, "value": value, "pmid": self.pmid})',
      '    def GetPmid(self): return self.pmid',
      '',
      'class Beam:',
      '    def __init__(self, pmid): self.pmid = pmid',
      '    def SetConcreteGrade(self, grade): calls.append({"method": "Beam.SetConcreteGrade", "grade": grade, "pmid": self.pmid})',
      '    def SetSteelGrade(self, grade): calls.append({"method": "Beam.SetSteelGrade", "grade": grade, "pmid": self.pmid})',
      '    def GetPmid(self): return self.pmid',
      '',
      'class StandFloor:',
      '    def __init__(self):',
      '        self.next_node = 1',
      '        self.next_net = 1',
      '        self.next_column = 1000',
      '        self.next_beam = 2000',
      '    def SetDeadLive(self, dead, live): calls.append({"method": "StandFloor.SetDeadLive", "dead": dead, "live": live})',
      '    def AddNode(self, x, y):',
      '        node = Node(self.next_node)',
      '        self.next_node += 1',
      '        calls.append({"method": "StandFloor.AddNode", "x": x, "y": y, "id": node.GetID()})',
      '        return node',
      '    def AddColumn(self, section, node_id):',
      '        col = Column(self.next_column)',
      '        self.next_column += 1',
      '        calls.append({"method": "StandFloor.AddColumn", "section": section, "node": node_id, "pmid": col.GetPmid()})',
      '        return col',
      '    def AddLineNet(self, start, end):',
      '        net = Net(self.next_net)',
      '        self.next_net += 1',
      '        calls.append({"method": "StandFloor.AddLineNet", "start": start, "end": end, "id": net.GetID()})',
      '        return net',
      '    def AddBeamEx(self, section, net_id, *args):',
      '        beam = Beam(self.next_beam)',
      '        self.next_beam += 1',
      '        calls.append({"method": "StandFloor.AddBeamEx", "section": section, "net": net_id, "pmid": beam.GetPmid(), "args": list(args)})',
      '        return beam',
      '',
      'class RealFloor:',
      '    def SetFloorHeight(self, height): calls.append({"method": "RealFloor.SetFloorHeight", "height": height})',
      '    def SetBottomElevation(self, elevation): calls.append({"method": "RealFloor.SetBottomElevation", "elevation": elevation})',
      '    def SetStandFloorIndex(self, index): calls.append({"method": "RealFloor.SetStandFloorIndex", "index": index})',
      '',
      'class Model:',
      '    def __init__(self): self.floor = StandFloor(); self.next_col_sec = 1; self.next_beam_sec = 1; self.para = ProjectPara(); self.design_params = [0.0] * 128',
      '    def CreatNewModel(self, work_dir, project_name): calls.append({"method": "Model.CreatNewModel", "work_dir": work_dir, "project_name": project_name})',
      '    def OpenPMModel(self, jws_path): calls.append({"method": "Model.OpenPMModel", "jws_path": jws_path})',
      '    def AddColumnSection(self, section):',
      '        idx = self.next_col_sec',
      '        self.next_col_sec += 1',
      '        calls.append({"method": "Model.AddColumnSection", "idx": idx, "section": section.user or {"standard": section.standard}})',
      '        return idx',
      '    def AddBeamSection(self, section):',
      '        idx = self.next_beam_sec',
      '        self.next_beam_sec += 1',
      '        calls.append({"method": "Model.AddBeamSection", "idx": idx, "section": section.user or {"standard": section.standard}})',
      '        return idx',
      '    def SetCurrentStandFloor(self, index): calls.append({"method": "Model.SetCurrentStandFloor", "index": index})',
      '    def GetCurrentStandFloor(self): return self.floor',
      '    def AddNaturalFloor(self, floor): calls.append({"method": "Model.AddNaturalFloor"})',
      '    def GetProjectPara(self): return self.para',
      '    def GetAllDesignPara(self):',
      '        calls.append({"method": "Model.GetAllDesignPara"})',
      '        return list(self.design_params)',
      '    def SetAllDesignPara(self, values):',
      '        self.design_params = list(values)',
      '        calls.append({"method": "Model.SetAllDesignPara", "values": list(values)})',
      '    def SetOneDesignParaValue(self, index, value): calls.append({"method": "Model.SetOneDesignParaValue", "index": index, "value": value})',
      '    def AddStandFloor(self): calls.append({"method": "Model.AddStandFloor"})',
      '    def SaveProjectPara(self): calls.append({"method": "Model.SaveProjectPara"})',
      '    def SavePMModel(self): calls.append({"method": "Model.SavePMModel"})',
      '',
      'class ResultData:',
      '    def InitialResult(self, jws_path): calls.append({"method": "ResultData.InitialResult", "jws_path": jws_path}); return 1',
      '    def ClearResult(self): calls.append({"method": "ResultData.ClearResult"})',
      '    def GetModePeriods(self): return [object(), object(), object()]',
      '    def GetDesignBeams(self, floor): return [object()] if floor == 1 else []',
      '    def GetDesignColumns(self, floor): return [object(), object()] if floor == 1 else []',
    ].join('\n'),
  );
}

const pythonCommand = resolvePythonCommand();

function runPkpmRuntime(model, options = {}) {
  if (!pythonCommand) {
    throw new Error('No Python command available');
  }

  const stubsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-pkpm-api-'));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-pkpm-flow-'));
  writePkpmApiStub(stubsDir);

  try {
    const script = [
      'import json, sys',
      'from pathlib import Path',
      `sys.path.insert(0, ${JSON.stringify(stubsDir)})`,
      `sys.path.insert(1, ${JSON.stringify(runtimeSupportDir)})`,
      `sys.path.insert(2, ${JSON.stringify(pkpmDir)})`,
      'import runtime',
      'import APIPyInterface',
      'patch_calls = []',
      'run_calls = []',
      `pdb_mismatch_text = ${JSON.stringify([
        ' *WRN* PDB VERSION INCONSISTENT !',
        '         FILE PDB VERSION NO.=    20250310',
        '      PROGRAM PDB VERSION NO.=    20251220',
      ].join('\n'))}`,
      'def write_pdb_mismatch(work_dir):',
      '    Path(work_dir, "SATWE_stub_MODEL0_HOLO_ERR.TXT").write_text(pdb_mismatch_text, encoding="utf-8")',
      'runtime._check_pkpm_available = lambda: Path("JWSCYCLE.exe")',
      'runtime._import_apipyinterface = lambda: None',
      'runtime._patch_material_label = lambda work_dir: patch_calls.append(str(work_dir))',
      'runtime._run_jws_cycle = lambda cycle_path, work_dir, timeout=600: run_calls.append({"cycle_path": str(cycle_path), "work_dir": str(work_dir), "timeout": timeout})',
      'def fake_extract(jws_path, material_family="steel"):',
      ...(
        options.createPdbMismatchDuringExtract
          ? ['    write_pdb_mismatch(jws_path.parent)']
          : []
      ),
      ...(
        options.failExtract
          ? ['    raise RuntimeError("simulated extraction failure")']
          : []
      ),
      '    return {',
      '        "summary": {"max_displacement_mm": 1.25, "max_shear_force_kn": 22.5, "max_bending_moment_kNm": 48.0},',
      '        "floors_analyzed": len(model.get("stories", [])),',
      '        "beam_count": len([e for e in model.get("elements", []) if e.get("type") == "beam"]),',
      '        "column_count": len([e for e in model.get("elements", []) if e.get("type") == "column"]),',
      '        "mode_periods": [{"index": 1, "period_s": 0.42}],',
      '        "beams": [], "columns": [], "node_displacements": [],',
      '        "story_drift": [], "storey_stiffness": [], "bearing_shear": [],',
      '        "case_node_disps": {}, "case_beam_forces": {}, "case_col_forces": {},',
      '        "satwe_params": {"material_family": material_family},',
      '    }',
      'runtime._extract_results = fake_extract',
      'model = json.loads(sys.stdin.read())',
      ...(
        options.expectFailure
          ? [
            'try:',
            '    result = runtime.run_analysis(model, {"timeout": 12})',
            '    print(json.dumps({"result": result, "calls": APIPyInterface.calls, "patchCalls": patch_calls, "runCalls": run_calls}, ensure_ascii=False))',
            'except Exception as exc:',
            '    print(json.dumps({"error": str(exc), "errorType": type(exc).__name__, "calls": APIPyInterface.calls, "patchCalls": patch_calls, "runCalls": run_calls}, ensure_ascii=False))',
          ]
          : [
            'result = runtime.run_analysis(model, {"timeout": 12})',
            'print(json.dumps({"result": result, "calls": APIPyInterface.calls, "patchCalls": patch_calls, "runCalls": run_calls}, ensure_ascii=False))',
          ]
      ),
    ].join('\n');

    const result = spawnSync(
      pythonCommand.executable,
      [...pythonCommand.args, '-c', script],
      {
        input: JSON.stringify(model),
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PKPM_WORK_DIR: workDir,
          PYTHONPATH: [stubsDir, runtimeSupportDir, pkpmDir, process.env.PYTHONPATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
        windowsHide: process.platform === 'win32',
      },
    );

    if (result.status !== 0) {
      throw new Error(`PKPM runtime flow failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }

    const payloadLine = result.stdout
      .trim()
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().startsWith('{'));
    expect(payloadLine).toBeTruthy();
    return JSON.parse(payloadLine);
  } finally {
    fs.rmSync(stubsDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function runPkpmProbe(options = {}) {
  if (!pythonCommand) {
    throw new Error('No Python command available');
  }

  const stubsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-pkpm-api-'));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-pkpm-probe-'));
  const fakeCyclePath = path.join(stubsDir, 'JWSCYCLE.exe');
  writePkpmApiStub(stubsDir);
  writeFile(fakeCyclePath, '');

  try {
    const script = [
      'import json, os, sys',
      'from pathlib import Path',
      `sys.path.insert(0, ${JSON.stringify(stubsDir)})`,
      `sys.path.insert(1, ${JSON.stringify(runtimeSupportDir)})`,
      `sys.path.insert(2, ${JSON.stringify(skillSharedPythonRoot)})`,
      'import registry',
      'registry.AnalysisEngineRegistry._discover_builtin_skills = lambda self: [{',
      '    "id": "pkpm-static",',
      '    "engineId": "builtin-pkpm",',
      '    "adapterKey": "builtin-pkpm",',
      '    "analysisType": "static",',
      '    "priority": 130,',
      '    "supportedModelFamilies": ["frame", "generic"],',
      '}]',
      `pdb_mismatch_text = ${JSON.stringify([
        ' *WRN* PDB VERSION INCONSISTENT !',
        '         FILE PDB VERSION NO.=    20250310',
        '      PROGRAM PDB VERSION NO.=    20251220',
      ].join('\n'))}`,
      'def fake_run(cycle_path, work_dir, timeout=120):',
      ...(
        options.createPdbMismatch
          ? ['    Path(work_dir, "SATWE_probe_MODEL0_HOLO_ERR.TXT").write_text(pdb_mismatch_text, encoding="utf-8")']
          : ['    return None']
      ),
      'registry.AnalysisEngineRegistry._run_jws_cycle_probe = staticmethod(fake_run)',
      'service = registry.AnalysisEngineRegistry("StructureClaw Analysis Engine", "0.1.0")',
      'result = service.probe_engine("builtin-pkpm")',
      'print(json.dumps(result, ensure_ascii=False))',
    ].join('\n');

    const result = spawnSync(
      pythonCommand.executable,
      [...pythonCommand.args, '-c', script],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PKPM_CYCLE_PATH: fakeCyclePath,
          PKPM_WORK_DIR: workDir,
          PYTHONPATH: [stubsDir, runtimeSupportDir, skillSharedPythonRoot, process.env.PYTHONPATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
        windowsHide: process.platform === 'win32',
      },
    );

    if (result.status !== 0) {
      throw new Error(`PKPM probe flow failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }

    const payloadLine = result.stdout
      .trim()
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().startsWith('{'));
    expect(payloadLine).toBeTruthy();
    return JSON.parse(payloadLine);
  } finally {
    fs.rmSync(stubsDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function findCalls(payload, method) {
  return payload.calls.filter((call) => call.method === method);
}

function buildRcUserScenarioModel() {
  return buildConcreteFrameModel({
    inferredType: 'frame',
    structuralTypeKey: 'concrete-frame',
    skillId: 'concrete-frame',
    updatedAt: 0,
    frameDimension: '3d',
    storyCount: 2,
    bayCountX: 2,
    bayCountY: 1,
    storyHeightsM: [3.6, 3.6],
    bayWidthsXM: [6, 6],
    bayWidthsYM: [6],
    floorLoads: [
      { story: 1, verticalKN: 300, liveLoadKN: 120 },
      { story: 2, verticalKN: 300, liveLoadKN: 120 },
    ],
    frameBaseSupportType: 'fixed',
    frameConcreteGrade: 'C30',
    frameRebarGrade: 'HRB400',
    frameColumnSection: '600X600',
    frameBeamSection: '500X250',
  });
}

function buildGenericRcFrameModelWithLegacyRectSections() {
  return {
    schema_version: '1.0.0',
    unit_system: 'SI',
    nodes: [
      { id: 'N1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
      { id: 'N2', x: 6, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
      { id: 'N3', x: 0, y: 0, z: 3.6 },
      { id: 'N4', x: 6, y: 0, z: 3.6 },
    ],
    elements: [
      { id: 'C1', type: 'column', nodes: ['N1', 'N3'], material: 'MAT1', section: 'SEC1' },
      { id: 'C2', type: 'column', nodes: ['N2', 'N4'], material: 'MAT1', section: 'SEC1' },
      { id: 'B1', type: 'beam', nodes: ['N3', 'N4'], material: 'MAT1', section: 'SEC2' },
    ],
    materials: [
      { id: 'MAT1', name: 'Concrete_C30', E: 30000, nu: 0.2, rho: 2500 },
    ],
    sections: [
      { id: 'SEC1', name: 'Col_600x600', type: 'rectangular', properties: { width: 0.6, height: 0.6, A: 0.36 } },
      { id: 'SEC2', name: 'Beam_500x250', type: 'rectangular', properties: { width: 0.5, height: 0.25, A: 0.125 } },
    ],
    stories: [
      { id: 'S1', level: 1, elevation: 0, height: 3.6 },
    ],
    load_cases: [],
    load_combinations: [],
    metadata: { source: 'generic-llm-draft' },
  };
}

function buildGenericYUpRcFrameModel() {
  const planPoints = [
    [0, 0], [6, 0], [12, 0],
    [0, 6], [6, 6], [12, 6],
  ];
  const levels = [0, 3.6, 7.2];
  const nodes = [];
  for (const [levelIndex, y] of levels.entries()) {
    for (const [pointIndex, [x, z]] of planPoints.entries()) {
      nodes.push({
        id: `N${levelIndex * planPoints.length + pointIndex + 1}`,
        x,
        y,
        z,
        ...(levelIndex === 0 ? { restraints: [true, true, true, true, true, true] } : {}),
      });
    }
  }

  const elements = [];
  for (let story = 0; story < 2; story += 1) {
    for (let point = 0; point < planPoints.length; point += 1) {
      elements.push({
        id: `C${story + 1}-${point + 1}`,
        type: 'beam',
        nodes: [
          `N${story * planPoints.length + point + 1}`,
          `N${(story + 1) * planPoints.length + point + 1}`,
        ],
        material: 'MAT1',
        section: 'SEC1',
      });
    }
  }
  for (let level = 1; level <= 2; level += 1) {
    const offset = level * planPoints.length;
    for (const rowOffset of [0, 3]) {
      elements.push(
        { id: `BX${level}-${rowOffset + 1}`, type: 'beam', nodes: [`N${offset + rowOffset + 1}`, `N${offset + rowOffset + 2}`], material: 'MAT1', section: 'SEC2' },
        { id: `BX${level}-${rowOffset + 2}`, type: 'beam', nodes: [`N${offset + rowOffset + 2}`, `N${offset + rowOffset + 3}`], material: 'MAT1', section: 'SEC2' },
      );
    }
    for (let col = 0; col < 3; col += 1) {
      elements.push({
        id: `BZ${level}-${col + 1}`,
        type: 'beam',
        nodes: [`N${offset + col + 1}`, `N${offset + col + 4}`],
        material: 'MAT1',
        section: 'SEC2',
      });
    }
  }

  return {
    schema_version: '1.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [
      { id: 'MAT1', name: 'Concrete_C30', E: 30000, nu: 0.2, rho: 2500 },
    ],
    sections: [
      { id: 'SEC1', name: 'Col_600x600', type: 'rectangular', properties: { width: 0.6, height: 0.6 } },
      { id: 'SEC2', name: 'Beam_500x250', type: 'rectangular', properties: { width: 0.5, height: 0.25 } },
    ],
    load_cases: [],
    load_combinations: [],
    metadata: {
      coordinateSemantics: 'global-z-up',
      frameDimension: '3d',
      inferredType: 'frame',
      source: 'generic-llm-draft',
    },
  };
}

describe('PKPM frame analysis flow', () => {
  if (!pythonCommand) {
    test.skip('runs PKPM frame flow with stubbed APIPyInterface (no Python on PATH)', () => {});
    return;
  }

  test('runs concrete-frame model through PKPM as concrete rectangular sections', () => {
    const model = buildRcUserScenarioModel();
    expect(model).toBeDefined();

    const payload = runPkpmRuntime(model);
    const nodeCoords = findCalls(payload, 'StandFloor.AddNode').map((call) => ({ x: call.x, y: call.y }));

    expect(payload.result.status).toBe('success');
    expect(payload.result.analysisMode).toBe('pkpm-satwe');
    expect(payload.result.summary).toMatchObject({
      engine: 'pkpm-static',
      materialFamily: 'concrete',
      floors_analyzed: 2,
      beam_count: 14,
      column_count: 12,
    });
    expect(payload.result.pkpm_detailed.satwe_params).toMatchObject({ material_family: 'concrete' });
    expect(payload.patchCalls).toEqual([]);
    expect(payload.runCalls[0]).toMatchObject({ timeout: 12 });
    expect(payload.calls).toContainEqual(expect.objectContaining({
      method: 'ProjectPara.SetParaInt',
      key: 103,
      value: 10301,
    }));
    expect(findCalls(payload, 'ColumnSection.SetUserSect')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'IDSec_Rectangle',
        shape: expect.objectContaining({ B: 600, H: 600, M: 6 }),
      }),
    ]));
    expect(findCalls(payload, 'BeamSection.SetUserSect')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'IDSec_Rectangle',
        shape: expect.objectContaining({ B: 500, H: 250, M: 6 }),
      }),
    ]));
    expect(findCalls(payload, 'Column.SetConcreteGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['C30']));
    expect(findCalls(payload, 'Beam.SetConcreteGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['C30']));
    expect(findCalls(payload, 'Column.SetSteelGrade')).toHaveLength(0);
    expect(findCalls(payload, 'Beam.SetSteelGrade')).toHaveLength(0);
    expect(findCalls(payload, 'RealFloor.SetFloorHeight').map((call) => call.height)).toEqual([3600, 3600]);
    expect(nodeCoords).toEqual(expect.arrayContaining([
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 12000, y: 0 },
      { x: 0, y: 6000 },
      { x: 6000, y: 6000 },
      { x: 12000, y: 6000 },
    ]));
  });

  test('detects concrete by material category even when material name is not a C-grade token', () => {
    const baseModel = buildRcUserScenarioModel();
    const model = JSON.parse(JSON.stringify(baseModel));
    model.materials = model.materials.map((material) => (
      material.id === '1'
        ? { ...material, name: 'Concrete', grade: 'C35', category: 'concrete' }
        : material
    ));
    model.elements = model.elements.map((element) => (
      element.material === '1'
        ? { ...element, concrete_grade: 'C35' }
        : element
    ));

    const payload = runPkpmRuntime(model);

    expect(payload.result.summary.materialFamily).toBe('concrete');
    expect(payload.calls).toContainEqual(expect.objectContaining({
      method: 'ProjectPara.SetParaInt',
      key: 103,
      value: 10301,
    }));
    expect(findCalls(payload, 'Column.SetConcreteGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['C35']));
    expect(findCalls(payload, 'Beam.SetConcreteGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['C35']));
    expect(findCalls(payload, 'Beam.SetSteelGrade')).toHaveLength(0);
  });

  test('passes V2 seismic and wind design conditions into PKPM design parameters', () => {
    const model = buildRcUserScenarioModel();
    model.site_seismic = {
      intensity: 7,
      design_group: '第三组',
      site_category: 'III',
      characteristic_period: 0.65,
      max_influence_coefficient: 0.08,
      damping_ratio: 0.05,
    };
    model.wind = {
      basic_pressure: 0.4,
      terrain_roughness: 'B',
      shape_factor: 1.3,
    };
    model.analysis_control = {
      p_delta: false,
      rigid_floor: true,
      consideration_torsion: true,
    };

    const payload = runPkpmRuntime(model);
    const designParams = findCalls(payload, 'Model.SetAllDesignPara').at(-1).values;

    expect(designParams[24]).toBe(3);
    expect(designParams[25]).toBe(7);
    expect(designParams[26]).toBe(3);
    expect(designParams[33]).toBe(0.4);
    expect(designParams[34]).toBe(2);
    expect(designParams[35]).toBe(1);
    expect(designParams[37]).toBe(1.3);
    expect(findCalls(payload, 'ProjectPara.SetParaDouble')).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 202, value: 0.4 }),
      expect.objectContaining({ key: 312, value: 0.65 }),
      expect.objectContaining({ key: 313, value: 0.08 }),
    ]));
    expect(findCalls(payload, 'ProjectPara.SetParaInt')).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 301, value: 2 }),
      expect.objectContaining({ key: 303, value: 3 }),
      expect.objectContaining({ key: 201, value: 2 }),
    ]));
    expect(payload.result.summary.designConditions).toMatchObject({
      site_seismic: {
        intensity: 7,
        design_group: '第三组',
        site_category: 'III',
      },
      wind: {
        basic_pressure: 0.4,
        terrain_roughness: 'B',
      },
    });
    expect(payload.result.pkpm_detailed.input_design_conditions.wind).toMatchObject({
      basic_pressure: 0.4,
    });
  });

  test('keeps PKPM result when PDB version warning is present but core results are readable', () => {
    const payload = runPkpmRuntime(buildRcUserScenarioModel(), {
      createPdbMismatchDuringExtract: true,
    });

    expect(payload.result.status).toBe('success');
    expect(payload.result.warnings.join('\n')).toContain('PDB version warning');
    expect(payload.result.warnings.join('\n')).toContain('20250310');
    expect(payload.result.warnings.join('\n')).toContain('20251220');
    expect(payload.result.summary.floors_analyzed).toBe(2);
  });

  test('fails when PKPM result extraction fails with a PDB version mismatch', () => {
    const payload = runPkpmRuntime(buildRcUserScenarioModel(), {
      createPdbMismatchDuringExtract: true,
      failExtract: true,
      expectFailure: true,
    });

    expect(payload.result).toBeUndefined();
    expect(payload.errorType).toBe('RuntimeError');
    expect(payload.error).toContain('PDB version mismatch');
    expect(payload.error).toContain('20250310');
    expect(payload.error).toContain('20251220');
    expect(payload.error).toContain('JWSCYCLE.exe');
    expect(payload.error).toContain('APIPyInterface');
  });

  test('surfaces readable PKPM probe PDB warnings without deleted temp paths', () => {
    const payload = runPkpmProbe({ createPdbMismatch: true });

    expect(payload.passed).toBe(true);
    expect(payload.warnings.join('\n')).toContain('PDB version warning');
    expect(payload.warnings.join('\n')).toContain('20250310');
    expect(payload.warnings.join('\n')).toContain('20251220');
    expect(payload.warnings.join('\n')).not.toContain('workDir=');
    expect(payload.warnings.join('\n')).not.toContain('errFile=');
    expect(payload.steps).toContainEqual(expect.objectContaining({
      name: 'Extract results',
      passed: true,
      details: 'modePeriods=3, beams=1, columns=2',
    }));
  });

  test('parses WMASS damping as ratio and percent separately', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sclaw-pkpm-wmass-'));
    try {
      writeFile(path.join(workDir, 'WMASS.OUT'), [
        'WO = 0.40',
        'NAF = 7.00',
        'NMODE = 6',
        'DAMP = 5.00',
      ].join('\n'));
      const script = [
        'import json, sys, types',
        'from pathlib import Path',
        'contracts = types.ModuleType("contracts")',
        'class EngineNotAvailableError(RuntimeError): pass',
        'contracts.EngineNotAvailableError = EngineNotAvailableError',
        'sys.modules["contracts"] = contracts',
        'from runtime import _read_wmass_design_params',
        'print(json.dumps(_read_wmass_design_params(Path(sys.argv[1])), ensure_ascii=False))',
      ].join('\n');
      const result = spawnSync(
        pythonCommand.executable,
        [...pythonCommand.args, '-c', script, workDir],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONPATH: [runtimeSupportDir, pkpmDir, process.env.PYTHONPATH]
              .filter(Boolean)
              .join(path.delimiter),
          },
          windowsHide: process.platform === 'win32',
        },
      );

      if (result.status !== 0) {
        throw new Error(`WMASS parser probe failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      }
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.damping_ratio).toBeCloseTo(0.05);
      expect(parsed.damping_ratio_percent).toBeCloseTo(5);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  test('ignores malformed PKPM design-condition containers', () => {
    const model = buildRcUserScenarioModel();
    model.site_seismic = 'not-a-map';
    model.wind = ['not-a-map'];
    model.analysis_control = {
      design_params: {
        pkpm: {
          satwe_indices: ['not-a-map'],
        },
      },
    };

    const payload = runPkpmRuntime(model);

    expect(payload.result.status).toBe('success');
    expect(findCalls(payload, 'Model.SetAllDesignPara')).toHaveLength(0);
    expect(payload.result.pkpm_detailed.input_design_conditions).toMatchObject({
      site_seismic: {},
      wind: {},
    });
  });

  test('accepts generic rectangular section properties for PKPM concrete sections', () => {
    const payload = runPkpmRuntime(buildGenericRcFrameModelWithLegacyRectSections());

    expect(payload.result.status).toBe('success');
    expect(payload.result.summary.materialFamily).toBe('concrete');
    expect(findCalls(payload, 'ColumnSection.SetUserSect')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'IDSec_Rectangle',
        shape: expect.objectContaining({ B: 600, H: 600, M: 6 }),
      }),
    ]));
    expect(findCalls(payload, 'BeamSection.SetUserSect')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'IDSec_Rectangle',
        shape: expect.objectContaining({ B: 500, H: 250, M: 6 }),
      }),
    ]));
    expect(findCalls(payload, 'Column.SetConcreteGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['C30']));
    expect(findCalls(payload, 'Beam.SetConcreteGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['C30']));
    expect(findCalls(payload, 'Column.SetSteelGrade')).toHaveLength(0);
    expect(findCalls(payload, 'Beam.SetSteelGrade')).toHaveLength(0);
  });

  test('normalizes generic y-up RC frame drafts before PKPM conversion', () => {
    const payload = runPkpmRuntime(buildGenericYUpRcFrameModel());
    const nodeCoords = findCalls(payload, 'StandFloor.AddNode').map((call) => ({ x: call.x, y: call.y }));

    expect(payload.result.status).toBe('success');
    expect(payload.result.summary.materialFamily).toBe('concrete');
    expect(findCalls(payload, 'RealFloor.SetFloorHeight').map((call) => call.height)).toEqual([3600, 3600]);
    expect(findCalls(payload, 'StandFloor.AddColumn')).toHaveLength(6);
    expect(findCalls(payload, 'StandFloor.AddBeamEx')).toHaveLength(14);
    expect(findCalls(payload, 'ColumnSection.SetUserSect')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'IDSec_Rectangle',
        shape: expect.objectContaining({ B: 600, H: 600, M: 6 }),
      }),
    ]));
    expect(findCalls(payload, 'BeamSection.SetUserSect')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'IDSec_Rectangle',
        shape: expect.objectContaining({ B: 500, H: 250, M: 6 }),
      }),
    ]));
    expect(findCalls(payload, 'Column.SetConcreteGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['C30']));
    expect(findCalls(payload, 'Beam.SetConcreteGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['C30']));
    expect(nodeCoords).toEqual(expect.arrayContaining([
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 12000, y: 0 },
      { x: 0, y: 6000 },
      { x: 6000, y: 6000 },
      { x: 12000, y: 6000 },
    ]));
  });

  test('keeps steel-frame PKPM flow on steel sections and steel SATWE material', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'frame',
      skillId: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 2,
      storyHeightsM: [3.6, 3.6],
      bayWidthsM: [6, 6],
      floorLoads: [
        { story: 1, verticalKN: 180 },
        { story: 2, verticalKN: 180 },
      ],
      frameBaseSupportType: 'fixed',
      frameMaterial: 'Q355',
      frameColumnSection: 'HW300X300',
      frameBeamSection: 'HN300X150',
    });
    expect(model).toBeDefined();

    const payload = runPkpmRuntime(model);

    expect(payload.result.summary.materialFamily).toBe('steel');
    expect(payload.patchCalls).toHaveLength(1);
    expect(payload.calls).toContainEqual(expect.objectContaining({
      method: 'ProjectPara.SetParaInt',
      key: 103,
      value: 10303,
    }));
    expect(findCalls(payload, 'ColumnSection.SetUserSect')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'IDSec_I',
        shape: expect.objectContaining({ M: 5 }),
      }),
    ]));
    expect(findCalls(payload, 'BeamSection.SetUserSect')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'IDSec_I',
        shape: expect.objectContaining({ M: 5 }),
      }),
    ]));
    expect(findCalls(payload, 'Column.SetSteelGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['Q355']));
    expect(findCalls(payload, 'Beam.SetSteelGrade').map((call) => call.grade)).toEqual(expect.arrayContaining(['Q355']));
    expect(findCalls(payload, 'Column.SetConcreteGrade')).toHaveLength(0);
    expect(findCalls(payload, 'Beam.SetConcreteGrade')).toHaveLength(0);
  });
});
