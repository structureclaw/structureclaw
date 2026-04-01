import type { SkillManifest, ToolManifest } from './types.js';
import { BUILTIN_TOOL_MANIFESTS } from '../agent-tools/builtin/index.js';

function titleize(value: string): string {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export interface ResolvedTooling {
  tools: ToolManifest[];
  enabledToolIdsBySkill: Record<string, string[]>;
  providedToolIdsBySkill: Record<string, string[]>;
  skillIdsByToolId: Record<string, string[]>;
}

export function listBuiltinToolManifests(): ToolManifest[] {
  return BUILTIN_TOOL_MANIFESTS.map((tool) => ({ ...tool }));
}

function inferEnabledToolsFromManifest(manifest: SkillManifest): string[] {
  if (!Array.isArray(manifest.enabledTools) || manifest.enabledTools.length === 0) {
    return [];
  }
  return [...manifest.enabledTools];
}

function createSkillProvidedTool(toolId: string, skillId: string): ToolManifest {
  return {
    id: toolId,
    source: 'external',
    enabledByDefault: false,
    displayName: {
      zh: titleize(toolId),
      en: titleize(toolId),
    },
    description: {
      zh: `${skillId} skill 提供的扩展 tool。`,
      en: `Extension tool provided by the ${skillId} skill.`,
    },
    providedBySkillId: skillId,
    requiresSkills: [skillId],
    tags: ['external-provided'],
    errorCodes: [],
  };
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
  const builtinById = new Map(BUILTIN_TOOL_MANIFESTS.map((tool) => [tool.id, tool]));
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
      const builtin = builtinById.get(toolId);
      toolMap.set(toolId, builtin ? { ...builtin } : createSkillProvidedTool(toolId, manifest.id));
    }

    for (const toolId of providedToolIds) {
      const builtin = builtinById.get(toolId);
      toolMap.set(toolId, builtin
        ? {
          ...builtin,
          providedBySkillId: builtin.providedBySkillId ?? manifest.id,
          requiresSkills: Array.from(new Set([...(builtin.requiresSkills || []), manifest.id])),
        }
        : createSkillProvidedTool(toolId, manifest.id));
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
