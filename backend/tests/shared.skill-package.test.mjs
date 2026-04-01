import { describe, expect, test } from '@jest/globals';
import {
  BUILTIN_SKILL_PACKAGE_VERSION,
  normalizeBuiltInManifestToSkillPackage,
  normalizeSkillHubCatalogEntryToSkillPackage,
} from '../dist/skill-shared/package.js';
import { resolveToolingForSkillManifests } from '../dist/agent-runtime/tool-registry.js';
import { manifest as frameManifest } from '../dist/agent-skills/structure-type/frame/manifest.js';
import { manifest as genericManifest } from '../dist/agent-skills/structure-type/generic/manifest.js';
import { AgentSkillHubService } from '../dist/services/agent-skillhub.js';

describe('shared skill package metadata', () => {
  test('should normalize built-in manifests into shared package metadata', () => {
    const pkg = normalizeBuiltInManifestToSkillPackage(frameManifest);

    expect(pkg.id).toBe('frame');
    expect(pkg.domain).toBe('structure-type');
    expect(pkg.version).toBe(BUILTIN_SKILL_PACKAGE_VERSION);
    expect(pkg.source).toBe('builtin');
    expect(pkg.entrypoints).toEqual({
      manifest: 'manifest',
      handler: 'handler',
    });
    expect(pkg.enabledTools).toEqual(['draft_model', 'update_model']);
    expect(pkg.providedTools).toEqual([]);
    expect(pkg.enabledByDefault).toBe(true);
    expect(pkg.priority).toBe(70);
  });

  test('should normalize skillhub catalog entries into shared package metadata', async () => {
    const skillHub = new AgentSkillHubService();
    const result = await skillHub.search({ domain: 'code-check' });
    const entry = result.items.find((item) => item.id === 'skillhub.steel-connection-check');

    expect(entry).toBeDefined();
    expect(entry.packageMetadata).toBeDefined();
    expect(entry.packageMetadata.id).toBe('skillhub.steel-connection-check');
    expect(entry.packageMetadata.domain).toBe('code-check');
    expect(entry.packageMetadata.version).toBe('1.0.0');
    expect(entry.packageMetadata.source).toBe('skillhub');
    expect(entry.packageMetadata.enabledByDefault).toBe(false);
    expect(entry.packageMetadata.entrypoints).toEqual({
      codeCheck: 'dist/code-check.js',
    });

    const direct = normalizeSkillHubCatalogEntryToSkillPackage({
      id: entry.id,
      version: entry.version,
      domain: entry.domain,
      entrypoints: entry.entrypoints,
      name: entry.name,
      description: entry.description,
      capabilities: entry.capabilities,
      compatibility: {
        minRuntimeVersion: entry.packageMetadata.compatibility.minRuntimeVersion,
        skillApiVersion: entry.packageMetadata.compatibility.skillApiVersion,
      },
      integrity: entry.integrity,
    });

    expect(direct.id).toBe(entry.packageMetadata.id);
    expect(direct.compatibility.skillApiVersion).toBe(entry.packageMetadata.compatibility.skillApiVersion);
    expect(direct.entrypoints).toEqual(entry.packageMetadata.entrypoints);
    expect(direct.enabledTools).toEqual([]);
    expect(direct.providedTools).toEqual([]);
  });

  test('should apply safe defaults when manifest has minimal optional fields', () => {
    const minimal = {
      id: 'minimal-skill',
      structureType: 'beam',
      name: { zh: '最小', en: 'Minimal' },
      description: { zh: '', en: '' },
      triggers: [],
      stages: ['draft'],
      autoLoadByDefault: false,
      scenarioKeys: [],
      domain: 'structure-type',
      requires: [],
      conflicts: [],
      capabilities: [],
      priority: 0,
      compatibility: {},
    };

    const pkg = normalizeBuiltInManifestToSkillPackage(minimal);

    expect(pkg.id).toBe('minimal-skill');
    expect(pkg.version).toBe(BUILTIN_SKILL_PACKAGE_VERSION);
    expect(pkg.source).toBe('builtin');
    expect(pkg.enabledByDefault).toBe(false);
    expect(pkg.priority).toBe(0);
    expect(pkg.requires).toEqual([]);
    expect(pkg.conflicts).toEqual([]);
    expect(pkg.capabilities).toEqual([]);
    expect(pkg.supportedAnalysisTypes).toEqual([]);
    expect(pkg.materialFamilies).toEqual([]);
    expect(pkg.compatibility.minRuntimeVersion).toBe('0.1.0');
    expect(pkg.compatibility.skillApiVersion).toBe('v1');
    expect(pkg.supportedLocales).toEqual(['zh', 'en']);
  });

  test('should use custom entrypoints and version when provided as options', () => {
    const minimal = {
      id: 'custom-entry',
      structureType: 'frame',
      name: { zh: '自定义入口', en: 'Custom Entry' },
      description: { zh: '', en: '' },
      triggers: [],
      stages: ['draft'],
      autoLoadByDefault: true,
      scenarioKeys: [],
      domain: 'structure-type',
      requires: [],
      conflicts: [],
      capabilities: ['modeling'],
      priority: 50,
      compatibility: {
        minRuntimeVersion: '1.0.0',
        skillApiVersion: 'v2',
      },
    };

    const pkg = normalizeBuiltInManifestToSkillPackage(minimal, {
      version: '2.0.0-custom',
      entrypoints: { handler: 'custom-handler', manifest: 'custom-manifest' },
    });

    expect(pkg.version).toBe('2.0.0-custom');
    expect(pkg.entrypoints).toEqual({
      handler: 'custom-handler',
      manifest: 'custom-manifest',
    });
    expect(pkg.compatibility.minRuntimeVersion).toBe('1.0.0');
    expect(pkg.compatibility.skillApiVersion).toBe('v2');
  });

  test('should handle undefined requires, conflicts, and capabilities gracefully', () => {
    const manifest = {
      id: 'no-arrays',
      structureType: 'truss',
      name: { zh: '无数组', en: 'No Arrays' },
      description: { zh: '', en: '' },
      triggers: [],
      stages: ['draft'],
      autoLoadByDefault: false,
      scenarioKeys: [],
      domain: 'structure-type',
      priority: 10,
      compatibility: {},
    };

    const pkg = normalizeBuiltInManifestToSkillPackage(manifest);

    expect(pkg.requires).toEqual([]);
    expect(pkg.conflicts).toEqual([]);
    expect(pkg.capabilities).toEqual([]);
    expect(pkg.supportedAnalysisTypes).toEqual([]);
    expect(pkg.materialFamilies).toEqual([]);
  });

  test('should resolve tooling from selected skill manifests', () => {
    const tooling = resolveToolingForSkillManifests([frameManifest, genericManifest], ['generic']);

    expect([...tooling.enabledToolIdsBySkill.generic].sort()).toEqual([
      'draft_model',
      'update_model',
    ]);
    expect([...tooling.tools.map((tool) => tool.id)].sort()).toEqual([
      'draft_model',
      'update_model',
    ]);
    expect(tooling.skillIdsByToolId.draft_model).toEqual(['generic']);
  });
});
