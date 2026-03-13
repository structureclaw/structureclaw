'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MessageKey } from '@/lib/i18n'
import type { AppLocale } from '@/lib/stores/slices/preferences'
import { formatNumber } from '@/lib/utils'
import { VisualizationModalShell } from './modal-shell'
import { StructuralScene } from './structural-scene'
import { VisualizationToolbar } from './toolbar'
import type { VisualizationCase, VisualizationSnapshot, VisualizationViewMode } from './types'

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
  locale,
  onClose,
  t,
}: StructuralVisualizationModalProps) {
  const [view, setView] = useState<VisualizationViewMode>('model')
  const [resetToken, setResetToken] = useState(0)
  const [activeCaseId, setActiveCaseId] = useState('')
  const [deformationScale, setDeformationScale] = useState(12)
  const [forceMetric, setForceMetric] = useState<'axial' | 'shear' | 'moment'>('moment')
  const [showUndeformed, setShowUndeformed] = useState(true)
  const [showNodeLabels, setShowNodeLabels] = useState(false)
  const [showElementLabels, setShowElementLabels] = useState(false)
  const [showLegend, setShowLegend] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !snapshot) {
      return
    }
    setView(snapshot.availableViews[0] || 'model')
    setActiveCaseId(snapshot.defaultCaseId)
    setSelectedNodeId(null)
    setSelectedElementId(null)
  }, [open, snapshot])

  const placeholderTitle = useMemo(
    () => snapshot?.title || t('visualizationTitle'),
    [snapshot, t]
  )
  const activeCase = useMemo<VisualizationCase | null>(
    () => snapshot?.cases.find((item) => item.id === activeCaseId) || snapshot?.cases[0] || null,
    [activeCaseId, snapshot]
  )
  const selectedNode = useMemo(
    () => snapshot?.nodes.find((item) => item.id === selectedNodeId) || null,
    [selectedNodeId, snapshot]
  )
  const selectedElement = useMemo(
    () => snapshot?.elements.find((item) => item.id === selectedElementId) || null,
    [selectedElementId, snapshot]
  )
  const selectedNodeResults = activeCase && selectedNode ? activeCase.nodeResults[selectedNode.id] || null : null
  const selectedElementResults = activeCase && selectedElement ? activeCase.elementResults[selectedElement.id] || null : null

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
              {activeCase?.label || t('visualizationUnavailable')}
            </div>
          </div>
          {snapshot?.unsupportedElementTypes.length ? (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-900 dark:text-amber-100">
              {t('visualizationUnsupportedElements')}: {snapshot.unsupportedElementTypes.join(', ')}
            </div>
          ) : null}
          {selectedNode ? (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 dark:border-white/10 dark:bg-slate-950/40">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('visualizationSelectedNode')}</div>
              <div className="mt-2 text-lg font-semibold text-foreground">{selectedNode.id}</div>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <div>X: {formatNumber(selectedNode.position.x, locale)}</div>
                <div>Y: {formatNumber(selectedNode.position.y, locale)}</div>
                <div>Z: {formatNumber(selectedNode.position.z, locale)}</div>
                {selectedNodeResults?.displacement && (
                  <div>
                    {t('visualizationViewDeformed')}: {formatNumber(
                      Math.sqrt(
                        (selectedNodeResults.displacement.ux || 0) ** 2 +
                        (selectedNodeResults.displacement.uy || 0) ** 2 +
                        (selectedNodeResults.displacement.uz || 0) ** 2
                      ),
                      locale
                    )}
                  </div>
                )}
                {selectedNodeResults?.reaction && (
                  <div>
                    {t('visualizationViewReactions')}: {formatNumber(
                      Math.sqrt(
                        (selectedNodeResults.reaction.fx || 0) ** 2 +
                        (selectedNodeResults.reaction.fy || 0) ** 2 +
                        (selectedNodeResults.reaction.fz || 0) ** 2
                      ),
                      locale
                    )}
                  </div>
                )}
                {selectedNodeResults?.envelope?.controlCase && (
                  <div>{t('visualizationControlCase')}: {String(selectedNodeResults.envelope.controlCase)}</div>
                )}
              </div>
            </div>
          ) : null}
          {selectedElement ? (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 dark:border-white/10 dark:bg-slate-950/40">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('visualizationSelectedElement')}</div>
              <div className="mt-2 text-lg font-semibold text-foreground">{selectedElement.id}</div>
              <div className="mt-1 text-sm text-muted-foreground">{selectedElement.type}</div>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                {typeof selectedElementResults?.axial === 'number' && <div>{t('visualizationForceAxial')}: {formatNumber(selectedElementResults.axial, locale)}</div>}
                {typeof selectedElementResults?.shear === 'number' && <div>{t('visualizationForceShear')}: {formatNumber(selectedElementResults.shear, locale)}</div>}
                {typeof selectedElementResults?.moment === 'number' && <div>{t('visualizationForceMoment')}: {formatNumber(selectedElementResults.moment, locale)}</div>}
                {selectedElementResults?.controlCases?.[forceMetric] && (
                  <div>{t('visualizationControlCase')}: {selectedElementResults.controlCases[forceMetric]}</div>
                )}
              </div>
            </div>
          ) : null}
          {!selectedNode && !selectedElement && (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm leading-6 text-muted-foreground dark:border-white/10 dark:bg-slate-950/40">
              {snapshot ? t('visualizationPickHint') : t('visualizationMissingModel')}
            </div>
          )}
        </div>
      }
    >
      {snapshot && activeCase ? (
        <div className="flex h-full min-h-0 flex-col">
          <VisualizationToolbar
            activeCaseId={activeCase.id}
            deformationScale={deformationScale}
            forceMetric={forceMetric}
            onActiveCaseChange={setActiveCaseId}
            onDeformationScaleChange={setDeformationScale}
            onForceMetricChange={setForceMetric}
            onToggleElementLabels={() => setShowElementLabels((current) => !current)}
            onToggleLegend={() => setShowLegend((current) => !current)}
            onToggleNodeLabels={() => setShowNodeLabels((current) => !current)}
            onToggleUndeformed={() => setShowUndeformed((current) => !current)}
            showElementLabels={showElementLabels}
            showLegend={showLegend}
            showNodeLabels={showNodeLabels}
            showUndeformed={showUndeformed}
            snapshot={snapshot}
            t={t}
          />
          <div className="min-h-0 flex-1" data-testid="visualization-modal-scene">
            <StructuralScene
              activeCase={activeCase}
              deformationScale={deformationScale}
              forceMetric={forceMetric}
              onSelectElement={setSelectedElementId}
              onSelectNode={setSelectedNodeId}
              resetToken={resetToken}
              selectedElementId={selectedElementId}
              selectedNodeId={selectedNodeId}
              showElementLabels={showElementLabels}
              showLegend={showLegend}
              showNodeLabels={showNodeLabels}
              showUndeformed={showUndeformed}
              snapshot={snapshot}
              t={t}
              view={view}
            />
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center px-6 py-10 text-center" data-testid="visualization-modal-placeholder">
          <div className="max-w-xl rounded-[28px] border border-dashed border-cyan-300/35 bg-cyan-300/8 p-8">
            <div className="text-sm uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-200">{t('visualizationTitle')}</div>
            <div className="mt-3 text-2xl font-semibold text-foreground">{t('visualizationUnavailable')}</div>
            <div className="mt-3 text-sm leading-6 text-muted-foreground">{t('visualizationMissingModel')}</div>
          </div>
        </div>
      )}
    </VisualizationModalShell>
  )
}

export default StructuralVisualizationModal
