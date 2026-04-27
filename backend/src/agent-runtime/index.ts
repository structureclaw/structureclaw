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
import { buildDefaultReportNarrative } from './report-template.js';
import { withStructuralTypeState } from './plugin-helpers.js';
import {
  loadSkillManifestsFromDirectorySync,
  resolveBuiltinSkillManifestRoot,
  toRuntimeSkillManifest,
  type LoadedSkillManifest,
} from './skill-manifest-loader.js';
import type {
  AgentSkillBundle,
  DraftParameterExtractionResult,
  DraftState,
  StructuralTypeMatch,
  SkillReportNarrativeInput,
  SkillManifest,
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
    const retries = selectedSkill?.id === 'yjk-static'
      || selectedSkill?.engineId === 'builtin-yjk'
      || selectedSkill?.adapterKey === 'builtin-yjk'
      || input.engineId === 'builtin-yjk'
      ? 0
      : 2;
    const analyzed = await options.postToEngineWithRetry('/analyze', input, {
      retries,
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

  async resolvePluginForType(skillId: string, skillIds?: string[]): Promise<import('./types.js').AgentSkillPlugin | null> {
    return this.registry.resolvePluginForIdentifier(skillId, skillIds);
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


  async buildModel(
    state: DraftState,
    skillIds?: string[],
    context?: { message?: string; locale?: AppLocale },
  ): Promise<Record<string, unknown> | undefined> {
    const plugin = await this.registry.resolvePluginForState(state, skillIds);
    if (!plugin) {
      return undefined;
    }

    // Deterministic model building (beam, truss, frame, etc.)
    const model = plugin.handler.buildModel(state);
    if (model) {
      return model;
    }

    // Generic skill: fall back to LLM model builder
    if (plugin.id === 'generic' && context) {
      const { tryBuildGenericModelWithLlm } = await import('../agent-skills/structure-type/generic/llm-model-builder.js');
      const { createChatModel } = await import('../utils/llm.js');
      const llm = createChatModel(0);
      if (!llm) {
        throw new Error(
          context.locale === 'zh'
            ? 'LLM 未配置，无法为通用技能构建模型。请检查 LLM_API_KEY 设置。'
            : 'LLM is not configured — cannot build model for generic skill. Please check LLM_API_KEY settings.',
        );
      }
      return tryBuildGenericModelWithLlm(
        llm, context.message || '', state, context.locale || 'zh',
      );
    }

    return undefined;
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
