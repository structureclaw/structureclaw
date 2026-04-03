import type { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from './locale.js';
import type { AgentPolicyService } from './agent-policy.js';
import type {
  AgentSkillRuntime,
  DraftParameterExtractionResult,
  DraftResult,
  DraftState,
} from '../agent-runtime/index.js';
import type {
  AgentOrchestrationMode,
  AgentRunInput,
  AgentRunResult,
  AgentToolCall,
  AgentToolName,
  AgentInteraction,
  AgentInteractionState,
  ActiveToolSet,
  InteractionSession,
  InteractionDefaultProposal,
} from './agent.js';

export type SessionState =
  | 'idle'
  | 'collecting'
  | 'drafted'
  | 'validating'
  | 'validation_failed'
  | 'ready'
  | 'executing'
  | 'completed'
  | 'blocked';

export type RouteDecision =
  | { path: 'chat'; mode: 'plain' }
  | { path: 'collect'; mode: 'structured' }
  | { path: 'draft'; mode: 'structured' }
  | { path: 'execute'; toolId: AgentToolName };

export interface TurnContext {
  readonly traceId: string;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly params: AgentRunInput;
  readonly locale: AppLocale;
  readonly orchestrationMode: AgentOrchestrationMode;
  readonly modelInput?: Record<string, unknown>;
  readonly sourceFormat: string;
  readonly autoAnalyze: boolean;
  readonly analysisParameters: Record<string, unknown>;
  readonly skillIds?: string[];
  readonly activeSkillIds?: string[];
  readonly noSkillMode: boolean;
  readonly hadExistingSession: boolean;
  readonly activeToolIds?: ActiveToolSet;
  readonly sessionKey?: string;
  session: InteractionSession;
  plan: string[];
  toolCalls: AgentToolCall[];
}

export interface HandlerDeps {
  llm: ChatOpenAI | null;
  skillRuntime: AgentSkillRuntime;
  policy: AgentPolicyService;
  localize(locale: AppLocale, zh: string, en: string): string;
  hasActiveTool(activeToolIds: ActiveToolSet, toolId: string): boolean;
  hasEmptySkillSelection(skillIds?: string[]): boolean;
  setInteractionSession(conversationId: string, session: InteractionSession): Promise<void>;
  assessInteractionNeeds(
    session: InteractionSession,
    locale: AppLocale,
    skillIds?: string[],
    phase?: 'interactive' | 'execution',
  ): Promise<{ criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] }>;
  buildInteractionPayload(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] },
    session: InteractionSession,
    state: AgentInteractionState,
    locale: AppLocale,
    skillIds?: string[],
    activeToolIds?: ActiveToolSet,
  ): Promise<AgentInteraction>;
  mapMissingFieldLabels(missing: string[], locale: AppLocale, draft: DraftState, skillIds?: string[]): Promise<string[]>;
  buildInteractionQuestion(interaction: AgentInteraction, locale: AppLocale): string;
  buildRecommendedNextStep(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] },
    interaction: AgentInteraction,
    locale: AppLocale,
    activeToolIds?: ActiveToolSet,
  ): string;
  /** Terminal tool-run outcomes only. Use {@link buildInteractionPayload} for collecting, confirming, ready, etc. */
  buildToolInteraction(state: 'blocked' | 'completed', locale: AppLocale): AgentInteraction;
  extractDraftParameters(
    llm: ChatOpenAI | null,
    message: string,
    existingState: DraftState | undefined,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<DraftParameterExtractionResult>;
  buildModelFromDraft(
    llm: ChatOpenAI | null,
    message: string,
    extraction: DraftParameterExtractionResult,
    locale: AppLocale,
    conversationHistory?: string,
  ): Promise<DraftResult>;
  textToModelDraft(
    message: string,
    existingState: DraftState | undefined,
    locale: AppLocale,
    skillIds?: string[],
    conversationId?: string,
  ): Promise<DraftResult>;
  isGenericFallbackDraft(draft: DraftResult): boolean;
  applyDraftToSession(
    workingSession: InteractionSession,
    draft: DraftResult,
    genericFallbackDraft: boolean,
    message: string,
  ): void;
  renderDirectReply(
    message: string,
    fallback: string,
    locale: AppLocale,
    conversationId?: string,
    skillIds?: string[],
  ): Promise<string>;
  renderInteractionResponse(
    message: string,
    interaction: AgentInteraction,
    fallback: string,
    locale: AppLocale,
    conversationId?: string,
    skillIds?: string[],
  ): Promise<string>;
  buildChatModeResponse(interaction: AgentInteraction, locale: AppLocale): string;
  finalizeRunResult(
    traceId: string,
    conversationId: string | undefined,
    userMessage: string,
    result: AgentRunResult,
    skillIds?: string[],
    session?: InteractionSession,
    selectedSkillIds?: string[],
  ): Promise<AgentRunResult>;
  finalizeBlockedRunResult(args: {
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
    blockedReasonCode?: string;
    model?: Record<string, unknown>;
    needsModelInput?: boolean;
    clarification?: AgentRunResult['clarification'];
    interaction?: AgentInteraction;
  }): Promise<AgentRunResult>;
  buildMetrics(toolCalls: AgentToolCall[]): AgentRunResult['metrics'];
  buildGenericModelingIntro(locale: AppLocale, noSkillMode: boolean): string;
  resolveConversationAssessment(args: {
    locale: AppLocale;
    skillIds?: string[];
    activeToolIds?: ActiveToolSet;
    workingSession: InteractionSession;
  }): Promise<{
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] };
    state: AgentInteractionState;
    interaction: AgentInteraction;
  }>;
  resolveConversationModel(args: {
    draft: DraftResult;
    workingSession: InteractionSession;
    skillIds?: string[];
    allowBuildFromDraft: boolean;
  }): Promise<Record<string, unknown> | undefined>;
  startToolCall(tool: AgentToolName, input: Record<string, unknown>): AgentToolCall;
  completeToolCallSuccess(call: AgentToolCall, output?: unknown): void;
}

export function buildTurnContext(
  params: AgentRunInput,
  traceId: string,
  prepared: {
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
  },
): TurnContext {
  const startedAtMs = Date.now();
  return {
    traceId,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    params,
    locale: prepared.locale,
    orchestrationMode: prepared.orchestrationMode,
    modelInput: prepared.modelInput,
    sourceFormat: prepared.sourceFormat,
    autoAnalyze: prepared.autoAnalyze,
    analysisParameters: prepared.analysisParameters,
    skillIds: prepared.skillIds,
    activeSkillIds: prepared.activeSkillIds,
    noSkillMode: prepared.noSkillMode,
    hadExistingSession: prepared.hadExistingSession,
    activeToolIds: prepared.activeToolIds,
    sessionKey: prepared.sessionKey,
    session: prepared.workingSession,
    plan: prepared.plan,
    toolCalls: prepared.toolCalls,
  };
}
