import { describe, expect, test } from '@jest/globals';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { AgentSkillRuntime } from '../dist/agent-runtime/index.js';
import { AgentSkillCatalogService } from '../dist/services/agent-skill-catalog.js';

async function writeSkillManifest(rootDir, relativeDir, skillId) {
  const skillDir = path.join(rootDir, relativeDir);
  await mkdir(skillDir, { recursive: true });
  const manifestPath = path.join(skillDir, 'skill.yaml');
  await writeFile(
    manifestPath,
    [
      `id: ${skillId}`,
      'domain: analysis',
      'source: builtin',
      'name:',
      '  zh: 缓存测试技能',
      '  en: Cache Test Skill',
      'description:',
      '  zh: 用于测试 manifest 缓存',
      '  en: Used to test manifest caching',
      'triggers: [cache]',
      'stages: [intent]',
      'structureType: generic',
      'structuralTypeKeys: [generic]',
      'capabilities: []',
      'requires: []',
      'conflicts: []',
      'autoLoadByDefault: false',
      'priority: 10',
      'compatibility:',
      '  minRuntimeVersion: 0.1.0',
      '  skillApiVersion: v1',
      'software: simplified',
      'analysisType: static',
      'engineId: simplified',
      'adapterKey: simplified-static',
      'runtimeRelativePath: runtime.py',
      'supportedAnalysisTypes: [static]',
      'supportedModelFamilies: [generic]',
      'materialFamilies: []',
      'toolHints: {}',
      'aliases: []',
    ].join('\n'),
  );
  return manifestPath;
}

describe('agent manifest caching', () => {
  test('should keep builtin runtime manifests after construction without rescanning the filesystem', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'structureclaw-runtime-cache-'));

    try {
      const manifestPath = await writeSkillManifest(tempRoot, path.join('analysis', 'cache-static'), 'cache-static');
      const runtime = new AgentSkillRuntime({ builtinSkillManifestRoot: tempRoot });

      await unlink(manifestPath);

      const manifests = await runtime.listSkillManifests();
      expect(manifests.some((entry) => entry.id === 'cache-static')).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('should cache builtin skill catalog entries after the first load', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'structureclaw-skill-catalog-cache-'));

    try {
      const manifestPath = await writeSkillManifest(tempRoot, path.join('analysis', 'cache-skill'), 'cache-skill');
      const service = new AgentSkillCatalogService(tempRoot);

      const first = await service.listBuiltinSkills();
      await unlink(manifestPath);
      const second = await service.listBuiltinSkills();

      expect(first.map((entry) => entry.canonicalId)).toEqual(['cache-skill']);
      expect(second.map((entry) => entry.canonicalId)).toEqual(['cache-skill']);
      expect(second).toBe(first);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

});
