import { ChatOpenAI } from '@langchain/openai';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { createChatModel } from '../utils/llm.js';
import { prisma } from '../utils/database.js';
import { logger } from '../utils/logger.js';
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
import { AgentRuntimeBinder } from './agent-runtime-binder.js';
import { executeDraftModelInteractiveStep } from '../agent-tools/builtin/draft-model.js';
import { buildTurnContext, type HandlerDeps, type RouteDecision } from './agent-context.js';
import { STRUCTURAL_COORDINATE_SEMANTICS } from '../agent-runtime/coordinate-semantics.js';
import { handleChat } from './agent-handlers/index.js';
import {
  getInteractionSession as getInteractionSessionFromStore,
  setInteractionSession as setInteractionSessionToStore,
  clearInteractionSession as clearInteractionSessionFromStore,
  buildInteractionSessionKey as buildSessionKey,
} from './agent-session.js';
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
import { AgentSkillCatalogService } from './agent-skill-catalog.js';
import { AgentRunStoreService } from './agent-run-store.js';
import { ProjectService } from './project.js';
import { PipelineScheduler } from '../agent-runtime/pipeline-scheduler.js';
import {
  mergeExecutionPolicy,
  createEmptyProjectPipelineState,
  buildInteractionCheckpoint,
} from './agent-pipeline-state.js';
import { computeDependencyFingerprint, computeDraftStateContentHash } from '../agent-runtime/artifact-helpers.js';
import type { ArtifactEnvelope, ArtifactKind, SchedulerStep, ProjectPipelineState } from '../agent-runtime/types.js';
import {
  createEmptyAssistantPresentation,
  buildPhaseId,
  phaseTitle,
  toolTitle,
  skillIdForToolCall,
  type PresentationPhase,
  type AssistantPresentation,
  type ArtifactState,
  type TimelineStepItem,
  type TimelinePhaseGroup,
} from './chat-presentation.js';

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
  checkpoint?: import('../agent-runtime/types.js').InteractionCheckpoint;
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

export type ActiveToolSet = Set<string> | undefined;

export type AgentPlanKind = 'reply' | 'ask' | 'execute';
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
  targetArtifact?: string;
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
  signal?: AbortSignal;
  context?: {
    locale?: AppLocale;
    projectId?: string;
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
    resumeFromMessage?: string;
    requestOverrides?: import('../agent-runtime/types.js').RequestExecutionOverrides;
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

export type PublicPresentationChunk =
  | { type: 'presentation_init'; presentation: AssistantPresentation }
  | { type: 'phase_upsert'; phase: TimelinePhaseGroup }
  | { type: 'step_upsert'; phaseId: string; step: TimelineStepItem }
  | { type: 'artifact_upsert'; artifact: ArtifactState }
  | {
      type: 'artifact_payload_sync';
      artifact: 'model' | 'analysis' | 'report';
      model?: Record<string, unknown>;
      latestResult?: Record<string, unknown>;
      snapshot?: Record<string, unknown>;
    }
  | { type: 'summary_replace'; summaryText: string }
  | { type: 'presentation_complete'; completedAt: string }
  | { type: 'presentation_error'; phase: PresentationPhase; message: string; createdAt?: string };

export type AgentStreamChunk =
  | { type: 'start'; content?: unknown }
  | { type: 'interaction_update'; content?: unknown }
  | { type: 'result'; content?: unknown }
  | { type: 'done' }
  | { type: 'error'; error?: string }
  | PublicPresentationChunk;

export type StepEventCallback = (chunk: AgentStreamChunk) => void;

// --- Phase 4: Scheduler integration helpers ---

const STUB_TOOLS = new Set<string>(['synthesize_design', 'generate_drawing']);

function buildLocalizedBlockedReason(reason: string, locale: AppLocale): string {
  const messages: Record<string, { zh: string; en: string }> = {
    'analysisProvider binding required': {
      zh: '需要绑定分析提供者才能执行分析。请在项目设置中选择一个分析技能。',
      en: 'Analysis provider binding is required to execute analysis. Please select an analysis skill in project settings.',
    },
    'codeCheckProvider binding required': {
      zh: '需要绑定校核提供者才能执行规范校核。请在项目设置中选择一个校核技能。',
      en: 'Code-check provider binding is required to execute code check. Please select a code-check skill in project settings.',
    },
    'designBasis incomplete': {
      zh: '设计依据不完整，缺少关键前提（单位体系、设计规范或荷载工况）。请补充设计依据后重试。',
      en: 'Design basis is incomplete: missing unit system, design code, or load cases. Please complete the design basis and try again.',
    },
    'provider incompatible': {
      zh: '已绑定的提供者与当前模型族、分析类型或设计代码不兼容。请更换提供者或调整项目配置。',
      en: 'Bound provider is incompatible with the current model family, analysis type, or design code. Please switch the provider or adjust project configuration.',
    },
    'upstream artifact missing': {
      zh: '缺少必要的上游结果，且无法自动补齐。请先完成上游步骤。',
      en: 'Required upstream artifact is missing and cannot be auto-resolved. Please complete upstream steps first.',
    },
    'autoDesignIteration not authorized': {
      zh: '项目策略未授权自动设计迭代。请在项目设置中启用自动设计迭代，或手动确认设计提案。',
      en: 'Auto-design iteration is not authorized by project policy. Please enable it in project settings, or manually accept design proposals.',
    },
    'unresolved checkpoint': {
      zh: '存在未解决的交互检查点（待确认的设计提案或关键澄清问题）。请先处理待确认事项。',
      en: 'Unresolved interaction checkpoint exists (pending design proposal or critical clarification). Please resolve pending items first.',
    },
    'previous run in progress': {
      zh: '上一条权威执行记录仍在运行或已失败且未处理。请等待完成或处理失败后重试。',
      en: 'Previous authoritative run is still in progress or has failed without resolution. Please wait for completion or resolve the failure.',
    },
    'tool not implemented': {
      zh: '请求的工具尚未实现。此功能将在后续版本中提供。',
      en: 'Requested tool is not yet implemented. This feature will be available in a future release.',
    },
    'skill not in selected skill set': {
      zh: '请求的技能未在当前启用的技能集中。请在项目设置中启用该技能。',
      en: 'Requested skill is not in the currently enabled skill set. Please enable the skill in project settings.',
    },
    'approval required': {
      zh: '项目策略要求在执行此操作前获得确认。请确认是否继续执行。',
      en: 'Project policy requires approval before executing this operation. Please confirm to proceed.',
    },
    'validation failed': {
      zh: '模型校验失败',
      en: 'Model validation failed',
    },
  };
  const localized = messages[reason];
  return localized ? localized[locale] ?? localized.en : reason;
}

function computeStepInputFingerprint(
  step: SchedulerStep,
  pipelineState: ProjectPipelineState,
): string {
  const refs: Record<string, { artifactId: string; revision: number }> = {};
  for (const ref of step.consumes) {
    refs[ref.kind] = { artifactId: ref.artifactId, revision: ref.revision };
  }
  return computeDependencyFingerprint(refs, pipelineState.bindings);
}

function mapToolToPresentationPhase(tool: string): 'modeling' | 'validation' | 'analysis' | 'report' {
  if (tool === 'validate_model') return 'validation';
  if (tool === 'run_analysis' || tool === 'postprocess_result' || tool === 'run_code_check') return 'analysis';
  if (tool === 'generate_report') return 'report';
  return 'modeling';
}

function mapArtifactEnvelopeToPresentationArtifact(
  artifact: Pick<ArtifactEnvelope, 'kind'> | undefined,
): ArtifactState['artifact'] | undefined {
  if (!artifact?.kind) {
    return undefined;
  }
  if (artifact.kind === 'normalizedModel') {
    return 'model';
  }
  if (artifact.kind === 'analysisRaw' || artifact.kind === 'postprocessedResult' || artifact.kind === 'codeCheckResult') {
    return 'analysis';
  }
  if (artifact.kind === 'reportArtifact') {
    return 'report';
  }
  return undefined;
}

function buildArtifactUpsertState(
  artifact: ArtifactState['artifact'],
  locale: AppLocale,
): ArtifactState {
  if (artifact === 'model') {
    return {
      artifact,
      status: 'available',
      title: locale === 'zh' ? '结构模型' : 'Structural model',
      summary: locale === 'zh' ? '模型已生成，可立即预览' : 'The model is ready for preview',
      previewable: true,
      snapshotKey: 'modelSnapshot',
    };
  }
  if (artifact === 'analysis') {
    return {
      artifact,
      status: 'available',
      title: locale === 'zh' ? '分析结果' : 'Analysis results',
      summary: locale === 'zh' ? '分析结果已可查看' : 'Analysis results are available',
      previewable: true,
      snapshotKey: 'resultSnapshot',
    };
  }
  return {
    artifact,
    status: 'available',
    title: locale === 'zh' ? '报告' : 'Report',
    summary: locale === 'zh' ? '报告内容已生成' : 'Report content is available',
    previewable: true,
  };
}

function buildArtifactPayloadChunk(
  artifact: ArtifactState['artifact'],
  payload: Record<string, unknown>,
  latestModel?: Record<string, unknown>,
): Extract<PublicPresentationChunk, { type: 'artifact_payload_sync' }> {
  if (artifact === 'model') {
    return { type: 'artifact_payload_sync', artifact, model: payload };
  }
  if (artifact === 'analysis') {
    return {
      type: 'artifact_payload_sync',
      artifact,
      latestResult: latestModel ? { analysis: payload, model: latestModel } : { analysis: payload },
    };
  }
  return {
    type: 'artifact_payload_sync',
    artifact,
    latestResult: latestModel ? { report: payload, model: latestModel } : { report: payload },
  };
}

function normalizePresentationPayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  return payload as Record<string, unknown>;
}

function buildInteractionTimelineTitle(interaction: AgentInteraction, locale: AppLocale): string {
  if (interaction.state === 'collecting') {
    return locale === 'zh' ? '补充建模信息' : 'Need more modeling details';
  }
  if (interaction.state === 'confirming') {
    return locale === 'zh' ? '等待设计确认' : 'Waiting on design confirmation';
  }
  if (interaction.state === 'blocked') {
    return locale === 'zh' ? '交互已阻止' : 'Interaction blocked';
  }
  return locale === 'zh' ? '交互更新' : 'Interaction update';
}

function applySchedulerStepResult(args: {
  pipelineState: ProjectPipelineState;
  step: SchedulerStep;
  stepResult: { artifact?: import('../agent-runtime/types.js').ArtifactEnvelope; runRecord?: import('../agent-runtime/types.js').RunRecord; patches?: import('../agent-runtime/types.js').ModelPatchRecord[] };
}): ProjectPipelineState {
  const kind = args.step.provides;
  const existingPatches = args.pipelineState.patches ?? [];
  const newPatches = args.stepResult.patches ?? [];

  if (!args.stepResult.artifact || !kind) {
    if (newPatches.length > 0) {
      return {
        ...args.pipelineState,
        patches: [...existingPatches, ...newPatches],
        updatedAt: Date.now(),
      };
    }
    return args.pipelineState;
  }

  return {
    ...args.pipelineState,
    artifacts: {
      ...args.pipelineState.artifacts,
      [kind]: args.stepResult.artifact,
    },
    patches: [...existingPatches, ...newPatches],
    updatedAt: Date.now(),
  };
}

function buildDraftStateArtifact(draft: DraftState): import('../agent-runtime/types.js').ArtifactEnvelope {
  return {
    artifactId: `draft:${draft.inferredType ?? 'unknown'}`,
    kind: 'draftState',
    scope: 'session',
    status: 'ready',
    revision: 1,
    producerSkillId: 'draft_model',
    dependencyFingerprint: '',
    basedOn: [],
    schemaVersion: '1.0.0',
    provenance: { toolId: 'draft_model' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payload: draft,
  };
}

/** Returns true when a model object has non-empty materials and sections arrays. */
function hasCompleteMaterialsAndSections(m: Record<string, unknown> | undefined): boolean {
  return Boolean(m && Array.isArray(m.materials) && (m.materials as unknown[]).length > 0
    && Array.isArray(m.sections) && (m.sections as unknown[]).length > 0);
}

export class AgentService {
  public engineClient: LocalAnalysisEngineClient;
  public structureProtocolClient = createLocalStructureProtocolClient();
  public codeCheckClient = createLocalCodeCheckClient();
  public llm: ChatOpenAI | null;
  private readonly skillRuntime: AgentSkillRuntime;
  private readonly skillCatalog: AgentSkillCatalogService;
  private readonly policy: AgentPolicyService;
  private readonly runtimeBinder: AgentRuntimeBinder;
  private readonly runStore: AgentRunStoreService;
  private readonly projectService: ProjectService;
  private readonly pipelineScheduler: PipelineScheduler;
  private static readonly draftStateTtlSeconds = 30 * 60;

  constructor() {
    this.engineClient = createLocalAnalysisEngineClient();

    this.llm = createChatModel(0.1);
    this.skillRuntime = new AgentSkillRuntime();
    this.skillCatalog = new AgentSkillCatalogService();
    this.policy = new AgentPolicyService();
    this.runtimeBinder = new AgentRuntimeBinder(this.skillRuntime, this.policy);
    this.runStore = new AgentRunStoreService();
    this.projectService = new ProjectService();
    this.pipelineScheduler = new PipelineScheduler();
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
    const activeToolIds = await this.runtimeBinder.resolveActiveToolIds(options?.skillIds, options?.skillIds, {
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
  ): Pick<AgentNextStepPlan, 'kind' | 'replyMode' | 'targetArtifact'> | null {
    return routerParsePlannerResponse(raw, allowedKinds);
  }

  private async repairPlannerResponse(raw: string, options: {
    locale: AppLocale;
    allowedKinds: AgentPlanKind[];
    availableToolIds: AgentToolName[];
  }): Promise<Pick<AgentNextStepPlan, 'kind' | 'replyMode' | 'targetArtifact'> | null> {
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
    signal?: AbortSignal;
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
    signal?: AbortSignal;
  }): Promise<AgentNextStepPlan> {
    return routerPlanNextStep(this.llm, message, options, this.assessInteractionNeeds.bind(this), this.hasEmptySkillSelection.bind(this));
  }

  private async resolveInteractivePlanKind(options: {
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
  }): Promise<AgentNextStepPlan> {
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
    const contextModel = params.context?.model;
    const modelInput = (hasCompleteMaterialsAndSections(contextModel) ? contextModel : undefined) || session?.latestModel || contextModel;
    const activeSkillIds = await this.runtimeBinder.resolveActiveDomainSkillIds({
      selectedSkillIds: skillIds,
      workingSession,
      modelInput,
      message: params.message,
      context: params.context,
      hasEmptySkillSelection: this.hasEmptySkillSelection.bind(this),
    });
    const activeToolIds = await this.runtimeBinder.resolveActiveToolIds(skillIds, activeSkillIds, {
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

  private hasActiveTool(activeToolIds: ActiveToolSet, toolId: string): boolean {
    return this.runtimeBinder.hasActiveTool(activeToolIds, toolId);
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

    const draftInferredType = typeof session.draft?.inferredType === 'string' ? session.draft.inferredType : undefined;
    const draftIsStale = Boolean(
      session.draft
      && draftInferredType
      && draftInferredType !== 'unknown'
      && session.draft.coordinateSemantics !== STRUCTURAL_COORDINATE_SEMANTICS
    );

    const modelMeta = session.latestModel?.metadata && typeof session.latestModel.metadata === 'object'
      ? session.latestModel.metadata as Record<string, unknown>
      : null;
    const modelInferredType = typeof modelMeta?.inferredType === 'string' ? modelMeta.inferredType : undefined;
    const modelIsStale = Boolean(
      session.latestModel
      && modelInferredType
      && modelInferredType !== 'unknown'
      && modelMeta?.coordinateSemantics !== STRUCTURAL_COORDINATE_SEMANTICS
    );

    if (draftIsStale || modelIsStale) {
      session.draft = undefined;
      session.structuralTypeMatch = undefined;
      session.latestModel = undefined;
      session.updatedAt = Date.now();
      if (conversationId?.trim()) {
        await this.setInteractionSession(conversationId.trim(), session);
      }
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
    const activeToolIds = await this.runtimeBinder.resolveActiveToolIds(skillIds);
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

  async listSkills() {
    const skills = await this.skillCatalog.listBuiltinSkills();
    return skills.map((skill) => ({
      id: skill.canonicalId,
      aliases: [...skill.aliases].sort(),
      name: skill.name,
      description: skill.description,
      structureType: skill.structureType,
      stages: skill.stages,
      triggers: skill.triggers,
      autoLoadByDefault: skill.autoLoadByDefault,
      domain: skill.domain,
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
              type: { const: 'presentation_init' },
              presentation: { type: 'object' },
            },
            required: ['type', 'presentation'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'phase_upsert' },
              phase: { type: 'object' },
            },
            required: ['type', 'phase'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'step_upsert' },
              phaseId: { type: 'string' },
              step: { type: 'object' },
            },
            required: ['type', 'phaseId', 'step'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'artifact_upsert' },
              artifact: { type: 'object' },
            },
            required: ['type', 'artifact'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'artifact_payload_sync' },
              artifact: { enum: ['model', 'analysis', 'report'] },
              model: { type: 'object' },
              latestResult: { type: 'object' },
              snapshot: { type: 'object' },
            },
            required: ['type', 'artifact'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'summary_replace' },
              summaryText: { type: 'string' },
            },
            required: ['type', 'summaryText'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'presentation_complete' },
              completedAt: { type: 'string' },
            },
            required: ['type', 'completedAt'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'presentation_error' },
              phase: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['type', 'phase', 'message'],
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
    return this.runInternal(preparedInput, traceId, strategy, input.signal);
  }

  private async *runStreamWithStrategy(
    input: AgentRunInput,
    strategy: AgentRunStrategy,
  ): AsyncGenerator<AgentStreamChunk> {
    const signal = input.signal;
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
      yield {
        type: 'presentation_init',
        presentation: createEmptyAssistantPresentation({
          traceId,
          mode: strategy.allowToolCall ? 'execution' : 'conversation',
          startedAt,
        }),
      };

      if (signal?.aborted) {
        yield {
          type: 'presentation_complete',
          completedAt: new Date().toISOString(),
        };
        yield { type: 'done' };
        return;
      }

      // Relay step events from runInternal through this generator.
      const stepEventQueue: AgentStreamChunk[] = [];
      let stepEventNotify: (() => void) | null = null;

      const onStepEvent: StepEventCallback = (chunk: AgentStreamChunk) => {
        stepEventQueue.push(chunk);
        stepEventNotify?.();
        stepEventNotify = null;
      };

      // Start runInternal — it calls onStepEvent synchronously from its step loop
      const resultPromise = this.runInternal(
        { ...preparedInput, traceId }, traceId, strategy, signal, onStepEvent,
      );

      // Interleave: yield step events as they arrive, then await the final result.
      let resultSettled = false;
      let resolvedResult: AgentRunResult | undefined;
      resultPromise.then((r) => { resultSettled = true; resolvedResult = r; });

      while (!resultSettled) {
        // Drain any already-queued events
        while (stepEventQueue.length > 0) {
          yield stepEventQueue.shift()!;
        }
        if (resultSettled) break;

        // Create a promise that resolves when the next step event arrives
        const nextEventPromise = new Promise<void>((resolve) => {
          stepEventNotify = resolve;
        });

        // Race: next step event vs result completion
        await Promise.race([nextEventPromise, resultPromise]);

        // Drain events that arrived during the race
        while (stepEventQueue.length > 0) {
          yield stepEventQueue.shift()!;
        }
      }

      // Flush any events queued between last drain and result resolution
      while (stepEventQueue.length > 0) {
        yield stepEventQueue.shift()!;
      }

      const result = resolvedResult ?? await resultPromise;
      if (result.interaction && result.interaction.state !== 'completed') {
        const locale = this.resolveInteractionLocale(preparedInput.context?.locale);
        const phase = result.interaction.state === 'collecting' ? 'understanding' : 'modeling';
        yield {
          type: 'phase_upsert',
          phase: {
            phaseId: buildPhaseId(phase),
            phase,
            title: phaseTitle(phase, locale),
            status: 'running',
            steps: [],
          },
        };
        const clarificationQuestion = result.clarification?.question?.trim();
        if (result.interaction.state === 'collecting'
          || result.interaction.state === 'confirming'
          || result.interaction.state === 'blocked') {
          const responseText = result.response?.trim() || clarificationQuestion || '';
          yield {
            type: 'step_upsert',
            phaseId: buildPhaseId(phase),
            step: {
              id: `clarification:${result.interaction.turnId ?? result.completedAt}`,
              phase,
              status: 'done',
              tool: 'clarification',
              title: buildInteractionTimelineTitle(result.interaction, locale),
              output: responseText ? { question: clarificationQuestion, response: responseText, missingCritical: result.interaction.missingCritical, missingOptional: result.interaction.missingOptional } : undefined,
              startedAt: result.completedAt,
              completedAt: result.completedAt,
            },
          };
        }
        yield { type: 'interaction_update', content: result.interaction };
      } else if (result.response.trim().length > 0) {
        // Non-tool response: just summary, no steps needed
      }
      yield {
        type: 'summary_replace',
        summaryText: result.response,
      };
      yield { type: 'result', content: result };
      yield {
        type: 'presentation_complete',
        completedAt: result.completedAt,
      };
      yield { type: 'done' };
    } catch (error: any) {
      if (signal?.aborted) {
        return;
      }
      yield {
        type: 'presentation_error',
        phase: 'modeling',
        message: this.stringifyError(error),
        createdAt: new Date().toISOString(),
      };
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
    signal?: AbortSignal,
    onStepEvent?: StepEventCallback,
  ): Promise<AgentRunResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const prepared = await this.prepareRunContext(params);
    const {
      locale,
      modelInput,
      skillIds,
      activeSkillIds,
      noSkillMode,
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
        signal,
      });
    } catch (error: any) {
      const plannerErrorMessage = typeof error?.message === 'string' ? error.message : 'LLM_PLANNER_UNAVAILABLE';
      let plannerResponse = plannerErrorMessage === 'LLM_PLANNER_INVALID_RESPONSE'
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
      if (plannerErrorMessage.startsWith('LLM_PLANNER_UNAVAILABLE:')) {
        plannerResponse = this.localize(
          locale,
          `LLM配置出错：${this.extractPlannerErrorDetail(plannerErrorMessage, locale)}`,
          `LLM configuration error: ${this.extractPlannerErrorDetail(plannerErrorMessage, locale)}`,
        );
      }
      return this.finalizeBlockedRunResult({
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        orchestrationMode,
        skillIds,
        selectedSkillIds: skillIds,
        plan,
        toolCalls,
        sessionKey,
        workingSession,
        response: plannerResponse,
        blockedReasonCode: 'NO_EXECUTABLE_TOOL',
        needsModelInput: false,
      });
    }

    // --- Phase 4: Pipeline scheduler integration ---
    if (nextPlan.targetArtifact && nextPlan.kind === 'execute' && allowToolCall) {
      // Block execution when skill set is empty and no active tools (mirrors old-path guard)
      if (noSkillMode && !this.hasActiveTool(activeToolIds, 'draft_model')) {
        const blockedResponse = this.localize(
          locale,
          '当前能力集无法为本轮请求选择可执行工具，请先启用建模或分析能力。',
          'No executable tool can be selected for this request under the current capability set. Enable drafting or analysis capabilities first.',
        );
        return this.finalizeBlockedRunResult({
          params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
          skillIds, plan, toolCalls, sessionKey, workingSession,
          response: blockedResponse,
          blockedReasonCode: 'NO_EXECUTABLE_TOOL',
          needsModelInput: !modelInput && !workingSession.latestModel,
        });
      }
      const projectId = params.context?.projectId;
      let pipelineState: ProjectPipelineState = projectId
        ? await this.projectService.getProjectPipelineState(projectId)
        : createEmptyProjectPipelineState();

      const requestOverrides = params.context?.requestOverrides;
      const projectPolicy = projectId
        ? mergeExecutionPolicy(
          await this.projectService.getProjectExecutionPolicy(projectId),
          requestOverrides,
        )
        : mergeExecutionPolicy({}, requestOverrides);
      pipelineState = { ...pipelineState, policy: projectPolicy };

      // Step 3.1: Seed artifacts from workingSession/modelInput for session-only contexts.
      // Prevents scheduler from blocking with "designBasis incomplete" when no project exists.
      if (!pipelineState.artifacts.designBasis && (workingSession.draft || modelInput)) {
        pipelineState = {
          ...pipelineState,
          artifacts: {
            ...pipelineState.artifacts,
            designBasis: {
              artifactId: 'session:designBasis',
              kind: 'designBasis',
              scope: 'session',
              status: 'ready',
              revision: 1,
              producerSkillId: 'session-inferred',
              dependencyFingerprint: computeDependencyFingerprint({}),
              basedOn: [],
              schemaVersion: '1.0.0',
              provenance: { toolId: 'session-seed' },
              createdAt: Date.now(),
              updatedAt: Date.now(),
              payload: { source: 'session-inferred' },
            },
          },
        };
      }
      const normalizedModelSource = workingSession.latestModel || modelInput;
      if (!pipelineState.artifacts.normalizedModel && normalizedModelSource) {
        const nmDepRefs: Record<string, { artifactId: string; revision: number }> = {};
        if (pipelineState.artifacts.designBasis) {
          nmDepRefs.designBasis = { artifactId: pipelineState.artifacts.designBasis.artifactId, revision: pipelineState.artifacts.designBasis.revision };
        }
        pipelineState = {
          ...pipelineState,
          artifacts: {
            ...pipelineState.artifacts,
            normalizedModel: {
              artifactId: 'session:normalizedModel',
              kind: 'normalizedModel',
              scope: 'session',
              status: 'ready',
              revision: 1,
              producerSkillId: workingSession.draft?.skillId ?? 'session-seed',
              dependencyFingerprint: computeDependencyFingerprint(
                nmDepRefs,
                undefined,
                workingSession.draft && workingSession.draft.inferredType && workingSession.draft.inferredType !== 'unknown'
                  ? computeDraftStateContentHash(workingSession.draft as Record<string, unknown>)
                  : undefined,
              ),
              basedOn: [],
              schemaVersion: '1.0.0',
              provenance: { toolId: 'session-seed' },
              createdAt: Date.now(),
              updatedAt: Date.now(),
              payload: normalizedModelSource,
            },
          },
        };
      }

      // Pre-process message through skill handler to update DraftState
      // so the scheduler can detect parameter changes via DraftState hash.
      // Only needed when targeting downstream artifacts (analysis, code-check, etc.)
      // and a draft + model already exist — normalizedModel creation handles its own extraction.
      const preExtractInferredType = (workingSession.draft as Record<string, unknown> | undefined)?.inferredType as string | undefined;
      if (workingSession.draft
          && pipelineState.artifacts.normalizedModel
          && nextPlan.targetArtifact !== 'normalizedModel'
          && activeSkillIds && activeSkillIds.length > 0) {
        try {
          const extraction = await this.skillRuntime.extractDraftParameters(
            this.llm, params.message, { ...workingSession.draft }, locale, activeSkillIds,
          );
          if (extraction.nextState && extraction.plugin) {
            workingSession.draft = extraction.nextState;
          }
        } catch {
          // Extraction failure should not block execution — scheduler will handle it.
          // workingSession.draft is untouched because we passed a clone to extractDraftParameters.
        }
      }
      // If pre-extraction promoted inferredType from unknown to a real structural type,
      // the seeded normalizedModel fingerprint is now stale (it was computed without
      // DraftState hash because the old inferredType was 'unknown'). Re-seed the
      // fingerprint so the scheduler can still reuse the artifact.
      if (pipelineState.artifacts.normalizedModel
          && preExtractInferredType === 'unknown'
          && workingSession.draft
          && workingSession.draft.inferredType
          && workingSession.draft.inferredType !== 'unknown') {
        const nmDepRefs2: Record<string, { artifactId: string; revision: number }> = {};
        if (pipelineState.artifacts.designBasis) {
          nmDepRefs2.designBasis = { artifactId: pipelineState.artifacts.designBasis.artifactId, revision: pipelineState.artifacts.designBasis.revision };
        }
        pipelineState = {
          ...pipelineState,
          artifacts: {
            ...pipelineState.artifacts,
            normalizedModel: {
              ...pipelineState.artifacts.normalizedModel,
              dependencyFingerprint: computeDependencyFingerprint(
                nmDepRefs2,
                undefined,
                computeDraftStateContentHash(workingSession.draft as Record<string, unknown>),
              ),
            },
          },
        };
      }

      const workingSessionDraftArtifact = workingSession.draft
        ? buildDraftStateArtifact(workingSession.draft)
        : undefined;

      // Auto-bind provider slots for session-only contexts (no project bindings)
      if (!pipelineState.bindings.analysisProviderSkillId && activeSkillIds) {
        const preferredAnalysis = this.skillRuntime.resolvePreferredAnalysisSkill({
          analysisType: workingSession.resolved?.analysisType || params.context?.analysisType || 'static',
          engineId: params.context?.engineId,
          skillIds: activeSkillIds,
        });
        if (preferredAnalysis) {
          pipelineState = {
            ...pipelineState,
            bindings: { ...pipelineState.bindings, analysisProviderSkillId: preferredAnalysis.id },
          };
        }
      }
      if (!pipelineState.bindings.codeCheckProviderSkillId && activeSkillIds) {
        const designCode = workingSession.resolved?.designCode || params.context?.designCode
          || this.skillRuntime.resolveCodeCheckDesignCodeFromSkillIds(activeSkillIds);
        if (designCode) {
          const codeCheckSkillId = this.skillRuntime.resolveCodeCheckSkillId(designCode);
          if (codeCheckSkillId) {
            pipelineState = {
              ...pipelineState,
              bindings: { ...pipelineState.bindings, codeCheckProviderSkillId: codeCheckSkillId },
            };
          }
        }
      }

      const bindDefaultSkill = (domain: string, key: keyof typeof pipelineState.bindings) => {
        if (!pipelineState.bindings[key]) {
          const resolved = this.skillRuntime.resolveDefaultSkillForDomain(domain);
          if (resolved && activeSkillIds?.includes(resolved)) {
            pipelineState = {
              ...pipelineState,
              bindings: { ...pipelineState.bindings, [key]: resolved },
            };
          }
        }
      };

      bindDefaultSkill('validation', 'validationSkillId');
      bindDefaultSkill('report-export', 'reportSkillId');
      bindDefaultSkill('drawing', 'drawingSkillId');
      bindDefaultSkill('result-postprocess', 'postprocessSkillId');

      // Pre-resolve structural skill from selected skills so scheduler and
      // emitStepUpdate can show the skill badge even before draft_model runs.
      const preResolvedStructuralSkillId = workingSession.structuralTypeMatch?.skillId
        || workingSession.draft?.skillId
        || await this.resolveStructuralSkillFromActive(skillIds);

      const schedulerPlan = this.pipelineScheduler.plan({
        message: params.message,
        locale,
        selectedSkillIds: skillIds ?? [],
        bindings: pipelineState.bindings,
        projectPolicy: pipelineState.policy,
        targetArtifact: nextPlan.targetArtifact as ArtifactKind | 'chatReply',
        sessionArtifacts: { draftState: workingSessionDraftArtifact },
        projectArtifacts: pipelineState.artifacts,
        requestOverrides: {
          ...requestOverrides,
          forceRecompute: nextPlan.targetArtifact === 'normalizedModel'
            ? true
            : requestOverrides?.forceRecompute,
        },
        consumerContracts: await this.resolveConsumerContracts(skillIds ?? []),
        enricherContracts: await this.resolveEnricherContracts(skillIds ?? []),
        structuralSkillId: preResolvedStructuralSkillId,
      });

      if (schedulerPlan.blockedReason) {
        const blockedResponse = buildLocalizedBlockedReason(schedulerPlan.blockedReason, locale);
        const blockedTarget = nextPlan.targetArtifact !== 'chatReply' ? nextPlan.targetArtifact as ArtifactKind : undefined;
        workingSession.checkpoint = buildInteractionCheckpoint({
          kind: 'blocked',
          targetArtifact: blockedTarget,
          summary: blockedResponse,
        });
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
          response: blockedResponse,
          blockedReasonCode: 'PIPELINE_BLOCKED',
          needsModelInput: false,
        });
      }

      // Check for unresolved checkpoint — preserve existing checkpoint details
      if (workingSession.checkpoint) {
        const blockedResponse = buildLocalizedBlockedReason('unresolved checkpoint', locale);
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
          response: blockedResponse,
          blockedReasonCode: 'PIPELINE_BLOCKED',
          needsModelInput: false,
        });
      }

      // Check for in-flight run
      if (projectId && nextPlan.targetArtifact !== 'chatReply') {
        const inFlight = await this.runStore.getLatestRun({
          targetArtifact: nextPlan.targetArtifact as ArtifactKind,
          projectId,
          statuses: ['queued', 'running'],
        });
        if (inFlight) {
          const blockedResponse = buildLocalizedBlockedReason('previous run in progress', locale);
          const blockedTarget = nextPlan.targetArtifact !== 'chatReply' ? nextPlan.targetArtifact as ArtifactKind : undefined;
          workingSession.checkpoint = buildInteractionCheckpoint({
            kind: 'blocked',
            targetArtifact: blockedTarget,
            summary: blockedResponse,
          });
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
            response: blockedResponse,
            blockedReasonCode: 'PIPELINE_BLOCKED',
            needsModelInput: false,
          });
        }
      }

      // Execute scheduler steps
      // Helper: record each scheduler step as an AgentToolCall
      const pushToolCall = (step: SchedulerStep, status: AgentToolCall['status'], extra?: Partial<AgentToolCall>) => {
        const now = new Date().toISOString();
        const mappedToolId = step.tool as AgentToolName;
        toolCalls.push({
          tool: mappedToolId,
          input: { stepId: step.stepId, tool: step.tool, ...(step.provides ? { targetArtifact: step.provides } : {}) },
          status,
          startedAt: extra?.startedAt ?? now,
          completedAt: extra?.completedAt ?? now,
          durationMs: extra?.durationMs,
          output: extra?.output,
          error: extra?.error,
          errorCode: extra?.errorCode,
        });
      };

      // Pre-check: scan all steps for disabled tools before executing any
      const disabledToolIds = params.context?.disabledToolIds;
      if (Array.isArray(disabledToolIds) && disabledToolIds.length > 0) {
        for (const preStep of schedulerPlan.requiredSteps) {
          if (preStep.mode === 'reuse') continue;
          const preStepToolId = preStep.tool;
          if (disabledToolIds.includes(preStepToolId)) {
            const disabledToolResponse = this.localize(
              locale,
              `工具 ${preStepToolId} 已被禁用，无法执行。`,
              `Tool ${preStepToolId} is disabled and cannot be executed.`,
            );
            return this.finalizeBlockedRunResult({
              params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
              skillIds, plan, toolCalls, sessionKey, workingSession,
              response: disabledToolResponse,
              blockedReasonCode: 'TOOL_DISABLED',
              needsModelInput: false,
            });
          }
        }
      }

      const emitStepUpdate = (
        step: SchedulerStep,
        updates: {
          status: 'running' | 'done' | 'error';
          startedAtIso: string;
          completedAtIso?: string;
          durationMs?: number;
          artifact?: ArtifactEnvelope;
          errorMessage?: string;
        },
      ): void => {
        const phase = mapToolToPresentationPhase(step.tool);
        const phaseId = buildPhaseId(phase);

        if (updates.status === 'running') {
          onStepEvent?.({
            type: 'phase_upsert',
            phase: {
              phaseId,
              phase,
              title: phaseTitle(phase, locale),
              status: 'running',
              steps: [],
            },
          });
        }

        onStepEvent?.({
          type: 'step_upsert',
          phaseId,
          step: {
            id: `step:${step.tool}:${updates.startedAtIso}`,
            phase,
            status: updates.status,
            tool: step.tool,
            skillId: step.skillId || skillIdForToolCall(step.tool, {
              structuralSkillId: workingSession.structuralTypeMatch?.skillId || workingSession.draft?.skillId || preResolvedStructuralSkillId,
              validationSkillId: pipelineState.bindings.validationSkillId,
              analysisSkillId: pipelineState.bindings.analysisProviderSkillId,
              codeCheckSkillId: pipelineState.bindings.codeCheckProviderSkillId,
              reportSkillId: pipelineState.bindings.reportSkillId,
            }) || undefined,
            title: toolTitle(step.tool, updates.status, locale),
            reason: step.reason,
            output: updates.artifact?.payload,
            errorMessage: updates.errorMessage,
            startedAt: updates.startedAtIso,
            completedAt: updates.completedAtIso,
            durationMs: updates.durationMs,
          },
        });

        if (updates.status === 'done' && updates.artifact) {
          const presentationArtifact = mapArtifactEnvelopeToPresentationArtifact(updates.artifact);
          if (presentationArtifact) {
            onStepEvent?.({
              type: 'artifact_upsert',
              artifact: buildArtifactUpsertState(presentationArtifact, locale),
            });
            // Only push model visualization to right panel during streaming;
            // analysis/report will sync via the final 'result' event to avoid
            // showing incomplete data on the right panel.
            if (presentationArtifact === 'model') {
              const payload = normalizePresentationPayload(updates.artifact.payload);
              if (payload) {
                onStepEvent?.(buildArtifactPayloadChunk(presentationArtifact, payload, workingSession.latestModel));
              }
            }
          }
        }
      };

      onStepEvent?.({
        type: 'phase_upsert',
        phase: {
          phaseId: buildPhaseId('modeling'),
          phase: 'modeling',
          title: phaseTitle('modeling', locale),
          status: 'running',
          steps: [],
        },
      });

      for (const step of schedulerPlan.requiredSteps) {
        try {
          this.runtimeBinder.assertStepAuthorized({
            step,
            selectedSkillIds: activeSkillIds ?? skillIds,
            bindings: pipelineState.bindings,
          });
        } catch (authError) {
          const authMessage = authError instanceof Error ? authError.message : String(authError);
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
            response: buildLocalizedBlockedReason(authMessage, locale),
            blockedReasonCode: 'STEP_UNAUTHORIZED',
            needsModelInput: false,
          });
        }

        if (step.mode === 'reuse') {
          continue;
        }

        // Check if tool is disabled
        const stepToolId = step.tool;
        const disabledToolIds = params.context?.disabledToolIds;
        if (Array.isArray(disabledToolIds) && disabledToolIds.includes(stepToolId)) {
          const disabledToolResponse = this.localize(
            locale,
            `工具 ${stepToolId} 已被禁用，无法执行。`,
            `Tool ${stepToolId} is disabled and cannot be executed.`,
          );
          return this.finalizeBlockedRunResult({
            params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
            skillIds, plan, toolCalls, sessionKey, workingSession,
            response: disabledToolResponse,
            blockedReasonCode: 'TOOL_DISABLED',
            needsModelInput: false,
          });
        }

        // Strict mode: block steps whose tool is not in the active tool set
        if (!this.hasActiveTool(activeToolIds, stepToolId)) {
          const missingToolResponse = this.localize(
            locale,
            `执行流程需要工具 \`${stepToolId}\`，但该工具未启用。请在能力设置中启用对应的技能或工具。`,
            `Pipeline requires tool \`${stepToolId}\` but it is not enabled. Please enable the corresponding skill or tool in capability settings.`,
          );
          return this.finalizeBlockedRunResult({
            params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
            skillIds, plan, toolCalls, sessionKey, workingSession,
            response: missingToolResponse,
            blockedReasonCode: 'TOOL_NOT_ACTIVE',
            needsModelInput: false,
          });
        }

        if (STUB_TOOLS.has(step.tool)) {
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
            response: buildLocalizedBlockedReason('tool not implemented', locale),
            blockedReasonCode: 'TOOL_NOT_IMPLEMENTED',
            needsModelInput: false,
          });
        }

        if (step.mode === 'block') {
          workingSession.checkpoint = buildInteractionCheckpoint({
            kind: 'blocked',
            targetArtifact: step.provides,
            summary: buildLocalizedBlockedReason(step.reason, locale),
          });
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
            response: buildLocalizedBlockedReason(step.reason, locale),
            blockedReasonCode: 'STEP_BLOCKED',
            needsModelInput: false,
          });
        }

        if (step.mode === 'approval') {
          workingSession.checkpoint = buildInteractionCheckpoint({
            kind: 'approval',
            targetArtifact: step.provides,
            summary: step.reason,
          });
          return this.finalizeRunResult(traceId, sessionKey, params.message, {
            traceId, startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAtMs,
            success: false,
            orchestrationMode,
            needsModelInput: false,
            plan, toolCalls,
            metrics: this.buildMetrics(toolCalls),
            interaction: this.buildToolInteraction('confirming', locale),
            response: step.reason,
          }, skillIds, workingSession, skillIds);
        }

        if (step.mode === 'ask-user') {
          workingSession.checkpoint = buildInteractionCheckpoint({
            kind: 'clarification',
            targetArtifact: step.provides,
            summary: step.reason,
          });
          return this.finalizeRunResult(traceId, sessionKey, params.message, {
            traceId,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAtMs,
            success: false,
            orchestrationMode,
            needsModelInput: false,
            plan,
            toolCalls,
            metrics: this.buildMetrics(toolCalls),
            interaction: this.buildToolInteraction('collecting', locale),
            response: step.reason,
          }, skillIds, workingSession, skillIds);
        }

        if (step.mode === 'propose') {
          workingSession.checkpoint = buildInteractionCheckpoint({
            kind: 'design-proposal',
            targetArtifact: step.provides ?? 'normalizedModel',
            patchId: step.stepId,
            summary: step.reason,
          });
          return this.finalizeRunResult(traceId, sessionKey, params.message, {
            traceId,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAtMs,
            success: false,
            orchestrationMode,
            needsModelInput: false,
            plan,
            toolCalls,
            metrics: this.buildMetrics(toolCalls),
            interaction: this.buildToolInteraction('confirming', locale),
            response: step.reason,
          }, skillIds, workingSession, skillIds);
        }

        if (step.mode === 'queue-run') {
          const queuedRun = await this.runStore.createRun({
            projectId,
            conversationId: sessionKey,
            targetArtifact: (step.provides ?? nextPlan.targetArtifact) as ArtifactKind,
            toolId: step.tool,
            providerSkillId: step.skillId,
            status: 'queued',
            inputFingerprint: computeStepInputFingerprint(step, pipelineState),
          });
          if (projectId) {
            await this.projectService.updateProjectPipelineState(projectId, pipelineState);
          }
          const queueMessage = locale === 'zh'
            ? `已排队 ${queuedRun.toolId}，目标产物 ${queuedRun.targetArtifact}`
            : `Queued ${queuedRun.toolId} for ${queuedRun.targetArtifact}`;
          return this.finalizeRunResult(traceId, sessionKey, params.message, {
            traceId,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAtMs,
            success: false,
            orchestrationMode,
            needsModelInput: false,
            plan,
            toolCalls,
            metrics: this.buildMetrics(toolCalls),
            interaction: this.buildToolInteraction('executing', locale),
            response: queueMessage,
          }, skillIds, workingSession, skillIds);
        }

        const stepStartedAtMs = Date.now();
        const stepStartedAt = new Date(stepStartedAtMs).toISOString();

        emitStepUpdate(step, { status: 'running', startedAtIso: stepStartedAt });

        // execute / transform
        let stepResult: { artifact?: import('../agent-runtime/types.js').ArtifactEnvelope; runRecord?: import('../agent-runtime/types.js').RunRecord; draftMeta?: { structuralTypeMatch?: any; nextState?: any } };
        try {
          stepResult = await this.skillRuntime.executeScheduledStep({
            step,
            pipelineState,
            traceId,
            locale,
            postToEngineWithRetry: this.postToEngineWithRetry.bind(this),
            codeCheckClient: this.codeCheckClient,
            structureProtocolClient: this.structureProtocolClient,
            message: params.message,
            llm: this.llm,
            draftState: workingSession.draft,
            skillIds,
            engineId: params.context?.engineId,
            analysisParameters: prepared.analysisParameters,
            signal,
          });
        } catch (stepError) {
          const rawStepErrorMessage = stepError instanceof Error ? stepError.message : String(stepError);
          // Surface Pydantic field-level validation detail when available.
          const errorDetail = (stepError as any)?.detail;
          let stepErrorMessage = rawStepErrorMessage;
          if (Array.isArray(errorDetail) && errorDetail.length > 0) {
            const detailSummary = errorDetail
              .slice(0, 5)
              .map((d: { loc?: unknown[]; msg?: string; type?: string }) => {
                const loc = Array.isArray(d.loc) ? d.loc.join('.') : '?';
                return `${loc}: ${d.msg ?? d.type ?? 'invalid'}`;
              })
              .join('; ');
            stepErrorMessage = `${rawStepErrorMessage} (${detailSummary})`;
          }
          const actionErrorCodes: Record<string, string> = {
            run_code_check: 'CODE_CHECK_EXECUTION_FAILED',
            validate_model: 'VALIDATION_EXECUTION_FAILED',
            run_analysis: 'ANALYSIS_EXECUTION_FAILED',
            generate_report: 'REPORT_EXECUTION_FAILED',
            draft_model: 'DRAFT_INCOMPLETE',
          };
          const errorCode = stepError instanceof Error && stepError.message.startsWith('DRAFT_INCOMPLETE')
            ? 'DRAFT_INCOMPLETE'
            : actionErrorCodes[step.tool] ?? 'STEP_EXECUTION_FAILED';
          pushToolCall(step, 'error', {
            startedAt: stepStartedAt,
            error: stepErrorMessage,
            errorCode,
            durationMs: Date.now() - stepStartedAtMs,
          });
          emitStepUpdate(step, {
            status: 'error',
            startedAtIso: stepStartedAt,
            completedAtIso: new Date().toISOString(),
            durationMs: Date.now() - stepStartedAtMs,
            errorMessage: stepErrorMessage,
          });
          // DRAFT_INCOMPLETE: fall back to conversation mode for clarification prompts.
          // In directed mode (forced execution), override success to false — the pipeline
          // cannot complete without full model details, but the conversation-mode fallback
          // still produces useful clarification data (missing fields, prompts).
          if (errorCode === 'DRAFT_INCOMPLETE') {
            const askPlan: AgentNextStepPlan = {
              kind: 'ask',
              planningDirective: 'auto',
              rationale: 'override',
            };
            const convResult = await this.handleConversationMode({
              nextPlan: askPlan,
              params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
              toolCalls, plan, sessionKey, workingSession, activeToolIds,
              signal,
            });
            if (orchestrationMode === 'directed') {
              return { ...convResult, success: false, needsModelInput: true };
            }
            return convResult;
          }
          // Bypass validate on upstream 502 (transient server errors)
          if (step.tool === 'validate_model' && this.shouldBypassValidateFailure(stepError)) {
            // Add validation warning to plan for inclusion in final response
            plan.push(this.localize(
              locale,
              `模型校验服务暂时不可用，已跳过 \`validate_model\` 并继续执行 \`run_analysis\`：${stepErrorMessage}`,
              `The model validation service is temporarily unavailable. \`validate_model\` was skipped and \`run_analysis\` will continue: ${stepErrorMessage}`,
            ));
            continue;
          }
          // Localize analyze engine 502 errors
          if (step.tool === 'run_analysis' && this.shouldRetryEngineCall(stepError)) {
            const engineUnavailable = this.localize(
              locale,
              `分析引擎服务暂时不可用，重试后仍失败：${stepErrorMessage}`,
              `The analysis engine is temporarily unavailable and still failed after retry: ${stepErrorMessage}`,
            );
            return this.finalizeBlockedRunResult({
              params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
              skillIds, plan, toolCalls, sessionKey, workingSession,
              response: engineUnavailable,
              blockedReasonCode: errorCode,
              needsModelInput: false,
            });
          }
          return this.finalizeBlockedRunResult({
            params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
            skillIds, plan, toolCalls, sessionKey, workingSession,
            response: buildLocalizedBlockedReason(stepErrorMessage, locale),
            blockedReasonCode: errorCode,
            needsModelInput: false,
          });
        }
        pushToolCall(step, 'success', {
          startedAt: stepStartedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - stepStartedAtMs,
          output: stepResult.artifact?.payload,
        });
        pipelineState = applySchedulerStepResult({ pipelineState, step, stepResult });
        // Step 3.3: Write back draft metadata BEFORE emitStepUpdate so skillId is available
        if (stepResult.draftMeta) {
          if (stepResult.draftMeta.structuralTypeMatch) {
            workingSession.structuralTypeMatch = stepResult.draftMeta.structuralTypeMatch;
          }
          if (stepResult.draftMeta.nextState) {
            workingSession.draft = stepResult.draftMeta.nextState;
          }
        }
        // Step 3.2: Write back normalizedModel to workingSession for backward compatibility
        if (stepResult.artifact?.kind === 'normalizedModel' && stepResult.artifact.payload) {
          workingSession.latestModel = stepResult.artifact.payload as Record<string, unknown>;
        }
        emitStepUpdate(step, {
          status: 'done',
          startedAtIso: stepStartedAt,
          completedAtIso: new Date().toISOString(),
          durationMs: Date.now() - stepStartedAtMs,
          artifact: stepResult.artifact,
        });
        if (projectId && stepResult.runRecord) {
          await this.runStore.updateRun(stepResult.runRecord.runId, {
            status: stepResult.runRecord.status,
            diagnostics: stepResult.runRecord.diagnostics,
            startedAt: stepResult.runRecord.startedAt ? new Date(stepResult.runRecord.startedAt) : undefined,
            finishedAt: stepResult.runRecord.finishedAt ? new Date(stepResult.runRecord.finishedAt) : undefined,
          });
        }
      }

      // Spec sections 7.3, 13.3: design feedback loop
      // Only trigger when auto-design iteration policy is enabled or user explicitly requests
      const autoDesignPolicy = pipelineState.policy?.autoDesignIterationPolicy;
      if (pipelineState.artifacts.postprocessedResult && pipelineState.artifacts.codeCheckResult
        && autoDesignPolicy?.enabled) {
        const feedbackPlan = this.pipelineScheduler.planDesignFeedback({
          message: params.message,
          locale,
          selectedSkillIds: skillIds ?? [],
          bindings: pipelineState.bindings,
          projectPolicy: pipelineState.policy,
          targetArtifact: 'normalizedModel' as ArtifactKind,
          sessionArtifacts: {},
          projectArtifacts: pipelineState.artifacts,
        });

        if (!feedbackPlan.blockedReason && feedbackPlan.requiredSteps.length > 0) {
          for (const fbStep of feedbackPlan.requiredSteps) {
            try {
              this.runtimeBinder.assertStepAuthorized({
                step: fbStep,
                selectedSkillIds: skillIds,
                bindings: pipelineState.bindings,
              });
            } catch (authError) {
              const authMessage = authError instanceof Error ? authError.message : String(authError);
              return this.finalizeBlockedRunResult({
                params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
                skillIds, plan, toolCalls, sessionKey, workingSession,
                response: buildLocalizedBlockedReason(authMessage, locale),
                blockedReasonCode: 'STEP_UNAUTHORIZED',
                needsModelInput: false,
              });
            }

            if (fbStep.mode === 'reuse') continue;

            if (STUB_TOOLS.has(fbStep.tool)) {
              return this.finalizeBlockedRunResult({
                params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
                skillIds, plan, toolCalls, sessionKey, workingSession,
                response: buildLocalizedBlockedReason('tool not implemented', locale),
                blockedReasonCode: 'TOOL_NOT_IMPLEMENTED',
                needsModelInput: false,
              });
            }

            if (fbStep.mode === 'propose') {
              workingSession.checkpoint = buildInteractionCheckpoint({
                kind: 'design-proposal',
                targetArtifact: fbStep.provides ?? 'normalizedModel',
                patchId: fbStep.stepId,
                summary: fbStep.reason,
              });
              return this.finalizeRunResult(traceId, sessionKey, params.message, {
                traceId, startedAt,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAtMs,
                success: false,
                orchestrationMode,
                needsModelInput: false,
                plan, toolCalls,
                metrics: this.buildMetrics(toolCalls),
                interaction: this.buildToolInteraction('confirming', locale),
                response: fbStep.reason,
              }, skillIds, workingSession, skillIds);
            }

            // execute mode: run the design step
            const fbStepStartedAtMs = Date.now();
            const fbStepStartedAt = new Date(fbStepStartedAtMs).toISOString();
            let fbResult: { artifact?: import('../agent-runtime/types.js').ArtifactEnvelope; runRecord?: import('../agent-runtime/types.js').RunRecord };
            try {
              emitStepUpdate(fbStep, { status: 'running', startedAtIso: fbStepStartedAt });
              fbResult = await this.skillRuntime.executeScheduledStep({
                step: fbStep,
                pipelineState,
                traceId,
                locale,
                postToEngineWithRetry: this.postToEngineWithRetry.bind(this),
                codeCheckClient: this.codeCheckClient,
                structureProtocolClient: this.structureProtocolClient,
                message: params.message,
                llm: this.llm,
                draftState: workingSession.draft,
                skillIds,
                engineId: params.context?.engineId,
                signal,
              });
            } catch (fbError) {
              const fbErrorMessage = fbError instanceof Error ? fbError.message : String(fbError);
              pushToolCall(fbStep, 'error', {
                startedAt: fbStepStartedAt,
                error: fbErrorMessage,
                errorCode: 'STEP_EXECUTION_FAILED',
                durationMs: Date.now() - fbStepStartedAtMs,
              });
              emitStepUpdate(fbStep, {
                status: 'error',
                startedAtIso: fbStepStartedAt,
                completedAtIso: new Date().toISOString(),
                durationMs: Date.now() - fbStepStartedAtMs,
                errorMessage: fbErrorMessage,
              });
              return this.finalizeBlockedRunResult({
                params, traceId, startedAt, startedAtMs, locale, orchestrationMode,
                skillIds, plan, toolCalls, sessionKey, workingSession,
                response: buildLocalizedBlockedReason(fbErrorMessage, locale),
                blockedReasonCode: 'STEP_EXECUTION_FAILED',
                needsModelInput: false,
              });
            }
            pushToolCall(fbStep, 'success', {
              startedAt: fbStepStartedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - fbStepStartedAtMs,
              output: fbResult.artifact?.payload,
            });
            emitStepUpdate(fbStep, {
              status: 'done',
              startedAtIso: fbStepStartedAt,
              completedAtIso: new Date().toISOString(),
              durationMs: Date.now() - fbStepStartedAtMs,
              artifact: fbResult.artifact,
            });
            pipelineState = applySchedulerStepResult({ pipelineState, step: fbStep, stepResult: fbResult });
          }
        }
      }

      // Follow-up: if code-check is enabled and not yet done,
      // plan and execute codeCheckResult now that analysis is complete.
      const codeCheckToolEnabled = !activeToolIds || activeToolIds.has('run_code_check');
      const autoCodeCheck = workingSession.resolved?.autoCodeCheck ?? params.context?.autoCodeCheck ?? false;
      if (codeCheckToolEnabled && autoCodeCheck && !pipelineState.artifacts.codeCheckResult && pipelineState.bindings.codeCheckProviderSkillId) {
        const codeCheckPlan = this.pipelineScheduler.plan({
          message: params.message,
          locale,
          selectedSkillIds: skillIds ?? [],
          bindings: pipelineState.bindings,
          projectPolicy: pipelineState.policy,
          targetArtifact: 'codeCheckResult',
          sessionArtifacts: {},
          projectArtifacts: pipelineState.artifacts,
          enricherContracts: await this.resolveEnricherContracts(skillIds ?? []),
          structuralSkillId: preResolvedStructuralSkillId,
        });
        if (!codeCheckPlan.blockedReason && codeCheckPlan.requiredSteps.length > 0) {
          for (const ccStep of codeCheckPlan.requiredSteps) {
            if (ccStep.mode === 'reuse') continue;
            // Skip validate_model — model was already validated in the main pipeline.
            if (ccStep.tool === 'validate_model') continue;
            if (!this.hasActiveTool(activeToolIds, ccStep.tool)) {
              emitStepUpdate(ccStep, {
                status: 'error',
                startedAtIso: new Date(Date.now()).toISOString(),
                completedAtIso: new Date().toISOString(),
                durationMs: 0,
                errorMessage: this.localize(
                  locale,
                  `工具 ${ccStep.tool} 未启用`,
                  `Tool ${ccStep.tool} is not enabled`,
                ),
              });
              break;
            }
            const ccStepStartedAtMs = Date.now();
            const ccStepStartedAt = new Date(ccStepStartedAtMs).toISOString();
            let ccStepResult: { artifact?: import('../agent-runtime/types.js').ArtifactEnvelope; runRecord?: import('../agent-runtime/types.js').RunRecord };
            try {
              emitStepUpdate(ccStep, { status: 'running', startedAtIso: ccStepStartedAt });
              ccStepResult = await this.skillRuntime.executeScheduledStep({
                step: ccStep,
                pipelineState,
                traceId,
                locale,
                postToEngineWithRetry: this.postToEngineWithRetry.bind(this),
                codeCheckClient: this.codeCheckClient,
                structureProtocolClient: this.structureProtocolClient,
                message: params.message,
                llm: this.llm,
                draftState: workingSession.draft,
                skillIds,
                engineId: params.context?.engineId,
                signal,
              });
            } catch (ccStepError) {
              const ccStepErrorMessage = ccStepError instanceof Error ? ccStepError.message : String(ccStepError);
              pushToolCall(ccStep, 'error', {
                startedAt: ccStepStartedAt,
                error: ccStepErrorMessage,
                errorCode: 'STEP_EXECUTION_FAILED',
                durationMs: Date.now() - ccStepStartedAtMs,
              });
              emitStepUpdate(ccStep, {
                status: 'error',
                startedAtIso: ccStepStartedAt,
                completedAtIso: new Date().toISOString(),
                durationMs: Date.now() - ccStepStartedAtMs,
                errorMessage: ccStepErrorMessage,
              });
              break;
            }
            pushToolCall(ccStep, 'success', {
              startedAt: ccStepStartedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - ccStepStartedAtMs,
              output: ccStepResult.artifact?.payload,
            });
            emitStepUpdate(ccStep, {
              status: 'done',
              startedAtIso: ccStepStartedAt,
              completedAtIso: new Date().toISOString(),
              durationMs: Date.now() - ccStepStartedAtMs,
              artifact: ccStepResult.artifact,
            });
            pipelineState = applySchedulerStepResult({ pipelineState, step: ccStep, stepResult: ccStepResult });
          }
        }
      }

      // Follow-up: if report is requested but main target wasn't reportArtifact,
      // plan and execute reportArtifact now that analysis/code-check are done.
      const reportToolEnabled = !activeToolIds || activeToolIds.has('generate_report');
      const includeReport = reportToolEnabled
        && (workingSession.resolved?.includeReport ?? params.context?.includeReport ?? true);
      if (includeReport && !pipelineState.artifacts.reportArtifact) {
        const reportPlan = this.pipelineScheduler.plan({
          message: params.message,
          locale,
          selectedSkillIds: skillIds ?? [],
          bindings: pipelineState.bindings,
          projectPolicy: pipelineState.policy,
          targetArtifact: 'reportArtifact',
          sessionArtifacts: {},
          projectArtifacts: pipelineState.artifacts,
          consumerContracts: await this.resolveConsumerContracts(skillIds ?? []),
          enricherContracts: await this.resolveEnricherContracts(skillIds ?? []),
          structuralSkillId: preResolvedStructuralSkillId,
        });
        if (!reportPlan.blockedReason && reportPlan.requiredSteps.length > 0) {
          for (const reportStep of reportPlan.requiredSteps) {
            if (reportStep.mode === 'reuse') continue;
            if (!this.hasActiveTool(activeToolIds, reportStep.tool)) {
              emitStepUpdate(reportStep, {
                status: 'error',
                startedAtIso: new Date(Date.now()).toISOString(),
                completedAtIso: new Date().toISOString(),
                durationMs: 0,
                errorMessage: this.localize(
                  locale,
                  `工具 ${reportStep.tool} 未启用`,
                  `Tool ${reportStep.tool} is not enabled`,
                ),
              });
              break;
            }
            const rStepStartedAtMs = Date.now();
            const rStepStartedAt = new Date(rStepStartedAtMs).toISOString();
            let rStepResult: { artifact?: import('../agent-runtime/types.js').ArtifactEnvelope; runRecord?: import('../agent-runtime/types.js').RunRecord };
            try {
              emitStepUpdate(reportStep, { status: 'running', startedAtIso: rStepStartedAt });
              rStepResult = await this.skillRuntime.executeScheduledStep({
                step: reportStep,
                pipelineState,
                traceId,
                locale,
                postToEngineWithRetry: this.postToEngineWithRetry.bind(this),
                codeCheckClient: this.codeCheckClient,
                structureProtocolClient: this.structureProtocolClient,
                message: params.message,
                llm: this.llm,
                draftState: workingSession.draft,
                skillIds,
                engineId: params.context?.engineId,
                signal,
              });
            } catch (rStepError) {
              const rStepErrorMessage = rStepError instanceof Error ? rStepError.message : String(rStepError);
              pushToolCall(reportStep, 'error', {
                startedAt: rStepStartedAt,
                error: rStepErrorMessage,
                errorCode: 'STEP_EXECUTION_FAILED',
                durationMs: Date.now() - rStepStartedAtMs,
              });
              emitStepUpdate(reportStep, {
                status: 'error',
                startedAtIso: rStepStartedAt,
                completedAtIso: new Date().toISOString(),
                durationMs: Date.now() - rStepStartedAtMs,
                errorMessage: rStepErrorMessage,
              });
              break; // Don't fail the whole result for a report error
            }
            pushToolCall(reportStep, 'success', {
              startedAt: rStepStartedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - rStepStartedAtMs,
              output: rStepResult.artifact?.payload,
            });
            emitStepUpdate(reportStep, {
              status: 'done',
              startedAtIso: rStepStartedAt,
              completedAtIso: new Date().toISOString(),
              durationMs: Date.now() - rStepStartedAtMs,
              artifact: rStepResult.artifact,
            });
            pipelineState = applySchedulerStepResult({ pipelineState, step: reportStep, stepResult: rStepResult });
          }
        }
      }

      // Spec section 14: only persist pipeline state for real projects
      if (projectId) {
        await this.projectService.updateProjectPipelineState(projectId, pipelineState);
      }

      // Step 3.3: Build result from pipelineState after the step loop
      const schedulerModel = pipelineState.artifacts.normalizedModel?.payload as Record<string, unknown> | undefined;
      const schedulerAnalysis = pipelineState.artifacts.analysisRaw?.payload;
      const schedulerCodeCheck = pipelineState.artifacts.codeCheckResult?.payload;
      const schedulerReport = pipelineState.artifacts.reportArtifact?.payload;

      if (sessionKey) {
        workingSession.updatedAt = Date.now();
        await this.setInteractionSession(sessionKey, workingSession);
      }

      const analysisSuccess = Boolean((schedulerAnalysis as Record<string, unknown> | undefined)?.success);
      const schedulerSummaryFallback = schedulerAnalysis
        ? this.localize(
          locale,
          `分析完成。target=${nextPlan.targetArtifact}, success=${String(analysisSuccess)}`,
          `Analysis finished. target=${nextPlan.targetArtifact}, success=${String(analysisSuccess)}`,
        )
        : schedulerCodeCheck
          ? this.localize(
            locale,
            `规范校核完成。target=${nextPlan.targetArtifact}`,
            `Code check finished. target=${nextPlan.targetArtifact}`,
          )
          : schedulerReport
            ? this.localize(
              locale,
              `报告已生成。target=${nextPlan.targetArtifact}`,
              `Report generated. target=${nextPlan.targetArtifact}`,
            )
            : schedulerModel
              ? this.localize(
                locale,
                `结构模型已生成。target=${nextPlan.targetArtifact}`,
                `Structural model generated. target=${nextPlan.targetArtifact}`,
              )
              : this.localize(
                locale,
                `执行完成。target=${nextPlan.targetArtifact}`,
                `Execution finished. target=${nextPlan.targetArtifact}`,
              );
      let schedulerResponse = await this.renderSummary(
        params.message,
        schedulerSummaryFallback,
        locale,
        schedulerAnalysis,
        sessionKey,
        signal,
      );

      // Append PKPM calcbook file paths to the response
      if (schedulerReport) {
        const reportAny = schedulerReport as Record<string, unknown>;
        const reportJson = reportAny.json as Record<string, unknown> | undefined;
        const reportMeta = reportJson?.meta as Record<string, unknown> | undefined;
        if (reportMeta?.reportSkillId === 'pkpm-calcbook') {
          const reportSummary = reportJson?.summary as Record<string, unknown> | undefined;
          const docxPath = reportSummary?.docx_path as string | undefined;
          const pdfPath = reportSummary?.pdf_path as string | undefined;
          if (pdfPath || docxPath) {
            const apiUrl = (p: string) => `/api/v1/files/serve?path=${encodeURIComponent(p)}`;
            const lines: string[] = [];
            if (pdfPath) lines.push(`- [PDF 计算书](${apiUrl(pdfPath)})`);
            if (docxPath) lines.push(`- [Word 计算书](${apiUrl(docxPath)})`);
            const calcbookInfo = locale === 'zh'
              ? `\n\n计算书已生成：\n${lines.join('\n')}`
              : `\n\nCalculation book generated:\n${lines.join('\n')}`;
            schedulerResponse += calcbookInfo;
          }
        }
      }

      // Append any validation bypass warnings or plan notes to the response
      if (plan.length > 0) {
        schedulerResponse = `${schedulerResponse}\n${plan.join('\n')}`;
      }

      // Export report artifacts to files when reportOutput=file
      const reportOutput = workingSession.resolved?.reportOutput || params.context?.reportOutput || 'inline';
      const reportFormat = workingSession.resolved?.reportFormat || params.context?.reportFormat || 'both';
      const reportPayload = schedulerReport as Record<string, unknown> | undefined;
      const reportJson = reportPayload?.json && typeof reportPayload.json === 'object'
        ? reportPayload.json as Record<string, unknown>
        : reportPayload;
      const reportObj = reportPayload ? {
        summary: (reportPayload.summary as string) ?? this.localize(locale, '报告已生成', 'Report generated'),
        json: reportJson ?? {},
        markdown: reportPayload.markdown as string | undefined,
      } : undefined;
      let artifacts: AgentRunResult['artifacts'] | undefined;
      if (reportOutput === 'file' && reportObj) {
        artifacts = await this.persistReportArtifacts(traceId, reportObj, reportFormat as AgentReportFormat);
      }

      return this.finalizeRunResult(traceId, sessionKey, params.message, {
        traceId,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        success: schedulerAnalysis ? analysisSuccess : true,
        orchestrationMode,
        needsModelInput: !schedulerModel && !modelInput && !workingSession.latestModel,
        plan,
        toolCalls,
        model: schedulerModel,
        analysis: schedulerAnalysis,
        codeCheck: schedulerCodeCheck,
        report: reportObj,
        artifacts,
        metrics: this.buildMetrics(toolCalls),
        interaction: this.buildToolInteraction('completed', locale),
        response: schedulerResponse,
      }, activeSkillIds ?? skillIds, workingSession, skillIds);
    }

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
      signal,
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

  private collectOnlyTextToModelDraft(message: string, existingState?: DraftState, locale: AppLocale = 'en', skillIds?: string[], signal?: AbortSignal): Promise<DraftResult> {
    if (this.hasEmptySkillSelection(skillIds)) {
      return Promise.resolve({
        inferredType: 'unknown' as const,
        missingFields: ['inferredType'],
        extractionMode: this.llm ? 'llm' as const : 'deterministic' as const,
        stateToPersist: existingState,
      });
    }
    return this.skillRuntime.extractDraftParameters(this.llm, message, existingState, locale, skillIds, signal)
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
    signal?: AbortSignal;
  }): Promise<AgentRunResult> {
    const { nextPlan, params, traceId, startedAt, startedAtMs, locale, orchestrationMode, toolCalls, plan, sessionKey, workingSession, activeToolIds, signal } = args;
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
      signal,
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
        signal,
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
      signal,
    });
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
    signal?: AbortSignal;
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
      signal,
    } = args;

    const draftFn = collectOnly
      ? (msg: string, state?: DraftState, loc: AppLocale = 'en', ids?: string[]) =>
          this.collectOnlyTextToModelDraft(msg, state, loc, ids, signal)
      : (msg: string, state: DraftState | undefined, loc: AppLocale, ids?: string[]) =>
          this.textToModelDraft(msg, state, loc, ids, params.conversationId, signal);

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
    signal?: AbortSignal,
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
      const aiMessage = await this.llm.invoke(promptParts.join('\n'), { signal });
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
    signal?: AbortSignal,
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

      const aiMessage = await this.llm.invoke(promptParts.join('\n'), { signal });
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
    signal?: AbortSignal;
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
    const response = await this.renderDirectReply(params.message, fallback, locale, sessionKey, skillIds, args.signal);

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
    signal?: AbortSignal;
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
      signal,
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
        signal,
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
      signal,
    });
  }

  private async buildGenericReplyResult(args: {
    params: AgentRunInput;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    signal?: AbortSignal;
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
      args.signal,
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
    signal?: AbortSignal;
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
      args.signal,
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
    signal?: AbortSignal;
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
      signal,
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
        signal,
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
      signal,
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
    signal?: AbortSignal;
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
    // Persist latestModel that was set by resolveConversationModel
    if (sessionKey) {
      await this.setInteractionSession(sessionKey, workingSession);
    }
    const fallback = this.buildChatModeResponse(resolved.interaction, this.resolveInteractionLocale(params.context?.locale));
    const response = await this.renderInteractionResponse(
      params.message,
      resolved.interaction,
      fallback,
      this.resolveInteractionLocale(params.context?.locale),
      sessionKey,
      skillIds,
      args.signal,
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
    signal?: AbortSignal;
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
    // Persist latestModel that was set by resolveConversationModel
    if (sessionKey) {
      await this.setInteractionSession(sessionKey, workingSession);
    }
    const fallback = this.buildChatModeResponse(resolved.interaction, locale);
    const response = await this.renderInteractionResponse(
      params.message,
      resolved.interaction,
      fallback,
      locale,
      sessionKey,
      skillIds,
      args.signal,
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
    const activeToolIds = await this.runtimeBinder.resolveActiveToolIds(skillIds);
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

  private buildToolInteraction(state: AgentInteractionState, locale: AppLocale): AgentInteraction {
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

  private async renderSummary(message: string, fallback: string, locale: AppLocale, analysisData?: unknown, conversationId?: string, signal?: AbortSignal): Promise<string> {
    return resultRenderSummary(this.llm, message, fallback, locale, analysisData, conversationId, signal);
  }

  private async textToModelDraft(message: string, existingState?: DraftState, locale: AppLocale = 'en', skillIds?: string[], conversationId?: string, signal?: AbortSignal): Promise<DraftResult> {
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

    const skillDraft = await this.skillRuntime.textToModelDraft(this.llm, message, existingState, locale, skillIds, conversationHistory, signal);
    if (skillDraft.model || skillDraft.inferredType !== 'unknown' || skillDraft.structuralTypeMatch?.skillId) {
      return skillDraft;
    }

    const selectedSkillMode = Array.isArray(skillIds) && skillIds.length > 0;
    if (!selectedSkillMode) {
      return skillDraft;
    }

    const genericDraft = await this.skillRuntime.textToModelDraft(this.llm, message, existingState, locale, ['generic'], conversationHistory, signal);
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
          return {
            type: 'distributed',
            element: String(item.element ?? ''),
            wy: this.asNumber(item.wy ?? item.fy, 0),
            wz: this.asNumber(item.wz ?? item.fz, 0),
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

  private extractPlannerErrorDetail(message: string, locale: AppLocale): string {
    const marker = 'LLM_PLANNER_UNAVAILABLE:';
    if (message.startsWith(marker)) {
      return message.slice(marker.length).trim() || this.localize(locale, 'LLM 不可用', 'LLM unavailable');
    }
    return this.localize(locale, 'LLM 不可用', 'LLM unavailable');
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
      signal?: AbortSignal;
    },
  ) {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= options.retries) {
      if (options.signal?.aborted) {
        const abortError = new Error('Engine request aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }
      try {
        return await this.engineClient.post(path, payload, { signal: options.signal });
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) {
          throw error;
        }
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
    _userMessage: string,
    result: AgentRunResult,
    skillIds?: string[],
    session?: InteractionSession,
    selectedSkillIds?: string[],
  ): Promise<AgentRunResult> {
    result.conversationId = conversationId;
    result.routing = this.buildResolvedRouting(result, selectedSkillIds, session, skillIds);
    await this.annotateToolCalls(result.toolCalls, skillIds, result.routing);
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
    const tooling = await this.runtimeBinder.resolveAvailableTooling(routing?.selectedSkillIds, skillIds);
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

      const owners = [...(tooling.skillIdsByToolId[call.tool] || [])];
      if (owners.length > 0) {
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

  private async resolveConsumerContracts(
    skillIds: string[],
  ): Promise<Array<import('../agent-runtime/types.js').ConsumerRuntimeContract>> {
    const manifests = await this.skillRuntime.listSkillManifests();
    return manifests
      .filter((m) => skillIds.includes(m.id) && m.runtimeContract?.role === 'consumer')
      .map((m) => m.runtimeContract as import('../agent-runtime/types.js').ConsumerRuntimeContract);
  }

  private async resolveEnricherContracts(
    skillIds: string[],
  ): Promise<Array<{ skillId: string; priority: number }>> {
    const manifests = await this.skillRuntime.listSkillManifests();
    return manifests
      .filter((m) => skillIds.includes(m.id) && m.runtimeContract?.role === 'enricher')
      .map((m) => ({
        skillId: m.id,
        priority: (m.runtimeContract as { priority?: number })?.priority ?? m.priority,
      }));
  }

  private async resolveStructuralSkillFromActive(activeSkillIds?: string[]): Promise<string | undefined> {
    if (!activeSkillIds || activeSkillIds.length === 0) return undefined;
    const manifests = await this.skillRuntime.listSkillManifests();
    const activeSet = new Set(activeSkillIds);
    return manifests.find((m) => m.domain === 'structure-type' && activeSet.has(m.id))?.id;
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
