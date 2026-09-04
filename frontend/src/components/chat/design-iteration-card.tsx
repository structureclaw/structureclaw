'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { ToolCallCard } from './tool-call-card'
import type { TimelineStepItem } from './message-presentation'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Design-iteration progress card for run_design tool steps.
 *
 * Renders the design loop state streamed from the backend:
 * before → after section changes per iteration, convergence status,
 * optimization history, and the (optional) cost estimate of external
 * design-service calls.
 */

export type DesignSectionChangeView = {
  sectionId?: string
  elementIds?: string[]
  before?: string
  after?: string
  utilizationBefore?: number
  utilizationAfter?: number
  reason?: string
}

export type DesignIterationView = {
  iteration?: number
  provider?: string
  action?: string
  applied?: boolean
  converged?: boolean
  changes?: DesignSectionChangeView[]
  maxUtilizationBefore?: number
  maxUtilizationAfter?: number
  summary?: { zh?: string; en?: string } | string
  costEstimate?: { amount?: number; currency?: string; note?: string }
  completedAt?: string
}

export type DesignLoopStateView = {
  iterations?: DesignIterationView[]
  maxIterations?: number
  lastAction?: string
  converged?: boolean
}

export type DesignIterationCardProps = {
  step: TimelineStepItem
  designState?: DesignLoopStateView | null
  locale?: 'en' | 'zh'
  t: (key: MessageKey) => string
}

function normalizeSummary(summary: DesignIterationView['summary'], locale: string): string {
  if (!summary) return ''
  if (typeof summary === 'string') return summary
  return (locale === 'zh' ? summary.zh : summary.en) ?? summary.en ?? summary.zh ?? ''
}

function statusTone(action: string | undefined): string {
  if (action === 'converged') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
  if (action === 'max_iterations_reached' || action === 'no_change') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
}

function localizedStatusKey(action: string | undefined): MessageKey {
  if (action === 'converged') return 'designCardStatusConverged'
  if (action === 'max_iterations_reached') return 'designCardStatusMaxReached'
  if (action === 'no_change') return 'designCardStatusNoChange'
  if (action === 'blocked_approval') return 'designCardStatusApprovalNeeded'
  return 'designCardStatusIterating'
}

function IterationChanges({
  changes,
  t,
}: {
  changes: DesignSectionChangeView[]
  t: (key: MessageKey) => string
}) {
  if (!changes || changes.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 pr-3 font-medium">{t('designCardSection')}</th>
            <th className="py-1 pr-3 font-medium">{t('designCardBefore')}</th>
            <th className="py-1 pr-3 font-medium">{t('designCardAfter')}</th>
            <th className="py-1 pr-3 font-medium">{t('designCardUtilization')}</th>
            <th className="py-1 font-medium">{t('designCardElements')}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change, index) => (
            <tr key={`${change.sectionId ?? 'section'}-${index}`} className="border-t border-border/30">
              <td className="py-1 pr-3 font-mono text-foreground">{change.sectionId ?? '—'}</td>
              <td className="py-1 pr-3 font-mono text-rose-600 dark:text-rose-400">{change.before ?? '—'}</td>
              <td className="py-1 pr-3 font-mono text-emerald-600 dark:text-emerald-400">{change.after ?? '—'}</td>
              <td className="py-1 pr-3 text-muted-foreground">
                {change.utilizationBefore != null
                  ? `${change.utilizationBefore}${change.utilizationAfter != null ? ` → ${change.utilizationAfter}` : ''}`
                  : '—'}
              </td>
              <td className="py-1 text-muted-foreground">{change.elementIds?.length ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {changes.some((change) => change.reason) && (
        <ul className="mt-1.5 space-y-0.5 text-[10px] leading-relaxed text-muted-foreground">
          {changes.filter((change) => change.reason).map((change, index) => (
            <li key={`${change.sectionId ?? 'reason'}-${index}`}>{change.reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DesignIterationCard({ step, designState, locale = 'zh', t }: DesignIterationCardProps) {
  const [expanded, setExpanded] = useState(false)
  const iterations = designState?.iterations ?? []
  const statusAction = designState?.lastAction
    ?? (iterations.length > 0 ? iterations[iterations.length - 1].action : undefined)

  if (iterations.length === 0) {
    // Design state not available (e.g. archived conversation without streamed
    // state) — fall back to the generic tool card so the step stays visible.
    return <ToolCallCard step={step} t={t} attached />
  }

  const lastIteration = iterations[iterations.length - 1]
  const lastSummary = normalizeSummary(lastIteration?.summary, locale)
  const hasHistory = iterations.length > 1

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden',
        statusAction === 'converged'
          ? 'border-emerald-500/20 bg-emerald-500/5 dark:border-emerald-400/15'
          : 'border-cyan-500/25 bg-cyan-500/5 dark:border-cyan-400/20',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="font-mono text-xs font-medium text-foreground">{step.tool}</span>
        <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px]', statusTone(statusAction))}>
          {t(localizedStatusKey(statusAction))}
        </span>
        {designState?.maxIterations != null && iterations.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {t('designCardIterationCount')
              .replace('{count}', String(iterations.length))
              .replace('{max}', String(designState.maxIterations))}
          </span>
        )}
        {lastIteration?.provider && (
          <span className="rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {lastIteration.provider === 'local-rule' ? t('designCardLocalEngine') : lastIteration.provider}
          </span>
        )}
        {lastIteration?.costEstimate?.amount != null && (
          <span className="text-[10px] text-muted-foreground">
            {t('designCardCostEstimate')}
            {': '}
            {lastIteration.costEstimate.amount}
            {lastIteration.costEstimate.currency ? ` ${lastIteration.costEstimate.currency}` : ''}
          </span>
        )}
        {(hasHistory || lastSummary) && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {expanded ? t('hideDetails') : t('showDetails')}
          </button>
        )}
      </div>

      {lastSummary && (
        <div className="border-t border-border/20 px-3 py-1.5 text-xs text-foreground">{lastSummary}</div>
      )}

      {expanded && (
        <div className="space-y-2 border-t border-border/30 bg-background/50 px-3 py-2">
          {[...iterations].reverse().map((iteration, index) => (
            <div key={`${iteration.iteration ?? index}-${iteration.completedAt ?? ''}`} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t('designCardIterationLabel').replace('{n}', String(iteration.iteration ?? index + 1))}
                </span>
                <span className={cn('rounded-full border px-1.5 py-0.5', statusTone(iteration.action))}>
                  {t(localizedStatusKey(iteration.action))}
                </span>
              </div>
              <IterationChanges changes={iteration.changes ?? []} t={t} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
