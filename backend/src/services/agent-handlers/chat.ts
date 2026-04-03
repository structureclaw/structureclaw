import type { TurnContext, HandlerDeps } from '../agent-context.js';
import type { AgentRunResult } from '../agent.js';

export async function handleChat(
  ctx: TurnContext,
  deps: HandlerDeps,
  opts: { fallback: string; planNote: string },
): Promise<AgentRunResult> {
  ctx.plan.push(opts.planNote);
  const response = await deps.renderDirectReply(
    ctx.params.message,
    opts.fallback,
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
    response,
  }, ctx.skillIds, ctx.session);
}
