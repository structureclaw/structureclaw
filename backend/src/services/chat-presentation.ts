export type PresentationPhase = 'understanding' | 'modeling' | 'validation' | 'analysis' | 'report';
export type PresentationPhaseStatus = 'pending' | 'running' | 'done' | 'error';
export type PresentationStatus = 'streaming' | 'done' | 'error' | 'aborted';
type ArtifactName = 'model' | 'analysis' | 'report';

// --- TimelineStepItem: one step = one tool execution ---

export interface TimelineStepItem {
  id: string;
  phase: PresentationPhase;
  status: 'running' | 'done' | 'error';
  tool: string;
  skillId?: string;
  title: string;
  args?: Record<string, unknown>;
  reason?: string;
  output?: unknown;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

// --- Phase group ---

export interface TimelinePhaseGroup {
  phaseId: string;
  phase: PresentationPhase;
  title?: string;
  status: PresentationPhaseStatus;
  steps: TimelineStepItem[];
  startedAt?: string;
  completedAt?: string;
}

// --- Artifact state (for preview tracking) ---

export interface ArtifactState {
  artifact: ArtifactName;
  status: 'pending' | 'available' | 'error';
  title: string;
  summary?: string;
  previewable?: boolean;
  snapshotKey?: 'modelSnapshot' | 'resultSnapshot';
}

// --- Presentation ---

export interface AssistantPresentation {
  version: 3;
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

// --- Events ---

export type PresentationEvent =
  | { type: 'phase_upsert'; phase: TimelinePhaseGroup }
  | { type: 'step_upsert'; phaseId: string; step: TimelineStepItem }
  | { type: 'artifact_upsert'; artifact: ArtifactState }
  | { type: 'summary_replace'; summaryText: string }
  | { type: 'presentation_complete'; completedAt: string }
  | { type: 'presentation_error'; phase: PresentationPhase; message: string; createdAt?: string };

// --- Result types (for rebuild from AgentResult) ---

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

// --- Constants ---

const PHASE_ORDER: PresentationPhase[] = ['understanding', 'modeling', 'validation', 'analysis', 'report'];

// --- Public helpers ---

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
    version: 3,
    mode: args.mode,
    status: 'streaming',
    summaryText: '',
    phases: [],
    artifacts: [],
    traceId: args.traceId,
    startedAt: args.startedAt,
  };
}

// --- Reducer ---

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
    case 'step_upsert':
      return {
        ...state,
        phases: upsertStep(state.phases, event.phaseId, event.step),
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
              status: 'done' as const,
              completedAt: phase.completedAt ?? event.completedAt,
            }),
      };
    case 'presentation_error': {
      const phaseId = buildPhaseId(event.phase);
      const existingPhaseIdx = state.phases.findIndex((p) => p.phaseId === phaseId);
      let nextPhases: TimelinePhaseGroup[];
      if (existingPhaseIdx === -1) {
        nextPhases = insertPhaseOrdered(state.phases, {
          phaseId,
          phase: event.phase,
          title: phaseTitle(event.phase),
          status: 'error',
          steps: [],
          completedAt: event.createdAt,
        });
      } else {
        nextPhases = [...state.phases];
        nextPhases[existingPhaseIdx] = {
          ...nextPhases[existingPhaseIdx],
          status: 'error',
          completedAt: nextPhases[existingPhaseIdx].completedAt ?? event.createdAt,
        };
      }
      return {
        ...state,
        status: 'error',
        errorMessage: event.message,
        completedAt: event.createdAt ?? state.completedAt,
        phases: nextPhases,
      };
    }
  }
}

// --- Rebuild from result ---

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

  // Create phase groups
  const phaseSignals = buildPhaseSignals(args.result);
  for (const signal of phaseSignals) {
    presentation = reducePresentationEvent(presentation, {
      type: 'phase_upsert',
      phase: signal,
    });
  }

  // One step per tool call
  for (const call of args.result.toolCalls || []) {
    const phase = phaseForToolCall(call.tool);
    presentation = reducePresentationEvent(presentation, {
      type: 'phase_upsert',
      phase: {
        phaseId: buildPhaseId(phase),
        phase,
        title: phaseTitle(phase, locale),
        status: call.status === 'error' ? 'error' : 'done',
        steps: [],
        startedAt: call.startedAt,
        completedAt: call.completedAt,
      },
    });

    presentation = reducePresentationEvent(presentation, {
      type: 'step_upsert',
      phaseId: buildPhaseId(phase),
      step: {
        id: `step:${call.tool}:${call.startedAt}`,
        phase,
        status: call.status === 'error' ? 'error' : 'done',
        tool: call.tool,
        skillId: skillIdForToolCall(call.tool, routing) || undefined,
        title: call.status === 'error'
          ? toolErrorTitle(call.tool, locale)
          : toolDoneTitle(call.tool, locale),
        reason: call.errorCode,
        output: call.output,
        errorMessage: call.error,
        startedAt: call.startedAt,
        completedAt: call.completedAt ?? call.startedAt,
        durationMs: call.durationMs,
      },
    });

    // Track artifacts
    const artifact = artifactFromToolCall(call, args.result);
    if (artifact) {
      presentation = reducePresentationEvent(presentation, {
        type: 'artifact_upsert',
        artifact: artifact.state,
      });
    }
  }

  // Summary text
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

// --- Phase signal builder ---

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
        steps: [],
      });
      return;
    }
    phases.set(phase, {
      ...current,
      status: current.status === 'error' ? 'error' : status,
    });
  };

  for (const call of result.toolCalls || []) {
    addPhase(phaseForToolCall(call.tool), call.status === 'error' ? 'error' : 'running');
  }

  return orderedPhases([...phases.values()]);
}

// --- Internal upsert helpers ---

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

function upsertStep(
  phases: TimelinePhaseGroup[],
  phaseId: string,
  step: TimelineStepItem,
): TimelinePhaseGroup[] {
  const phase = phaseFromPhaseId(phaseId);
  const index = phases.findIndex((entry) => entry.phaseId === phaseId);
  if (index === -1) {
    return insertPhaseOrdered(phases, {
      phaseId,
      phase,
      title: phaseTitle(phase),
      status: step.status === 'error' ? 'error' : 'running',
      steps: [step],
    });
  }

  const nextPhases = [...phases];
  const current = nextPhases[index];
  const stepIndex = current.steps.findIndex((existing) => existing.id === step.id);
  const nextSteps = stepIndex === -1
    ? [...current.steps, step]
    : current.steps.map((existing, currentIndex) => currentIndex === stepIndex ? step : existing);
  nextPhases[index] = {
    ...current,
    phase,
    status: current.status === 'error' || step.status === 'error'
      ? 'error'
      : current.status === 'done'
        ? 'done'
        : current.status,
    steps: nextSteps,
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
    steps: Array.isArray(phase.steps) ? phase.steps : [],
  };
}

function mergePhaseGroups(existing: TimelinePhaseGroup, next: TimelinePhaseGroup): TimelinePhaseGroup {
  const mergedSteps = next.steps.length > 0
    ? next.steps.reduce<TimelineStepItem[]>((steps, step) => upsertStepItem(steps, step), existing.steps)
    : existing.steps;
  return {
    ...existing,
    ...next,
    steps: mergedSteps,
  };
}

function upsertStepItem(steps: TimelineStepItem[], step: TimelineStepItem): TimelineStepItem[] {
  const index = steps.findIndex((existing) => existing.id === step.id);
  if (index === -1) {
    return [...steps, step];
  }

  const nextSteps = [...steps];
  nextSteps[index] = step;
  return nextSteps;
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

// --- Tool ↔ Phase / Skill mapping ---

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

export function skillIdForToolCall(tool: string, routing?: PresentationResultLike['routing']): string | undefined {
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

// --- Locale helpers ---

function uniqueStrings(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

export function phaseTitle(phase: PresentationPhase, locale: 'en' | 'zh' = 'en'): string {
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

export function toolTitle(tool: string, status: 'running' | 'done' | 'error', locale: 'en' | 'zh' = 'en'): string {
  if (status === 'error') return toolErrorTitle(tool, locale);
  if (status === 'running') return toolStartTitle(tool, locale);
  return toolDoneTitle(tool, locale);
}

function toolStartTitle(tool: string, locale: 'en' | 'zh'): string {
  if (tool === 'draft_model') {
    return locale === 'zh' ? '生成结构模型' : 'Generating structural model';
  }
  if (tool === 'update_model') {
    return locale === 'zh' ? '更新结构模型' : 'Updating structural model';
  }
  if (tool === 'convert_model') {
    return locale === 'zh' ? '转换分析模型' : 'Converting analysis model';
  }
  if (tool === 'validate_model') {
    return locale === 'zh' ? '校验模型' : 'Validating model';
  }
  if (tool === 'run_analysis' || tool === 'postprocess_result' || tool === 'run_code_check') {
    return locale === 'zh' ? '执行分析' : 'Running analysis';
  }
  if (tool === 'generate_report') {
    return locale === 'zh' ? '生成报告' : 'Generating report';
  }
  return locale === 'zh' ? `执行 ${tool}` : `Running ${tool}`;
}

function toolDoneTitle(tool: string, locale: 'en' | 'zh'): string {
  if (tool === 'draft_model') {
    return locale === 'zh' ? '结构模型已生成' : 'Structural model generated';
  }
  if (tool === 'update_model') {
    return locale === 'zh' ? '结构模型已更新' : 'Structural model updated';
  }
  if (tool === 'convert_model') {
    return locale === 'zh' ? '分析模型已转换' : 'Analysis model converted';
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
  if (tool === 'draft_model') {
    return locale === 'zh' ? '结构模型生成失败' : 'Structural model generation failed';
  }
  if (tool === 'update_model') {
    return locale === 'zh' ? '结构模型更新失败' : 'Structural model update failed';
  }
  if (tool === 'convert_model') {
    return locale === 'zh' ? '分析模型转换失败' : 'Analysis model conversion failed';
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
