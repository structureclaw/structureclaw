import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..');
const makeScriptPath = path.join(repoRoot, 'make.ps1');
const makefilePath = path.join(repoRoot, 'Makefile');
const analysisRequirementsPath = path.join(
  repoRoot,
  'backend',
  'src',
  'agent-skills',
  'analysis',
  'runtime',
  'requirements.txt',
);

describe('windows make analysis python paths', () => {
  test('should point Windows setup-analysis-python to the current analysis requirements file', () => {
    const script = fs.readFileSync(makeScriptPath, 'utf8');

    expect(fs.existsSync(analysisRequirementsPath)).toBe(true);
    expect(script).toContain("Join-Path $RootDir 'backend/src/agent-skills/analysis'");
    expect(script).toContain("$AnalysisRequirementsFile = Join-Path $AnalysisPythonRoot 'requirements.txt'");
    expect(script).toContain('& uv pip install --python $AnalysisPython --link-mode=copy -r $AnalysisRequirementsFile');
    expect(script).toContain("Join-Path $RootDir 'backend/src/agent-skills/data-input'");
    expect(script).toContain("Join-Path $RootDir 'backend/src/agent-skills/material'");
    expect(script).not.toContain('backend/src/agent-skills/analysis-execution/python/requirements.txt');
    expect(script).not.toContain("Join-Path $RootDir 'backend/src/agent-skills/geometry-input'");
    expect(script).not.toContain("Join-Path $RootDir 'backend/src/agent-skills/material-constitutive'");
  });

  test('should keep Makefile analysis setup aligned with the same requirements file', () => {
    const makefile = fs.readFileSync(makefilePath, 'utf8');

    expect(makefile).toContain('backend/src/agent-skills/analysis/runtime/requirements.txt');
    expect(makefile).not.toContain('backend/src/agent-skills/analysis-execution/python/requirements.txt');
  });
});
