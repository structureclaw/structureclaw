import type { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from './locale.js';
import type {
  AgentPlanKind,
  AgentPlanningDirective,
  AgentNextStepPlan,
  PlannerContextSnapshot,
  InteractionSession,
  ActiveToolSet,
  AgentToolName,
  InteractionDefaultProposal,
  AgentInteractionPhase,
} from './agent.js';
import { prisma } from '../utils/database.js';

// ---------------------------------------------------------------------------
// Callback signatures the caller must supply
// ---------------------------------------------------------------------------

export type AssessInteractionNeedsFn = (
  session: InteractionSession,
  locale: AppLocale,
  skillIds?: string[],
  phase?: AgentInteractionPhase,
) => Promise<{
  criticalMissing: string[];
  nonCriticalMissing: string[];
  defaultProposals: InteractionDefaultProposal[];
}>;

export type HasEmptySkillSelectionFn = (skillIds?: string[]) => boolean;
export type HasActiveToolFn = (activeToolIds: ActiveToolSet, toolId: string) => boolean;

// ---------------------------------------------------------------------------
// extractJsonObject
// ---------------------------------------------------------------------------

export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return candidate.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// parsePlannerResponse
// ---------------------------------------------------------------------------

export function parsePlannerResponse(
  raw: string,
  allowedKinds: AgentPlanKind[],
): Pick<AgentNextStepPlan, 'kind' | 'replyMode'> | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }

  const parsed = JSON.parse(jsonText) as {
    kind?: unknown;
    replyMode?: unknown;
    decision?: { kind?: unknown; replyMode?: unknown };
  };
  const payload = typeof parsed.decision === 'object' && parsed.decision !== null ? parsed.decision : parsed;

  if (typeof payload.kind !== 'string' || !allowedKinds.includes(payload.kind as AgentPlanKind)) {
    return null;
  }

  const kind = payload.kind as AgentPlanKind;
  const replyMode = kind === 'reply'
    ? (payload.replyMode === 'structured' ? 'structured' : 'plain')
    : undefined;
  return {
    kind,
    replyMode,
  };
}

// ---------------------------------------------------------------------------
// repairPlannerResponse
// ---------------------------------------------------------------------------

export async function repairPlannerResponse(
  llm: ChatOpenAI | null,
  raw: string,
  options: {
    locale: AppLocale;
    allowedKinds: AgentPlanKind[];
    availableToolIds: AgentToolName[];
  },
): Promise<Pick<AgentNextStepPlan, 'kind' | 'replyMode'> | null> {
  if (!llm) {
    return null;
  }

  const prompt = [
    'Normalize the following StructureClaw planner output into strict JSON.',
    'Do not add commentary. Return JSON only.',
    'Preserve the original intent. Only fix formatting or minor schema issues.',
    `Allowed kinds: ${options.allowedKinds.join(', ')}`,
    'Output schema:',
    `{"kind":"${options.allowedKinds.join('|')}","replyMode":"plain|structured|null","reason":"short reason"}`,
    `Locale: ${options.locale}`,
    `Planner output to normalize:\n${raw}`,
  ].join('\n');

  try {
    const repaired = await llm.invoke(prompt);
    const repairedRaw = typeof repaired.content === 'string'
      ? repaired.content
      : JSON.stringify(repaired.content);
    return parsePlannerResponse(repairedRaw, options.allowedKinds);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildPlannerContextSnapshot
// ---------------------------------------------------------------------------

export async function buildPlannerContextSnapshot(
  options: {
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
    conversationId?: string;
  },
  assessInteractionNeeds: AssessInteractionNeedsFn,
): Promise<PlannerContextSnapshot> {
  const assessment = options.session
    ? await assessInteractionNeeds(options.session, options.locale, options.skillIds, 'interactive')
    : undefined;
  let recentConversation: string[] = [];
  let lastAssistantMessage: string | undefined;

  if (options.conversationId) {
    try {
      const recentMessages = await prisma.message.findMany({
        where: { conversationId: options.conversationId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { role: true, content: true },
      });
      if (recentMessages.length > 0) {
        const orderedMessages = recentMessages.reverse();
        recentConversation = orderedMessages
          .map((message: { role: string; content: string }) => `${message.role}: ${message.content.slice(0, 240)}`);
        const assistantMessages = orderedMessages.filter(
          (message: { role: string; content: string }) => message.role === 'assistant',
        );
        lastAssistantMessage = assistantMessages.at(-1)?.content.slice(0, 320);
      }
    } catch {
      recentConversation = [];
      lastAssistantMessage = undefined;
    }
  }

  const readyForExecution = Boolean(
    assessment
    && assessment.criticalMissing.length === 0
    && (assessment.nonCriticalMissing.length === 0 || Boolean(options.session?.userApprovedAutoDecide)),
  );
  return {
    hasActiveSession: Boolean(options.session),
    hasModel: options.hasModel,
    inferredType: options.session?.draft?.inferredType ?? null,
    structuralTypeKey: options.session?.draft?.structuralTypeKey,
    criticalMissing: assessment?.criticalMissing ?? [],
    nonCriticalMissing: assessment?.nonCriticalMissing ?? [],
    readyForExecution,
    availableToolIds: [...(options.activeToolIds ?? new Set<string>())].sort(),
    skillIds: Array.isArray(options.skillIds) ? [...options.skillIds] : [],
    recentConversation,
    lastAssistantMessage,
    sessionState: options.session?.state,
  };
}

// ---------------------------------------------------------------------------
// planNextStepWithLlm
// ---------------------------------------------------------------------------

export async function planNextStepWithLlm(
  llm: ChatOpenAI | null,
  message: string,
  options: {
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
    allowedKinds?: AgentPlanKind[];
    conversationId?: string;
  },
  assessInteractionNeeds: AssessInteractionNeedsFn,
): Promise<AgentNextStepPlan> {
  if (!llm) {
    throw new Error('LLM_PLANNER_UNAVAILABLE');
  }

  const snapshot = await buildPlannerContextSnapshot(options, assessInteractionNeeds);
  const allowedKinds: AgentPlanKind[] = Array.isArray(options.allowedKinds) && options.allowedKinds.length > 0
    ? options.allowedKinds
    : ['reply', 'ask', 'tool_call'];
  const allowToolCall = allowedKinds.includes('tool_call');
  const availableToolIds = snapshot.availableToolIds.filter((toolId): toolId is AgentToolName => (
    ['draft_model', 'update_model', 'convert_model', 'validate_model', 'run_analysis', 'run_code_check', 'generate_report'] as string[]
  ).includes(toolId));
  const prompt = [
    'You are the planning layer for StructureClaw.',
    'Decide the single best next step for the latest user message.',
    'Available skills and tools constrain what can be invoked, but they do not force invocation.',
    'If the user is greeting, chatting casually, or asking a non-execution question, choose reply.',
    allowToolCall
      ? 'Do not choose tool_call just because drafting or analysis tools are available.'
      : 'Tool invocation is not allowed in this planning mode. Choose only reply or ask.',
    'When there is an active engineering session with missing parameters, and the latest user message adds structure type, geometry, topology, material, section, load, support, or report details, do not choose a plain reply.',
    'In that situation, choose ask so the structured engineering session continues, unless the information is now complete enough that a structured reply is clearly better.',
    'Treat short parameter fragments such as "钢框架结构体系", "每层3m", "x方 向4跨", "Q355", or similar engineering increments as continuation turns, not casual chat.',
    'If the previous assistant message was asking for engineering parameters and the latest user message answers that request, continue the structured engineering session.',
    'If the user changes previously confirmed geometry, loads, supports, material, or section values, treat that as a model update request rather than a plain question.',
    'If there is an existing engineering session or model and the user says things like "改成", "改为", "change to", "update", or modifies previously analyzed values, prefer tool_call when tool invocation is allowed.',
    'After a model update request, prefer tool_call when the user expects the updated model to be used immediately for analysis or refreshed engineering results.',
    'If the user explicitly asks to build, model, generate, or revise a structural model now, that can also justify tool_call even if the request is not yet an analysis execution request.',
    'An existing context model is only reusable context. It must not override the latest user request by itself.',
    'If the latest message clearly asks for a new or different structural model, choose tool_call even when an older context model already exists.',
    'For requests like "建模一个简支梁，跨度10m，均布荷载1kN/m，可以用10个单元建模", prefer tool_call when the information is sufficient to attempt a first structural model draft.',
    'Use replyMode=plain only for casual chat, greetings, meta questions, or clearly non-engineering turns.',
    'Use replyMode=structured for engineering follow-ups that should stay grounded in the current structural context without immediately invoking tools.',
    'Choose ask when the user is pursuing an engineering task but key information is still missing.',
    allowToolCall
      ? 'Choose tool_call when the user is clearly asking to create/update a model now, or to execute/continue engineering execution now.'
      : 'Choose ask when more engineering details are needed before the next turn can proceed.',
    'If the user message looks like a parameter fragment or engineering follow-up, plain reply is almost always wrong.',
    'Use replyMode=structured only when a structural model already exists or the engineering draft is already ready and the best next step is to explain, summarize, or confirm readiness rather than ask or execute.',
    allowToolCall
      ? `When kind=tool_call, do not choose concrete tools. The runtime will select tools from enabled capabilities: ${availableToolIds.join(', ') || 'none'}.`
      : 'When tool invocation is not allowed, choose only reply or ask.',
    'Return strict JSON only with this schema:',
    `{"kind":"${allowedKinds.join('|')}","replyMode":"plain|structured|null","reason":"short reason"}`,
    `Locale: ${options.locale}`,
    `User message: ${message}`,
    `Planner context: ${JSON.stringify(snapshot)}`,
  ].join('\n');

  let raw: string;
  try {
    const aiMessage = await llm.invoke(prompt);
    raw = typeof aiMessage.content === 'string'
      ? aiMessage.content
      : JSON.stringify(aiMessage.content);
  } catch {
    throw new Error('LLM_PLANNER_UNAVAILABLE');
  }

  const normalized = parsePlannerResponse(raw, allowedKinds)
    || await repairPlannerResponse(llm, raw, {
      locale: options.locale,
      allowedKinds,
      availableToolIds,
    });
  if (!normalized) {
    throw new Error('LLM_PLANNER_INVALID_RESPONSE');
  }
  return {
    kind: normalized.kind,
    replyMode: normalized.replyMode,
    planningDirective: 'auto',
    rationale: 'llm',
  };
}

// ---------------------------------------------------------------------------
// resolveInteractivePlanKind
// ---------------------------------------------------------------------------

export async function resolveInteractivePlanKind(
  options: {
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
  },
  assessInteractionNeeds: AssessInteractionNeedsFn,
  hasEmptySkillSelection: HasEmptySkillSelectionFn,
  hasActiveTool: HasActiveToolFn,
): Promise<Exclude<AgentPlanKind, 'tool_call'>> {
  if (options.hasModel) {
    return 'reply';
  }
  if (hasEmptySkillSelection(options.skillIds) && !hasActiveTool(options.activeToolIds, 'draft_model')) {
    return 'reply';
  }
  if (!options.session?.draft || options.session.draft.inferredType === 'unknown') {
    return 'ask';
  }
  const assessment = await assessInteractionNeeds(options.session, options.locale, options.skillIds, 'interactive');
  const readyForExecution = assessment.criticalMissing.length === 0
    && (assessment.nonCriticalMissing.length === 0 || Boolean(options.session.userApprovedAutoDecide));
  if (!options.hasModel) {
    return 'ask';
  }
  return readyForExecution ? 'reply' : 'ask';
}

// ---------------------------------------------------------------------------
// planNextStep
// ---------------------------------------------------------------------------

export async function planNextStep(
  llm: ChatOpenAI | null,
  message: string,
  options: {
    planningDirective: AgentPlanningDirective;
    allowToolCall: boolean;
    locale: AppLocale;
    skillIds?: string[];
    hasModel: boolean;
    session?: InteractionSession;
    activeToolIds?: ActiveToolSet;
    conversationId?: string;
  },
  assessInteractionNeeds: AssessInteractionNeedsFn,
  hasEmptySkillSelection: HasEmptySkillSelectionFn,
): Promise<AgentNextStepPlan> {
  if (hasEmptySkillSelection(options.skillIds) && options.planningDirective !== 'force_tool') {
    return {
      kind: 'reply',
      replyMode: 'plain',
      planningDirective: options.planningDirective,
      rationale: 'override',
    };
  }

  if (!options.allowToolCall) {
    if (llm) {
      return {
        ...(await planNextStepWithLlm(llm, message, {
          locale: options.locale,
          skillIds: options.skillIds,
          hasModel: options.hasModel,
          session: options.session,
          activeToolIds: options.activeToolIds,
          allowedKinds: ['reply', 'ask'],
          conversationId: options.conversationId,
        }, assessInteractionNeeds)),
        planningDirective: options.planningDirective,
      };
    }

    return {
      kind: await resolveInteractivePlanKind(options, assessInteractionNeeds, hasEmptySkillSelection, (ids, id) => !ids || ids.has(id)),
      replyMode: options.hasModel ? 'structured' : 'plain',
      planningDirective: options.planningDirective,
      rationale: 'override',
    };
  }

  if (options.planningDirective === 'force_tool') {
    return { kind: 'tool_call', planningDirective: options.planningDirective, rationale: 'override' };
  }

  return planNextStepWithLlm(llm, message, options, assessInteractionNeeds);
}
