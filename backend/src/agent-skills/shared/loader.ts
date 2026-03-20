import type { BaseSkillProvider } from './provider.js';

type SkillProviderPriorityOrder = 'asc' | 'desc';

export interface LoadSkillProvidersOptions<TProvider extends BaseSkillProvider<string>> {
  builtInProviders?: TProvider[];
  externalProviders?: TProvider[];
  priorityOrder?: SkillProviderPriorityOrder;
  filter?: (provider: TProvider) => boolean;
  finalize?: (providers: TProvider[]) => TProvider[];
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
