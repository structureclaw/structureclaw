import type { AgentSkillPlugin } from '../../agent-runtime/types.js';
import { loadExecutableSkillProviders, loadSkillProviders } from '../../skill-shared/loader.js';
import type { SkillPackageMetadata } from '../../skill-shared/package.js';
import {
  toStructureModelingProvider,
  toStructureModelingProviderFromModule,
  validateStructureModelingProviderModule,
  type StructureModelingProvider,
  type StructureModelingProviderModule,
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

export async function loadStructureModelingExecutableProviders(options: {
  packages?: SkillPackageMetadata[];
  importModule: (specifier: string, pkg: SkillPackageMetadata) => Promise<StructureModelingProviderModule>;
}): Promise<{
  providers: StructureModelingProvider[];
  failures: Array<{
    packageId: string;
    packageVersion: string;
    domain: SkillPackageMetadata['domain'];
    source: SkillPackageMetadata['source'];
    stage: 'entrypoint' | 'import' | 'validate';
    reason: 'missing_entrypoint' | 'import_failed' | 'invalid_provider';
    detail?: string;
  }>;
}> {
  return loadExecutableSkillProviders({
    packages: options.packages,
    entrypointKey: 'structureModeling',
    importModule: options.importModule,
    validateModule: (module) => validateStructureModelingProviderModule(module),
    buildProvider: (module, pkg) => toStructureModelingProviderFromModule(pkg, module),
  });
}
