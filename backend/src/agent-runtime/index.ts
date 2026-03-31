import { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from '../services/locale.js';
import { AgentSkillRegistry } from './registry.js';
import { AgentSkillExecutor } from './executor.js';
import { listBuiltinToolManifests, resolveToolingForSkillManifests } from './tool-registry.js';
import { buildDefaultReportNarrative } from './report-template.js';
import { localize, withStructuralTypeState } from './plugin-helpers.js';
import type {
  AgentSkillBundle,
  DraftResult,
  DraftState,
  InteractionQuestion,
  SkillDefaultProposal,
  StructuralTypeMatch,
  SkillReportNarrativeInput,
  StructuralTypeSupportLevel,
  StructuralTypeKey,
  SkillManifest,
  ToolManifest,
} from './types.js';

export type {
  AgentSkillBundle,
  AgentSkillPlugin,
  DraftExtraction,
  DraftFloorLoad,
  DraftLoadPosition,
  DraftLoadType,
  DraftResult,
  DraftState,
  DraftSupportType,
  FrameBaseSupportType,
  FrameDimension,
  InferredModelType,
  InteractionQuestion,
  StructuralTypeMatch,
  StructuralTypeKey,
  StructuralTypeSupportLevel,
  SkillDefaultProposal,
  SkillHandler,
  SkillManifest,
  SkillReportNarrativeInput,
  ToolManifest,
} from './types.js';

export class AgentSkillRuntime {
  private readonly registry: AgentSkillRegistry;

  constructor() {
    this.registry = new AgentSkillRegistry();
  }

  listSkills(): AgentSkillBundle[] {
    return this.registry.listSkills();
  }

  async listSkillManifests(): Promise<SkillManifest[]> {
    const plugins = await this.registry.listPlugins();
    return plugins.map((plugin) => plugin.manifest);
  }

  listBuiltinToolManifests(): ToolManifest[] {
    return listBuiltinToolManifests();
  }

  async listToolManifests(skillIds?: string[]): Promise<ToolManifest[]> {
    const manifests = await this.listSkillManifests();
    return resolveToolingForSkillManifests(manifests, skillIds).tools;
  }

  async resolveSkillTooling(skillIds?: string[]) {
    const manifests = await this.listSkillManifests();
    return resolveToolingForSkillManifests(manifests, skillIds);
  }

  async detectStructuralType(message: string, locale: AppLocale, currentState?: DraftState, skillIds?: string[]): Promise<StructuralTypeMatch> {
    return this.registry.detectStructuralType(message, locale, currentState, skillIds);
  }

  async shouldPreferToolInvocation(
    message: string,
    locale: AppLocale,
    currentState?: DraftState,
    skillIds?: string[],
  ): Promise<boolean> {
    const structuralTypeMatch = await this.registry.detectStructuralType(message, locale, currentState, skillIds);
    if (structuralTypeMatch.supportLevel === 'unsupported') {
      return false;
    }
    return structuralTypeMatch.mappedType !== 'unknown';
  }

  async getStructuralTypeLabel(key: string, locale: AppLocale, skillIds?: string[]): Promise<string> {
    return this.registry.getStructuralTypeLabel(key, locale, skillIds);
  }

  async applyProvidedValues(
    existingState: DraftState | undefined,
    values: Record<string, unknown>,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<DraftState> {
    if (!values || typeof values !== 'object') {
      return existingState || { inferredType: 'unknown', updatedAt: Date.now() };
    }
    const identifier = typeof values.skillId === 'string'
      ? values.skillId
      : typeof values.inferredType === 'string'
        ? values.inferredType
        : existingState?.skillId ?? existingState?.inferredType;
    const plugin = await this.registry.resolvePluginForIdentifier(identifier, skillIds)
      || await this.registry.resolvePluginForState(existingState, skillIds);
    if (!plugin) {
      return {
        ...(existingState || { inferredType: 'unknown', updatedAt: Date.now() }),
        updatedAt: Date.now(),
      };
    }
    const merged = plugin.handler.mergeState(existingState, plugin.handler.parseProvidedValues(values));
    return {
      ...merged,
      skillId: plugin.id,
      structuralTypeKey: (merged.structuralTypeKey ?? plugin.id) as StructuralTypeKey,
      supportLevel: (merged.supportLevel ?? 'supported') as StructuralTypeSupportLevel,
      updatedAt: Date.now(),
    };
  }

  async textToModelDraft(
    llm: ChatOpenAI | null,
    message: string,
    existingState: DraftState | undefined,
    locale: AppLocale,
    skillIds?: string[]
  ): Promise<DraftResult> {
    const structuralTypeMatch = await this.registry.detectStructuralType(message, locale, existingState, skillIds);
    if (!structuralTypeMatch.skillId) {
      const stateToPersist: DraftState = {
        ...(existingState || { inferredType: 'unknown' }),
        structuralTypeKey: structuralTypeMatch.key,
        supportLevel: structuralTypeMatch.supportLevel,
        supportNote: structuralTypeMatch.supportNote,
        updatedAt: Date.now(),
      };
      return {
        inferredType: 'unknown',
        missingFields: ['inferredType'],
        extractionMode: 'deterministic',
        stateToPersist,
        structuralTypeMatch,
      };
    }

    const plugin = await this.registry.resolvePluginForIdentifier(structuralTypeMatch.skillId, skillIds);
    if (!plugin) {
      return {
        inferredType: existingState?.inferredType || 'unknown',
        missingFields: ['inferredType'],
        extractionMode: 'deterministic',
        stateToPersist: existingState,
        structuralTypeMatch,
      };
    }

    const executor = new AgentSkillExecutor(llm);
    const execution = await executor.execute({
      message,
      locale,
      existingState,
      selectedSkill: plugin,
    });
    const patch = plugin.handler.extractDraft({
      message,
      locale,
      currentState: existingState,
      llmDraftPatch: execution.draftPatch,
      structuralTypeMatch,
    });
    const nextState = withStructuralTypeState(plugin.handler.mergeState(existingState, patch), structuralTypeMatch);
    const missing = plugin.handler.computeMissing(nextState, 'execution');
    const model = missing.critical.length === 0 ? plugin.handler.buildModel(nextState) : undefined;
    return {
      inferredType: nextState.inferredType,
      missingFields: missing.critical,
      model,
      extractionMode: execution.draftPatch ? 'llm' : 'deterministic',
      stateToPersist: nextState,
      structuralTypeMatch,
    };
  }

  async assessDraft(
    state: DraftState,
    locale: AppLocale,
    phase: 'interactive' | 'execution',
    skillIds?: string[],
  ): Promise<{ criticalMissing: string[]; optionalMissing: string[] }> {
    const plugin = await this.registry.resolvePluginForState(state, skillIds);
    if (!plugin) {
      return { criticalMissing: ['inferredType'], optionalMissing: [] };
    }
    if (state.inferredType === 'unknown' && state.skillId !== plugin.id) {
      return { criticalMissing: ['inferredType'], optionalMissing: [] };
    }
    const missing = plugin.handler.computeMissing(state, phase);
    return {
      criticalMissing: missing.critical,
      optionalMissing: missing.optional,
    };
  }

  async mapMissingFieldLabels(missing: string[], locale: AppLocale, state: DraftState, skillIds?: string[]): Promise<string[]> {
    const plugin = await this.registry.resolvePluginForState(state, skillIds);
    if (!plugin) {
      return missing.map((key) => key === 'inferredType'
        ? localize(locale, '结构体系/构件拓扑描述（不限类型，可直接给结构模型JSON）', 'Structural system / topology description (any type, or provide computable model JSON directly)')
        : key);
    }
    return plugin.handler.mapLabels(missing, locale);
  }

  async buildInteractionQuestions(
    missingKeys: string[],
    criticalMissing: string[],
    draft: DraftState,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<InteractionQuestion[]> {
    const plugin = await this.registry.resolvePluginForState(draft, skillIds);
    if (!plugin) {
      return [{
        paramKey: 'inferredType',
        label: localize(locale, '结构体系', 'Structural system'),
        question: localize(locale, '请描述结构体系与构件连接关系（不限类型）；也可以直接提供可计算的结构模型 JSON。', 'Please describe the structural system and member connectivity (any type). You can also provide a computable structural model JSON directly.'),
        required: true,
        critical: true,
      }];
    }
    return plugin.handler.buildQuestions(missingKeys, criticalMissing, draft, locale);
  }

  async buildStructuralDefaultProposals(
    missingKeys: string[],
    draft: DraftState,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<SkillDefaultProposal[]> {
    if (!missingKeys.length) {
      return [];
    }

    const plugin = await this.registry.resolvePluginForState(draft, skillIds);
    if (!plugin) {
      return [];
    }

    if (plugin.handler.buildDefaultProposals) {
      return plugin.handler.buildDefaultProposals(missingKeys, draft, locale);
    }

    const questions = plugin.handler.buildQuestions(missingKeys, [], draft, locale);
    return questions
      .filter((question) => missingKeys.includes(question.paramKey) && question.suggestedValue !== undefined)
      .map((question) => ({
        paramKey: question.paramKey,
        value: question.suggestedValue,
        reason: localize(
          locale,
          `根据 ${question.label} 的推荐值采用默认配置。`,
          `Apply the recommended default value for ${question.label}.`
        ),
      }));
  }

  async resolveInteractionStage(
    missingKeys: string[],
    draft: DraftState,
    skillIds?: string[],
  ): Promise<'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report'> {
    const plugin = await this.registry.resolvePluginForState(draft, skillIds);
    if (!plugin?.handler.resolveStage) {
      return missingKeys.includes('inferredType') ? 'intent' : 'model';
    }
    return plugin.handler.resolveStage(missingKeys, draft);
  }

  async buildModel(
    state: DraftState,
    skillIds?: string[],
  ): Promise<Record<string, unknown> | undefined> {
    const plugin = await this.registry.resolvePluginForState(state, skillIds);
    if (!plugin) {
      return undefined;
    }
    return plugin.handler.buildModel(state);
  }

  async buildReportNarrative(
    input: SkillReportNarrativeInput,
    draft?: DraftState,
    skillIds?: string[],
  ): Promise<string> {
    const plugin = await this.registry.resolvePluginForState(draft, skillIds);
    if (plugin?.handler.buildReportNarrative) {
      return plugin.handler.buildReportNarrative(input);
    }
    return buildDefaultReportNarrative(input);
  }
}
