import type { ReactNode } from 'react'
import type { MessageKey } from '@/lib/i18n'
import type {
  BucklingMode,
  VisualizationCase,
  VisualizationExtensionEntry,
  VisualizationExtensionId,
  VisualizationSnapshot,
  VisualizationViewMode,
} from './types'

export type UtilizationExtensionData = {
  memberUtilizationMap: Record<string, number>
}

export type BucklingExtensionData = {
  bucklingModes: BucklingMode[]
}

export type VisualizationLegendDefinition = {
  maxValue: number
  valueScale?: number
  unit?: string
  label: string
  colorMode?: 'scale' | 'utilization'
}

export type VisualizationExtensionContext = {
  snapshot: VisualizationSnapshot
  activeCase: VisualizationCase
  activeView: VisualizationViewMode
  bucklingModeIndex: number
  forceMetric: 'axial' | 'shear' | 'moment'
  t: (key: MessageKey) => string
}

export type VisualizationExtensionDefinition = {
  id: VisualizationExtensionId
  view: VisualizationViewMode
  viewLabelKey: MessageKey
  isAvailable: (snapshot: VisualizationSnapshot | null) => boolean
  renderAside?: (context: VisualizationExtensionContext) => ReactNode
  getLegend?: (context: VisualizationExtensionContext) => VisualizationLegendDefinition | null
}

function getExtensionEntry<TData>(
  snapshot: VisualizationSnapshot | null,
  extensionId: VisualizationExtensionId
): VisualizationExtensionEntry<TData> | null {
  if (!snapshot?.extensions) {
    return null
  }
  const entry = snapshot.extensions[extensionId]
  return entry?.available ? (entry as VisualizationExtensionEntry<TData>) : null
}

export function getBucklingModes(snapshot: VisualizationSnapshot | null): BucklingMode[] {
  const entry = getExtensionEntry<BucklingExtensionData>(snapshot, 'builtin.buckling')
  if (entry?.data?.bucklingModes?.length) {
    return entry.data.bucklingModes
  }
  return snapshot?.bucklingModes || []
}

export function getUtilizationMap(snapshot: VisualizationSnapshot | null): Record<string, number> | null {
  const entry = getExtensionEntry<UtilizationExtensionData>(snapshot, 'builtin.utilization')
  return entry?.data?.memberUtilizationMap || null
}

/**
 * Shared buckling mode selector panel.
 * Pass interactive=true (with onSelect) for a clickable version, or omit for read-only display.
 */
export function BucklingModePanel({
  modes,
  activeIndex,
  title,
  onSelect,
}: {
  modes: BucklingMode[]
  activeIndex: number
  title: string
  onSelect?: (index: number) => void
}): ReactNode {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-4 dark:border-white/10 dark:bg-slate-950/40">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {modes.map((mode, index) => {
          const active = activeIndex === index
          const baseClass = `rounded-full border px-3 py-1.5 text-xs transition ${
            active
              ? 'border-violet-400/50 bg-violet-400/16 text-foreground'
              : 'border-border/70 bg-background/70 text-muted-foreground dark:border-white/10 dark:bg-white/5'
          }`
          const label = `λ${index + 1} = ${mode.lambda.toFixed(3)}`
          if (onSelect) {
            return (
              <button
                key={index}
                className={`${baseClass} hover:text-foreground`}
                onClick={() => onSelect(index)}
                type="button"
              >
                {label}
              </button>
            )
          }
          return (
            <div key={index} className={baseClass}>
              {label}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const visualizationExtensionRegistry: VisualizationExtensionDefinition[] = [
  {
    id: 'builtin.utilization',
    view: 'utilization',
    viewLabelKey: 'visualizationViewUtilization',
    isAvailable: (snapshot) => {
      if (!snapshot) {
        return false
      }
      if (getUtilizationMap(snapshot)) {
        return true
      }
      return snapshot.cases.some((item) =>
        Object.values(item.elementResults).some((result) => typeof result.utilization === 'number')
      )
    },
    getLegend: ({ snapshot, activeCase, t }) => {
      const maxUtilization = Math.max(1, ...snapshot.elements.map((element) => activeCase.elementResults[element.id]?.utilization ?? 0))
      return {
        maxValue: maxUtilization,
        valueScale: 100,
        label: t('visualizationUtilizationRatio'),
        unit: '%',
        colorMode: 'utilization' as const,
      }
    },
  },
  {
    id: 'builtin.buckling',
    view: 'buckling',
    viewLabelKey: 'visualizationViewBuckling',
    isAvailable: (snapshot) => getBucklingModes(snapshot).length > 0,
    renderAside: ({ snapshot, bucklingModeIndex, t }) => {
      const modes = getBucklingModes(snapshot)
      if (!modes.length) {
        return null
      }
      return (
        <BucklingModePanel
          modes={modes}
          activeIndex={bucklingModeIndex}
          title={t('visualizationViewBuckling')}
        />
      )
    },
    getLegend: ({ snapshot, bucklingModeIndex }) => {
      const modes = getBucklingModes(snapshot)
      if (!modes.length) {
        return null
      }
      const mode = modes[bucklingModeIndex] ?? modes[0]
      return {
        maxValue: mode.lambda,
        label: `λ${bucklingModeIndex + 1}`,
        unit: '',
      }
    },
  },
]

export function getAvailableVisualizationExtensions(snapshot: VisualizationSnapshot | null) {
  return visualizationExtensionRegistry.filter((extension) => extension.isAvailable(snapshot))
}

export function getVisualizationViewLabelKey(view: VisualizationViewMode): MessageKey {
  if (view === 'model') return 'visualizationViewModel'
  if (view === 'deformed') return 'visualizationViewDeformed'
  if (view === 'forces') return 'visualizationViewForces'
  if (view === 'reactions') return 'visualizationViewReactions'
  const extension = visualizationExtensionRegistry.find((item) => item.view === view)
  return extension?.viewLabelKey || 'visualizationViewModel'
}

export function getVisualizationExtensionByView(view: VisualizationViewMode) {
  return visualizationExtensionRegistry.find((extension) => extension.view === view) || null
}
