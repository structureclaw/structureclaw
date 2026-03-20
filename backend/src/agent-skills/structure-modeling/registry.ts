import type { AgentSkillPlugin } from '../runtime/types.js';
import { toStructureModelingProvider, type StructureModelingProvider } from './provider.js';

function compareProviders(left: StructureModelingProvider, right: StructureModelingProvider): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  if (left.source !== right.source) {
    return left.source === 'builtin' ? -1 : 1;
  }
  return left.id.localeCompare(right.id);
}

function dedupeProviders(providers: StructureModelingProvider[]): StructureModelingProvider[] {
  const ordered = [...providers].sort(compareProviders);
  const byId = new Map<string, StructureModelingProvider>();
  for (const provider of ordered) {
    if (!byId.has(provider.id)) {
      byId.set(provider.id, provider);
    }
  }
  return [...byId.values()];
}

export function listStructureModelingProviders(options?: {
  builtInPlugins?: AgentSkillPlugin[];
  externalProviders?: StructureModelingProvider[];
}): StructureModelingProvider[] {
  const builtInProviders = (options?.builtInPlugins ?? []).map((plugin) => toStructureModelingProvider(plugin));
  const merged = dedupeProviders([
    ...builtInProviders,
    ...(options?.externalProviders ?? []),
  ]);
  return merged.sort(compareProviders);
}
