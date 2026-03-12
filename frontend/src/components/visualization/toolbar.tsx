'use client'

import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { VisualizationSnapshot } from './types'

type ForceMetric = 'axial' | 'shear' | 'moment'

type VisualizationToolbarProps = {
  snapshot: VisualizationSnapshot
  activeCaseId: string
  deformationScale: number
  forceMetric: ForceMetric
  showElementLabels: boolean
  showLegend: boolean
  showNodeLabels: boolean
  showUndeformed: boolean
  onActiveCaseChange: (caseId: string) => void
  onDeformationScaleChange: (value: number) => void
  onForceMetricChange: (value: ForceMetric) => void
  onToggleElementLabels: () => void
  onToggleLegend: () => void
  onToggleNodeLabels: () => void
  onToggleUndeformed: () => void
  t: (key: MessageKey) => string
}

const FORCE_LABELS: Record<ForceMetric, MessageKey> = {
  axial: 'visualizationForceAxial',
  shear: 'visualizationForceShear',
  moment: 'visualizationForceMoment',
}

export function VisualizationToolbar({
  snapshot,
  activeCaseId,
  deformationScale,
  forceMetric,
  showElementLabels,
  showLegend,
  showNodeLabels,
  showUndeformed,
  onActiveCaseChange,
  onDeformationScaleChange,
  onForceMetricChange,
  onToggleElementLabels,
  onToggleLegend,
  onToggleNodeLabels,
  onToggleUndeformed,
  t,
}: VisualizationToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3 dark:border-white/10">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{t('visualizationCurrentCase')}</span>
        <select
          className="rounded-full border border-border/70 bg-background/80 px-3 py-2 text-foreground dark:border-white/10 dark:bg-white/5"
          onChange={(event) => onActiveCaseChange(event.target.value)}
          value={activeCaseId}
        >
          {snapshot.cases.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2">
        {(['axial', 'shear', 'moment'] as const).map((metric) => (
          <button
            key={metric}
            className={cn(
              'rounded-full border px-3 py-2 text-sm transition',
              forceMetric === metric
                ? 'border-cyan-300/45 bg-cyan-300/14 text-foreground'
                : 'border-border/70 bg-background/70 text-muted-foreground hover:border-cyan-300/30 hover:text-foreground dark:border-white/10 dark:bg-white/5'
            )}
            onClick={() => onForceMetricChange(metric)}
            type="button"
          >
            {t(FORCE_LABELS[metric])}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{t('visualizationScale')}</span>
        <input
          className="accent-cyan-500"
          max={40}
          min={1}
          onChange={(event) => onDeformationScaleChange(Number(event.target.value))}
          type="range"
          value={deformationScale}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {[
          { active: showUndeformed, key: 'visualizationUndeformedOverlay', onClick: onToggleUndeformed },
          { active: showNodeLabels, key: 'visualizationNodeLabels', onClick: onToggleNodeLabels },
          { active: showElementLabels, key: 'visualizationElementLabels', onClick: onToggleElementLabels },
          { active: showLegend, key: 'visualizationLegend', onClick: onToggleLegend },
        ].map((item) => (
          <button
            key={item.key}
            className={cn(
              'rounded-full border px-3 py-2 text-sm transition',
              item.active
                ? 'border-cyan-300/45 bg-cyan-300/14 text-foreground'
                : 'border-border/70 bg-background/70 text-muted-foreground hover:border-cyan-300/30 hover:text-foreground dark:border-white/10 dark:bg-white/5'
            )}
            onClick={item.onClick}
            type="button"
          >
            {t(item.key as MessageKey)}
          </button>
        ))}
      </div>
    </div>
  )
}
