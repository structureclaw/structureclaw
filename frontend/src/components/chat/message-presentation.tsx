'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { MessageKey } from '@/lib/i18n'
import { MarkdownBody } from './markdown-body'

export type PresentationPhase = 'understanding' | 'modeling' | 'validation' | 'analysis' | 'report'
export type PresentationPhaseStatus = 'pending' | 'running' | 'done' | 'error'

const PHASE_ORDER: PresentationPhase[] = ['understanding', 'modeling', 'validation', 'analysis', 'report']
type ArtifactName = 'model' | 'analysis' | 'report'

// --- TimelineStepItem ---

export type TimelineStepItem = {
  id: string
  phase: PresentationPhase
  status: 'running' | 'done' | 'error'
  tool: string
  skillId?: string
  title: string
  reason?: string
  output?: unknown
  errorMessage?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

// --- Phase group ---

export type TimelinePhaseGroup = {
  phaseId: string
  phase: PresentationPhase
  title?: string
  status: PresentationPhaseStatus
  steps: TimelineStepItem[]
  startedAt?: string
  completedAt?: string
}

// --- Artifact state ---

export type PresentationArtifactState = {
  artifact: ArtifactName
  status: 'pending' | 'available' | 'error'
  title: string
  summary?: string
  previewable?: boolean
  snapshotKey?: 'modelSnapshot' | 'resultSnapshot'
}

// --- Presentation ---

export type AssistantPresentation = {
  version: 3
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

// --- Events ---

export type PresentationEvent =
  | { type: 'phase_upsert'; phase: TimelinePhaseGroup }
  | { type: 'step_upsert'; phaseId: string; step: TimelineStepItem }
  | { type: 'artifact_upsert'; artifact: PresentationArtifactState }
  | { type: 'summary_replace'; summaryText: string }
  | { type: 'presentation_complete'; completedAt: string }
  | { type: 'presentation_error'; phase: PresentationPhase; message: string; createdAt?: string }

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
      }
    case 'step_upsert':
      return {
        ...state,
        phases: upsertStep(state.phases, event.phaseId, event.step),
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
        phases: state.phases.map((phase) =>
          phase.status === 'error'
            ? phase
            : { ...phase, status: 'done' as const, completedAt: phase.completedAt ?? event.completedAt }
        ),
      }
    case 'presentation_error':
      return {
        ...state,
        status: 'error',
        errorMessage: event.message,
      }
  }
}

// --- View ---

export type SkillNameResolver = (skillId: string) => string | undefined

export function MessagePresentationView({
  presentation,
  t,
  resolveSkillName,
}: {
  presentation: AssistantPresentation
  t: (key: MessageKey) => string
  resolveSkillName?: SkillNameResolver
}) {
  const isStreamingEmpty = presentation.status === 'streaming' && (presentation.phases?.length ?? 0) === 0

  return (
    <div className="space-y-3">
      {presentation.summaryText ? (
        <MarkdownBody compact content={presentation.summaryText} />
      ) : null}

      {isStreamingEmpty && (
        <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-background/60 px-3 py-3 dark:border-white/10 dark:bg-slate-950/40">
          <svg className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-600 dark:text-cyan-300" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-muted-foreground">{t('presentationPlanning')}</span>
        </div>
      )}

      {(presentation.phases?.length ?? 0) > 0 ? (
        <div className="space-y-2 rounded-2xl border border-border/70 bg-background/60 px-3 py-3 dark:border-white/10 dark:bg-slate-950/40">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t('presentationTimeline')}
          </div>
          <div className="space-y-2">
            {presentation.phases.map((phase) => {
              const phaseLabel = getPhaseLabel(phase.phase, phase.title, t)
              const hasSteps = phase.steps.length > 0
              return (
                <details key={phase.phaseId} open className="rounded-xl border border-border/70 bg-background/70 dark:border-white/10 dark:bg-black/20">
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2" aria-label={`${phaseLabel} — ${getPhaseStatusLabel(phase.status, t)}`}>
                    <span className="text-sm font-medium text-foreground flex-1">{phaseLabel}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 text-[10px]',
                        phase.status === 'error' && 'border-rose-300/50 text-rose-600 dark:text-rose-300',
                        phase.status === 'running' && 'border-cyan-300/50 text-cyan-700 dark:text-cyan-200',
                      )}
                    >
                      {phase.status === 'running' && (
                        <svg className="h-3 w-3 shrink-0 animate-spin text-cyan-600 dark:text-cyan-300" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      )}
                      {getPhaseStatusLabel(phase.status, t)}
                    </Badge>
                  </summary>
                  {hasSteps ? (
                    <div className="space-y-2 border-t border-border/50 px-3 py-2 dark:border-white/10">
                      {phase.steps.map((step) => (
                        <div key={step.id} className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 dark:border-white/10 dark:bg-slate-950/30">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                {step.skillId ? (
                                  <span className="inline-flex shrink-0 items-center rounded bg-violet-100 px-1 py-px text-[10px] font-medium leading-none text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                                    {resolveSkillName?.(step.skillId) ?? step.skillId}
                                  </span>
                                ) : null}
                                <span className="text-sm font-medium text-foreground">{step.title}</span>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                'shrink-0 text-[10px]',
                                step.status === 'error' && 'border-rose-300/50 text-rose-600 dark:text-rose-300',
                                step.status === 'running' && 'border-cyan-300/50 text-cyan-700 dark:text-cyan-200',
                              )}
                            >
                              {step.status === 'running' && (
                                <svg className="h-3 w-3 shrink-0 animate-spin text-cyan-600 dark:text-cyan-300" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                              )}
                              {getStepStatusLabel(step.status, t)}
                            </Badge>
                          </div>
                          {step.errorMessage ? (
                            <div className="mt-1 text-xs text-rose-600 dark:text-rose-300" role="alert">
                              {step.errorMessage}
                            </div>
                          ) : null}
                          {step.output != null ? (
                            <details className="mt-1.5">
                              <summary className="cursor-pointer text-xs text-muted-foreground">
                                {t('presentationShowDetails')}
                              </summary>
                              <pre className="mt-1.5 max-h-80 overflow-auto rounded-lg border border-border/60 bg-background/60 p-2.5 text-xs leading-5 text-muted-foreground dark:border-white/10 dark:bg-slate-950/30">
                                {formatOutput(step.output)}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </details>
              )
            })}
          </div>
          {presentation.status === 'streaming' && (
            <div className="flex items-center gap-2 pt-1" role="status">
              <svg className="h-3 w-3 shrink-0 animate-spin text-cyan-600 dark:text-cyan-300" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-xs text-muted-foreground">{t('presentationRunning')}</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

// --- Helpers ---

function formatOutput(output: unknown): string {
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function getPhaseLabel(phase: PresentationPhase, title: string | undefined, t: (key: MessageKey) => string): string {
  if (title) return title
  switch (phase) {
    case 'understanding': return t('phaseLabelUnderstanding')
    case 'modeling': return t('phaseLabelModeling')
    case 'validation': return t('phaseLabelCodeCheck')
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

function getStepStatusLabel(status: TimelineStepItem['status'], t: (key: MessageKey) => string): string {
  if (status === 'running') return t('presentationStatusRunning')
  if (status === 'error') return t('presentationStatusError')
  return t('presentationStatusDone')
}

function orderedPhases(phases: TimelinePhaseGroup[]): TimelinePhaseGroup[] {
  return [...phases].sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase))
}

function upsertPhase(phases: TimelinePhaseGroup[], nextPhase: TimelinePhaseGroup): TimelinePhaseGroup[] {
  const index = phases.findIndex((p) => p.phaseId === nextPhase.phaseId)
  if (index === -1) {
    return orderedPhases([...phases, { ...nextPhase, steps: nextPhase.steps || [] }])
  }
  const existing = phases[index]
  const stepsToUse = (nextPhase.steps && nextPhase.steps.length > 0) ? nextPhase.steps : existing.steps
  const allDone = stepsToUse.length > 0 && stepsToUse.every((s) => s.status === 'done')
  const hasError = stepsToUse.some((s) => s.status === 'error')
  const derivedStatus: PresentationPhaseStatus = hasError ? 'error' : allDone ? 'done' : nextPhase.status
  const next = [...phases]
  next[index] = {
    ...existing,
    ...nextPhase,
    status: derivedStatus,
    steps: stepsToUse,
  }
  return next
}

function upsertStep(phases: TimelinePhaseGroup[], phaseId: string, step: TimelineStepItem): TimelinePhaseGroup[] {
  const phaseIndex = phases.findIndex((p) => p.phaseId === phaseId)
  if (phaseIndex === -1) {
    return phases
  }
  const next = [...phases]
  const phase = next[phaseIndex]
  const nextSteps = upsertById(phase.steps, step)
  const allDone = nextSteps.length > 0 && nextSteps.every((s) => s.status === 'done')
  const hasError = nextSteps.some((s) => s.status === 'error')
  const nextStatus: PresentationPhaseStatus = hasError ? 'error' : allDone ? 'done' : 'running'
  next[phaseIndex] = {
    ...phase,
    status: nextStatus,
    steps: nextSteps,
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

function upsertArtifact(items: PresentationArtifactState[], nextArtifact: PresentationArtifactState): PresentationArtifactState[] {
  const index = items.findIndex((item) => item.artifact === nextArtifact.artifact)
  if (index === -1) {
    return [...items, nextArtifact]
  }
  const nextItems = [...items]
  nextItems[index] = nextArtifact
  return nextItems
}
