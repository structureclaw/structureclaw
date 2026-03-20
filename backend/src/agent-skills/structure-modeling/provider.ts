import type { AgentSkillPlugin, SkillHandler, SkillManifest } from '../runtime/types.js';

export type StructureModelingProviderSource = 'builtin' | 'skillhub';

export interface StructureModelingProvider {
  id: string;
  domain: 'structure-modeling';
  source: StructureModelingProviderSource;
  priority: number;
  manifest: SkillManifest;
  handler: SkillHandler;
  plugin: AgentSkillPlugin;
}

export function toStructureModelingProvider(
  plugin: AgentSkillPlugin,
  options?: {
    source?: StructureModelingProviderSource;
    priority?: number;
  },
): StructureModelingProvider {
  return {
    id: plugin.id,
    domain: 'structure-modeling',
    source: options?.source ?? 'builtin',
    priority: options?.priority ?? plugin.manifest.priority,
    manifest: plugin.manifest,
    handler: plugin.handler,
    plugin,
  };
}
