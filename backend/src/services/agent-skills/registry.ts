import type { AppLocale } from '../locale.js';
import { AgentSkillLoader } from './loader.js';
import { localize } from './plugin-helpers.js';
import type { AgentSkillBundle, AgentSkillPlugin, DraftState, InferredModelType, ScenarioMatch, ScenarioTemplateKey } from './types.js';

function unsupportedScenario(key: ScenarioTemplateKey, locale: AppLocale, noteZh: string, noteEn: string): ScenarioMatch {
  return {
    key,
    mappedType: 'unknown',
    supportLevel: 'unsupported',
    supportNote: localize(locale, noteZh, noteEn),
  };
}

function detectUnsupportedScenario(message: string, locale: AppLocale): ScenarioMatch | null {
  const text = message.toLowerCase();
  if (text.includes('space frame') || text.includes('网架')) {
    return unsupportedScenario(
      'space-frame',
      locale,
      '当前对话补参链路还不直接支持空间网架；如果你愿意，可先收敛成梁、桁架、门式刚架或规则框架进行澄清。',
      'The current guidance flow does not directly support space frames. If acceptable, we can first simplify the problem to a beam, truss, portal frame, or regular frame.'
    );
  }
  if (text.includes('slab') || text.includes('plate') || text.includes('楼板') || text.includes('板')) {
    return unsupportedScenario(
      'plate-slab',
      locale,
      '当前补参链路还不直接支持板/楼板模型；请先确认是否可以简化为梁系、框架或桁架问题。',
      'The current guidance flow does not directly support plate or slab models. Please confirm whether the problem can be simplified into beams, frames, or trusses.'
    );
  }
  if (text.includes('shell') || text.includes('壳')) {
    return unsupportedScenario(
      'shell',
      locale,
      '当前补参链路还不直接支持壳体模型；请先说明是否可以收敛到梁、桁架或规则框架的近似模型。',
      'The current guidance flow does not directly support shell models. Please clarify whether the problem can be reduced to a beam, truss, or regular-frame approximation.'
    );
  }
  if (text.includes('tower') || text.includes('塔')) {
    return unsupportedScenario(
      'tower',
      locale,
      '当前补参链路还不直接支持塔架专用模板；如果只是杆系近似，可先按桁架继续澄清。',
      'The current guidance flow does not directly support tower-specific templates. If a truss approximation is acceptable, we can continue with that.'
    );
  }
  if (text.includes('bridge') || text.includes('桥')) {
    return unsupportedScenario(
      'bridge',
      locale,
      '当前补参链路还不直接支持桥梁专用模板；若你只想先讨论主梁近似，可收敛到梁模板。',
      'The current guidance flow does not directly support bridge-specific templates. If you only want a girder-style approximation first, we can narrow the problem to a beam template.'
    );
  }
  return null;
}

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
    const unsupported = detectUnsupportedScenario(message, locale);
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

    return unsupportedScenario(
      'unknown',
      locale,
      '我还没有从当前描述中稳定识别出可直接补参的结构场景。请先说明它更接近梁、桁架、门式刚架还是规则框架。',
      'I have not yet identified a stable structural scenario from the current description. Please tell me whether it is closer to a beam, truss, portal frame, or regular frame.'
    );
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
