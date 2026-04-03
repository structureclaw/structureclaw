import { ChatOpenAI } from '@langchain/openai';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import type { InputJsonValue } from '../utils/json.js';
import { createChatModel } from '../utils/llm.js';
import { prisma } from '../utils/database.js';
import { logger } from '../utils/logger.js';
// redis is now accessed via agent-session.ts
import { type AppLocale } from './locale.js';
import { AgentPolicyService } from './agent-policy.js';
import {
  AgentSkillRuntime,
  type DraftResult,
  type DraftState,
  type StructuralTypeMatch,
  type StructuralTypeKey,
} from '../agent-runtime/index.js';
import {
  inferCodeCheckIntent,
  inferAnalysisType,
  inferReportIntent,
  normalizePolicyAnalysisType,
  normalizePolicyReportFormat,
  normalizePolicyReportOutput,
} from '../agent-skills/design/entry.js';
import { createLocalAnalysisEngineClient } from './analysis-execution.js';
import { createLocalCodeCheckClient } from './code-check-execution.js';
import { createLocalStructureProtocolClient } from './structure-protocol-execution.js';
import type { LocalAnalysisEngineClient } from '../agent-skills/analysis/types.js';
import { listBuiltinToolManifests } from '../agent-runtime/tool-registry.js';
import type { ToolManifest } from '../agent-runtime/types.js';
import { executeConvertModelStep } from '../agent-tools/builtin/convert-model.js';
import { executeDraftModelExecutionStep, executeDraftModelInteractiveStep } from '../agent-tools/builtin/draft-model.js';
import { executeGenerateReportStep } from '../agent-tools/builtin/generate-report.js';
import { executeRunAnalysisStep } from '../agent-tools/builtin/run-analysis.js';
import { executeRunCodeCheckStep } from '../agent-tools/builtin/run-code-check.js';
import { executeUpdateModelExecutionStep } from '../agent-tools/builtin/update-model.js';
// executeValidateModelStep is now accessed via agent-validation.ts
import { buildTurnContext, type HandlerDeps, type RouteDecision } from './agent-context.js';
import { handleChat } from './agent-handlers/index.js';
import {
  getInteractionSession as getInteractionSessionFromStore,
  setInteractionSession as setInteractionSessionToStore,
  clearInteractionSession as clearInteractionSessionFromStore,
  buildInteractionSessionKey as buildSessionKey,
} from './agent-session.js';
import { validateWithRetry } from './agent-validation.js';
import {
  planNextStep as routerPlanNextStep,
  buildPlannerContextSnapshot as routerBuildPlannerContextSnapshot,
  extractJsonObject as routerExtractJsonObject,
  parsePlannerResponse as routerParsePlannerResponse,
  repairPlannerResponse as routerRepairPlannerResponse,
  resolveInteractivePlanKind as routerResolveInteractivePlanKind,
} from './agent-router.js';
import {
  buildMetrics as resultBuildMetrics,
  buildInteractionQuestion as resultBuildInteractionQuestion,
  buildToolInteraction as resultBuildToolInteraction,
  buildRecommendedNextStep as resultBuildRecommendedNextStep,
  buildGenericModelingIntro as resultBuildGenericModelingIntro,
  buildChatModeResponse as resultBuildChatModeResponse,
  renderSummary as resultRenderSummary,
} from './agent-result.js';

export type AgentToolName = 'draft_model' | 'update_model' | 'convert_model' | 'validate_model' | 'run_analysis' | 'run_code_check' | 'generate_report';
export type AgentOrchestrationMode = 'directed' | 'llm-planned';
export type AgentInteractionPhase = 'interactive' | 'execution';
export type AgentReportFormat = 'json' | 'markdown' | 'both';
export type AgentReportOutput = 'inline' | 'file';
export type AgentUserDecision = 'provide_values' | 'confirm_all' | 'allow_auto_decide' | 'revise';
export type AgentBlockedReasonCode =
  | 'NO_EXECUTABLE_TOOL'
  | 'TOOL_DISABLED'
  | 'TOOL_REQUIRES_SKILL'
  | 'TOOL_REQUIRES_TOOL';
export type AgentInteractionState = 'collecting' | 'confirming' | 'ready' | 'executing' | 'completed' | 'blocked';
export type AgentInteractionStage = 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';
export type AgentInteractionRouteHint = 'prefer_interactive' | 'prefer_tool';

export interface InteractionSession {
  state?: import('./agent-context.js').SessionState;
  stateReason?: string;
  draft?: DraftState;
  structuralTypeMatch?: StructuralTypeMatch;
  latestModel?: Record<string, unknown>;
  userApprovedAutoDecide?: boolean;
  validationAttempts?: number;
  lastValidationError?: string;
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

export interface InteractionQuestion {
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

export interface InteractionDefaultProposal {
  paramKey: string;
  value: unknown;
  reason: string;
}

interface PersistedMessageDebugDetails {
  promptSnapshot: string;
  skillIds: string[];
  activatedSkillIds: string[];
  routing?: AgentResolvedRouting;
  responseSummary: string;
  plan: string[];
  toolCalls: AgentToolCall[];
}

export type ActiveToolSet = Set<string> | undefined;

// Platform foundation tools are runtime-level capabilities and can stay always available.
const PLATFORM_FOUNDATION_TOOL_IDS: AgentToolName[] = [
  'convert_model',
];

export type AgentPlanKind = 'reply' | 'ask' | 'tool_call';
export type AgentPlanningDirective = 'auto' | 'force_tool';
export type AgentReplyMode = 'plain' | 'structured';

interface AgentRunStrategy {
  planningDirective: AgentPlanningDirective;
  allowToolCall: boolean;
}

export interface AgentNextStepPlan {
  kind: AgentPlanKind;
  replyMode?: AgentReplyMode;
  planningDirective: AgentPlanningDirective;
  rationale: 'override' | 'llm';
}

export interface SkillDrivenToolDecision {
  toolId: AgentToolName;
  reason: string;
}

export interface ResolvedExecutionConfig {
  analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
  designCode?: string;
  autoCodeCheck: boolean;
  includeReport: boolean;
  reportFormat: AgentReportFormat;
  reportOutput: AgentReportOutput;
}

export interface ExecutionPipelineArgs {
  params: AgentRunInput;
  traceId: string;
  startedAt: string;
  startedAtMs: number;
  locale: AppLocale;
  orchestrationMode: AgentOrchestrationMode;
  skillIds?: string[];
  activeSkillIds?: string[];
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
  activeSkillIds?: string[];
  noSkillMode: boolean;
  hadExistingSession: boolean;
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

export interface PlannerContextSnapshot {
  hasActiveSession: boolean;
  hasModel: boolean;
  inferredType: DraftState['inferredType'] | null;
  structuralTypeKey?: string;
  criticalMissing: string[];
  nonCriticalMissing: string[];
  readyForExecution: boolean;
  availableToolIds: string[];
  skillIds: string[];
  recentConversation: string[];
  lastAssistantMessage?: string;
  sessionState?: import('./agent-context.js').SessionState;
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
  activatedSkillIds?: string[];
  structuralSkillId?: string;
  analysisSkillId?: string;
  analysisSkillIds?: string[];
  codeCheckSkillId?: string;
  validationSkillId?: string;
  reportSkillId?: string;
}

export interface AgentInteraction {
  state: AgentInteractionState;
  stage: AgentInteractionStage;
  turnId: string;
  routeHint?: AgentInteractionRouteHint;
  routeReason?: string;
  interactionStageLabel?: string;
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
  source?: ToolManifest['source'];
  authorizedBySkillIds?: string[];
  input: Record<string, unknown>;
  status: 'success' | 'error';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  output?: unknown;
  error?: string;
  errorCode?: string;
  blockedReasonCode?: AgentBlockedReasonCode | string;
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
  blockedReasonCode?: AgentBlockedReasonCode | string;
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

  private buildHandlerDeps(): HandlerDeps {
    return {
      llm: this.llm,
      skillRuntime: this.skillRuntime,
      policy: this.policy,
      localize: this.localize.bind(this),
      hasActiveTool: this.hasActiveTool.bind(this),
      hasEmptySkillSelection: this.hasEmptySkillSelection.bind(this),
      setInteractionSession: this.setInteractionSession.bind(this),
      assessInteractionNeeds: this.assessInteractionNeeds.bind(this),
      buildInteractionPayload: this.buildInteractionPayload.bind(this),
      mapMissingFieldLabels: this.mapMissingFieldLabels.bind(this),
      buildInteractionQuestion: this.buildInteractionQuestion.bind(this),
      buildRecommendedNextStep: this.buildRecommendedNextStep.bind(this),
      buildToolInteraction: this.buildToolInteraction.bind(this),
      extractDraftParameters: this.skillRuntime.extractDraftParameters.bind(this.skillRuntime),
      buildModelFromDraft: this.skillRuntime.buildModelFromDraft.bind(this.skillRuntime),
      textToModelDraft: this.textToModelDraft.bind(this),
      isGenericFallbackDraft: this.isGenericFallbackDraft.bind(this),
      applyDraftToSession: this.applyDraftToSession.bind(this),
      renderDirectReply: this.renderDirectReply.bind(this),
      renderInteractionResponse: this.renderInteractionResponse.bind(this),
      buildChatModeResponse: this.buildChatModeResponse.bind(this),
      finalizeRunResult: this.finalizeRunResult.bind(this),
      finalizeBlockedRunResult: this.finalizeBlockedRunResult.bind(this),
      buildMetrics: this.buildMetrics.bind(this),
      buildGenericModelingIntro: this.buildGenericModelingIntro.bind(this),
      resolveConversationAssessment: this.resolveConversationAssessment.bind(this),
      resolveConversationModel: this.resolveConversationModel.bind(this),
      startToolCall: this.startToolCall.bind(this),
      completeToolCallSuccess: this.completeToolCallSuccess.bind(this),
    };
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

  private async getStructuralTypeLabel(key: StructuralTypeKey, locale: AppLocale): Promise<string> {
    return this.skillRuntime.getStructuralTypeLabel(key, locale);
  }

  async assessAutoRouteKind(message: string, options?: {
    locale?: AppLocale;
    conversationId?: string;
    skillIds?: string[];
    enabledToolIds?: string[];
    disabledToolIds?: string[];
    hasModel?: boolean;
  }): Promise<AgentPlanKind> {
    const locale = this.resolveInteractionLocale(options?.locale);
    const sessionKey = options?.conversationId?.trim();
    const session = await this.getInteractionSession(sessionKey);
    const activeToolIds = await this.resolveActiveToolIds(options?.skillIds, options?.skillIds, {
      enabledToolIds: options?.enabledToolIds,
      disabledToolIds: options?.disabledToolIds,
    });
    const nextPlan = await this.planNextStep(message, {
      planningDirective: 'auto',
      allowToolCall: true,
      locale,
      skillIds: options?.skillIds,
      hasModel: Boolean(options?.hasModel),
      session,
      activeToolIds,
      conversationId: sessionKey,
    });
    return nextPlan.kind;
  }

  private async buildPlannerContextSnapshot(options: {
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
    conversationId?: string;
  }): Promise<PlannerContextSnapshot> {
    return routerBuildPlannerContextSnapshot(options, this.assessInteractionNeeds.bind(this));
  }

  private extractJsonObject(raw: string): string | null {
    return routerExtractJsonObject(raw);
  }

  private parsePlannerResponse(
    raw: string,
    allowedKinds: AgentPlanKind[],
  ): Pick<AgentNextStepPlan, 'kind' | 'replyMode'> | null {
    return routerParsePlannerResponse(raw, allowedKinds);
  }

  private async repairPlannerResponse(raw: string, options: {
    locale: AppLocale;
    allowedKinds: AgentPlanKind[];
    availableToolIds: AgentToolName[];
  }): Promise<Pick<AgentNextStepPlan, 'kind' | 'replyMode'> | null> {
    return routerRepairPlannerResponse(this.llm, raw, options);
  }

  private async planNextStepWithLlm(message: string, options: {
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
    allowedKinds?: AgentPlanKind[];
    conversationId?: string;
  }): Promise<AgentNextStepPlan> {
    return routerPlanNextStep(this.llm, message, {
      ...options,
      planningDirective: 'auto',
      allowToolCall: true,
    }, this.assessInteractionNeeds.bind(this), this.hasEmptySkillSelection.bind(this));
  }

  private async planNextStep(message: string, options: {
    planningDirective: AgentPlanningDirective;
    allowToolCall: boolean;
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
    conversationId?: string;
  }): Promise<AgentNextStepPlan> {
    return routerPlanNextStep(this.llm, message, options, this.assessInteractionNeeds.bind(this), this.hasEmptySkillSelection.bind(this));
  }

  private async resolveInteractivePlanKind(options: {
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
  }): Promise<Exclude<AgentPlanKind, 'tool_call'>> {
    return routerResolveInteractivePlanKind(
      options,
      this.assessInteractionNeeds.bind(this),
      this.hasEmptySkillSelection.bind(this),
      this.hasActiveTool.bind(this),
    );
  }

  private async prepareRunContext(params: AgentRunInput): Promise<PreparedRunContext> {
    const locale = this.resolveInteractionLocale(params.context?.locale);
    const skillIds = params.context?.skillIds;
    const noSkillMode = this.hasEmptySkillSelection(skillIds);
    const sessionKey = params.conversationId?.trim();
    const session = await this.getInteractionSession(sessionKey);
    const workingSession: InteractionSession = session || {
      updatedAt: Date.now(),
      resolved: {},
    };

    if (noSkillMode) {
      workingSession.draft = undefined;
      workingSession.structuralTypeMatch = undefined;
      workingSession.latestModel = undefined;
    }

    this.applyResolvedConfigFromContext(workingSession, params.context);
    await this.applyProvidedValuesToSession(workingSession, params.context?.providedValues || {}, locale, skillIds);
    const userDecision = params.context?.userDecision;
    if (userDecision === 'allow_auto_decide' || userDecision === 'confirm_all') {
      workingSession.userApprovedAutoDecide = true;
    } else if (userDecision === 'revise') {
      workingSession.userApprovedAutoDecide = false;
    }
    const modelInput = params.context?.model || session?.latestModel;
    const activeSkillIds = await this.resolveActiveDomainSkillIds({
      selectedSkillIds: skillIds,
      workingSession,
      modelInput,
      message: params.message,
      context: params.context,
    });
    const activeToolIds = await this.resolveActiveToolIds(skillIds, activeSkillIds, {
      enabledToolIds: params.context?.enabledToolIds,
      disabledToolIds: params.context?.disabledToolIds,
    });

    return {
      locale,
      orchestrationMode: 'directed',
      modelInput,
      sourceFormat: params.context?.modelFormat || 'structuremodel-v1',
      autoAnalyze: params.context?.autoAnalyze ?? true,
      analysisParameters: params.context?.parameters || {},
      skillIds,
      activeSkillIds,
      noSkillMode,
      hadExistingSession: Boolean(session),
      activeToolIds,
      sessionKey,
      workingSession,
      plan: [],
      toolCalls: [],
    };
  }

  private normalizeSkillIds(skillIds?: string[]): string[] {
    return Array.isArray(skillIds)
      ? skillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
  }

  private resolvePreferredAnalysisModelFamilies(args: {
    workingSession: InteractionSession;
    modelInput?: Record<string, unknown>;
  }): string[] {
    const structuralType = args.workingSession.structuralTypeMatch?.key
      || args.workingSession.draft?.structuralTypeKey
      || args.workingSession.draft?.inferredType;
    if (structuralType === 'truss') {
      return ['truss', 'generic'];
    }
    if (
      structuralType === 'beam'
      || structuralType === 'frame'
      || structuralType === 'portal-frame'
      || structuralType === 'double-span-beam'
    ) {
      return ['frame', 'generic'];
    }

    const modelElements = args.modelInput?.elements;
    if (Array.isArray(modelElements) && modelElements.some((element) => {
      if (!element || typeof element !== 'object') {
        return false;
      }
      return (element as Record<string, unknown>).type === 'truss';
    })) {
      return ['truss', 'generic'];
    }

    return ['generic'];
  }

  private async resolveActiveDomainSkillIds(args: {
    selectedSkillIds?: string[];
    workingSession: InteractionSession;
    modelInput?: Record<string, unknown>;
    message: string;
    context?: AgentRunInput['context'];
  }): Promise<string[] | undefined> {
    if (this.hasEmptySkillSelection(args.selectedSkillIds)) {
      return [];
    }

    const selectedSkillIds = this.normalizeSkillIds(args.selectedSkillIds);
    const manifests = await this.skillRuntime.listSkillManifests();
    const activatedSkillIds = new Set<string>(selectedSkillIds);
    const selectedSkillSet = new Set(selectedSkillIds);
    const structuralSkillId = args.workingSession.structuralTypeMatch?.skillId
      || args.workingSession.draft?.skillId
      || manifests.find((manifest) => manifest.domain === 'structure-type' && selectedSkillSet.has(manifest.id))?.id;
    if (structuralSkillId) {
      activatedSkillIds.add(structuralSkillId);
    }

    const hasStructuralContext = Boolean(structuralSkillId || args.workingSession.draft || args.modelInput || args.workingSession.latestModel);
    const hasExecutionIntent = this.policy.inferExecutionIntent(args.message) || this.policy.inferProceedIntent(args.message);
    const analysisType = args.workingSession.resolved?.analysisType
      || args.context?.analysisType
      || inferAnalysisType(this.policy, args.message);
    const explicitDesignCode = args.workingSession.resolved?.designCode
      || args.context?.designCode
      || this.policy.inferDesignCode(args.message);
    const designCode = explicitDesignCode || this.skillRuntime.resolveCodeCheckDesignCodeFromSkillIds(selectedSkillIds);
    const shouldActivateValidation = hasStructuralContext || hasExecutionIntent || inferCodeCheckIntent(this.policy, args.message) || inferReportIntent(this.policy, args.message) === true;
    if (shouldActivateValidation) {
      activatedSkillIds.add('validation-structure-model');
    }

    if (hasStructuralContext || hasExecutionIntent || args.context?.autoAnalyze === true) {
      const preferredAnalysisSkill = this.skillRuntime.resolvePreferredAnalysisSkill({
        analysisType,
        engineId: args.context?.engineId,
        skillIds: selectedSkillIds,
        supportedModelFamilies: this.resolvePreferredAnalysisModelFamilies({
          workingSession: args.workingSession,
          modelInput: args.modelInput,
        }),
      });
      if (preferredAnalysisSkill) {
        activatedSkillIds.add(preferredAnalysisSkill.id);
      }
    }

    const shouldActivateCodeCheck = Boolean(designCode) && (
      args.workingSession.resolved?.autoCodeCheck
      ?? args.context?.autoCodeCheck
      ?? inferCodeCheckIntent(this.policy, args.message)
      ?? true
    );
    if (shouldActivateCodeCheck) {
      const codeCheckSkillId = this.skillRuntime.resolveCodeCheckSkillId(designCode);
      if (codeCheckSkillId) {
        activatedSkillIds.add(codeCheckSkillId);
      }
    }

    const shouldActivateReport = (
      args.workingSession.resolved?.includeReport
      ?? args.context?.includeReport
      ?? true
    ) && (hasStructuralContext || hasExecutionIntent || inferReportIntent(this.policy, args.message) === true);
    if (shouldActivateReport) {
      activatedSkillIds.add('report-export-builtin');
    }

    if (activatedSkillIds.size === 0) {
      return args.selectedSkillIds === undefined ? undefined : [];
    }

    return Array.from(activatedSkillIds).sort();
  }

  private async resolveAvailableTooling(
    selectedSkillIds?: string[],
    activeSkillIds?: string[],
  ): Promise<{ tools: ToolManifest[]; skillIdsByToolId: Record<string, string[]> }> {
    const toolMap = new Map<string, ToolManifest>();
    const ownerMap = new Map<string, Set<string>>();
    const keyCache = new Set<string>();
    const toolingInputs: Array<string[] | undefined> = [selectedSkillIds, activeSkillIds];

    for (const skillIds of toolingInputs) {
      const cacheKey = skillIds === undefined ? '__AUTO__' : JSON.stringify(this.normalizeSkillIds(skillIds));
      if (keyCache.has(cacheKey)) {
        continue;
      }
      keyCache.add(cacheKey);
      const tooling = await this.skillRuntime.resolveSkillTooling(skillIds);
      for (const tool of tooling.tools) {
        if (!toolMap.has(tool.id)) {
          toolMap.set(tool.id, tool);
        }
      }
      for (const [toolId, skillOwners] of Object.entries(tooling.skillIdsByToolId)) {
        if (!ownerMap.has(toolId)) {
          ownerMap.set(toolId, new Set());
        }
        for (const skillId of skillOwners) {
          ownerMap.get(toolId)!.add(skillId);
        }
      }
    }

    return {
      tools: Array.from(toolMap.values()).sort((left, right) => left.id.localeCompare(right.id)),
      skillIdsByToolId: Array.from(ownerMap.entries()).reduce<Record<string, string[]>>((acc, [toolId, skillOwners]) => {
        acc[toolId] = Array.from(skillOwners).sort();
        return acc;
      }, {}),
    };
  }

  private async resolveActiveToolIds(
    selectedSkillIds?: string[],
    activeSkillIds?: string[],
    options?: { enabledToolIds?: string[]; disabledToolIds?: string[] },
  ): Promise<ActiveToolSet> {
    const builtinCatalog = new Set(listBuiltinToolManifests().map((tool) => tool.id));
    const active = new Set<string>();

    for (const toolId of PLATFORM_FOUNDATION_TOOL_IDS) {
      if (builtinCatalog.has(toolId)) {
        active.add(toolId);
      }
    }

    const tooling = await this.resolveAvailableTooling(selectedSkillIds, activeSkillIds);
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
      ? options.enabledToolIds
        .map((toolId) => (typeof toolId === 'string' ? toolId.trim() : ''))
        .filter((toolId): toolId is string => toolId.length > 0)
      : undefined;
    const disabledToolIds = Array.isArray(options?.disabledToolIds)
      ? options.disabledToolIds
        .map((toolId) => (typeof toolId === 'string' ? toolId.trim() : ''))
        .filter((toolId): toolId is string => toolId.length > 0)
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

  private async resolveSelectedToolManifest(toolId: string, skillIds?: string[]): Promise<ToolManifest | undefined> {
    const builtin = listBuiltinToolManifests().find((tool) => tool.id === toolId);
    if (builtin) {
      return builtin;
    }
    const tooling = await this.resolveAvailableTooling(undefined, skillIds);
    return tooling.tools.find((tool) => tool.id === toolId);
  }

  private buildMissingToolRequirements(args: {
    manifest: ToolManifest;
    skillIds?: string[];
    activeToolIds?: ActiveToolSet;
  }): { missingSkills: string[]; missingTools: string[] } {
    const selectedSkillIds = new Set(Array.isArray(args.skillIds) ? args.skillIds : []);
    const missingSkills = Array.isArray(args.manifest.requiresSkills)
      ? args.manifest.requiresSkills.filter((skillId) => !selectedSkillIds.has(skillId))
      : [];
    const missingTools = Array.isArray(args.manifest.requiresTools)
      ? args.manifest.requiresTools.filter((toolId) => !this.hasActiveTool(args.activeToolIds, toolId))
      : [];
    return { missingSkills, missingTools };
  }

  private buildToolRequirementMessage(args: {
    locale: AppLocale;
    toolId: string;
    missingSkills: string[];
    missingTools: string[];
  }): string {
    if (args.locale === 'zh') {
      const parts: string[] = [];
      if (args.missingSkills.length > 0) {
        parts.push(`缺少能力集: ${args.missingSkills.join(', ')}`);
      }
      if (args.missingTools.length > 0) {
        parts.push(`缺少依赖工具: ${args.missingTools.join(', ')}`);
      }
      return `无法执行 ${args.toolId}，${parts.join('；')}。`;
    }
    const parts: string[] = [];
    if (args.missingSkills.length > 0) {
      parts.push(`missing skills: ${args.missingSkills.join(', ')}`);
    }
    if (args.missingTools.length > 0) {
      parts.push(`missing prerequisite tools: ${args.missingTools.join(', ')}`);
    }
    return `Cannot execute ${args.toolId}: ${parts.join('; ')}.`;
  }

  private inferSkillDrivenToolDecision(args: {
    message: string;
    locale: AppLocale;
    activeToolIds?: ActiveToolSet;
    modelInput?: Record<string, unknown>;
    workingSession: InteractionSession;
  }): SkillDrivenToolDecision | null {
    const {
      message,
      locale,
      activeToolIds,
      modelInput,
      workingSession,
    } = args;
    const hasModel = Boolean(modelInput || workingSession.latestModel);
    const asksUpdate = /(改成|改为|修改|更新|change\s+to|update|revise)/i.test(message);
    const asksModeling = /(设计|建模|模型|model|draft|design)/i.test(message);
    const asksFreshModel = /(重新|重建|从头|新建|全新|new|fresh|scratch|from\s+scratch)/i.test(message);
    const asksRunAnalysis = /(分析|analysis|analy[sz]e|analyze|验算|计算)/i.test(message);
    const asksCodeCheck = /(规范|校核|code\s*check|compliance)/i.test(message);
    const asksReport = /(报告|report|导出|export)/i.test(message);

    if (hasModel && asksUpdate && this.hasActiveTool(activeToolIds, 'update_model')) {
      return {
        toolId: 'update_model',
        reason: this.localize(locale, '命中模型修改意图，优先走 update_model', 'Detected model-update intent; prefer update_model'),
      };
    }

    if ((asksFreshModel || !hasModel || (asksModeling && !asksRunAnalysis && !asksReport && !asksCodeCheck))
      && this.hasActiveTool(activeToolIds, 'draft_model')) {
      return {
        toolId: 'draft_model',
        reason: this.localize(
          locale,
          asksFreshModel
            ? '命中新建模型意图，优先重新草拟结构模型'
            : '优先通过 draft_model 建立本轮结构模型',
          asksFreshModel
            ? 'Detected fresh-model intent; prefer re-drafting the structural model'
            : 'Prefer draft_model to establish the structural model for this turn',
        ),
      };
    }

    if (hasModel && asksCodeCheck && this.hasActiveTool(activeToolIds, 'run_code_check')) {
      return {
        toolId: 'run_code_check',
        reason: this.localize(locale, '命中规范校核意图，优先走 run_code_check', 'Detected code-check intent; prefer run_code_check'),
      };
    }

    if (hasModel && asksReport && this.hasActiveTool(activeToolIds, 'generate_report')) {
      return {
        toolId: 'generate_report',
        reason: this.localize(locale, '命中报告生成意图，优先走 generate_report', 'Detected report intent; prefer generate_report'),
      };
    }

    if (hasModel && (asksRunAnalysis || asksModeling) && this.hasActiveTool(activeToolIds, 'run_analysis')) {
      return {
        toolId: 'run_analysis',
        reason: this.localize(locale, '模型已就绪，命中分析意图，走 run_analysis', 'Model is ready and analysis intent is detected; select run_analysis'),
      };
    }

    if (hasModel && this.hasActiveTool(activeToolIds, 'validate_model')) {
      return {
        toolId: 'validate_model',
        reason: this.localize(locale, '模型已存在，先做 validate_model 作为执行入口', 'Model exists; validate_model is used as execution entrypoint'),
      };
    }

    if (this.hasActiveTool(activeToolIds, 'draft_model')) {
      return {
        toolId: 'draft_model',
        reason: this.localize(locale, '回退到 draft_model 以建立可执行模型', 'Fallback to draft_model to establish an executable model'),
      };
    }

    return null;
  }

  private buildDisabledToolMessage(toolId: string, locale: AppLocale): string {
    switch (toolId) {
      case 'draft_model':
        return this.localize(locale, '当前能力集中未启用 `draft_model`，无法从对话直接生成结构模型。', 'The current capability set does not enable `draft_model`, so a structural model cannot be generated directly from conversation.');
      case 'update_model':
        return this.localize(locale, '当前能力集中未启用 `update_model`，无法基于现有模型继续修改。', 'The current capability set does not enable `update_model`, so the existing structural model cannot be updated.');
      case 'convert_model':
        return this.localize(locale, '当前能力集中未启用 `convert_model`。', 'The current capability set does not enable `convert_model`.');
      case 'validate_model':
        return this.localize(locale, '当前能力集中未启用 `validate_model`。', 'The current capability set does not enable `validate_model`.');
      case 'run_analysis':
        return this.localize(locale, '当前能力集中未启用 `run_analysis`。', 'The current capability set does not enable `run_analysis`.');
      case 'run_code_check':
        return this.localize(locale, '当前能力集中未启用 `run_code_check`。', 'The current capability set does not enable `run_code_check`.');
      case 'generate_report':
        return this.localize(locale, '当前能力集中未启用 `generate_report`。', 'The current capability set does not enable `generate_report`.');
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
    selectedSkillIds?: string[];
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    response: string;
    blockedReasonCode?: AgentBlockedReasonCode | string;
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
      selectedSkillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      response,
      blockedReasonCode,
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
      blockedReasonCode,
      plan,
      toolCalls,
      model,
      metrics: this.buildMetrics(toolCalls),
      interaction: interaction || this.buildToolInteraction('blocked', locale),
      clarification,
      response,
    }, skillIds, workingSession, selectedSkillIds);
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

    if (this.hasEmptySkillSelection(skillIds)) {
      session.draft = undefined;
      session.structuralTypeMatch = undefined;
      session.latestModel = undefined;
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
    const model = assessment.criticalMissing.length === 0 && session.draft
      ? (session.latestModel || await this.skillRuntime.buildModel(session.draft, skillIds))
      : undefined;

    return {
      draft: session.draft || { inferredType: 'unknown', updatedAt: session.updatedAt },
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
      name: tool.id as AgentToolName,
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
          orchestrationMode: { enum: ['directed', 'llm-planned'] },
          needsModelInput: { type: 'boolean' },
          blockedReasonCode: { type: 'string' },
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
              routeHint: { enum: ['prefer_interactive', 'prefer_tool'] },
              routeReason: { type: 'string' },
              interactionStageLabel: { type: 'string' },
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
    return this.runWithStrategy(input, { planningDirective: 'auto', allowToolCall: true });
  }

  async runChatOnly(input: AgentRunInput): Promise<AgentRunResult> {
    return this.runWithStrategy(input, { planningDirective: 'auto', allowToolCall: false });
  }

  async runForcedExecution(input: AgentRunInput): Promise<AgentRunResult> {
    return this.runWithStrategy(input, { planningDirective: 'force_tool', allowToolCall: true });
  }

  async *runStream(input: AgentRunInput): AsyncGenerator<AgentStreamChunk> {
    yield* this.runStreamWithStrategy(input, { planningDirective: 'auto', allowToolCall: true });
  }

  async *runChatOnlyStream(input: AgentRunInput): AsyncGenerator<AgentStreamChunk> {
    yield* this.runStreamWithStrategy(input, { planningDirective: 'auto', allowToolCall: false });
  }

  async *runForcedExecutionStream(input: AgentRunInput): AsyncGenerator<AgentStreamChunk> {
    yield* this.runStreamWithStrategy(input, { planningDirective: 'force_tool', allowToolCall: true });
  }

  private async runWithStrategy(
    input: AgentRunInput,
    strategy: AgentRunStrategy,
  ): Promise<AgentRunResult> {
    const preparedInput = await this.ensureConversationRecord(input);
    const traceId = input.traceId || randomUUID();
    return this.runInternal(preparedInput, traceId, strategy);
  }

  private async *runStreamWithStrategy(
    input: AgentRunInput,
    strategy: AgentRunStrategy,
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

      const result = await this.runInternal({ ...preparedInput, traceId }, traceId, strategy);
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
    strategy: AgentRunStrategy,
  ): Promise<AgentRunResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const prepared = await this.prepareRunContext(params);
    const {
      locale,
      modelInput,
      sourceFormat,
      autoAnalyze,
      analysisParameters,
      skillIds,
      activeSkillIds,
      noSkillMode,
      hadExistingSession,
      activeToolIds,
      sessionKey,
      workingSession,
      plan,
      toolCalls,
    } = prepared;
    const { planningDirective, allowToolCall } = strategy;
    const orchestrationMode: AgentOrchestrationMode = planningDirective === 'force_tool'
      ? 'directed'
      : 'llm-planned';

    let nextPlan: AgentNextStepPlan;
    try {
      nextPlan = await this.planNextStep(params.message, {
        planningDirective,
        allowToolCall,
        locale,
        skillIds,
        hasModel: Boolean(modelInput || workingSession.latestModel),
        session: workingSession,
        activeToolIds,
        conversationId: sessionKey,
      });
    } catch (error: any) {
      const plannerErrorCode = typeof error?.message === 'string' ? error.message : 'LLM_PLANNER_UNAVAILABLE';
      const plannerResponse = plannerErrorCode === 'LLM_PLANNER_INVALID_RESPONSE'
        ? this.localize(
          locale,
          '当前无法可靠解析大模型的下一步决策结果，本轮不会自动进入工程技能或工具链。请重试，或改用明确的交互/执行入口。',
          'The model planner returned an invalid next-step decision, so this turn will not automatically enter the engineering skill or tool chain. Please retry, or use an explicit interactive/tool entrypoint.',
        )
        : this.localize(
          locale,
          '当前自动路由依赖大模型规划，但规划器不可用，因此本轮不会退回任何确定性分流。请先恢复 LLM planner，或改用明确的交互/执行入口。',
          'Automatic routing now depends on the LLM planner. The planner is unavailable, so this turn will not fall back to deterministic routing. Restore the LLM planner or use an explicit interactive/tool entrypoint.',
        );
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
        response: plannerResponse,
        blockedReasonCode: 'NO_EXECUTABLE_TOOL',
        needsModelInput: false,
      });
    }

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

    const skillDrivenToolDecision = this.inferSkillDrivenToolDecision({
      message: params.message,
      locale,
      activeToolIds,
      modelInput,
      workingSession,
    });
    if (!skillDrivenToolDecision) {
      const response = this.localize(
        locale,
        '当前能力集无法为本轮请求选择可执行工具，请先启用建模或分析能力。',
        'No executable tool can be selected for this request under the current capability set. Enable drafting or analysis capabilities first.',
      );
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
        blockedReasonCode: 'NO_EXECUTABLE_TOOL',
        needsModelInput: !modelInput && !workingSession.latestModel,
      });
    }
    const selectedToolId = skillDrivenToolDecision.toolId;
    plan.push(skillDrivenToolDecision.reason);

    const selectedToolManifest = await this.resolveSelectedToolManifest(selectedToolId, activeSkillIds);
    if (selectedToolManifest) {
      const { missingSkills, missingTools } = this.buildMissingToolRequirements({
        manifest: selectedToolManifest,
        skillIds: activeSkillIds,
        activeToolIds,
      });
      if (missingSkills.length > 0 || missingTools.length > 0) {
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
          response: this.buildToolRequirementMessage({
            locale,
            toolId: selectedToolId,
            missingSkills,
            missingTools,
          }),
          blockedReasonCode: missingSkills.length > 0 ? 'TOOL_REQUIRES_SKILL' : 'TOOL_REQUIRES_TOOL',
          needsModelInput: !modelInput && !workingSession.latestModel,
        });
      }
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
      hadExistingSession,
      selectedToolId,
    });
    if (!executableModel.ok) {
      return executableModel.result;
    }
    const executionConfig = this.resolveExecutionConfig(workingSession, params, activeSkillIds);
    const preparedExecutionModel = await this.prepareExecutionModel({
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      activeSkillIds,
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
      activeSkillIds,
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
    return resultBuildRecommendedNextStep(assessment, interaction, locale, activeToolIds);
  }

  private async prepareExecutionModel(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    activeSkillIds?: string[];
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
    activeSkillIds?: string[];
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
      activeSkillIds,
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
          skillIds: activeSkillIds ?? skillIds,
          selectedSkillIds: skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response,
          blockedReasonCode: 'TOOL_DISABLED',
          model: executableModel,
        }),
      };
    }

    const result = await executeConvertModelStep({
      locale,
      sourceFormat,
      modelInput,
      plan,
      toolCalls,
      localize: this.localize.bind(this),
      startToolCall: this.startToolCall.bind(this),
      completeToolCallSuccess: this.completeToolCallSuccess.bind(this),
      completeToolCallError: this.completeToolCallError.bind(this),
      structureProtocolClient: this.structureProtocolClient,
      buildBlockedResult: async (response) => this.finalizeBlockedRunResult({
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds: activeSkillIds ?? skillIds,
        selectedSkillIds: skillIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
        response,
      }),
    });
    if (!result.ok) {
      return result;
    }
    return {
      ok: true,
      value: {
        normalizedModel: result.normalizedModel,
      },
    };
  }

  private async validateExecutionModel(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    activeSkillIds?: string[];
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
      activeSkillIds,
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
          skillIds: activeSkillIds ?? skillIds,
          selectedSkillIds: skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response,
          blockedReasonCode: 'TOOL_DISABLED',
          model: normalizedModel,
        }),
      };
    }

    const step = await validateWithRetry(
      normalizedModel,
      this.wasGeneratedThisTurn(toolCalls),
      {
        locale,
        engineId: params.context?.engineId,
        autoAnalyze,
        plan,
        toolCalls,
        traceId,
        llm: this.llm,
        localize: this.localize.bind(this),
        loggerWarn: (meta, message) => logger.warn(meta, message),
        startToolCall: this.startToolCall.bind(this),
        completeToolCallSuccess: this.completeToolCallSuccess.bind(this),
        completeToolCallError: this.completeToolCallError.bind(this),
        shouldBypassValidateFailure: this.shouldBypassValidateFailure.bind(this),
        buildBlockedResult: async (response) => this.finalizeBlockedRunResult({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds: activeSkillIds ?? skillIds,
          selectedSkillIds: skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response,
          model: normalizedModel,
        }),
        buildGeneratedModelValidationClarification: async (validationError) => this.buildGeneratedModelValidationClarification({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds,
          activeSkillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          validationError,
        }),
        runValidate: (model) => this.skillRuntime.executeValidationSkill({
          model,
          engineId: params.context?.engineId,
          structureProtocolClient: this.structureProtocolClient,
        }),
      },
    );

    if (!step.ok) {
      return {
        ok: false,
        result: step.result,
      };
    }

    return {
      ok: true,
      value: {
        normalizedModel: step.model,
        validationWarning: step.warning,
      },
    };
  }

  private wasGeneratedThisTurn(toolCalls: AgentToolCall[]): boolean {
    return toolCalls.some((call) => call.tool === 'draft_model' || call.tool === 'update_model');
  }

  private async buildGeneratedModelValidationClarification(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    activeSkillIds?: string[];
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    validationError: string;
  }): Promise<AgentRunResult> {
    const {
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds,
      activeSkillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      validationError,
    } = args;
    const effectiveSkillIds = activeSkillIds ?? skillIds;
    const assessment = await this.assessInteractionNeeds(workingSession, locale, effectiveSkillIds);
    const interaction = await this.buildInteractionPayload(
      assessment,
      workingSession,
      assessment.criticalMissing.length > 0 ? 'confirming' : 'collecting',
      locale,
      effectiveSkillIds,
    );
    const missingFields = await this.mapMissingFieldLabels(
      assessment.criticalMissing,
      locale,
      workingSession.draft || { inferredType: 'unknown', updatedAt: workingSession.updatedAt },
      effectiveSkillIds,
    );
    const fieldsToConfirm = missingFields.length > 0
      ? missingFields
      : [
        this.localize(locale, '材料', 'material'),
        this.localize(locale, '截面', 'section'),
        this.localize(locale, '荷载', 'loads'),
        this.localize(locale, '边界条件', 'boundary conditions'),
      ];
    const question = this.localize(
      locale,
      `当前生成的结构模型还不满足 StructureModel 校验，先不要执行。请补充或确认：${fieldsToConfirm.join('、')}。如果你已经有完整合法模型，也可以直接贴 JSON。`,
      `The generated structural model does not yet satisfy StructureModel validation, so execution will stop here. Please provide or confirm: ${fieldsToConfirm.join(', ')}. If you already have a complete valid model, you can paste the JSON directly.`
    );

    return this.finalizeBlockedRunResult({
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds: effectiveSkillIds,
      selectedSkillIds: skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      response: question,
      needsModelInput: true,
      clarification: {
        missingFields: fieldsToConfirm,
        question,
      },
      interaction: {
        ...interaction,
        fallbackSupportNote: this.localize(
          locale,
          `当前生成的模型未通过 StructureModel 校验：${validationError}`,
          `The generated model did not pass StructureModel validation: ${validationError}`
        ),
      },
    });
  }

  private buildChatModeResponse(interaction: AgentInteraction, locale: AppLocale): string {
    return resultBuildChatModeResponse(interaction, locale);
  }

  private isGenericFallbackDraft(draft: DraftResult): boolean {
    return draft.inferredType === 'unknown' && !draft.structuralTypeMatch;
  }

  private buildGenericModelingIntro(locale: AppLocale, noSkillMode: boolean): string {
    return resultBuildGenericModelingIntro(locale, noSkillMode);
  }

  private resolveRouteDecision(nextPlan: AgentNextStepPlan, noSkillMode: boolean): RouteDecision {
    if (noSkillMode) {
      return { path: 'chat', mode: 'plain' };
    }
    if (nextPlan.kind === 'reply' && nextPlan.replyMode === 'plain') {
      return { path: 'chat', mode: 'plain' };
    }
    if (nextPlan.kind === 'ask') {
      return { path: 'collect', mode: 'structured' };
    }
    return { path: 'draft', mode: 'structured' };
  }

  private collectOnlyTextToModelDraft(message: string, existingState?: DraftState, locale: AppLocale = 'en', skillIds?: string[]): Promise<DraftResult> {
    if (this.hasEmptySkillSelection(skillIds)) {
      return Promise.resolve({
        inferredType: 'unknown' as const,
        missingFields: ['inferredType'],
        extractionMode: this.llm ? 'llm' as const : 'deterministic' as const,
        stateToPersist: existingState,
      });
    }
    return this.skillRuntime.extractDraftParameters(this.llm, message, existingState, locale, skillIds)
      .then((extraction) => ({
        inferredType: extraction.nextState.inferredType,
        missingFields: [...extraction.missing.critical],
        extractionMode: extraction.extractionMode,
        stateToPersist: extraction.nextState,
        structuralTypeMatch: extraction.structuralTypeMatch,
      }));
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
    const noSkillMode = this.hasEmptySkillSelection(params.context?.skillIds);
    const route = this.resolveRouteDecision(nextPlan, noSkillMode);

    if (route.path === 'chat') {
      const ctx = buildTurnContext(params, traceId, {
        locale, orchestrationMode,
        modelInput: params.context?.model || workingSession.latestModel,
        sourceFormat: params.context?.modelFormat || 'structuremodel-v1',
        autoAnalyze: params.context?.autoAnalyze ?? true,
        analysisParameters: params.context?.parameters || {},
        skillIds: params.context?.skillIds,
        activeSkillIds: undefined,
        noSkillMode, hadExistingSession: false,
        activeToolIds, sessionKey, workingSession, plan, toolCalls,
      });
      Object.defineProperty(ctx, 'startedAt', { value: startedAt });
      Object.defineProperty(ctx, 'startedAtMs', { value: startedAtMs });
      const deps = this.buildHandlerDeps();
      return handleChat(ctx, deps, {
        fallback: noSkillMode
          ? this.localize(locale, '当前未启用工程技能。我可以先按普通对话帮你梳理需求；如果需要建模、分析或校核，请先启用相应 skill。', 'Engineering skills are not enabled right now. I can still help in plain conversation; enable the relevant skills first when you want modeling, analysis, or code checks.')
          : this.localize(locale, '你好，我在。你可以直接告诉我你的结构问题、建模需求，或者只是继续聊天。', 'Hello, I am here. You can tell me your structural question, modeling goal, or just keep chatting.'),
        planNote: noSkillMode
          ? this.localize(locale, '当前未启用工程技能，按 base chat 路径直接回复', 'No engineering skills are enabled, so this turn stays on the base chat path')
          : this.localize(locale, '当前轮次由模型判定为直接回复，不触发工程建模或执行工具', 'The model decided to reply directly for this turn, without triggering engineering drafting or execution tools'),
      });
    }

    const useCollectOnly = route.path === 'collect';
    const { draft, genericFallbackDraft } = await this.draftConversationState({
      params,
      traceId,
      startedAt,
      startedAtMs,
      locale,
      orchestrationMode,
      skillIds: params.context?.skillIds,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      collectOnly: useCollectOnly,
    });

    if (genericFallbackDraft) {
      return this.buildGenericConversationResult({
        nextPlan,
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds: params.context?.skillIds,
        noSkillMode: false,
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
    const codeFromSkills = this.skillRuntime.resolveCodeCheckDesignCodeFromSkillIds(skillIds);
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
    hadExistingSession: boolean;
    selectedToolId: AgentToolName;
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
      hadExistingSession,
      selectedToolId,
    } = args;

    if (selectedToolId === 'update_model') {
      return this.updateExecutableModel({
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
        modelInput,
        hadExistingSession,
      });
    }

    const candidateModel = modelInput || workingSession.latestModel;
    if (candidateModel && selectedToolId !== 'draft_model') {
      return { ok: true, model: candidateModel };
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
          blockedReasonCode: 'TOOL_DISABLED',
          needsModelInput: true,
        }),
      };
    }

    const draftExecution = await executeDraftModelExecutionStep({
      message: params.message,
      locale,
      skillIds,
      sessionKey,
      plan,
      toolCalls,
      workingSession,
      startToolCall: this.startToolCall.bind(this),
      completeToolCallSuccess: this.completeToolCallSuccess.bind(this),
      textToModelDraft: (msg: string, state: DraftState | undefined, loc: AppLocale, ids?: string[]) =>
        this.textToModelDraft(msg, state, loc, ids, params.conversationId),
      isGenericFallbackDraft: this.isGenericFallbackDraft.bind(this),
      applyDraftToSession: this.applyDraftToSession.bind(this),
    });
    const draft = draftExecution.draft;
    const genericFallbackDraft = draftExecution.genericFallbackDraft;

    if (workingSession.userApprovedAutoDecide) {
      for (let i = 0; i < 3; i += 1) {
        const assessment = await this.assessInteractionNeeds(workingSession, locale, skillIds);
        if (assessment.nonCriticalMissing.length === 0) {
          break;
        }
        await this.applyNonCriticalDefaults(workingSession, assessment.defaultProposals, locale, skillIds);
      }
    }

    const availableModel = draft.model;
    const finalAssessment = availableModel
      ? { criticalMissing: [], nonCriticalMissing: [], defaultProposals: [] }
      : await this.assessInteractionNeeds(workingSession, locale, skillIds);
    if (finalAssessment.criticalMissing.length > 0 || !availableModel) {
      if (sessionKey) {
        await this.setInteractionSession(sessionKey, workingSession);
      }

      if (genericFallbackDraft) {
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
      const missingFields = await this.mapMissingFieldLabels(finalAssessment.criticalMissing, locale, workingSession.draft || { inferredType: 'unknown', updatedAt: workingSession.updatedAt }, skillIds);
      const fallback = this.buildInteractionQuestion(interaction, locale);
      const question = await this.renderInteractionResponse(
        params.message,
        interaction,
        fallback,
        locale,
        sessionKey,
        skillIds,
      );
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

  private async updateExecutableModel(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    orchestrationMode: AgentOrchestrationMode;
    skillIds?: string[];
    activeSkillIds?: string[];
    activeToolIds?: ActiveToolSet;
    plan: string[];
    toolCalls: AgentToolCall[];
    sessionKey?: string;
    workingSession: InteractionSession;
    modelInput?: Record<string, unknown>;
    hadExistingSession: boolean;
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
      activeSkillIds,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      modelInput,
      hadExistingSession,
    } = args;

    if (!this.hasActiveTool(activeToolIds, 'update_model')) {
      const response = this.buildDisabledToolMessage('update_model', locale);
      return {
        ok: false,
        result: await this.finalizeBlockedRunResult({
          params,
          traceId,
          startedAt,
          startedAtMs,
          locale,
          orchestrationMode,
          skillIds: activeSkillIds ?? skillIds,
          selectedSkillIds: skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response,
          blockedReasonCode: 'TOOL_DISABLED',
          model: modelInput,
          needsModelInput: true,
        }),
      };
    }

    if (!hadExistingSession && !modelInput && !workingSession.latestModel) {
      const response = this.localize(
        locale,
        '当前没有可修改的现有模型或会话上下文。请先建立结构模型，或直接提供完整模型后再修改。',
        'There is no existing model or engineering session to update. Build a structural model first, or provide a complete model before requesting updates.',
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
          skillIds: activeSkillIds ?? skillIds,
          selectedSkillIds: skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response,
          model: modelInput || workingSession.latestModel,
          needsModelInput: true,
        }),
      };
    }

    const updateExecution = await executeUpdateModelExecutionStep({
      message: params.message,
      locale,
      skillIds,
      sessionKey,
      plan,
      toolCalls,
      workingSession,
      startToolCall: this.startToolCall.bind(this),
      completeToolCallSuccess: this.completeToolCallSuccess.bind(this),
      textToModelDraft: (msg: string, state: DraftState | undefined, loc: AppLocale, ids?: string[]) =>
        this.textToModelDraft(msg, state, loc, ids, params.conversationId),
      isGenericFallbackDraft: this.isGenericFallbackDraft.bind(this),
      applyInferredNonCriticalFromMessage: this.applyInferredNonCriticalFromMessage.bind(this),
    });
    const draft = updateExecution.draft;

    const availableModel = draft.model;
    const finalAssessment = availableModel
      ? { criticalMissing: [], nonCriticalMissing: [], defaultProposals: [] }
      : await this.assessInteractionNeeds(workingSession, locale, skillIds);
    if (finalAssessment.criticalMissing.length > 0 || !availableModel) {
      if (sessionKey) {
        await this.setInteractionSession(sessionKey, workingSession);
      }

      const missingFields = await this.mapMissingFieldLabels(finalAssessment.criticalMissing, locale, workingSession.draft || { inferredType: 'unknown', updatedAt: workingSession.updatedAt }, skillIds);
      const response = finalAssessment.criticalMissing.length > 0
        ? this.localize(
          locale,
          `模型修改请求已识别，但还缺少这些关键参数：${missingFields.join('、')}。`,
          `The model update request was recognized, but these key parameters are still missing: ${missingFields.join(', ')}.`,
        )
        : this.localize(
          locale,
          '模型修改请求已识别，但当前更新结果还不足以形成可执行模型。请继续补充参数。',
          'The model update request was recognized, but the current update is still insufficient to form an executable model. Please continue providing details.',
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
          skillIds: activeSkillIds ?? skillIds,
          selectedSkillIds: skillIds,
          plan,
          toolCalls,
          sessionKey,
          workingSession,
          response,
          model: availableModel || modelInput || workingSession.latestModel,
          needsModelInput: true,
          clarification: missingFields.length > 0
            ? {
              missingFields,
              question: response,
            }
            : undefined,
        }),
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
      activeSkillIds,
      activeToolIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      normalizedModel,
      autoAnalyze,
    } = args;

    if (!autoAnalyze) {
      const response = await this.renderSummary(
        params.message,
        this.localize(locale, '模型已通过校验。根据当前配置，本轮未触发 `run_analysis`。', 'The model passed validation. `run_analysis` was not invoked for this turn under the current configuration.'),
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
        workingSession.latestModel = normalizedModel;
        workingSession.updatedAt = Date.now();
        await this.setInteractionSession(sessionKey, workingSession);
      }
      return this.finalizeRunResult(traceId, sessionKey, params.message, result, activeSkillIds ?? skillIds, workingSession, skillIds);
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
        skillIds: activeSkillIds ?? skillIds,
        selectedSkillIds: skillIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
        response,
        blockedReasonCode: 'TOOL_DISABLED',
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
      activeSkillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      normalizedModel,
      analysisParameters,
      executionConfig,
    } = args;

    const result = await executeRunAnalysisStep({
      traceId,
      locale,
      analysisType: executionConfig.analysisType,
      engineId: params.context?.engineId,
      model: normalizedModel,
      parameters: this.buildAnalysisParameters(analysisParameters, normalizedModel),
      plan,
      toolCalls,
      localize: this.localize.bind(this),
      startToolCall: this.startToolCall.bind(this),
      completeToolCallSuccess: this.completeToolCallSuccess.bind(this),
      completeToolCallError: this.completeToolCallError.bind(this),
      shouldRetryEngineCall: this.shouldRetryEngineCall.bind(this),
      runAnalysis: async (input) => {
        const analysisSkillId = this.skillRuntime.resolvePreferredAnalysisSkill({
          analysisType: executionConfig.analysisType,
          engineId: input.engineId,
          skillIds: activeSkillIds ?? skillIds,
          supportedModelFamilies: this.resolvePreferredAnalysisModelFamilies({
            workingSession,
            modelInput: normalizedModel,
          }),
        })?.id;
        const execution = await this.skillRuntime.executeAnalysisSkill({
          traceId,
          analysisType: executionConfig.analysisType,
          engineId: input.engineId,
          model: input.model,
          parameters: input.parameters,
          analysisSkillId,
          skillIds: activeSkillIds ?? skillIds,
          supportedModelFamilies: this.resolvePreferredAnalysisModelFamilies({
            workingSession,
            modelInput: normalizedModel,
          }),
          postToEngineWithRetry: this.postToEngineWithRetry.bind(this),
        });
        return execution.result;
      },
      buildBlockedResult: async (response) => this.finalizeBlockedRunResult({
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds: activeSkillIds ?? skillIds,
        selectedSkillIds: skillIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
        response,
        model: normalizedModel,
      }),
    });
    if (!result.ok) {
      return result;
    }
    return { ok: true, value: { data: result.data } };
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
      activeSkillIds,
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
    const designCode = executionConfig.designCode;

    return executeRunCodeCheckStep({
      locale,
      localize: this.localize.bind(this),
      plan,
      toolCalls,
      startToolCall: this.startToolCall.bind(this),
      completeToolCallSuccess: this.completeToolCallSuccess.bind(this),
      completeToolCallError: this.completeToolCallError.bind(this),
      traceId,
      designCode,
      model: normalizedModel,
      analysis: analyzed,
      analysisParameters,
      codeCheckElements: params.context?.codeCheckElements,
      engineId: params.context?.engineId,
      runCodeCheck: async () => this.skillRuntime.executeCodeCheckSkill({
        codeCheckClient: this.codeCheckClient,
        traceId,
        designCode,
        model: normalizedModel,
        analysis: analyzed,
        analysisParameters,
        codeCheckElements: params.context?.codeCheckElements,
        engineId: params.context?.engineId,
        codeCheckSkillId: this.skillRuntime.resolveCodeCheckSkillId(designCode),
      }),
      buildBlockedResult: async (response) => this.finalizeBlockedRunResult({
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds: activeSkillIds ?? skillIds,
        selectedSkillIds: skillIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
        response,
        model: normalizedModel,
      }),
    });
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
      activeSkillIds,
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

    return executeGenerateReportStep({
      message: params.message,
      locale,
      analysisType: executionConfig.analysisType,
      analysis: analyzed,
      codeCheck: codeCheckResult,
      format: executionConfig.reportFormat,
      reportOutput: executionConfig.reportOutput,
      draft: workingSession.draft,
      skillIds: activeSkillIds ?? skillIds,
      traceId,
      plan,
      toolCalls,
      localize: this.localize.bind(this),
      startToolCall: this.startToolCall.bind(this),
      completeToolCallSuccess: this.completeToolCallSuccess.bind(this),
      generateReport: async () => {
        const execution = await this.skillRuntime.executeReportSkill({
          message: params.message,
          analysisType: executionConfig.analysisType,
          analysis: analyzed,
          codeCheck: codeCheckResult,
          format: executionConfig.reportFormat,
          locale,
          draft: workingSession.draft,
          skillIds: activeSkillIds ?? skillIds,
        });
        return execution.report;
      },
      persistReportArtifacts: this.persistReportArtifacts.bind(this),
    });
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
      activeSkillIds,
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
      workingSession.latestModel = normalizedModel;
      workingSession.updatedAt = Date.now();
      await this.setInteractionSession(sessionKey, workingSession);
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
    }, activeSkillIds ?? skillIds, workingSession, skillIds);
  }

  private async draftConversationState(args: {
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
    collectOnly?: boolean;
  }): Promise<{
    draft: DraftResult;
    genericFallbackDraft: boolean;
  }> {
    const {
      params,
      locale,
      skillIds,
      plan,
      toolCalls,
      sessionKey,
      workingSession,
      collectOnly,
    } = args;

    const draftFn = collectOnly
      ? this.collectOnlyTextToModelDraft.bind(this)
      : (msg: string, state: DraftState | undefined, loc: AppLocale, ids?: string[]) =>
          this.textToModelDraft(msg, state, loc, ids, params.conversationId);

    return executeDraftModelInteractiveStep({
      message: params.message,
      locale,
      skillIds,
      sessionKey,
      plan,
      toolCalls,
      workingSession,
      startToolCall: this.startToolCall.bind(this),
      completeToolCallSuccess: this.completeToolCallSuccess.bind(this),
      textToModelDraft: draftFn,
      isGenericFallbackDraft: this.isGenericFallbackDraft.bind(this),
      applyDraftToSession: this.applyDraftToSession.bind(this),
    });
  }

  private applyDraftToSession(
    workingSession: InteractionSession,
    draft: DraftResult,
    genericFallbackDraft: boolean,
    message: string,
  ): void {
    if (draft.stateToPersist) {
      workingSession.draft = draft.stateToPersist;
    }
    if (draft.model) {
      workingSession.latestModel = draft.model;
    }
    if (draft.structuralTypeMatch) {
      workingSession.structuralTypeMatch = draft.structuralTypeMatch;
    } else if (genericFallbackDraft) {
      workingSession.structuralTypeMatch = undefined;
    }
    workingSession.updatedAt = Date.now();
    this.applyInferredNonCriticalFromMessage(workingSession, message);
  }

  private async renderDirectReply(
    message: string,
    fallback: string,
    locale: AppLocale,
    conversationId?: string,
    skillIds?: string[],
  ): Promise<string> {
    if (!this.llm) {
      return fallback;
    }

    try {
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
        this.localize(locale, '你是 StructureClaw 的对话 Agent。', 'You are the conversational agent for StructureClaw.'),
        this.localize(
          locale,
          '请直接回答用户本轮消息。只有在用户明确要求建模、分析、校核或继续执行时才应进入工程工具链；本轮不要假装已经建模或执行。',
          'Reply directly to the latest user message. Only move into modeling, analysis, code-check, or execution when the user clearly asks for it; do not pretend tools have been run in this turn.',
        ),
        this.localize(
          locale,
          '如果用户是在寒暄或闲聊，就自然简短回应；如果是非执行型工程问题，就直接回答问题，不要自动进入建模。',
          'If the user is greeting or making small talk, answer naturally and briefly. If this is a non-execution engineering question, answer it directly without automatically starting modeling.',
        ),
        this.localize(
          locale,
          `当前启用技能：${JSON.stringify(Array.isArray(skillIds) ? skillIds : [])}`,
          `Active skills: ${JSON.stringify(Array.isArray(skillIds) ? skillIds : [])}`,
        ),
      ];
      if (conversationContext) {
        promptParts.push(this.localize(locale, `对话上下文：\n${conversationContext}`, `Conversation context:\n${conversationContext}`));
      }
      promptParts.push(
        this.localize(locale, `用户消息：${message}`, `User message: ${message}`),
        this.localize(locale, `兜底回复：${fallback}`, `Fallback reply: ${fallback}`),
      );
      const aiMessage = await this.llm.invoke(promptParts.join('\n'));
      const content = typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
      return content || fallback;
    } catch {
      return fallback;
    }
  }

  private async renderInteractionResponse(
    message: string,
    interaction: AgentInteraction,
    fallback: string,
    locale: AppLocale,
    conversationId?: string,
    skillIds?: string[],
  ): Promise<string> {
    if (!this.llm) {
      return fallback;
    }

    try {
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
        this.localize(
          locale,
          '你是 StructureClaw 的工程对话 Agent。请根据当前交互状态，直接生成这一轮要发给用户的自然语言回复。',
          'You are the engineering conversation agent for StructureClaw. Generate the natural-language reply for this turn from the current interaction state.',
        ),
        this.localize(
          locale,
          '回复要求：1. 不要输出模板化标题、列表前缀或内部字段名；2. 不要提 allow_auto_decide、routeHint、interaction、skill id、tool id；3. 如果当前需要补参，只问最关键的下一步；4. 如果交互状态中存在 missingCritical、missingOptional，或 state 为 confirming/collecting，说明模型尚未建立成功，绝对不能说"模型已建立"或"参数已齐备"，应直接告诉用户还需要补充哪些参数；5. 只有当交互状态明确为 completed 且 missingCritical 与 missingOptional 都为空时，才可以说明模型已就绪可继续分析；6. 保持简洁，中文不超过120字，英文不超过90 words。',
          'Requirements: 1. Do not output templated headings, list prefixes, or internal field names. 2. Do not mention allow_auto_decide, routeHint, interaction, skill ids, or tool ids. 3. If clarification is needed, ask only the single most important next question. 4. If the interaction state contains missingCritical or missingOptional, or state is confirming/collecting, the model has NOT been built yet — never claim the model is ready or parameters are complete; instead tell the user which parameters are still needed. 5. Only when the interaction state is explicitly completed and both missingCritical and missingOptional are empty may you state the model is ready for analysis. 6. Keep it concise: under 120 Chinese characters or under 90 English words.',
        ),
        this.localize(
          locale,
          `当前启用技能：${JSON.stringify(Array.isArray(skillIds) ? skillIds : [])}`,
          `Active skills: ${JSON.stringify(Array.isArray(skillIds) ? skillIds : [])}`,
        ),
      ];
      if (conversationContext) {
        promptParts.push(this.localize(locale, `对话上下文：\n${conversationContext}`, `Conversation context:\n${conversationContext}`));
      }
      promptParts.push(
        this.localize(locale, `用户本轮消息：${message}`, `Latest user message: ${message}`),
        this.localize(locale, `交互状态：${JSON.stringify(interaction)}`, `Interaction state: ${JSON.stringify(interaction)}`),
        this.localize(locale, `兜底回复：${fallback}`, `Fallback reply: ${fallback}`),
      );

      const aiMessage = await this.llm.invoke(promptParts.join('\n'));
      const content = typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
      return content || fallback;
    } catch {
      return fallback;
    }
  }

  private async buildDirectReplyConversationResult(args: {
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
    fallback: string;
    planNote: string;
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
      fallback,
      planNote,
    } = args;

    plan.push(planNote);
    const response = await this.renderDirectReply(params.message, fallback, locale, sessionKey, skillIds);

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
      routeHint: this.hasActiveTool(activeToolIds, 'run_analysis') ? 'prefer_tool' : 'prefer_interactive',
      routeReason: this.hasActiveTool(activeToolIds, 'run_analysis')
        ? this.localize(
          locale,
          noSkillMode
            ? '未启用技能，但当前输入已可直接生成结构模型。'
            : '所选技能未命中更具体的结构技能，但当前输入已可直接生成结构模型。',
          noSkillMode
            ? 'No skills are enabled, but the current input is sufficient to build a structural model directly.'
            : 'The selected skills did not match a more specific structural skill, but the current input is sufficient to build a structural model directly.',
        )
        : this.localize(
          locale,
          '当前已能生成结构模型，但当前能力集中未启用 `run_analysis`。',
          'A structural model is ready, but the current capability set does not enable `run_analysis`.',
        ),
      interactionStageLabel: this.getStageLabel('model', locale),
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
          '可以继续补充更细的建模参数，或启用 `run_analysis` 后再执行。',
          'You can keep refining modeling parameters, or enable `run_analysis` before execution.',
        ),
    };

    const fallback = this.localize(
      locale,
      noSkillMode
        ? '已根据当前输入直接生成结构模型 JSON，可直接触发分析工具。'
        : '所选技能未命中更具体的结构技能，已回退到通用建模并生成结构模型 JSON，可直接触发分析工具。',
      noSkillMode
        ? 'A structural model JSON has been generated directly from your input and is ready for analysis tools.'
        : 'The selected skills did not match a more specific structural skill, so I fell back to generic modeling and generated a structural model JSON ready for analysis tools.',
    );
    const response = await this.renderInteractionResponse(
      params.message,
      interaction,
      fallback,
      locale,
      sessionKey,
      skillIds,
    );

    if (draft.model) {
      workingSession.latestModel = draft.model;
      workingSession.updatedAt = Date.now();
    }
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

    const synchronizedModel = draft.model ?? workingSession.latestModel ?? undefined;
    if (synchronizedModel) {
      workingSession.latestModel = synchronizedModel;
      workingSession.updatedAt = Date.now();
    }

    const missingFields = draft.missingFields.length > 0
      ? draft.missingFields
      : [this.localize(locale, '关键结构参数', 'key structural parameters')];
    const intro = this.buildGenericModelingIntro(locale, noSkillMode);
    const fallback = this.localize(
      locale,
      `${intro.replace(/。$/, '')}，请先补充：${missingFields.join('、')}。`,
      `${intro.replace(/\.$/, '')}. Please provide: ${missingFields.join(', ')}.`,
    );
    const interaction: AgentInteraction = {
      state: 'confirming',
      stage: 'model',
      turnId: randomUUID(),
      routeHint: 'prefer_interactive',
      routeReason: this.localize(
        locale,
        '当前仍缺少关键建模参数，请先补充后再触发工具。',
        'Critical modeling parameters are still missing. Please provide them before invoking tools.',
      ),
      interactionStageLabel: this.getStageLabel('model', locale),
      missingCritical: missingFields,
      missingOptional: [],
      questions: [{
        paramKey: 'genericModeling',
        label: this.localize(locale, '关键参数', 'Key parameters'),
        question: fallback,
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
    const response = await this.renderInteractionResponse(
      params.message,
      interaction,
      fallback,
      locale,
      sessionKey,
      skillIds,
    );

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
      model: synchronizedModel,
      interaction,
      clarification: {
        missingFields,
        question: response,
      },
      response,
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
      await this.applyNonCriticalDefaults(workingSession, assessment.defaultProposals, locale, skillIds);
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

    const synchronizedModel = await this.resolveConversationModel({
      draft,
      workingSession,
      skillIds,
      allowBuildFromDraft: true,
    });
    const fallback = this.buildChatModeResponse(resolved.interaction, this.resolveInteractionLocale(params.context?.locale));
    const response = await this.renderInteractionResponse(
      params.message,
      resolved.interaction,
      fallback,
      this.resolveInteractionLocale(params.context?.locale),
      sessionKey,
      skillIds,
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
      model: synchronizedModel,
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

    const synchronizedModel = await this.resolveConversationModel({
      draft,
      workingSession,
      skillIds,
      allowBuildFromDraft: resolved.assessment.criticalMissing.length === 0,
    });
    const fallback = this.buildChatModeResponse(resolved.interaction, locale);
    const response = await this.renderInteractionResponse(
      params.message,
      resolved.interaction,
      fallback,
      locale,
      sessionKey,
      skillIds,
    );
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
      model: synchronizedModel,
      interaction: resolved.interaction,
      clarification: resolved.interaction.questions?.length
        ? {
          missingFields: resolved.interaction.missingCritical || [],
          question: response,
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
      session.draft || { inferredType: 'unknown', updatedAt: session.updatedAt },
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
      session.draft || { inferredType: 'unknown', updatedAt: session.updatedAt },
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

  private async resolveConversationModel(args: {
    draft: DraftResult;
    workingSession: InteractionSession;
    skillIds?: string[];
    allowBuildFromDraft: boolean;
  }): Promise<Record<string, unknown> | undefined> {
    const { draft, workingSession, skillIds, allowBuildFromDraft } = args;

    let synchronizedModel = draft.model ?? workingSession.latestModel ?? undefined;
    if (!synchronizedModel && allowBuildFromDraft && workingSession.draft) {
      try {
        synchronizedModel = await this.skillRuntime.buildModel(workingSession.draft, skillIds);
      } catch {
        synchronizedModel = undefined;
      }
    }

    if (synchronizedModel) {
      workingSession.latestModel = synchronizedModel;
      workingSession.updatedAt = Date.now();
    }
    return synchronizedModel;
  }

  private async applyNonCriticalDefaults(session: InteractionSession, defaults: InteractionDefaultProposal[], locale?: AppLocale, skillIds?: string[]): Promise<void> {
    session.resolved = session.resolved || {};
    // Separate structural defaults from non-structural ones.
    // Structural defaults (frameMaterial, frameColumnSection, etc.) need to go
    // through applyProvidedValuesToSession to reach the skill handler.
    const structuralDefaults: Record<string, unknown> = {};
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
          // Collect structural defaults for batch application via skill handler
          structuralDefaults[proposal.paramKey] = proposal.value;
          break;
      }
    }
    // Apply structural defaults through the skill runtime if any were collected
    if (Object.keys(structuralDefaults).length > 0) {
      if (!locale) {
        throw new Error('Locale is required to apply structural defaults.');
      }
      await this.applyProvidedValuesToSession(session, structuralDefaults, locale, skillIds);
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
    } else if (this.skillRuntime.resolveCodeCheckDesignCodeFromSkillIds(context.skillIds)) {
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
    if (this.hasEmptySkillSelection(skillIds)) {
      session.draft = undefined;
      session.structuralTypeMatch = undefined;
      session.latestModel = undefined;
    } else {
      session.draft = await this.skillRuntime.applyProvidedValues(session.draft, values, locale, skillIds);
      if (session.draft.structuralTypeKey) {
        session.structuralTypeMatch = {
          key: session.draft.structuralTypeKey,
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
    // Preserve the explicitly provided designCode for direct run_code_check configuration.
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
    const draft = session.draft || { inferredType: 'unknown', updatedAt: session.updatedAt };
    const questions = await this.buildInteractionQuestions(missingKeys, assessment.criticalMissing, session, locale, skillIds);
    const stage = await this.resolveInteractionStage(missingKeys, draft, skillIds);
    const missingCritical = await this.mapMissingFieldLabels(assessment.criticalMissing, locale, draft, skillIds);
    const missingOptional = await this.mapMissingFieldLabels(assessment.nonCriticalMissing, locale, draft, skillIds);
    const route = this.buildInteractionRouteHint(assessment, stage, session, locale, activeToolIds);
    return {
      state,
      stage,
      turnId: randomUUID(),
      routeHint: route.routeHint,
      routeReason: route.routeReason,
      interactionStageLabel: this.getStageLabel(stage, locale),
      missingCritical,
      missingOptional,
      fallbackSupportNote: session.structuralTypeMatch?.supportNote,
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
        routeHint: 'prefer_interactive',
        routeReason: this.localize(
          locale,
          '当前仍缺少关键建模参数，建议继续对话补参后再触发工具。',
          'Critical modeling inputs are still missing; continue clarification before invoking tools.',
        ),
      };
    }
    return {
      routeHint: 'prefer_interactive',
      routeReason: this.localize(
        locale,
        '仍有关键参数待确认，建议先完成参数补充。',
        'Key parameters are still pending; complete clarification first.',
      ),
    };
  }

  if (assessment.nonCriticalMissing.length > 0 && !session.userApprovedAutoDecide) {
    return {
      routeHint: 'prefer_interactive',
      routeReason: this.localize(
        locale,
        '`run_analysis`、`run_code_check` 或 `generate_report` 的偏好尚未确认，建议先确认策略再触发工具。',
        'Preferences for `run_analysis`, `run_code_check`, or `generate_report` are still pending; confirm strategy before invoking tools.',
      ),
    };
  }

  if (!this.hasActiveTool(activeToolIds, 'run_analysis')) {
    return {
      routeHint: 'prefer_interactive',
      routeReason: this.localize(
        locale,
        '当前能力集中未启用 `run_analysis`，建议先继续对话或调整能力集。',
        'The current capability set does not enable `run_analysis`, so continue in conversation or adjust the capability set first.',
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
      (await this.skillRuntime.buildInteractionQuestions(missingKeys, criticalMissing, session.draft || { inferredType: 'unknown', updatedAt: session.updatedAt }, locale, skillIds))
        .map((question) => [question.paramKey, question])
    );
    return missingKeys.map((paramKey) => {
      const critical = criticalMissing.includes(paramKey);
      const structuralQuestion = structuralQuestions.get(paramKey);
      if (structuralQuestion) {
        return structuralQuestion;
      }
      const label = this.policy.mapNonStructuralMissingFieldLabel(paramKey, locale) || paramKey;
      return { paramKey, label, question: '', required: true, critical };
    });
  }

  private async resolveInteractionStage(missingKeys: string[], draft: DraftState, skillIds?: string[]): Promise<AgentInteractionStage> {
    const structuralStage = await this.skillRuntime.resolveInteractionStage(missingKeys, draft, skillIds);
    return this.policy.resolveInteractionStageFromMissing(structuralStage, missingKeys);
  }

  private buildInteractionQuestion(interaction: AgentInteraction, locale: AppLocale): string {
    return resultBuildInteractionQuestion(interaction, locale);
  }

  private buildToolInteraction(state: 'completed' | 'blocked', locale: AppLocale): AgentInteraction {
    return resultBuildToolInteraction(state, locale);
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
    return resultRenderSummary(this.llm, message, fallback, locale, analysisData, conversationId);
  }

  private async textToModelDraft(message: string, existingState?: DraftState, locale: AppLocale = 'en', skillIds?: string[], conversationId?: string): Promise<DraftResult> {
    if (this.hasEmptySkillSelection(skillIds)) {
      return {
        inferredType: 'unknown',
        missingFields: ['inferredType'],
        extractionMode: this.llm ? 'llm' : 'deterministic',
        stateToPersist: {
          inferredType: 'unknown',
          updatedAt: Date.now(),
        },
      };
    }

    const conversationHistory = await this.loadConversationHistory(conversationId);

    const skillDraft = await this.skillRuntime.textToModelDraft(this.llm, message, existingState, locale, skillIds, conversationHistory);
    if (skillDraft.model || skillDraft.inferredType !== 'unknown' || skillDraft.structuralTypeMatch?.skillId) {
      return skillDraft;
    }

    const selectedSkillMode = Array.isArray(skillIds) && skillIds.length > 0;
    if (!selectedSkillMode) {
      return skillDraft;
    }

    const genericDraft = await this.skillRuntime.textToModelDraft(this.llm, message, existingState, locale, ['generic'], conversationHistory);
    return genericDraft;
  }

  private async loadConversationHistory(conversationId?: string): Promise<string | undefined> {
    if (!conversationId) {
      return undefined;
    }
    try {
      const recentMessages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { role: true, content: true },
      });
      if (recentMessages.length === 0) {
        return undefined;
      }
      return recentMessages
        .reverse()
        .map((m: { role: string; content: string }) => `${m.role}: ${m.content.slice(0, 400)}`)
        .join('\n');
    } catch {
      return undefined;
    }
  }

  private hasEmptySkillSelection(skillIds?: string[]): boolean {
    return Array.isArray(skillIds) && skillIds.length === 0;
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
    return resultBuildMetrics(toolCalls);
  }

  private async finalizeRunResult(
    traceId: string,
    conversationId: string | undefined,
    userMessage: string,
    result: AgentRunResult,
    skillIds?: string[],
    session?: InteractionSession,
    selectedSkillIds?: string[],
  ): Promise<AgentRunResult> {
    result.conversationId = conversationId;
    result.routing = this.buildResolvedRouting(result, selectedSkillIds, session, skillIds);
    await this.annotateToolCalls(result.toolCalls, skillIds, result.routing);
    await this.persistConversationMessages(conversationId, userMessage, result, selectedSkillIds, skillIds);
    this.logRunResult(traceId, conversationId, result);
    return result;
  }

  private async annotateToolCalls(
    toolCalls: AgentToolCall[],
    skillIds?: string[],
    routing?: AgentResolvedRouting,
  ): Promise<void> {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return;
    }

    const builtinById = new Map(listBuiltinToolManifests().map((tool) => [tool.id, tool] as const));
    const tooling = await this.resolveAvailableTooling(routing?.selectedSkillIds, skillIds);
    const activatedSkillIds = new Set(routing?.activatedSkillIds || []);
    const preferredAuthorizers = [
      routing?.structuralSkillId,
      routing?.analysisSkillId,
      routing?.codeCheckSkillId,
      routing?.validationSkillId,
      routing?.reportSkillId,
    ].filter((skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0);

    for (const call of toolCalls) {
      const manifest = builtinById.get(call.tool) || tooling.tools.find((tool) => tool.id === call.tool);
      if (manifest) {
        call.source = manifest.source;
      }

      if (manifest?.source === 'external') {
        const owners = [...(tooling.skillIdsByToolId[call.tool] || [])];
        const authorizedBySkillIds = preferredAuthorizers
          .filter((skillId) => owners.includes(skillId))
          .concat(owners.filter((skillId) => activatedSkillIds.has(skillId) && !preferredAuthorizers.includes(skillId)));
        if (authorizedBySkillIds.length > 0) {
          call.authorizedBySkillIds = Array.from(new Set(authorizedBySkillIds));
        }
      }

      if (!call.blockedReasonCode && call.status === 'error' && typeof call.errorCode === 'string' && call.errorCode.length > 0) {
        call.blockedReasonCode = call.errorCode;
      }
    }
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
    activeSkillIds?: string[],
  ): AgentResolvedRouting | undefined {
    const selectedSkillIds = this.normalizeSkillIds(skillIds);
    const activatedSkillIds = this.normalizeSkillIds(activeSkillIds);
    const activeSkillSet = new Set(activatedSkillIds);
    const activeAnalysisSkillIds = activatedSkillIds.filter((skillId) => this.skillRuntime.isAnalysisSkillId(skillId));
    const activeCodeCheckSkillIds = activatedSkillIds.filter((skillId) => this.skillRuntime.isCodeCheckSkillId(skillId));

    const routing: AgentResolvedRouting = {
      selectedSkillIds,
    };
    if (activatedSkillIds.length > 0) {
      routing.activatedSkillIds = activatedSkillIds;
    }

    const structuralSkillId = session?.structuralTypeMatch?.skillId || session?.draft?.skillId;
    if (structuralSkillId) {
      routing.structuralSkillId = structuralSkillId;
    }

    const analysisRecord = result.analysis && typeof result.analysis === 'object'
      ? result.analysis as Record<string, unknown>
      : undefined;
    const analysisMeta = analysisRecord?.meta && typeof analysisRecord.meta === 'object'
      ? analysisRecord.meta as Record<string, unknown>
      : undefined;
    const codeCheckRecord = result.codeCheck && typeof result.codeCheck === 'object'
      ? result.codeCheck as Record<string, unknown>
      : undefined;
    const codeCheckMeta = codeCheckRecord?.meta && typeof codeCheckRecord.meta === 'object'
      ? codeCheckRecord.meta as Record<string, unknown>
      : undefined;

    if (typeof analysisMeta?.analysisSkillId === 'string' && analysisMeta.analysisSkillId.trim().length > 0) {
      routing.analysisSkillId = analysisMeta.analysisSkillId;
    }
    if (Array.isArray(analysisMeta?.analysisSkillIds)) {
      routing.analysisSkillIds = analysisMeta.analysisSkillIds
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
    if (!routing.analysisSkillId && activeAnalysisSkillIds.length > 0) {
      routing.analysisSkillId = activeAnalysisSkillIds[0];
    }
    if ((!routing.analysisSkillIds || routing.analysisSkillIds.length === 0) && activeAnalysisSkillIds.length > 0) {
      routing.analysisSkillIds = activeAnalysisSkillIds;
    }
    if (typeof codeCheckMeta?.codeCheckSkillId === 'string' && codeCheckMeta.codeCheckSkillId.trim().length > 0) {
      routing.codeCheckSkillId = codeCheckMeta.codeCheckSkillId;
    }
    if (activeCodeCheckSkillIds.length > 0) {
      routing.codeCheckSkillId = routing.codeCheckSkillId || activeCodeCheckSkillIds[0];
    }
    if (activeSkillSet.has('validation-structure-model')) {
      routing.validationSkillId = 'validation-structure-model';
    }
    if (activeSkillSet.has('report-export-builtin')) {
      routing.reportSkillId = 'report-export-builtin';
    }

    if (
      routing.selectedSkillIds.length === 0
      && (!routing.activatedSkillIds || routing.activatedSkillIds.length === 0)
      && !routing.structuralSkillId
      && !routing.analysisSkillId
      && !routing.codeCheckSkillId
      && !routing.validationSkillId
      && !routing.reportSkillId
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
    activatedSkillIds?: string[],
  ): PersistedMessageDebugDetails {
    const safeSkillIds = this.normalizeSkillIds(skillIds);
    const safeActivatedSkillIds = this.normalizeSkillIds(activatedSkillIds);
    const promptSnapshot = JSON.stringify({
      message: userMessage,
      context: {
        traceId: result.traceId,
        skillIds: safeSkillIds,
        activatedSkillIds: safeActivatedSkillIds,
      },
    }, null, 2);

    return {
      promptSnapshot,
      skillIds: safeSkillIds,
      activatedSkillIds: safeActivatedSkillIds,
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
    activatedSkillIds?: string[],
  ): Promise<void> {
    const assistantMessage = result.response;
    if (!conversationId || !userMessage.trim() || !assistantMessage?.trim()) {
      return;
    }

    const debugDetails = this.buildPersistedDebugDetails(userMessage, result, skillIds, activatedSkillIds);

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
    return buildSessionKey(conversationId);
  }

  private async getInteractionSession(conversationId: string | undefined): Promise<InteractionSession | undefined> {
    return getInteractionSessionFromStore(conversationId);
  }

  private async setInteractionSession(conversationId: string, session: InteractionSession): Promise<void> {
    return setInteractionSessionToStore(conversationId, session);
  }

  private async clearInteractionSession(conversationId: string): Promise<void> {
    return clearInteractionSessionFromStore(conversationId);
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
