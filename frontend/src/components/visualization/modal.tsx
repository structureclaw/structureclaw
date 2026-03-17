'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MessageKey } from '@/lib/i18n'
import type { AppLocale } from '@/lib/stores/slices/preferences'
import { formatNumber } from '@/lib/utils'
import { VisualizationModalShell } from './modal-shell'
import { StructuralScene } from './structural-scene'
import { VisualizationToolbar } from './toolbar'
import type { VisualizationCase, VisualizationSnapshot, VisualizationViewMode } from './types'

function getCaseLabel(caseId: string, fallbackLabel: string, t: (key: MessageKey) => string) {
  if (caseId === 'model') return t('visualizationSourceModel')
  if (caseId === 'result') return t('visualizationSourceResult')
  if (caseId === 'envelope') return t('visualizationEnvelope')
  return fallbackLabel
}

function withUnit(value: string, unit?: string) {
  return unit ? `${value} ${unit}` : value
}

function getCaseMaxDisplacementMagnitude(activeCase: VisualizationCase | null) {
  if (!activeCase) {
    return 0
  }
  return Object.values(activeCase.nodeResults).reduce((max, result) => {
    const magnitude = activeCase.kind === 'envelope'
      ? Number(result.envelope?.maxAbsDisplacement || 0)
      : Math.sqrt((result.displacement?.ux || 0) ** 2 + (result.displacement?.uy || 0) ** 2 + (result.displacement?.uz || 0) ** 2)
    return Math.max(max, magnitude)
  }, 0)
}

function getModelSpan(snapshot: VisualizationSnapshot | null) {
  if (!snapshot || snapshot.nodes.length < 2) {
    return 0
  }
  const xs = snapshot.nodes.map((node) => node.position.x)
  const ys = snapshot.nodes.map((node) => node.position.y)
  const zs = snapshot.nodes.map((node) => node.position.z)
  const dx = Math.max(...xs) - Math.min(...xs)
  const dy = Math.max(...ys) - Math.min(...ys)
  const dz = Math.max(...zs) - Math.min(...zs)
  return Math.max(dx, dy, dz)
}

function roundStep(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0.1
  }
  if (value >= 100) return 10
  if (value >= 10) return 1
  if (value >= 1) return 0.1
  return 0.01
}

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
  const [selectedLoadIndex, setSelectedLoadIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!open || !snapshot) {
      return
    }
    setView(snapshot.availableViews[0] || 'model')
    setActiveCaseId(snapshot.defaultCaseId)
    setSelectedNodeId(null)
    setSelectedElementId(null)
    setSelectedLoadIndex(null)
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
  const selectedLoad = selectedLoadIndex !== null && snapshot?.loads ? snapshot.loads[selectedLoadIndex] || null : null
  const selectedElementNodeIds = selectedElement?.nodeIds || []
  const modelOnly = snapshot?.source === 'model'
  const displacementDisplayFactor = snapshot?.displacementDisplayFactor || 1
  const deformationScaleRange = useMemo(() => {
    const modelSpan = getModelSpan(snapshot)
    const maxDisplacement = getCaseMaxDisplacementMagnitude(activeCase)
    if (modelSpan <= 0 || maxDisplacement <= 0) {
      return { min: 1, max: 40, step: 0.1, recommended: 12 }
    }

    const recommendedRaw = (modelSpan * 0.15) / maxDisplacement
    const recommended = Math.min(200000, Math.max(1, recommendedRaw))
    const min = Math.max(1, recommended / 20)
    const max = Math.max(40, recommended * 20)
    const step = roundStep((max - min) / 300)
    return { min, max, step, recommended }
  }, [snapshot, activeCase])

  useEffect(() => {
    if (!open || !snapshot) {
      return
    }
    setDeformationScale(deformationScaleRange.recommended)
  }, [open, snapshot, deformationScaleRange.recommended])

  useEffect(() => {
    setDeformationScale((current) => Math.min(deformationScaleRange.max, Math.max(deformationScaleRange.min, current)))
  }, [deformationScaleRange.min, deformationScaleRange.max])

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
              {activeCase ? getCaseLabel(activeCase.id, activeCase.label, t) : t('visualizationUnavailable')}
            </div>
          </div>
          {snapshot?.statusMessage ? (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-900 dark:text-amber-100">
              {snapshot.statusMessage}
            </div>
          ) : null}
          {snapshot?.unsupportedElementTypes.length ? (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-900 dark:text-amber-100">
              {t('visualizationUnsupportedElements')}: {snapshot.unsupportedElementTypes.join(', ')}
            </div>
          ) : null}
          {snapshot ? (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 dark:border-white/10 dark:bg-slate-950/40">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('visualizationUnits')}</div>
              <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <div>{t('visualizationUnitSystem')}: {snapshot.unitSystem || 'SI'}</div>
                <div>{t('visualizationDisplacement')}: {snapshot.displacementUnit || '-'}</div>
                <div>{t('visualizationReactions')}: {snapshot.resultUnit || '-'}</div>
                <div>{t('visualizationForceMoment')}: {snapshot.momentUnit || '-'}</div>
                <div>{t('visualizationLoadsList')}: {snapshot.nodalLoadUnit || '-'}</div>
                <div>q: {snapshot.distributedLoadUnit || '-'}</div>
              </div>
            </div>
          ) : null}
          {selectedNode ? (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 dark:border-white/10 dark:bg-slate-950/40">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('visualizationSelectedNode')}</div>
              <div className="mt-2 text-lg font-semibold text-foreground">{selectedNode.id}</div>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <div>X: {withUnit(formatNumber(selectedNode.position.x, locale), snapshot?.lengthUnit || snapshot?.nodeLabelUnit)}</div>
                <div>Y: {withUnit(formatNumber(selectedNode.position.y, locale), snapshot?.lengthUnit || snapshot?.nodeLabelUnit)}</div>
                <div>Z: {withUnit(formatNumber(selectedNode.position.z, locale), snapshot?.lengthUnit || snapshot?.nodeLabelUnit)}</div>
                {selectedNode.restraints?.length ? (
                  <div>{t('visualizationSupportRestraints')}: {selectedNode.restraints.map((value) => (value ? '1' : '0')).join(' ')}</div>
                ) : null}
                {!modelOnly && selectedNodeResults?.displacement && (
                  <div>
                    {t('visualizationViewDeformed')}: {withUnit(formatNumber(
                      Math.sqrt(
                        (selectedNodeResults.displacement.ux || 0) ** 2 +
                        (selectedNodeResults.displacement.uy || 0) ** 2 +
                        (selectedNodeResults.displacement.uz || 0) ** 2
                      ) * displacementDisplayFactor,
                      locale
                    ), snapshot?.displacementUnit || snapshot?.nodeLabelUnit)}
                  </div>
                )}
                {!modelOnly && selectedNodeResults?.reaction && (
                  <div>
                    {t('visualizationViewReactions')}: {withUnit(formatNumber(
                      Math.sqrt(
                        (selectedNodeResults.reaction.fx || 0) ** 2 +
                        (selectedNodeResults.reaction.fy || 0) ** 2 +
                        (selectedNodeResults.reaction.fz || 0) ** 2
                      ),
                      locale
                    ), snapshot?.resultUnit)}
                  </div>
                )}
                {!modelOnly && selectedNodeResults?.envelope?.controlCase && (
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
                <div>{t('visualizationConnectedNodes')}: {selectedElementNodeIds.join(' - ')}</div>
                {!modelOnly && typeof selectedElementResults?.axial === 'number' && <div>{t('visualizationForceAxial')}: {withUnit(formatNumber(selectedElementResults.axial, locale), snapshot?.resultUnit)}</div>}
                {!modelOnly && typeof selectedElementResults?.shear === 'number' && <div>{t('visualizationForceShear')}: {withUnit(formatNumber(selectedElementResults.shear, locale), snapshot?.resultUnit)}</div>}
                {!modelOnly && typeof selectedElementResults?.moment === 'number' && <div>{t('visualizationForceMoment')}: {withUnit(formatNumber(selectedElementResults.moment, locale), snapshot?.momentUnit)}</div>}
                {!modelOnly && selectedElementResults?.controlCases?.[forceMetric] && (
                  <div>{t('visualizationControlCase')}: {selectedElementResults.controlCases[forceMetric]}</div>
                )}
              </div>
            </div>
          ) : null}
          {selectedLoad ? (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 dark:border-white/10 dark:bg-slate-950/40">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('visualizationSelectedLoad')}</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {selectedLoad.kind === 'distributed'
                  ? `${selectedLoad.elementId || '-'} · ${t('visualizationElementsList')}`
                  : `${selectedLoad.nodeId} · ${t('visualizationNodesList')}`}
              </div>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <div>X: {withUnit(formatNumber(selectedLoad.vector.x, locale), selectedLoad.kind === 'distributed' ? snapshot?.distributedLoadUnit : snapshot?.nodalLoadUnit)}</div>
                <div>Y: {withUnit(formatNumber(selectedLoad.vector.y, locale), selectedLoad.kind === 'distributed' ? snapshot?.distributedLoadUnit : snapshot?.nodalLoadUnit)}</div>
                <div>Z: {withUnit(formatNumber(selectedLoad.vector.z, locale), selectedLoad.kind === 'distributed' ? snapshot?.distributedLoadUnit : snapshot?.nodalLoadUnit)}</div>
              </div>
            </div>
          ) : null}
          {snapshot ? (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 dark:border-white/10 dark:bg-slate-950/40">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('visualizationObjectList')}</div>
                <button
                  className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground dark:border-white/10 dark:bg-white/5"
                  onClick={() => {
                    setSelectedNodeId(null)
                    setSelectedElementId(null)
                    setSelectedLoadIndex(null)
                  }}
                  type="button"
                >
                  {t('visualizationClearSelection')}
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('visualizationNodesList')}</div>
                  <div className="flex max-h-28 flex-wrap gap-2 overflow-auto">
                    {snapshot.nodes.map((node) => (
                      <button
                        key={node.id}
                        className={`rounded-full border px-3 py-1.5 text-xs transition ${selectedNodeId === node.id ? 'border-cyan-300/50 bg-cyan-300/14 text-foreground' : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-white/5'}`}
                        onClick={() => {
                          setSelectedNodeId(node.id)
                          setSelectedElementId(null)
                          setSelectedLoadIndex(null)
                        }}
                        type="button"
                      >
                        {node.id}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('visualizationElementsList')}</div>
                  <div className="flex max-h-28 flex-wrap gap-2 overflow-auto">
                    {snapshot.elements.map((element) => (
                      <button
                        key={element.id}
                        className={`rounded-full border px-3 py-1.5 text-xs transition ${selectedElementId === element.id ? 'border-cyan-300/50 bg-cyan-300/14 text-foreground' : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-white/5'}`}
                        onClick={() => {
                          setSelectedElementId(element.id)
                          setSelectedNodeId(null)
                          setSelectedLoadIndex(null)
                        }}
                        type="button"
                      >
                        {element.id}
                      </button>
                    ))}
                  </div>
                </div>
                {snapshot.loads.length > 0 ? (
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('visualizationLoadsList')}</div>
                    <div className="flex max-h-28 flex-wrap gap-2 overflow-auto">
                      {snapshot.loads.map((load, index) => (
                        <button
                          key={`${load.caseId || 'default'}-${load.nodeId || load.elementId || index}-${index}`}
                          className={`rounded-full border px-3 py-1.5 text-xs transition ${selectedLoadIndex === index ? 'border-cyan-300/50 bg-cyan-300/14 text-foreground' : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-white/5'}`}
                          onClick={() => {
                            setSelectedLoadIndex(index)
                            setSelectedNodeId(null)
                            setSelectedElementId(null)
                          }}
                          type="button"
                        >
                          {load.kind === 'distributed' ? `${load.elementId || '-'} · q` : `${load.nodeId} · P`}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {!selectedNode && !selectedElement && !selectedLoad && (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm leading-6 text-muted-foreground dark:border-white/10 dark:bg-slate-950/40">
              {snapshot ? `${t('visualizationSceneSelectionHelp')} ${t('visualizationSceneClickEmpty')}` : t('visualizationMissingModel')}
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
            selectedView={view}
            deformationScaleMin={deformationScaleRange.min}
            deformationScaleMax={deformationScaleRange.max}
            deformationScaleStep={deformationScaleRange.step}
            onActiveCaseChange={setActiveCaseId}
            onDeformationScaleChange={setDeformationScale}
            onForceMetricChange={setForceMetric}
            onSwitchToForcesView={() => setView('forces')}
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
              onClearSelection={() => {
                setSelectedElementId(null)
                setSelectedNodeId(null)
                setSelectedLoadIndex(null)
              }}
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
