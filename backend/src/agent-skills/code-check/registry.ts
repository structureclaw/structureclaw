import { GB50010CodeCheckRule } from './gb50010/rule.js';
import { GB50011CodeCheckRule } from './gb50011/rule.js';
import { GB50017CodeCheckRule } from './gb50017/rule.js';
import { JGJ3CodeCheckRule } from './jgj3/rule.js';
import { loadSkillProviders } from '../../skill-shared/loader.js';
import type { CodeCheckRule, CodeCheckRuleProvider } from './rule.js';

const BUILTIN_CODE_CHECK_PROVIDERS: CodeCheckRuleProvider[] = [
  {
    id: GB50017CodeCheckRule.skillId,
    domain: 'code-check',
    source: 'builtin',
    priority: 100,
    rule: GB50017CodeCheckRule,
  },
  {
    id: GB50010CodeCheckRule.skillId,
    domain: 'code-check',
    source: 'builtin',
    priority: 110,
    rule: GB50010CodeCheckRule,
  },
  {
    id: GB50011CodeCheckRule.skillId,
    domain: 'code-check',
    source: 'builtin',
    priority: 120,
    rule: GB50011CodeCheckRule,
  },
  {
    id: JGJ3CodeCheckRule.skillId,
    domain: 'code-check',
    source: 'builtin',
    priority: 130,
    rule: JGJ3CodeCheckRule,
  },
];

function buildProviderRegistry(externalProviders: CodeCheckRuleProvider[] = []): CodeCheckRuleProvider[] {
  return loadSkillProviders({
    builtInProviders: BUILTIN_CODE_CHECK_PROVIDERS,
    externalProviders,
    priorityOrder: 'asc',
    filter: (provider) => provider.domain === 'code-check',
    finalize: (providers) => {
      const primary = providers.filter((provider) => !provider.fallback);
      const fallback = providers.filter((provider) => provider.fallback);
      return [...primary, ...fallback];
    },
  });
}

function buildRuleRegistry(externalProviders: CodeCheckRuleProvider[] = []): CodeCheckRule[] {
  return buildProviderRegistry(externalProviders).map((provider) => provider.rule);
}

function buildCodeBySkillId(externalProviders: CodeCheckRuleProvider[] = []): Record<string, string> {
  return buildProviderRegistry(externalProviders).reduce<Record<string, string>>((acc, provider) => {
    if (provider.rule.designCode) {
      acc[provider.id] = provider.rule.designCode;
    }
    return acc;
  }, {});
}

export function listCodeCheckRuleProviders(options?: {
  externalProviders?: CodeCheckRuleProvider[];
}): CodeCheckRuleProvider[] {
  return buildProviderRegistry(options?.externalProviders);
}

function listCodeCheckRules(options?: {
  externalProviders?: CodeCheckRuleProvider[];
}): CodeCheckRule[] {
  return buildRuleRegistry(options?.externalProviders);
}

export function resolveCodeCheckRule(code: string, options?: {
  externalProviders?: CodeCheckRuleProvider[];
}): CodeCheckRule {
  const rules = listCodeCheckRules(options);
  const matched = rules.find((rule) => rule.matches(code));
  if (matched) {
    return matched;
  }
  throw new Error(`Unsupported code-check standard: ${code}`);
}

export function resolveCodeCheckDesignCodeFromSkillIds(
  skillIds: string[] | undefined,
  options?: {
    externalProviders?: CodeCheckRuleProvider[];
  },
): string | undefined {
  if (!Array.isArray(skillIds) || skillIds.length === 0) {
    return undefined;
  }

  const providers = listCodeCheckRuleProviders(options);
  const codeBySkillId = buildCodeBySkillId(options?.externalProviders);
  const selected = new Set(skillIds);
  for (const provider of providers) {
    if (!selected.has(provider.id)) {
      continue;
    }
    const mapped = codeBySkillId[provider.id];
    if (mapped) {
      return mapped;
    }
  }

  return undefined;
}
