import type { TurnContext, HandlerDeps } from '../agent-context.js';
import type { AgentRunResult, AgentNextStepPlan } from '../agent.js';

// The execution pipeline is currently implemented as methods on AgentService
// (ensureExecutableModel, prepareExecutionModel, validateExecutionModel,
// runExecutionPipeline, etc.) and will be extracted here in a future pass.
// For now, this file serves as the handler boundary for the 'execute' route.
export async function handleExecute(
  _ctx: TurnContext,
  _deps: HandlerDeps,
  _nextPlan: AgentNextStepPlan,
): Promise<AgentRunResult> {
  throw new Error('Execute handler delegation not yet wired; use AgentService.runInternal tool_call path directly');
}
