import { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from '../services/locale.js';
import { buildReportDomainArtifacts } from '../agent-skills/report-export/entry.js';
import {
  buildCodeCheckInput,
  executeCodeCheckDomain,
} from '../agent-skills/code-check/entry.js';
import type { CodeCheckClient } from '../agent-skills/code-check/rule.js';
import { AgentSkillRegistry } from './registry.js';
import { AgentSkillExecutor } from './executor.js';
import { listBuiltinToolManifests, resolveToolingForSkillManifests } from './tool-registry.js';
import { buildDefaultReportNarrative } from './report-template.js';
import { tryBuildGenericModelWithLlm } from '../agent-skills/structure-type/generic/llm-model-builder.js';
import { localize, withStructuralTypeState } from './plugin-helpers.js';
import {
  loadSkillManifestsFromDirectorySync,
  resolveBuiltinSkillManifestRoot,
  toRuntimeSkillManifest,
  type LoadedSkillManifest,
} from './skill-manifest-loader.js';
import type {
  AgentSkillBundle,
  DraftParameterExtractionResult,
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
  DraftParameterExtractionResult,
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
  private readonly builtinSkillFileManifests: LoadedSkillManifest[];
  private readonly builtinRuntimeSkillManifests: SkillManifest[];

  constructor(options?: { builtinSkillManifestRoot?: string }) {
    this.registry = new AgentSkillRegistry();
    const builtinSkillManifestRoot = options?.builtinSkillManifestRoot || resolveBuiltinSkillManifestRoot();
    this.builtinSkillFileManifests = loadSkillManifestsFromDirectorySync(builtinSkillManifestRoot);
    this.builtinRuntimeSkillManifests = this.builtinSkillFileManifests.map((manifest) => toRuntimeSkillManifest(manifest));
  }

  listSkills(): AgentSkillBundle[] {
    return this.registry.listSkills();
  }

  async listSkillManifests(): Promise<SkillManifest[]> {
    const plugins = await this.registry.listPlugins();
    const fileManifests = this.builtinRuntimeSkillManifests;
    const fileManifestIds = new Set(fileManifests.map((manifest) => manifest.id));
    return [
      ...fileManifests,
      ...plugins
        .filter((plugin) => !fileManifestIds.has(plugin.id))
        .map((plugin) => plugin.manifest),
    ];
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

  listAnalysisSkillIds(): string[] {
    return this.listBuiltinAnalysisSkillManifests().map((skill) => skill.id);
  }

  listCodeCheckSkillIds(): string[] {
    return this.listBuiltinCodeCheckSkillManifests().map((skill) => skill.id);
  }

  isAnalysisSkillId(skillId: string | undefined): boolean {
    return typeof skillId === 'string' && this.listAnalysisSkillIds().includes(skillId);
  }

  isCodeCheckSkillId(skillId: string | undefined): boolean {
    return typeof skillId === 'string' && this.listCodeCheckSkillIds().includes(skillId);
  }

  resolveCodeCheckDesignCodeFromSkillIds(skillIds?: string[]): string | undefined {
    if (!Array.isArray(skillIds) || skillIds.length === 0) {
      return undefined;
    }
    const selectedSkillIds = new Set(skillIds);
    for (const skill of this.listBuiltinCodeCheckSkillManifests()) {
      if (selectedSkillIds.has(skill.id) && typeof skill.designCode === 'string' && skill.designCode.trim().length > 0) {
        return skill.designCode.trim().toUpperCase();
      }
    }
    return undefined;
  }

  resolveCodeCheckSkillId(designCode: string | undefined): string | undefined {
    if (typeof designCode !== 'string' || designCode.trim().length === 0) {
      return undefined;
    }
    const normalizedDesignCode = designCode.trim().toUpperCase();
    return this.listBuiltinCodeCheckSkillManifests().find((skill) =>
      typeof skill.designCode === 'string' && skill.designCode.trim().toUpperCase() === normalizedDesignCode,
    )?.id;
  }

  resolvePreferredAnalysisSkill(options?: {
    analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    engineId?: string;
    skillIds?: string[];
    supportedModelFamilies?: string[];
  }) {
    const selectedSkillIds = new Set(
      Array.isArray(options?.skillIds)
        ? options.skillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [],
    );
    const normalizedEngineId = typeof options?.engineId === 'string' && options.engineId.trim().length > 0
      ? options.engineId.trim()
      : undefined;
    const supportedFamilies = Array.isArray(options?.supportedModelFamilies)
      ? options.supportedModelFamilies
        .filter((family): family is string => typeof family === 'string' && family.trim().length > 0)
        .map((family) => family.trim().toLowerCase())
      : [];

    const matchesContext = (skill: LoadedSkillManifest): boolean => {
      if (skill.domain !== 'analysis') {
        return false;
      }
      if (options?.analysisType && skill.analysisType !== options.analysisType) {
        return false;
      }
      if (normalizedEngineId && skill.engineId !== normalizedEngineId) {
        return false;
      }
      if (supportedFamilies.length > 0) {
        const skillFamilies = Array.isArray(skill.supportedModelFamilies)
          ? skill.supportedModelFamilies.map((family) => family.trim().toLowerCase())
          : [];
        if (!skillFamilies.some((family) => supportedFamilies.includes(family))) {
          return false;
        }
      }
      return true;
    };

    const analysisSkills = this.listBuiltinAnalysisSkillManifests();
    const matchedSelected = analysisSkills.filter((skill) => selectedSkillIds.has(skill.id) && matchesContext(skill));
    if (matchedSelected.length > 0) {
      return matchedSelected[0];
    }
    return analysisSkills.find((skill) => matchesContext(skill));
  }

  async executeAnalysisSkill(options: {
    traceId: string;
    analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    engineId?: string;
    model: Record<string, unknown>;
    parameters: Record<string, unknown>;
    analysisSkillId?: string;
    skillIds?: string[];
    supportedModelFamilies?: string[];
    postToEngineWithRetry: (
      path: string,
      input: Record<string, unknown>,
      retryOptions: { retries: number; traceId: string; tool: 'run_analysis' },
    ) => Promise<{ data: unknown }>;
  }): Promise<{
    input: {
      type: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
      engineId?: string;
      model: Record<string, unknown>;
      parameters: Record<string, unknown>;
    };
    result: Record<string, unknown>;
    skillId?: string;
  }> {
    const selectedSkill = (typeof options.analysisSkillId === 'string' && options.analysisSkillId.trim().length > 0)
      ? this.listBuiltinAnalysisSkillManifests().find((skill) => skill.id === options.analysisSkillId)
      : this.resolvePreferredAnalysisSkill({
        analysisType: options.analysisType,
        engineId: options.engineId,
        skillIds: options.skillIds,
        supportedModelFamilies: options.supportedModelFamilies,
      });

    const input = {
      type: options.analysisType,
      engineId: options.engineId,
      model: options.model,
      parameters: options.parameters,
    };
    const analyzed = await options.postToEngineWithRetry('/analyze', input, {
      retries: 2,
      traceId: options.traceId,
      tool: 'run_analysis',
    });
    const result = (analyzed?.data ?? {}) as Record<string, unknown>;
    const existingMeta = result.meta && typeof result.meta === 'object'
      ? result.meta as Record<string, unknown>
      : {};
    if (selectedSkill) {
      result.meta = {
        ...existingMeta,
        analysisSkillId: selectedSkill.id,
        analysisSkillIds: [selectedSkill.id],
        analysisAdapterKey: selectedSkill.adapterKey,
        analysisType: options.analysisType,
      };
    } else if (result.meta === undefined && Object.keys(existingMeta).length > 0) {
      result.meta = existingMeta;
    }
    return {
      input,
      result,
      skillId: selectedSkill?.id,
    };
  }

  async executeCodeCheckSkill(options: {
    codeCheckClient: CodeCheckClient | unknown;
    traceId: string;
    designCode: string;
    model: Record<string, unknown>;
    analysis: unknown;
    analysisParameters: Record<string, unknown>;
    codeCheckElements?: string[];
    engineId?: string;
    codeCheckSkillId?: string;
  }): Promise<{
    input: Record<string, unknown>;
    result: unknown;
    skillId?: string;
  }> {
    const skillId = (typeof options.codeCheckSkillId === 'string' && options.codeCheckSkillId.trim().length > 0)
      ? options.codeCheckSkillId
      : this.resolveCodeCheckSkillId(options.designCode);
    const input = buildCodeCheckInput({
      traceId: options.traceId,
      designCode: options.designCode,
      model: options.model,
      analysis: options.analysis,
      analysisParameters: options.analysisParameters,
      codeCheckElements: options.codeCheckElements,
    });
    const result = await executeCodeCheckDomain(options.codeCheckClient as CodeCheckClient, input, options.engineId);
    if (result && typeof result === 'object' && skillId) {
      const payload = result as Record<string, unknown>;
      const existingMeta = payload.meta && typeof payload.meta === 'object'
        ? payload.meta as Record<string, unknown>
        : {};
      payload.meta = {
        ...existingMeta,
        codeCheckSkillId: skillId,
      };
    }
    return {
      input,
      result,
      skillId,
    };
  }

  async executeValidationSkill(options: {
    model: Record<string, unknown>;
    engineId?: string;
    structureProtocolClient: {
      post: (path: string, payload: Record<string, unknown>) => Promise<{ data: unknown }>;
    };
  }): Promise<{
    input: { model: Record<string, unknown> };
    result: Record<string, unknown>;
    skillId: 'validation-structure-model';
  }> {
    const input = { model: options.model };
    const validated = await options.structureProtocolClient.post('/validate', {
      model: options.model,
      engineId: options.engineId,
    });
    return {
      input,
      result: (validated?.data ?? {}) as Record<string, unknown>,
      skillId: 'validation-structure-model',
    };
  }

  private listBuiltinAnalysisSkillManifests(): LoadedSkillManifest[] {
    return this.builtinSkillFileManifests
      .filter((skill) => skill.domain === 'analysis')
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  }

  private listBuiltinCodeCheckSkillManifests(): LoadedSkillManifest[] {
    return this.builtinSkillFileManifests
      .filter((skill) => skill.domain === 'code-check')
      // Code-check provider routing intentionally prefers lower numeric priorities first.
      .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  }

  async executeReportSkill(options: {
    message: string;
    analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    analysis: unknown;
    codeCheck?: unknown;
    format: 'json' | 'markdown' | 'both';
    locale: AppLocale;
    draft?: DraftState;
    skillIds?: string[];
  }): Promise<{
    report: { summary: string; json: Record<string, unknown>; markdown?: string };
    skillId: 'report-export-builtin';
  }> {
    const analysisSuccess = Boolean((options.analysis as { success?: unknown } | undefined)?.success);
    const codeCheckSummary = (options.codeCheck as { summary?: Record<string, unknown> } | undefined)?.summary;
    const codeCheckText = codeCheckSummary
      ? (options.locale === 'zh'
        ? `校核通过 ${String(codeCheckSummary.passed ?? 0)} / ${String(codeCheckSummary.total ?? 0)}`
        : `Code checks passed ${String(codeCheckSummary.passed ?? 0)} / ${String(codeCheckSummary.total ?? 0)}`)
      : (options.locale === 'zh' ? '未执行规范校核' : 'No code checks were executed');
    const summary = options.locale === 'zh'
      ? `分析类型 ${options.analysisType}，分析${analysisSuccess ? '成功' : '失败'}，${codeCheckText}。`
      : `Analysis type ${options.analysisType}; analysis ${analysisSuccess ? 'succeeded' : 'failed'}; ${codeCheckText}.`;
    const {
      keyMetrics,
      clauseTraceability,
      controllingCases,
      visualizationHints,
    } = buildReportDomainArtifacts(options.analysis, options.codeCheck);
    const jsonReport: Record<string, unknown> = {
      reportSchemaVersion: '1.0.0',
      intent: options.message,
      analysisType: options.analysisType,
      summary,
      keyMetrics,
      clauseTraceability,
      controllingCases,
      visualizationHints,
      analysis: options.analysis,
      codeCheck: options.codeCheck,
      generatedAt: new Date().toISOString(),
      meta: {
        reportSkillId: 'report-export-builtin',
      },
    };

    if (options.format === 'json') {
      return {
        report: {
          summary,
          json: jsonReport,
        },
        skillId: 'report-export-builtin',
      };
    }

    const markdown = await this.buildReportNarrative({
      message: options.message,
      analysisType: options.analysisType,
      analysisSuccess,
      codeCheckText,
      summary,
      keyMetrics,
      clauseTraceability,
      controllingCases,
      visualizationHints,
      locale: options.locale,
    }, options.draft, options.skillIds);

    return {
      report: {
        summary,
        json: jsonReport,
        markdown: options.format === 'both' || options.format === 'markdown' ? markdown : undefined,
      },
      skillId: 'report-export-builtin',
    };
  }

  async detectStructuralType(message: string, locale: AppLocale, currentState?: DraftState, skillIds?: string[]): Promise<StructuralTypeMatch> {
    return this.registry.detectStructuralType(message, locale, currentState, skillIds);
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

  async extractDraftParameters(
    llm: ChatOpenAI | null,
    message: string,
    existingState: DraftState | undefined,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<DraftParameterExtractionResult> {
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
        nextState: stateToPersist,
        missing: { critical: ['inferredType'], optional: [] },
        structuralTypeMatch,
        plugin: undefined,
        extractionMode: 'deterministic',
      };
    }

    const plugin = await this.registry.resolvePluginForIdentifier(structuralTypeMatch.skillId, skillIds);
    if (!plugin) {
      return {
        nextState: existingState || { inferredType: 'unknown', updatedAt: Date.now() },
        missing: { critical: ['inferredType'], optional: [] },
        structuralTypeMatch,
        plugin: undefined,
        extractionMode: 'deterministic',
      };
    }

    if (plugin.id === 'generic' && existingState?.inferredType && existingState.inferredType !== 'unknown') {
      const nextState = withStructuralTypeState(
        plugin.handler.mergeState(existingState, {}),
        structuralTypeMatch,
      );
      const missing = plugin.handler.computeMissing(nextState, 'execution');
      return { nextState, missing, structuralTypeMatch, plugin, extractionMode: 'deterministic' };
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
    return {
      nextState,
      missing,
      structuralTypeMatch,
      plugin,
      extractionMode: plugin.id === 'generic' || execution.draftPatch ? 'llm' : 'deterministic',
    };
  }

  async buildModelFromDraft(
    llm: ChatOpenAI | null,
    message: string,
    extraction: DraftParameterExtractionResult,
    locale: AppLocale,
    conversationHistory?: string,
  ): Promise<DraftResult> {
    const { nextState, missing, structuralTypeMatch, plugin, extractionMode } = extraction;
    let model = missing.critical.length === 0 && plugin
      ? plugin.handler.buildModel(nextState)
      : undefined;
    let missingFields = [...missing.critical];
    if (!model && plugin?.id === 'generic') {
      const llmBuiltModel = await tryBuildGenericModelWithLlm(llm, message, nextState, locale, conversationHistory);
      if (llmBuiltModel) {
        model = llmBuiltModel;
        missingFields = [];
      }
    }
    return {
      inferredType: nextState.inferredType,
      missingFields,
      model,
      extractionMode,
      stateToPersist: nextState,
      structuralTypeMatch,
    };
  }

  async textToModelDraft(
    llm: ChatOpenAI | null,
    message: string,
    existingState: DraftState | undefined,
    locale: AppLocale,
    skillIds?: string[],
    conversationHistory?: string,
  ): Promise<DraftResult> {
    const extraction = await this.extractDraftParameters(llm, message, existingState, locale, skillIds);
    return this.buildModelFromDraft(llm, message, extraction, locale, conversationHistory);
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
