import type { AppLocale } from '../locale.js';
import { AgentSkillLoader } from './loader.js';
import { detectScenarioByRules, getScenarioLabel } from './fallback.js';
import type { AgentSkillBundle, InferredModelType, ScenarioMatch } from './types.js';

export class AgentSkillRegistry {
  constructor(private readonly loader = new AgentSkillLoader()) {}

  listSkills(): AgentSkillBundle[] {
    return this.loader.loadBundles();
  }

  resolveEnabledSkills(skillIds?: string[]): AgentSkillBundle[] {
    const skills = this.listSkills();
    if (!skillIds?.length) {
      return skills.filter((skill) => skill.autoLoadByDefault);
    }
    const requested = new Set(skillIds);
    return skills.filter((skill) => requested.has(skill.id));
  }

  detectScenario(
    message: string,
    locale: AppLocale,
    currentType?: InferredModelType,
    skillIds?: string[],
  ): ScenarioMatch {
    const bundles = this.resolveEnabledSkills(skillIds);
    return detectScenarioByRules(message, locale, bundles, currentType);
  }

  getScenarioLabel(key: string, locale: AppLocale, skillIds?: string[]): string {
    const bundles = this.resolveEnabledSkills(skillIds);
    return getScenarioLabel(key as any, locale, bundles);
  }
}
