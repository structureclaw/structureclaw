export type PresentationPhase =
  | 'understanding'
  | 'modeling'
  | 'validation'
  | 'analysis'
  | 'report';

type ExecutionPhase = Exclude<PresentationPhase, 'understanding'>;
type ArtifactName = 'model' | 'analysis' | 'report';

export type TimelineItem =
  | {
      id: string;
      kind: 'note';
      phase: PresentationPhase;
      status: 'done';
      previewText: string;
      fullText?: string;
      createdAt?: string;
    }
  | {
      id: string;
      kind: 'step';
      phase: ExecutionPhase;
      tool: string;
      status: 'pending' | 'running' | 'done' | 'error';
      title: string;
      reason?: string;
      resultSummary?: string;
      errorMessage?: string;
      startedAt?: string;
      completedAt?: string;
      durationMs?: number;
    }
  | {
      id: string;
      kind: 'artifact_update';
      phase: 'modeling' | 'analysis' | 'report';
      status: 'done';
      artifact: ArtifactName;
      title: string;
      summary?: string;
      previewable?: boolean;
      createdAt?: string;
    }
  | {
      id: string;
      kind: 'clarification';
      phase: 'understanding' | 'modeling';
      status: 'done';
      title: string;
      missingCritical?: string[];
      missingOptional?: string[];
      question?: string;
      createdAt?: string;
    }
  | {
      id: string;
      kind: 'error';
      phase: ExecutionPhase;
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

export interface AssistantPresentationV1 {
  version: 1;
  mode: 'conversation' | 'execution';
  status: 'streaming' | 'done' | 'error' | 'aborted';
  summaryText: string;
  timeline: TimelineItem[];
  artifacts: ArtifactState[];
  traceId?: string;
  startedAt?: string;
  completedAt?: string;
}

export type PresentationErrorItem = Extract<TimelineItem, { kind: 'error' }>;

export type PresentationEvent =
  | { type: 'timeline_item_upsert'; item: TimelineItem }
  | { type: 'artifact_upsert'; artifact: ArtifactState }
  | { type: 'summary_replace'; summaryText: string }
  | { type: 'presentation_complete'; completedAt: string }
  | { type: 'presentation_error'; error: PresentationErrorItem };

export function createEmptyAssistantPresentation(args: {
  traceId?: string;
  mode: 'conversation' | 'execution';
  startedAt?: string;
}): AssistantPresentationV1 {
  return {
    version: 1,
    mode: args.mode,
    status: 'streaming',
    summaryText: '',
    timeline: [],
    artifacts: [],
    traceId: args.traceId,
    startedAt: args.startedAt,
  };
}

export function reducePresentationEvent(
  state: AssistantPresentationV1,
  event: PresentationEvent,
): AssistantPresentationV1 {
  switch (event.type) {
    case 'timeline_item_upsert':
      return {
        ...state,
        timeline: upsertById(state.timeline, event.item),
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
      };
    case 'presentation_error':
      return {
        ...state,
        status: 'error',
        timeline: upsertById(state.timeline, event.error),
      };
  }
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T): T[] {
  const index = items.findIndex((item) => item.id === nextItem.id);
  if (index === -1) {
    return [...items, nextItem];
  }

  const nextItems = [...items];
  nextItems[index] = nextItem;
  return nextItems;
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
