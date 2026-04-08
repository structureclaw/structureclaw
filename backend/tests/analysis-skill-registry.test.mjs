import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUILTIN_ANALYSIS_ENGINES,
  BUILTIN_ANALYSIS_RUNTIME_ADAPTER_KEYS,
} from '../dist/agent-skills/analysis/entry.js';
import { AgentSkillCatalogService } from '../dist/services/agent-skill-catalog.js';

const repoRoot = path.resolve(process.cwd(), '..');
const analysisRoot = path.join(repoRoot, 'backend', 'src', 'agent-skills', 'analysis');

describe('analysis skill registry', () => {
  test('should discover builtin analysis skills from manifest-backed catalog entries', async () => {
    const skillCatalog = new AgentSkillCatalogService();
    const analysisSkills = (await skillCatalog.listBuiltinSkills())
      .filter((skill) => skill.domain === 'analysis')
      .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));

    expect(analysisSkills.length).toBeGreaterThan(0);
    const discoveredDirs = fs.readdirSync(analysisRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'runtime')
      .filter((entry) => fs.existsSync(path.join(analysisRoot, entry.name, 'skill.yaml')))
      .filter((entry) => fs.existsSync(path.join(analysisRoot, entry.name, 'runtime.py')))
      .map((entry) => entry.name)
      .sort();

    expect(analysisSkills.map((skill) => skill.canonicalId)).toEqual(discoveredDirs);

    for (const skill of analysisSkills) {
      const manifestPath = path.join(analysisRoot, skill.canonicalId, 'skill.yaml');
      const runtimePath = path.join(analysisRoot, skill.canonicalId, 'runtime.py');
      expect(fs.existsSync(manifestPath)).toBe(true);
      expect(fs.existsSync(runtimePath)).toBe(true);
      expect(skill.stages).toContain('analysis');
      expect(skill.enabledTools).toContain('run_analysis');
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
