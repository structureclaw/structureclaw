import type { AgentSkillPlugin } from '../runtime/types.js';
import { loadSkillProviders } from '../shared/loader.js';
import { toStructureModelingProvider, type StructureModelingProvider } from './provider.js';

export function listStructureModelingProviders(options?: {
  builtInPlugins?: AgentSkillPlugin[];
  externalProviders?: StructureModelingProvider[];
}): StructureModelingProvider[] {
  const builtInProviders = (options?.builtInPlugins ?? []).map((plugin) => toStructureModelingProvider(plugin));
  return loadSkillProviders({
    builtInProviders,
    externalProviders: options?.externalProviders,
    priorityOrder: 'desc',
  });
}
