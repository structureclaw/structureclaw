import type { ManifestBackedSkillProvider, SkillProviderSource } from '../shared/provider.js';
import type { AgentSkillPlugin, SkillHandler, SkillManifest } from '../runtime/types.js';

export interface StructureModelingProvider extends ManifestBackedSkillProvider<'structure-modeling', SkillManifest> {
  handler: SkillHandler;
  plugin: AgentSkillPlugin;
}

export function toStructureModelingProvider(
  plugin: AgentSkillPlugin,
  options?: {
    source?: SkillProviderSource;
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
