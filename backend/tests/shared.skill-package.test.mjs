import { describe, expect, test } from '@jest/globals';
import {
  BUILTIN_SKILL_PACKAGE_VERSION,
  normalizeBuiltInManifestToSkillPackage,
  normalizeSkillHubCatalogEntryToSkillPackage,
} from '../dist/agent-skills/shared/package.js';
import { manifest as frameManifest } from '../dist/agent-skills/structure-modeling/frame/manifest.js';
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
  });
});
