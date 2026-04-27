import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function resolvePython() {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(repoRoot, 'backend', '.venv', 'Scripts', 'python.exe'),
          'python',
          'py',
        ]
      : [
          path.join(repoRoot, 'backend', '.venv', 'bin', 'python'),
          'python3',
          'python',
        ];

  for (const candidate of candidates) {
    const args = candidate === 'py' ? ['-3', '-c', 'import sys; print(sys.executable)'] : ['-c', 'import sys; print(sys.executable)'];
    const result = spawnSync(candidate, args, {
      encoding: 'utf8',
      windowsHide: process.platform === 'win32',
    });
    const executable = result.stdout.trim();
    if (result.status === 0 && executable && fs.existsSync(executable)) {
      return candidate === 'py' ? { executable: candidate, args: ['-3'] } : { executable: candidate, args: [] };
    }
  }
  return null;
}

describe('YJK result normalization', () => {
  const python = resolvePython();

  if (!python) {
    test.skip('normalizes YJK extracted load cases, reactions, and member forces (no Python)', () => {});
    return;
  }

  test('normalizes YJK extracted load cases, reactions, and member forces', () => {
    const script = String.raw`
import importlib.util
from pathlib import Path

driver_path = Path(r"${repoRoot}") / "backend" / "src" / "agent-skills" / "analysis" / "yjk-static" / "yjk_driver.py"
spec = importlib.util.spec_from_file_location("yjk_driver_under_test", driver_path)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

mapping = {
    "nodes": {
        "N1": {"v2_id": "N1", "yjk_std_floor_node_id": 101, "x_mm": 0, "y_mm": 0, "z_mm": 0},
        "N2": {"v2_id": "N2", "yjk_std_floor_node_id": 102, "x_mm": 6000, "y_mm": 0, "z_mm": 0},
    },
    "elements": {
        "B1": {
            "v2_id": "B1",
            "type": "beam",
            "floor_index": 1,
            "nodes": ["N1", "N2"],
            "fallback_match": {"sequence_in_floor_type": 1},
        },
    },
}

extracted = {
    "meta": {"n_floors": 1, "n_nodes": 2, "load_cases": [101]},
    "load_cases": [{"id": 101, "key": "lc_101", "name": "DL", "expName": "Dead", "kind": 1, "oldId": 1}],
    "nodes": [{"id": 101, "x": 0, "y": 0, "z": 0}, {"id": 102, "x": 6000, "y": 0, "z": 0}],
    "node_disp": {"lc_101": [{"id": 101, "ux": 1.25, "uy": 0, "uz": 0, "rx": 0, "ry": 0, "rz": 0}]},
    "node_reactions": {"lc_101": [{"id": 101, "fx": 10, "fy": 20, "fz": 30, "mx": 1, "my": 2, "mz": 3}]},
    "members": {
        "columns": [],
        "beams": [{"id": 500, "tot_id": 500, "floor": 1, "node_i": 101, "node_j": 102, "sequence": 1}],
        "braces": [],
    },
    "member_forces": {
        "columns": {"lc_101": []},
        "beams": {"lc_101": [{"id": 500, "tot_id": 500, "floor": 1, "sequence": 1, "sections": [[1, 2, 3, 4, 5, 6]]}]},
        "braces": {"lc_101": []},
    },
    "floor_stats": [],
}

result = driver._build_analysis_result(
    extracted=extracted,
    mapping=mapping,
    ydb_path="model.ydb",
    yjk_project="model.yjk",
    work_dir="work",
    results_path="results.json",
    steps=[],
)

assert result["displacements"]["N1"]["ux"] == 1.25
assert result["reactions"]["N1"]["Fx"] == 10
assert result["forces"]["B1"]["N"] == 5
assert result["caseResults"]["lc_101"]["name"] == "DL"
assert result["caseResults"]["lc_101"]["reactions"]["N1"]["R"] > 0
assert result["envelopeTables"]["nodeReaction"]["N1"]["maxAbsReaction"] > 0
print("ok")
`;

    const result = spawnSync(python.executable, [...python.args, '-c', script], {
      encoding: 'utf8',
      windowsHide: process.platform === 'win32',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });

  test('serializes YJK extraction debug records with enum-like arguments', () => {
    const script = String.raw`
import importlib.util
import json
import os
from pathlib import Path

os.environ["SC_YJK_EXTRACT_NO_AUTORUN"] = "1"
extract_path = Path(r"${repoRoot}") / "backend" / "src" / "agent-skills" / "analysis" / "yjk-static" / "extract_results.py"
spec = importlib.util.spec_from_file_location("extract_results_under_test", extract_path)
extract_results = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract_results)

class FakePostGjKind:
    def __str__(self):
        return "PostGjKind.COM_COLUMN"

debug = extract_results._new_debug()
extract_results._record_api(
    debug,
    "YJKSDsnDataPy.dsnGetComStdNL",
    False,
    error=RuntimeError("boom"),
    args=(1, FakePostGjKind(), 12, 3, 1),
)
payload = json.dumps(debug, ensure_ascii=False)
assert "PostGjKind.COM_COLUMN" in payload
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
