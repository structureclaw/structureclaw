import type { TurnContext, HandlerDeps } from '../agent-context.js';
import type { AgentRunResult, AgentNextStepPlan } from '../agent.js';
import { executeDraftModelInteractiveStep } from '../../agent-tools/builtin/draft-model.js';

export async function handleDraft(
  ctx: TurnContext,
  deps: HandlerDeps,
  nextPlan: AgentNextStepPlan,
): Promise<AgentRunResult> {
  const { draft, genericFallbackDraft } = await executeDraftModelInteractiveStep({
    message: ctx.params.message,
    locale: ctx.locale,
    skillIds: ctx.skillIds,
    sessionKey: ctx.sessionKey,
    plan: ctx.plan,
    toolCalls: ctx.toolCalls,
    workingSession: ctx.session,
    startToolCall: (tool: any, input: any) => deps.startToolCall(tool, input),
    completeToolCallSuccess: (call: any, output: any) => deps.completeToolCallSuccess(call, output),
    textToModelDraft: (message: string, existingState: any, locale: any, skillIds?: string[]) => deps.textToModelDraft(message, existingState, locale, skillIds, ctx.params.conversationId),
    isGenericFallbackDraft: (draft: any) => deps.isGenericFallbackDraft(draft),
    applyDraftToSession: (ws: any, draft: any, gfb: boolean, msg: string) => deps.applyDraftToSession(ws, draft, gfb, msg),
  });

  if (genericFallbackDraft) {
    if (ctx.sessionKey) {
      await deps.setInteractionSession(ctx.sessionKey, ctx.session);
    }

    if (draft.model && nextPlan.kind !== 'ask') {
      return await buildGenericReplyResult(ctx, deps, draft);
    }
    return await buildGenericAskResult(ctx, deps, draft);
  }

  const resolved = await deps.resolveConversationAssessment({
    locale: ctx.locale,
    skillIds: ctx.skillIds,
    activeToolIds: ctx.activeToolIds,
    workingSession: ctx.session,
  });

  if (ctx.sessionKey) {
    await deps.setInteractionSession(ctx.sessionKey, ctx.session);
  }

  if (resolved.state === 'ready' && nextPlan.kind !== 'ask') {
    return buildStructuredReplyResult(ctx, deps, draft, resolved);
  }
  return buildStructuredAskResult(ctx, deps, draft, resolved);
}

async function buildGenericReplyResult(
  ctx: TurnContext,
  deps: HandlerDeps,
  draft: { model?: Record<string, unknown>; missingFields: string[] },
): Promise<AgentRunResult> {
  const assessment = await deps.assessInteractionNeeds(ctx.session, ctx.locale, ctx.skillIds);
  const interaction = await deps.buildInteractionPayload(
    assessment,
    ctx.session,
    'ready',
    ctx.locale,
    ctx.skillIds,
    ctx.activeToolIds,
  );
  const fallback = deps.localize(
    ctx.locale,
    '已根据当前输入生成结构模型 JSON，可直接触发分析工具。',
    'A structural model JSON has been generated from your input and is ready for analysis tools.',
  );
  const response = await deps.renderInteractionResponse(
    ctx.params.message,
    interaction,
    fallback,
    ctx.locale,
    ctx.sessionKey,
    ctx.skillIds,
  );

  if (draft.model) {
    ctx.session.latestModel = draft.model;
    ctx.session.updatedAt = Date.now();
  }
  return deps.finalizeRunResult(ctx.traceId, ctx.sessionKey, ctx.params.message, {
    traceId: ctx.traceId,
    startedAt: ctx.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - ctx.startedAtMs,
    success: true,
    orchestrationMode: ctx.orchestrationMode,
    needsModelInput: false,
    plan: ctx.plan,
    toolCalls: ctx.toolCalls,
    metrics: deps.buildMetrics(ctx.toolCalls),
    model: draft.model,
    interaction,
    response,
  }, ctx.skillIds, ctx.session);
}

async function buildGenericAskResult(
  ctx: TurnContext,
  deps: HandlerDeps,
  draft: { model?: Record<string, unknown>; missingFields: string[] },
): Promise<AgentRunResult> {
  const synchronizedModel = draft.model ?? ctx.session.latestModel ?? undefined;
  if (synchronizedModel) {
    ctx.session.latestModel = synchronizedModel;
    ctx.session.updatedAt = Date.now();
  }

  const assessment = await deps.assessInteractionNeeds(ctx.session, ctx.locale, ctx.skillIds);
  const interactionState = assessment.criticalMissing.length > 0 ? 'confirming' : 'collecting';
  const interaction = await deps.buildInteractionPayload(
    assessment,
    ctx.session,
    interactionState,
    ctx.locale,
    ctx.skillIds,
    ctx.activeToolIds,
  );

  const missingFields = draft.missingFields.length > 0
    ? draft.missingFields
    : [deps.localize(ctx.locale, '关键结构参数', 'key structural parameters')];
  const intro = deps.buildGenericModelingIntro(ctx.locale, ctx.noSkillMode);
  const fallback = deps.localize(
    ctx.locale,
    `${intro.replace(/。$/, '')}，请先补充：${missingFields.join('、')}。`,
    `${intro.replace(/\.$/, '')}. Please provide: ${missingFields.join(', ')}.`,
  );
  const response = await deps.renderInteractionResponse(
    ctx.params.message,
    interaction,
    fallback,
    ctx.locale,
    ctx.sessionKey,
    ctx.skillIds,
  );

  return deps.finalizeRunResult(ctx.traceId, ctx.sessionKey, ctx.params.message, {
    traceId: ctx.traceId,
    startedAt: ctx.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - ctx.startedAtMs,
    success: true,
    orchestrationMode: ctx.orchestrationMode,
    needsModelInput: true,
    plan: ctx.plan,
    toolCalls: ctx.toolCalls,
    metrics: deps.buildMetrics(ctx.toolCalls),
    model: synchronizedModel,
    interaction,
    clarification: { missingFields, question: response },
    response,
  }, ctx.skillIds, ctx.session);
}

async function buildStructuredReplyResult(
  ctx: TurnContext,
  deps: HandlerDeps,
  draft: { model?: Record<string, unknown>; missingFields: string[] },
  resolved: {
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[] };
    state: string;
    interaction: import('../agent.js').AgentInteraction;
  },
): Promise<AgentRunResult> {
  const synchronizedModel = await deps.resolveConversationModel({
    draft: draft as import('../../agent-runtime/index.js').DraftResult,
    workingSession: ctx.session,
    skillIds: ctx.skillIds,
    allowBuildFromDraft: true,
  });
  const fallback = deps.buildChatModeResponse(resolved.interaction, ctx.locale);
  const response = await deps.renderInteractionResponse(
    ctx.params.message,
    resolved.interaction,
    fallback,
    ctx.locale,
    ctx.sessionKey,
    ctx.skillIds,
  );

  return deps.finalizeRunResult(ctx.traceId, ctx.sessionKey, ctx.params.message, {
    traceId: ctx.traceId,
    startedAt: ctx.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - ctx.startedAtMs,
    success: true,
    orchestrationMode: ctx.orchestrationMode,
    needsModelInput: false,
    plan: ctx.plan,
    toolCalls: ctx.toolCalls,
    metrics: deps.buildMetrics(ctx.toolCalls),
    model: synchronizedModel,
    interaction: resolved.interaction,
    response,
  }, ctx.skillIds, ctx.session);
}

async function buildStructuredAskResult(
  ctx: TurnContext,
  deps: HandlerDeps,
  draft: { model?: Record<string, unknown>; missingFields: string[] },
  resolved: {
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[] };
    state: string;
    interaction: import('../agent.js').AgentInteraction;
  },
): Promise<AgentRunResult> {
  const allowBuild = resolved.assessment.criticalMissing.length === 0;
  const synchronizedModel = await deps.resolveConversationModel({
    draft: draft as import('../../agent-runtime/index.js').DraftResult,
    workingSession: ctx.session,
    skillIds: ctx.skillIds,
    allowBuildFromDraft: allowBuild,
  });
  const fallback = deps.buildChatModeResponse(resolved.interaction, ctx.locale);
  const response = await deps.renderInteractionResponse(
    ctx.params.message,
    resolved.interaction,
    fallback,
    ctx.locale,
    ctx.sessionKey,
    ctx.skillIds,
  );

  const needsModelInput = resolved.assessment.criticalMissing.length > 0;
  const questions = resolved.interaction.questions;
  return deps.finalizeRunResult(ctx.traceId, ctx.sessionKey, ctx.params.message, {
    traceId: ctx.traceId,
    startedAt: ctx.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - ctx.startedAtMs,
    success: true,
    orchestrationMode: ctx.orchestrationMode,
    needsModelInput,
    plan: ctx.plan,
    toolCalls: ctx.toolCalls,
    metrics: deps.buildMetrics(ctx.toolCalls),
    model: synchronizedModel,
    interaction: resolved.interaction,
    clarification: questions && questions.length > 0
      ? { missingFields: questions.map((q) => q.label), question: response }
      : undefined,
    response,
  }, ctx.skillIds, ctx.session);
}
