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

function localize(locale: AppLocale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function hasConcreteStructuralParameters(message: string): boolean {
  const text = message.toLowerCase();
  if (!/\d/.test(text)) {
    return false;
  }

  return [
    '跨度',
    '荷载',
    '层高',
    '简支',
    '悬臂',
    '梁',
    '框架',
    '支座',
    'beam',
    'frame',
    'column',
    'span',
    'load',
    'support',
    'story',
    'bay',
    'cantilever',
  ].some((pattern) => text.includes(pattern));
}

function hasAnalysisLikeExecutionIntent(message: string): boolean {
  const text = message.toLowerCase().trim();
  if (!text) {
    return false;
  }

  return [
    '执行分析',
    '开始分析',
    '运行分析',
    '直接分析',
    '开始计算',
    '运行计算',
    '执行计算',
    '开始求解',
    '运行求解',
    '分析这个模型',
    '设计',
    '算一下',
    '算一算',
    '验算',
    '校核',
    'run analysis',
    'start analysis',
    'perform analysis',
    'run the analysis',
    'analyze this model',
    'solve this model',
    'calculate the result',
    'design',
    'size',
    'sizing',
    'check this model',
  ].some((pattern) => text.includes(pattern));
}

function isExplicitModelOnlyRequest(message: string): boolean {
  const text = message.toLowerCase().trim();
  if (!text) {
    return false;
  }

  const modelOnlyPatterns = [
    '只建模',
    '仅建模',
    '只生成模型',
    '只出模型',
    '仅输出模型',
    'model only',
    'only model',
    'build a model',
    'draft a model',
    'create a model',
  ];
  if (modelOnlyPatterns.some((pattern) => text.includes(pattern))) {
    return true;
  }

  const modelPatterns = [
    '建模',
    '模型',
    '生成模型',
    '更新模型',
    'draft model',
    'build model',
    'create model',
    'update model',
    'structural model',
  ];
  return modelPatterns.some((pattern) => text.includes(pattern))
    && !hasAnalysisLikeExecutionIntent(text);
}

function normalizeExecuteTargetArtifact(
  message: string,
  normalized: Pick<AgentNextStepPlan, 'kind' | 'replyMode' | 'targetArtifact'>,
  availableToolIds: AgentToolName[],
  hasModel: boolean,
): Pick<AgentNextStepPlan, 'kind' | 'replyMode' | 'targetArtifact'> {
  if (normalized.kind !== 'execute' || normalized.targetArtifact !== 'normalizedModel') {
    return normalized;
  }

  if (!availableToolIds.includes('run_analysis')) {
    return normalized;
  }

  if (isExplicitModelOnlyRequest(message)) {
    return normalized;
  }

  if (hasAnalysisLikeExecutionIntent(message) && (hasConcreteStructuralParameters(message) || hasModel)) {
    return {
      ...normalized,
      targetArtifact: 'analysisRaw',
    };
  }

  return normalized;
}

function extractHttpStatus(error: unknown): number | undefined {
  const status = (error as any)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function stringifyError(error: unknown): string {
  const unknownError = error as any;
  const status = extractHttpStatus(error);
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

function sanitizePlannerErrorDetail(detail: string): string {
  const collapsed = detail.replace(/\s+/gu, ' ').trim();
  if (!collapsed) {
    return '';
  }
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}...` : collapsed;
}

function describeLlmPlannerError(error: unknown, locale: AppLocale): string {
  const status = extractHttpStatus(error);
  const raw = stringifyError(error);
  const normalizedRaw = sanitizePlannerErrorDetail(raw.replace(/^HTTP \d+:\s*/u, ''));
  const lowerRaw = normalizedRaw.toLowerCase();

  if (
    status === 403
    && (lowerRaw.includes('not available in your region') || lowerRaw.includes('model_not_available'))
  ) {
    return localize(locale, 'LLM 403 / 模型区域不可用', 'LLM 403 / model unavailable in your region');
  }
  if (status === 401) {
    return localize(locale, 'LLM 401 / API Key 无效或未授权', 'LLM 401 / invalid or unauthorized API key');
  }
  if (status === 429) {
    return localize(locale, 'LLM 429 / 请求限流或额度不足', 'LLM 429 / rate limited or quota exceeded');
  }
  if (typeof status === 'number') {
    return localize(
      locale,
      `LLM ${status} / ${normalizedRaw || '请求失败'}`,
      `LLM ${status} / ${normalizedRaw || 'request failed'}`,
    );
  }
  return normalizedRaw || localize(locale, 'LLM 不可用', 'LLM unavailable');
}

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
): Pick<AgentNextStepPlan, 'kind' | 'replyMode' | 'targetArtifact'> | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }

  const parsed = JSON.parse(jsonText) as {
    kind?: unknown;
    replyMode?: unknown;
    targetArtifact?: unknown;
    decision?: { kind?: unknown; replyMode?: unknown; targetArtifact?: unknown };
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
    targetArtifact: typeof payload.targetArtifact === 'string' ? payload.targetArtifact : undefined,
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
): Promise<Pick<AgentNextStepPlan, 'kind' | 'replyMode' | 'targetArtifact'> | null> {
  if (!llm) {
    return null;
  }

  const prompt = [
    'Normalize the following StructureClaw planner output into strict JSON.',
    'Do not add commentary. Return JSON only.',
    'Preserve the original intent. Only fix formatting or minor schema issues.',
    `Allowed kinds: ${options.allowedKinds.join(', ')}`,
    'Output schema:',
    `{"kind":"${options.allowedKinds.join('|')}","replyMode":"plain|structured|null","targetArtifact":"analysisRaw|codeCheckResult|reportArtifact|normalizedModel|null","reason":"short reason"}`,
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
    throw new Error(`LLM_PLANNER_UNAVAILABLE:${localize(options.locale, 'LLM 不可用', 'LLM unavailable')}`);
  }

  try {
    const snapshot = await buildPlannerContextSnapshot(options, assessInteractionNeeds);
    const allowedKinds: AgentPlanKind[] = Array.isArray(options.allowedKinds) && options.allowedKinds.length > 0
      ? options.allowedKinds
      : ['reply', 'ask', 'execute'];
    const allowExecute = allowedKinds.includes('execute');
    const availableToolIds = snapshot.availableToolIds.filter((toolId): toolId is AgentToolName => (
      ['draft_model', 'update_model', 'convert_model', 'validate_model', 'run_analysis', 'run_code_check', 'generate_report'] as string[]
    ).includes(toolId));
    const prompt = [
    'You are the planning layer for StructureClaw.',
    'Decide the single best next step for the latest user message.',
    'Available skills and tools constrain what can be invoked, but they do not force invocation.',
    'If the user is greeting, chatting casually, or asking a non-execution question, choose reply.',
    allowExecute
      ? 'Avoid execute for vague or exploratory messages, BUT when the user provides concrete structural parameters (dimensions, loads, materials) AND explicitly requests analysis, modeling, code checking, or calculation, ALWAYS choose execute with the appropriate targetArtifact.'
      : 'Execution is not allowed in this planning mode. Choose only reply or ask.',
    'When there is an active engineering session with missing parameters, and the latest user message adds structure type, geometry, topology, material, section, load, support, or report details, do not choose a plain reply.',
    'In that situation, choose ask so the structured engineering session continues, unless the information is now complete enough that a structured reply is clearly better.',
    'Treat short parameter fragments such as "钢框架结构体系", "每层3m", "x方向4跨", "Q355", or similar engineering increments as continuation turns, not casual chat.',
    'If the previous assistant message was asking for engineering parameters and the latest user message answers that request, continue the structured engineering session.',
    'If the user changes previously confirmed geometry, loads, supports, material, or section values, treat that as a model update request rather than a plain question.',
    'If there is an existing engineering session or model and the user says things like "改成", "改为", "change to", "update", or modifies previously analyzed values, prefer execute when execution is allowed.',
    'After a model update request, prefer execute when the user expects the updated model to be used immediately for analysis or refreshed engineering results.',
    'If the user explicitly asks to build, model, generate, or revise a structural model now, that can also justify execute even if the request is not yet an analysis execution request.',
    'In the current OpenSees workflow, when run_analysis is available and the user gives concrete structural parameters while asking to design, size, calculate, or check the structure, prefer targetArtifact="analysisRaw" unless the user explicitly asks for model-only output.',
    'An existing context model is only reusable context. It must not override the latest user request by itself.',
    'If the latest message clearly asks for a new or different structural model, choose execute even when an older context model already exists.',
    'For requests like "建模一个简支梁，跨度10m，均布荷载1kN/m，可以用10个单元建模", prefer execute when the information is sufficient to attempt a first structural model draft.',
    allowExecute
      ? 'Messages containing structural parameters AND analysis intent MUST produce kind=execute with targetArtifact="analysisRaw". Examples: "简支梁6米，均布荷载20kN/m，请进行静力分析", "2-story single-bay steel frame, story height 3.6m, bay 6m, floor load 10kN/m2, analyze and check", "门式刚架，跨度18m，高度7m，屋面荷载6kN/m，分析", "3层2跨框架，层高3.3m，跨度5.4m和6m，每层楼面荷载15kN/m，请分析".'
      : '',
    'Use replyMode=plain only for casual chat, greetings, meta questions, or clearly non-engineering turns.',
    'Use replyMode=structured for engineering follow-ups that should stay grounded in the current structural context without immediately invoking execution.',
    'Choose ask when the user is pursuing an engineering task but key information is still missing.',
    allowExecute
      ? 'Choose execute when the user is clearly asking to create/update a model now, or to execute/continue engineering execution now.'
      : 'Choose ask when more engineering details are needed before the next turn can proceed.',
    'If the user message looks like a parameter fragment or engineering follow-up, plain reply is almost always wrong.',
    'Use replyMode=structured only when a structural model already exists or the engineering draft is already ready and the best next step is to explain, summarize, or confirm readiness rather than ask or execute.',
    allowExecute
      ? 'When kind=execute, set targetArtifact to indicate which artifact the pipeline should produce:\n  - "analysisRaw" when the user wants structural analysis\n  - "codeCheckResult" when the user wants code compliance checking\n  - "reportArtifact" when the user wants a report\n  - "normalizedModel" when the user wants to create or update a structural model\n  - null when kind is not execute'
      : 'When execution is not allowed, choose only reply or ask.',
    'Return strict JSON only with this schema:',
    `{"kind":"${allowedKinds.join('|')}","replyMode":"plain|structured|null","targetArtifact":"analysisRaw|codeCheckResult|reportArtifact|normalizedModel|null","reason":"short reason"}`,
    `Locale: ${options.locale}`,
    `User message: ${message}`,
    `Planner context: ${JSON.stringify(snapshot)}`,
    ].join('\n');

    const aiMessage = await llm.invoke(prompt);
    const raw = typeof aiMessage.content === 'string'
      ? aiMessage.content
      : JSON.stringify(aiMessage.content);
    const normalized = parsePlannerResponse(raw, allowedKinds)
      || await repairPlannerResponse(llm, raw, {
        locale: options.locale,
        allowedKinds,
        availableToolIds,
      });
    if (!normalized) {
      throw new Error('LLM_PLANNER_INVALID_RESPONSE');
    }
    const resolvedPlan = normalizeExecuteTargetArtifact(message, normalized, availableToolIds, options.hasModel);
    return {
      kind: resolvedPlan.kind,
      replyMode: resolvedPlan.replyMode,
      targetArtifact: resolvedPlan.targetArtifact,
      planningDirective: 'auto',
      rationale: 'llm',
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'LLM_PLANNER_INVALID_RESPONSE') {
      throw error;
    }
    throw new Error(`LLM_PLANNER_UNAVAILABLE:${describeLlmPlannerError(error, options.locale)}`);
  }
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
): Promise<AgentNextStepPlan> {
  // --- targetArtifact inference (Phase 4 Step 3) ---
  // Report intent: user explicitly requested report
  if (options.session?.resolved?.includeReport) {
    return { kind: 'execute', planningDirective: 'auto', rationale: 'override', targetArtifact: 'reportArtifact' };
  }
  // Analysis intent: user has a model and an analysis type resolved
  if (options.hasModel && options.session?.resolved?.analysisType) {
    return { kind: 'execute', planningDirective: 'auto', rationale: 'override', targetArtifact: 'analysisRaw' };
  }
  // Code-check intent: design code resolved without report flag
  if (options.hasModel && options.session?.resolved?.designCode && !options.session?.resolved?.includeReport) {
    return { kind: 'execute', planningDirective: 'auto', rationale: 'override', targetArtifact: 'codeCheckResult' };
  }

  // --- existing logic, converted from string literals to full objects ---
  if (options.hasModel) {
    return { kind: 'reply', planningDirective: 'auto', rationale: 'override' };
  }
  if (hasEmptySkillSelection(options.skillIds) && !hasActiveTool(options.activeToolIds, 'draft_model')) {
    return { kind: 'reply', planningDirective: 'auto', rationale: 'override' };
  }
  if (!options.session?.draft || options.session.draft.inferredType === 'unknown') {
    return { kind: 'ask', planningDirective: 'auto', rationale: 'override' };
  }
  // Assess interaction readiness. When hasModel is false we always fall back to
  // 'ask' regardless of the assessment result — model building requires explicit
  // user confirmation before proceeding. When hasModel is true (reachable via the
  // early-return above at line 380), the assessment determines the final path.
  const assessment = await assessInteractionNeeds(options.session, options.locale, options.skillIds, 'interactive');
  const readyForExecution = assessment.criticalMissing.length === 0
    && (assessment.nonCriticalMissing.length === 0 || Boolean(options.session.userApprovedAutoDecide));
  // Safety guard: never auto-proceed without a model — always ask for confirmation first.
  if (!options.hasModel) {
    return { kind: 'ask', planningDirective: 'auto', rationale: 'override' };
  }
  return readyForExecution
    ? { kind: 'reply', planningDirective: 'auto', rationale: 'override' }
    : { kind: 'ask', planningDirective: 'auto', rationale: 'override' };
}

// ---------------------------------------------------------------------------
// inferTargetArtifact
// ---------------------------------------------------------------------------

function inferTargetArtifact(options: {
  session?: InteractionSession;
  hasModel: boolean;
  activeToolIds?: ActiveToolSet;
  forceExecution?: boolean;
}): string | undefined {
  // Always target the deepest analysis artifact, not reportArtifact.
  // Report is handled as a follow-up after the main pipeline completes.
  const autoCodeCheck = options.session?.resolved?.autoCodeCheck;
  const hasResolvedDesignCode = typeof options.session?.resolved?.designCode === 'string'
    && options.session.resolved.designCode.trim().length > 0;
  const codeCheckEnabled = autoCodeCheck === true
    || (autoCodeCheck !== false && hasResolvedDesignCode);
  // Only target codeCheckResult when run_code_check is still in the active tool set.
  const codeCheckToolActive = !options.activeToolIds || options.activeToolIds.has('run_code_check');
  const analysisToolActive = !options.activeToolIds || options.activeToolIds.has('run_analysis');

  if (options.hasModel || options.forceExecution) {
    if (codeCheckEnabled && codeCheckToolActive) {
      return 'codeCheckResult';
    }
    if (analysisToolActive) {
      return 'analysisRaw';
    }
    // run_analysis not available — fall back to draft-level target
    return 'normalizedModel';
  }
  return 'normalizedModel';
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

    const interactivePlan = await resolveInteractivePlanKind(options, assessInteractionNeeds, hasEmptySkillSelection, (ids, id) => !ids || ids.has(id));
    return {
      ...interactivePlan,
      replyMode: interactivePlan.replyMode ?? (options.hasModel ? 'structured' : 'plain'),
      planningDirective: options.planningDirective,
      rationale: 'override',
    };
  }

  if (options.planningDirective === 'force_tool') {
    return {
      kind: 'execute',
      targetArtifact: inferTargetArtifact({ ...options, forceExecution: true }),
      planningDirective: options.planningDirective,
      rationale: 'override',
    };
  }

  return planNextStepWithLlm(llm, message, options, assessInteractionNeeds);
}
