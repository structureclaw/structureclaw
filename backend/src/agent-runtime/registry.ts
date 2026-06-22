import type { AppLocale } from '../services/locale.js';
import { listStructureModelingProviders } from '../agent-skills/structure-type/registry.js';
import { AgentSkillLoader } from './loader.js';
import { buildUnknownStructuralType, detectUnsupportedStructuralTypeByRules } from './fallback.js';
import { localize } from './plugin-helpers.js';
import type { AgentSkillBundle, AgentSkillPlugin, DraftState, InferredModelType, StructuralTypeMatch, StructuralTypeKey } from './types.js';

function hasStableCurrentState(state: DraftState | undefined): state is DraftState {
  return !!state?.inferredType && state.inferredType !== 'unknown';
}

function isExplicitStructuralSwitch(message: string): boolean {
  const text = message.toLowerCase();
  return /(?:改为|改成|切换为|换成|按|作为|用)\s*(?:梁|桁架|门式刚架|门架|钢框架|混凝土框架|框架|柱)/u.test(message)
    || /(?:change|switch|convert)\s+(?:to|into|as)\s+(?:(?:a|an|the)\s+)?(?:beam|truss|portal|frame|column)\b/i.test(text);
}

function looksLikeCurrentDraftUpdate(message: string): boolean {
  const text = message.toLowerCase();
  return /(?:刚才|当前|原来|继续|再|另外|同时|补充|考虑|增加|添加|调整|修改|改成|改为|改到|变成|换成|设为)/u.test(message)
    || /\b(?:previous|current|same|continue|also|add|include|update|modify|change|adjust|set)\b/i.test(text);
}

function buildCurrentStateMatch(
  state: DraftState,
  plugin: AgentSkillPlugin,
): StructuralTypeMatch {
  return {
    key: (state.structuralTypeKey ?? plugin.id) as StructuralTypeKey,
    mappedType: state.inferredType,
    skillId: plugin.id,
    supportLevel: state.supportLevel ?? 'supported',
    supportNote: state.supportNote,
  };
}

function providerMatchesScope(provider: { id: string; plugin: AgentSkillPlugin }, requested: Set<string>): boolean {
  const plugin = provider.plugin;
  return requested.has(provider.id)
    || requested.has(plugin.id)
    || requested.has(plugin.structureType)
    || plugin.manifest.structuralTypeKeys.some((key) => requested.has(key));
}

export class AgentSkillRegistry {
  constructor(private readonly loader = new AgentSkillLoader()) {}

  /** Invalidate cached bundles and plugins so the next load re-scans disk. */
  invalidateCache(): void {
    this.loader.invalidateCache();
  }

  listSkills(): AgentSkillBundle[] {
    return this.loader.loadBundles();
  }

  async listPlugins(): Promise<AgentSkillPlugin[]> {
    return this.loader.loadPlugins();
  }

  async resolveEnabledPlugins(skillIds?: string[]): Promise<AgentSkillPlugin[]> {
    const providers = listStructureModelingProviders({
      builtInPlugins: await this.listPlugins(),
    });
    if (skillIds === undefined) {
      return providers.map((provider) => provider.plugin);
    }
    if (skillIds.length === 0) {
      return [];
    }
    const requested = new Set(skillIds);
    return providers
      .filter((provider) => providerMatchesScope(provider, requested))
      .map((provider) => provider.plugin);
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
    return skills.find((skill) => skill.id === identifier)
      || skills.find((skill) => skill.manifest.structuralTypeKeys.includes(identifier as StructuralTypeKey))
      || skills.find((skill) => skill.structureType === identifier)
      || null;
  }

  async detectStructuralType(
    message: string,
    locale: AppLocale,
    currentState?: DraftState,
    skillIds?: string[],
  ): Promise<StructuralTypeMatch> {
    const unsupported = detectUnsupportedStructuralTypeByRules(message, locale);
    if (unsupported) {
      return unsupported;
    }

    const plugins = await this.resolveEnabledPlugins(skillIds);
    const currentPlugin = await this.resolvePluginForState(currentState, skillIds);
    const explicitStructuralSwitch = isExplicitStructuralSwitch(message);
    if (
      currentPlugin
      && hasStableCurrentState(currentState)
      && looksLikeCurrentDraftUpdate(message)
      && !explicitStructuralSwitch
    ) {
      return buildCurrentStateMatch(currentState, currentPlugin);
    }

    for (const plugin of plugins) {
      if (plugin.id === 'generic') {
        continue;
      }
      const matched = plugin.handler.detectStructuralType({
        message,
        locale,
        currentState: explicitStructuralSwitch ? undefined : currentState,
      });
      if (matched) {
        return { ...matched, skillId: matched.skillId ?? plugin.id };
      }
    }

    if (currentPlugin && currentState?.inferredType && currentState.inferredType !== 'unknown') {
      return buildCurrentStateMatch(currentState, currentPlugin);
    }

    const genericPlugin = plugins.find((plugin) => plugin.id === 'generic');
    if (genericPlugin) {
      const matched = genericPlugin.handler.detectStructuralType({
        message,
        locale,
        currentState,
      });
      if (matched) {
        return { ...matched, skillId: matched.skillId ?? genericPlugin.id };
      }
    }

    return buildUnknownStructuralType(locale);
  }

  async resolvePluginById(skillId: string): Promise<AgentSkillPlugin | null> {
    const plugins = await this.listPlugins();
    return plugins.find((p) => p.id === skillId) ?? null;
  }

  async getStructuralTypeLabel(key: string, locale: AppLocale, skillIds?: string[]): Promise<string> {
    if (key === 'steel-frame') {
      return localize(locale, '钢框架', 'Steel Frame');
    }
    const bundles = await this.resolveEnabledPlugins(skillIds);
    const matched = bundles.find((bundle) => bundle.id === key || bundle.structureType === key || bundle.manifest.structuralTypeKeys.includes(key as StructuralTypeKey));
    if (matched) {
      return locale === 'zh' ? matched.name.zh : matched.name.en;
    }
    switch (key as InferredModelType | StructuralTypeKey) {
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
