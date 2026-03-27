import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUILTIN_ANALYSIS_ENGINES,
  BUILTIN_ANALYSIS_RUNTIME_ADAPTER_KEYS,
  BUILTIN_ANALYSIS_SKILLS,
  getBuiltinAnalysisSkill,
} from '../dist/agent-skills/analysis/entry.js';

const repoRoot = path.resolve(process.cwd(), '..');
const analysisRoot = path.join(repoRoot, 'backend', 'src', 'agent-skills', 'analysis');

describe('analysis skill registry', () => {
  test('should discover builtin analysis skills directly from skill directories', () => {
    expect(BUILTIN_ANALYSIS_SKILLS.length).toBeGreaterThan(0);
    const discoveredDirs = fs.readdirSync(analysisRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'runtime')
      .filter((entry) => fs.existsSync(path.join(analysisRoot, entry.name, 'intent.md')))
      .filter((entry) => fs.existsSync(path.join(analysisRoot, entry.name, 'runtime.py')))
      .map((entry) => entry.name)
      .sort();

    expect(BUILTIN_ANALYSIS_SKILLS.map((skill) => skill.id).sort()).toEqual(discoveredDirs);

    for (const skill of BUILTIN_ANALYSIS_SKILLS) {
      const intentPath = path.join(analysisRoot, skill.id, 'intent.md');
      const runtimePath = path.join(analysisRoot, skill.id, 'runtime.py');
      expect(fs.existsSync(intentPath)).toBe(true);
      expect(fs.existsSync(runtimePath)).toBe(true);
      expect(getBuiltinAnalysisSkill(skill.id)?.id).toBe(skill.id);
      expect(skill.runtimeRelativePath).toBe('runtime.py');
      expect(skill.stages).toEqual(['analysis']);
    }
  });

  test('should derive runtime adapter keys from builtin analysis engines', () => {
    expect(BUILTIN_ANALYSIS_ENGINES.map((engine) => engine.id)).toEqual([
      'builtin-opensees',
      'builtin-simplified',
    ]);
    expect(BUILTIN_ANALYSIS_RUNTIME_ADAPTER_KEYS).toEqual([
      'builtin-opensees',
      'builtin-simplified',
    ]);
    expect(BUILTIN_ANALYSIS_ENGINES[0].skillIds).toContain('opensees-static');
    expect(BUILTIN_ANALYSIS_ENGINES[1].skillIds).toContain('simplified-static');
  });
});
