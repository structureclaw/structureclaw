import type { ManifestBackedSkillProvider, SkillProviderSource } from '../../skill-shared/provider.js';
import type { SkillPackageMetadata } from '../../skill-shared/package.js';
import type { AgentSkillPlugin, SkillHandler, SkillManifest } from '../../agent-runtime/types.js';

export interface StructureModelingProvider extends ManifestBackedSkillProvider<'structure-type', SkillManifest> {
  handler: SkillHandler;
  plugin: AgentSkillPlugin;
}

export interface StructureModelingProviderModule {
  manifest: SkillManifest;
  handler: SkillHandler;
}

export function validateStructureModelingProviderModule(module: unknown): string[] {
  if (!module || typeof module !== 'object') {
    return ['module must be an object'];
  }

  const candidate = module as {
    manifest?: unknown;
    handler?: unknown;
  };
  const errors: string[] = [];
  if (!candidate.manifest || typeof candidate.manifest !== 'object') {
    errors.push('manifest export is required');
  }
  if (!candidate.handler || typeof candidate.handler !== 'object') {
    errors.push('handler export is required');
  }

  const handler = candidate.handler as Partial<SkillHandler> | undefined;
  const requiredMethods: Array<keyof SkillHandler> = [
    'detectStructuralType',
    'parseProvidedValues',
    'extractDraft',
    'mergeState',
    'computeMissing',
    'mapLabels',
    'buildQuestions',
    'buildModel',
  ];
  for (const method of requiredMethods) {
    if (typeof handler?.[method] !== 'function') {
      errors.push(`handler.${String(method)} must be a function`);
    }
  }

  return errors;
}

export function toStructureModelingProviderFromModule(
  pkg: SkillPackageMetadata,
  module: StructureModelingProviderModule,
): StructureModelingProvider {
  const manifest: SkillManifest = {
    ...module.manifest,
  };
  const plugin: AgentSkillPlugin = {
    ...manifest,
    markdownByStage: {},
    manifest,
    handler: module.handler,
  };

  return {
    id: plugin.id,
    domain: 'structure-type',
    source: pkg.source,
    priority: pkg.priority ?? manifest.priority,
    manifest,
    handler: module.handler,
    plugin,
  };
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
    domain: 'structure-type',
    source: options?.source ?? 'builtin',
    priority: options?.priority ?? plugin.manifest.priority,
    manifest: plugin.manifest,
    handler: plugin.handler,
    plugin,
  };
}
