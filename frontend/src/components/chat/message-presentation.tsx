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
  // Flatten all steps from all phases into a single ordered list
  const allSteps = presentation.phases.flatMap((p) => p.steps)

  return (
    <div className="space-y-2">
      {/* Streaming LLM text */}
      {presentation.summaryText ? (
        <MarkdownBody compact content={presentation.summaryText} />
      ) : null}

      {/* Inline tool/skill call cards */}
      {allSteps.length > 0 && (
        <div className="space-y-1.5">
          {allSteps.map((step) => (
            <div
              key={step.id}
              className={cn(
                'rounded-xl border px-2.5 py-1.5',
                step.status === 'error'
                  ? 'border-rose-300/40 bg-rose-300/5 dark:border-rose-400/30 dark:bg-rose-900/10'
                  : step.status === 'running'
                    ? 'border-cyan-300/40 bg-cyan-300/5 dark:border-cyan-400/30 dark:bg-cyan-900/10'
                    : 'border-border/60 bg-background/60 dark:border-white/10 dark:bg-slate-950/30',
              )}
            >
              <div className="flex items-center gap-2">
                {/* Status icon */}
                {step.status === 'running' ? (
                  <svg className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-600 dark:text-cyan-300" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : step.status === 'done' ? (
                  <svg className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5 shrink-0 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}

                {/* Skill badge */}
                {step.skillId ? (
                  <span className="inline-flex shrink-0 items-center rounded bg-violet-100 px-1 py-px text-[10px] font-medium leading-none text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                    {resolveSkillName?.(step.skillId) ?? step.skillId}
                  </span>
                ) : null}

                {/* Tool / step title */}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {step.title}
                </span>

                {/* Status label */}
                <span
                  className={cn(
                    'shrink-0 text-[10px] font-medium',
                    step.status === 'running' && 'text-cyan-600 dark:text-cyan-300',
                    step.status === 'done' && 'text-emerald-600 dark:text-emerald-400',
                    step.status === 'error' && 'text-rose-600 dark:text-rose-300',
                  )}
                >
                  {getStepStatusLabel(step.status, t)}
                </span>
              </div>

              {/* Error message */}
              {step.errorMessage ? (
                <div className="mt-1 text-xs text-rose-600 dark:text-rose-300" role="alert">
                  {step.errorMessage}
                </div>
              ) : null}

              {/* Collapsible output */}
              {step.output != null ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {t('presentationShowDetails')}
                  </summary>
                  <pre className="mt-1 max-h-80 overflow-auto rounded-lg border border-border/60 bg-background/60 p-2.5 text-xs leading-5 text-muted-foreground dark:border-white/10 dark:bg-slate-950/30">
                    {formatOutput(step.output)}
                  </pre>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      )}
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
