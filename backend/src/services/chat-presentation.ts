export type PresentationPhase = 'understanding' | 'modeling' | 'validation' | 'analysis' | 'report';
export type PresentationPhaseStatus = 'pending' | 'running' | 'done' | 'error';
export type PresentationStatus = 'streaming' | 'done' | 'error' | 'aborted';
type ArtifactName = 'model' | 'analysis' | 'report';

export interface TimelinePhaseGroup {
  phaseId: string;
  phase: PresentationPhase;
  title?: string;
  status: PresentationPhaseStatus;
  items: TimelineEventItem[];
  startedAt?: string;
  completedAt?: string;
}

export type TimelineEventItem =
  | {
      id: string;
      kind: 'phase_start';
      phase: PresentationPhase;
      status: 'running';
      title: string;
      createdAt?: string;
    }
  | {
      id: string;
      kind: 'skill_selected';
      phase?: PresentationPhase;
      status: 'done';
      skillId: string;
      title: string;
      reason?: string;
      createdAt?: string;
    }
  | {
      id: string;
      kind: 'skill_result';
      phase?: PresentationPhase;
      status: 'done' | 'error';
      skillId: string;
      title: string;
      summaryText?: string;
      resultSummary?: string;
      errorMessage?: string;
      createdAt?: string;
    }
  | {
      id: string;
      kind: 'tool_start';
      phase: PresentationPhase;
      status: 'running';
      tool: string;
      title: string;
      reason?: string;
      startedAt?: string;
    }
  | {
      id: string;
      kind: 'tool_result';
      phase: PresentationPhase;
      status: 'done' | 'error';
      tool: string;
      title: string;
      summaryText?: string;
      resultSummary?: string;
      errorMessage?: string;
      startedAt?: string;
      completedAt?: string;
      durationMs?: number;
    }
  | {
      id: string;
      kind: 'artifact_ready';
      phase: PresentationPhase;
      status: 'done';
      artifact: ArtifactName;
      title: string;
      summary?: string;
      previewable?: boolean;
      snapshotKey?: 'modelSnapshot' | 'resultSnapshot';
      createdAt?: string;
    }
  | {
      id: string;
      kind: 'clarification';
      phase: PresentationPhase;
      status: 'done';
      title: string;
      previewText?: string;
      explanationText?: string;
      rawUserFacingText?: string;
      missingCritical?: string[];
      missingOptional?: string[];
      question?: string;
      createdAt?: string;
    }
  | {
      id: string;
      kind: 'assistant_reply';
      phase: PresentationPhase;
      status: 'done';
      title: string;
      text: string;
      createdAt?: string;
    }
  | {
      id: string;
      kind: 'error';
      phase: PresentationPhase;
      status: 'error';
      title: string;
      message: string;
      retryable?: boolean;
      createdAt?: string;
    };

export interface ArtifactState {
  artifact: ArtifactName;
  status: 'pending' | 'available' | 'error';
  title: string;
  summary?: string;
  previewable?: boolean;
  snapshotKey?: 'modelSnapshot' | 'resultSnapshot';
}

export interface AssistantPresentation {
  version: 2;
  mode: 'conversation' | 'execution';
  status: PresentationStatus;
  summaryText: string;
  phases: TimelinePhaseGroup[];
  artifacts: ArtifactState[];
  traceId?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export type PresentationErrorItem = Extract<TimelineEventItem, { kind: 'error' }>;

export type PresentationEvent =
  | { type: 'phase_upsert'; phase: TimelinePhaseGroup }
  | { type: 'timeline_item_upsert'; phaseId: string; item: TimelineEventItem }
  | { type: 'artifact_upsert'; artifact: ArtifactState }
  | { type: 'summary_replace'; summaryText: string }
  | { type: 'presentation_complete'; completedAt: string }
  | { type: 'presentation_error'; error: PresentationErrorItem };

export interface PresentationToolCallLike {
  tool: string;
  status: 'success' | 'error';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  output?: unknown;
  error?: string;
  errorCode?: string;
}

export interface PresentationResultLike {
  response?: string;
  completedAt?: string;
  routing?: {
    selectedSkillIds?: string[];
    activatedSkillIds?: string[];
    structuralSkillId?: string;
    analysisSkillId?: string;
    analysisSkillIds?: string[];
    codeCheckSkillId?: string;
    validationSkillId?: string;
    reportSkillId?: string;
  };
  toolCalls?: PresentationToolCallLike[];
  model?: Record<string, unknown>;
  analysis?: unknown;
  codeCheck?: unknown;
  report?: {
    summary?: string;
    json?: Record<string, unknown>;
    markdown?: string;
  };
  interaction?: {
    state?: string;
    stage?: string;
    turnId?: string;
    missingCritical?: string[];
    missingOptional?: string[];
  };
  clarification?: {
    missingFields?: string[];
    question?: string;
  };
  success?: boolean;
}

const PHASE_ORDER: PresentationPhase[] = ['understanding', 'modeling', 'validation', 'analysis', 'report'];

export function buildPhaseId(phase: PresentationPhase): string {
  return `phase:${phase}`;
}

export function phaseFromPhaseId(phaseId: string): PresentationPhase {
  for (const phase of PHASE_ORDER) {
    if (phaseId.includes(phase)) {
      return phase;
    }
  }
  return 'modeling';
}

export function createEmptyAssistantPresentation(args: {
  traceId?: string;
  mode: 'conversation' | 'execution';
  startedAt?: string;
}): AssistantPresentation {
  return {
    version: 2,
    mode: args.mode,
    status: 'streaming',
    summaryText: '',
    phases: [],
    artifacts: [],
    traceId: args.traceId,
    startedAt: args.startedAt,
  };
}

export function reducePresentationEvent(
  state: AssistantPresentation,
  event: PresentationEvent,
): AssistantPresentation {
  switch (event.type) {
    case 'phase_upsert':
      return {
        ...state,
        phases: upsertPhase(state.phases, event.phase),
      };
    case 'timeline_item_upsert':
      return {
        ...state,
        phases: upsertTimelineItem(state.phases, event.phaseId, event.item),
      };
    case 'artifact_upsert':
      return {
        ...state,
        artifacts: upsertArtifact(state.artifacts, event.artifact),
      };
    case 'summary_replace':
      return {
        ...state,
        summaryText: event.summaryText,
      };
    case 'presentation_complete':
      return {
        ...state,
        status: 'done',
        completedAt: event.completedAt,
        phases: state.phases.map((phase) => phase.status === 'error'
          ? phase
          : {
              ...phase,
              status: 'done',
              completedAt: phase.completedAt ?? event.completedAt,
            }),
      };
    case 'presentation_error': {
      const phaseId = buildPhaseId(event.error.phase);
      const nextPhases = upsertTimelineItem(state.phases, phaseId, event.error);
      return {
        ...state,
        status: 'error',
        errorMessage: event.error.message,
        completedAt: event.error.createdAt ?? state.completedAt,
        phases: nextPhases.map((phase) => phase.phaseId === phaseId
          ? {
              ...phase,
              status: 'error',
              completedAt: phase.completedAt ?? event.error.createdAt ?? state.completedAt,
            }
          : phase),
      };
    }
  }
}

export function buildCompletedAssistantPresentation(args: {
  base?: AssistantPresentation;
  result: PresentationResultLike;
  mode: 'conversation' | 'execution';
  locale?: 'en' | 'zh';
  traceId?: string;
  startedAt?: string;
}): AssistantPresentation {
  const locale = args.locale ?? 'en';
  let presentation = args.base || createEmptyAssistantPresentation({
    traceId: args.traceId,
    mode: args.mode,
    startedAt: args.startedAt,
  });

  const routing = args.result.routing;
  const selectedSkillIds = uniqueStrings(routing?.selectedSkillIds);
  const phaseSignals = buildPhaseSignals(args.result);

  for (const signal of phaseSignals) {
    presentation = reducePresentationEvent(presentation, {
      type: 'phase_upsert',
      phase: signal,
    });
  }

  for (const skillId of selectedSkillIds) {
    const phase = phaseForSkillId(skillId, routing);
    presentation = appendItem(
      presentation,
      phase,
      {
        id: `skill-selected:${skillId}`,
        kind: 'skill_selected',
        phase,
        status: 'done',
        skillId,
        title: locale === 'zh' ? `已选择技能: ${skillId}` : `Skill selected: ${skillId}`,
        createdAt: args.result.completedAt,
      },
    );
  }

  for (const call of args.result.toolCalls || []) {
    const phase = phaseForToolCall(call.tool);
    const skillId = skillIdForToolCall(call.tool, routing);
    const startedAt = call.startedAt;
    const completedAt = call.completedAt ?? call.startedAt;

    presentation = reducePresentationEvent(presentation, {
      type: 'phase_upsert',
      phase: {
        phaseId: buildPhaseId(phase),
        phase,
        title: phaseTitle(phase, locale),
        status: call.status === 'error' ? 'error' : 'done',
        items: [],
        startedAt: call.startedAt,
        completedAt: call.completedAt,
      },
    });

      presentation = appendItem(presentation, phase, {
        id: `tool:${call.tool}:${startedAt}`,
        kind: 'tool_start',
        phase,
        status: 'running',
        tool: call.tool,
        title: toolStartTitle(call.tool, locale),
        reason: call.errorCode,
        startedAt,
      });

    presentation = appendItem(presentation, phase, {
      id: `tool:${call.tool}:${startedAt}`,
      kind: 'tool_result',
        phase,
        status: call.status === 'error' ? 'error' : 'done',
        tool: call.tool,
        title: call.status === 'error'
          ? toolErrorTitle(call.tool, locale)
          : toolDoneTitle(call.tool, locale),
        summaryText: summarizeToolOutput(call.output, locale),
        resultSummary: summarizeToolOutput(call.output, locale),
        errorMessage: call.error,
        startedAt,
        completedAt,
        durationMs: call.durationMs,
      });

    if (skillId) {
      presentation = appendItem(presentation, phase, {
        id: `skill-result:${skillId}:${completedAt}`,
        kind: 'skill_result',
        phase,
        status: call.status === 'error' ? 'error' : 'done',
        skillId,
        title: call.status === 'error'
          ? skillErrorTitle(skillId, locale)
          : skillDoneTitle(skillId, locale),
        summaryText: call.status === 'error'
          ? call.error
          : summarizeToolOutput(call.output, locale),
        resultSummary: call.status === 'error'
          ? call.error
          : summarizeToolOutput(call.output, locale),
        errorMessage: call.error,
        createdAt: completedAt,
      });
    }

    const artifact = artifactFromToolCall(call, args.result);
    if (artifact) {
      presentation = reducePresentationEvent(presentation, {
        type: 'artifact_upsert',
        artifact: artifact.state,
      });
        presentation = appendItem(presentation, artifact.phase, {
          id: `artifact-ready:${artifact.state.artifact}`,
          kind: 'artifact_ready',
          phase: artifact.phase,
          status: 'done',
          artifact: artifact.state.artifact,
          title: artifactTitle(artifact.state.artifact, locale),
          summary: artifact.state.summary,
          previewable: artifact.state.previewable,
          snapshotKey: artifact.state.snapshotKey,
          createdAt: completedAt,
        });
    }
  }

  const clarificationPhase = resultClarificationPhase(args.result);
  const clarificationText = args.result.clarification?.question?.trim();
  if (clarificationPhase && clarificationText) {
      presentation = appendItem(presentation, clarificationPhase, {
        id: `clarification:${args.result.completedAt ?? 'result'}`,
        kind: 'clarification',
        phase: clarificationPhase,
        status: 'done',
        title: locale === 'zh' ? '需要补充信息' : 'Need more details',
        previewText: clarificationText,
        explanationText: args.result.response?.trim() || undefined,
        rawUserFacingText: clarificationText,
        missingCritical: args.result.clarification?.missingFields,
        question: args.result.clarification?.question,
      createdAt: args.result.completedAt,
    });
  }

  const replyPhase = resultReplyPhase(args.result);
  const replyText = args.result.response?.trim();
  if (replyText) {
      presentation = appendItem(presentation, replyPhase, {
        id: `assistant-reply:${args.result.completedAt ?? replyText}`,
        kind: 'assistant_reply',
        phase: replyPhase,
        status: 'done',
        title: locale === 'zh' ? '助手回复' : 'Assistant reply',
        text: replyText,
        createdAt: args.result.completedAt,
      });
  }

  if (args.result.response?.trim()) {
    presentation = reducePresentationEvent(presentation, {
      type: 'summary_replace',
      summaryText: args.result.response.trim(),
    });
  }

  return reducePresentationEvent(presentation, {
    type: 'presentation_complete',
    completedAt: args.result.completedAt ?? new Date().toISOString(),
  });
}

function buildPhaseSignals(result: PresentationResultLike): TimelinePhaseGroup[] {
  const phases = new Map<PresentationPhase, TimelinePhaseGroup>();

  const addPhase = (phase: PresentationPhase, status: PresentationPhaseStatus = 'running') => {
    const phaseId = buildPhaseId(phase);
    const current = phases.get(phase);
    if (!current) {
      phases.set(phase, {
        phaseId,
        phase,
        title: phaseTitle(phase),
        status,
        items: [],
      });
      return;
    }
    phases.set(phase, {
      ...current,
      status: current.status === 'error' ? 'error' : status,
    });
  };

  for (const phase of phasesFromRouting(result.routing)) {
    addPhase(phase);
  }
  for (const call of result.toolCalls || []) {
    addPhase(phaseForToolCall(call.tool), call.status === 'error' ? 'error' : 'running');
  }
  const clarificationPhase = resultClarificationPhase(result);
  if (clarificationPhase) {
    addPhase(clarificationPhase);
  }
  const replyPhase = resultReplyPhase(result);
  if (replyPhase) {
    addPhase(replyPhase);
  }

  return orderedPhases([...phases.values()]);
}

function phasesFromRouting(routing: PresentationResultLike['routing']): PresentationPhase[] {
  if (!routing) {
    return [];
  }

  const phases: PresentationPhase[] = [];
  if (routing.structuralSkillId || uniqueStrings(routing.selectedSkillIds).length > 0) {
    phases.push('modeling');
  }
  if (routing.validationSkillId) {
    phases.push('validation');
  }
  if (routing.analysisSkillId || uniqueStrings(routing.analysisSkillIds).length > 0 || routing.codeCheckSkillId) {
    phases.push('analysis');
  }
  if (routing.reportSkillId) {
    phases.push('report');
  }
  return Array.from(new Set(phases));
}

function resultClarificationPhase(result: PresentationResultLike): PresentationPhase | undefined {
  if (!result.clarification?.question) {
    return undefined;
  }
  if (result.interaction?.state === 'collecting') {
    return 'understanding';
  }
  if (result.interaction?.state === 'confirming' || result.interaction?.state === 'blocked') {
    return 'modeling';
  }
  return 'understanding';
}

function resultReplyPhase(result: PresentationResultLike): PresentationPhase {
  if (result.report || result.toolCalls?.some((call) => call.tool === 'generate_report')) {
    return 'report';
  }
  if (result.analysis || result.toolCalls?.some((call) => call.tool === 'run_analysis' || call.tool === 'run_code_check')) {
    return 'analysis';
  }
  if (result.model || result.toolCalls?.some((call) => call.tool === 'draft_model' || call.tool === 'update_model' || call.tool === 'convert_model')) {
    return 'modeling';
  }
  return 'understanding';
}

function phaseForSkillId(skillId: string, routing?: PresentationResultLike['routing']): PresentationPhase {
  if (skillId === routing?.validationSkillId) {
    return 'validation';
  }
  if (skillId === routing?.analysisSkillId || uniqueStrings(routing?.analysisSkillIds).includes(skillId) || skillId === routing?.codeCheckSkillId) {
    return 'analysis';
  }
  if (skillId === routing?.reportSkillId) {
    return 'report';
  }
  return 'modeling';
}

function skillIdForToolCall(tool: string, routing?: PresentationResultLike['routing']): string | undefined {
  if (tool === 'draft_model' || tool === 'update_model' || tool === 'convert_model') {
    return routing?.structuralSkillId;
  }
  if (tool === 'validate_model') {
    return routing?.validationSkillId;
  }
  if (tool === 'run_analysis' || tool === 'run_code_check') {
    return routing?.analysisSkillId || uniqueStrings(routing?.analysisSkillIds)[0] || routing?.codeCheckSkillId;
  }
  if (tool === 'generate_report') {
    return routing?.reportSkillId;
  }
  return undefined;
}

function phaseForToolCall(tool: string): PresentationPhase {
  if (tool === 'validate_model') {
    return 'validation';
  }
  if (tool === 'run_analysis' || tool === 'run_code_check') {
    return 'analysis';
  }
  if (tool === 'generate_report') {
    return 'report';
  }
  return 'modeling';
}

function artifactFromToolCall(
  call: PresentationToolCallLike,
  result: PresentationResultLike,
): { phase: PresentationPhase; state: ArtifactState } | undefined {
  if (call.tool === 'draft_model' || call.tool === 'update_model' || call.tool === 'convert_model') {
    return {
      phase: 'modeling',
      state: {
        artifact: 'model',
        status: 'available',
        title: 'Structural model',
        summary: 'The model is ready for review',
        previewable: true,
        snapshotKey: 'modelSnapshot',
      },
    };
  }
  if (call.tool === 'run_analysis' || call.tool === 'run_code_check') {
    return {
      phase: 'analysis',
      state: {
        artifact: 'analysis',
        status: 'available',
        title: 'Analysis results',
        summary: 'Analysis results are available',
        previewable: true,
        snapshotKey: 'resultSnapshot',
      },
    };
  }
  if (call.tool === 'generate_report') {
    return {
      phase: 'report',
      state: {
        artifact: 'report',
        status: 'available',
        title: 'Report',
        summary: 'Report content is available',
        previewable: true,
      },
    };
  }
  if (result.report) {
    return {
      phase: 'report',
      state: {
        artifact: 'report',
        status: 'available',
        title: 'Report',
        summary: 'Report content is available',
        previewable: true,
      },
    };
  }
  if (result.analysis || result.codeCheck) {
    return {
      phase: 'analysis',
      state: {
        artifact: 'analysis',
        status: 'available',
        title: 'Analysis results',
        summary: 'Analysis results are available',
        previewable: true,
        snapshotKey: 'resultSnapshot',
      },
    };
  }
  if (result.model) {
    return {
      phase: 'modeling',
      state: {
        artifact: 'model',
        status: 'available',
        title: 'Structural model',
        summary: 'The model is ready for review',
        previewable: true,
        snapshotKey: 'modelSnapshot',
      },
    };
  }
  return undefined;
}

function appendItem(
  presentation: AssistantPresentation,
  phase: PresentationPhase,
  item: TimelineEventItem,
): AssistantPresentation {
  return reducePresentationEvent(presentation, {
    type: 'timeline_item_upsert',
    phaseId: buildPhaseId(phase),
    item,
  });
}

function upsertPhase(
  phases: TimelinePhaseGroup[],
  nextPhase: TimelinePhaseGroup,
): TimelinePhaseGroup[] {
  const normalized = normalizePhaseGroup(nextPhase);
  const index = phases.findIndex((phase) => phase.phaseId === normalized.phaseId);
  if (index === -1) {
    return insertPhaseOrdered(phases, normalized);
  }

  const nextPhases = [...phases];
  nextPhases[index] = mergePhaseGroups(nextPhases[index], normalized);
  return orderedPhases(nextPhases);
}

function upsertTimelineItem(
  phases: TimelinePhaseGroup[],
  phaseId: string,
  item: TimelineEventItem,
): TimelinePhaseGroup[] {
  const phase = phaseFromPhaseId(phaseId);
  const index = phases.findIndex((entry) => entry.phaseId === phaseId);
  if (index === -1) {
    return insertPhaseOrdered(phases, {
      phaseId,
      phase,
      title: phaseTitle(phase),
      status: item.kind === 'error' ? 'error' : 'running',
      items: [item],
    });
  }

  const nextPhases = [...phases];
  const current = nextPhases[index];
  const itemIndex = current.items.findIndex((existing) => existing.id === item.id);
  const nextItems = itemIndex === -1
    ? [...current.items, item]
    : current.items.map((existing, currentIndex) => currentIndex === itemIndex ? item : existing);
  nextPhases[index] = {
    ...current,
    phase,
    status: current.status === 'error' || item.kind === 'error'
      ? 'error'
      : current.status === 'done'
        ? 'done'
        : current.status,
    items: nextItems,
  };
  return orderedPhases(nextPhases);
}

function upsertArtifact(items: ArtifactState[], nextArtifact: ArtifactState): ArtifactState[] {
  const index = items.findIndex((item) => item.artifact === nextArtifact.artifact);
  if (index === -1) {
    return [...items, nextArtifact];
  }

  const nextItems = [...items];
  nextItems[index] = nextArtifact;
  return nextItems;
}

function normalizePhaseGroup(phase: TimelinePhaseGroup): TimelinePhaseGroup {
  return {
    ...phase,
    phaseId: phase.phaseId || buildPhaseId(phase.phase),
    phase: phase.phase,
    status: phase.status,
    items: Array.isArray(phase.items) ? phase.items : [],
  };
}

function mergePhaseGroups(existing: TimelinePhaseGroup, next: TimelinePhaseGroup): TimelinePhaseGroup {
  const mergedItems = next.items.length > 0
    ? next.items.reduce<TimelineEventItem[]>((items, item) => upsertItem(items, item), existing.items)
    : existing.items;
  return {
    ...existing,
    ...next,
    items: mergedItems,
  };
}

function upsertItem(items: TimelineEventItem[], item: TimelineEventItem): TimelineEventItem[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) {
    return [...items, item];
  }

  const nextItems = [...items];
  nextItems[index] = item;
  return nextItems;
}

function insertPhaseOrdered(
  phases: TimelinePhaseGroup[],
  nextPhase: TimelinePhaseGroup,
): TimelinePhaseGroup[] {
  const next = [...phases, nextPhase];
  return orderedPhases(next);
}

function orderedPhases(phases: TimelinePhaseGroup[]): TimelinePhaseGroup[] {
  return [...phases].sort((left, right) => {
    const leftIndex = PHASE_ORDER.indexOf(left.phase);
    const rightIndex = PHASE_ORDER.indexOf(right.phase);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.phaseId.localeCompare(right.phaseId);
  });
}

function uniqueStrings(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function phaseTitle(phase: PresentationPhase, locale: 'en' | 'zh' = 'en'): string {
  const zh: Record<PresentationPhase, string> = {
    understanding: '澄清阶段',
    modeling: '建模阶段',
    validation: '校验阶段',
    analysis: '分析阶段',
    report: '报告阶段',
  };
  const en: Record<PresentationPhase, string> = {
    understanding: 'Understanding',
    modeling: 'Modeling',
    validation: 'Validation',
    analysis: 'Analysis',
    report: 'Report',
  };
  return locale === 'zh' ? zh[phase] : en[phase];
}

function skillDoneTitle(skillId: string, locale: 'en' | 'zh'): string {
  return locale === 'zh' ? `技能 ${skillId} 完成` : `Skill ${skillId} completed`;
}

function skillErrorTitle(skillId: string, locale: 'en' | 'zh'): string {
  return locale === 'zh' ? `技能 ${skillId} 失败` : `Skill ${skillId} failed`;
}

function skillPhaseTitle(skillId: string, locale: 'en' | 'zh'): string {
  return locale === 'zh' ? `技能 ${skillId}` : `Skill ${skillId}`;
}

function toolStartTitle(tool: string, locale: 'en' | 'zh'): string {
  if (tool === 'draft_model' || tool === 'update_model' || tool === 'convert_model') {
    return locale === 'zh' ? '开始生成结构模型' : 'Starting structural model generation';
  }
  if (tool === 'validate_model') {
    return locale === 'zh' ? '开始校验模型' : 'Starting model validation';
  }
  if (tool === 'run_analysis' || tool === 'postprocess_result' || tool === 'run_code_check') {
    return locale === 'zh' ? '开始执行分析' : 'Starting analysis';
  }
  if (tool === 'generate_report') {
    return locale === 'zh' ? '开始生成报告' : 'Starting report generation';
  }
  return locale === 'zh' ? `开始执行 ${tool}` : `Starting ${tool}`;
}

function toolDoneTitle(tool: string, locale: 'en' | 'zh'): string {
  if (tool === 'draft_model' || tool === 'update_model' || tool === 'convert_model') {
    return locale === 'zh' ? '结构模型已生成' : 'Structural model generated';
  }
  if (tool === 'validate_model') {
    return locale === 'zh' ? '模型校验完成' : 'Model validation completed';
  }
  if (tool === 'run_analysis' || tool === 'postprocess_result' || tool === 'run_code_check') {
    return locale === 'zh' ? '分析执行完成' : 'Analysis completed';
  }
  if (tool === 'generate_report') {
    return locale === 'zh' ? '报告已生成' : 'Report generated';
  }
  return locale === 'zh' ? `${tool} 已完成` : `${tool} completed`;
}

function toolErrorTitle(tool: string, locale: 'en' | 'zh'): string {
  if (tool === 'draft_model' || tool === 'update_model' || tool === 'convert_model') {
    return locale === 'zh' ? '结构模型生成失败' : 'Structural model generation failed';
  }
  if (tool === 'validate_model') {
    return locale === 'zh' ? '模型校验失败' : 'Model validation failed';
  }
  if (tool === 'run_analysis' || tool === 'postprocess_result' || tool === 'run_code_check') {
    return locale === 'zh' ? '分析执行失败' : 'Analysis failed';
  }
  if (tool === 'generate_report') {
    return locale === 'zh' ? '报告生成失败' : 'Report generation failed';
  }
  return locale === 'zh' ? `${tool} 执行失败` : `${tool} failed`;
}

function artifactTitle(artifact: ArtifactName, locale: 'en' | 'zh'): string {
  const zh: Record<ArtifactName, string> = {
    model: '结构模型',
    analysis: '分析结果',
    report: '报告',
  };
  const en: Record<ArtifactName, string> = {
    model: 'Structural model',
    analysis: 'Analysis results',
    report: 'Report',
  };
  return locale === 'zh' ? zh[artifact] : en[artifact];
}

function summarizeToolOutput(output: unknown, locale: 'en' | 'zh'): string | undefined {
  if (!output || typeof output !== 'object') {
    return undefined;
  }
  if (Array.isArray(output)) {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  if (record.summary && typeof record.summary === 'string') {
    return record.summary;
  }
  if (record.message && typeof record.message === 'string') {
    return record.message;
  }
  if (record.model || record.analysis || record.report) {
    return locale === 'zh' ? '结果已生成' : 'Result generated';
  }
  return undefined;
}
