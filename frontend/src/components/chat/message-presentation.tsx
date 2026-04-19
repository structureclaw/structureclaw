'use client'

import { Badge } from '@/components/ui/badge'
import { stepLabelKey } from '@/components/chat/message-blocks'
import { cn } from '@/lib/utils'
import type { MessageKey } from '@/lib/i18n'

export type PresentationPhase = 'understanding' | 'modeling' | 'validation' | 'analysis' | 'report'
export type PresentationPhaseStatus = 'pending' | 'running' | 'done' | 'error'
type ArtifactName = 'model' | 'analysis' | 'report'

// --- v1 item types (kept for backward-compat parsing) ---

type TimelineNote = {
  id: string
  kind: 'note'
  phase: PresentationPhase
  status: 'done'
  previewText: string
  explanationText?: string
  rawUserFacingText?: string
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
  previewText?: string
  explanationText?: string
  rawUserFacingText?: string
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
  previewText?: string
  explanationText?: string
  rawUserFacingText?: string
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

// --- v2 TimelineEventItem union (matches backend) ---

type TimelinePhaseStartItem = {
  id: string
  kind: 'phase_start'
  phase: PresentationPhase
  status: 'running'
  title: string
  createdAt?: string
}

type TimelineSkillSelectedItem = {
  id: string
  kind: 'skill_selected'
  phase?: PresentationPhase
  status: 'done'
  skillId: string
  title: string
  reason?: string
  createdAt?: string
}

type TimelineSkillResultItem = {
  id: string
  kind: 'skill_result'
  phase?: PresentationPhase
  status: 'done' | 'error'
  skillId: string
  title: string
  summaryText?: string
  resultSummary?: string
  errorMessage?: string
  createdAt?: string
}

type TimelineToolStartItem = {
  id: string
  kind: 'tool_start'
  phase: PresentationPhase
  status: 'running'
  tool: string
  title: string
  reason?: string
  startedAt?: string
}

type TimelineToolResultItem = {
  id: string
  kind: 'tool_result'
  phase: PresentationPhase
  status: 'done' | 'error'
  tool: string
  title: string
  summaryText?: string
  resultSummary?: string
  errorMessage?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

type TimelineArtifactReadyItem = {
  id: string
  kind: 'artifact_ready'
  phase: PresentationPhase
  status: 'done'
  artifact: ArtifactName
  title: string
  summary?: string
  previewable?: boolean
  snapshotKey?: 'modelSnapshot' | 'resultSnapshot'
  createdAt?: string
}

type TimelineClarificationItem = {
  id: string
  kind: 'clarification'
  phase: PresentationPhase
  status: 'done'
  title: string
  previewText?: string
  explanationText?: string
  rawUserFacingText?: string
  missingCritical?: string[]
  missingOptional?: string[]
  question?: string
  createdAt?: string
}

type TimelineAssistantReplyItem = {
  id: string
  kind: 'assistant_reply'
  phase: PresentationPhase
  status: 'done'
  title: string
  text: string
  createdAt?: string
}

type TimelineErrorItem = {
  id: string
  kind: 'error'
  phase: PresentationPhase
  status: 'error'
  title: string
  message: string
  retryable?: boolean
  createdAt?: string
}

export type TimelineEventItem =
  | TimelinePhaseStartItem
  | TimelineSkillSelectedItem
  | TimelineSkillResultItem
  | TimelineToolStartItem
  | TimelineToolResultItem
  | TimelineArtifactReadyItem
  | TimelineClarificationItem
  | TimelineAssistantReplyItem
  | TimelineErrorItem

export type TimelinePhaseGroup = {
  phaseId: string
  phase: PresentationPhase
  title?: string
  status: PresentationPhaseStatus
  items: TimelineEventItem[]
  startedAt?: string
  completedAt?: string
}

export type PresentationArtifactState = {
  artifact: ArtifactName
  status: 'pending' | 'available' | 'error'
  title: string
  summary?: string
  previewable?: boolean
  snapshotKey?: 'modelSnapshot' | 'resultSnapshot'
}

// v1 type kept for backward-compat parsing
export type AssistantPresentationV1 = {
  version: 1
  mode: 'conversation' | 'execution'
  status: 'streaming' | 'done' | 'error' | 'aborted'
  summaryText: string
  timeline: (TimelineNote | TimelineStep | TimelineArtifactUpdate | TimelineClarification | TimelineError)[]
  artifacts: PresentationArtifactState[]
  traceId?: string
  startedAt?: string
  completedAt?: string
}

export type AssistantPresentation = {
  version: 2
  mode: 'conversation' | 'execution'
  status: 'streaming' | 'done' | 'error' | 'aborted'
  summaryText: string
  phases: TimelinePhaseGroup[]
  artifacts: PresentationArtifactState[]
  traceId?: string
  startedAt?: string
  completedAt?: string
  errorMessage?: string
}

export type PresentationEvent =
  | { type: 'phase_upsert'; phase: TimelinePhaseGroup }
  | { type: 'timeline_item_upsert'; phaseId: string; item: TimelineEventItem }
  | { type: 'artifact_upsert'; artifact: PresentationArtifactState }
  | { type: 'summary_replace'; summaryText: string }
  | { type: 'presentation_complete'; completedAt: string }
  | { type: 'presentation_error'; error: TimelineErrorItem }

export function reducePresentationEvent(
  state: AssistantPresentation,
  event: PresentationEvent,
): AssistantPresentation {
  switch (event.type) {
    case 'phase_upsert':
      return {
        ...state,
        phases: upsertPhaseById(state.phases, event.phase),
      }
    case 'timeline_item_upsert':
      return {
        ...state,
        phases: upsertItemInPhase(state.phases, event.phaseId, event.item),
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
        errorMessage: event.error.message,
      }
  }
}

export function MessagePresentationView({
  presentation,
  t,
}: {
  presentation: AssistantPresentation
  t: (key: MessageKey) => string
}) {
  return (
    <div className="space-y-3">
      {presentation.summaryText ? (
        <div className="whitespace-pre-wrap text-sm leading-7">
          {presentation.summaryText}
        </div>
      ) : null}

      {(presentation.phases?.length ?? 0) > 0 ? (
        <div className="space-y-2 rounded-2xl border border-border/70 bg-background/60 px-3 py-3 dark:border-white/10 dark:bg-slate-950/40">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t('presentationTimeline')}
          </div>
          <div className="space-y-2">
            {presentation.phases.map((phase) => {
              const phaseLabel = getPhaseLabel(phase.phase, phase.title, t)
              const hasItems = phase.items.length > 0
              return (
                <details key={phase.phaseId} open className="rounded-xl border border-border/70 bg-background/70 dark:border-white/10 dark:bg-black/20">
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
                    <span className="text-sm font-medium text-foreground flex-1">{phaseLabel}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 text-[10px]',
                        phase.status === 'error' && 'border-rose-300/50 text-rose-600 dark:text-rose-300',
                        phase.status === 'running' && 'border-cyan-300/50 text-cyan-700 dark:text-cyan-200',
                      )}
                    >
                      {getPhaseStatusLabel(phase.status, t)}
                    </Badge>
                  </summary>
                  {hasItems ? (
                    <div className="space-y-2 border-t border-border/50 px-3 py-2 dark:border-white/10">
                      {phase.items.map((item) => {
                        const details = getItemDetails(item, t)
                        const label = getItemLabel(item, t)
                        const hasDetails = details.length > 0
                        return (
                          <div key={item.id} className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 dark:border-white/10 dark:bg-slate-950/30">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-foreground">{label}</div>
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'shrink-0 text-[10px]',
                                  item.status === 'error' && 'border-rose-300/50 text-rose-600 dark:text-rose-300',
                                  item.status === 'running' && 'border-cyan-300/50 text-cyan-700 dark:text-cyan-200',
                                )}
                              >
                                {getItemStatusLabel(item.status, t)}
                              </Badge>
                            </div>
                            {hasDetails ? (
                              <details className="mt-1.5">
                                <summary className="cursor-pointer text-xs text-muted-foreground">
                                  {t('presentationShowDetails')}
                                </summary>
                                <div className="mt-1.5 space-y-1.5 text-xs leading-6 text-muted-foreground">
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
                  ) : null}
                </details>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function upsertPhaseById(phases: TimelinePhaseGroup[], nextPhase: TimelinePhaseGroup): TimelinePhaseGroup[] {
  const index = phases.findIndex((p) => p.phaseId === nextPhase.phaseId)
  if (index === -1) {
    return [...phases, nextPhase]
  }
  const existing = phases[index]
  const next = [...phases]
  next[index] = {
    ...existing,
    ...nextPhase,
    items: nextPhase.items.length > 0 ? nextPhase.items : existing.items,
  }
  return next
}

function upsertItemInPhase(
  phases: TimelinePhaseGroup[],
  phaseId: string,
  item: TimelineEventItem,
): TimelinePhaseGroup[] {
  const phaseIndex = phases.findIndex((p) => p.phaseId === phaseId)
  if (phaseIndex === -1) {
    return phases
  }
  const next = [...phases]
  const phase = next[phaseIndex]
  next[phaseIndex] = {
    ...phase,
    items: upsertById(phase.items, item),
  }
  return next
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

function getPhaseLabel(phase: PresentationPhase, title: string | undefined, t: (key: MessageKey) => string): string {
  if (title) return title
  switch (phase) {
    case 'understanding': return t('phaseLabelUnderstanding')
    case 'modeling': return t('phaseLabelModeling')
    case 'validation': return t('phaseLabelModeling')
    case 'analysis': return t('phaseLabelAnalysis')
    case 'report': return t('phaseLabelReport')
  }
}

function getPhaseStatusLabel(status: PresentationPhaseStatus, t: (key: MessageKey) => string): string {
  switch (status) {
    case 'pending': return t('phaseStatusPending')
    case 'running': return t('phaseStatusRunning')
    case 'error': return t('phaseStatusError')
    case 'done': return t('phaseStatusDone')
  }
}

function getItemLabel(item: TimelineEventItem, t: (key: MessageKey) => string): string {
  switch (item.kind) {
    case 'phase_start': return item.title
    case 'skill_selected': return `${t('presentationSkillSelected')}: ${item.skillId}`
    case 'skill_result': return `${item.skillId} — ${item.status === 'error' ? t('presentationStatusError') : t('presentationStatusDone')}`
    case 'tool_start':
    case 'tool_result':
      return t(stepLabelKey(item.tool))
    case 'artifact_ready': return item.title
    case 'clarification':
      if (item.previewText && item.previewText.trim().length > 0) return item.previewText
      return item.title
    case 'assistant_reply': return item.title
    case 'error': return item.title
  }
}

function getItemDetails(
  item: TimelineEventItem,
  t: (key: MessageKey) => string,
): Array<{ label: string; value: string }> {
  const detail = <T extends { label: string; value: string }>(v: T | null): T | null => v
  switch (item.kind) {
    case 'phase_start':
      return []
    case 'skill_selected':
      return [
        detail(item.reason ? { label: t('presentationDetailReason'), value: item.reason } : null),
      ].filter((v): v is { label: string; value: string } => v !== null)
    case 'skill_result':
      return [
        detail(item.summaryText ? { label: t('presentationDetailSummary'), value: item.summaryText } : null),
        detail(item.resultSummary ? { label: t('presentationDetailResult'), value: item.resultSummary } : null),
        detail(item.errorMessage ? { label: t('presentationDetailError'), value: item.errorMessage } : null),
      ].filter((v): v is { label: string; value: string } => v !== null)
    case 'tool_start':
      return [
        detail(item.reason ? { label: t('presentationDetailReason'), value: item.reason } : null),
      ].filter((v): v is { label: string; value: string } => v !== null)
    case 'tool_result':
      return [
        detail(item.summaryText ? { label: t('presentationDetailSummary'), value: item.summaryText } : null),
        detail(item.resultSummary ? { label: t('presentationDetailResult'), value: item.resultSummary } : null),
        detail(item.errorMessage ? { label: t('presentationDetailError'), value: item.errorMessage } : null),
      ].filter((v): v is { label: string; value: string } => v !== null)
    case 'artifact_ready':
      return item.summary ? [{ label: t('presentationDetailSummary'), value: item.summary }] : []
    case 'clarification':
      return [
        detail(item.rawUserFacingText ? { label: t('presentationDetailRawText'), value: item.rawUserFacingText } : null),
        detail(!item.rawUserFacingText && item.explanationText ? { label: t('presentationDetailSummary'), value: item.explanationText } : null),
        detail(item.question ? { label: t('presentationDetailQuestion'), value: item.question } : null),
        detail(item.missingCritical?.length ? { label: t('presentationDetailMissingCritical'), value: item.missingCritical.join(', ') } : null),
        detail(item.missingOptional?.length ? { label: t('presentationDetailMissingOptional'), value: item.missingOptional.join(', ') } : null),
      ].filter((v): v is { label: string; value: string } => v !== null)
    case 'assistant_reply':
      return item.text
        ? [{ label: t('presentationDetailRawText'), value: item.text }]
        : []
    case 'error':
      return [{ label: t('presentationDetailError'), value: item.message }]
  }
}

function getItemStatusLabel(status: TimelineEventItem['status'], t: (key: MessageKey) => string): string {
  if (status === 'running') return t('presentationStatusRunning')
  if (status === 'error') return t('presentationStatusError')
  return t('presentationStatusDone')
}
