import type { TurnContext, HandlerDeps } from '../agent-context.js';
import type { AgentRunResult, AgentNextStepPlan } from '../agent.js';
import type { DraftResult, DraftState } from '../../agent-runtime/index.js';
import type { AppLocale } from '../locale.js';
import { executeDraftModelInteractiveStep } from '../../agent-tools/builtin/draft-model.js';
import { handleDraft } from './draft.js';

export async function handleCollect(
  ctx: TurnContext,
  deps: HandlerDeps,
  nextPlan: AgentNextStepPlan,
): Promise<AgentRunResult> {
  const collectOnlyTextToModelDraft = async (
    message: string,
    existingState: DraftState | undefined,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<DraftResult> => {
    const extraction = await deps.extractDraftParameters(
      deps.llm,
      message,
      existingState,
      locale,
      skillIds,
    );
    return {
      inferredType: extraction.nextState.inferredType,
      missingFields: [...extraction.missing.critical],
      extractionMode: extraction.extractionMode,
      stateToPersist: extraction.nextState,
      structuralTypeMatch: extraction.structuralTypeMatch,
    };
  };

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
    textToModelDraft: collectOnlyTextToModelDraft,
    isGenericFallbackDraft: (d: any) => deps.isGenericFallbackDraft(d),
    applyDraftToSession: (ws: any, d: DraftResult, gfb: boolean, msg: string) => deps.applyDraftToSession(ws, d, gfb, msg),
  });

  const assessment = await deps.assessInteractionNeeds(ctx.session, ctx.locale, ctx.skillIds);

  if (assessment.criticalMissing.length === 0 && !genericFallbackDraft) {
    return handleDraft(ctx, deps, nextPlan);
  }

  if (ctx.sessionKey) {
    await deps.setInteractionSession(ctx.sessionKey, ctx.session);
  }

  if (genericFallbackDraft) {
    const missingFields = draft.missingFields.length > 0
      ? draft.missingFields
      : [deps.localize(ctx.locale, '关键结构参数', 'key structural parameters')];
    const intro = deps.buildGenericModelingIntro(ctx.locale, ctx.noSkillMode);
    const fallback = deps.localize(
      ctx.locale,
      `${intro.replace(/。$/, '')}，请先补充：${missingFields.join('、')}。`,
      `${intro.replace(/\.$/, '')}. Please provide: ${missingFields.join(', ')}.`,
    );
    const interaction = await deps.buildInteractionPayload(
      assessment,
      ctx.session,
      assessment.criticalMissing.length > 0 ? 'confirming' : 'collecting',
      ctx.locale,
      ctx.skillIds,
      ctx.activeToolIds,
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
      interaction,
      clarification: { missingFields, question: response },
      response,
    }, ctx.skillIds, ctx.session);
  }

  const interaction = await deps.buildInteractionPayload(
    assessment,
    ctx.session,
    assessment.criticalMissing.length > 0 ? 'confirming' : 'collecting',
    ctx.locale,
    ctx.skillIds,
    ctx.activeToolIds,
  );
  const fallback = deps.buildInteractionQuestion(interaction, ctx.locale);
  const question = await deps.renderInteractionResponse(
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
    needsModelInput: assessment.criticalMissing.length > 0,
    plan: ctx.plan,
    toolCalls: ctx.toolCalls,
    metrics: deps.buildMetrics(ctx.toolCalls),
    interaction,
    clarification: {
      missingFields: await deps.mapMissingFieldLabels(
        assessment.criticalMissing,
        ctx.locale,
        ctx.session.draft || { inferredType: 'unknown', updatedAt: ctx.session.updatedAt },
        ctx.skillIds,
      ),
      question,
    },
    response: question,
  }, ctx.skillIds, ctx.session);
}
