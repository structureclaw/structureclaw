'use client'

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ArrowUp, Bot, BrainCircuit, Clock3, Cuboid, FileText, Loader2, MessageSquarePlus, Orbit, Sparkles, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { buildVisualizationSnapshot } from '@/components/visualization/adapter'
import type { VisualizationSnapshot } from '@/components/visualization'
import { useI18n, type MessageKey } from '@/lib/i18n'
import type { AppLocale } from '@/lib/stores/slices/preferences'
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

type PersistedConversation = ConversationSummary & {
  messages: Message[]
  latestResult?: AgentResult | null
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const STORAGE_KEY = 'structureclaw.console.conversations'
const StructuralVisualizationModal = lazy(() => import('@/components/visualization/modal'))

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
    return parsed as Record<string, PersistedConversation>
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

function extractAnalysis(result: AgentResult | null) {
  if (!result) return null
  if (result.analysis && typeof result.analysis === 'object') {
    return result.analysis
  }
  if (result.data && typeof result.data === 'object') {
    return result.data
  }
  return null
}

function buildVisualizationTitle(result: AgentResult | null, conversationTitle: string) {
  const analysis = extractAnalysis(result)
  const meta = analysis && typeof analysis.meta === 'object' && analysis.meta ? (analysis.meta as Record<string, unknown>) : null
  const analysisType = typeof meta?.analysisType === 'string' ? meta.analysisType : typeof analysis?.analysis_type === 'string' ? analysis.analysis_type : ''
  return analysisType ? `${conversationTitle} · ${analysisType}` : conversationTitle
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
  t: (key: MessageKey) => string
) {
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
  onSelect: (engineId: string) => void
) {
  const issue = getEngineSelectionIssue(engine, analysisType, currentModelFamily, t)
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
  t: (key: MessageKey) => string
) {
  const issue = getEngineSelectionIssue(engine, analysisType, currentModelFamily, t)

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
  visualizationSnapshot,
  onOpenVisualization,
  activeTab,
  onTabChange,
  t,
  locale,
}: {
  result: AgentResult | null
  visualizationSnapshot: VisualizationSnapshot | null
  onOpenVisualization: () => void
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

  return (
    <div
      data-testid="console-output-panel"
      className="flex h-full min-h-[320px] flex-col rounded-[28px] border border-border/70 bg-card/80 backdrop-blur-xl xl:min-h-0 dark:border-white/10 dark:bg-white/5"
    >
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-4 dark:border-white/10">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-700/80 dark:text-cyan-200/70">{t('workspaceOutput')}</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{t('analysisAndReport')}</h2>
        </div>
        <div className="inline-flex rounded-full border border-border/70 bg-background/70 p-1 dark:border-white/10 dark:bg-white/5">
          {result && (
            <Button
              className="mr-2 rounded-full border border-cyan-300/35 bg-cyan-300/10 text-cyan-800 hover:bg-cyan-300/20 dark:text-cyan-100"
              disabled={!visualizationSnapshot}
              onClick={onOpenVisualization}
              title={!visualizationSnapshot ? t('visualizationMissingModel') : t('visualizationOpen')}
              type="button"
              variant="outline"
            >
              <Cuboid className="h-4 w-4" />
              {t('visualizationOpen')}
            </Button>
          )}
          <button
            className={cn(
              'rounded-full px-4 py-2 text-sm transition',
              activeTab === 'analysis'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onTabChange('analysis')}
            type="button"
          >
            {t('analysisTab')}
          </button>
          <button
            className={cn(
              'rounded-full px-4 py-2 text-sm transition',
              activeTab === 'report'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onTabChange('report')}
            type="button"
          >
            {t('reportTab')}
          </button>
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
                      {t('visualizationMissingModel')}
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
  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(true)
  const [engineSettingsOpen, setEngineSettingsOpen] = useState(false)
  const [enginePickerOpen, setEnginePickerOpen] = useState(false)
  const [modelText, setModelText] = useState('')
  const [designCode, setDesignCode] = useState('GB50017')
  const [analysisType, setAnalysisType] = useState<AnalysisType>('static')
  const [availableSkills, setAvailableSkills] = useState<AgentSkillSummary[]>([])
  const [availableEngines, setAvailableEngines] = useState<AnalysisEngineSummary[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [selectedEngineId, setSelectedEngineId] = useState('auto')
  const [latestResult, setLatestResult] = useState<AgentResult | null>(null)
  const [latestVisualizationSnapshot, setLatestVisualizationSnapshot] = useState<VisualizationSnapshot | null>(null)
  const [visualizationOpen, setVisualizationOpen] = useState(false)
  const [activePanel, setActivePanel] = useState<PanelTab>('analysis')
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)

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
        setSelectedSkillIds(skills.filter((skill) => skill.autoLoadByDefault).map((skill) => skill.id))
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

  const parsedComposerModel = useMemo(() => {
    const parsed = parseModelJson(modelText, t)
    return parsed.model
  }, [modelText, t])

  const currentModelFamily = useMemo(() => detectModelFamily(parsedComposerModel), [parsedComposerModel])

  const enabledEngines = useMemo(
    () => availableEngines.filter((engine) => engine.enabled !== false),
    [availableEngines]
  )

  const selectedEngineSummary = useMemo(
    () => enabledEngines.find((engine) => engine.id === selectedEngineId) || null,
    [enabledEngines, selectedEngineId]
  )
  const currentEngineSummary = useMemo(
    () => enabledEngines.find((engine) => engine.id === selectedEngineId) || null,
    [enabledEngines, selectedEngineId]
  )
  const candidateEngines = useMemo(
    () => enabledEngines.filter((engine) => engine.id !== selectedEngineId),
    [enabledEngines, selectedEngineId]
  )

  useEffect(() => {
    if (contextOpen) {
      setAnalysisSettingsOpen(true)
    } else {
      setAnalysisSettingsOpen(true)
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
        createdAt: current[conversationId]?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages,
        latestResult,
        visualizationSnapshot: current[conversationId]?.visualizationSnapshot ?? latestVisualizationSnapshot ?? null,
      },
    }))
  }, [conversationId, latestResult, latestVisualizationSnapshot, messages, serverConversations, t])

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

  function appendMessage(message: Message) {
    setMessages((current) => [...current, message])
  }

  function replaceMessage(messageId: string, updater: (message: Message) => Message) {
    setMessages((current) => current.map((message) => (message.id === messageId ? updater(message) : message)))
  }

  async function handleSelectConversation(nextConversationId: string) {
    if (isSending || nextConversationId === conversationId) {
      return
    }

    setErrorMessage('')
    setVisualizationOpen(false)
    const archived = conversationArchive[nextConversationId]

    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/conversation/${nextConversationId}`)
      if (!response.ok) {
        throw new Error(`${t('loadConversationFailed')}: HTTP ${response.status}`)
      }

      const payload = await response.json()
      const backendMessages = Array.isArray(payload?.messages)
        ? (payload.messages as Array<{ id: string; role: string; content: string; createdAt: string }>).map((message) => ({
            id: message.id,
            role: (message.role === 'assistant' ? 'assistant' : 'user') as Message['role'],
            content: message.content,
            status: 'done' as const,
            timestamp: message.createdAt,
          }))
        : []

      const nextMessages =
        archived?.messages && archived.messages.length >= backendMessages.length
          ? archived.messages
          : backendMessages.length > 0
            ? backendMessages
            : [initialAssistantMessage]

      setConversationId(nextConversationId)
      setMessages(nextMessages)
      setLatestResult(archived?.latestResult || null)
      setLatestVisualizationSnapshot(archived?.visualizationSnapshot || null)
      setActivePanel(archived?.latestResult?.report?.markdown ? 'report' : 'analysis')
    } catch (error) {
      if (archived) {
        setConversationId(nextConversationId)
        setMessages(archived.messages.length ? archived.messages : [initialAssistantMessage])
        setLatestResult(archived.latestResult || null)
        setLatestVisualizationSnapshot(archived.visualizationSnapshot || null)
        setActivePanel(archived.latestResult?.report?.markdown ? 'report' : 'analysis')
        return
      }

      setErrorMessage(error instanceof Error ? error.message : `${t('loadConversationFailed')}.`)
    }
  }

  function handleNewConversation() {
    if (isSending) {
      return
    }

    setConversationId('')
    setMessages([initialAssistantMessage])
    setLatestResult(null)
    setLatestVisualizationSnapshot(null)
    setVisualizationOpen(false)
    setErrorMessage('')
    setActivePanel('analysis')
  }

  async function handleSubmit(action: ComposerAction) {
    const trimmedInput = input.trim()
    if (!trimmedInput || isSending) {
      return
    }

    const parsedModel = parseModelJson(modelText, t)
    if (parsedModel.error) {
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
    let receivedResult = false
    let assistantContent = assistantSeed

    try {
      const nextConversationId = await ensureConversation(trimmedInput)
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
        const visualizationSnapshot = buildVisualizationSnapshot({
          title: buildVisualizationTitle(result, trimmedInput.slice(0, 48) || t('untitledConversation')),
          model: parsedModel.model ?? null,
          analysis: extractAnalysis(result),
        })
        receivedResult = true
        assistantContent = result.response || result.clarification?.question || t('returnedResult')
        setLatestResult(result)
        setLatestVisualizationSnapshot(visualizationSnapshot)
        setActivePanel(result.report?.markdown ? 'report' : 'analysis')
        replaceMessage(assistantMessageId, (message) => ({
          ...message,
          content: assistantContent,
          status: 'done',
        }))
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

          if (payload.type === 'result' && payload.content && typeof payload.content === 'object') {
            const result = {
              ...(payload.content as AgentResult),
              requestedEngineId: selectedEngineId !== 'auto' ? selectedEngineId : undefined,
            }
            const visualizationSnapshot = buildVisualizationSnapshot({
              title: buildVisualizationTitle(result, trimmedInput.slice(0, 48) || t('untitledConversation')),
              model: parsedModel.model ?? null,
              analysis: extractAnalysis(result),
            })
            receivedResult = true
            setLatestResult(result)
            setLatestVisualizationSnapshot(visualizationSnapshot)
            setActivePanel(result.report?.markdown ? 'report' : 'analysis')
            assistantContent = result.response || result.clarification?.question || t('returnedResult')
            replaceMessage(assistantMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'done',
            }))
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
          }
        }
      }

      replaceMessage(assistantMessageId, (message) => ({
        ...message,
        content: message.content || assistantSeed,
        status: message.status === 'error' ? 'error' : 'done',
      }))
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
      }
    } finally {
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
              const archive = conversationArchive[conversation.id]
              const preview = archive?.messages.findLast((message) => message.role === 'assistant')
                || archive?.messages.findLast((message) => message.role === 'user')

              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => void handleSelectConversation(conversation.id)}
                  className={cn(
                    'w-full rounded-[22px] border px-4 py-3 text-left transition',
                    isActive
                      ? 'border-cyan-300/40 bg-cyan-300/12 text-foreground dark:text-white'
                      : 'border-border/70 bg-background/70 text-muted-foreground hover:border-cyan-300/30 hover:bg-accent/10 dark:border-white/10 dark:bg-white/5'
                  )}
                >
                  <div className="line-clamp-2 text-sm font-medium leading-6">
                    {conversation.title || t('untitledConversation')}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <Clock3 className="h-3.5 w-3.5" />
                    <span>{formatDate(conversation.updatedAt || conversation.createdAt || new Date().toISOString(), locale)}</span>
                  </div>
                  {preview?.content && (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {preview.content}
                    </p>
                  )}
                </button>
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
                    <div className="mt-3 flex flex-wrap gap-2">
                      {availableSkills.map((skill) => {
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
                        <div className="text-sm font-semibold text-foreground">{t('contextSectionModel')}</div>
                        <div className="text-xs leading-5 text-muted-foreground">{t('contextSectionModelHelp')}</div>
                      </div>
                      <label className="text-sm font-medium text-foreground">{t('modelJsonLabel')}</label>
                      <Textarea
                        className="min-h-[160px] resize-y border-border/70 bg-card/80 text-sm text-foreground placeholder:text-muted-foreground dark:border-white/10 dark:bg-slate-950/70"
                        placeholder={t('modelJsonPlaceholder')}
                        value={modelText}
                        onChange={(event) => setModelText(event.target.value)}
                      />
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
                            renderEngineSummary(currentEngineSummary, analysisType, currentModelFamily, t)
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
                                    setSelectedEngineId
                                  )
                                )}
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
        onOpenVisualization={() => setVisualizationOpen(true)}
        onTabChange={setActivePanel}
        result={latestResult}
        t={t}
        visualizationSnapshot={latestVisualizationSnapshot}
      />
      <Suspense fallback={null}>
        <StructuralVisualizationModal
          locale={locale}
          onClose={() => setVisualizationOpen(false)}
          open={visualizationOpen}
          snapshot={latestVisualizationSnapshot}
          t={t}
        />
      </Suspense>
    </div>
  )
}
