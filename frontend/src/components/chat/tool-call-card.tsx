'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import type { TimelineStepItem } from './message-presentation'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type ToolCallCardProps = {
  step: TimelineStepItem
  t: (key: MessageKey) => string
  attached?: boolean
}

function formatArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2)
}

function truncateOutput(output: unknown, maxLen = 300): string {
  const str = typeof output === 'string' ? output : JSON.stringify(output)
  if (!str) return ''
  return str.length <= maxLen ? str : str.slice(0, maxLen) + '...'
}

export function ToolCallCard({ step, t, attached = false }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const hasArgs = !!(step.args && Object.keys(step.args).length > 0)
  const argsJson = hasArgs ? formatArgs(step.args!) : ''

  const statusIcon = (() => {
    if (step.status === 'running') {
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-500 dark:text-cyan-400" />
    }
    if (step.status === 'done') {
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
    }
    return <AlertCircle className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400" />
  })()

  const statusLabel = (() => {
    if (step.status === 'running') return t('toolRunning')
    if (step.status === 'done') return t('toolCompleted')
    return t('toolError')
  })()

  const borderColor = (() => {
    if (step.status === 'running') return 'border-cyan-500/30 dark:border-cyan-400/20'
    if (step.status === 'done') return 'border-emerald-500/20 dark:border-emerald-400/15'
    return 'border-rose-500/30 dark:border-rose-400/20'
  })()

  const bgColor = (() => {
    if (step.status === 'running') return 'bg-cyan-500/5 dark:bg-cyan-400/5'
    if (step.status === 'done') return 'bg-emerald-500/5 dark:bg-emerald-400/5'
    return 'bg-rose-500/5 dark:bg-rose-400/5'
  })()

  return (
    <div className={cn('rounded-lg border overflow-hidden', borderColor, bgColor, attached ? 'shadow-none' : '')}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {statusIcon}
        <span className="font-mono text-xs font-medium text-foreground">{step.tool}</span>
        <span className={`text-[10px] uppercase tracking-wide ${step.status === 'running' ? 'text-cyan-600 dark:text-cyan-400' : step.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {statusLabel}
        </span>
        {step.durationMs != null && step.status === 'done' && (
          <span className="ml-auto text-[10px] text-muted-foreground">{step.durationMs}ms</span>
        )}
        {hasArgs && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <>
                <ChevronDown className="h-3 w-3" />
                {t('hideParameters')}
              </>
            ) : (
              <>
                <ChevronRight className="h-3 w-3" />
                {t('showParameters')}
              </>
            )}
          </button>
        )}
      </div>

      {/* Collapsible args */}
      {expanded && hasArgs ? (
        <div className="border-t border-border/30 bg-background/50 px-3 py-2">
          <pre className="max-h-48 overflow-auto text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
            {argsJson}
          </pre>
        </div>
      ) : null}

      {/* Error message */}
      {step.status === 'error' && step.errorMessage ? (
        <div className="border-t border-rose-500/20 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
          {step.errorMessage}
        </div>
      ) : null}

      {/* Output preview (collapsed) */}
      {step.status === 'done' && step.output && !expanded ? (
        <div className="border-t border-border/20 px-3 py-1.5 text-[10px] text-muted-foreground truncate">
          {truncateOutput(step.output)}
        </div>
      ) : null}
    </div>
  )
}
