import type { SkillManifest, ToolManifest } from './types.js';
import { loadToolManifestsFromDirectorySync, resolveBuiltinToolManifestRoot } from './tool-manifest-loader.js';

export interface ResolvedTooling {
  tools: ToolManifest[];
  enabledToolIdsBySkill: Record<string, string[]>;
  providedToolIdsBySkill: Record<string, string[]>;
  skillIdsByToolId: Record<string, string[]>;
}

const BUILTIN_TOOL_MANIFEST_ROOT = resolveBuiltinToolManifestRoot();

export function listBuiltinToolManifests(): ToolManifest[] {
  return loadToolManifestsFromDirectorySync(BUILTIN_TOOL_MANIFEST_ROOT).map((tool) => ({ ...tool }));
}

function inferEnabledToolsFromManifest(manifest: SkillManifest): string[] {
  if (!Array.isArray(manifest.enabledTools) || manifest.enabledTools.length === 0) {
    return [];
  }
  return [...manifest.enabledTools];
}

function assertKnownTool(
  builtinById: ReadonlyMap<string, ToolManifest>,
  toolId: string,
  skillId: string,
  relation: 'grant' | 'provide',
): ToolManifest {
  const builtin = builtinById.get(toolId);
  if (!builtin) {
    throw new Error(`Skill manifest '${skillId}' references unknown tool '${toolId}' via ${relation}. Add a tool.yaml for this tool before granting it.`);
  }
  return builtin;
}

function resolveRelevantSkillManifests(manifests: SkillManifest[], skillIds?: string[]): SkillManifest[] {
  if (skillIds === undefined) {
    return manifests.filter((manifest) => manifest.autoLoadByDefault);
  }
  if (skillIds.length === 0) {
    return [];
  }
  const selected = new Set(skillIds);
  return manifests.filter((manifest) => selected.has(manifest.id));
}

export function resolveToolingForSkillManifests(manifests: SkillManifest[], skillIds?: string[]): ResolvedTooling {
  const relevantManifests = resolveRelevantSkillManifests(manifests, skillIds);
  const builtinToolManifests = listBuiltinToolManifests();
  const builtinById = new Map(builtinToolManifests.map((tool) => [tool.id, tool]));
  const toolMap = new Map<string, ToolManifest>();
  const enabledToolIdsBySkill: Record<string, string[]> = {};
  const providedToolIdsBySkill: Record<string, string[]> = {};
  const skillIdsByToolId = new Map<string, Set<string>>();

  for (const manifest of relevantManifests) {
    const enabledToolIds = Array.from(new Set(inferEnabledToolsFromManifest(manifest)));
    const providedToolIds = Array.isArray(manifest.providedTools)
      ? Array.from(new Set(manifest.providedTools))
      : [];

    enabledToolIdsBySkill[manifest.id] = enabledToolIds;
    providedToolIdsBySkill[manifest.id] = providedToolIds;

    for (const toolId of [...enabledToolIds, ...providedToolIds]) {
      if (!skillIdsByToolId.has(toolId)) {
        skillIdsByToolId.set(toolId, new Set());
      }
      skillIdsByToolId.get(toolId)!.add(manifest.id);
    }

    for (const toolId of enabledToolIds) {
      const builtin = assertKnownTool(builtinById, toolId, manifest.id, 'grant');
      toolMap.set(toolId, { ...builtin });
    }

    for (const toolId of providedToolIds) {
      const builtin = assertKnownTool(builtinById, toolId, manifest.id, 'provide');
      toolMap.set(toolId, {
        ...builtin,
        providedBySkillId: builtin.providedBySkillId ?? manifest.id,
        requiresSkills: Array.from(new Set([...(builtin.requiresSkills || []), manifest.id])),
      });
    }
  }

  return {
    tools: Array.from(toolMap.values()).sort((left, right) => left.id.localeCompare(right.id)),
    enabledToolIdsBySkill,
    providedToolIdsBySkill,
    skillIdsByToolId: Array.from(skillIdsByToolId.entries()).reduce<Record<string, string[]>>((acc, [toolId, skillOwners]) => {
      acc[toolId] = Array.from(skillOwners).sort();
      return acc;
    }, {}),
  };
}
