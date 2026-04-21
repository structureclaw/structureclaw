import { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from '../services/locale.js';
import { buildReportDomainArtifacts } from '../agent-skills/report-export/entry.js';
import { runPkpmCalcbook } from '../agent-skills/report-export/calculation-book/pkpm-calcbook/runner.js';
import { buildPostprocessedResultArtifact } from '../agent-skills/result-postprocess/entry.js';
import { computeDependencyFingerprint, computeDraftStateContentHash } from './artifact-helpers.js';
import { applyPatches, type PatchReducerInput } from './patch-reducer.js';
import {
  buildCodeCheckInput,
  executeCodeCheckDomain,
} from '../agent-skills/code-check/entry.js';
import type { CodeCheckClient } from '../agent-skills/code-check/rule.js';
import { AgentSkillRegistry } from './registry.js';
import { AgentSkillExecutor } from './executor.js';
import { listBuiltinToolManifests, resolveToolingForSkillManifests } from './tool-registry.js';
import { buildDefaultReportNarrative } from './report-template.js';
import { logger } from '../utils/logger.js';
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
  ArtifactEnvelope,
  ArtifactKind,
  DraftParameterExtractionResult,
  DraftResult,
  DraftState,
  InteractionQuestion,
  ProjectPipelineState,
  RunRecord,
  SchedulerStep,
  SkillDefaultProposal,
  StructuralTypeMatch,
  SkillReportNarrativeInput,
  StructuralTypeSupportLevel,
  StructuralTypeKey,
  SkillManifest,
  ToolManifest,
  ModelPatchRecord,
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
    if (matchedSelected.length === 1) {
      return matchedSelected[0];
    }
    if (matchedSelected.length > 1) {
      // Multiple analysis skills selected: return highest-priority match as tiebreaker.
      // listBuiltinAnalysisSkillManifests() is already sorted by descending priority.
      return matchedSelected[0];
    }
    // No analysis skill selected → return undefined; pipeline will report
    // "analysisProvider binding required" instead of silently picking an engine.
    return undefined;
  }

  resolveDefaultSkillForDomain(domain: string): string | undefined {
    const match = this.builtinSkillFileManifests
      .filter((s) => s.domain === domain)
      .sort((a, b) => b.priority - a.priority)[0];
    return match?.id;
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
      retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal },
    ) => Promise<{ data: unknown }>;
    signal?: AbortSignal;
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
      engineId: options.engineId || selectedSkill?.engineId,
      model: options.model,
      parameters: options.parameters,
    };
    const analyzed = await options.postToEngineWithRetry('/analyze', input, {
      retries: 2,
      traceId: options.traceId,
      tool: 'run_analysis',
      signal: options.signal,
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
    signal?: AbortSignal;
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
    const result = await executeCodeCheckDomain(
      options.codeCheckClient as CodeCheckClient,
      input,
      options.engineId,
      { signal: options.signal },
    );
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
      post: (path: string, payload: Record<string, unknown>, requestOptions?: { signal?: AbortSignal }) => Promise<{ data: unknown }>;
    };
    signal?: AbortSignal;
  }): Promise<{
    input: { model: Record<string, unknown> };
    result: Record<string, unknown>;
    skillId: 'validation-structure-model';
  }> {
    const input = { model: options.model };
    const validated = await options.structureProtocolClient.post('/validate', {
      model: options.model,
      engineId: options.engineId,
    }, { signal: options.signal });
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
    } = buildReportDomainArtifacts({
      designBasis: undefined,
      normalizedModel: undefined,
      postprocessedResult: options.analysis,
      codeCheckResult: options.codeCheck,
    });
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
    signal?: AbortSignal,
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
      signal,
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
    signal?: AbortSignal,
  ): Promise<DraftResult> {
    const { nextState, missing, structuralTypeMatch, plugin, extractionMode } = extraction;
    let model = missing.critical.length === 0 && plugin
      ? plugin.handler.buildModel(nextState)
      : undefined;
    let missingFields = [...missing.critical];
    if (!model && plugin?.id === 'generic') {
      const llmBuiltModel = await tryBuildGenericModelWithLlm(llm, message, nextState, locale, conversationHistory, signal);
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
    signal?: AbortSignal,
  ): Promise<DraftResult> {
    const extraction = await this.extractDraftParameters(llm, message, existingState, locale, skillIds, signal);
    return this.buildModelFromDraft(llm, message, extraction, locale, conversationHistory, signal);
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

  async executeScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (
      path: string,
      input: Record<string, unknown>,
      retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal },
    ) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
    structureProtocolClient?: { post: (path: string, payload: Record<string, unknown>, requestOptions?: { signal?: AbortSignal }) => Promise<{ data: unknown }> };
    message?: string;
    llm?: ChatOpenAI | null;
    draftState?: DraftState;
    skillIds?: string[];
    engineId?: string;
    analysisParameters?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord; draftMeta?: { structuralTypeMatch?: StructuralTypeMatch; nextState?: DraftState } }> {
    switch (args.step.tool) {
      case 'validate_model':
        return this.executeValidationScheduledStep(args);
      case 'run_analysis':
        return this.executeAnalysisScheduledStep(args);
      case 'postprocess_result':
        return this.executePostprocessScheduledStep(args);
      case 'run_code_check':
        return this.executeCodeCheckScheduledStep(args);
      case 'generate_report':
        return this.executeReportScheduledStep(args);
      case 'generate_drawing':
        return this.executeDrawingScheduledStep(args);
      case 'update_model':
        return this.executeUpdateScheduledStep(args);
      case 'convert_model':
        return this.executeConvertScheduledStep(args);
      case 'synthesize_design':
        return this.executeDesignScheduledStep(args);
      case 'draft_model':
        return this.executeDraftScheduledStep(args);
      case 'enrich_model':
        return this.executeEnrichScheduledStep(args);
      default:
        throw new Error(`Unsupported scheduled tool: ${args.step.tool}`);
    }
  }

  private async executeValidationScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
    engineId?: string;
    structureProtocolClient?: { post: (path: string, payload: Record<string, unknown>, requestOptions?: { signal?: AbortSignal }) => Promise<{ data: unknown }> };
    signal?: AbortSignal;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord }> {
    const model = args.pipelineState.artifacts.normalizedModel?.payload as Record<string, unknown> ?? {};
    // Prefer the explicitly-provided structureProtocolClient (used by agent.ts);
    // fall back to wrapping postToEngineWithRetry for backwards compatibility.
    const validationClient = args.structureProtocolClient ?? {
      post: (path: string, payload: Record<string, unknown>) =>
        args.postToEngineWithRetry(path, payload, { retries: 3, traceId: args.traceId, tool: 'run_analysis', signal: args.signal }),
    };
    const result = await this.executeValidationSkill({
      model,
      engineId: args.engineId,
      structureProtocolClient: validationClient,
      signal: args.signal,
    });
    if (!args.step.provides) return {};
    const artifact = this.buildArtifactEnvelope(args.step.provides, result.result, args.step, args.pipelineState);
    return { artifact };
  }

  private async executeAnalysisScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
    skillIds?: string[];
    engineId?: string;
    signal?: AbortSignal;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord }> {
    const model = args.pipelineState.artifacts.analysisModel?.payload as Record<string, unknown> ?? {};
    const analysisType = args.pipelineState.policy?.analysisType ?? 'static';
    const result = await this.executeAnalysisSkill({
      model,
      analysisType,
      postToEngineWithRetry: args.postToEngineWithRetry,
      traceId: args.traceId,
      engineId: args.engineId,
      parameters: {},
      skillIds: args.skillIds,
      signal: args.signal,
    });
    if (!args.step.provides) return {};
    const artifact = this.buildArtifactEnvelope(args.step.provides, result.result, args.step, args.pipelineState);
    return { artifact };
  }

  private async executePostprocessScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord }> {
    const analysisPayload = args.pipelineState.artifacts.analysisRaw?.payload;
    const analysisRawRef = args.pipelineState.artifacts.analysisRaw
      ? { artifactId: args.pipelineState.artifacts.analysisRaw.artifactId, revision: args.pipelineState.artifacts.analysisRaw.revision }
      : undefined;
    const postprocessedResult = buildPostprocessedResultArtifact(analysisPayload, analysisRawRef);
    if (!args.step.provides) return {};
    const artifact = this.buildArtifactEnvelope(args.step.provides, postprocessedResult as unknown as Record<string, unknown>, args.step, args.pipelineState);
    return { artifact };
  }

  private async executeCodeCheckScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
    engineId?: string;
    analysisParameters?: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord }> {
    const model = args.pipelineState.artifacts.normalizedModel?.payload as Record<string, unknown> ?? {};
    const analysis = args.pipelineState.artifacts.analysisRaw?.payload;
    const postprocessedPayload = args.pipelineState.artifacts.postprocessedResult?.payload;
    const designCode = args.pipelineState.policy?.designCode ?? 'GB50017';
    const codeCheckInput = buildCodeCheckInput({
      traceId: args.traceId,
      designCode,
      model,
      analysis,
      analysisParameters: args.analysisParameters ?? {},
      postprocessedResult: postprocessedPayload as Record<string, unknown> | undefined,
    });
    // Inject engineId into the code-check input payload
    if (args.engineId) {
      (codeCheckInput as Record<string, unknown>).engineId = args.engineId;
    }
    const skillId = this.resolveCodeCheckSkillId(designCode);
    const result = await executeCodeCheckDomain(
      args.codeCheckClient as CodeCheckClient,
      codeCheckInput,
      args.engineId,
      { signal: args.signal },
    );
    if (result && typeof result === 'object' && skillId) {
      const payload = result as Record<string, unknown>;
      const existingMeta = payload.meta && typeof payload.meta === 'object'
        ? payload.meta as Record<string, unknown>
        : {};
      payload.meta = { ...existingMeta, codeCheckSkillId: skillId };
    }
    if (!args.step.provides) return {};
    const artifact = this.buildArtifactEnvelope(args.step.provides, result as Record<string, unknown>, args.step, args.pipelineState);
    return { artifact };
  }

  private async executeReportScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
    message?: string;
    draftState?: DraftState;
    skillIds?: string[];
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord }> {
    const analysisPayload = args.pipelineState.artifacts.analysisRaw?.payload;
    const codeCheckPayload = args.pipelineState.artifacts.codeCheckResult?.payload;
    if (!args.step.provides) return {};

    // PKPM calcbook: detect PKPM engine and generate calculation book directly
    const analysisAny = analysisPayload as Record<string, unknown> | undefined;
    const meta = analysisAny?.meta as Record<string, unknown> | undefined;
    const data = analysisAny?.data as Record<string, unknown> | undefined;
    const summary = data?.summary as Record<string, unknown> | undefined;
    logger.info({ engineId: meta?.engineId, hasMeta: !!meta, analysisKeys: analysisAny ? Object.keys(analysisAny) : [], dataKeys: data ? Object.keys(data) : [], summaryKeys: summary ? Object.keys(summary) : [] }, 'PKPM calcbook detection');
    if (meta?.engineId === 'builtin-pkpm') {
      const jwsPath = summary?.jws_path as string | undefined;
      if (jwsPath) {
        const calcbookResult = await runPkpmCalcbook(jwsPath);
        const report = {
          summary: `PKPM calculation book generated (${calcbookResult.summary?.docx_path ? 'DOCX' : 'no DOCX'}, ${calcbookResult.summary?.pdf_path ? 'PDF' : 'no PDF'})`,
          json: {
            reportSchemaVersion: '1.0.0',
            analysisType: 'static',
            summary: calcbookResult.summary,
            detailed: calcbookResult.detailed,
            warnings: calcbookResult.warnings,
            generatedAt: new Date().toISOString(),
            meta: { reportSkillId: 'pkpm-calcbook' },
          } satisfies Record<string, unknown>,
          markdown: calcbookResult.markdown,
        };
        const artifact = this.buildArtifactEnvelope(args.step.provides, report, args.step, args.pipelineState);
        return { artifact };
      }
    }

    // Delegate to executeReportSkill for full report (summary, markdown, meta)
    // Prefer pipelineState.policy.analysisType (same source used by scheduled analysis execution).
    // Fall back to designBasis.payload.analysisType for backwards compatibility, then 'static'.
    const analysisType = args.pipelineState.policy?.analysisType
      ?? (args.pipelineState.artifacts.designBasis?.payload as Record<string, unknown> | undefined)?.analysisType as 'static' | 'dynamic' | 'seismic' | 'nonlinear' | undefined
      ?? 'static';
    const reportResult = await this.executeReportSkill({
      message: args.message ?? '',
      analysisType,
      analysis: analysisPayload,
      codeCheck: codeCheckPayload,
      format: 'both',
      locale: args.locale,
      draft: args.draftState,
      skillIds: args.skillIds,
    });
    const artifact = this.buildArtifactEnvelope(args.step.provides, reportResult.report, args.step, args.pipelineState);
    return { artifact };
  }

  private async executeDrawingScheduledStep(_args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord }> {
    throw new Error('generate_drawing not yet implemented');
  }

  private async executeUpdateScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
    message?: string;
    llm?: ChatOpenAI | null;
    draftState?: DraftState;
    skillIds?: string[];
    signal?: AbortSignal;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord; draftMeta?: { structuralTypeMatch?: StructuralTypeMatch; nextState?: DraftState } }> {
    if (!args.step.provides) return {};

    // designBasis update: build from session resolved config
    if (args.step.provides === 'designBasis') {
      const payload: Record<string, unknown> = {
        source: 'session-inferred',
        createdAt: new Date().toISOString(),
      };
      const artifact = this.buildArtifactEnvelope(args.step.provides, payload, args.step, args.pipelineState);
      return { artifact };
    }

    // normalizedModel update: draft or update the structural model
    if (args.step.provides === 'normalizedModel') {
      if (!args.message || !args.draftState) {
        // No draft context — return existing artifact if present
        const existing = args.pipelineState.artifacts.normalizedModel;
        if (existing) return { artifact: existing };
        // Cannot produce model without draft context
        throw new Error('normalizedModel update requires message and draftState');
      }

      const extraction = await this.extractDraftParameters(
        args.llm ?? null,
        args.message,
        args.draftState,
        args.locale,
        args.skillIds,
        args.signal,
      );

      if (extraction.missing.critical.length > 0) {
        throw new Error(`DRAFT_INCOMPLETE:${extraction.missing.critical.join(',')}`);
      }

      const draftResult = await this.buildModelFromDraft(
        args.llm ?? null,
        args.message,
        extraction,
        args.locale,
        undefined,
        args.signal,
      );

      if (!draftResult.model) {
        throw new Error('DRAFT_INCOMPLETE:model build failed');
      }

      const artifact = this.buildArtifactEnvelope(
        args.step.provides,
        draftResult.model,
        args.step,
        args.pipelineState,
        args.draftState,
      );
      return {
        artifact,
        draftMeta: {
          structuralTypeMatch: extraction.structuralTypeMatch,
          nextState: extraction.nextState,
        },
      };
    }

    // Generic update: return existing
    const existing = args.pipelineState.artifacts[args.step.provides as keyof typeof args.pipelineState.artifacts];
    return { artifact: existing };
  }

  private async executeConvertScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord }> {
    // Convert produces analysisModel from normalizedModel
    const normalizedModel = args.pipelineState.artifacts.normalizedModel?.payload as Record<string, unknown> ?? {};
    if (!args.step.provides) return {};
    // For internally-produced models (structuremodel-v1), the normalizedModel IS the analysis model.
    // External format conversion is handled by the convert_model tool before entering the pipeline.
    const artifact = this.buildArtifactEnvelope(args.step.provides, normalizedModel, args.step, args.pipelineState);
    return { artifact };
  }

  private async executeDesignScheduledStep(_args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord }> {
    throw new Error('synthesize_design not yet implemented');
  }

  private async executeDraftScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
    message?: string;
    llm?: ChatOpenAI | null;
    draftState?: DraftState;
    skillIds?: string[];
    signal?: AbortSignal;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord }> {
    // Draft delegates to update logic — both use extractDraftParameters + buildModelFromDraft
    return this.executeUpdateScheduledStep(args);
  }

  private async executeEnrichScheduledStep(args: {
    step: SchedulerStep;
    pipelineState: ProjectPipelineState;
    traceId: string;
    locale: AppLocale;
    postToEngineWithRetry: (path: string, input: Record<string, unknown>, retryOptions: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal }) => Promise<{ data: unknown }>;
    codeCheckClient: unknown;
  }): Promise<{ artifact?: ArtifactEnvelope; runRecord?: RunRecord; patches?: ModelPatchRecord[] }> {
    const skillId = args.step.skillId;
    if (!skillId) {
      throw new Error(`Enrich step ${args.step.stepId} has no skillId`);
    }

    const plugin = await this.registry.resolvePluginById(skillId);
    if (!plugin) {
      // Enricher skill declared a runtimeContract but has no handler module — skip.
      return { artifact: args.pipelineState.artifacts.normalizedModel };
    }

    const baseModel = (args.pipelineState.artifacts.normalizedModel?.payload ?? {}) as Record<string, unknown>;
    const baseRevision = (baseModel.revision as number) ?? 1;

    // Build enriched model via the skill handler
    if (typeof plugin.handler.buildModel !== 'function') {
      return { artifact: args.pipelineState.artifacts.normalizedModel };
    }
    const enrichedModel = plugin.handler.buildModel({
      inferredType: (baseModel.metadata as Record<string, unknown>)?.inferredType as string ?? 'unknown',
      updatedAt: Date.now(),
    } as DraftState) ?? {};

    const patchPayload = this.buildEnricherPatchPayload(baseModel, enrichedModel, plugin.manifest.domain);

    if (Object.keys(patchPayload).length === 0) {
      // No enrichable content from this skill — return existing artifact unchanged
      const existing = args.pipelineState.artifacts.normalizedModel;
      return { artifact: existing };
    }

    const now = Date.now();
    const patchRecord: PatchReducerInput = {
      patchId: `${skillId}:${now}`,
      patchKind: 'modelPatch',
      producerSkillId: skillId,
      baseModelRevision: baseRevision,
      status: 'accepted',
      priority: plugin.manifest.priority,
      payload: patchPayload,
      reason: `Enriched by ${skillId}`,
      conflicts: [],
      basedOn: args.step.consumes,
      createdAt: now,
    };

    const reducerResult = applyPatches(baseModel, [patchRecord]);

    if (!args.step.provides) return { patches: [this.toModelPatchRecord(patchRecord, reducerResult)] };

    const artifact = this.buildArtifactEnvelope(args.step.provides, reducerResult.model, args.step, args.pipelineState);
    return { artifact, patches: [this.toModelPatchRecord(patchRecord, reducerResult)] };
  }

  private buildEnricherPatchPayload(
    baseModel: Record<string, unknown>,
    enrichedModel: Record<string, unknown>,
    domain: string | undefined,
  ): Record<string, unknown> {
    const patchPayload: Record<string, unknown> = {};
    const enrichFields = domain === 'section'
      ? ['sections', 'materials'] as const
      : ['sections', 'materials', 'nodes', 'elements', 'load_cases', 'load_combinations'] as const;

    for (const field of enrichFields) {
      const enrichedItems = Array.isArray(enrichedModel[field]) ? enrichedModel[field] as Array<Record<string, unknown>> : [];
      if (enrichedItems.length === 0) {
        continue;
      }

      if (field === 'sections' || field === 'materials') {
        const baseItems = Array.isArray(baseModel[field]) ? baseModel[field] as Array<Record<string, unknown>> : [];
        patchPayload[field] = this.preserveReferencedResourceIds(baseItems, enrichedItems);
        continue;
      }

      patchPayload[field] = enrichedItems;
    }

    return patchPayload;
  }

  private preserveReferencedResourceIds(
    baseItems: Array<Record<string, unknown>>,
    enrichedItems: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    return enrichedItems.map((item, index) => {
      const baseId = typeof baseItems[index]?.id === 'string' ? baseItems[index].id : undefined;
      return baseId ? { ...item, id: baseId } : item;
    });
  }

  private toModelPatchRecord(input: PatchReducerInput, _result: { revision: number }): ModelPatchRecord {
    return {
      patchId: input.patchId,
      patchKind: input.patchKind,
      producerSkillId: input.producerSkillId,
      baseModelRevision: input.baseModelRevision,
      basedOn: input.basedOn.map((b) => ({ kind: b.kind as import('./types.js').ArtifactKind, artifactId: b.artifactId, revision: b.revision })),
      status: 'accepted',
      priority: input.priority,
      createdAt: input.createdAt,
      reason: input.reason,
      payload: input.payload,
    };
  }

  private buildArtifactEnvelope(
    kind: ArtifactKind,
    payload: Record<string, unknown>,
    step: SchedulerStep,
    pipelineState?: ProjectPipelineState,
    draftState?: DraftState,
  ): ArtifactEnvelope {
    const existing = pipelineState?.artifacts?.[kind as keyof typeof pipelineState.artifacts];
    const revision = existing ? (existing.revision ?? 0) + 1 : 1;
    const depRefs: Record<string, { artifactId: string; revision: number }> = {};
    for (const ref of step.consumes) {
      depRefs[ref.kind] = { artifactId: ref.artifactId, revision: ref.revision };
    }
    const draftStateHash = kind === 'normalizedModel' && draftState
      ? computeDraftStateContentHash(draftState as Record<string, unknown>)
      : undefined;
    // Only include provider bindings relevant to this artifact's provider slot.
    // analysisRaw → analysisProvider, codeCheckResult → codeCheckProvider, others → none.
    // Must match the scheduler's fingerprint computation for reuse checks to work.
    const relevantBindings = kind === 'analysisRaw' && pipelineState?.bindings
      ? { analysisProviderSkillId: pipelineState.bindings.analysisProviderSkillId }
      : kind === 'codeCheckResult' && pipelineState?.bindings
        ? { codeCheckProviderSkillId: pipelineState.bindings.codeCheckProviderSkillId }
        : undefined;
    const dependencyFingerprint = computeDependencyFingerprint(depRefs, relevantBindings, draftStateHash);
    return {
      artifactId: `${kind}:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      scope: 'project',
      status: 'ready',
      revision,
      producerSkillId: step.skillId ?? `scheduled:${step.tool}`,
      dependencyFingerprint,
      basedOn: step.consumes.map((ref) => ({ kind: ref.kind, artifactId: ref.artifactId, revision: ref.revision })),
      schemaVersion: '1.0.0',
      provenance: { toolId: `scheduled:${step.tool}` },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload,
    };
  }
}
