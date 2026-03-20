import type { BaseSkillProvider } from './provider.js';
import type { SkillPackageMetadata } from './package.js';

type SkillProviderPriorityOrder = 'asc' | 'desc';

export interface LoadSkillProvidersOptions<TProvider extends BaseSkillProvider<string>> {
  builtInProviders?: TProvider[];
  externalProviders?: TProvider[];
  priorityOrder?: SkillProviderPriorityOrder;
  filter?: (provider: TProvider) => boolean;
  finalize?: (providers: TProvider[]) => TProvider[];
}

export interface ExecutableSkillProviderLoadFailure<TPackage extends SkillPackageMetadata<string>> {
  packageId: string;
  packageVersion: string;
  domain: TPackage['domain'];
  source: TPackage['source'];
  stage: 'entrypoint' | 'import' | 'validate';
  reason: 'missing_entrypoint' | 'import_failed' | 'invalid_provider';
  detail?: string;
}

export interface LoadExecutableSkillProvidersOptions<
  TPackage extends SkillPackageMetadata<string>,
  TModule,
  TProvider extends BaseSkillProvider<string>,
> {
  packages?: TPackage[];
  entrypointKey: string;
  importModule: (specifier: string, pkg: TPackage) => Promise<TModule>;
  validateModule?: (module: TModule, pkg: TPackage) => string[];
  buildProvider: (module: TModule, pkg: TPackage) => TProvider;
}

export function compareSkillProviders<TProvider extends BaseSkillProvider<string>>(
  left: TProvider,
  right: TProvider,
  priorityOrder: SkillProviderPriorityOrder = 'desc',
): number {
  if (left.priority !== right.priority) {
    return priorityOrder === 'asc'
      ? left.priority - right.priority
      : right.priority - left.priority;
  }
  if (left.source !== right.source) {
    return left.source === 'builtin' ? -1 : 1;
  }
  return left.id.localeCompare(right.id);
}

export function loadSkillProviders<TProvider extends BaseSkillProvider<string>>(
  options?: LoadSkillProvidersOptions<TProvider>,
): TProvider[] {
  const priorityOrder = options?.priorityOrder ?? 'desc';
  const compare = (left: TProvider, right: TProvider) => compareSkillProviders(left, right, priorityOrder);
  const merged = [
    ...(options?.builtInProviders ?? []),
    ...(options?.externalProviders ?? []),
  ];
  const filtered = options?.filter
    ? merged.filter((provider) => options.filter!(provider))
    : merged;
  const ordered = [...filtered].sort(compare);
  const byId = new Map<string, TProvider>();
  for (const provider of ordered) {
    if (!byId.has(provider.id)) {
      byId.set(provider.id, provider);
    }
  }
  const deduped = [...byId.values()].sort(compare);
  return options?.finalize ? options.finalize(deduped) : deduped;
}

export async function loadExecutableSkillProviders<
  TPackage extends SkillPackageMetadata<string>,
  TModule,
  TProvider extends BaseSkillProvider<string>,
>(
  options: LoadExecutableSkillProvidersOptions<TPackage, TModule, TProvider>,
): Promise<{
  providers: TProvider[];
  failures: ExecutableSkillProviderLoadFailure<TPackage>[];
}> {
  const providers: TProvider[] = [];
  const failures: ExecutableSkillProviderLoadFailure<TPackage>[] = [];
  const packages = options.packages ?? [];

  for (const pkg of packages) {
    const entrypoint = pkg.entrypoints?.[options.entrypointKey];
    if (!entrypoint) {
      failures.push({
        packageId: pkg.id,
        packageVersion: pkg.version,
        domain: pkg.domain,
        source: pkg.source,
        stage: 'entrypoint',
        reason: 'missing_entrypoint',
      });
      continue;
    }

    let module: TModule;
    try {
      module = await options.importModule(entrypoint, pkg);
    } catch (error) {
      failures.push({
        packageId: pkg.id,
        packageVersion: pkg.version,
        domain: pkg.domain,
        source: pkg.source,
        stage: 'import',
        reason: 'import_failed',
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const validationErrors = options.validateModule ? options.validateModule(module, pkg) : [];
    if (validationErrors.length > 0) {
      failures.push({
        packageId: pkg.id,
        packageVersion: pkg.version,
        domain: pkg.domain,
        source: pkg.source,
        stage: 'validate',
        reason: 'invalid_provider',
        detail: validationErrors.join('; '),
      });
      continue;
    }

    providers.push(options.buildProvider(module, pkg));
  }

  return { providers, failures };
}
