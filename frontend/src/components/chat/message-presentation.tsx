'use client'

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
  args?: Record<string, unknown>
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
            : {
                ...phase,
                status: 'done' as const,
                completedAt: phase.completedAt ?? event.completedAt,
                // Also mark any still-running steps as done
                steps: phase.steps.map((step) =>
                  step.status === 'running'
                    ? { ...step, status: 'done' as const, completedAt: event.completedAt }
                    : step
                ),
              }
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
}: {
  presentation: AssistantPresentation
  t?: (key: MessageKey) => string
  resolveSkillName?: SkillNameResolver
}) {
  // Tool calls now have their own message bubbles — only render LLM text here
  return (
    <div className="space-y-2">
      {presentation.summaryText ? (
        <MarkdownBody compact content={presentation.summaryText} />
      ) : null}
    </div>
  )
}

// --- Helpers ---

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
    // Auto-create the missing phase so step_upsert always works,
    // even if the backend didn't emit phase_upsert first.
    const newPhase: TimelinePhaseGroup = {
      phaseId,
      phase: step.phase,
      status: 'running',
      steps: [step],
    }
    return orderedPhases([...phases, newPhase])
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
