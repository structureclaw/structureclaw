'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { MessageKey } from '@/lib/i18n'

type PresentationPhase = 'understanding' | 'modeling' | 'validation' | 'analysis' | 'report'
type ArtifactName = 'model' | 'analysis' | 'report'

type TimelineNote = {
  id: string
  kind: 'note'
  phase: PresentationPhase
  status: 'done'
  previewText: string
  fullText?: string
  createdAt?: string
}

type TimelineStep = {
  id: string
  kind: 'step'
  phase: Exclude<PresentationPhase, 'understanding'>
  tool: string
  status: 'pending' | 'running' | 'done' | 'error'
  title: string
  reason?: string
  resultSummary?: string
  errorMessage?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

type TimelineArtifactUpdate = {
  id: string
  kind: 'artifact_update'
  phase: 'modeling' | 'analysis' | 'report'
  status: 'done'
  artifact: ArtifactName
  title: string
  summary?: string
  previewable?: boolean
  createdAt?: string
}

type TimelineClarification = {
  id: string
  kind: 'clarification'
  phase: 'understanding' | 'modeling'
  status: 'done'
  title: string
  missingCritical?: string[]
  missingOptional?: string[]
  question?: string
  createdAt?: string
}

type TimelineError = {
  id: string
  kind: 'error'
  phase: Exclude<PresentationPhase, 'understanding'>
  status: 'error'
  title: string
  message: string
  retryable?: boolean
  createdAt?: string
}

export type PresentationTimelineItem =
  | TimelineNote
  | TimelineStep
  | TimelineArtifactUpdate
  | TimelineClarification
  | TimelineError

export type PresentationArtifactState = {
  artifact: ArtifactName
  status: 'pending' | 'available' | 'error'
  title: string
  summary?: string
  previewable?: boolean
  snapshotKey?: 'modelSnapshot' | 'resultSnapshot'
}

export type AssistantPresentationV1 = {
  version: 1
  mode: 'conversation' | 'execution'
  status: 'streaming' | 'done' | 'error' | 'aborted'
  summaryText: string
  timeline: PresentationTimelineItem[]
  artifacts: PresentationArtifactState[]
  traceId?: string
  startedAt?: string
  completedAt?: string
}

export type PresentationEvent =
  | { type: 'timeline_item_upsert'; item: PresentationTimelineItem }
  | { type: 'artifact_upsert'; artifact: PresentationArtifactState }
  | { type: 'summary_replace'; summaryText: string }
  | { type: 'presentation_complete'; completedAt: string }
  | { type: 'presentation_error'; error: TimelineError }

export function reducePresentationEvent(
  state: AssistantPresentationV1,
  event: PresentationEvent,
): AssistantPresentationV1 {
  switch (event.type) {
    case 'timeline_item_upsert':
      return {
        ...state,
        timeline: upsertById(state.timeline, event.item),
      }
    case 'artifact_upsert':
      return {
        ...state,
        artifacts: upsertArtifact(state.artifacts, event.artifact),
      }
    case 'summary_replace':
      return {
        ...state,
        summaryText: event.summaryText,
      }
    case 'presentation_complete':
      return {
        ...state,
        status: 'done',
        completedAt: event.completedAt,
      }
    case 'presentation_error':
      return {
        ...state,
        status: 'error',
        timeline: upsertById(state.timeline, event.error),
      }
  }
}

export function MessagePresentationView({
  presentation,
  t,
}: {
  presentation: AssistantPresentationV1
  t: (key: MessageKey) => string
}) {
  return (
    <div className="space-y-3">
      {presentation.summaryText ? (
        <div className="whitespace-pre-wrap text-sm leading-7">
          {presentation.summaryText}
        </div>
      ) : null}

      {presentation.timeline.length > 0 ? (
        <div className="space-y-2 rounded-2xl border border-border/70 bg-background/60 px-3 py-3 dark:border-white/10 dark:bg-slate-950/40">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t('presentationTimeline')}
          </div>
          <div className="space-y-2">
            {presentation.timeline.map((item) => {
              const details = getPresentationDetails(item, t)
              const label = getPresentationLabel(item)
              const hasDetails = details.length > 0

              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 dark:border-white/10 dark:bg-black/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">
                        {label}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 text-[10px]',
                        item.status === 'error' && 'border-rose-300/50 text-rose-600 dark:text-rose-300',
                        item.status === 'running' && 'border-cyan-300/50 text-cyan-700 dark:text-cyan-200',
                      )}
                    >
                      {getStatusLabel(item.status, t)}
                    </Badge>
                  </div>

                  {hasDetails ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        {t('presentationShowDetails')}
                      </summary>
                      <div className="mt-2 space-y-2 text-xs leading-6 text-muted-foreground">
                        {details.map((detail) => (
                          <div key={`${item.id}-${detail.label}`} className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 dark:border-white/10 dark:bg-slate-950/30">
                            <div className="font-medium text-foreground">{detail.label}</div>
                            <div className="whitespace-pre-wrap">{detail.value}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T): T[] {
  const index = items.findIndex((item) => item.id === nextItem.id)
  if (index === -1) {
    return [...items, nextItem]
  }

  const nextItems = [...items]
  nextItems[index] = nextItem
  return nextItems
}

function upsertArtifact(
  items: PresentationArtifactState[],
  nextArtifact: PresentationArtifactState,
): PresentationArtifactState[] {
  const index = items.findIndex((item) => item.artifact === nextArtifact.artifact)
  if (index === -1) {
    return [...items, nextArtifact]
  }

  const nextItems = [...items]
  nextItems[index] = nextArtifact
  return nextItems
}

function getPresentationLabel(item: PresentationTimelineItem) {
  if (item.kind === 'note') return item.previewText
  if (item.kind === 'error') return item.title
  return item.title
}

function getPresentationDetails(
  item: PresentationTimelineItem,
  t: (key: MessageKey) => string,
): Array<{ label: string; value: string }> {
  if (item.kind === 'note') {
    return item.fullText ? [{ label: t('presentationDetailSummary'), value: item.fullText }] : []
  }
  if (item.kind === 'step') {
    return [
      item.reason ? { label: t('presentationDetailReason'), value: item.reason } : null,
      item.resultSummary ? { label: t('presentationDetailResult'), value: item.resultSummary } : null,
      item.errorMessage ? { label: t('presentationDetailError'), value: item.errorMessage } : null,
    ].filter((value): value is { label: string; value: string } => Boolean(value))
  }
  if (item.kind === 'artifact_update') {
    return item.summary ? [{ label: t('presentationDetailSummary'), value: item.summary }] : []
  }
  if (item.kind === 'clarification') {
    return [
      item.question ? { label: t('presentationDetailQuestion'), value: item.question } : null,
      item.missingCritical?.length ? { label: t('presentationDetailMissingCritical'), value: item.missingCritical.join(', ') } : null,
      item.missingOptional?.length ? { label: t('presentationDetailMissingOptional'), value: item.missingOptional.join(', ') } : null,
    ].filter((value): value is { label: string; value: string } => Boolean(value))
  }
  return [{ label: t('presentationDetailError'), value: item.message }]
}

function getStatusLabel(status: PresentationTimelineItem['status'], t: (key: MessageKey) => string) {
  if (status === 'pending') return t('presentationStatusPending')
  if (status === 'running') return t('presentationStatusRunning')
  if (status === 'error') return t('presentationStatusError')
  return t('presentationStatusDone')
}
