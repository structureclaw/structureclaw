import { ChatOpenAI } from '@langchain/openai';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import type { InputJsonValue } from '../utils/json.js';
import { createChatModel } from '../utils/llm.js';
import { prisma } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { redis } from '../utils/redis.js';
import { type AppLocale } from './locale.js';
import { AgentPolicyService } from './agent-policy.js';
import {
  AgentSkillRuntime,
  type DraftResult,
  type DraftState,
  type ScenarioMatch,
  type ScenarioTemplateKey,
} from '../agent-runtime/index.js';
import {
  buildCodeCheckInput,
  buildCodeCheckSummaryText,
  executeCodeCheckDomain,
  resolveCodeCheckDesignCodeFromSkillIds,
} from '../agent-skills/code-check/entry.js';
import {
  inferAnalysisType,
  inferCodeCheckIntent,
  inferReportIntent,
  normalizePolicyAnalysisType,
  normalizePolicyReportFormat,
  normalizePolicyReportOutput,
} from '../agent-skills/design/entry.js';
import { buildReportDomainArtifacts } from '../agent-skills/report-export/entry.js';
import {
  computeNoSkillMissingFields,
  normalizeNoSkillDraftState,
  tryNoSkillLlmBuildGenericModel,
} from './agent-noskill-runtime.js';
import { createLocalAnalysisEngineClient } from './analysis-execution.js';
import { createLocalCodeCheckClient } from './code-check-execution.js';
import { createLocalStructureProtocolClient } from './structure-protocol-execution.js';
import type { LocalAnalysisEngineClient } from '../agent-skills/analysis/types.js';
import { listBuiltinToolManifests, resolveCanonicalToolId } from '../agent-runtime/tool-registry.js';

export type AgentToolName = 'text-to-model-draft' | 'convert' | 'validate' | 'analyze' | 'code-check' | 'report';
export type AgentOrchestrationMode = 'rule-based' | 'llm-assisted';
export type AgentInteractionPhase = 'interactive' | 'execution';
export type AgentReportFormat = 'json' | 'markdown' | 'both';
export type AgentReportOutput = 'inline' | 'file';
export type AgentUserDecision = 'provide_values' | 'confirm_all' | 'allow_auto_decide' | 'revise';
export type AgentInteractionState = 'collecting' | 'confirming' | 'ready' | 'executing' | 'completed' | 'blocked';
export type AgentInteractionStage = 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';
export type AgentInteractionRouteHint = 'prefer_conversation' | 'prefer_tool';

interface InteractionSession {
  draft: DraftState;
  scenario?: ScenarioMatch;
  userApprovedAutoDecide?: boolean;
  resolved?: {
    analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    designCode?: string;
    autoCodeCheck?: boolean;
    includeReport?: boolean;
    reportFormat?: AgentReportFormat;
    reportOutput?: AgentReportOutput;
  };
  updatedAt: number;
}

function hasExplicitCodeCheckSkill(skillIds: string[] | undefined): boolean {
  return Array.isArray(skillIds) && skillIds.some((skillId) => skillId.startsWith('code-check-'));
}

interface InteractionQuestion {
  paramKey: string;
  label: string;
  question: string;
  unit?: string;
  required: boolean;
  critical: boolean;
  suggestedValue?: unknown;
}

interface InteractionPending {
  criticalMissing: string[];
  nonCriticalMissing: string[];
}

interface InteractionDefaultProposal {
  paramKey: string;
  value: unknown;
  reason: string;
}

interface PersistedMessageDebugDetails {
  promptSnapshot: string;
  skillIds: string[];
  routing?: AgentResolvedRouting;
  responseSummary: string;
  plan: string[];
  toolCalls: AgentToolCall[];
}

type ActiveToolSet = Set<string> | undefined;

type AgentPlanKind = 'reply' | 'ask' | 'tool_call';
type AgentPlanningDirective = 'auto' | 'force_conversation' | 'force_tool';

interface AgentNextStepPlan {
  kind: AgentPlanKind;
  planningDirective: AgentPlanningDirective;
  rationale: 'override' | 'policy';
}

interface ResolvedExecutionConfig {
  analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
  designCode?: string;
  autoCodeCheck: boolean;
  includeReport: boolean;
  reportFormat: AgentReportFormat;
  reportOutput: AgentReportOutput;
}

interface ExecutionPipelineArgs {
  params: AgentRunInput;
  traceId: string;
  startedAt: string;
  startedAtMs: number;
  locale: AppLocale;
  orchestrationMode: AgentOrchestrationMode;
  skillIds?: string[];
  activeToolIds?: ActiveToolSet;
  plan: string[];
  toolCalls: AgentToolCall[];
  sessionKey?: string;
  workingSession: InteractionSession;
  normalizedModel: Record<string, unknown>;
  analysisParameters: Record<string, unknown>;
  autoAnalyze: boolean;
  executionConfig: ResolvedExecutionConfig;
  validationWarning?: string;
}

interface PreparedRunContext {
  locale: AppLocale;
  orchestrationMode: AgentOrchestrationMode;
  modelInput?: Record<string, unknown>;
  sourceFormat: string;
  autoAnalyze: boolean;
  analysisParameters: Record<string, unknown>;
  skillIds?: string[];
  noSkillMode: boolean;
  activeToolIds?: ActiveToolSet;
  sessionKey?: string;
  workingSession: InteractionSession;
  plan: string[];
  toolCalls: AgentToolCall[];
}

interface ResolvedConversationAssessment {
  assessment: Awaited<ReturnType<AgentService['assessInteractionNeeds']>>;
  state: AgentInteractionState;
  interaction: AgentInteraction;
}

interface PreparedExecutionModel {
  normalizedModel: Record<string, unknown>;
  validationWarning?: string;
}

interface ExecutionArtifacts {
  report?: AgentRunResult['report'];
  artifacts?: AgentRunResult['artifacts'];
}

export interface AgentResolvedRouting {
  selectedSkillIds: string[];
  structuralSkillId?: string;
  structuralScenarioKey?: string;
  analysisSkillId?: string;
  analysisSkillIds?: string[];
}

export interface AgentInteraction {
  state: AgentInteractionState;
  stage: AgentInteractionStage;
  turnId: string;
  routeHint?: AgentInteractionRouteHint;
  routeReason?: string;
  detectedScenario?: string;
  detectedScenarioLabel?: string;
  conversationStage?: string;
  missingCritical?: string[];
  missingOptional?: string[];
  fallbackSupportNote?: string;
  recommendedNextStep?: string;
  questions?: InteractionQuestion[];
  pending?: InteractionPending;
  proposedDefaults?: InteractionDefaultProposal[];
  nextActions?: AgentUserDecision[];
}

export interface AgentConversationSessionSnapshot {
  draft: DraftState;
  resolved?: InteractionSession['resolved'];
  interaction: AgentInteraction;
  model?: Record<string, unknown>;
  updatedAt: number;
}

export interface AgentRunInput {
  message: string;
  conversationId?: string;
  traceId?: string;
  userId?: string;
  context?: {
    locale?: AppLocale;
    skillIds?: string[];
    enabledToolIds?: string[];
    disabledToolIds?: string[];
    model?: Record<string, unknown>;
    modelFormat?: string;
    analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    engineId?: string;
    parameters?: Record<string, unknown>;
    autoAnalyze?: boolean;
    autoCodeCheck?: boolean;
    designCode?: string;
    codeCheckElements?: string[];
    includeReport?: boolean;
    reportFormat?: AgentReportFormat;
    reportOutput?: AgentReportOutput;
    userDecision?: AgentUserDecision;
    providedValues?: Record<string, unknown>;
  };
}

export interface AgentToolSpec {
  id: string;
  name: AgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  errorCodes: string[];
}

export interface AgentProtocol {
  version: string;
  runRequestSchema: Record<string, unknown>;
  runResultSchema: Record<string, unknown>;
  streamEventSchema: Record<string, unknown>;
  tools: AgentToolSpec[];
  errorCodes: string[];
}

export interface AgentToolCall {
  tool: AgentToolName;
  input: Record<string, unknown>;
  status: 'success' | 'error';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  output?: unknown;
  error?: string;
  errorCode?: string;
}

export interface AgentRunResult {
  traceId: string;
  conversationId?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  orchestrationMode: AgentOrchestrationMode;
  needsModelInput: boolean;
  plan: string[];
  toolCalls: AgentToolCall[];
  model?: Record<string, unknown>;
  analysis?: unknown;
  codeCheck?: unknown;
  report?: {
    summary: string;
    json: Record<string, unknown>;
    markdown?: string;
  };
  artifacts?: Array<{
    type: 'report';
    format: 'json' | 'markdown';
    path: string;
  }>;
  metrics?: {
    toolCount: number;
    failedToolCount: number;
    totalToolDurationMs: number;
    averageToolDurationMs: number;
    maxToolDurationMs: number;
    toolDurationMsByName: Record<string, number>;
  };
  routing?: AgentResolvedRouting;
  interaction?: AgentInteraction;
  clarification?: {
    missingFields: string[];
    question: string;
  };
  response: string;
}

export interface AgentStreamChunk {
  type: 'start' | 'interaction_update' | 'result' | 'done' | 'error';
  content?: unknown;
  error?: string;
}

export class AgentService {
  public engineClient: LocalAnalysisEngineClient;
  public structureProtocolClient = createLocalStructureProtocolClient();
  public codeCheckClient = createLocalCodeCheckClient();
  public llm: ChatOpenAI | null;
  private readonly skillRuntime: AgentSkillRuntime;
  private readonly policy: AgentPolicyService;
  private static readonly draftStateTtlSeconds = 30 * 60;

  constructor() {
    this.engineClient = createLocalAnalysisEngineClient();

    this.llm = createChatModel(0.1);
    this.skillRuntime = new AgentSkillRuntime();
    this.policy = new AgentPolicyService();
  }

  private isZh(locale: AppLocale): boolean {
    return locale === 'zh';
  }

  private localize(locale: AppLocale, zh: string, en: string): string {
    return this.isZh(locale) ? zh : en;
  }

  private resolveInteractionLocale(locale: AppLocale | undefined): AppLocale {
    return locale === 'en' ? 'en' : 'zh';
  }

  private getStageLabel(stage: AgentInteractionStage, locale: AppLocale): string {
    return this.policy.getStageLabel(stage, locale);
  }

  private async getScenarioLabel(key: ScenarioTemplateKey, locale: AppLocale): Promise<string> {
    return this.skillRuntime.getScenarioLabel(key, locale);
  }

  async shouldPreferToolInvocation(message: string, options?: {
    locale?: AppLocale;
    conversationId?: string;
    skillIds?: string[];
    enabledToolIds?: string[];
    disabledToolIds?: string[];
    hasModel?: boolean;
  }): Promise<boolean> {
    const locale = this.resolveInteractionLocale(options?.locale);
    const sessionKey = options?.conversationId?.trim();
    const session = await this.getInteractionSession(sessionKey);
    const activeToolIds = await this.resolveActiveToolIds(options?.skillIds, {
      enabledToolIds: options?.enabledToolIds,
      disabledToolIds: options?.disabledToolIds,
    });
    return (await this.planNextStep(message, {
      planningDirective: 'auto',
      locale,
      skillIds: options?.skillIds,
      hasModel: Boolean(options?.hasModel),
      session,
      activeToolIds,
    })).kind === 'tool_call';
  }

  private async shouldPlanToolCallForState(message: string, options: {
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
  }): Promise<boolean> {
    const wantsCodeCheck = inferCodeCheckIntent(this.policy, message);
    const wantsReport = inferReportIntent(this.policy, message) === true;
    if ((wantsCodeCheck && this.hasActiveTool(options.activeToolIds, 'run_code_check'))
      || (wantsReport && this.hasActiveTool(options.activeToolIds, 'generate_report'))) {
      return true;
    }

    if (this.policy.inferExecutionIntent(message) && this.hasActiveTool(options.activeToolIds, 'run_analysis')) {
      return true;
    }

    if (!options.session) {
      return false;
    }

    if (options.session.draft && options.session.draft.inferredType !== 'unknown') {
      const assessment = await this.assessInteractionNeeds(options.session, options.locale, options.skillIds, 'interactive');
      const readyForExecution = assessment.criticalMissing.length === 0
        && (assessment.nonCriticalMissing.length === 0 || Boolean(options.session.userApprovedAutoDecide));
      if (readyForExecution && options.hasModel && this.policy.inferProceedIntent(message) && this.hasActiveTool(options.activeToolIds, 'run_analysis')) {
        return true;
      }

      if (assessment.criticalMissing.length > 0) {
        const stage = await this.skillRuntime.resolveInteractionStage(
          assessment.criticalMissing,
          options.session.draft,
          options.skillIds,
        );
        if (stage === 'intent' || stage === 'model' || stage === 'loads') {
          return false;
        }
      }
      if (assessment.nonCriticalMissing.length > 0 && !options.session.userApprovedAutoDecide) {
        const stage = this.policy.resolveInteractionStageFromMissing('analysis', assessment.nonCriticalMissing);
        if (stage === 'analysis' || stage === 'code_check' || stage === 'report') {
          return false;
        }
      }
    }

    return false;
  }

  private async planNextStep(message: string, options: {
    planningDirective: AgentPlanningDirective;
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
  }): Promise<AgentNextStepPlan> {
    if (options.planningDirective === 'force_conversation') {
      return {
        kind: await this.resolveInteractivePlanKind(options),
        planningDirective: options.planningDirective,
        rationale: 'override',
      };
    }
    if (options.planningDirective === 'force_tool') {
      return { kind: 'tool_call', planningDirective: options.planningDirective, rationale: 'override' };
    }

    const shouldCallTool = await this.shouldPlanToolCallForState(message, {
      locale: options.locale,
      skillIds: options.skillIds,
      hasModel: options.hasModel,
      session: options.session,
      activeToolIds: options.activeToolIds,
    });
    const kind = shouldCallTool
      ? 'tool_call'
      : await this.resolveInteractivePlanKind(options);
    return { kind, planningDirective: options.planningDirective, rationale: 'policy' };
  }

  private async resolveInteractivePlanKind(options: {
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
  }): Promise<Exclude<AgentPlanKind, 'tool_call'>> {
    if (options.hasModel) {
      return 'reply';
    }
    if (this.isNoSkillMode(options.skillIds) && !this.hasActiveTool(options.activeToolIds, 'draft_model')) {
      return 'reply';
    }
    if (!options.session || options.session.draft.inferredType === 'unknown') {
      return 'ask';
    }
    const assessment = await this.assessInteractionNeeds(options.session, options.locale, options.skillIds, 'interactive');
    const readyForExecution = assessment.criticalMissing.length === 0
      && (assessment.nonCriticalMissing.length === 0 || Boolean(options.session.userApprovedAutoDecide));
    return readyForExecution ? 'reply' : 'ask';
  }

  private async prepareRunContext(params: AgentRunInput): Promise<PreparedRunContext> {
    const locale = this.resolveInteractionLocale(params.context?.locale);
    const skillIds = params.context?.skillIds;
    const noSkillMode = this.isNoSkillMode(skillIds);
    const activeToolIds = await this.resolveActiveToolIds(skillIds, {
      enabledToolIds: params.context?.enabledToolIds,
      disabledToolIds: params.context?.disabledToolIds,
    });
    const sessionKey = params.conversationId?.trim();
    const session = await this.getInteractionSession(sessionKey);
    const workingSession: InteractionSession = session || {
      draft: { inferredType: 'unknown', updatedAt: Date.now() },
      updatedAt: Date.now(),
      resolved: {},
    };

    if (noSkillMode) {
      workingSession.draft = normalizeNoSkillDraftState(workingSession.draft);
      workingSession.scenario = undefined;
    }

    this.applyResolvedConfigFromContext(workingSession, params.context);
    await this.applyProvidedValuesToSession(workingSession, params.context?.providedValues || {}, locale, skillIds);
    const userDecision = params.context?.userDecision;
    if (userDecision === 'allow_auto_decide' || userDecision === 'confirm_all') {
      workingSession.userApprovedAutoDecide = true;
    } else if (userDecision === 'revise') {
      workingSession.userApprovedAutoDecide = false;
    }

    return {
      locale,
      orchestrationMode: this.llm ? 'llm-assisted' : 'rule-based',
      modelInput: params.context?.model,
      sourceFormat: params.context?.modelFormat || 'structuremodel-v1',
      autoAnalyze: params.context?.autoAnalyze ?? true,
      analysisParameters: params.context?.parameters || {},
      skillIds,
      noSkillMode,
      activeToolIds,
      sessionKey,
      workingSession,
      plan: [],
      toolCalls: [],
    };
  }

  private async resolveActiveToolIds(
    skillIds?: string[],
    options?: { enabledToolIds?: string[]; disabledToolIds?: string[] },
  ): Promise<ActiveToolSet> {
    const active = new Set(listBuiltinToolManifests().map((tool) => tool.id));
    if (this.isNoSkillMode(skillIds)) {
      return this.applyToolSelection(active, options);
    }
    const tooling = await this.skillRuntime.resolveSkillTooling(skillIds);
    for (const tool of tooling.tools) {
      active.add(tool.id);
    }
    return this.applyToolSelection(active, options);
  }

  private applyToolSelection(
    active: Set<string>,
    options?: { enabledToolIds?: string[]; disabledToolIds?: string[] },
  ): Set<string> {
    const enabledToolIds = Array.isArray(options?.enabledToolIds)
      ? options?.enabledToolIds.map((toolId) => resolveCanonicalToolId(toolId)).filter((toolId): toolId is string => Boolean(toolId))
      : undefined;
    const disabledToolIds = Array.isArray(options?.disabledToolIds)
      ? options?.disabledToolIds.map((toolId) => resolveCanonicalToolId(toolId)).filter((toolId): toolId is string => Boolean(toolId))
      : [];

    const selected = enabledToolIds ? new Set(enabledToolIds.filter((toolId) => active.has(toolId))) : new Set(active);
    for (const toolId of disabledToolIds) {
      selected.delete(toolId);
    }
    return selected;
  }

  private hasActiveTool(activeToolIds: ActiveToolSet, toolId: string): boolean {
    return !activeToolIds || activeToolIds.has(toolId);
  }

  private buildDisabledToolMessage(toolId: string, locale: AppLocale): string {
    switch (toolId) {
      case 'draft_model':
        return this.localize(locale, '当前能力集中未启用建模 tool，无法从对话直接生成结构模型。', 'The current capability set does not enable the model-drafting tool, so a structural model cannot be generated directly from conversation.');
      case 'convert_model':
        return this.localize(locale, '当前能力集中未启用模型转换 tool。', 'The current capability set does not enable the model-conversion tool.');
      case 'validate_model':
        return this.localize(locale, '当前能力集中未启用模型校验 tool。', 'The current capability set does not enable the model-validation tool.');
      case 'run_analysis':
        return this.localize(locale, '当前能力集中未启用分析 tool。', 'The current capability set does not enable the analysis tool.');
      case 'run_code_check':
        return this.localize(locale, '当前能力集中未启用规范校核 tool。', 'The current capability set does not enable the code-check tool.');
      case 'generate_report':
        return this.localize(locale, '当前能力集中未启用报告生成 tool。', 'The current capability set does not enable the report-generation tool.');
      default:
        return this.localize(locale, '当前能力集中未启用所需 tool。', 'The current capability set does not enable the required tool.');
    }
  }

  private async finalizeBlockedRunResult(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    response: string;
    model?: Record<string, unknown>;
    needsModelInput?: boolean;
    clarification?: AgentRunResult['clarification'];
    interaction?: AgentInteraction;
  }): Promise<AgentRunResult> {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      response,
      model,
      needsModelInput = false,
      clarification,
      interaction,
    } = args;

    return this.finalizeRunResult(traceId, sessionKey, params.message, {
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      success: false,
      orchestrationMode,
      needsModelInput,
      plan,
      toolCalls,
      model,
      metrics: this.buildMetrics(toolCalls),
      interaction: interaction || this.buildToolInteraction('blocked', locale),
      clarification,
      response,
    }, skillIds, workingSession);
  }

  async getConversationSessionSnapshot(
    conversationId: string | undefined,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<AgentConversationSessionSnapshot | undefined> {
    const session = await this.getInteractionSession(conversationId);
    if (!session) {
      return undefined;
    }

    if (this.isNoSkillMode(skillIds)) {
      session.draft = normalizeNoSkillDraftState(session.draft);
      session.scenario = undefined;
      session.updatedAt = Date.now();
      if (conversationId?.trim()) {
        await this.setInteractionSession(conversationId.trim(), session);
      }
    }

    const assessment = await this.assessInteractionNeeds(session, locale, skillIds, 'interactive');
    const activeToolIds = await this.resolveActiveToolIds(skillIds);
    const state = assessment.criticalMissing.length > 0
      ? 'collecting'
      : assessment.nonCriticalMissing.length > 0
        ? 'confirming'
        : 'ready';
    const interaction = await this.buildInteractionPayload(assessment, session, state, locale, skillIds, activeToolIds);
    const model = assessment.criticalMissing.length === 0
      ? await this.skillRuntime.buildModel(session.draft, skillIds)
      : undefined;

    return {
      draft: session.draft,
      resolved: session.resolved,
      interaction,
      model,
      updatedAt: session.updatedAt,
    };
  }

  listSkills() {
    return this.skillRuntime.listSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      structureType: skill.structureType,
      stages: skill.stages,
      triggers: skill.triggers,
      autoLoadByDefault: skill.autoLoadByDefault,
    }));
  }

  async clearConversationSession(conversationId: string | undefined): Promise<void> {
    if (!conversationId) {
      return;
    }
    await this.clearInteractionSession(conversationId);
  }

  static getProtocol(): AgentProtocol {
    const commonErrorCodes = [
      'UNSUPPORTED_SOURCE_FORMAT',
      'UNSUPPORTED_TARGET_FORMAT',
      'INVALID_STRUCTURE_MODEL',
      'INVALID_ANALYSIS_TYPE',
      'ANALYSIS_EXECUTION_FAILED',
      'AGENT_MISSING_MODEL_INPUT',
    ];
    const tools = listBuiltinToolManifests().map((tool) => ({
      id: tool.id,
      name: (tool.runtimeName ?? tool.id) as AgentToolName,
      description: tool.description.en,
      inputSchema: tool.inputSchema || { type: 'object' },
      outputSchema: tool.outputSchema || { type: 'object' },
      errorCodes: Array.isArray(tool.errorCodes) ? tool.errorCodes : [],
    }));

    return {
      version: '2.0.0',
      runRequestSchema: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          conversationId: { type: 'string' },
          traceId: { type: 'string' },
          context: {
            type: 'object',
            properties: {
            skillIds: { type: 'array', items: { type: 'string' } },
            engineId: { type: 'string' },
              model: { type: 'object' },
              modelFormat: { type: 'string' },
              enabledToolIds: { type: 'array', items: { type: 'string' } },
              disabledToolIds: { type: 'array', items: { type: 'string' } },
              analysisType: { enum: ['static', 'dynamic', 'seismic', 'nonlinear'] },
              parameters: { type: 'object' },
              autoAnalyze: { type: 'boolean' },
              autoCodeCheck: { type: 'boolean' },
              designCode: { type: 'string' },
              codeCheckElements: { type: 'array', items: { type: 'string' } },
              includeReport: { type: 'boolean' },
              reportFormat: { enum: ['json', 'markdown', 'both'] },
              reportOutput: { enum: ['inline', 'file'] },
              userDecision: { enum: ['provide_values', 'confirm_all', 'allow_auto_decide', 'revise'] },
              providedValues: { type: 'object' },
            },
          },
        },
      },
      runResultSchema: {
        type: 'object',
        required: ['traceId', 'startedAt', 'completedAt', 'durationMs', 'success', 'orchestrationMode', 'needsModelInput', 'plan', 'toolCalls', 'response'],
        properties: {
          success: { type: 'boolean' },
          traceId: { type: 'string' },
          startedAt: { type: 'string' },
          completedAt: { type: 'string' },
          durationMs: { type: 'number' },
          orchestrationMode: { enum: ['rule-based', 'llm-assisted'] },
          needsModelInput: { type: 'boolean' },
          plan: { type: 'array', items: { type: 'string' } },
          toolCalls: { type: 'array', items: { type: 'object' } },
          model: { type: 'object' },
          analysis: { type: 'object' },
          codeCheck: { type: 'object' },
          report: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              json: { type: 'object' },
              markdown: { type: 'string' },
            },
          },
          artifacts: { type: 'array', items: { type: 'object' } },
          metrics: {
            type: 'object',
            properties: {
              toolCount: { type: 'number' },
              failedToolCount: { type: 'number' },
              totalToolDurationMs: { type: 'number' },
              averageToolDurationMs: { type: 'number' },
              maxToolDurationMs: { type: 'number' },
              toolDurationMsByName: {
                type: 'object',
                additionalProperties: { type: 'number' },
              },
            },
          },
          interaction: {
            type: 'object',
            properties: {
              state: { enum: ['collecting', 'confirming', 'ready', 'executing', 'completed', 'blocked'] },
              stage: { enum: ['intent', 'model', 'loads', 'analysis', 'code_check', 'report'] },
              turnId: { type: 'string' },
              routeHint: { enum: ['prefer_conversation', 'prefer_tool'] },
              routeReason: { type: 'string' },
              detectedScenario: { type: 'string' },
              detectedScenarioLabel: { type: 'string' },
              conversationStage: { type: 'string' },
              missingCritical: { type: 'array', items: { type: 'string' } },
              missingOptional: { type: 'array', items: { type: 'string' } },
              fallbackSupportNote: { type: 'string' },
              recommendedNextStep: { type: 'string' },
              questions: { type: 'array', items: { type: 'object' } },
              pending: { type: 'object' },
              proposedDefaults: { type: 'array', items: { type: 'object' } },
              nextActions: { type: 'array', items: { type: 'string' } },
            },
          },
          response: { type: 'string' },
        },
      },
      streamEventSchema: {
        oneOf: [
          {
            type: 'object',
            properties: {
              type: { const: 'start' },
              content: {
                type: 'object',
                properties: {
                  traceId: { type: 'string' },
                  conversationId: { type: 'string' },
                  startedAt: { type: 'string' },
                },
              },
            },
            required: ['type'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'interaction_update' },
              content: { type: 'object' },
            },
            required: ['type', 'content'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'result' },
              content: { type: 'object' },
            },
            required: ['type', 'content'],
          },
          {
            type: 'object',
            properties: { type: { const: 'done' } },
            required: ['type'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'error' },
              error: { type: 'string' },
            },
            required: ['type', 'error'],
          },
        ],
      },
      tools,
      errorCodes: commonErrorCodes,
    };
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return this.runWithDirective(input, 'auto');
  }

  async runConversation(input: AgentRunInput): Promise<AgentRunResult> {
    return this.runWithDirective(input, 'force_conversation');
  }

  async runToolCall(input: AgentRunInput): Promise<AgentRunResult> {
    return this.runWithDirective(input, 'force_tool');
  }

  async *runStream(input: AgentRunInput): AsyncGenerator<AgentStreamChunk> {
    yield* this.runStreamWithDirective(input, 'auto');
  }

  async *runConversationStream(input: AgentRunInput): AsyncGenerator<AgentStreamChunk> {
    yield* this.runStreamWithDirective(input, 'force_conversation');
  }

  async *runToolCallStream(input: AgentRunInput): AsyncGenerator<AgentStreamChunk> {
    yield* this.runStreamWithDirective(input, 'force_tool');
  }

  private async runWithDirective(input: AgentRunInput, planningDirective: AgentPlanningDirective): Promise<AgentRunResult> {
    const preparedInput = await this.ensureConversationRecord(input);
    const traceId = input.traceId || randomUUID();
    return this.runInternal(preparedInput, traceId, planningDirective);
  }

  private async *runStreamWithDirective(
    input: AgentRunInput,
    planningDirective: AgentPlanningDirective,
  ): AsyncGenerator<AgentStreamChunk> {
    const preparedInput = await this.ensureConversationRecord(input);
    const traceId = randomUUID();
    const startedAt = new Date().toISOString();
    try {
      yield {
        type: 'start',
        content: {
          traceId,
          conversationId: preparedInput.conversationId,
          startedAt,
        },
      };

      const result = await this.runInternal({ ...preparedInput, traceId }, traceId, planningDirective);
      if (result.interaction && result.interaction.state !== 'completed') {
        yield {
          type: 'interaction_update',
          content: result.interaction,
        };
      }
      yield {
        type: 'result',
        content: result,
      };
      yield { type: 'done' };
    } catch (error: any) {
      yield {
        type: 'error',
        error: this.stringifyError(error),
      };
    }
  }

  private async runInternal(
    params: AgentRunInput,
    traceId: string,
    planningDirective: AgentPlanningDirective,
  ): Promise<AgentRunResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const prepared = await this.prepareRunContext(params);
    const {
      locale,
      orchestrationMode,
      modelInput,
      sourceFormat,
      autoAnalyze,
      analysisParameters,
      skillIds,
      noSkillMode,
      activeToolIds,
      sessionKey,
      workingSession,
      plan,
      toolCalls,
    } = prepared;

    const nextPlan = await this.planNextStep(params.message, {
      planningDirective,
      locale,
      skillIds,
      hasModel: Boolean(modelInput),
      session: workingSession,
      activeToolIds,
    });

    if (nextPlan.kind !== 'tool_call') {
      return this.handleConversationMode({
        nextPlan,
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        toolCalls,
        plan,
        sessionKey,
        workingSession,
        activeToolIds,
      });
    }

    const executableModel = await this.ensureExecutableModel({
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      noSkillMode,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      modelInput,
    });
    if (!executableModel.ok) {
      return executableModel.result;
    }
    const executionConfig = this.resolveExecutionConfig(workingSession, params, skillIds);
    const preparedExecutionModel = await this.prepareExecutionModel({
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      executableModel: executableModel.model,
      modelInput,
      sourceFormat,
      autoAnalyze,
    });
    if (!preparedExecutionModel.ok) {
      return preparedExecutionModel.result;
    }

    return this.runExecutionPipeline({
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      normalizedModel: preparedExecutionModel.value.normalizedModel,
      analysisParameters,
      autoAnalyze,
      executionConfig,
      validationWarning: preparedExecutionModel.value.validationWarning,
    });
  }

  private buildRecommendedNextStep(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] },
    interaction: AgentInteraction,
    locale: AppLocale,
    activeToolIds?: ActiveToolSet,
  ): string {
    if (assessment.criticalMissing.length > 0) {
      const nextLabel = interaction.questions?.[0]?.label || this.localize(locale, '关键参数', 'the key parameter');
      return this.localize(locale, `先补齐 ${nextLabel}。`, `Fill in ${nextLabel} first.`);
    }
    if (assessment.nonCriticalMissing.length > 0) {
      return this.localize(
        locale,
        '关键参数已基本齐备，继续确认分析类型、规范和报告偏好。',
        'Primary geometry and loading are mostly ready; continue by confirming analysis, code-check, and report preferences.'
      );
    }
    if (!this.hasActiveTool(activeToolIds, 'run_analysis')) {
      return this.localize(
        locale,
        '当前能力集中未启用分析 tool，可继续细化参数，或启用分析能力后再执行。',
        'The current capability set does not enable the analysis tool. Keep refining the inputs, or enable analysis capability before execution.'
      );
    }
    return this.localize(
      locale,
      '当前参数已足够进入执行阶段，可以直接让我开始分析，或继续微调参数。',
      'The current parameters are sufficient to proceed. You can ask me to start the analysis now, or keep refining the inputs.'
    );
  }

  private async prepareExecutionModel(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    activeToolIds?: ActiveToolSet;
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    executableModel: Record<string, unknown>;
    modelInput?: Record<string, unknown>;
    sourceFormat: string;
    autoAnalyze: boolean;
  }): Promise<
    | { ok: true; value: PreparedExecutionModel }
    | { ok: false; result: AgentRunResult }
  > {
    const normalized = await this.normalizeExecutionModel(args);
    if (!normalized.ok) {
      return normalized;
    }
    return this.validateExecutionModel({
      ...args,
      normalizedModel: normalized.value.normalizedModel,
    });
  }

  private async normalizeExecutionModel(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    activeToolIds?: ActiveToolSet;
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    executableModel: Record<string, unknown>;
    modelInput?: Record<string, unknown>;
    sourceFormat: string;
  }): Promise<
    | { ok: true; value: Pick<PreparedExecutionModel, 'normalizedModel'> }
    | { ok: false; result: AgentRunResult }
  > {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      executableModel,
      modelInput,
      sourceFormat,
    } = args;

    if (sourceFormat === 'structuremodel-v1') {
      return { ok: true, value: { normalizedModel: executableModel } };
    }

    if (!this.hasActiveTool(activeToolIds, 'convert_model')) {
      const response = this.buildDisabledToolMessage('convert_model', locale);
      return {
        ok: false,
        result: await this.finalizeBlockedRunResult({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response,
          model: executableModel,
        }),
      };
    }

    plan.push(this.localize(locale, `将输入模型从 ${sourceFormat} 转为 structuremodel-v1`, `Convert the input model from ${sourceFormat} to structuremodel-v1`));
    const convertInput = {
      model: modelInput,
      source_format: sourceFormat,
      target_format: 'structuremodel-v1',
      target_schema_version: '1.0.0',
    };
    const convertCall = this.startToolCall('convert', convertInput);
    toolCalls.push(convertCall);

    try {
      const converted = await this.structureProtocolClient.post('/convert', convertInput);
      this.completeToolCallSuccess(convertCall, converted.data);
      return {
        ok: true,
        value: {
          normalizedModel: (converted.data?.model ?? {}) as Record<string, unknown>,
        },
      };
    } catch (error: any) {
      this.completeToolCallError(convertCall, error);
      return {
        ok: false,
        result: await this.finalizeBlockedRunResult({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response: this.localize(locale, `模型格式转换失败：${convertCall.error}`, `Model conversion failed: ${convertCall.error}`),
        }),
      };
    }
  }

  private async validateExecutionModel(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    activeToolIds?: ActiveToolSet;
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    normalizedModel: Record<string, unknown>;
    autoAnalyze: boolean;
  }): Promise<
    | { ok: true; value: PreparedExecutionModel }
    | { ok: false; result: AgentRunResult }
  > {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      normalizedModel,
      autoAnalyze,
    } = args;

    if (!this.hasActiveTool(activeToolIds, 'validate_model')) {
      const response = this.buildDisabledToolMessage('validate_model', locale);
      return {
        ok: false,
        result: await this.finalizeBlockedRunResult({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response,
          model: normalizedModel,
        }),
      };
    }

    plan.push(this.localize(locale, '校验模型字段与引用完整性', 'Validate model fields and references'));
    const validateInput = { model: normalizedModel };
    const validateCall = this.startToolCall('validate', validateInput);
    toolCalls.push(validateCall);

    try {
      const validated = await this.structureProtocolClient.post('/validate', {
        ...validateInput,
        engineId: params.context?.engineId,
      });
      this.completeToolCallSuccess(validateCall, validated.data);
      if (validated.data?.valid === false) {
        validateCall.status = 'error';
        validateCall.errorCode = validated.data?.errorCode || 'INVALID_STRUCTURE_MODEL';
        validateCall.error = validated.data?.message || this.localize(locale, '模型校验失败', 'Model validation failed');
        return {
          ok: false,
          result: await this.finalizeBlockedRunResult({
            params,
            traceId,
            startedAt,
            startedAtMs,
            locale,
            orchestrationMode,
            skillIds,
            plan,
            toolCalls,
            sessionKey,
            workingSession,
            response: this.localize(locale, `模型校验失败：${validateCall.error}`, `Model validation failed: ${validateCall.error}`),
            model: normalizedModel,
          }),
        };
      }
      return { ok: true, value: { normalizedModel } };
    } catch (error: any) {
      this.completeToolCallError(validateCall, error);
      if (autoAnalyze && this.shouldBypassValidateFailure(error)) {
        const validationWarning = this.localize(
          locale,
          `模型校验服务暂时不可用，已跳过校验并继续分析：${validateCall.error}`,
          `The model validation service is temporarily unavailable. Validation was skipped and analysis will continue: ${validateCall.error}`,
        );
        plan.push(this.localize(locale, '校验服务不可用，跳过校验并继续分析', 'Validation service unavailable; skip validation and continue to analysis'));
        logger.warn({ traceId, validationError: validateCall.error }, 'Validate call failed with upstream error; continuing to analyze');
        return {
          ok: true,
          value: { normalizedModel, validationWarning },
        };
      }
      return {
        ok: false,
        result: await this.finalizeBlockedRunResult({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response: this.localize(locale, `模型校验失败：${validateCall.error}`, `Model validation failed: ${validateCall.error}`),
          model: normalizedModel,
        }),
      };
    }
  }

  private buildChatModeResponse(interaction: AgentInteraction, locale: AppLocale): string {
    const lines: string[] = [];
    if (interaction.detectedScenarioLabel) {
      lines.push(this.localize(locale, `识别场景：${interaction.detectedScenarioLabel}`, `Detected scenario: ${interaction.detectedScenarioLabel}`));
    }
    if (interaction.conversationStage) {
      lines.push(this.localize(locale, `当前阶段：${interaction.conversationStage}`, `Current stage: ${interaction.conversationStage}`));
    }
    if (interaction.fallbackSupportNote) {
      lines.push(interaction.fallbackSupportNote);
    }
    if (interaction.missingCritical?.length) {
      lines.push(this.localize(
        locale,
        `待补关键参数：${interaction.missingCritical.join('、')}`,
        `Critical parameters still needed: ${interaction.missingCritical.join(', ')}`
      ));
    }
    if (interaction.missingOptional?.length) {
      lines.push(this.localize(
        locale,
        `后续建议确认：${interaction.missingOptional.join('、')}`,
        `Recommended to confirm next: ${interaction.missingOptional.join(', ')}`
      ));
    }
    if (interaction.recommendedNextStep) {
      lines.push(this.localize(locale, `下一步：${interaction.recommendedNextStep}`, `Next step: ${interaction.recommendedNextStep}`));
    }
    if (interaction.questions?.length) {
      lines.push(this.localize(locale, `优先问题：${interaction.questions[0]?.question}`, `Priority question: ${interaction.questions[0]?.question}`));
    }
    return lines.join('\n');
  }

  private isNoSkillEquivalentDraft(skillIds: string[] | undefined, draft: DraftResult): boolean {
    if (this.isNoSkillMode(skillIds)) {
      return true;
    }
    return draft.inferredType === 'unknown' && !draft.scenario;
  }

  private buildGenericModelingIntro(locale: AppLocale, noSkillMode: boolean): string {
    if (noSkillMode) {
      return this.localize(locale, '当前未启用技能。我会走通用建模能力。', 'No skills are enabled. I will use generic modeling capability.');
    }
    return this.localize(locale, '当前所选技能未匹配到适用场景。我会回退到通用建模能力。', 'The selected skill did not match an applicable scenario. I will fall back to generic modeling capability.');
  }

  private async handleConversationMode(args: {
    nextPlan: AgentNextStepPlan;
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    toolCalls: AgentToolCall[];
    plan: string[];
    sessionKey?: string;
    workingSession: InteractionSession;
    activeToolIds?: ActiveToolSet;
  }): Promise<AgentRunResult> {
    const { nextPlan, params, traceId, startedAt, startedAtMs, locale, orchestrationMode, toolCalls, plan, sessionKey, workingSession, activeToolIds } = args;
    const noSkillMode = this.isNoSkillMode(params.context?.skillIds);

    if (nextPlan.kind === 'reply' && noSkillMode && !this.hasActiveTool(activeToolIds, 'draft_model')) {
      return this.buildPlainReplyConversationResult({
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds: params.context?.skillIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
      });
    }

    const { draft, noSkillEquivalentDraft } = await this.draftConversationState({
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds: params.context?.skillIds,
      noSkillMode,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
    });

    if (noSkillEquivalentDraft) {
      return this.buildGenericConversationResult({
        nextPlan,
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds: params.context?.skillIds,
        noSkillMode,
        activeToolIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
        draft,
      });
    }

    const resolved = await this.resolveConversationAssessment({
      locale,
      skillIds: params.context?.skillIds,
      activeToolIds,
      workingSession,
    });
    return this.buildStructuredConversationResult({
      nextPlan,
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds: params.context?.skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      draft,
      resolved,
    });
  }

  private resolveExecutionConfig(
    workingSession: InteractionSession,
    params: AgentRunInput,
    skillIds?: string[],
  ): ResolvedExecutionConfig {
    const codeFromSkills = resolveCodeCheckDesignCodeFromSkillIds(skillIds);
    return {
      analysisType: workingSession.resolved?.analysisType || params.context?.analysisType || inferAnalysisType(this.policy, params.message),
      designCode: workingSession.resolved?.designCode || params.context?.designCode || codeFromSkills,
      autoCodeCheck: workingSession.resolved?.autoCodeCheck
        ?? params.context?.autoCodeCheck
        ?? Boolean(codeFromSkills || workingSession.resolved?.designCode || params.context?.designCode),
      includeReport: workingSession.resolved?.includeReport ?? params.context?.includeReport ?? true,
      reportFormat: workingSession.resolved?.reportFormat || params.context?.reportFormat || 'both',
      reportOutput: workingSession.resolved?.reportOutput || params.context?.reportOutput || 'inline',
    };
  }

  private async ensureExecutableModel(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    noSkillMode: boolean;
    activeToolIds?: ActiveToolSet;
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    modelInput?: Record<string, unknown>;
  }): Promise<
    | { ok: true; model: Record<string, unknown> }
    | { ok: false; result: AgentRunResult }
  > {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      noSkillMode,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      modelInput,
    } = args;

    if (modelInput) {
      return { ok: true, model: modelInput };
    }

    if (!this.hasActiveTool(activeToolIds, 'draft_model')) {
      const response = this.buildDisabledToolMessage('draft_model', locale);
      return {
        ok: false,
        result: await this.finalizeBlockedRunResult({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response,
          needsModelInput: true,
        }),
      };
    }

    plan.push(this.localize(locale, '从自然语言生成结构模型草案（支持会话级补数）', 'Generate a structural model draft from natural language with session carry-over'));
    const draftCall = this.startToolCall('text-to-model-draft', { message: params.message, conversationId: sessionKey, phase: 'execution' });
    toolCalls.push(draftCall);

    const draft = await this.textToModelDraft(params.message, workingSession.draft, locale, skillIds);
    const noSkillEquivalentDraft = this.isNoSkillEquivalentDraft(skillIds, draft);
    if (draft.stateToPersist) {
      workingSession.draft = draft.stateToPersist;
    }
    if (draft.scenario) {
      workingSession.scenario = draft.scenario;
    } else if (noSkillEquivalentDraft) {
      workingSession.scenario = undefined;
    }
    workingSession.updatedAt = Date.now();
    this.applyInferredNonCriticalFromMessage(workingSession, params.message);

    this.completeToolCallSuccess(draftCall, {
      inferredType: draft.inferredType,
      missingFields: draft.missingFields,
      extractionMode: draft.extractionMode,
      modelGenerated: Boolean(draft.model),
    });

    if (workingSession.userApprovedAutoDecide) {
      for (let i = 0; i < 3; i += 1) {
        const assessment = await this.assessInteractionNeeds(workingSession, locale, skillIds);
        if (assessment.nonCriticalMissing.length === 0) {
          break;
        }
        this.applyNonCriticalDefaults(workingSession, assessment.defaultProposals);
      }
    }

    const availableModel = draft.model;
    const finalAssessment = (noSkillEquivalentDraft && availableModel)
      ? { criticalMissing: [], nonCriticalMissing: [], defaultProposals: [] }
      : await this.assessInteractionNeeds(workingSession, locale, skillIds);
    if (finalAssessment.criticalMissing.length > 0 || finalAssessment.nonCriticalMissing.length > 0 || !availableModel) {
      if (sessionKey) {
        await this.setInteractionSession(sessionKey, workingSession);
      }

      if (noSkillEquivalentDraft) {
        const missingFields = draft.missingFields.length > 0
          ? draft.missingFields
          : [this.localize(locale, '关键结构参数', 'key structural parameters')];
        const intro = this.buildGenericModelingIntro(locale, noSkillMode);
        const question = this.localize(
          locale,
          `${intro.replace(/。$/, '')}，请先补充：${missingFields.join('、')}。`,
          `${intro.replace(/\.$/, '')}. Please provide: ${missingFields.join(', ')}.`
        );
        return {
          ok: false,
          result: await this.finalizeBlockedRunResult({
            params,
            traceId,
            startedAt,
            startedAtMs,
            locale,
            orchestrationMode,
            skillIds,
            plan,
            toolCalls,
            sessionKey,
            workingSession,
            response: question,
            needsModelInput: true,
            clarification: {
              missingFields,
              question,
            },
          }),
        };
      }

      const interaction = await this.buildInteractionPayload(
        finalAssessment,
        workingSession,
        finalAssessment.criticalMissing.length > 0 ? 'confirming' : 'collecting',
        locale,
        skillIds,
      );
      const missingFields = await this.mapMissingFieldLabels(finalAssessment.criticalMissing, locale, workingSession.draft, skillIds);
      const question = this.buildInteractionQuestion(interaction, locale);
      return {
        ok: false,
        result: await this.finalizeRunResult(traceId, sessionKey, params.message, {
          traceId,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
          success: false,
          orchestrationMode,
          needsModelInput: finalAssessment.criticalMissing.length > 0,
          plan,
          toolCalls,
          metrics: this.buildMetrics(toolCalls),
          interaction,
          clarification: {
            missingFields,
            question,
          },
          response: question,
        }, skillIds, workingSession),
      };
    }

    return { ok: true, model: availableModel };
  }

  private async runExecutionPipeline(args: ExecutionPipelineArgs): Promise<AgentRunResult> {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      normalizedModel,
      analysisParameters,
      autoAnalyze,
      executionConfig,
      validationWarning,
    } = args;

    if (!autoAnalyze) {
      const response = await this.renderSummary(
        params.message,
        this.localize(locale, '模型已通过校验。根据当前配置，本轮未触发 analyze 工具。', 'The model passed validation. The analyze tool was not invoked for this turn under the current configuration.'),
        locale,
      );
      const result: AgentRunResult = {
        traceId,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        success: true,
        orchestrationMode,
        needsModelInput: false,
        plan,
        toolCalls,
        model: normalizedModel,
        metrics: this.buildMetrics(toolCalls),
        interaction: this.buildToolInteraction('completed', locale),
        response,
      };
      if (sessionKey) {
        await this.clearInteractionSession(sessionKey);
      }
      return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds, workingSession);
    }

    if (!this.hasActiveTool(activeToolIds, 'run_analysis')) {
      const response = this.buildDisabledToolMessage('run_analysis', locale);
      return this.finalizeBlockedRunResult({
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
        response,
        model: normalizedModel,
      });
    }

    const analyzed = await this.runAnalyzeStep(args);
    if (!analyzed.ok) {
      return analyzed.result;
    }

    const codeChecked = await this.runCodeCheckStep({
      ...args,
      analyzed: analyzed.value.data,
    });
    if (!codeChecked.ok) {
      return codeChecked.result;
    }

    const reported = await this.runReportStep({
      ...args,
      analyzed: analyzed.value.data,
      codeCheckResult: codeChecked.value,
    });
    return this.finalizeExecutionSuccess({
      ...args,
      analyzed: analyzed.value.data,
      codeCheckResult: codeChecked.value,
      report: reported.report,
      artifacts: reported.artifacts,
    });
  }

  private async runAnalyzeStep(args: ExecutionPipelineArgs): Promise<
    | { ok: true; value: { data: any } }
    | { ok: false; result: AgentRunResult }
  > {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      normalizedModel,
      analysisParameters,
      executionConfig,
    } = args;

    plan.push(this.localize(locale, `执行 ${executionConfig.analysisType} 分析并返回摘要`, `Run ${executionConfig.analysisType} analysis and return a summary`));
    const analyzeInput = {
      type: executionConfig.analysisType,
      engineId: params.context?.engineId,
      model: normalizedModel,
      parameters: this.buildAnalysisParameters(analysisParameters, normalizedModel),
    };
    const analyzeCall = this.startToolCall('analyze', analyzeInput);
    toolCalls.push(analyzeCall);

    try {
      const analyzed = await this.postToEngineWithRetry('/analyze', analyzeInput, {
        retries: 2,
        traceId,
        tool: 'analyze',
      });
      this.completeToolCallSuccess(analyzeCall, analyzed.data);
      return { ok: true, value: { data: analyzed.data } };
    } catch (error: any) {
      this.completeToolCallError(analyzeCall, error);
      const transientUpstreamFailure = this.shouldRetryEngineCall(error);
      return {
        ok: false,
        result: await this.finalizeBlockedRunResult({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response: transientUpstreamFailure
            ? this.localize(
              locale,
              `分析引擎服务暂时不可用，重试后仍失败：${analyzeCall.error}`,
              `The analysis engine is temporarily unavailable and still failed after retry: ${analyzeCall.error}`,
            )
            : this.localize(locale, `分析执行失败：${analyzeCall.error}`, `Analysis execution failed: ${analyzeCall.error}`),
          model: normalizedModel,
        }),
      };
    }
  }

  private async runCodeCheckStep(args: ExecutionPipelineArgs & { analyzed: any }): Promise<
    | { ok: true; value: unknown }
    | { ok: false; result: AgentRunResult }
  > {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      normalizedModel,
      analysisParameters,
      executionConfig,
      analyzed,
    } = args;

    const analysisSuccess = Boolean(analyzed?.success);
    if (!analysisSuccess || !executionConfig.autoCodeCheck || !executionConfig.designCode || !this.hasActiveTool(activeToolIds, 'run_code_check')) {
      return { ok: true, value: undefined };
    }

    plan.push(this.localize(locale, `执行 ${executionConfig.designCode} 规范校核`, `Run ${executionConfig.designCode} code checks`));
    const codeCheckInput = buildCodeCheckInput({
      traceId,
      designCode: executionConfig.designCode,
      model: normalizedModel,
      analysis: analyzed,
      analysisParameters,
      codeCheckElements: params.context?.codeCheckElements,
    });
    const codeCheckCall = this.startToolCall('code-check', codeCheckInput);
    toolCalls.push(codeCheckCall);

    try {
      const codeChecked = await executeCodeCheckDomain(this.codeCheckClient, codeCheckInput, params.context?.engineId);
      this.completeToolCallSuccess(codeCheckCall, codeChecked);
      return { ok: true, value: codeChecked };
    } catch (error: any) {
      this.completeToolCallError(codeCheckCall, error);
      return {
        ok: false,
        result: await this.finalizeBlockedRunResult({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response: this.localize(locale, `规范校核失败：${codeCheckCall.error}`, `Code check failed: ${codeCheckCall.error}`),
          model: normalizedModel,
        }),
      };
    }
  }

  private async runReportStep(args: ExecutionPipelineArgs & {
    analyzed: any;
    codeCheckResult: unknown;
  }): Promise<ExecutionArtifacts> {
    const {
      params,
      traceId,
      locale,
      skillIds,
      activeToolIds,
      plan,
      toolCalls,
      workingSession,
      executionConfig,
      analyzed,
      codeCheckResult,
    } = args;

    if (!analyzed?.success || !executionConfig.includeReport || !this.hasActiveTool(activeToolIds, 'generate_report')) {
      return {};
    }

    plan.push(this.localize(locale, '生成可读计算与校核报告', 'Generate a readable analysis and code-check report'));
    const reportCall = this.startToolCall('report', {
      message: params.message,
      analysis: analyzed,
      codeCheck: codeCheckResult,
      format: executionConfig.reportFormat,
    });
    toolCalls.push(reportCall);

    const report = await this.generateReport({
      message: params.message,
      analysisType: executionConfig.analysisType,
      analysis: analyzed,
      codeCheck: codeCheckResult,
      format: executionConfig.reportFormat,
      locale,
      draft: workingSession.draft,
      skillIds,
    });
    const artifacts = report && executionConfig.reportOutput === 'file'
      ? await this.persistReportArtifacts(traceId, report, executionConfig.reportFormat)
      : undefined;
    this.completeToolCallSuccess(reportCall, report);
    return { report, artifacts };
  }

  private async finalizeExecutionSuccess(args: ExecutionPipelineArgs & {
    analyzed: any;
    codeCheckResult: unknown;
    report?: AgentRunResult['report'];
    artifacts?: AgentRunResult['artifacts'];
  }): Promise<AgentRunResult> {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      normalizedModel,
      executionConfig,
      validationWarning,
      analyzed,
      codeCheckResult,
      report,
      artifacts,
    } = args;

    const analysisResultData = analyzed?.success ? (analyzed as Record<string, unknown>)['data'] : undefined;
    const response = await this.renderSummary(
      params.message,
      this.localize(
        locale,
        `分析完成。analysis_type=${executionConfig.analysisType}, success=${String(analyzed?.success ?? false)}`
          + (executionConfig.autoCodeCheck ? `, code_check=${String(Boolean(codeCheckResult))}` : '')
          + (validationWarning ? `, validation_warning=true` : ''),
        `Analysis finished. analysis_type=${executionConfig.analysisType}, success=${String(analyzed?.success ?? false)}`
          + (executionConfig.autoCodeCheck ? `, code_check=${String(Boolean(codeCheckResult))}` : '')
          + (validationWarning ? `, validation_warning=true` : ''),
      ),
      locale,
      analysisResultData,
      sessionKey,
    );

    if (sessionKey) {
      await this.clearInteractionSession(sessionKey);
    }
    return this.finalizeRunResult(traceId, sessionKey, params.message, {
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      success: Boolean(analyzed?.success),
      orchestrationMode,
      needsModelInput: false,
      plan,
      toolCalls,
      model: normalizedModel,
      analysis: analyzed,
      codeCheck: codeCheckResult,
      report,
      artifacts,
      metrics: this.buildMetrics(toolCalls),
      interaction: this.buildToolInteraction('completed', locale),
      response: validationWarning ? `${validationWarning}\n\n${response}` : response,
    }, skillIds, workingSession);
  }

  private async draftConversationState(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    noSkillMode: boolean;
    activeToolIds?: ActiveToolSet;
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
  }): Promise<{
    draft: DraftResult;
    noSkillEquivalentDraft: boolean;
  }> {
    const {
      params,
      locale,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      noSkillMode,
    } = args;

    plan.push(noSkillMode
      ? this.localize(locale, '按通用规则提取可计算结构参数', 'Extract computable structural parameters using generic rules')
      : this.localize(locale, '识别结构场景并匹配对话模板', 'Identify the structural scenario and select the matching dialogue template'));
    plan.push(this.localize(locale, '按当前阶段补齐关键工程参数', 'Collect the key engineering parameters for the current stage'));

    const draftCall = this.startToolCall('text-to-model-draft', { message: params.message, conversationId: sessionKey, phase: 'interactive' });
    toolCalls.push(draftCall);

    const draft = await this.textToModelDraft(params.message, workingSession.draft, locale, skillIds);
    const noSkillEquivalentDraft = this.isNoSkillEquivalentDraft(skillIds, draft);
    if (draft.stateToPersist) {
      workingSession.draft = draft.stateToPersist;
    }
    if (draft.scenario) {
      workingSession.scenario = draft.scenario;
    } else if (noSkillEquivalentDraft) {
      workingSession.scenario = undefined;
    }
    workingSession.updatedAt = Date.now();
    this.applyInferredNonCriticalFromMessage(workingSession, params.message);
    this.completeToolCallSuccess(draftCall, {
      inferredType: draft.inferredType,
      missingFields: draft.missingFields,
      extractionMode: draft.extractionMode,
      modelGenerated: Boolean(draft.model),
    });

    return { draft, noSkillEquivalentDraft };
  }

  private async buildPlainReplyConversationResult(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
  }): Promise<AgentRunResult> {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
    } = args;

    plan.push(this.localize(
      locale,
      '当前未启用工程技能或建模 tool，回退为普通对话回复',
      'No engineering skills or drafting tools are enabled, so the agent falls back to a plain chat reply',
    ));

    const fallback = this.localize(
      locale,
      '当前未启用结构技能或建模 tool。我可以先按普通对话协助你梳理需求；如果需要建模、分析或校核，请启用相应能力。',
      'Structural skills or drafting tools are not enabled right now. I can still help as a plain chat assistant; enable the relevant capabilities when you want modeling, analysis, or code checks.',
    );
    const response = await this.renderSummary(params.message, fallback, locale, undefined, sessionKey);

    return this.finalizeRunResult(traceId, sessionKey, params.message, {
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      success: true,
      orchestrationMode,
      needsModelInput: false,
      plan,
      toolCalls,
      metrics: this.buildMetrics(toolCalls),
      response,
    }, skillIds, workingSession);
  }

  private async buildGenericConversationResult(args: {
    nextPlan: AgentNextStepPlan;
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    noSkillMode: boolean;
    activeToolIds?: ActiveToolSet;
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    draft: DraftResult;
  }): Promise<AgentRunResult> {
    const {
      nextPlan,
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      noSkillMode,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      draft,
    } = args;

    if (sessionKey) {
      await this.setInteractionSession(sessionKey, workingSession);
    }

    if (draft.model && nextPlan.kind !== 'ask') {
      return this.buildGenericReplyResult({
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds,
        noSkillMode,
        activeToolIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
        draft,
      });
    }

    return this.buildGenericAskResult({
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      noSkillMode,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      draft,
    });
  }

  private async buildGenericReplyResult(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    noSkillMode: boolean;
    activeToolIds?: ActiveToolSet;
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    draft: DraftResult;
  }): Promise<AgentRunResult> {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      noSkillMode,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      draft,
    } = args;

    const interaction: AgentInteraction = {
      state: 'ready',
      stage: 'model',
      turnId: randomUUID(),
      routeHint: this.hasActiveTool(activeToolIds, 'run_analysis') ? 'prefer_tool' : 'prefer_conversation',
      routeReason: this.hasActiveTool(activeToolIds, 'run_analysis')
        ? this.localize(
          locale,
          noSkillMode
            ? '未启用技能，但当前输入已可直接生成结构模型。'
            : '所选技能未匹配场景，但当前输入已可直接生成结构模型。',
          noSkillMode
            ? 'No skills are enabled, but the current input is sufficient to build a structural model directly.'
            : 'The selected skill did not match, but the current input is sufficient to build a structural model directly.',
        )
        : this.localize(
          locale,
          '当前已能生成结构模型，但当前能力集中未启用分析 tool。',
          'A structural model is ready, but the current capability set does not enable the analysis tool.',
        ),
      conversationStage: this.getStageLabel('model', locale),
      missingCritical: [],
      missingOptional: [],
      questions: [],
      pending: {
        criticalMissing: [],
        nonCriticalMissing: [],
      },
      proposedDefaults: [],
      nextActions: ['confirm_all'],
      recommendedNextStep: this.hasActiveTool(activeToolIds, 'run_analysis')
        ? this.localize(
          locale,
          '可以直接让我开始分析，或继续补充更细的建模参数。',
          'You can ask me to start the analysis now, or continue refining modeling parameters.',
        )
        : this.localize(
          locale,
          '可以继续补充更细的建模参数，或启用分析 tool 后再执行。',
          'You can keep refining modeling parameters, or enable the analysis tool before execution.',
        ),
    };

    const response = this.localize(
      locale,
      noSkillMode
        ? '已根据当前输入直接生成结构模型 JSON，可直接触发分析工具。'
        : '所选技能未匹配场景，已回退到通用建模并生成结构模型 JSON，可直接触发分析工具。',
      noSkillMode
        ? 'A structural model JSON has been generated directly from your input and is ready for analysis tools.'
        : 'The selected skill did not match, so I fell back to generic modeling and generated a structural model JSON ready for analysis tools.',
    );

    return this.finalizeRunResult(traceId, sessionKey, params.message, {
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      success: true,
      orchestrationMode,
      needsModelInput: false,
      plan,
      toolCalls,
      metrics: this.buildMetrics(toolCalls),
      model: draft.model,
      interaction,
      response,
    }, skillIds, workingSession);
  }

  private async buildGenericAskResult(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    noSkillMode: boolean;
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    draft: DraftResult;
  }): Promise<AgentRunResult> {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      noSkillMode,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      draft,
    } = args;

    const missingFields = draft.missingFields.length > 0
      ? draft.missingFields
      : [this.localize(locale, '关键结构参数', 'key structural parameters')];
    const intro = this.buildGenericModelingIntro(locale, noSkillMode);
    const question = this.localize(
      locale,
      `${intro.replace(/。$/, '')}，请先补充：${missingFields.join('、')}。`,
      `${intro.replace(/\.$/, '')}. Please provide: ${missingFields.join(', ')}.`,
    );
    const interaction: AgentInteraction = {
      state: 'confirming',
      stage: 'model',
      turnId: randomUUID(),
      routeHint: 'prefer_conversation',
      routeReason: this.localize(
        locale,
        '当前仍缺少关键建模参数，请先补充后再触发工具。',
        'Critical modeling parameters are still missing. Please provide them before invoking tools.',
      ),
      conversationStage: this.getStageLabel('model', locale),
      missingCritical: missingFields,
      missingOptional: [],
      questions: [{
        paramKey: 'genericModeling',
        label: this.localize(locale, '关键参数', 'Key parameters'),
        question,
        required: true,
        critical: true,
      }],
      pending: {
        criticalMissing: missingFields,
        nonCriticalMissing: [],
      },
      proposedDefaults: [],
      nextActions: ['provide_values', 'revise'],
    };

    return this.finalizeRunResult(traceId, sessionKey, params.message, {
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      success: true,
      orchestrationMode,
      needsModelInput: true,
      plan,
      toolCalls,
      metrics: this.buildMetrics(toolCalls),
      interaction,
      clarification: {
        missingFields,
        question,
      },
      response: question,
    }, skillIds, workingSession);
  }

  private async resolveConversationAssessment(args: {
    locale: AppLocale;
    skillIds?: string[];
    activeToolIds?: ActiveToolSet;
    workingSession: InteractionSession;
  }): Promise<ResolvedConversationAssessment> {
    const { locale, skillIds, activeToolIds, workingSession } = args;

    let assessment = await this.assessInteractionNeeds(workingSession, locale, skillIds, 'interactive');

    // When all critical (structural) parameters are present, auto-apply defaults
    // for non-critical parameters (includeReport, reportFormat, reportOutput, etc.)
    // so the user is not forced to confirm each one individually.
    // Loop because applying one default (e.g. includeReport=true) may reveal
    // new non-critical parameters (e.g. reportFormat, reportOutput).
    while (assessment.criticalMissing.length === 0 && assessment.nonCriticalMissing.length > 0) {
      this.applyNonCriticalDefaults(workingSession, assessment.defaultProposals);
      assessment = await this.assessInteractionNeeds(workingSession, locale, skillIds, 'interactive');
    }

    const state: AgentInteractionState = assessment.criticalMissing.length > 0
      ? 'confirming'
      : assessment.nonCriticalMissing.length > 0
        ? 'collecting'
        : 'ready';
    const interaction = await this.buildInteractionPayload(assessment, workingSession, state, locale, skillIds, activeToolIds);
    interaction.recommendedNextStep = this.buildRecommendedNextStep(assessment, interaction, locale, activeToolIds);

    return { assessment, state, interaction };
  }

  private async buildStructuredConversationResult(args: {
    nextPlan: AgentNextStepPlan;
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    draft: DraftResult;
    resolved: ResolvedConversationAssessment;
  }): Promise<AgentRunResult> {
    const {
      nextPlan,
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      draft,
      resolved,
    } = args;

    if (sessionKey) {
      await this.setInteractionSession(sessionKey, workingSession);
    }

    if (resolved.state === 'ready' && nextPlan.kind !== 'ask') {
      return this.buildStructuredReplyResult({
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
        draft,
        resolved,
      });
    }

    return this.buildStructuredAskResult({
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      draft,
      resolved,
    });
  }

  private async buildStructuredReplyResult(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    draft: DraftResult;
    resolved: ResolvedConversationAssessment;
  }): Promise<AgentRunResult> {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      orchestrationMode,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      draft,
      resolved,
    } = args;

    const response = this.buildChatModeResponse(resolved.interaction, this.resolveInteractionLocale(params.context?.locale));
    return this.finalizeRunResult(traceId, sessionKey, params.message, {
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      success: true,
      orchestrationMode,
      needsModelInput: false,
      plan,
      toolCalls,
      metrics: this.buildMetrics(toolCalls),
      model: draft.model ?? undefined,
      interaction: resolved.interaction,
      response,
    }, skillIds, workingSession);
  }

  private async buildStructuredAskResult(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    draft: DraftResult;
    resolved: ResolvedConversationAssessment;
  }): Promise<AgentRunResult> {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      draft,
      resolved,
    } = args;

    const response = this.buildChatModeResponse(resolved.interaction, locale);
    return this.finalizeRunResult(traceId, sessionKey, params.message, {
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      success: true,
      orchestrationMode,
      needsModelInput: resolved.assessment.criticalMissing.length > 0,
      plan,
      toolCalls,
      metrics: this.buildMetrics(toolCalls),
      model: draft.model ?? undefined,
      interaction: resolved.interaction,
      clarification: resolved.interaction.questions?.length
        ? {
          missingFields: resolved.interaction.missingCritical || [],
          question: resolved.interaction.questions[0]?.question || response,
        }
        : undefined,
      response,
    }, skillIds, workingSession);
  }

  private async assessInteractionNeeds(
    session: InteractionSession,
    locale: AppLocale,
    skillIds?: string[],
    phase: AgentInteractionPhase = 'execution'
  ): Promise<{
    criticalMissing: string[];
    nonCriticalMissing: string[];
    defaultProposals: InteractionDefaultProposal[];
  }> {
    const activeToolIds = await this.resolveActiveToolIds(skillIds);
    const structural = await this.skillRuntime.assessDraft(
      session.draft,
      locale,
      phase,
      skillIds,
    );
    const criticalMissing = [...structural.criticalMissing];
    const nonCriticalMissing: string[] = [...structural.optionalMissing];
    const resolved = session.resolved || {};

    if (!resolved.analysisType && this.hasActiveTool(activeToolIds, 'run_analysis')) {
      nonCriticalMissing.push('analysisType');
    }
    if (resolved.includeReport === undefined && this.hasActiveTool(activeToolIds, 'generate_report')) {
      nonCriticalMissing.push('includeReport');
    }
    if (resolved.includeReport === true && !resolved.reportFormat && this.hasActiveTool(activeToolIds, 'generate_report')) {
      nonCriticalMissing.push('reportFormat');
    }
    if (resolved.includeReport === true && !resolved.reportOutput && this.hasActiveTool(activeToolIds, 'generate_report')) {
      nonCriticalMissing.push('reportOutput');
    }

    const structuralDefaults = await this.skillRuntime.buildStructuralDefaultProposals(
      structural.optionalMissing,
      session.draft,
      locale,
      skillIds,
    );
    const nonStructuralDefaults = this.policy.buildDefaultProposals(nonCriticalMissing, locale);
    const mergedDefaults = [...structuralDefaults, ...nonStructuralDefaults];
    const uniqueDefaults = Array.from(new Map(mergedDefaults.map((item) => [item.paramKey, item])).values());

    return {
      criticalMissing,
      nonCriticalMissing,
      defaultProposals: uniqueDefaults,
    };
  }

  private applyNonCriticalDefaults(session: InteractionSession, defaults: InteractionDefaultProposal[]): void {
    session.resolved = session.resolved || {};
    for (const proposal of defaults) {
      switch (proposal.paramKey) {
        case 'analysisType':
          session.resolved.analysisType = proposal.value as NonNullable<InteractionSession['resolved']>['analysisType'];
          break;
        case 'includeReport':
          session.resolved.includeReport = Boolean(proposal.value);
          break;
        case 'reportFormat':
          session.resolved.reportFormat = proposal.value as AgentReportFormat;
          break;
        case 'reportOutput':
          session.resolved.reportOutput = proposal.value as AgentReportOutput;
          break;
        default:
          break;
      }
    }
    session.updatedAt = Date.now();
  }

  private applyResolvedConfigFromContext(session: InteractionSession, context: AgentRunInput['context'] | undefined): void {
    if (!context) {
      return;
    }
    session.resolved = session.resolved || {};
    if (context.analysisType) {
      session.resolved.analysisType = context.analysisType;
    }
    if (context.designCode) {
      session.resolved.designCode = context.designCode;
    }
    if (context.autoCodeCheck !== undefined) {
      session.resolved.autoCodeCheck = context.autoCodeCheck;
    } else if (hasExplicitCodeCheckSkill(context.skillIds)) {
      session.resolved.autoCodeCheck = true;
    }
    if (context.includeReport !== undefined) {
      session.resolved.includeReport = context.includeReport;
    }
    if (context.reportFormat) {
      session.resolved.reportFormat = context.reportFormat;
    }
    if (context.reportOutput) {
      session.resolved.reportOutput = context.reportOutput;
    }
  }

  private applyInferredNonCriticalFromMessage(session: InteractionSession, message: string): void {
    session.resolved = session.resolved || {};
    if (!session.resolved.analysisType) {
      session.resolved.analysisType = inferAnalysisType(this.policy, message);
    }
    if (session.resolved.includeReport === undefined) {
      const reportIntent = inferReportIntent(this.policy, message);
      if (reportIntent !== undefined) {
        session.resolved.includeReport = reportIntent;
      }
    }
    if (session.resolved.includeReport === true && !session.resolved.reportFormat) {
      const format = this.policy.inferReportFormat(message);
      if (format) {
        session.resolved.reportFormat = format;
      }
    }
    if (session.resolved.includeReport === true && !session.resolved.reportOutput) {
      const output = this.policy.inferReportOutput(message);
      if (output) {
        session.resolved.reportOutput = output;
      }
    }
  }

  private async applyProvidedValuesToSession(
    session: InteractionSession,
    values: Record<string, unknown>,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<void> {
    if (!values || typeof values !== 'object') {
      return;
    }
    if (this.isNoSkillMode(skillIds)) {
      session.draft = normalizeNoSkillDraftState(session.draft);
      session.scenario = undefined;
    } else {
      session.draft = await this.skillRuntime.applyProvidedValues(session.draft, values, locale, skillIds);
      if (session.draft.scenarioKey) {
        session.scenario = {
          key: session.draft.scenarioKey,
          mappedType: session.draft.inferredType,
          skillId: session.draft.skillId,
          supportLevel: session.draft.supportLevel || 'supported',
          supportNote: session.draft.supportNote,
        };
      }
    }
    session.resolved = session.resolved || {};
    if (typeof values.analysisType === 'string') {
      session.resolved.analysisType = normalizePolicyAnalysisType(this.policy, values.analysisType);
    }
    // Keep the raw designCode as a compatibility bridge for legacy callers and custom-code-check flows.
    if (typeof values.designCode === 'string' && values.designCode.trim()) {
      session.resolved.designCode = values.designCode.trim().toUpperCase();
    }
    if (typeof values.autoCodeCheck === 'boolean') {
      session.resolved.autoCodeCheck = values.autoCodeCheck;
    }
    if (typeof values.includeReport === 'boolean') {
      session.resolved.includeReport = values.includeReport;
    }
    if (typeof values.reportFormat === 'string') {
      session.resolved.reportFormat = normalizePolicyReportFormat(this.policy, values.reportFormat);
    }
    if (typeof values.reportOutput === 'string') {
      session.resolved.reportOutput = normalizePolicyReportOutput(this.policy, values.reportOutput);
    }
    session.updatedAt = Date.now();
  }

  private async mapMissingFieldLabels(missing: string[], locale: AppLocale, draft: DraftState, skillIds?: string[]): Promise<string[]> {
    const labels = await this.skillRuntime.mapMissingFieldLabels(missing, locale, draft, skillIds);
    return missing.map((key, index) => {
      const policyLabel = this.policy.mapNonStructuralMissingFieldLabel(key, locale);
      return policyLabel || labels[index] || key;
    });
  }

  private async buildInteractionPayload(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] },
    session: InteractionSession,
    state: AgentInteractionState,
    locale: AppLocale,
    skillIds?: string[],
    activeToolIds?: ActiveToolSet,
  ): Promise<AgentInteraction> {
    const missingKeys = [...assessment.criticalMissing, ...assessment.nonCriticalMissing];
    const questions = await this.buildInteractionQuestions(missingKeys, assessment.criticalMissing, session, locale, skillIds);
    const stage = await this.resolveInteractionStage(missingKeys, session.draft, skillIds);
    const missingCritical = await this.mapMissingFieldLabels(assessment.criticalMissing, locale, session.draft, skillIds);
    const missingOptional = await this.mapMissingFieldLabels(assessment.nonCriticalMissing, locale, session.draft, skillIds);
    const route = this.buildInteractionRouteHint(assessment, stage, session, locale, activeToolIds);
    return {
      state,
      stage,
      turnId: randomUUID(),
      routeHint: route.routeHint,
      routeReason: route.routeReason,
      detectedScenario: session.scenario?.key,
      detectedScenarioLabel: session.scenario ? await this.getScenarioLabel(session.scenario.key, locale) : undefined,
      conversationStage: this.getStageLabel(stage, locale),
      missingCritical,
      missingOptional,
      fallbackSupportNote: session.scenario?.supportNote,
      questions,
      pending: {
        criticalMissing: missingCritical,
        nonCriticalMissing: missingOptional,
      },
      proposedDefaults: assessment.defaultProposals,
      nextActions: assessment.criticalMissing.length > 0
        ? ['provide_values', 'revise']
        : ['provide_values', 'allow_auto_decide', 'confirm_all', 'revise'],
    };
  }

  private buildInteractionRouteHint(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[] },
    stage: AgentInteractionStage,
    session: InteractionSession,
    locale: AppLocale,
    activeToolIds?: ActiveToolSet,
  ): { routeHint: AgentInteractionRouteHint; routeReason: string } {
    if (assessment.criticalMissing.length > 0) {
      if (stage === 'intent' || stage === 'model' || stage === 'loads') {
      return {
        routeHint: 'prefer_conversation',
        routeReason: this.localize(
          locale,
          '当前仍缺少关键建模参数，建议继续对话补参后再触发工具。',
          'Critical modeling inputs are still missing; continue clarification before invoking tools.',
        ),
      };
    }
    return {
      routeHint: 'prefer_conversation',
      routeReason: this.localize(
        locale,
        '仍有关键参数待确认，建议先完成参数补充。',
        'Key parameters are still pending; complete clarification first.',
      ),
    };
  }

  if (assessment.nonCriticalMissing.length > 0 && !session.userApprovedAutoDecide) {
    return {
      routeHint: 'prefer_conversation',
      routeReason: this.localize(
        locale,
        '分析、校核或报告偏好尚未确认，建议先确认策略再触发工具。',
        'Analysis, code-check, or reporting preferences are pending; confirm strategy before invoking tools.',
      ),
    };
  }

  if (!this.hasActiveTool(activeToolIds, 'run_analysis')) {
    return {
      routeHint: 'prefer_conversation',
      routeReason: this.localize(
        locale,
        '当前能力集中未启用分析 tool，建议先继续对话或调整能力集。',
        'The current capability set does not enable the analysis tool, so continue in conversation or adjust the capability set first.',
      ),
    };
  }

  return {
      routeHint: 'prefer_tool',
      routeReason: this.localize(
        locale,
        '当前参数已达到工具调用条件，可直接进入分析流程。',
        'Current inputs are ready for tool invocation; analysis can proceed directly.',
      ),
    };
  }

  private async buildInteractionQuestions(
    missingKeys: string[],
    criticalMissing: string[],
    session: InteractionSession,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<InteractionQuestion[]> {
    const structuralQuestions = new Map(
      (await this.skillRuntime.buildInteractionQuestions(missingKeys, criticalMissing, session.draft, locale, skillIds))
        .map((question) => [question.paramKey, question])
    );
    return missingKeys.map((paramKey) => {
      const critical = criticalMissing.includes(paramKey);
      const structuralQuestion = structuralQuestions.get(paramKey);
      if (structuralQuestion) {
        return structuralQuestion;
      }
      const policyQuestion = this.policy.buildNonStructuralInteractionQuestion(paramKey, locale, critical);
      if (policyQuestion) {
        return policyQuestion;
      }
      return { paramKey, label: paramKey, question: this.localize(locale, `请确认参数 ${paramKey}。`, `Please confirm parameter ${paramKey}.`), required: true, critical };
    });
  }

  private async resolveInteractionStage(missingKeys: string[], draft: DraftState, skillIds?: string[]): Promise<AgentInteractionStage> {
    const structuralStage = await this.skillRuntime.resolveInteractionStage(missingKeys, draft, skillIds);
    return this.policy.resolveInteractionStageFromMissing(structuralStage, missingKeys);
  }

  private buildInteractionQuestion(interaction: AgentInteraction, locale: AppLocale): string {
    const questionSummary = interaction.questions?.map((item) => item.label).join(locale === 'zh' ? '、' : ', ')
      || this.localize(locale, '必要参数', 'required parameters');
    return this.localize(
      locale,
      `请先确认以下参数：${questionSummary}。若希望我按保守值自动决策，请回复“你决定”并触发 allow_auto_decide。`,
      `Please confirm the following parameters first: ${questionSummary}. If you want me to choose conservative defaults automatically, reply with "you decide" and trigger allow_auto_decide.`
    );
  }

  private buildToolInteraction(state: 'completed' | 'blocked', locale: AppLocale): AgentInteraction {
    return {
      state,
      stage: 'report',
      turnId: randomUUID(),
      routeHint: 'prefer_tool',
      routeReason: state === 'completed'
        ? this.localize(locale, '工具调用已完成。', 'Tool invocation completed.')
        : this.localize(locale, '工具调用已触发，但被下游工具或校验失败阻断。', 'Tool invocation was attempted but blocked by downstream tool or validation failure.'),
      nextActions: state === 'completed' ? [] : ['revise'],
    };
  }

  private async generateReport(params: {
    message: string;
    analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    analysis: unknown;
    codeCheck?: unknown;
    format: AgentReportFormat;
    locale: AppLocale;
    draft?: DraftState;
    skillIds?: string[];
  }): Promise<AgentRunResult['report']> {
    const analysisSuccess = Boolean((params.analysis as any)?.success);
    const codeCheckText = buildCodeCheckSummaryText({
      codeCheck: params.codeCheck,
      locale: params.locale,
      localize: (locale, zh, en) => this.localize(locale, zh, en),
    });
    const summary = this.localize(
      params.locale,
      `分析类型 ${params.analysisType}，分析${analysisSuccess ? '成功' : '失败'}，${codeCheckText}。`,
      `Analysis type ${params.analysisType}; analysis ${analysisSuccess ? 'succeeded' : 'failed'}; ${codeCheckText}.`
    );
    const {
      keyMetrics,
      clauseTraceability,
      controllingCases,
      visualizationHints,
    } = buildReportDomainArtifacts(params.analysis, params.codeCheck);
    const jsonReport: Record<string, unknown> = {
      reportSchemaVersion: '1.0.0',
      intent: params.message,
      analysisType: params.analysisType,
      summary,
      keyMetrics,
      clauseTraceability,
      controllingCases,
      visualizationHints,
      analysis: params.analysis,
      codeCheck: params.codeCheck,
      generatedAt: new Date().toISOString(),
    };

    if (params.format === 'json') {
      return {
        summary,
        json: jsonReport,
      };
    }

    const markdown = await this.skillRuntime.buildReportNarrative({
      message: params.message,
      analysisType: params.analysisType,
      analysisSuccess,
      codeCheckText,
      summary,
      keyMetrics,
      clauseTraceability,
      controllingCases,
      visualizationHints,
      locale: params.locale,
    }, params.draft, params.skillIds);

    return {
      summary,
      json: jsonReport,
      markdown: params.format === 'both' || params.format === 'markdown' ? markdown : undefined,
    };
  }

  private async persistReportArtifacts(
    traceId: string,
    report: NonNullable<AgentRunResult['report']>,
    format: AgentReportFormat,
  ): Promise<NonNullable<AgentRunResult['artifacts']>> {
    const reportDir = config.reportsDir;
    await mkdir(reportDir, { recursive: true });

    const artifacts: NonNullable<AgentRunResult['artifacts']> = [];
    if (format === 'json' || format === 'both') {
      const jsonPath = path.join(reportDir, `${traceId}.json`);
      await writeFile(jsonPath, JSON.stringify(report.json, null, 2), 'utf-8');
      artifacts.push({
        type: 'report',
        format: 'json',
        path: jsonPath,
      });
    }
    if ((format === 'markdown' || format === 'both') && report.markdown) {
      const mdPath = path.join(reportDir, `${traceId}.md`);
      await writeFile(mdPath, report.markdown, 'utf-8');
      artifacts.push({
        type: 'report',
        format: 'markdown',
        path: mdPath,
      });
    }
    return artifacts;
  }

  private async renderSummary(message: string, fallback: string, locale: AppLocale, analysisData?: unknown, conversationId?: string): Promise<string> {
    if (!this.llm) {
      return fallback;
    }

    try {
      const hasData = analysisData && typeof analysisData === 'object';
      let conversationContext = '';
      if (conversationId) {
        try {
          const recentMessages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { role: true, content: true },
          });
          if (recentMessages.length > 0) {
            conversationContext = recentMessages
              .reverse()
              .map((m: { role: string; content: string }) => `${m.role}: ${m.content.slice(0, 200)}`)
              .join('\n');
          }
        } catch {
          // Non-blocking: proceed without conversation context.
        }
      }
      const promptParts = [
        this.localize(locale, '你是结构工程 Agent 的结果解释器。', 'You explain results produced by the structural engineering agent.'),
        hasData
          ? this.localize(locale, '请用中文在 250 字以内，根据用户意图从分析数据中提取用户关心的结果并回答。只引用数据中存在的数值，不要杜撰。若用户询问的数据未在当前分析数据中提供，请明确说明，并引导用户查看结构化数据结果与可视化界面。', 'Respond in English within 250 words. Extract and present the results the user cares about from the analysis data. Only cite values present in the data; do not invent data. If the requested value is not available in the current analysis data, say so clearly and direct the user to the structured results and visualization view.')
          : this.localize(locale, '请用中文在 80 字以内给出结论，不要杜撰未出现的数据。', 'Respond in English within 80 words and do not invent data that was not provided.'),
      ];
      if (conversationContext) {
        promptParts.push(this.localize(locale, `对话上下文：\n${conversationContext}`, `Conversation context:\n${conversationContext}`));
      }
      promptParts.push(
        this.localize(locale, `用户意图：${message}`, `User intent: ${message}`),
        this.localize(locale, `系统结果：${fallback}`, `System result: ${fallback}`),
      );
      if (hasData) {
        const dataObj = analysisData as Record<string, unknown>;
        const compact = JSON.stringify({
          analysisMode: dataObj['analysisMode'] ?? null,
          plane: dataObj['plane'] ?? null,
          summary: dataObj['summary'] ?? null,
          envelope: dataObj['envelope'] ?? null,
        });
        promptParts.push(this.localize(locale, `分析数据：${compact}`, `Analysis data: ${compact}`));
      }
      const prompt = promptParts.join('\n');
      const aiMessage = await this.llm.invoke(prompt);
      const content = typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
      return content || fallback;
    } catch {
      return fallback;
    }
  }

  private async textToModelDraft(message: string, existingState?: DraftState, locale: AppLocale = 'en', skillIds?: string[]): Promise<DraftResult> {
    if (this.isNoSkillMode(skillIds)) {
      return this.textToModelDraftWithoutSkills(message, existingState, locale);
    }
    const skillDraft = await this.skillRuntime.textToModelDraft(this.llm, message, existingState, locale, skillIds);
    if (skillDraft.model || skillDraft.inferredType !== 'unknown' || skillDraft.scenario?.skillId) {
      return skillDraft;
    }

    const selectedSkillMode = Array.isArray(skillIds) && skillIds.length > 0;
    if (!selectedSkillMode) {
      return skillDraft;
    }

    const genericDraft = await this.textToModelDraftWithoutSkills(message, existingState, locale);
    return genericDraft;
  }

  private isNoSkillMode(skillIds?: string[]): boolean {
    return !Array.isArray(skillIds) || skillIds.length === 0;
  }

  private async textToModelDraftWithoutSkills(
    message: string,
    existingState: DraftState | undefined,
    locale: AppLocale,
  ): Promise<DraftResult> {
    const noSkillState = normalizeNoSkillDraftState(existingState || { inferredType: 'unknown', updatedAt: Date.now() });

    if (!this.llm) {
      const configError = locale === 'zh'
        ? 'LLM 尚未配置。请在 .env 文件中设置 LLM_API_KEY、LLM_MODEL 和 LLM_BASE_URL。'
        : 'LLM is not configured. Please set LLM_API_KEY, LLM_MODEL, and LLM_BASE_URL in your .env file.';
      return {
        inferredType: noSkillState.inferredType,
        missingFields: [configError],
        extractionMode: 'llm',
        model: undefined,
        stateToPersist: noSkillState,
      };
    }

    const model = await tryNoSkillLlmBuildGenericModel(this.llm, message, noSkillState, locale);
    const missingFields = model ? [] : computeNoSkillMissingFields();

    return {
      inferredType: noSkillState.inferredType,
      missingFields,
      extractionMode: 'llm',
      model,
      stateToPersist: noSkillState,
    };
  }

  private buildAnalysisParameters(
    baseParameters: Record<string, unknown>,
    model: Record<string, unknown>,
  ): Record<string, unknown> {
    const next = { ...baseParameters };
    const modelLoadCases = this.normalizeModelLoadCases(model);
    const modelCombinations = this.normalizeModelCombinations(model);

    if (next.loadCases === undefined && modelLoadCases.length > 0) {
      next.loadCases = modelLoadCases;
    }
    if (next.combinations === undefined && modelCombinations.length > 0) {
      next.combinations = modelCombinations;
    }

    return next;
  }

  private normalizeModelLoadCases(model: Record<string, unknown>): Array<Record<string, unknown>> {
    const loadCases = Array.isArray(model.load_cases) ? model.load_cases : [];
    return loadCases
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item, index) => ({
        name: typeof item.id === 'string' ? item.id : `LC${index + 1}`,
        type: typeof item.type === 'string' ? item.type : 'other',
        loads: this.normalizeModelLoads(item.loads),
      }))
      .filter((item) => Array.isArray(item.loads) && item.loads.length > 0);
  }

  private normalizeModelCombinations(model: Record<string, unknown>): Array<Record<string, unknown>> {
    const combinations = Array.isArray(model.load_combinations) ? model.load_combinations : [];
    return combinations.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }

  private normalizeModelLoads(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => {
        if (item.type === 'distributed' || item.element !== undefined) {
          const magnitude = this.asNumber(item.wy ?? item.fy ?? item.wz ?? item.fz, 0);
          return {
            type: 'distributed',
            element: String(item.element ?? ''),
            wy: magnitude,
            wz: 0,
          };
        }

        const forces = Array.isArray(item.forces)
          ? item.forces.slice(0, 6).map((entry) => this.asNumber(entry, 0))
          : [
              this.asNumber(item.fx, 0),
              this.asNumber(item.fy ?? item.wy, 0),
              this.asNumber(item.fz ?? item.wz, 0),
              this.asNumber(item.mx, 0),
              this.asNumber(item.my, 0),
              this.asNumber(item.mz, 0),
            ];

        return {
          type: 'nodal',
          node: String(item.node ?? ''),
          forces: forces.length === 6 ? forces : [0, 0, 0, 0, 0, 0],
        };
      })
      .filter((item) => {
        if (item.type === 'distributed') {
          return typeof item.element === 'string' && item.element.length > 0;
        }
        return typeof item.node === 'string' && item.node.length > 0;
      });
  }

  private asNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  private startToolCall(tool: AgentToolName, input: Record<string, unknown>): AgentToolCall {
    return {
      tool,
      input,
      status: 'success',
      startedAt: new Date().toISOString(),
    };
  }

  private completeToolCallSuccess(call: AgentToolCall, output: unknown): void {
    call.status = 'success';
    call.output = output;
    call.completedAt = new Date().toISOString();
    call.durationMs = this.computeDurationMs(call.startedAt, call.completedAt);
  }

  private completeToolCallError(call: AgentToolCall, error: unknown): void {
    call.status = 'error';
    call.error = this.stringifyError(error);
    call.errorCode = this.extractErrorCode(error);
    call.completedAt = new Date().toISOString();
    call.durationMs = this.computeDurationMs(call.startedAt, call.completedAt);
  }

  private computeDurationMs(startedAt: string, completedAt: string): number {
    const start = Date.parse(startedAt);
    const end = Date.parse(completedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return 0;
    }
    return Math.max(0, end - start);
  }

  private stringifyError(error: unknown): string {
    const unknownError = error as any;
    const status = this.extractHttpStatus(error);
    if (unknownError?.response?.data) {
      const payload = typeof unknownError.response.data === 'string'
        ? unknownError.response.data
        : JSON.stringify(unknownError.response.data);
      return status ? `HTTP ${status}: ${payload}` : payload;
    }
    if (unknownError?.message) {
      return status ? `HTTP ${status}: ${String(unknownError.message)}` : String(unknownError.message);
    }
    return 'Unknown error';
  }

  private extractHttpStatus(error: unknown): number | undefined {
    const status = (error as any)?.response?.status;
    return typeof status === 'number' ? status : undefined;
  }

  private shouldBypassValidateFailure(error: unknown): boolean {
    return this.shouldRetryEngineCall(error);
  }

  private shouldRetryEngineCall(error: unknown): boolean {
    const status = this.extractHttpStatus(error);
    if (typeof status === 'number') {
      return status >= 500;
    }

    const code = (error as any)?.code;
    return code === 'ECONNABORTED' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT';
  }

  private async postToEngineWithRetry(
    path: string,
    payload: Record<string, unknown>,
    options: {
      retries: number;
      traceId: string;
      tool: AgentToolName;
    },
  ) {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= options.retries) {
      try {
        return await this.engineClient.post(path, payload);
      } catch (error) {
        lastError = error;
        if (!this.shouldRetryEngineCall(error) || attempt === options.retries) {
          throw error;
        }
        logger.warn(
          {
            traceId: options.traceId,
            tool: options.tool,
            attempt: attempt + 1,
            error: this.stringifyError(error),
          },
          'Transient engine call failed; retrying',
        );
      }
      attempt += 1;
    }
    throw lastError;
  }

  private extractErrorCode(error: unknown): string | undefined {
    const payload = (error as any)?.response?.data;
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const code = (payload.errorCode || payload.error_code) as unknown;
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }
    return undefined;
  }

  private buildClarificationQuestion(missingFields: string[]): string {
    return `请继续补充以下信息：${missingFields.join('、')}。我会沿用你前一轮已提供的参数继续建模。`;
  }

  private buildMetrics(toolCalls: AgentToolCall[]): NonNullable<AgentRunResult['metrics']> {
    const durations = toolCalls
      .map((call) => call.durationMs || 0)
      .filter((duration) => Number.isFinite(duration) && duration >= 0);
    const totalToolDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
    const maxToolDurationMs = durations.length > 0 ? Math.max(...durations) : 0;
    const toolDurationMsByName: Record<string, number> = {};
    for (const call of toolCalls) {
      const duration = call.durationMs || 0;
      toolDurationMsByName[call.tool] = (toolDurationMsByName[call.tool] || 0) + duration;
    }

    return {
      toolCount: toolCalls.length,
      failedToolCount: toolCalls.filter((call) => call.status === 'error').length,
      totalToolDurationMs,
      averageToolDurationMs: durations.length > 0 ? totalToolDurationMs / durations.length : 0,
      maxToolDurationMs,
      toolDurationMsByName,
    };
  }

  private async finalizeRunResult(
    traceId: string,
    conversationId: string | undefined,
    userMessage: string,
    result: AgentRunResult,
    skillIds?: string[],
    session?: InteractionSession,
  ): Promise<AgentRunResult> {
    result.conversationId = conversationId;
    result.routing = this.buildResolvedRouting(result, skillIds, session);
    await this.persistConversationMessages(conversationId, userMessage, result, skillIds);
    this.logRunResult(traceId, conversationId, result);
    return result;
  }

  private async ensureConversationRecord(input: AgentRunInput): Promise<AgentRunInput> {
    const conversationId = input.conversationId?.trim();
    if (conversationId) {
      return {
        ...input,
        conversationId,
      };
    }

    const conversation = await prisma.conversation.create({
      data: {
        title: input.message.slice(0, 50),
        type: 'general',
        userId: input.userId,
      },
      select: {
        id: true,
      },
    });

    return {
      ...input,
      conversationId: conversation.id,
    };
  }

  private buildResolvedRouting(
    result: AgentRunResult,
    skillIds?: string[],
    session?: InteractionSession,
  ): AgentResolvedRouting | undefined {
    const selectedSkillIds = Array.isArray(skillIds)
      ? skillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];

    const routing: AgentResolvedRouting = {
      selectedSkillIds,
    };

    const structuralSkillId = session?.scenario?.skillId || session?.draft?.skillId;
    if (structuralSkillId) {
      routing.structuralSkillId = structuralSkillId;
    }

    const structuralScenarioKey = session?.scenario?.key || session?.draft?.scenarioKey;
    if (structuralScenarioKey) {
      routing.structuralScenarioKey = structuralScenarioKey;
    }

    const analysisRecord = result.analysis && typeof result.analysis === 'object'
      ? result.analysis as Record<string, unknown>
      : undefined;
    const analysisMeta = analysisRecord?.meta && typeof analysisRecord.meta === 'object'
      ? analysisRecord.meta as Record<string, unknown>
      : undefined;

    if (typeof analysisMeta?.analysisSkillId === 'string' && analysisMeta.analysisSkillId.trim().length > 0) {
      routing.analysisSkillId = analysisMeta.analysisSkillId;
    }
    if (Array.isArray(analysisMeta?.analysisSkillIds)) {
      routing.analysisSkillIds = analysisMeta.analysisSkillIds
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }

    if (
      routing.selectedSkillIds.length === 0
      && !routing.structuralSkillId
      && !routing.structuralScenarioKey
      && !routing.analysisSkillId
      && (!routing.analysisSkillIds || routing.analysisSkillIds.length === 0)
    ) {
      return undefined;
    }

    return routing;
  }

  private buildPersistedDebugDetails(
    userMessage: string,
    result: AgentRunResult,
    skillIds?: string[],
  ): PersistedMessageDebugDetails {
    const safeSkillIds = Array.isArray(skillIds) ? skillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
    const promptSnapshot = JSON.stringify({
      message: userMessage,
      context: {
        traceId: result.traceId,
        skillIds: safeSkillIds,
      },
    }, null, 2);

    return {
      promptSnapshot,
      skillIds: safeSkillIds,
      routing: result.routing,
      responseSummary: result.response || '',
      plan: Array.isArray(result.plan) ? result.plan : [],
      toolCalls: Array.isArray(result.toolCalls) ? result.toolCalls : [],
    };
  }

  private async persistConversationMessages(
    conversationId: string | undefined,
    userMessage: string,
    result: AgentRunResult,
    skillIds?: string[],
  ): Promise<void> {
    const assistantMessage = result.response;
    if (!conversationId || !userMessage.trim() || !assistantMessage?.trim()) {
      return;
    }

    const debugDetails = this.buildPersistedDebugDetails(userMessage, result, skillIds);

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true },
      });
      if (!conversation) {
        return;
      }

      await prisma.message.createMany({
        data: [
          {
            conversationId,
            role: 'user',
            content: userMessage.trim(),
          },
          {
            conversationId,
            role: 'assistant',
            content: assistantMessage.trim(),
            metadata: {
              debugDetails,
            } as unknown as InputJsonValue,
          },
        ],
      });
    } catch {
      // Keep message persistence non-blocking so agent flows still complete.
    }
  }

  private buildInteractionSessionKey(conversationId: string): string {
    return `agent:interaction-session:${conversationId}`;
  }

  private buildLegacyDraftStateKey(conversationId: string): string {
    return `agent:draft-state:${conversationId}`;
  }

  private async getInteractionSession(conversationId: string | undefined): Promise<InteractionSession | undefined> {
    if (!conversationId) {
      return undefined;
    }

    try {
      const raw = await redis.get(this.buildInteractionSessionKey(conversationId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.draft) {
          return parsed as InteractionSession;
        }
      }

      const legacyRaw = await redis.get(this.buildLegacyDraftStateKey(conversationId));
      if (!legacyRaw) {
        return undefined;
      }
      const legacyParsed = JSON.parse(legacyRaw);
      if (!legacyParsed || typeof legacyParsed !== 'object') {
        return undefined;
      }
      return {
        draft: legacyParsed as DraftState,
        resolved: {},
        updatedAt: Date.now(),
      };
    } catch {
      return undefined;
    }
  }

  private async setInteractionSession(conversationId: string, session: InteractionSession): Promise<void> {
    try {
      await redis.setex(
        this.buildInteractionSessionKey(conversationId),
        AgentService.draftStateTtlSeconds,
        JSON.stringify(session),
      );
    } catch {
      // Keep non-blocking behavior for session persistence.
    }
  }

  private async clearInteractionSession(conversationId: string): Promise<void> {
    try {
      await redis.del(this.buildInteractionSessionKey(conversationId));
      await redis.del(this.buildLegacyDraftStateKey(conversationId));
    } catch {
      // Keep non-blocking behavior for session cleanup.
    }
  }

  private logRunResult(traceId: string, conversationId: string | undefined, result: AgentRunResult): void {
    logger.info({
      traceId,
      conversationId,
      success: result.success,
      orchestrationMode: result.orchestrationMode,
      durationMs: result.durationMs,
      metrics: result.metrics,
      toolCalls: result.toolCalls.map((call) => ({
        tool: call.tool,
        status: call.status,
        durationMs: call.durationMs,
        errorCode: call.errorCode,
      })),
    }, 'agent run completed');
  }
}
