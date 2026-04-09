import type { AgentSkillPlugin } from '../../agent-runtime/types.js';
import { loadSkillProviders } from '../../skill-shared/loader.js';
import {
  toStructureModelingProvider,
  type StructureModelingProvider,
} from './provider.js';

export function listStructureModelingProviders(options?: {
  builtInPlugins?: AgentSkillPlugin[];
  externalProviders?: StructureModelingProvider[];
}): StructureModelingProvider[] {
  const builtInProviders = (options?.builtInPlugins ?? [])
    .filter((plugin) => plugin.manifest.domain === 'structure-type')
    .map((plugin) => toStructureModelingProvider(plugin));
  return loadSkillProviders({
    builtInProviders,
    externalProviders: options?.externalProviders,
    priorityOrder: 'desc',
  });
}
