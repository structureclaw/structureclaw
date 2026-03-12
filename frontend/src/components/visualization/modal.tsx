'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MessageKey } from '@/lib/i18n'
import type { AppLocale } from '@/lib/stores/slices/preferences'
import { VisualizationModalShell } from './modal-shell'
import type { VisualizationSnapshot, VisualizationViewMode } from './types'

type StructuralVisualizationModalProps = {
  open: boolean
  snapshot: VisualizationSnapshot | null
  locale: AppLocale
  onClose: () => void
  t: (key: MessageKey) => string
}

export function StructuralVisualizationModal({
  open,
  snapshot,
  onClose,
  t,
}: StructuralVisualizationModalProps) {
  const [view, setView] = useState<VisualizationViewMode>('model')
  const [resetToken, setResetToken] = useState(0)

  useEffect(() => {
    if (!open || !snapshot) {
      return
    }
    setView(snapshot.availableViews[0] || 'model')
  }, [open, snapshot])

  const placeholderTitle = useMemo(
    () => snapshot?.title || t('visualizationTitle'),
    [snapshot, t]
  )

  return (
    <VisualizationModalShell
      onClose={onClose}
      onResetView={() => setResetToken((current) => current + 1)}
      onViewChange={setView}
      open={open}
      selectedView={view}
      snapshot={snapshot}
      t={t}
      title={placeholderTitle}
      aside={
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-card/80 p-4 dark:border-white/10 dark:bg-slate-950/40">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('visualizationCurrentCase')}</div>
            <div className="mt-2 text-base font-semibold text-foreground">
              {snapshot?.cases.find((item) => item.id === snapshot.defaultCaseId)?.label || t('visualizationUnavailable')}
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm leading-6 text-muted-foreground dark:border-white/10 dark:bg-slate-950/40">
            {snapshot ? t('visualizationLoadingScene') : t('visualizationMissingModel')}
          </div>
        </div>
      }
    >
      <div
        className="flex h-full items-center justify-center px-6 py-10 text-center"
        data-testid="visualization-modal-placeholder"
        key={resetToken}
      >
        <div className="max-w-xl rounded-[28px] border border-dashed border-cyan-300/35 bg-cyan-300/8 p-8">
          <div className="text-sm uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-200">{t('visualizationTitle')}</div>
          <div className="mt-3 text-2xl font-semibold text-foreground">{t('visualizationLoadingScene')}</div>
          <div className="mt-3 text-sm leading-6 text-muted-foreground">
            {snapshot
              ? `${t('visualizationViewModel')} / ${t('visualizationViewDeformed')} / ${t('visualizationViewForces')} / ${t('visualizationViewReactions')}`
              : t('visualizationUnavailable')}
          </div>
        </div>
      </div>
    </VisualizationModalShell>
  )
}
