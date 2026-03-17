import type { AppLocale } from '../locale.js';
import { AgentSkillLoader } from './loader.js';
import { buildUnknownScenario, detectUnsupportedScenarioByRules } from './fallback.js';
import { localize } from './plugin-helpers.js';
import type { AgentSkillBundle, AgentSkillPlugin, DraftState, InferredModelType, ScenarioMatch, ScenarioTemplateKey } from './types.js';

export class AgentSkillRegistry {
  constructor(private readonly loader = new AgentSkillLoader()) {}

  listSkills(): AgentSkillBundle[] {
    return this.loader.loadBundles();
  }

  async listPlugins(): Promise<AgentSkillPlugin[]> {
    return this.loader.loadPlugins();
  }

  async resolveEnabledPlugins(skillIds?: string[]): Promise<AgentSkillPlugin[]> {
    const skills = await this.listPlugins();
    if (!skillIds?.length) {
      return skills.filter((skill) => skill.autoLoadByDefault);
    }
    const requested = new Set(skillIds);
    return skills.filter((skill) => requested.has(skill.id));
  }

  async resolvePluginForState(state: DraftState | undefined, skillIds?: string[]): Promise<AgentSkillPlugin | null> {
    const skills = await this.resolveEnabledPlugins(skillIds);
    if (state?.skillId) {
      return skills.find((skill) => skill.id === state.skillId) || null;
    }
    if (state?.inferredType && state.inferredType !== 'unknown') {
      return skills.find((skill) => skill.structureType === state.inferredType) || null;
    }
    return null;
  }

  async resolvePluginForIdentifier(identifier: string | undefined, skillIds?: string[]): Promise<AgentSkillPlugin | null> {
    if (!identifier) {
      return null;
    }
    const skills = await this.resolveEnabledPlugins(skillIds);
    return skills.find((skill) => skill.id === identifier || skill.structureType === identifier) || null;
  }

  async detectScenario(
    message: string,
    locale: AppLocale,
    currentState?: DraftState,
    skillIds?: string[],
  ): Promise<ScenarioMatch> {
    const unsupported = detectUnsupportedScenarioByRules(message, locale);
    if (unsupported) {
      return unsupported;
    }

    const plugins = await this.resolveEnabledPlugins(skillIds);
    for (const plugin of plugins) {
      const matched = plugin.handler.detectScenario({
        message,
        locale,
        currentState,
      });
      if (matched) {
        return { ...matched, skillId: matched.skillId ?? plugin.id };
      }
    }

    const currentPlugin = await this.resolvePluginForState(currentState, skillIds);
    if (currentPlugin && currentState?.inferredType && currentState.inferredType !== 'unknown') {
      return {
        key: (currentState.scenarioKey ?? currentPlugin.id) as ScenarioTemplateKey,
        mappedType: currentState.inferredType,
        skillId: currentPlugin.id,
        supportLevel: currentState.supportLevel ?? 'supported',
        supportNote: currentState.supportNote,
      };
    }

    return buildUnknownScenario(locale);
  }

  async getScenarioLabel(key: string, locale: AppLocale, skillIds?: string[]): Promise<string> {
    if (key === 'steel-frame') {
      return localize(locale, '钢框架', 'Steel Frame');
    }
    const bundles = await this.resolveEnabledPlugins(skillIds);
    const matched = bundles.find((bundle) => bundle.id === key || bundle.structureType === key || bundle.manifest.scenarioKeys.includes(key as ScenarioTemplateKey));
    if (matched) {
      return locale === 'zh' ? matched.name.zh : matched.name.en;
    }
    switch (key as InferredModelType | ScenarioTemplateKey) {
      case 'portal':
        return localize(locale, '门架/刚架', 'Portal Structure');
      case 'girder':
        return localize(locale, '主梁/大梁', 'Girder');
      case 'space-frame':
        return localize(locale, '空间网架', 'Space Frame');
      case 'plate-slab':
        return localize(locale, '板/楼板', 'Plate or Slab');
      case 'shell':
        return localize(locale, '壳体', 'Shell');
      case 'tower':
        return localize(locale, '塔架', 'Tower');
      case 'bridge':
        return localize(locale, '桥梁', 'Bridge');
      default:
        return localize(locale, '未识别', 'Unclassified');
    }
  }
}
