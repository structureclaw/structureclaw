'use client'

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Focus, Maximize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { VisualizationPlane, VisualizationSnapshot, VisualizationViewMode } from './types'

type VisualizationModalShellProps = {
  open: boolean
  snapshot: VisualizationSnapshot | null
  title: string
  selectedView: VisualizationViewMode
  selectedPlane: VisualizationPlane
  onViewChange: (mode: VisualizationViewMode) => void
  onPlaneChange: (plane: VisualizationPlane) => void
  onClose: () => void
  onResetView: () => void
  t: (key: MessageKey) => string
  children: ReactNode
  aside?: ReactNode
}

const VIEW_LABELS: Record<VisualizationViewMode, MessageKey> = {
  model: 'visualizationViewModel',
  deformed: 'visualizationViewDeformed',
  forces: 'visualizationViewForces',
  reactions: 'visualizationViewReactions',
}

const PLANE_LABELS: Record<VisualizationPlane, MessageKey> = {
  xy: 'visualizationPlaneXY',
  xz: 'visualizationPlaneXZ',
  yz: 'visualizationPlaneYZ',
}

const PLANE_OPTIONS: VisualizationPlane[] = ['xz', 'xy', 'yz']

export function VisualizationModalShell({
  open,
  snapshot,
  title,
  selectedView,
  selectedPlane,
  onViewChange,
  onPlaneChange,
  onClose,
  onResetView,
  t,
  children,
  aside,
}: VisualizationModalShellProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const lastActiveElementRef = useRef<HTMLElement | null>(null)

  const availableViews = useMemo(
    (): VisualizationViewMode[] => snapshot?.availableViews || ['model', 'deformed', 'forces', 'reactions'],
    [snapshot]
  )

  useEffect(() => {
    if (!open) {
      return
    }

    lastActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !containerRef.current) {
        return
      }

      const focusable = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute('disabled'))

      if (focusable.length === 0) {
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      lastActiveElementRef.current?.focus()
    }
  }, [onClose, open])

  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <button
        aria-label={t('visualizationClose')}
        className="absolute inset-0 bg-slate-950/72 backdrop-blur-sm"
        onClick={onClose}
        type="button"
      />
      <div className="absolute inset-0 p-2 sm:p-4">
        <div
          ref={containerRef}
          aria-modal="true"
          className="relative flex h-full flex-col overflow-hidden rounded-[30px] border border-border/70 bg-card/95 shadow-[0_40px_120px_-40px_rgba(8,145,178,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95"
          role="dialog"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(251,146,60,0.12),transparent_26%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.2),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(251,146,60,0.18),transparent_28%)]" />
          <div className="relative flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4 dark:border-white/10">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-700/80 dark:text-cyan-200/70">{t('visualizationTitle')}</p>
              <h2 className="mt-1 text-2xl font-semibold text-foreground">{title}</h2>
              {snapshot ? (
                <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                  <p>
                    {snapshot.dimension}D · {snapshot.nodes.length} {t('analysisOverviewCountsNodes').toLowerCase()} · {snapshot.elements.length} {t('analysisOverviewCountsElements').toLowerCase()}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs dark:border-white/10 dark:bg-white/5">
                      {t('visualizationStatusCurrentSource')}: {snapshot.source === 'model' ? t('visualizationSourceModel') : t('visualizationSourceResult')}
                    </span>
                    {snapshot.statusMessage ? (
                      <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-900 dark:text-amber-100">
                        {snapshot.statusMessage}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                className="rounded-full border border-border/70 bg-background/80 text-foreground hover:bg-accent/30 dark:border-white/10 dark:bg-white/5"
                onClick={onResetView}
                type="button"
                variant="outline"
              >
                <Focus className="h-4 w-4" />
                {t('visualizationResetView')}
              </Button>
              <Button
                ref={closeButtonRef}
                className="rounded-full border border-border/70 bg-background/80 text-foreground hover:bg-accent/30 dark:border-white/10 dark:bg-white/5"
                onClick={onClose}
                type="button"
                variant="outline"
              >
                <X className="h-4 w-4" />
                {t('visualizationClose')}
              </Button>
            </div>
          </div>

          <div className="relative flex flex-col gap-4 border-b border-border/70 px-5 py-4 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              {availableViews.map((view) => (
                <button
                  key={view}
                  className={cn(
                    'rounded-full border px-4 py-2 text-sm transition',
                    selectedView === view
                      ? 'border-cyan-300/50 bg-cyan-300/16 text-foreground'
                      : 'border-border/70 bg-background/70 text-muted-foreground hover:border-cyan-300/30 hover:text-foreground dark:border-white/10 dark:bg-white/5'
                  )}
                  onClick={() => onViewChange(view)}
                  type="button"
                >
                  {t(VIEW_LABELS[view])}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('visualizationGridPlane')}</span>
              {PLANE_OPTIONS.map((plane) => (
                <button
                  key={plane}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                    selectedPlane === plane
                      ? 'border-cyan-300/50 bg-cyan-300/16 text-foreground'
                      : 'border-border/70 bg-background/70 text-muted-foreground hover:border-cyan-300/30 hover:text-foreground dark:border-white/10 dark:bg-white/5'
                  )}
                  onClick={() => onPlaneChange(plane)}
                  type="button"
                >
                  {t(PLANE_LABELS[plane])}
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col xl:flex-row">
            <div className="min-h-[300px] flex-1 xl:min-h-0">{children}</div>
            <aside className="border-t border-border/70 bg-background/50 p-4 xl:w-[320px] xl:border-l xl:border-t-0 dark:border-white/10 dark:bg-white/5">
              {aside}
            </aside>
          </div>

          <div className="relative border-t border-border/70 px-5 py-3 text-xs text-muted-foreground dark:border-white/10">
            <div className="flex items-center gap-2">
              <Maximize2 className="h-3.5 w-3.5" />
              <span>{t('visualizationDoubleClickHint')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
