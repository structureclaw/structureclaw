'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { ArrowUp, Bot, BrainCircuit, Clock3, Cuboid, Database, FileText, Loader2, MessageSquarePlus, Orbit, Sparkles, Trash2, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { buildVisualizationSnapshot } from '@/components/visualization/adapter'
import { StructuralVisualizationModal, type VisualizationSnapshot } from '@/components/visualization'
import { useI18n, type MessageKey } from '@/lib/i18n'
import type { AppLocale } from '@/lib/stores/slices/preferences'
import { fetchLatestModel, type LatestModelResponse } from '@/lib/api'
import { cn, formatDate, formatNumber } from '@/lib/utils'

type AnalysisType = 'static' | 'dynamic' | 'seismic' | 'nonlinear'
type PanelTab = 'analysis' | 'report'
type ComposerAction = 'chat' | 'execute'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'streaming' | 'done' | 'error'
  timestamp: string
}

type AgentInteraction = {
  detectedScenario?: string
  detectedScenarioLabel?: string
  conversationStage?: string
  missingCritical?: string[]
  missingOptional?: string[]
  fallbackSupportNote?: string
  recommendedNextStep?: string
  questions?: Array<{ question?: string; label?: string }>
  pending?: { criticalMissing?: string[]; nonCriticalMissing?: string[] }
}

type AgentResult = {
  response?: string
  traceId?: string
  success?: boolean
  needsModelInput?: boolean
  plan?: string[]
  interaction?: AgentInteraction
  analysis?: Record<string, unknown>
  report?: {
    summary?: string
    markdown?: string
  }
  clarification?: {
    question?: string
    missingFields?: string[]
  }
  model?: Record<string, unknown>
  data?: Record<string, unknown>
  startedAt?: string
  completedAt?: string
  durationMs?: number
  requestedEngineId?: string
}

type StreamPayload =
  | { type: 'start'; content?: { traceId?: string; conversationId?: string; startedAt?: string } }
  | { type: 'token'; content?: string }
  | { type: 'interaction_update'; content?: AgentInteraction }
  | { type: 'result'; content?: AgentResult }
  | { type: 'done' }
  | { type: 'error'; error?: string }

type ConversationSummary = {
  id: string
  title: string
  type?: string
  createdAt?: string
  updatedAt?: string
}

type AgentSessionSnapshot = {
  draft?: Record<string, unknown>
  resolved?: {
    analysisType?: AnalysisType
    designCode?: string
    autoCodeCheck?: boolean
    includeReport?: boolean
    reportFormat?: 'json' | 'markdown' | 'both'
    reportOutput?: 'inline' | 'file'
  }
  interaction?: AgentInteraction
  model?: Record<string, unknown>
  updatedAt?: number
}

type ConversationDetail = ConversationSummary & {
  messages?: Array<{ id: string; role: string; content: string; createdAt: string }>
  session?: AgentSessionSnapshot | null
  snapshots?: {
    modelSnapshot?: VisualizationSnapshot | null
    resultSnapshot?: VisualizationSnapshot | null
    latestResult?: AgentResult | null
  } | null
}

async function saveConversationSnapshotToBackend(
  conversationId: string,
  params: {
    modelSnapshot?: VisualizationSnapshot | null
    resultSnapshot?: VisualizationSnapshot | null
    latestResult?: AgentResult | null
  }
): Promise<void> {
  if (!conversationId) return

  try {
    await fetch(`${API_BASE}/api/v1/chat/conversation/${conversationId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelSnapshot: params.modelSnapshot,
        resultSnapshot: params.resultSnapshot,
        latestResult: params.latestResult,
      }),
    });
  } catch (error) {
    console.warn('Failed to save snapshot to backend:', error);
  }
}

type PersistedConversation = ConversationSummary & {
  messages: Message[]
  modelText?: string
  analysisType?: AnalysisType
  designCode?: string
  selectedSkillIds?: string[]
  selectedEngineId?: string
  modelSyncMessage?: string
  activePanel?: PanelTab
  latestResult?: AgentResult | null
  modelVisualizationSnapshot?: VisualizationSnapshot | null
  resultVisualizationSnapshot?: VisualizationSnapshot | null
  visualizationSnapshot?: VisualizationSnapshot | null
}

type AgentSkillSummary = {
  id: string
  name: { zh?: string; en?: string }
  description: { zh?: string; en?: string }
  structureType?: string
  stages?: string[]
  triggers?: string[]
  autoLoadByDefault?: boolean
}

type SkillDomain =
  | 'structure-type'
  | 'material-constitutive'
  | 'geometry-input'
  | 'load-boundary'
  | 'analysis-strategy'
  | 'code-check'
  | 'result-postprocess'
  | 'visualization'
  | 'report-export'
  | 'generic-fallback'
  | 'unknown'

type CapabilitySkillSummary = {
  id: string
  domain?: SkillDomain
}

type CapabilityDomainSummary = {
  domain: SkillDomain
  skillIds?: string[]
  autoLoadSkillIds?: string[]
}

type AnalysisEngineSummary = {
  id: string
  name?: string
  version?: string
  kind?: string
  capabilities?: string[]
  supportedAnalysisTypes?: string[]
  supportedModelFamilies?: string[]
  available?: boolean
  enabled?: boolean
  visibility?: string
  status?: 'available' | 'unavailable' | 'disabled'
  unavailableReason?: string
  routingHints?: string[]
}

type CapabilityMatrixPayload = {
  skills?: CapabilitySkillSummary[]
  domainSummaries?: CapabilityDomainSummary[]
  skillDomainById?: Record<string, SkillDomain>
  validEngineIdsBySkill?: Record<string, string[]>
  filteredEngineReasonsBySkill?: Record<string, Record<string, string[]>>
}

function normalizeSkillDomain(value: unknown): SkillDomain {
  const raw = typeof value === 'string' ? value : ''
  const supported: SkillDomain[] = [
    'structure-type',
    'material-constitutive',
    'geometry-input',
    'load-boundary',
    'analysis-strategy',
    'code-check',
    'result-postprocess',
    'visualization',
    'report-export',
    'generic-fallback',
  ]
  return supported.includes(raw as SkillDomain) ? (raw as SkillDomain) : 'unknown'
}

function resolveSkillDomainLabel(domain: SkillDomain, t: (key: MessageKey) => string) {
  if (domain === 'structure-type') return t('skillDomainStructureType')
  if (domain === 'material-constitutive') return t('skillDomainMaterialConstitutive')
  if (domain === 'geometry-input') return t('skillDomainGeometryInput')
  if (domain === 'load-boundary') return t('skillDomainLoadBoundary')
  if (domain === 'analysis-strategy') return t('skillDomainAnalysisStrategy')
  if (domain === 'code-check') return t('skillDomainCodeCheck')
  if (domain === 'result-postprocess') return t('skillDomainResultPostprocess')
  if (domain === 'visualization') return t('skillDomainVisualization')
  if (domain === 'report-export') return t('skillDomainReportExport')
  if (domain === 'generic-fallback') return t('skillDomainGenericFallback')
  return t('skillDomainUnknown')
}

function mapCapabilityReasonToText(reason: string, t: (key: MessageKey) => string) {
  if (reason === 'engine_disabled') {
    return t('capabilityReasonEngineDisabled')
  }
  if (reason === 'engine_unavailable') {
    return t('capabilityReasonEngineUnavailable')
  }
  if (reason === 'engine_status_unavailable') {
    return t('capabilityReasonEngineStatusUnavailable')
  }
  if (reason === 'model_family_mismatch') {
    return t('capabilityReasonModelFamilyMismatch')
  }
  if (reason === 'analysis_type_mismatch') {
    return t('capabilityReasonAnalysisTypeMismatch')
  }
  return reason
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const STORAGE_KEY = 'structureclaw.console.conversations'

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function toModelText(model?: Record<string, unknown> | null) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    return ''
  }
  return JSON.stringify(model, null, 2)
}

function toModelFromVisualizationSnapshot(snapshot?: VisualizationSnapshot | null): Record<string, unknown> | null {
  if (!snapshot) {
    return null
  }

  const model: Record<string, unknown> = {
    schema_version: '1.0.0',
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      z: node.position.z,
      ...(Array.isArray(node.restraints) ? { restraints: node.restraints } : {}),
    })),
    elements: snapshot.elements.map((element) => ({
      id: element.id,
      type: element.type,
      nodes: element.nodeIds,
      ...(typeof element.material === 'string' ? { material: element.material } : {}),
      ...(typeof element.section === 'string' ? { section: element.section } : {}),
    })),
  }

  if (Array.isArray(snapshot.loads) && snapshot.loads.length > 0) {
    const grouped = new Map<string, Array<Record<string, unknown>>>()
    snapshot.loads.forEach((load) => {
      const key = load.caseId || 'default'
      const bucket = grouped.get(key) || []
      if (load.kind === 'distributed' && load.elementId) {
        bucket.push({ element: load.elementId, wy: load.vector.y, wz: load.vector.z })
      } else if (load.nodeId) {
        bucket.push({ node: load.nodeId, fx: load.vector.x, fy: load.vector.y, fz: load.vector.z })
      }
      grouped.set(key, bucket)
    })

    const loadCases = Array.from(grouped.entries())
      .filter(([, loads]) => loads.length > 0)
      .map(([id, loads]) => ({ id, loads }))

    if (loadCases.length > 0) {
      model.load_cases = loadCases
    }
  }

  return model
}

function toModelTextFromSnapshot(snapshot?: VisualizationSnapshot | null) {
  return toModelText(toModelFromVisualizationSnapshot(snapshot))
}

function loadConversationArchive(): Record<string, PersistedConversation> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const migrated: Record<string, PersistedConversation> = {}

    Object.entries(parsed as Record<string, PersistedConversation>).forEach(([conversationId, value]) => {
      const archived = value as PersistedConversation
      const normalizedLatestResult = normalizeAgentResultPayload(archived.latestResult || null)
      const preferredStoredResultSnapshot = pickPreferredResultSnapshot(
        archived.resultVisualizationSnapshot,
        archived.visualizationSnapshot
      )
      const synthesizedResultSnapshot = buildResultSnapshotFromResult(
        normalizedLatestResult,
        archived.title || 'Conversation',
        toModelFromVisualizationSnapshot(archived.modelVisualizationSnapshot || preferredStoredResultSnapshot)
      )
      const repairedResultSnapshot = pickPreferredResultSnapshot(preferredStoredResultSnapshot, synthesizedResultSnapshot)

      migrated[conversationId] = {
        ...archived,
        latestResult: normalizedLatestResult,
        resultVisualizationSnapshot: repairedResultSnapshot,
        visualizationSnapshot: repairedResultSnapshot || archived.visualizationSnapshot || null,
      }
    })

    return migrated
  } catch {
    return {}
  }
}

function parseModelJson(modelText: string, t: (key: MessageKey) => string): { model?: Record<string, unknown>; error?: string } {
  const trimmed = modelText.trim()
  if (!trimmed) {
    return {}
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: t('modelJsonMustBeObject') }
    }
    return { model: parsed as Record<string, unknown> }
  } catch (error) {
    return {
      error: error instanceof Error ? `${t('modelJsonParseFailed')}: ${error.message}` : `${t('modelJsonParseFailed')}.`,
    }
  }
}

function buildInteractionMessage(
  payload: Extract<StreamPayload, { type: 'interaction_update' }>,
  t: (key: MessageKey) => string,
  locale: AppLocale
) {
  const questions = payload.content?.questions || []
  const detectedScenario = payload.content?.detectedScenarioLabel
  const conversationStage = payload.content?.conversationStage
  const fallbackSupportNote = payload.content?.fallbackSupportNote
  const recommendedNextStep = payload.content?.recommendedNextStep
  const criticalMissing = payload.content?.pending?.criticalMissing || []
  const lines: string[] = []

  if (detectedScenario) {
    lines.push(`${t('guidanceDetectedScenario')}: ${detectedScenario}`)
  }
  if (conversationStage) {
    lines.push(`${t('guidanceCurrentStage')}: ${conversationStage}`)
  }
  if (fallbackSupportNote) {
    lines.push(fallbackSupportNote)
  }

  if (questions.length > 0) {
    lines.push(...questions
      .map((item) => item.question || item.label)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  }

  if (criticalMissing.length > 0) {
    lines.push(`${t('interactionMissingInfo')}: ${criticalMissing.join(locale === 'zh' ? '、' : ', ')}`)
  }

  if (recommendedNextStep) {
    lines.push(`${t('guidanceRecommendedNextStep')}: ${recommendedNextStep}`)
  }

  return lines.length > 0 ? lines.join('\n') : t('interactionNeedMoreParams')
}

function normalizeAgentResultPayload(result: AgentResult | null | undefined): AgentResult | null {
  if (!result || typeof result !== 'object') {
    return null
  }

  const record = result as Record<string, unknown>
  const wrapped = record.result
  if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    const wrappedRecord = wrapped as Record<string, unknown>
    const hasTopLevelResultData = Boolean(
      result.analysis
      || result.data
      || result.model
      || result.response
      || result.report
    )
    const hasWrappedResultData = Boolean(
      wrappedRecord.analysis
      || wrappedRecord.data
      || wrappedRecord.model
      || wrappedRecord.response
      || wrappedRecord.report
    )
    if (!hasTopLevelResultData && hasWrappedResultData) {
      return wrapped as AgentResult
    }
  }

  return result
}

function extractAnalysis(result: AgentResult | null) {
  if (!result) return null
  const normalized = normalizeAgentResultPayload(result)
  if (!normalized) return null
  if (normalized.analysis && typeof normalized.analysis === 'object') {
    return normalized.analysis
  }
  if (normalized.data && typeof normalized.data === 'object') {
    return normalized.data
  }
  return null
}

function hasAnalysisPayload(result: AgentResult | null | undefined) {
  return Boolean(extractAnalysis(result ?? null))
}

function pickPreferredLatestResult(
  primary: AgentResult | null | undefined,
  secondary: AgentResult | null | undefined
) {
  const normalizedPrimary = normalizeAgentResultPayload(primary ?? null)
  const normalizedSecondary = normalizeAgentResultPayload(secondary ?? null)

  const primaryHasAnalysis = hasAnalysisPayload(normalizedPrimary)
  const secondaryHasAnalysis = hasAnalysisPayload(normalizedSecondary)

  if (primaryHasAnalysis && secondaryHasAnalysis) {
    return normalizedPrimary
  }
  if (primaryHasAnalysis) {
    return normalizedPrimary
  }
  if (secondaryHasAnalysis) {
    return normalizedSecondary
  }

  return normalizedPrimary ?? normalizedSecondary ?? null
}

function buildVisualizationTitle(result: AgentResult | null, conversationTitle: string) {
  const analysis = extractAnalysis(result)
  const meta = analysis && typeof analysis.meta === 'object' && analysis.meta ? (analysis.meta as Record<string, unknown>) : null
  const analysisType = typeof meta?.analysisType === 'string' ? meta.analysisType : typeof analysis?.analysis_type === 'string' ? analysis.analysis_type : ''
  return analysisType ? `${conversationTitle} · ${analysisType}` : conversationTitle
}

function buildModelVisualizationTitle(baseTitle: string, t: (key: MessageKey) => string) {
  return `${baseTitle} · ${t('visualizationSourceModel')}`
}

function snapshotHasResultData(snapshot?: VisualizationSnapshot | null) {
  if (!snapshot || !Array.isArray(snapshot.cases)) {
    return false
  }

  return snapshot.cases.some((item) => {
    const nodeResults = item && typeof item === 'object' && item.nodeResults && typeof item.nodeResults === 'object'
      ? Object.values(item.nodeResults)
      : []
    const elementResults = item && typeof item === 'object' && item.elementResults && typeof item.elementResults === 'object'
      ? Object.values(item.elementResults)
      : []

    const hasNodeResult = nodeResults.some((entry) => {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
      const displacement = record?.displacement && typeof record.displacement === 'object'
        ? (record.displacement as Record<string, unknown>)
        : null
      const reaction = record?.reaction && typeof record.reaction === 'object'
        ? (record.reaction as Record<string, unknown>)
        : null
      const envelope = record?.envelope && typeof record.envelope === 'object'
        ? (record.envelope as Record<string, unknown>)
        : null
      return Boolean(displacement || reaction || envelope)
    })

    const hasElementResult = elementResults.some((entry) => {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
      return Boolean(
        record
        && (
          typeof record.axial === 'number'
          || typeof record.shear === 'number'
          || typeof record.moment === 'number'
          || typeof record.torsion === 'number'
          || (record.envelope && typeof record.envelope === 'object')
        )
      )
    })

    return hasNodeResult || hasElementResult
  })
}

function isResultVisualizationSnapshot(snapshot?: VisualizationSnapshot | null) {
  if (!snapshot) {
    return false
  }
  const hasResultViews = snapshot.availableViews.some((view) => view === 'deformed' || view === 'forces' || view === 'reactions')
  const hasResultData = snapshotHasResultData(snapshot)
  if (snapshot.source === 'result') {
    return true
  }
  // Legacy archives may carry model snapshots with unexpected case kinds.
  // For model-source snapshots, rely on actual result views/data only.
  if (snapshot.source === 'model') {
    return hasResultViews || hasResultData
  }
  return hasResultViews
    || snapshot.cases.some((item) => item.kind === 'result' || item.kind === 'envelope')
    || hasResultData
}

function pickPreferredResultSnapshot(
  primary?: VisualizationSnapshot | null,
  secondary?: VisualizationSnapshot | null
): VisualizationSnapshot | null {
  const primaryIsResult = isResultVisualizationSnapshot(primary)
  const secondaryIsResult = isResultVisualizationSnapshot(secondary)

  if (primaryIsResult && secondaryIsResult) {
    return primary ?? null
  }
  if (primaryIsResult) {
    return primary ?? null
  }
  if (secondaryIsResult) {
    return secondary ?? null
  }
  return primary ?? secondary ?? null
}

function buildResultSnapshotFromResult(
  result: AgentResult | null | undefined,
  title: string,
  fallbackModel?: Record<string, unknown> | null
): VisualizationSnapshot | null {
  const normalizedResult = normalizeAgentResultPayload(result ?? null)
  if (!normalizedResult) {
    return null
  }

  const modelFromResult =
    normalizedResult.model && typeof normalizedResult.model === 'object' && !Array.isArray(normalizedResult.model)
      ? normalizedResult.model
      : null

  return buildVisualizationSnapshot({
    title: buildVisualizationTitle(normalizedResult, title),
    model: modelFromResult ?? fallbackModel ?? null,
    analysis: extractAnalysis(normalizedResult),
    mode: 'analysis-result',
  })
}

function extractSummaryStats(
  analysis: Record<string, unknown> | null,
  t: (key: MessageKey) => string,
  locale: AppLocale
) {
  if (!analysis) return []
  const data = typeof analysis.data === 'object' && analysis.data ? (analysis.data as Record<string, unknown>) : analysis
  const meta = typeof analysis.meta === 'object' && analysis.meta ? (analysis.meta as Record<string, unknown>) : null
  const summary = typeof data.summary === 'object' && data.summary ? (data.summary as Record<string, unknown>) : null

  const stats: Array<{ label: string; value: string }> = []

  const candidatePairs: Array<[string, unknown]> = [
    [t('analysisOverviewCountsNodes'), summary?.nodeCount ?? meta?.nodeCount],
    [t('analysisOverviewCountsElements'), summary?.elementCount ?? meta?.elementCount],
    [t('analysisOverviewCountsLoadCases'), summary?.loadCaseCount ?? meta?.loadCaseCount],
    [t('analysisOverviewCountsCombinations'), summary?.combinationCount ?? meta?.combinationCount],
  ]

  candidatePairs.forEach(([label, value]) => {
    if (typeof value === 'number') {
      stats.push({ label, value: formatNumber(value, locale) })
    }
  })

  return stats
}

function extractEngineLabel(
  analysis: Record<string, unknown> | null,
  result: AgentResult | null,
  t: (key: MessageKey) => string
) {
  if (!analysis) return null
  const meta = typeof analysis.meta === 'object' && analysis.meta ? (analysis.meta as Record<string, unknown>) : null
  if (!meta) return null

  const requestedEngineId = typeof result?.requestedEngineId === 'string' ? result.requestedEngineId.trim() : ''
  const engineName = typeof meta.engineName === 'string' ? meta.engineName.trim() : ''
  const engineVersion = typeof meta.engineVersion === 'string' ? meta.engineVersion.trim() : ''
  const engineId = typeof meta.engineId === 'string' ? meta.engineId.trim() : ''
  const selectionMode = typeof meta.selectionMode === 'string' ? meta.selectionMode.trim() : ''
  const fallbackFrom = typeof meta.fallbackFrom === 'string' ? meta.fallbackFrom.trim() : ''
  const unavailableReason = typeof meta.unavailableReason === 'string' ? meta.unavailableReason.trim() : ''

  if (!engineName && !engineVersion) {
    return null
  }

  const value = engineName && engineVersion ? `${engineName} v${engineVersion}` : engineName || engineVersion
  const modeLabel =
    selectionMode === 'manual'
      ? t('analysisEngineModeManual')
      : selectionMode === 'fallback'
        ? t('analysisEngineModeFallback')
        : t('analysisEngineModeAuto')
  return {
    label: t('analysisEngineLabel'),
    value,
    engineId,
    requestedEngineId,
    modeLabel,
    fallbackFrom,
    unavailableReason,
  }
}

function detectModelFamily(model?: Record<string, unknown>) {
  const elements = Array.isArray(model?.elements) ? model.elements : []
  if (!elements.length) {
    return 'generic'
  }
  const types = new Set(
    elements
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => String(item.type || ''))
  )
  if (types.size > 0 && Array.from(types).every((type) => type === 'truss')) {
    return 'truss'
  }
  if (types.has('beam')) {
    return 'frame'
  }
  return 'generic'
}

function getEngineStatusLabel(
  engine: AnalysisEngineSummary,
  t: (key: MessageKey) => string
) {
  if (engine.status === 'disabled' || engine.enabled === false) {
    return t('engineStatusDisabled')
  }
  if (engine.available === false || engine.status === 'unavailable') {
    return t('engineStatusUnavailable')
  }
  return t('engineStatusAvailable')
}

function getEngineSelectionIssue(
  engine: AnalysisEngineSummary,
  analysisType: AnalysisType,
  modelFamily: string,
  t: (key: MessageKey) => string,
  matrixReasonTexts?: string[]
) {
  if (Array.isArray(matrixReasonTexts) && matrixReasonTexts.length > 0) {
    return matrixReasonTexts.join(', ')
  }
  if (engine.status === 'disabled' || engine.enabled === false) {
    return t('engineStatusDisabled')
  }
  if (engine.available === false || engine.status === 'unavailable') {
    return engine.unavailableReason || t('engineUnavailableGeneric')
  }
  if (engine.supportedAnalysisTypes?.length && !engine.supportedAnalysisTypes.includes(analysisType)) {
    return t('engineUnsupportedAnalysisType')
  }
  if (engine.supportedModelFamilies?.length && !engine.supportedModelFamilies.includes(modelFamily)) {
    return t('engineUnsupportedModelFamily')
  }
  return ''
}

function renderEngineOption(
  engine: AnalysisEngineSummary,
  selected: boolean,
  analysisType: AnalysisType,
  currentModelFamily: string,
  t: (key: MessageKey) => string,
  matrixReasonTextsByEngine: Record<string, string[]>,
  onSelect: (engineId: string) => void
) {
  const issue = getEngineSelectionIssue(engine, analysisType, currentModelFamily, t, matrixReasonTextsByEngine[engine.id])
  const selectable = issue.length === 0

  return (
    <button
      key={engine.id}
      type="button"
      onClick={() => {
        if (selectable) {
          onSelect(engine.id)
        }
      }}
      disabled={!selectable}
      className={cn(
        'rounded-2xl border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60',
        selected
          ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-700 dark:text-cyan-100'
          : 'border-border/70 bg-card/80 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-slate-950/40 dark:hover:text-white'
      )}
    >
      <div className="font-medium text-foreground">
        {engine.name || engine.id}
        {engine.version ? ` v${engine.version}` : ''}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {(engine.kind || 'python')} · {getEngineStatusLabel(engine, t)}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {t('analysisTypeLabel')}: {(engine.supportedAnalysisTypes || []).join(', ') || 'all'}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {t('engineModelFamiliesLabel')}: {(engine.supportedModelFamilies || []).join(', ') || 'generic'}
      </div>
      {issue ? (
        <div className="mt-1 text-xs leading-5 text-amber-600 dark:text-amber-300">{issue}</div>
      ) : null}
    </button>
  )
}

function renderEngineSummary(
  engine: AnalysisEngineSummary,
  analysisType: AnalysisType,
  currentModelFamily: string,
  t: (key: MessageKey) => string,
  matrixReasonTextsByEngine: Record<string, string[]>
) {
  const issue = getEngineSelectionIssue(engine, analysisType, currentModelFamily, t, matrixReasonTextsByEngine[engine.id])

  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950/40">
      <div className="font-medium text-foreground">
        {engine.name || engine.id}
        {engine.version ? ` v${engine.version}` : ''}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {(engine.kind || 'python')} · {getEngineStatusLabel(engine, t)}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {t('analysisTypeLabel')}: {(engine.supportedAnalysisTypes || []).join(', ') || 'all'}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {t('engineModelFamiliesLabel')}: {(engine.supportedModelFamilies || []).join(', ') || 'generic'}
      </div>
      {issue ? (
        <div className="mt-1 text-xs leading-5 text-amber-600 dark:text-amber-300">{issue}</div>
      ) : null}
    </div>
  )
}

function AnalysisPanel({
  result,
  modelVisualizationSnapshot,
  visualizationSnapshot,
  onOpenVisualization,
  activeTab,
  onTabChange,
  t,
  locale,
}: {
  result: AgentResult | null
  modelVisualizationSnapshot: VisualizationSnapshot | null
  visualizationSnapshot: VisualizationSnapshot | null
  onOpenVisualization: (source: 'result' | 'model') => void
  activeTab: PanelTab
  onTabChange: (tab: PanelTab) => void
  t: (key: MessageKey) => string
  locale: AppLocale
}) {
  const analysis = extractAnalysis(result)
  const stats = extractSummaryStats(analysis, t, locale)
  const engineInfo = extractEngineLabel(analysis, result, t)
  const reportMarkdown = result?.report?.markdown?.trim()
  const reportSummary = result?.report?.summary?.trim()
  const guidance = result?.interaction
  const hasVisualizationData = Boolean(visualizationSnapshot || modelVisualizationSnapshot)
  const showVisualizationAction = Boolean(result || visualizationSnapshot)

  return (
    <div
      data-testid="console-output-panel"
      className="flex h-full min-h-[320px] flex-col rounded-[28px] border border-border/70 bg-card/80 backdrop-blur-xl xl:min-h-0 dark:border-white/10 dark:bg-white/5"
    >
      <div className="flex flex-col gap-4 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-start sm:justify-between dark:border-white/10">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-700/80 dark:text-cyan-200/70">{t('workspaceOutput')}</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{t('analysisAndReport')}</h2>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[220px] sm:items-end">
          {showVisualizationAction && (
            <Button
              className="h-11 w-full justify-center rounded-2xl border border-cyan-300/35 bg-cyan-300/10 px-4 text-cyan-800 hover:bg-cyan-300/20 sm:w-auto dark:text-cyan-100"
              disabled={!hasVisualizationData}
              onClick={() => onOpenVisualization('result')}
              title={
                !visualizationSnapshot && !modelVisualizationSnapshot
                  ? t('visualizationMissingModel')
                  : !visualizationSnapshot && modelVisualizationSnapshot
                    ? t('visualizationFallbackToModel')
                    : t('visualizationOpen')
              }
              type="button"
              variant="outline"
            >
              <Cuboid className="h-4 w-4" />
              {!visualizationSnapshot && modelVisualizationSnapshot ? t('visualizationPreviewModel') : t('visualizationOpen')}
            </Button>
          )}
          <div className="grid w-full grid-cols-2 rounded-2xl border border-border/70 bg-background/70 p-1 sm:w-auto dark:border-white/10 dark:bg-white/5">
            <button
              className={cn(
                'rounded-xl px-4 py-2.5 text-sm font-medium transition',
                activeTab === 'analysis'
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => onTabChange('analysis')}
              type="button"
            >
              {t('analysisTab')}
            </button>
            <button
              className={cn(
                'rounded-xl px-4 py-2.5 text-sm font-medium transition',
                activeTab === 'report'
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => onTabChange('report')}
              type="button"
            >
              {t('reportTab')}
            </button>
          </div>
        </div>
      </div>

      <div data-testid="console-output-scroll" className="flex-1 overflow-auto p-5 xl:min-h-0">
        {!result && (
          <Card className="border-border/70 bg-card/85 text-foreground shadow-none dark:border-white/10 dark:bg-slate-950/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-xl">
                <Orbit className="h-5 w-5 text-cyan-500 dark:text-cyan-300" />
                {t('analysisPanelIdleTitle')}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('analysisPanelIdleBody')}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {result && activeTab === 'analysis' && (
          <div className="space-y-4">
            <Card className="border-border/70 bg-card/85 text-foreground shadow-none dark:border-white/10 dark:bg-slate-950/50">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-emerald-400/30 bg-emerald-400/15 text-emerald-200" variant="outline">
                    {result.success ? t('analysisDone') : result.needsModelInput ? t('needsMoreInfo') : t('returnedResult')}
                  </Badge>
                  {!visualizationSnapshot && (
                    <Badge className="border-amber-300/30 bg-amber-300/10 text-amber-800 dark:text-amber-200" variant="outline">
                      {modelVisualizationSnapshot ? t('visualizationFallbackToModel') : t('visualizationMissingModel')}
                    </Badge>
                  )}
                  {result.traceId && (
                    <Badge className="border-border/70 bg-background/70 text-muted-foreground dark:border-white/10 dark:bg-white/5" variant="outline">
                      Trace {result.traceId.slice(0, 8)}
                    </Badge>
                  )}
                  {typeof result.durationMs === 'number' && (
                    <Badge className="border-cyan-400/30 bg-cyan-400/10 text-cyan-200" variant="outline">
                      {result.durationMs} ms
                    </Badge>
                  )}
                </div>
                <div>
                  <CardTitle className="text-xl text-foreground">{t('executionSummary')}</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {result.response || t('noNaturalLanguageSummary')}
                  </CardDescription>
                </div>
              </CardHeader>
              {(stats.length > 0 || result.plan?.length) && (
                <CardContent className="space-y-4">
                  {engineInfo && (
                    <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 p-4 dark:border-cyan-200/20 dark:bg-cyan-300/5">
                      <div className="text-xs uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-200">{engineInfo.label}</div>
                      <div className="mt-2 text-base font-semibold text-foreground">{engineInfo.value}</div>
                      <div className="mt-2 text-sm text-muted-foreground">{engineInfo.modeLabel}</div>
                      {engineInfo.requestedEngineId ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t('analysisEngineRequestedLabel')} {engineInfo.requestedEngineId}
                        </div>
                      ) : null}
                      {engineInfo.engineId ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t('analysisEngineActualLabel')} {engineInfo.engineId}
                        </div>
                      ) : null}
                      {engineInfo.fallbackFrom ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t('analysisEngineFallbackFrom')} {engineInfo.fallbackFrom}
                        </div>
                      ) : null}
                      {engineInfo.unavailableReason ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {engineInfo.unavailableReason}
                        </div>
                      ) : null}
                    </div>
                  )}
                  {stats.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {stats.map((item) => (
                        <div key={item.label} className="rounded-2xl border border-border/70 bg-background/70 p-4 dark:border-white/10 dark:bg-white/5">
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                          <div className="mt-2 text-2xl font-semibold text-foreground">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.plan?.length ? (
                    <div className="rounded-2xl border border-border/70 bg-background/70 p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="mb-3 text-sm font-medium text-foreground">{t('executionPath')}</div>
                      <ol className="space-y-2 text-sm text-muted-foreground">
                        {result.plan.map((step, index) => (
                          <li key={`${index}-${step}`} className="flex gap-3">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-[11px] text-cyan-700 dark:text-cyan-200">
                              {index + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </CardContent>
              )}
            </Card>

            {result.clarification?.question && (
              <Card className="border-amber-300/30 bg-amber-100/70 text-amber-950 shadow-none dark:bg-amber-300/10 dark:text-amber-50">
                <CardHeader>
                  <CardTitle className="text-lg">{t('clarificationTitle')}</CardTitle>
                  <CardDescription className="text-amber-900/80 dark:text-amber-100/80">
                    {result.clarification.question}
                  </CardDescription>
                </CardHeader>
                {result.clarification.missingFields?.length ? (
                  <CardContent className="flex flex-wrap gap-2">
                    {result.clarification.missingFields.map((field) => (
                      <Badge key={field} className="border-amber-300/40 bg-amber-50/80 text-amber-950 dark:border-amber-200/20 dark:bg-black/10 dark:text-amber-50" variant="outline">
                        {field}
                      </Badge>
                    ))}
                  </CardContent>
                ) : null}
              </Card>
            )}

            {guidance && (
              <Card
                data-testid="console-guidance-panel"
                className="border-border/70 bg-card/85 text-foreground shadow-none dark:border-white/10 dark:bg-slate-950/50"
              >
                <CardHeader>
                  <CardTitle className="text-lg">{t('guidancePanelTitle')}</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {result.response || t('guidancePanelBody')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {guidance.detectedScenarioLabel && (
                      <div className="rounded-2xl border border-border/70 bg-background/70 p-4 dark:border-white/10 dark:bg-white/5">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('guidanceDetectedScenario')}</div>
                        <div className="mt-2 text-base font-semibold text-foreground">{guidance.detectedScenarioLabel}</div>
                      </div>
                    )}
                    {guidance.conversationStage && (
                      <div className="rounded-2xl border border-border/70 bg-background/70 p-4 dark:border-white/10 dark:bg-white/5">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('guidanceCurrentStage')}</div>
                        <div className="mt-2 text-base font-semibold text-foreground">{guidance.conversationStage}</div>
                      </div>
                    )}
                  </div>

                  {guidance.fallbackSupportNote && (
                    <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 p-4 text-sm leading-6 text-foreground">
                      <div className="mb-2 text-xs uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-200">{t('guidanceSupportNote')}</div>
                      <div>{guidance.fallbackSupportNote}</div>
                    </div>
                  )}

                  {guidance.missingCritical?.length ? (
                    <div>
                      <div className="mb-3 text-sm font-medium text-foreground">{t('guidanceMissingCritical')}</div>
                      <div className="flex flex-wrap gap-2">
                        {guidance.missingCritical.map((field) => (
                          <Badge key={field} className="border-amber-300/40 bg-amber-100/80 text-amber-950 dark:border-amber-200/20 dark:bg-amber-300/10 dark:text-amber-50" variant="outline">
                            {field}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {guidance.missingOptional?.length ? (
                    <div>
                      <div className="mb-3 text-sm font-medium text-foreground">{t('guidanceMissingOptional')}</div>
                      <div className="flex flex-wrap gap-2">
                        {guidance.missingOptional.map((field) => (
                          <Badge key={field} className="border-border/70 bg-background/70 text-muted-foreground dark:border-white/10 dark:bg-white/5" variant="outline">
                            {field}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {guidance.recommendedNextStep && (
                    <div className="rounded-2xl border border-border/70 bg-background/70 p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{t('guidanceRecommendedNextStep')}</div>
                      <div className="text-sm leading-6 text-foreground">{guidance.recommendedNextStep}</div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {analysis && (
              <Card className="border-border/70 bg-card/85 text-foreground shadow-none dark:border-white/10 dark:bg-slate-950/50">
                <CardHeader>
                  <CardTitle className="text-lg">{t('structuredResult')}</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {t('structuredResultDesc')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-2xl border border-border/70 bg-muted/60 p-4 text-xs leading-6 text-cyan-900 dark:border-white/10 dark:bg-black/30 dark:text-cyan-100">
                    {JSON.stringify(analysis, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {result && activeTab === 'report' && (
          <div className="space-y-4">
            {reportSummary && (
              <Card className="border-border/70 bg-card/85 text-foreground shadow-none dark:border-white/10 dark:bg-slate-950/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FileText className="h-5 w-5 text-cyan-500 dark:text-cyan-300" />
                    {t('reportSummary')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-7 text-muted-foreground">
                  {reportSummary}
                </CardContent>
              </Card>
            )}

            <Card className="border-border/70 bg-card/85 text-foreground shadow-none dark:border-white/10 dark:bg-slate-950/50">
              <CardHeader>
                <CardTitle className="text-lg">{t('markdownReport')}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('markdownReportDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportMarkdown ? (
                  <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-code:text-cyan-700 dark:prose-code:text-cyan-200">
                    <ReactMarkdown>{reportMarkdown}</ReactMarkdown>
                  </article>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/5">
                    {t('noReportBody')}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

export function AIConsole() {
  const { t, locale } = useI18n()
  const initialAssistantMessage = useMemo<Message>(() => ({
    id: 'welcome',
    role: 'assistant',
    content: t('welcomeMessage'),
    status: 'done',
    timestamp: new Date().toISOString(),
  }), [t])
  const quickPrompts = useMemo(
    () => [t('quickPrompt1'), t('quickPrompt2'), t('quickPrompt3')],
    [t]
  )
  const analysisTypeOptions = useMemo<Array<{ value: AnalysisType; label: string }>>(
    () => [
      { value: 'static', label: t('analysisTypeStatic') },
      { value: 'dynamic', label: t('analysisTypeDynamic') },
      { value: 'seismic', label: t('analysisTypeSeismic') },
      { value: 'nonlinear', label: t('analysisTypeNonlinear') },
    ],
    [t]
  )
  const [messages, setMessages] = useState<Message[]>([initialAssistantMessage])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [serverConversations, setServerConversations] = useState<ConversationSummary[]>([])
  const [conversationArchive, setConversationArchive] = useState<Record<string, PersistedConversation>>({})
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false)
  const [engineSettingsOpen, setEngineSettingsOpen] = useState(false)
  const [enginePickerOpen, setEnginePickerOpen] = useState(false)
  const [modelText, setModelText] = useState('')
  const [modelSyncMessage, setModelSyncMessage] = useState('')
  const [isAutoLoadingModel, setIsAutoLoadingModel] = useState(false)
  const [designCode, setDesignCode] = useState('GB50017')
  const [analysisType, setAnalysisType] = useState<AnalysisType>('static')
  const [availableSkills, setAvailableSkills] = useState<AgentSkillSummary[]>([])
  const [availableEngines, setAvailableEngines] = useState<AnalysisEngineSummary[]>([])
  const [capabilityMatrix, setCapabilityMatrix] = useState<CapabilityMatrixPayload | null>(null)
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [selectedEngineId, setSelectedEngineId] = useState('auto')
  const [latestResult, setLatestResult] = useState<AgentResult | null>(null)
  const [latestModelVisualizationSnapshot, setLatestModelVisualizationSnapshot] = useState<VisualizationSnapshot | null>(null)
  const [latestResultVisualizationSnapshot, setLatestResultVisualizationSnapshot] = useState<VisualizationSnapshot | null>(null)
  const [visualizationOpen, setVisualizationOpen] = useState(false)
  const [visualizationSource, setVisualizationSource] = useState<'model' | 'result'>('result')
  const [activePanel, setActivePanel] = useState<PanelTab>('analysis')
  const [pendingDeleteConversationId, setPendingDeleteConversationId] = useState('')
  const [deletingConversationId, setDeletingConversationId] = useState('')
  const [conversationActivityAt, setConversationActivityAt] = useState<Record<string, string>>({})
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  // 追踪最后有效的结果用于持久化（不会被引擎切换清除）
  const lastValidResultRef = useRef<AgentResult | null>(null)
  const lastValidResultVisualizationRef = useRef<VisualizationSnapshot | null>(null)

  // 保持 refs 与最新有效结果同步
  useEffect(() => {
    if (latestResult) {
      lastValidResultRef.current = latestResult
    }
  }, [latestResult])

  useEffect(() => {
    if (latestResultVisualizationSnapshot) {
      lastValidResultVisualizationRef.current = latestResultVisualizationSnapshot
    }
  }, [latestResultVisualizationSnapshot])

  const defaultSkillIds = useMemo(
    () => availableSkills.filter((skill) => skill.autoLoadByDefault).map((skill) => skill.id),
    [availableSkills]
  )

  const skillDomainById = useMemo<Record<string, SkillDomain>>(() => {
    const map: Record<string, SkillDomain> = {}
    const matrixMap = capabilityMatrix?.skillDomainById
    if (matrixMap && typeof matrixMap === 'object') {
      Object.entries(matrixMap).forEach(([skillId, domain]) => {
        map[skillId] = normalizeSkillDomain(domain)
      })
    }

    const matrixSkills = Array.isArray(capabilityMatrix?.skills) ? capabilityMatrix.skills : []
    matrixSkills.forEach((skill) => {
      if (!skill || typeof skill !== 'object' || typeof skill.id !== 'string') {
        return
      }
      if (!map[skill.id]) {
        map[skill.id] = normalizeSkillDomain(skill.domain)
      }
    })

    availableSkills.forEach((skill) => {
      if (!map[skill.id]) {
        map[skill.id] = 'unknown'
      }
    })

    return map
  }, [availableSkills, capabilityMatrix])

  const groupedSkills = useMemo(() => {
    const domainOrder = new Map<string, number>()
    ;(capabilityMatrix?.domainSummaries || []).forEach((summary, index) => {
      const domain = normalizeSkillDomain(summary?.domain)
      if (!domainOrder.has(domain)) {
        domainOrder.set(domain, index)
      }
    })

    const bucket = new Map<SkillDomain, AgentSkillSummary[]>()
    availableSkills.forEach((skill) => {
      const domain = skillDomainById[skill.id] || 'unknown'
      const list = bucket.get(domain) || []
      list.push(skill)
      bucket.set(domain, list)
    })

    const selectedSet = new Set(selectedSkillIds)
    return Array.from(bucket.entries())
      .map(([domain, skills]) => {
        const sorted = [...skills].sort((a, b) => {
          const left = locale === 'zh' ? (a.name.zh || a.id) : (a.name.en || a.id)
          const right = locale === 'zh' ? (b.name.zh || b.id) : (b.name.en || b.id)
          return left.localeCompare(right)
        })
        const skillIds = sorted.map((skill) => skill.id)
        const selectedCount = skillIds.filter((id) => selectedSet.has(id)).length
        return {
          domain,
          label: resolveSkillDomainLabel(domain, t),
          skills: sorted,
          skillIds,
          selectedCount,
        }
      })
      .sort((a, b) => {
        const left = domainOrder.has(a.domain) ? domainOrder.get(a.domain)! : Number.MAX_SAFE_INTEGER
        const right = domainOrder.has(b.domain) ? domainOrder.get(b.domain)! : Number.MAX_SAFE_INTEGER
        if (left !== right) {
          return left - right
        }
        return a.label.localeCompare(b.label)
      })
  }, [availableSkills, capabilityMatrix, locale, selectedSkillIds, skillDomainById, t])

  useEffect(() => {
    setMessages((current) => {
      if (current.length !== 1 || current[0]?.id !== 'welcome') {
        return current
      }
      return [initialAssistantMessage]
    })
  }, [initialAssistantMessage])

  const mergedConversations = useMemo(() => {
    const map = new Map<string, ConversationSummary>()

    serverConversations.forEach((conversation) => {
      map.set(conversation.id, conversation)
    })

    Object.values(conversationArchive).forEach((conversation) => {
      const current = map.get(conversation.id)
      if (!current) {
        map.set(conversation.id, conversation)
        return
      }

      const currentUpdatedAt = current.updatedAt || current.createdAt || ''
      const archiveUpdatedAt = conversation.updatedAt || conversation.createdAt || ''
      if (archiveUpdatedAt > currentUpdatedAt) {
        map.set(conversation.id, { ...current, ...conversation })
      }
    })

    return Array.from(map.values()).sort((a, b) => {
      const left = b.updatedAt || b.createdAt || ''
      const right = a.updatedAt || a.createdAt || ''
      return left.localeCompare(right)
    })
  }, [conversationArchive, serverConversations])

  useEffect(() => {
    const chatScrollElement = chatScrollRef.current
    if (!chatScrollElement) {
      return
    }

    const handleScroll = () => {
      const distanceFromBottom =
        chatScrollElement.scrollHeight - chatScrollElement.scrollTop - chatScrollElement.clientHeight
      shouldStickToBottomRef.current = distanceFromBottom < 48
    }

    handleScroll()
    chatScrollElement.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      chatScrollElement.removeEventListener('scroll', handleScroll)
    }
  }, [])

  useEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return
    }

    const chatScrollElement = chatScrollRef.current
    if (!chatScrollElement) {
      return
    }

    if (typeof chatScrollElement.scrollTo === 'function') {
      chatScrollElement.scrollTo({
        top: chatScrollElement.scrollHeight,
        behavior: isSending ? 'auto' : 'smooth',
      })
      return
    }

    chatScrollElement.scrollTop = chatScrollElement.scrollHeight
  }, [messages, isSending])

  useEffect(() => {
    setConversationArchive(loadConversationArchive())
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationArchive))
  }, [conversationArchive])

  useEffect(() => {
    let active = true

    async function loadSkills() {
      try {
        const response = await fetch(`${API_BASE}/api/v1/agent/skills`)
        if (!response.ok) {
          return
        }
        const payload = await response.json()
        if (!active || !Array.isArray(payload)) {
          return
        }
        const skills = payload as AgentSkillSummary[]
        setAvailableSkills(skills)
        setSelectedSkillIds((current) => (current.length > 0 ? current : skills.filter((skill) => skill.autoLoadByDefault).map((skill) => skill.id)))
      } catch {
        if (active) {
          setAvailableSkills([])
        }
      }
    }

    loadSkills()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadCapabilityMatrix() {
      try {
        const response = await fetch(`${API_BASE}/api/v1/agent/capability-matrix?analysisType=${encodeURIComponent(analysisType)}`)
        if (!response.ok) {
          return
        }
        const payload = await response.json()
        if (!active || !payload || typeof payload !== 'object') {
          return
        }
        setCapabilityMatrix(payload as CapabilityMatrixPayload)
      } catch {
        if (active) {
          setCapabilityMatrix(null)
        }
      }
    }

    loadCapabilityMatrix()

    return () => {
      active = false
    }
  }, [analysisType])

  useEffect(() => {
    let active = true

    async function loadEngines() {
      try {
        const response = await fetch(`${API_BASE}/api/v1/analysis-engines`)
        if (!response.ok) {
          return
        }
        const payload = await response.json()
        const engines = Array.isArray(payload?.engines) ? (payload.engines as AnalysisEngineSummary[]) : []
        if (!active) {
          return
        }
        setAvailableEngines(engines)
      } catch {
        if (active) {
          setAvailableEngines([])
        }
      }
    }

    loadEngines()

    return () => {
      active = false
    }
  }, [])

  // Auto-load latest model from database when conversation changes and model is empty
  useEffect(() => {
    let active = true

    async function loadLatestModel() {
      // Keep existing conversations stable; auto-load is only for new empty drafts.
      if (conversationId) {
        return
      }
      // Only auto-load if current modelText is empty
      if (modelText) return

      setIsAutoLoadingModel(true)
      try {
        const result = await fetchLatestModel()
        if (!active || !result?.model) {
          setIsAutoLoadingModel(false)
          return
        }

        const modelJson = result.model as Record<string, unknown>
        const modelJsonText = JSON.stringify(modelJson, null, 2)

        // Set the model text, then stop loading after a small delay
        setModelText(modelJsonText)
        const modelAutoLoadedLabel = t('modelAutoLoaded')
        setModelSyncMessage(
          modelAutoLoadedLabel.includes('{modelName}')
            ? modelAutoLoadedLabel.split('{modelName}').join(result.name)
            : `${modelAutoLoadedLabel} ${result.name}`
        )

        // Stop loading after model is set
        setTimeout(() => {
          if (!active) return
          setIsAutoLoadingModel(false)
        }, 100)
      } catch (error) {
        console.error('[AI Console] Failed to auto-load model:', error)
        setIsAutoLoadingModel(false)
      }
    }

    void loadLatestModel()

    return () => {
      active = false
    }
  }, [conversationId, modelText, t])

  useEffect(() => {
    let cancelled = false

    async function fetchConversations() {
      setHistoryLoading(true)
      setHistoryError('')

      try {
        const response = await fetch(`${API_BASE}/api/v1/chat/conversations`)
        if (!response.ok) {
          throw new Error(`${t('loadConversationFailed')}: HTTP ${response.status}`)
        }
        const payload = await response.json()
        if (!cancelled) {
          setServerConversations(Array.isArray(payload) ? (payload as ConversationSummary[]) : [])
        }
      } catch (error) {
        if (!cancelled) {
          setHistoryError(error instanceof Error ? error.message : `${t('loadConversationFailed')}.`)
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false)
        }
      }
    }

    void fetchConversations()

    return () => {
      cancelled = true
    }
  }, [t])

  const parsedComposerModelState = useMemo(() => {
    const result = parseModelJson(modelText, t)
    // Debug logging for model parsing
    if (modelText && result.model) {
      console.log('[AI Console] Parsed model:', {
        hasNodes: 'nodes' in result.model,
        nodesCount: Array.isArray(result.model.nodes) ? result.model.nodes.length : 0,
        hasElements: 'elements' in result.model,
        elementsCount: Array.isArray(result.model.elements) ? result.model.elements.length : 0,
      })
    }
    return result
  }, [modelText, t])
  const parsedComposerModel = parsedComposerModelState.model
  const parsedComposerModelError = parsedComposerModelState.error || ''

  const currentModelFamily = useMemo(() => detectModelFamily(parsedComposerModel), [parsedComposerModel])
  const modelPreviewBaseTitle = useMemo(
    () =>
      messages.find((message) => message.role === 'user')?.content.slice(0, 48)
      || mergedConversations.find((conversation) => conversation.id === conversationId)?.title
      || t('untitledConversation'),
    [conversationId, mergedConversations, messages, t]
  )

  useEffect(() => {
    if (!parsedComposerModel) {
      console.log('[AI Console] Visualization effect: No parsedComposerModel, skipping snapshot')
      return
    }

    const snapshot = buildVisualizationSnapshot({
      title: buildModelVisualizationTitle(modelPreviewBaseTitle, t),
      model: parsedComposerModel,
      mode: 'model-only',
    })
    console.log('[AI Console] Setting model visualization snapshot:', snapshot ? 'success' : 'null')
    setLatestModelVisualizationSnapshot(snapshot)
    // 保存模型快照到后端
    if (snapshot && conversationId) {
      saveConversationSnapshotToBackend(conversationId, {
        modelSnapshot: snapshot,
      })
    }
  }, [modelPreviewBaseTitle, parsedComposerModel, t])

  const activeVisualizationSnapshot = useMemo(() => {
    if (visualizationSource === 'model') {
      if (!latestModelVisualizationSnapshot) {
        return null
      }
      return {
        ...latestModelVisualizationSnapshot,
        statusMessage: parsedComposerModelError ? t('visualizationUsingLastValidModel') : latestModelVisualizationSnapshot.statusMessage,
      }
    }
    if (latestResultVisualizationSnapshot) {
      return latestResultVisualizationSnapshot
    }
    if (!latestModelVisualizationSnapshot) {
      return null
    }
    return {
      ...latestModelVisualizationSnapshot,
      statusMessage: t('visualizationFallbackToModel'),
    }
  }, [latestModelVisualizationSnapshot, latestResultVisualizationSnapshot, parsedComposerModelError, t, visualizationSource])

  const enabledEngines = useMemo(
    () => availableEngines.filter((engine) => engine.enabled !== false),
    [availableEngines]
  )

  const matrixCompatibleEngineIds = useMemo<Set<string> | null>(() => {
    const matrix = capabilityMatrix?.validEngineIdsBySkill
    if (!matrix || typeof matrix !== 'object') {
      return null
    }

    const targetSkillIds = selectedSkillIds.length > 0 ? selectedSkillIds : defaultSkillIds
    let intersection: Set<string> | null = null

    for (const skillId of targetSkillIds) {
      const validIds = matrix[skillId]
      if (!Array.isArray(validIds) || validIds.length === 0) {
        continue
      }
      const current = new Set(validIds)
      if (!intersection) {
        intersection = current
        continue
      }
      intersection = new Set(Array.from(intersection).filter((id) => current.has(id)))
    }

    return intersection
  }, [capabilityMatrix, defaultSkillIds, selectedSkillIds])

  const compatibleEnabledEngines = useMemo(() => {
    if (!matrixCompatibleEngineIds) {
      return enabledEngines
    }
    return enabledEngines.filter((engine) => matrixCompatibleEngineIds.has(engine.id))
  }, [enabledEngines, matrixCompatibleEngineIds])

  const engineCandidatesFilteredBySkills = matrixCompatibleEngineIds !== null

  const matrixReasonTextsByEngine = useMemo<Record<string, string[]>>(() => {
    const targetSkillIds = selectedSkillIds.length > 0 ? selectedSkillIds : defaultSkillIds
    const reasonsBySkill = capabilityMatrix?.filteredEngineReasonsBySkill
    if (!reasonsBySkill || targetSkillIds.length === 0) {
      return {}
    }

    const map: Record<string, string[]> = {}
    for (const skillId of targetSkillIds) {
      const byEngine = reasonsBySkill[skillId]
      if (!byEngine || typeof byEngine !== 'object') {
        continue
      }
      for (const [engineId, reasonCodes] of Object.entries(byEngine)) {
        if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
          continue
        }
        const bucket = new Set(map[engineId] || [])
        reasonCodes.forEach((reason) => bucket.add(mapCapabilityReasonToText(reason, t)))
        map[engineId] = Array.from(bucket)
      }
    }

    return map
  }, [capabilityMatrix, defaultSkillIds, selectedSkillIds, t])

  const filteredOutEngineDetails = useMemo(() => {
    if (!matrixCompatibleEngineIds) {
      return [] as Array<{ id: string; name: string; reasons: string[] }>
    }

    const details: Array<{ id: string; name: string; reasons: string[] }> = []
    const enabledById = new Map(enabledEngines.map((engine) => [engine.id, engine]))

    for (const [engineId, engine] of enabledById.entries()) {
      if (matrixCompatibleEngineIds.has(engineId)) {
        continue
      }
      const reasonTexts = matrixReasonTextsByEngine[engineId]
      if (!Array.isArray(reasonTexts) || reasonTexts.length === 0) {
        continue
      }
      details.push({
        id: engineId,
        name: engine.name || engineId,
        reasons: reasonTexts,
      })
    }

    return details
  }, [enabledEngines, matrixCompatibleEngineIds, matrixReasonTextsByEngine])

  useEffect(() => {
    if (selectedEngineId === 'auto') {
      return
    }
    if (!compatibleEnabledEngines.some((engine) => engine.id === selectedEngineId)) {
      setSelectedEngineId('auto')
    }
  }, [compatibleEnabledEngines, selectedEngineId])

  const selectedEngineSummary = useMemo(
    () => compatibleEnabledEngines.find((engine) => engine.id === selectedEngineId) || null,
    [compatibleEnabledEngines, selectedEngineId]
  )
  const currentEngineSummary = useMemo(
    () => compatibleEnabledEngines.find((engine) => engine.id === selectedEngineId) || null,
    [compatibleEnabledEngines, selectedEngineId]
  )
  const candidateEngines = useMemo(
    () => compatibleEnabledEngines.filter((engine) => engine.id !== selectedEngineId),
    [compatibleEnabledEngines, selectedEngineId]
  )

  useEffect(() => {
    if (contextOpen) {
      setAnalysisSettingsOpen(false)
    } else {
      setAnalysisSettingsOpen(false)
      setEngineSettingsOpen(false)
    }
    setEnginePickerOpen(false)
  }, [contextOpen])

  useEffect(() => {
    if (!conversationId) {
      return
    }

    setConversationArchive((current) => ({
      ...current,
      [conversationId]: {
        id: conversationId,
        title:
          current[conversationId]?.title
          || serverConversations.find((conversation) => conversation.id === conversationId)?.title
          || messages.find((message) => message.role === 'user')?.content.slice(0, 48)
          || t('untitledConversation'),
        type: 'analysis',
        createdAt:
          current[conversationId]?.createdAt
          || serverConversations.find((conversation) => conversation.id === conversationId)?.createdAt
          || new Date().toISOString(),
        updatedAt:
          conversationActivityAt[conversationId]
          || current[conversationId]?.updatedAt
          || serverConversations.find((conversation) => conversation.id === conversationId)?.updatedAt
          || current[conversationId]?.createdAt
          || serverConversations.find((conversation) => conversation.id === conversationId)?.createdAt
          || new Date().toISOString(),
        messages,
        modelText,
        analysisType,
        designCode,
        selectedSkillIds,
        selectedEngineId,
        modelSyncMessage,
        activePanel,
        // Preserve persisted result/model snapshots during transient null states (e.g. refresh restore sequence).
        latestResult: latestResult ?? current[conversationId]?.latestResult ?? null,
        modelVisualizationSnapshot:
          latestModelVisualizationSnapshot
          ?? current[conversationId]?.modelVisualizationSnapshot
          ?? null,
        resultVisualizationSnapshot:
          latestResultVisualizationSnapshot
          ?? current[conversationId]?.resultVisualizationSnapshot
          ?? current[conversationId]?.visualizationSnapshot
          ?? null,
      },
    }))
  }, [
    activePanel,
    analysisType,
    conversationId,
    designCode,
    latestModelVisualizationSnapshot,
    latestResult,
    latestResultVisualizationSnapshot,
    messages,
    modelSyncMessage,
    modelText,
    selectedEngineId,
    selectedSkillIds,
    conversationActivityAt,
    serverConversations,
    t,
  ])

  async function ensureConversation(seedMessage: string) {
    if (conversationId) {
      return conversationId
    }

    const response = await fetch(`${API_BASE}/api/v1/chat/conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: seedMessage.slice(0, 48),
        type: 'analysis',
        locale,
      }),
    })

    if (!response.ok) {
      throw new Error(`${t('createConversationFailed')}: HTTP ${response.status}`)
    }

    const payload = await response.json()
    if (!payload?.id) {
      throw new Error(t('missingConversationId'))
    }

    const nextConversation: ConversationSummary = {
      id: payload.id as string,
      title: (payload.title as string) || seedMessage.slice(0, 48),
      type: (payload.type as string) || 'analysis',
      createdAt: payload.createdAt as string | undefined,
      updatedAt: payload.updatedAt as string | undefined,
    }

    setServerConversations((current) => {
      const deduped = current.filter((conversation) => conversation.id !== nextConversation.id)
      return [nextConversation, ...deduped]
    })
    setConversationId(payload.id)
    return payload.id as string
  }

  function toggleSkill(skillId: string) {
    setSelectedSkillIds((current) => (
      current.includes(skillId)
        ? current.filter((item) => item !== skillId)
        : [...current, skillId]
    ))
  }

  function toggleSkillDomain(skillIds: string[]) {
    if (skillIds.length === 0) {
      return
    }
    setSelectedSkillIds((current) => {
      const allSelected = skillIds.every((skillId) => current.includes(skillId))
      if (allSelected) {
        return current.filter((skillId) => !skillIds.includes(skillId))
      }
      return Array.from(new Set([...current, ...skillIds]))
    })
  }

  function appendMessage(message: Message) {
    setMessages((current) => [...current, message])
  }

  function markConversationActivity(targetConversationId: string | undefined) {
    if (!targetConversationId) {
      return
    }

    setConversationActivityAt((current) => ({
      ...current,
      [targetConversationId]: new Date().toISOString(),
    }))
  }

  function replaceMessage(messageId: string, updater: (message: Message) => Message) {
    setMessages((current) => current.map((message) => (message.id === messageId ? updater(message) : message)))
  }

  function persistConversationSnapshotsToArchive(
    targetConversationId: string,
    params: {
      latestResult?: AgentResult | null
      modelSnapshot?: VisualizationSnapshot | null
      resultSnapshot?: VisualizationSnapshot | null
    }
  ) {
    if (!targetConversationId) {
      return
    }

    setConversationArchive((current) => {
      const existing = current[targetConversationId]
      const serverConversation = serverConversations.find((conversation) => conversation.id === targetConversationId)
      const resultSnapshot =
        params.resultSnapshot
        ?? existing?.resultVisualizationSnapshot
        ?? existing?.visualizationSnapshot
        ?? null
      const modelSnapshot =
        params.modelSnapshot
        ?? existing?.modelVisualizationSnapshot
        ?? null
      const latestResultValue =
        params.latestResult
        ?? existing?.latestResult
        ?? null

      return {
        ...current,
        [targetConversationId]: {
          id: targetConversationId,
          title: existing?.title || serverConversation?.title || t('untitledConversation'),
          type: existing?.type || serverConversation?.type || 'analysis',
          createdAt: existing?.createdAt || serverConversation?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: existing?.messages || messages,
          modelText: existing?.modelText ?? modelText,
          analysisType: existing?.analysisType || analysisType,
          designCode: existing?.designCode || designCode,
          selectedSkillIds: existing?.selectedSkillIds || selectedSkillIds,
          selectedEngineId: existing?.selectedEngineId || selectedEngineId,
          modelSyncMessage: existing?.modelSyncMessage || modelSyncMessage,
          activePanel: existing?.activePanel || activePanel,
          latestResult: latestResultValue,
          modelVisualizationSnapshot: modelSnapshot,
          resultVisualizationSnapshot: resultSnapshot,
          visualizationSnapshot: resultSnapshot,
        },
      }
    })
  }

  async function handleSelectConversation(nextConversationId: string) {
    if (isSending || nextConversationId === conversationId) {
      return
    }

    setErrorMessage('')
    setVisualizationOpen(false)
    const archived = conversationArchive[nextConversationId]

    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/conversation/${nextConversationId}?locale=${encodeURIComponent(locale)}`)
      if (!response.ok) {
        throw new Error(`${t('loadConversationFailed')}: HTTP ${response.status}`)
      }

      const payload = await response.json() as ConversationDetail | null
      const backendMessages = Array.isArray(payload?.messages)
        ? payload.messages.map((message) => ({
            id: message.id,
            role: (message.role === 'assistant' ? 'assistant' : 'user') as Message['role'],
            content: message.content,
            status: 'done' as const,
            timestamp: message.createdAt,
          }))
        : []
      const archivedMessages = archived?.messages || []
      const archiveHasOnlyWelcome =
        archivedMessages.length > 0
        && archivedMessages.every((message) => message.id === 'welcome')

      const nextMessages =
        backendMessages.length > 0
          ? backendMessages
          : archivedMessages.length > 0 && !archiveHasOnlyWelcome
            ? archivedMessages
            : [initialAssistantMessage]
      const session = payload?.session
      const backendSnapshots = payload?.snapshots
      const backendUpdatedAt = payload?.updatedAt || payload?.createdAt || ''
      const archivedUpdatedAt = archived?.updatedAt || archived?.createdAt || ''
      const preferArchiveState = Boolean(archived && archivedUpdatedAt > backendUpdatedAt)
      const nextAnalysisType = session?.resolved?.analysisType || archived?.analysisType || 'static'
      const nextDesignCode = session?.resolved?.designCode || archived?.designCode || 'GB50017'
      const nextSelectedSkillIds = archived?.selectedSkillIds?.length ? archived.selectedSkillIds : defaultSkillIds
      const nextSelectedEngineId = archived?.selectedEngineId || 'auto'
      const nextLatestResult = preferArchiveState
        ? pickPreferredLatestResult(archived?.latestResult, backendSnapshots?.latestResult)
        : pickPreferredLatestResult(backendSnapshots?.latestResult, archived?.latestResult)
      const nextActivePanel = archived?.activePanel || (nextLatestResult?.report?.markdown ? 'report' : 'analysis')
      const nextModelSyncMessage = session?.model ? t('modelSyncFromChat') : (archived?.modelSyncMessage || '')
      const nextModelSnapshot = preferArchiveState
        ? (archived?.modelVisualizationSnapshot ?? backendSnapshots?.modelSnapshot ?? null)
        : (backendSnapshots?.modelSnapshot ?? archived?.modelVisualizationSnapshot ?? null)
      const nextResultSnapshot = preferArchiveState
        ? (archived?.resultVisualizationSnapshot ?? archived?.visualizationSnapshot ?? backendSnapshots?.resultSnapshot ?? null)
        : (backendSnapshots?.resultSnapshot ?? archived?.resultVisualizationSnapshot ?? archived?.visualizationSnapshot ?? null)
      const backendResultSnapshot = backendSnapshots?.resultSnapshot ?? null
      const archivedResultSnapshot = archived?.resultVisualizationSnapshot ?? archived?.visualizationSnapshot ?? null
      const nextResolvedResultSnapshot = pickPreferredResultSnapshot(nextResultSnapshot, pickPreferredResultSnapshot(backendResultSnapshot, archivedResultSnapshot))
      const synthesizedResultSnapshot = buildResultSnapshotFromResult(
        nextLatestResult,
        payload?.title || archived?.title || t('untitledConversation'),
        session?.model || null
      )
      const nextFinalResultSnapshot = pickPreferredResultSnapshot(nextResolvedResultSnapshot, synthesizedResultSnapshot)
      const nextModelText =
        toModelText(session?.model)
        || archived?.modelText
        || toModelText(nextLatestResult?.model)
        || toModelTextFromSnapshot(nextModelSnapshot)
        || toModelTextFromSnapshot(nextFinalResultSnapshot)
        || ''

      setConversationId(nextConversationId)
      setMessages(nextMessages)
      setModelText(nextModelText)
      setAnalysisType(nextAnalysisType)
      setDesignCode(nextDesignCode)
      setSelectedSkillIds(nextSelectedSkillIds)
      setSelectedEngineId(nextSelectedEngineId)
      setModelSyncMessage(nextModelSyncMessage)
      setLatestResult(nextLatestResult)
      setLatestModelVisualizationSnapshot(nextModelSnapshot)
      setLatestResultVisualizationSnapshot(nextFinalResultSnapshot)
      setActivePanel(nextActivePanel)
    } catch (error) {
      if (archived) {
        setConversationId(nextConversationId)
        setMessages(archived.messages.length ? archived.messages : [initialAssistantMessage])
        setModelText(
          archived.modelText
          || toModelText(archived.latestResult?.model)
          || toModelTextFromSnapshot(archived.modelVisualizationSnapshot)
          || toModelTextFromSnapshot(archived.resultVisualizationSnapshot || archived.visualizationSnapshot)
          || ''
        )
        setAnalysisType(archived.analysisType || 'static')
        setDesignCode(archived.designCode || 'GB50017')
        setSelectedSkillIds(archived.selectedSkillIds?.length ? archived.selectedSkillIds : defaultSkillIds)
        setSelectedEngineId(archived.selectedEngineId || 'auto')
        setModelSyncMessage(archived.modelSyncMessage || '')
        const archivedLatestResult = normalizeAgentResultPayload(archived.latestResult || null)
        setLatestResult(archivedLatestResult)
        setLatestModelVisualizationSnapshot(archived.modelVisualizationSnapshot || null)
        const archivedSynthesizedResultSnapshot = buildResultSnapshotFromResult(
          archivedLatestResult,
          archived.title || t('untitledConversation'),
          toModelFromVisualizationSnapshot(archived.modelVisualizationSnapshot || archived.resultVisualizationSnapshot || archived.visualizationSnapshot)
        )
        setLatestResultVisualizationSnapshot(
          pickPreferredResultSnapshot(
            pickPreferredResultSnapshot(archived.resultVisualizationSnapshot, archived.visualizationSnapshot),
            archivedSynthesizedResultSnapshot
          )
        )
        setActivePanel(archived.activePanel || (archivedLatestResult?.report?.markdown ? 'report' : 'analysis'))
        return
      }

      setErrorMessage(error instanceof Error ? error.message : `${t('loadConversationFailed')}.`)
    }
  }

  function resetConsoleState() {
    setConversationId('')
    setMessages([initialAssistantMessage])
    setModelText('')
    setAnalysisType('static')
    setDesignCode('GB50017')
    setSelectedSkillIds(defaultSkillIds)
    setSelectedEngineId('auto')
    setModelSyncMessage('')
    setLatestResult(null)
    setLatestModelVisualizationSnapshot(null)
    setLatestResultVisualizationSnapshot(null)
    setVisualizationOpen(false)
    setVisualizationSource('result')
    setErrorMessage('')
    setActivePanel('analysis')
    setPendingDeleteConversationId('')
  }

  function handleNewConversation() {
    if (isSending) {
      return
    }

    resetConsoleState()
  }

  async function handleDeleteConversation(targetConversationId: string) {
    if (isSending || deletingConversationId || !targetConversationId) {
      return
    }

    setDeletingConversationId(targetConversationId)
    setErrorMessage('')

    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/conversation/${targetConversationId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(`${t('deleteConversationFailed')} HTTP ${response.status}`)
      }

      const remainingConversations = mergedConversations.filter((conversation) => conversation.id !== targetConversationId)
      setServerConversations((current) => current.filter((conversation) => conversation.id !== targetConversationId))
      setConversationArchive((current) => {
        const next = { ...current }
        delete next[targetConversationId]
        return next
      })
      setPendingDeleteConversationId('')

      if (targetConversationId === conversationId) {
        const nextConversation = remainingConversations[0]
        if (nextConversation) {
          await handleSelectConversation(nextConversation.id)
        } else {
          resetConsoleState()
        }
      }

      toast.success(t('deleteConversationSucceeded'))
    } catch (error) {
      const nextError = error instanceof Error ? error.message : t('deleteConversationFailed')
      setErrorMessage(nextError)
      toast.error(nextError)
    } finally {
      setDeletingConversationId('')
    }
  }

  function openVisualization(preferredSource: 'model' | 'result') {
    const snapshotTitle =
      mergedConversations.find((conversation) => conversation.id === conversationId)?.title
      || modelPreviewBaseTitle
      || t('untitledConversation')

    let repairedSnapshot: VisualizationSnapshot | null = null
    if (preferredSource === 'result' && latestResult && !isResultVisualizationSnapshot(latestResultVisualizationSnapshot)) {
      const repairedResultSnapshot = buildResultSnapshotFromResult(latestResult, snapshotTitle, parsedComposerModel || null)
      if (repairedResultSnapshot && isResultVisualizationSnapshot(repairedResultSnapshot)) {
        repairedSnapshot = repairedResultSnapshot
        setLatestResultVisualizationSnapshot(repairedResultSnapshot)
        if (conversationId) {
          persistConversationSnapshotsToArchive(conversationId, {
            latestResult,
            resultSnapshot: repairedResultSnapshot,
          })
        }
      }
    }

    const effectiveResultSnapshot =
      repairedSnapshot
      || (latestResult && !isResultVisualizationSnapshot(latestResultVisualizationSnapshot)
        ? buildResultSnapshotFromResult(latestResult, snapshotTitle, parsedComposerModel || null)
        : latestResultVisualizationSnapshot)

    const nextSource =
      preferredSource === 'result'
        ? (isResultVisualizationSnapshot(effectiveResultSnapshot) ? 'result' : 'model')
        : 'model'
    setVisualizationSource(nextSource)
    setVisualizationOpen(Boolean(nextSource === 'result' ? (effectiveResultSnapshot || latestModelVisualizationSnapshot) : latestModelVisualizationSnapshot))
  }

  function applySynchronizedModel(nextModel: Record<string, unknown>, source: 'chat' | 'execute') {
    const nextText = JSON.stringify(nextModel, null, 2)
    if (nextText !== modelText) {
      setModelText(nextText)
    }
    if (source === 'chat') {
      setModelSyncMessage(t('modelSyncFromChat'))
      setContextOpen(true)
    }
    setErrorMessage('')
  }

  async function handleSubmit(action: ComposerAction) {
    const trimmedInput = input.trim()
    if (!trimmedInput || isSending) {
      return
    }

    const parsedModel = parseModelJson(modelText, t)
    if (parsedModel.error && action === 'execute') {
      setErrorMessage(parsedModel.error)
      setContextOpen(true)
      return
    }

    const userMessage: Message = {
      id: createId('user'),
      role: 'user',
      content: trimmedInput,
      status: 'done',
      timestamp: new Date().toISOString(),
    }

    const assistantMessageId = createId('assistant')
    const assistantSeed =
      action === 'chat' ? t('assistantSeedChat') : t('assistantSeedExecute')

    setErrorMessage('')
    appendMessage(userMessage)
    appendMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: assistantSeed,
      status: 'streaming',
      timestamp: new Date().toISOString(),
    })
    setInput('')
    setIsSending(true)
    setVisualizationOpen(false)
    setVisualizationSource('result')
    setModelSyncMessage('')
    if (action === 'execute') {
      // Avoid showing stale output from a previous run while a new execution is in flight.
      setLatestResult(null)
      setLatestResultVisualizationSnapshot(null)
      setActivePanel('analysis')
    }
    let receivedResult = false
    let assistantContent = assistantSeed
    let activeConversationId = conversationId
    let shouldBumpConversationActivity = false

    try {
      const nextConversationId = await ensureConversation(trimmedInput)
      activeConversationId = nextConversationId
      const contextPayload =
        action === 'execute'
          ? {
              locale,
              skillIds: selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
              engineId: selectedEngineId !== 'auto' ? selectedEngineId : undefined,
              model: parsedModel.model,
              modelFormat: parsedModel.model ? 'structuremodel-v1' : undefined,
              analysisType,
              autoAnalyze: true,
              autoCodeCheck: Boolean(designCode.trim()),
              designCode: designCode.trim() || undefined,
              includeReport: true,
              reportFormat: 'both',
              reportOutput: 'inline',
            }
          : {
              locale,
              skillIds: selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
              engineId: selectedEngineId !== 'auto' ? selectedEngineId : undefined,
            }

      if (action === 'execute') {
        const response = await fetch(`${API_BASE}/api/v1/chat/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmedInput,
            conversationId: nextConversationId,
            context: contextPayload,
          }),
        })

        if (!response.ok) {
          throw new Error(`${t('requestFailedHttp')}: HTTP ${response.status}`)
        }

        const payload = await response.json()
        if (!payload || typeof payload !== 'object') {
          throw new Error(t('invalidResponse'))
        }

        const result = {
          ...(payload as AgentResult),
          requestedEngineId: selectedEngineId !== 'auto' ? selectedEngineId : undefined,
        }
        if (result.model && typeof result.model === 'object' && !Array.isArray(result.model)) {
          applySynchronizedModel(result.model, 'execute')
        }
        const visualizationSnapshot = buildVisualizationSnapshot({
          title: buildVisualizationTitle(result, trimmedInput.slice(0, 48) || t('untitledConversation')),
          model: (result.model && typeof result.model === 'object' && !Array.isArray(result.model) ? result.model : parsedModel.model) ?? null,
          analysis: extractAnalysis(result),
          mode: 'analysis-result',
        })
        const modelSnapshot = buildVisualizationSnapshot({
          title: buildVisualizationTitle(result, trimmedInput.slice(0, 48) || t('untitledConversation')),
          model: (result.model && typeof result.model === 'object' && !Array.isArray(result.model) ? result.model : parsedModel.model) ?? null,
          mode: 'model-only',
        })
        receivedResult = true
        assistantContent = result.response || result.clarification?.question || t('returnedResult')
        setLatestResult(result)
        setLatestResultVisualizationSnapshot(visualizationSnapshot)
        setActivePanel(result.report?.markdown ? 'report' : 'analysis')
        persistConversationSnapshotsToArchive(nextConversationId, {
          latestResult: result,
          modelSnapshot,
          resultSnapshot: visualizationSnapshot,
        })
        // 保存结果快照到后端
        await saveConversationSnapshotToBackend(nextConversationId, {
          modelSnapshot,
          resultSnapshot: visualizationSnapshot,
          latestResult: result,
        })
        replaceMessage(assistantMessageId, (message) => ({
          ...message,
          content: assistantContent,
          status: 'done',
        }))
        shouldBumpConversationActivity = true
        return
      }

      const response = await fetch(`${API_BASE}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmedInput,
          mode: action === 'chat' ? 'chat' : 'execute',
          conversationId: nextConversationId,
          context: contextPayload,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error(`${t('requestFailedHttp')}: HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let chatBuffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          const line = part
            .split('\n')
            .map((item) => item.trim())
            .find((item) => item.startsWith('data:'))

          if (!line) continue
          const raw = line.slice(5).trim()
          if (!raw || raw === '[DONE]') continue

          let payload: StreamPayload
          try {
            payload = JSON.parse(raw) as StreamPayload
          } catch {
            continue
          }

          if (payload.type === 'token') {
            const token = typeof payload.content === 'string' ? payload.content : ''
            chatBuffer += token
            assistantContent = chatBuffer || assistantSeed
            replaceMessage(assistantMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'streaming',
            }))
          }

          if (payload.type === 'interaction_update') {
            const interactionMessage = buildInteractionMessage(payload, t, locale)
            assistantContent = interactionMessage
            replaceMessage(assistantMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'streaming',
            }))
          }

          // 处理 'start' 类型消息（包含 conversationId）
          if (payload.type === 'start' && payload.content && typeof payload.content === 'object') {
            const { conversationId: newConversationId } = payload.content as { conversationId?: string; startedAt?: string }
            if (newConversationId) {
              setConversationId(newConversationId)
            }
          }

          if (payload.type === 'result' && payload.content && typeof payload.content === 'object') {
            const result = {
              ...(payload.content as AgentResult),
              requestedEngineId: selectedEngineId !== 'auto' ? selectedEngineId : undefined,
            }
            if (result.model && typeof result.model === 'object' && !Array.isArray(result.model)) {
              applySynchronizedModel(result.model, action === 'chat' ? 'chat' : 'execute')
            }
            const visualizationSnapshot = buildVisualizationSnapshot({
              title: buildVisualizationTitle(result, trimmedInput.slice(0, 48) || t('untitledConversation')),
              model: (result.model && typeof result.model === 'object' && !Array.isArray(result.model) ? result.model : parsedModel.model) ?? null,
              analysis: extractAnalysis(result),
              mode: 'analysis-result',
            })
            const modelSnapshot = buildVisualizationSnapshot({
              title: buildVisualizationTitle(result, trimmedInput.slice(0, 48) || t('untitledConversation')),
              model: (result.model && typeof result.model === 'object' && !Array.isArray(result.model) ? result.model : parsedModel.model) ?? null,
              mode: 'model-only',
            })
            receivedResult = true
            setLatestResult(result)
            setLatestResultVisualizationSnapshot(visualizationSnapshot)
            persistConversationSnapshotsToArchive(activeConversationId || nextConversationId, {
              latestResult: result,
              modelSnapshot,
              resultSnapshot: visualizationSnapshot,
            })
            // 保存结果快照到后端
            await saveConversationSnapshotToBackend(activeConversationId, {
              modelSnapshot,
              resultSnapshot: visualizationSnapshot,
              latestResult: result,
            })
            setActivePanel(result.report?.markdown ? 'report' : 'analysis')
            assistantContent = result.response || result.clarification?.question || t('returnedResult')
            replaceMessage(assistantMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'done',
            }))
            shouldBumpConversationActivity = true
          }

          if (payload.type === 'error') {
            const nextError = typeof payload.error === 'string' ? payload.error : t('requestFailed')
            assistantContent = nextError
            setErrorMessage(nextError)
            replaceMessage(assistantMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'error',
            }))
            shouldBumpConversationActivity = true
          }
        }
      }

      replaceMessage(assistantMessageId, (message) => ({
        ...message,
        content: message.content || assistantSeed,
        status: message.status === 'error' ? 'error' : 'done',
      }))
      if (assistantContent !== assistantSeed || receivedResult) {
        shouldBumpConversationActivity = true
      }
    } catch (error) {
      const nextError = error instanceof Error ? error.message : t('requestFailed')

      if ((receivedResult || assistantContent !== assistantSeed) && nextError === 'Failed to fetch') {
        replaceMessage(assistantMessageId, (message) => ({
          ...message,
          status: message.status === 'error' ? 'error' : 'done',
        }))
      } else {
        setErrorMessage(nextError)
        replaceMessage(assistantMessageId, (message) => ({
          ...message,
          content: nextError,
          status: 'error',
        }))
        shouldBumpConversationActivity = Boolean(activeConversationId)
      }
    } finally {
      if (shouldBumpConversationActivity) {
        markConversationActivity(activeConversationId)
      }
      setIsSending(false)
    }
  }

  return (
    <div
      data-testid="console-layout-grid"
      className="grid min-h-[calc(100vh-5.5rem)] gap-4 xl:h-[calc(100vh-5.5rem)] xl:min-h-0 xl:grid-cols-[280px_minmax(0,1.3fr)_420px] xl:overflow-hidden"
    >
      <aside
        data-testid="console-history-panel"
        className="flex h-full min-h-[320px] flex-col rounded-[28px] border border-border/70 bg-card/80 backdrop-blur-xl xl:min-h-0 dark:border-white/10 dark:bg-white/5"
      >
        <div className="border-b border-border/70 px-5 py-4 dark:border-white/10">
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-700/80 dark:text-cyan-200/70">{t('conversationMemory')}</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{t('conversationHistory')}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t('conversationHistoryDesc')}
          </p>
          <Button
            type="button"
            className="mt-4 w-full rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            onClick={handleNewConversation}
            disabled={isSending}
          >
            <MessageSquarePlus className="h-4 w-4" />
            {t('newConversation')}
          </Button>
        </div>

        <div data-testid="console-history-scroll" className="flex-1 overflow-auto p-3 xl:min-h-0">
          {historyLoading && (
            <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/5">
              {t('loadingConversations')}
            </div>
          )}

          {!historyLoading && historyError && (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {historyError}
            </div>
          )}

          {!historyLoading && mergedConversations.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 py-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/5">
              {t('noConversationHistory')}
            </div>
          )}

          <div className="space-y-2">
            {mergedConversations.map((conversation) => {
              const isActive = conversation.id === conversationId
              const isPendingDelete = conversation.id === pendingDeleteConversationId
              const isDeleting = conversation.id === deletingConversationId
              const archive = conversationArchive[conversation.id]
              const preview = archive?.messages.findLast((message) => message.role === 'assistant')
                || archive?.messages.findLast((message) => message.role === 'user')
              const conversationTimestamp = conversation.updatedAt ?? conversation.createdAt

              return (
                <div
                  key={conversation.id}
                  className={cn(
                    'rounded-[22px] border px-4 py-3 transition',
                    isActive
                      ? 'border-cyan-300/40 bg-cyan-300/12 text-foreground dark:text-white'
                      : 'border-border/70 bg-background/70 text-muted-foreground hover:border-cyan-300/30 hover:bg-accent/10 dark:border-white/10 dark:bg-white/5'
                  )}
                >
                  {isPendingDelete ? (
                    <div className="space-y-3">
                      <div className="text-sm font-medium text-foreground">{t('deleteConversationConfirm')}</div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-full bg-rose-500 text-white hover:bg-rose-400"
                          disabled={isDeleting}
                          onClick={() => void handleDeleteConversation(conversation.id)}
                        >
                          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          {isDeleting ? t('deletingConversation') : t('confirmDeleteConversation')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          disabled={isDeleting}
                          onClick={() => setPendingDeleteConversationId('')}
                        >
                          {t('cancelDeleteConversation')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => void handleSelectConversation(conversation.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="line-clamp-2 text-sm font-medium leading-6">
                            {conversation.title || t('untitledConversation')}
                          </div>
                          {conversationTimestamp && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                              <Clock3 className="h-3.5 w-3.5" />
                              <span>{formatDate(conversationTimestamp, locale)}</span>
                            </div>
                          )}
                          {preview?.content && (
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {preview.content}
                            </p>
                          )}
                        </button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300"
                          aria-label={t('deleteConversation')}
                          disabled={Boolean(deletingConversationId)}
                          onClick={() => setPendingDeleteConversationId(conversation.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      <section
        data-testid="console-chat-panel"
        className="relative overflow-hidden rounded-[32px] border border-border/70 bg-card/85 shadow-[0_40px_120px_-50px_rgba(34,211,238,0.2)] backdrop-blur-xl xl:min-h-0 dark:border-white/10 dark:bg-slate-950/70 dark:shadow-[0_40px_120px_-50px_rgba(34,211,238,0.45)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.12),transparent_30%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.18),transparent_30%)]" />
        <div className="relative flex h-full min-h-[320px] flex-col xl:min-h-0">
          <div className="border-b border-border/70 px-5 py-4 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-700/80 dark:text-cyan-200/70">{t('aiConsoleEyebrow')}</p>
                <h1 className="mt-1 text-2xl font-semibold text-foreground">{t('aiConsoleTitle')}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  asChild
                  variant="outline"
                  className="rounded-full border-cyan-300/35 bg-cyan-300/10 text-cyan-800 hover:bg-cyan-300/20 dark:text-cyan-100"
                >
                  <Link href="/console/database">
                    <Database className="h-4 w-4" />
                    {t('databaseAdminConsoleLink')}
                  </Link>
                </Button>
                <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-700 dark:text-cyan-100" variant="outline">
                  {t('aiConsoleBadgePrimary')}
                </Badge>
                <Badge className="border-border/70 bg-background/70 text-muted-foreground dark:border-white/10 dark:bg-white/5" variant="outline">
                  {t('aiConsoleBadgeSecondary')}
                </Badge>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {t('aiConsoleIntro')}
            </p>
            <div className="mt-4 max-w-3xl rounded-[22px] border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/5">
              <div className="font-medium text-foreground">{t('databaseAdminConsoleCardTitle')}</div>
              <div className="mt-1 leading-6">{t('databaseAdminConsoleCardBody')}</div>
            </div>
          </div>

          <div
            ref={chatScrollRef}
            data-testid="console-chat-scroll"
            className="flex-1 overflow-auto px-5 py-5 xl:min-h-0"
          >
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {messages.length === 1 && (
                <div className="grid gap-3 md:grid-cols-3">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="rounded-3xl border border-border/70 bg-background/70 p-4 text-left text-sm text-muted-foreground transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:text-white"
                    >
                      <Sparkles className="mb-3 h-4 w-4 text-cyan-500 dark:text-cyan-300" />
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn('flex gap-3', message.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {message.role === 'assistant' && (
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-700 dark:text-cyan-200">
                      <Bot className="h-5 w-5" />
                    </div>
                  )}

                  <div
                    className={cn(
                      'max-w-[82%] rounded-[26px] border px-5 py-4 shadow-lg',
                      message.role === 'user'
                        ? 'border-cyan-400/30 bg-cyan-400/15 text-foreground dark:text-white'
                        : 'border-border/70 bg-background/70 text-foreground dark:border-white/10 dark:bg-white/5'
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      {message.role === 'user' ? <User className="h-3.5 w-3.5" /> : <BrainCircuit className="h-3.5 w-3.5" />}
                      <span>{message.role === 'user' ? t('you') : t('structureClawAi')}</span>
                      <span className="text-slate-500">{formatDate(message.timestamp, locale)}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-7">
                      {message.content}
                      {message.status === 'streaming' && (
                        <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
                      )}
                    </div>
                  </div>

                  {message.role === 'user' && (
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground dark:bg-white/10 dark:text-slate-200">
                      <User className="h-5 w-5" />
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div data-testid="console-composer" className="border-t border-border/70 px-4 py-3 dark:border-white/10">
            <div className="mx-auto max-w-4xl space-y-3">
              {errorMessage && (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {errorMessage}
                </div>
              )}

              <div className="rounded-[24px] border border-border/70 bg-background/70 p-2.5 dark:border-white/10 dark:bg-black/20">
                <div className="mb-2 rounded-[18px] border border-border/70 bg-card/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{t('skillSelectionLabel')}</p>
                      {skillsOpen && (
                        <p className="text-xs leading-5 text-muted-foreground">
                          {t('skillSelectionHelp')}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-sm text-muted-foreground transition hover:border-cyan-300/30 hover:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:text-white"
                      onClick={() => setSkillsOpen((current) => !current)}
                    >
                      {skillsOpen ? t('collapseSkills') : t('expandSkills')}
                    </button>
                  </div>

                  {skillsOpen && (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-muted-foreground">{t('skillSelectionCatalogHint')}</p>
                      {groupedSkills.map((group) => {
                        const allSelected = group.skills.length > 0 && group.selectedCount === group.skills.length
                        return (
                          <div key={group.domain} className="rounded-2xl border border-border/70 bg-background/60 p-2.5 dark:border-white/10 dark:bg-slate-950/30">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-foreground">
                                {group.label}
                                <span className="ml-2 text-muted-foreground">{group.selectedCount}/{group.skills.length}</span>
                              </p>
                              <button
                                type="button"
                                onClick={() => toggleSkillDomain(group.skillIds)}
                                className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground dark:border-white/10 dark:bg-white/5"
                              >
                                {allSelected ? t('skillClearDomainSelection') : t('skillSelectDomainSelection')}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {group.skills.map((skill) => {
                                const label = locale === 'zh' ? (skill.name.zh || skill.id) : (skill.name.en || skill.id)
                                const selected = selectedSkillIds.includes(skill.id)
                                return (
                                  <button
                                    key={skill.id}
                                    type="button"
                                    onClick={() => toggleSkill(skill.id)}
                                    className={cn(
                                      'rounded-full border px-3 py-1.5 text-sm transition',
                                      selected
                                        ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-700 dark:text-cyan-100'
                                        : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-slate-950/40 dark:hover:text-white'
                                    )}
                                  >
                                    {label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <Textarea
                  className="min-h-[96px] resize-none border-0 bg-transparent px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder={t('composerPlaceholder')}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                />
                <Separator className="bg-border dark:bg-white/10" />

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-sm text-muted-foreground transition hover:border-cyan-300/30 hover:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:text-white"
                      onClick={() => setContextOpen((current) => !current)}
                    >
                      {contextOpen ? t('collapseContext') : t('expandContext')}
                    </button>
                    <Badge className="border-border/70 bg-background/70 text-muted-foreground dark:border-white/10 dark:bg-white/5" variant="outline">
                      {t('conversationIdShort')} {conversationId ? conversationId.slice(0, 8) : t('notCreated')}
                    </Badge>
                    <Badge className="border-border/70 bg-background/70 text-muted-foreground dark:border-white/10 dark:bg-white/5" variant="outline">
                      {t('analysisEngineLabel')} {selectedEngineId === 'auto'
                        ? t('analysisEngineAutoOption')
                        : `${selectedEngineSummary?.name || selectedEngineId} · ${selectedEngineSummary ? getEngineStatusLabel(selectedEngineSummary, t) : t('engineStatusUnavailable')}`}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-border bg-background/70 text-foreground hover:bg-accent/10 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
                      onClick={() => handleSubmit('chat')}
                      disabled={isSending || !input.trim()}
                    >
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                      {t('chatFirst')}
                    </Button>
                    <Button
                      type="button"
                      className="rounded-full bg-cyan-300 px-5 text-slate-950 hover:bg-cyan-200"
                      onClick={() => handleSubmit('execute')}
                      disabled={isSending || !input.trim()}
                    >
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                      {t('runAnalysis')}
                    </Button>
                  </div>
                </div>

                {contextOpen && (
                  <div className="mt-3 grid gap-4 rounded-[24px] border border-border/70 bg-background/70 p-4 lg:grid-cols-[1fr_300px] dark:border-white/10 dark:bg-white/5">
                    <div className="space-y-2">
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-foreground">{t('contextSectionModel')}</div>
                            <div className="text-xs leading-5 text-muted-foreground">{t('contextSectionModelHelp')}</div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-full border-cyan-300/35 bg-cyan-300/10 text-cyan-800 hover:bg-cyan-300/20 dark:text-cyan-100"
                            disabled={!latestModelVisualizationSnapshot}
                            onClick={() => openVisualization('model')}
                            title={!latestModelVisualizationSnapshot ? t('visualizationMissingModel') : t('visualizationModelPreviewHelp')}
                          >
                            <Cuboid className="h-4 w-4" />
                            {t('visualizationPreviewModel')}
                          </Button>
                        </div>
                      </div>
                      <label className="text-sm font-medium text-foreground">{t('modelJsonLabel')}</label>
                      <Textarea
                        className="min-h-[160px] resize-y border-border/70 bg-card/80 text-sm text-foreground placeholder:text-muted-foreground dark:border-white/10 dark:bg-slate-950/70"
                        placeholder={t('modelJsonPlaceholder')}
                        value={modelText}
                        onChange={(event) => {
                          setModelText(event.target.value)
                          setModelSyncMessage('')
                        }}
                      />
                      {isAutoLoadingModel ? (
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t('loadingModel')}
                        </div>
                      ) : modelSyncMessage ? (
                        <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs leading-5 text-cyan-900 dark:text-cyan-100">
                          {modelSyncMessage}
                        </div>
                      ) : null}
                      {parsedComposerModelError ? (
                        <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-100">
                          {parsedComposerModelError}
                          {latestModelVisualizationSnapshot ? ` ${t('visualizationModelInvalidKeepingLast')}` : ''}
                        </div>
                      ) : latestModelVisualizationSnapshot ? (
                        <div className="text-xs leading-5 text-muted-foreground">
                          {t('visualizationModelPreviewHelp')}
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-2xl border border-border/70 bg-card/70 p-3 dark:border-white/10 dark:bg-slate-950/40">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-foreground">{t('analysisSettingsSectionTitle')}</div>
                            <div className="text-xs leading-5 text-muted-foreground">{t('contextSectionAnalysisHelp')}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAnalysisSettingsOpen((current) => !current)}
                            className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:text-white"
                          >
                            {analysisSettingsOpen ? t('analysisSettingsCollapse') : t('analysisSettingsExpand')}
                          </button>
                        </div>
                        {analysisSettingsOpen ? (
                          <div className="mt-3 space-y-3">
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-foreground">{t('analysisTypeLabel')}</label>
                              <div className="grid grid-cols-2 gap-2">
                                {analysisTypeOptions.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setAnalysisType(option.value)}
                                    className={cn(
                                      'rounded-2xl border px-3 py-2 text-sm transition',
                                      analysisType === option.value
                                        ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-700 dark:text-cyan-100'
                                        : 'border-border/70 bg-card/80 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-slate-950/40 dark:hover:text-white'
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-foreground">{t('designCodeLabel')}</label>
                              <Input
                                className="border-border/70 bg-card/80 text-foreground placeholder:text-muted-foreground dark:border-white/10 dark:bg-slate-950/70"
                                value={designCode}
                                onChange={(event) => setDesignCode(event.target.value)}
                                placeholder={t('designCodePlaceholder')}
                              />
                              <p className="text-xs leading-5 text-muted-foreground">
                                {t('designCodeHelp')}
                              </p>
                            </div>
                            <p className="text-xs leading-5 text-muted-foreground">
                              {t('composerHelp')}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-card/70 p-3 dark:border-white/10 dark:bg-slate-950/40">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-foreground">{t('engineSettingsSectionTitle')}</div>
                            <div className="text-xs leading-5 text-muted-foreground">{t('contextSectionEngineHelp')}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEngineSettingsOpen((current) => {
                                const next = !current
                                if (!next) {
                                  setEnginePickerOpen(false)
                                }
                                return next
                              })
                            }}
                            className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:text-white"
                          >
                            {engineSettingsOpen ? t('engineSettingsCollapse') : t('engineSettingsExpand')}
                          </button>
                        </div>

                        <div className="mt-3 space-y-2">
                          <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            {t('analysisEngineCurrentGroup')}
                          </div>
                          {selectedEngineId === 'auto' ? (
                            <div className="rounded-2xl border border-border/70 bg-card/80 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950/40">
                              <div className="font-medium text-foreground">{t('analysisEngineAutoOption')}</div>
                              <div className="mt-1 text-xs leading-5 text-muted-foreground">{t('analysisEngineAutoHelp')}</div>
                            </div>
                          ) : currentEngineSummary ? (
                            renderEngineSummary(currentEngineSummary, analysisType, currentModelFamily, t, matrixReasonTextsByEngine)
                          ) : (
                            <div className="rounded-2xl border border-border/70 bg-card/80 px-3 py-2 text-sm text-muted-foreground dark:border-white/10 dark:bg-slate-950/40">
                              {selectedEngineId}
                            </div>
                          )}
                        </div>

                        {engineSettingsOpen ? (
                          <div className="mt-3 space-y-2">
                            <label className="text-sm font-medium text-foreground">{t('analysisEngineSelectorLabel')}</label>
                            <button
                              type="button"
                              onClick={() => setEnginePickerOpen((current) => !current)}
                              className="w-full rounded-2xl border border-dashed border-border/70 bg-background/50 px-3 py-2 text-left text-sm text-muted-foreground transition hover:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:text-white"
                            >
                              {enginePickerOpen ? t('analysisEngineCollapseList') : t('analysisEngineChangeAction')}
                            </button>
                            {enginePickerOpen ? (
                              <div
                                data-testid="engine-candidate-list"
                                className="max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-border/70 bg-background/40 p-2 pr-1 dark:border-white/10 dark:bg-white/5"
                              >
                                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                  {t('analysisEngineCandidatesGroup')}
                                </div>
                                {engineCandidatesFilteredBySkills ? (
                                  <p className="px-1 text-xs leading-5 text-muted-foreground">
                                    {t('analysisEngineFilteredBySkillsHint')}
                                  </p>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => setSelectedEngineId('auto')}
                                  className={cn(
                                    'w-full rounded-2xl border px-3 py-2 text-left text-sm transition',
                                    selectedEngineId === 'auto'
                                      ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-700 dark:text-cyan-100'
                                      : 'border-border/70 bg-card/80 text-muted-foreground hover:text-foreground dark:border-white/10 dark:bg-slate-950/40 dark:hover:text-white'
                                  )}
                                >
                                  <div className="font-medium">{t('analysisEngineAutoOption')}</div>
                                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{t('analysisEngineAutoHelp')}</div>
                                </button>
                                {candidateEngines.map((engine) =>
                                  renderEngineOption(
                                    engine,
                                    selectedEngineId === engine.id,
                                    analysisType,
                                    currentModelFamily,
                                    t,
                                    matrixReasonTextsByEngine,
                                    setSelectedEngineId
                                  )
                                )}
                                {candidateEngines.length === 0 ? (
                                  <p className="rounded-2xl border border-border/70 bg-card/80 px-3 py-2 text-xs leading-5 text-muted-foreground dark:border-white/10 dark:bg-slate-950/40">
                                    {t('analysisEngineNoCompatibleCandidates')}
                                  </p>
                                ) : null}
                                {filteredOutEngineDetails.length > 0 ? (
                                  <div className="space-y-2 rounded-2xl border border-border/70 bg-card/70 px-3 py-2 dark:border-white/10 dark:bg-slate-950/30">
                                    <div className="text-xs font-medium text-muted-foreground">{t('analysisEngineFilteredOutGroup')}</div>
                                    {filteredOutEngineDetails.slice(0, 4).map((item) => (
                                      <div key={item.id} className="text-xs leading-5 text-muted-foreground">
                                        <span className="font-medium text-foreground">{item.name}</span>
                                        {' · '}
                                        {item.reasons.join(', ')}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            <p className="text-xs leading-5 text-muted-foreground">
                              {t('analysisEngineSelectorHelp')}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <AnalysisPanel
        activeTab={activePanel}
        locale={locale}
        modelVisualizationSnapshot={latestModelVisualizationSnapshot}
        onOpenVisualization={openVisualization}
        onTabChange={setActivePanel}
        result={latestResult}
        t={t}
        visualizationSnapshot={latestResultVisualizationSnapshot}
      />
      <StructuralVisualizationModal
        locale={locale}
        onClose={() => setVisualizationOpen(false)}
        open={visualizationOpen}
        snapshot={activeVisualizationSnapshot}
        t={t}
      />
    </div>
  )
}
