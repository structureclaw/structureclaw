import type { BaseSkillProvider } from './provider.js';
import type { SkillPackageMetadata } from './package.js';

type SkillProviderPriorityOrder = 'asc' | 'desc';

export type SkillCompatibilityReasonCode = 'runtime_version_incompatible' | 'skill_api_version_incompatible';

export interface SkillCompatibilityResult {
  compatible: boolean;
  reasonCodes: SkillCompatibilityReasonCode[];
}

export function parseVersion(value: string): number[] {
  return String(value)
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

export function isVersionGreater(required: string, current: string): boolean {
  const requiredParts = parseVersion(required);
  const currentParts = parseVersion(current);
  const maxLen = Math.max(requiredParts.length, currentParts.length);
  for (let index = 0; index < maxLen; index += 1) {
    const left = requiredParts[index] || 0;
    const right = currentParts[index] || 0;
    if (left === right) {
      continue;
    }
    return left > right;
  }
  return false;
}

export function evaluateSkillCompatibility(
  compatibility: { minRuntimeVersion: string; skillApiVersion: string },
  runtimeVersion: string,
  skillApiVersion: string,
): SkillCompatibilityResult {
  const reasonCodes: SkillCompatibilityReasonCode[] = [];
  if (isVersionGreater(compatibility.minRuntimeVersion, runtimeVersion)) {
    reasonCodes.push('runtime_version_incompatible');
  }
  if (compatibility.skillApiVersion !== skillApiVersion) {
    reasonCodes.push('skill_api_version_incompatible');
  }
  return {
    compatible: reasonCodes.length === 0,
    reasonCodes,
  };
}

export type SkillDependencyRejectReason = 'unmet_requires' | 'conflict_detected';

export interface SkillDependencyRejection {
  providerId: string;
  reason: SkillDependencyRejectReason;
  detail: string;
}

export interface SkillDependencyResolution<TProvider extends BaseSkillProvider<string>> {
  accepted: TProvider[];
  rejected: SkillDependencyRejection[];
}

export interface LoadSkillProvidersOptions<TProvider extends BaseSkillProvider<string>> {
  builtInProviders?: TProvider[];
  externalProviders?: TProvider[];
  priorityOrder?: SkillProviderPriorityOrder;
  filter?: (provider: TProvider) => boolean;
  finalize?: (providers: TProvider[]) => TProvider[];
  packages?: Map<string, SkillPackageMetadata>;
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
  const resolved = options?.packages
    ? resolveSkillDependencies(deduped, options.packages)
    : { accepted: deduped, rejected: [] };
  if (resolved.rejected.length > 0) {
    for (const r of resolved.rejected) {
      console.warn(`[skill-loader] Provider '${r.providerId}' rejected: ${r.reason} — ${r.detail}`);
    }
  }
  return options?.finalize ? options.finalize(resolved.accepted) : resolved.accepted;
}

export function resolveSkillDependencies<TProvider extends BaseSkillProvider<string>>(
  providers: TProvider[],
  packages: Map<string, SkillPackageMetadata>,
): SkillDependencyResolution<TProvider> {
  let accepted = [...providers];
  const rejected: SkillDependencyRejection[] = [];
  let changed = true;

  while (changed) {
    changed = false;
    const availableIds = new Set(accepted.map((p) => p.id));
    const nextAccepted: TProvider[] = [];

    for (const provider of accepted) {
      const pkg = packages.get(provider.id);
      if (!pkg) {
        nextAccepted.push(provider);
        continue;
      }

      const requires = pkg.requires ?? [];
      const unmet = requires.filter((dep) => !availableIds.has(dep));
      if (unmet.length > 0) {
        rejected.push({
          providerId: provider.id,
          reason: 'unmet_requires',
          detail: `Missing required skills: ${unmet.join(', ')}`,
        });
        changed = true;
        continue;
      }

      const conflicts = pkg.conflicts ?? [];
      const hit = conflicts.filter((dep) => dep !== provider.id && availableIds.has(dep));
      if (hit.length > 0) {
        rejected.push({
          providerId: provider.id,
          reason: 'conflict_detected',
          detail: `Conflicts with loaded skills: ${hit.join(', ')}`,
        });
        changed = true;
        continue;
      }

      nextAccepted.push(provider);
    }
    accepted = nextAccepted;
  }

  return { accepted, rejected };
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

export interface SkillLoadSummary {
  loaded: number;
  failed: number;
  failuresByReason: Record<string, number>;
  failureDetails: Array<{ packageId: string; reason: string; detail?: string }>;
}

export function summarizeSkillLoadResult<TPackage extends SkillPackageMetadata<string>>(result: {
  providers: BaseSkillProvider<string>[];
  failures: ExecutableSkillProviderLoadFailure<TPackage>[];
}): SkillLoadSummary {
  const failuresByReason: Record<string, number> = {};
  const failureDetails: SkillLoadSummary['failureDetails'] = [];

  for (const failure of result.failures) {
    failuresByReason[failure.reason] = (failuresByReason[failure.reason] ?? 0) + 1;
    failureDetails.push({
      packageId: failure.packageId,
      reason: failure.reason,
      detail: failure.detail,
    });
  }

  return {
    loaded: result.providers.length,
    failed: result.failures.length,
    failuresByReason,
    failureDetails,
  };
}
