'use client'

import dynamic from 'next/dynamic'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/stores/context'
import { MarkdownBody } from './markdown-body'
import { ToolCallCard } from './tool-call-card'
import { ArrowUp, Bot, BrainCircuit, Clock3, Cuboid, FileText, Loader2, Maximize2, MessageSquarePlus, Orbit, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCw, Sparkles, Square, Trash2, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DialogShell } from '@/components/ui/dialog-shell'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { buildVisualizationSnapshot } from '@/components/visualization/adapter'
import type { VisualizationSnapshot } from '@/components/visualization/types'
import { useI18n, type MessageKey } from '@/lib/i18n'
import {
  MessagePresentationView,
  reducePresentationEvent,
  type AssistantPresentation,
  type TimelinePhaseGroup,
  type TimelineStepItem,
  type PresentationArtifactState,
  type PresentationEvent,
} from './message-presentation'
import type { AppLocale } from '@/lib/stores/slices/preferences'
import { API_BASE } from '@/lib/api-base'
import { loadCapabilityPreferences, saveCapabilityPreferences } from '@/lib/capability-preference'
import { ALL_SKILL_DOMAINS, buildSkillNormalizationContext, DEFAULT_CONSOLE_SKILL_IDS, type SkillDomain, type SkillMetadataLike } from '@/lib/skill-normalization'
import { cn, formatDate, formatNumber } from '@/lib/utils'

const StructuralVisualizationModal = dynamic(
  () => import('@/components/visualization/modal').then((mod) => mod.StructuralVisualizationModal),
  { ssr: false }
)

type AnalysisType = 'static' | 'dynamic' | 'seismic' | 'nonlinear'
type PanelTab = 'analysis' | 'report'

type Message = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  status?: 'streaming' | 'done' | 'error' | 'aborted'
  timestamp: string
  debugDetails?: MessageDebugDetails
  presentation?: AssistantPresentation
  toolStep?: TimelineStepItem
  toolCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>
}

type AgentToolCall = {
  tool: string
  input?: Record<string, unknown>
  status: 'success' | 'error'
  startedAt?: string
  completedAt?: string
  durationMs?: number
  output?: unknown
  error?: string
}

type MessageDebugDetails = {
  promptSnapshot: string
  skillIds: string[]
  toolIds?: string[]
  routing?: {
    selectedSkillIds: string[]
    structuralSkillId?: string
    analysisSkillId?: string
    analysisSkillIds?: string[]
  }
  responseSummary: string
  plan: string[]
  toolCalls: AgentToolCall[]
}

type MessageMetadata = {
  debugDetails?: MessageDebugDetails
  status?: 'done' | 'error' | 'aborted'
  traceId?: string
  presentation?: AssistantPresentation
}

type AgentInteraction = {
  conversationStage?: string
  missingCritical?: string[]
  missingOptional?: string[]
  fallbackSupportNote?: string
  recommendedNextStep?: string
  questions?: Array<{ question?: string; label?: string }>
  pending?: { criticalMissing?: string[]; nonCriticalMissing?: string[] }
  options?: string[]
  resumeRequired?: boolean
}

type AgentResult = {
  response?: string
  traceId?: string
  success?: boolean
  needsModelInput?: boolean
  plan?: string[]
  toolCalls?: AgentToolCall[]
  interaction?: AgentInteraction
  analysis?: Record<string, unknown>
  report?: {
    summary?: string
    markdown?: string
    json?: Record<string, unknown>
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
  routing?: MessageDebugDetails['routing']
  visualizationHints?: Record<string, unknown>
}

type StreamPayload =
  | { type: 'start'; content?: { traceId?: string; conversationId?: string; startedAt?: string } }
  | { type: 'token'; content?: string }
  | { type: 'interaction_update'; content?: AgentInteraction }
  | { type: 'presentation_init'; presentation?: AssistantPresentation }
  | { type: 'phase_upsert'; phase?: TimelinePhaseGroup }
  | { type: 'step_upsert'; phaseId?: string; step?: TimelineStepItem }
  | { type: 'artifact_upsert'; artifact?: PresentationArtifactState }
  | { type: 'artifact_payload_sync'; artifact?: 'model' | 'analysis' | 'report'; model?: Record<string, unknown>; latestResult?: AgentResult; snapshot?: VisualizationSnapshot }
  | { type: 'summary_replace'; summaryText?: string }
  | { type: 'presentation_complete'; completedAt?: string }
  | { type: 'presentation_error'; phase?: string; message?: string }
  | { type: 'result'; content?: AgentResult }
  | { type: 'done' }
  | { type: 'error'; error?: string; code?: string; retriable?: boolean }

type StreamSession = {
  conversationId: string
  status: 'streaming' | 'completed' | 'aborted'
  abortController: AbortController
  assistantMessageId: string
  reader: ReadableStreamDefaultReader<Uint8Array> | null
}

type VisualizationHintsPayload = {
  memberUtilizationMap?: Record<string, number>
  bucklingModes?: Array<{ lambda: number; modeShape: Record<string, [number, number, number]> }>
}

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
  messages?: Array<{ id: string; role: string; content: string; createdAt: string; metadata?: MessageMetadata }>
  session?: AgentSessionSnapshot | null
  snapshots?: {
    modelSnapshot?: VisualizationSnapshot | null
    resultSnapshot?: VisualizationSnapshot | null
    latestResult?: AgentResult | null
    staleStructuralData?: boolean
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

async function saveConversationMessagesToBackend(
  conversationId: string,
  params: {
    userMessage: string
    assistantContent: string
    assistantAborted?: boolean
    traceId?: string
    assistantPresentation?: AssistantPresentation
  }
): Promise<void> {
  if (!conversationId) return

  try {
    await fetch(`${API_BASE}/api/v1/chat/conversation/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage: params.userMessage,
        assistantContent: params.assistantContent,
        assistantAborted: params.assistantAborted,
        traceId: params.traceId,
        assistantPresentation: params.assistantPresentation,
      }),
    })
  } catch (error) {
    console.warn('Failed to save messages to backend:', error);
  }
}

type PersistedConversation = ConversationSummary & {
  messages: Message[]
  modelText?: string
  designCode?: string
  selectedSkillIds?: string[]
  selectedToolIds?: string[]
  hasExplicitSkillSelection?: boolean
  hasExplicitToolSelection?: boolean
  modelSyncMessage?: string
  activePanel?: PanelTab
  latestResult?: AgentResult | null
  modelVisualizationSnapshot?: VisualizationSnapshot | null
  resultVisualizationSnapshot?: VisualizationSnapshot | null
  visualizationSnapshot?: VisualizationSnapshot | null
  staleStructuralData?: boolean
}

type AgentSkillSummary = SkillMetadataLike & {
  name: { zh?: string; en?: string }
  description: { zh?: string; en?: string }
  structureType?: string
  stages?: string[]
  triggers?: string[]
  autoLoadByDefault?: boolean
  domain?: string
}

type CapabilitySkillSummary = {
  id: string
  domain?: SkillDomain
  runtimeStatus?: 'active' | 'partial' | 'discoverable' | 'reserved'
}

type ToolCategory = 'modeling' | 'analysis' | 'code-check' | 'report' | 'utility'

type CapabilityToolSummary = {
  id: string
  category?: ToolCategory
  source?: 'builtin' | 'skill'
  requiresTools?: string[]
  displayName?: { zh?: string; en?: string }
  description?: { zh?: string; en?: string }
}

type CapabilityDomainSummary = {
  domain: SkillDomain
  runtimeStatus?: 'active' | 'partial' | 'discoverable' | 'reserved'
  skillIds?: string[]
  autoLoadSkillIds?: string[]
}

type CapabilityMatrixPayload = {
  skills?: CapabilitySkillSummary[]
  tools?: CapabilityToolSummary[]
  domainSummaries?: CapabilityDomainSummary[]
  skillDomainById?: Record<string, SkillDomain>
  foundationToolIds?: string[]
  enabledToolIdsBySkill?: Record<string, string[]>
  validEngineIdsBySkill?: Record<string, string[]>
  filteredEngineReasonsBySkill?: Record<string, Record<string, string[]>>
  canonicalSkillIdByAlias?: Record<string, string>
  skillAliasesByCanonicalId?: Record<string, string[]>
}




function resolveCallableTools(
  matrix: CapabilityMatrixPayload | null,
  selectedSkillIds: string[],
  skillDomainById: Record<string, SkillDomain>,
) {
  const matrixTools = Array.isArray(matrix?.tools) ? matrix.tools : []
  const foundationToolIds = new Set(Array.isArray(matrix?.foundationToolIds) ? matrix.foundationToolIds : [])
  const enabledToolIdsBySkill = matrix?.enabledToolIdsBySkill && typeof matrix.enabledToolIdsBySkill === 'object'
    ? matrix.enabledToolIdsBySkill
    : {}
  if (Object.keys(enabledToolIdsBySkill).length === 0) {
    return matrixTools
  }
  const callableToolIds = new Set<string>(foundationToolIds)

  selectedSkillIds.forEach((skillId) => {
    const toolIds = enabledToolIdsBySkill[skillId]
    if (!Array.isArray(toolIds)) {
      if (skillDomainById[skillId] === 'structure-type') {
        callableToolIds.add('validate_model')
      }
      return
    }
    toolIds.forEach((toolId) => {
      if (typeof toolId === 'string' && toolId.trim().length > 0) {
        callableToolIds.add(toolId)
      }
    })
    if (skillDomainById[skillId] === 'structure-type') {
      callableToolIds.add('validate_model')
    }
  })

  const toolById = new Map(matrixTools.map((tool) => [tool.id, tool]))
  const queue = [...callableToolIds]
  while (queue.length > 0) {
    const toolId = queue.shift()
    if (!toolId) {
      continue
    }
    const tool = toolById.get(toolId)
    if (!tool || !Array.isArray(tool.requiresTools)) {
      continue
    }
    tool.requiresTools.forEach((requiredToolId) => {
      if (typeof requiredToolId !== 'string' || requiredToolId.trim().length === 0 || callableToolIds.has(requiredToolId)) {
        return
      }
      callableToolIds.add(requiredToolId)
      queue.push(requiredToolId)
    })
  }

  return matrixTools.filter((tool) => callableToolIds.has(tool.id))
}

function toToolIdList(tools: CapabilityToolSummary[]) {
  return tools.map((tool) => tool.id)
}

function hasSameIds(left: string[], right: string[]) {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== rightSet.size) {
    return false
  }

  for (const item of leftSet) {
    if (!rightSet.has(item)) {
      return false
    }
  }

  return true
}

function resolveSkillDomainLabel(domain: SkillDomain, t: (key: MessageKey) => string) {
  if (domain === 'analysis') return t('skillDomainAnalysis')
  if (domain === 'data-input') return t('skillDomainDataInput')
  if (domain === 'design') return t('skillDomainDesign')
  if (domain === 'drawing') return t('skillDomainDrawing')
  if (domain === 'general') return t('skillDomainGeneral')
  if (domain === 'material') return t('skillDomainMaterial')
  if (domain === 'section') return t('skillDomainSection')
  if (domain === 'structure-type') return t('skillDomainStructureType')
  if (domain === 'load-boundary') return t('skillDomainLoadBoundary')
  if (domain === 'code-check') return t('skillDomainCodeCheck')
  if (domain === 'result-postprocess') return t('skillDomainResultPostprocess')
  if (domain === 'visualization') return t('skillDomainVisualization')
  if (domain === 'report-export') return t('skillDomainReportExport')
  if (domain === 'validation') return t('skillDomainValidation')
  return t('skillDomainUnknown')
}

const STORAGE_KEY = 'structureclaw.console.conversations'
const CONSOLE_UI_PREFERENCES_STORAGE_KEY = 'structureclaw.console.ui-preferences'
const SIDEBAR_LAYOUT_MIN_WIDTH = 1280
type ConsoleOutputMode = 'dock' | 'modal'
type ConsoleUiPreferences = {
  historyCollapsed: boolean
  outputMode: ConsoleOutputMode
}
const DEFAULT_CONSOLE_UI_PREFERENCES: ConsoleUiPreferences = {
  historyCollapsed: false,
  outputMode: 'dock',
}

function loadConsoleUiPreferences(): ConsoleUiPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_CONSOLE_UI_PREFERENCES
  }

  try {
    const raw = window.localStorage.getItem(CONSOLE_UI_PREFERENCES_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_CONSOLE_UI_PREFERENCES
    }
    const parsed = JSON.parse(raw) as Partial<ConsoleUiPreferences> | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_CONSOLE_UI_PREFERENCES
    }

    return {
      historyCollapsed: typeof parsed.historyCollapsed === 'boolean'
        ? parsed.historyCollapsed
        : DEFAULT_CONSOLE_UI_PREFERENCES.historyCollapsed,
      outputMode: parsed.outputMode === 'modal' || parsed.outputMode === 'dock'
        ? parsed.outputMode
        : DEFAULT_CONSOLE_UI_PREFERENCES.outputMode,
    }
  } catch {
    return DEFAULT_CONSOLE_UI_PREFERENCES
  }
}

function saveConsoleUiPreferences(preferences: ConsoleUiPreferences) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(CONSOLE_UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    return
  }
}

type MessageRenderGroup =
  | { type: 'single'; message: Message }
  | { type: 'assistant-execution'; assistant: Message; tools: Message[] }

function groupMessagesForRendering(messages: Message[]): MessageRenderGroup[] {
  const groups: MessageRenderGroup[] = []

  messages.forEach((message) => {
    if (message.role === 'tool') {
      const previous = groups[groups.length - 1]
      if (previous?.type === 'assistant-execution') {
        groups[groups.length - 1] = {
          ...previous,
          tools: [...previous.tools, message],
        }
        return
      }
      groups.push({ type: 'single', message })
      return
    }

    if (message.role === 'assistant' && message.presentation?.mode === 'execution') {
      groups.push({ type: 'assistant-execution', assistant: message, tools: [] })
      return
    }

    groups.push({ type: 'single', message })
  })

  return groups
}

function findPreviousUserMessage(messages: Message[], messageId: string): Message | null {
  const index = messages.findIndex((message) => message.id === messageId)
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages[i]
  }
  return null
}

function getIsSidebarLayout() {
  if (typeof window === 'undefined') {
    return false
  }

  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(`(min-width: ${SIDEBAR_LAYOUT_MIN_WIDTH}px)`).matches
  }

  return window.innerWidth >= SIDEBAR_LAYOUT_MIN_WIDTH
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function buildPromptSnapshot(message: string, context: Record<string, unknown>) {
  return JSON.stringify({ message, context }, null, 2)
}

function normalizeToolCategory(value: unknown): ToolCategory {
  if (value === 'modeling' || value === 'analysis' || value === 'code-check' || value === 'report' || value === 'utility') {
    return value
  }
  return 'utility'
}

function resolveToolCategoryLabel(category: ToolCategory, t: (key: MessageKey) => string) {
  if (category === 'modeling') return t('toolCategoryModeling')
  if (category === 'analysis') return t('toolCategoryAnalysis')
  if (category === 'code-check') return t('toolCategoryCodeCheck')
  if (category === 'report') return t('toolCategoryReport')
  return t('toolCategoryUtility')
}

function resolveToolLabel(tool: CapabilityToolSummary, locale: AppLocale) {
  const localized = locale === 'zh' ? (tool.displayName?.zh || tool.id) : (tool.displayName?.en || tool.id)
  if (localized && localized !== tool.id) {
    return localized
  }
  return tool.id
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function normalizeToolCalls(value: unknown): AgentToolCall[] {
  const rawToolCalls = Array.isArray(value) ? value : []
  return rawToolCalls.map((call) => {
    const status: AgentToolCall['status'] = call?.status === 'error' ? 'error' : 'success'
    return {
      tool: typeof call?.tool === 'string' ? call.tool : 'unknown_tool',
      input: toObjectRecord(call?.input),
      status,
      startedAt: typeof call?.startedAt === 'string' ? call.startedAt : undefined,
      completedAt: typeof call?.completedAt === 'string' ? call.completedAt : undefined,
      durationMs: typeof call?.durationMs === 'number' ? call.durationMs : undefined,
      output: call?.output,
      error: typeof call?.error === 'string' ? call.error : undefined,
    }
  })
}

function parsePersistedDebugDetails(metadata: unknown): MessageDebugDetails | undefined {
  const metadataRecord = toObjectRecord(metadata)
  const debugRecord = toObjectRecord(metadataRecord?.debugDetails)
  if (!debugRecord) {
    return undefined
  }

  const promptSnapshot = typeof debugRecord.promptSnapshot === 'string'
    ? debugRecord.promptSnapshot
    : ''
  const skillIds = Array.isArray(debugRecord.skillIds)
    ? debugRecord.skillIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const toolIds = Array.isArray(debugRecord.toolIds)
    ? debugRecord.toolIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  const responseSummary = typeof debugRecord.responseSummary === 'string' ? debugRecord.responseSummary : ''
  const plan = Array.isArray(debugRecord.plan) ? debugRecord.plan.filter((item): item is string => typeof item === 'string') : []
  const toolCalls = normalizeToolCalls(debugRecord.toolCalls)
  const routingRecord = toObjectRecord(debugRecord.routing)
  const routing = routingRecord
    ? {
        selectedSkillIds: Array.isArray(routingRecord.selectedSkillIds)
          ? routingRecord.selectedSkillIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : skillIds,
        structuralSkillId: typeof routingRecord.structuralSkillId === 'string' ? routingRecord.structuralSkillId : undefined,
        analysisSkillId: typeof routingRecord.analysisSkillId === 'string' ? routingRecord.analysisSkillId : undefined,
        analysisSkillIds: Array.isArray(routingRecord.analysisSkillIds)
          ? routingRecord.analysisSkillIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : undefined,
      }
    : undefined

  if (!promptSnapshot && skillIds.length === 0 && toolIds.length === 0 && !routing && !responseSummary && plan.length === 0 && toolCalls.length === 0) {
    return undefined
  }

  return {
    promptSnapshot,
    skillIds,
    toolIds,
    routing,
    responseSummary,
    plan,
    toolCalls,
  }
}

function parsePersistedPresentation(metadata: unknown): AssistantPresentation | undefined {
  const metadataRecord = toObjectRecord(metadata)
  const presentationRecord = toObjectRecord(metadataRecord?.presentation)
  if (!presentationRecord) {
    return undefined
  }

  const status = presentationRecord.status === 'done'
    || presentationRecord.status === 'error'
    || presentationRecord.status === 'aborted'
    || presentationRecord.status === 'streaming'
    ? presentationRecord.status
    : 'done'
  const mode = presentationRecord.mode === 'conversation' ? 'conversation' : 'execution'
  const summaryText = typeof presentationRecord.summaryText === 'string' ? presentationRecord.summaryText : ''
  const traceId = typeof presentationRecord.traceId === 'string' ? presentationRecord.traceId : undefined
  const startedAt = typeof presentationRecord.startedAt === 'string' ? presentationRecord.startedAt : undefined
  const completedAt = typeof presentationRecord.completedAt === 'string' ? presentationRecord.completedAt : undefined
  const errorMessage = typeof presentationRecord.errorMessage === 'string' ? presentationRecord.errorMessage : undefined

  const artifacts = Array.isArray(presentationRecord.artifacts)
    ? presentationRecord.artifacts.filter((item): item is PresentationArtifactState => Boolean(item && typeof item === 'object'))
    : []

  // Only v3 format is supported — use phases if present, otherwise degrade gracefully
  if (presentationRecord.version === 3 && Array.isArray(presentationRecord.phases)) {
    const phases: TimelinePhaseGroup[] = presentationRecord.phases
      .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
      .map((p): TimelinePhaseGroup => ({
        phaseId: typeof p.phaseId === 'string' ? p.phaseId : `phase:${p.phase ?? 'modeling'}`,
        phase: (typeof p.phase === 'string' ? p.phase : 'modeling') as 'understanding' | 'modeling' | 'validation' | 'analysis' | 'report',
        title: typeof p.title === 'string' ? p.title : undefined,
        status: (typeof p.status === 'string' ? p.status : 'done') as 'pending' | 'running' | 'done' | 'error',
        steps: Array.isArray(p.steps) ? p.steps as TimelineStepItem[] : [],
        startedAt: typeof p.startedAt === 'string' ? p.startedAt : undefined,
        completedAt: typeof p.completedAt === 'string' ? p.completedAt : undefined,
      }))
    return {
      version: 3,
      mode,
      status,
      summaryText,
      phases,
      artifacts,
      traceId,
      startedAt,
      completedAt,
      errorMessage,
    }
  }

  // Legacy v1/v2 data — keep summary only, drop incompatible phase data
  return {
    version: 3,
    mode,
    status,
    summaryText,
    phases: [],
    artifacts,
    traceId,
    startedAt,
    completedAt,
    errorMessage,
  }
}

const LEGACY_ABORTED_SUFFIX_PATTERNS = [
  /\n\n---\n\*(?:Stream stopped|已停止)\*$/u,
  /（已停止）$/u,
] as const

function stripLegacyAbortedSuffix(content: string) {
  return LEGACY_ABORTED_SUFFIX_PATTERNS.reduce((current, pattern) => current.replace(pattern, ''), content)
}

function mapToolNameToPhase(toolName: string): 'understanding' | 'modeling' | 'validation' | 'analysis' | 'report' {
  if (toolName.includes('detect') || toolName.includes('extract') || toolName.includes('clarification')) return 'understanding'
  if (toolName.includes('draft') || toolName.includes('build_model') || toolName.includes('model')) return 'modeling'
  if (toolName.includes('validate')) return 'validation'
  if (toolName.includes('analysis') || toolName.includes('code_check')) return 'analysis'
  if (toolName.includes('report')) return 'report'
  return 'understanding'
}

function hasLegacyAbortedSuffix(content: string) {
  return LEGACY_ABORTED_SUFFIX_PATTERNS.some((pattern) => pattern.test(content))
}

function parsePersistedMessageStatus(metadata: unknown, content: string): Message['status'] {
  const metadataRecord = toObjectRecord(metadata)
  const rawStatus = metadataRecord?.status

  if (rawStatus === 'aborted' || rawStatus === 'error' || rawStatus === 'done') {
    return rawStatus
  }
  if (rawStatus === 'streaming') {
    return 'aborted'
  }
  if (hasLegacyAbortedSuffix(content)) {
    return 'aborted'
  }
  return 'done'
}

function normalizePersistedMessage(message: Message): Message {
  const normalizedStatus = message.status === 'streaming'
    ? 'aborted'
    : (message.status ?? (hasLegacyAbortedSuffix(message.content) ? 'aborted' : 'done'))
  const normalizedPresentation = message.presentation
    ? {
        ...message.presentation,
        status: message.presentation.status === 'streaming' && normalizedStatus === 'aborted'
          ? 'aborted'
          : message.presentation.status,
        summaryText: message.presentation.summaryText || stripLegacyAbortedSuffix(message.content),
      }
    : undefined

  return {
    ...message,
    content: stripLegacyAbortedSuffix(message.content),
    status: normalizedStatus,
    presentation: normalizedPresentation,
  }
}

function resolveAbortedAssistantContent(content: string, assistantSeed: string) {
  return content.trim() === assistantSeed.trim() ? '' : content
}

const RESUME_MESSAGE_INTENTS = new Set([
  '继续',
  '继续吧',
  '继续分析',
  '继续执行',
  '开始',
  '开始吧',
  '开始分析',
  '开始计算',
  '可以了',
  '就这样',
  '确认',
  '确认执行',
  'continue',
  'goahead',
  'proceed',
  'start',
  'startnow',
  'runit',
  'confirm',
])

function inferProceedIntent(message: string) {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[\s。．.!！?？,，;；:：'"`]+/gu, '')

  return normalized.length > 0 && RESUME_MESSAGE_INTENTS.has(normalized)
}

function resolveResumeFromMessage(messages: Message[], input: string) {
  if (!inferProceedIntent(input)) {
    return undefined
  }

  const lastAssistantIndex = [...messages].map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === 'assistant')?.index

  if (lastAssistantIndex === undefined || messages[lastAssistantIndex]?.status !== 'aborted') {
    return undefined
  }

  for (let index = lastAssistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') {
      continue
    }
    const content = message.content.trim()
    if (content) {
      return content
    }
  }

  return undefined
}

function buildMessageDebugDetails(promptSnapshot: string, skillIds: string[], toolIds: string[], result: AgentResult): MessageDebugDetails {
  const safeToolCalls = normalizeToolCalls(result.toolCalls)

  return {
    promptSnapshot,
    skillIds,
    toolIds,
    routing: result.routing,
    responseSummary: result.response || '',
    plan: Array.isArray(result.plan) ? result.plan : [],
    toolCalls: safeToolCalls,
  }
}

function formatDebugPayload(value: unknown, fallback: string) {
  if (value === undefined) {
    return fallback
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
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
    schema_version: '2.0.0',
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

  if (snapshot.coordinateSemantics === 'global-z-up') {
    model.metadata = {
      coordinateSemantics: 'global-z-up',
      frameDimension: snapshot.dimension === 3 ? '3d' : '2d',
      source: 'visualization-snapshot',
    }
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
      migrated[conversationId] = sanitizePersistedConversation(value as PersistedConversation)
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
  const conversationStage = payload.content?.conversationStage
  const fallbackSupportNote = payload.content?.fallbackSupportNote
  const recommendedNextStep = payload.content?.recommendedNextStep
  const criticalMissing = payload.content?.pending?.criticalMissing || []
  const options = payload.content?.options || []
  const lines: string[] = []

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

  // Options are rendered as interactive chips in the composer area, not here.

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

function extractVisualizationHints(result: AgentResult | null): VisualizationHintsPayload | null {
  if (!result) {
    return null
  }

  const normalized = normalizeAgentResultPayload(result)
  if (!normalized) {
    return null
  }

  const directHints = toObjectRecord(normalized.visualizationHints)
  if (directHints) {
    return directHints as VisualizationHintsPayload
  }

  const reportRecord = toObjectRecord(normalized.report)
  const reportJson = toObjectRecord(reportRecord?.json)
  const jsonHints = toObjectRecord(reportJson?.visualizationHints)
  if (jsonHints) {
    return jsonHints as VisualizationHintsPayload
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

const CANONICAL_COORDINATE_SEMANTICS = 'global-z-up'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isStaleVisualizationSnapshot(snapshot?: VisualizationSnapshot | null) {
  if (!snapshot) return false
  // Only flag as stale if the snapshot actually contains structural model data
  // (non-trivial nodes and elements). Snapshots without structural data (e.g. empty
  // or chat-only conversations) must not trigger the stale-data wipe.
  if (!Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) return false
  if (!Array.isArray(snapshot.elements) || snapshot.elements.length === 0) return false
  return snapshot.coordinateSemantics !== CANONICAL_COORDINATE_SEMANTICS
}

function isStaleStructuralResult(result: AgentResult | null | undefined) {
  const normalized = normalizeAgentResultPayload(result ?? null)
  const model = asRecord(normalized?.model)
  if (!model) {
    return false
  }
  if (!Array.isArray(model.nodes) || !Array.isArray(model.elements)) {
    return false
  }
  const metadata = asRecord(model.metadata)
  const inferredType = typeof metadata?.inferredType === 'string' ? metadata.inferredType : undefined
  if (inferredType === 'unknown') {
    return false
  }
  return metadata?.coordinateSemantics !== CANONICAL_COORDINATE_SEMANTICS
}

function sanitizePersistedConversation(archived: PersistedConversation): PersistedConversation {
  const normalizedMessages = Array.isArray(archived.messages)
    ? archived.messages.map((message) => normalizePersistedMessage(message))
    : []
  const normalizedLatestResult = normalizeAgentResultPayload(archived.latestResult || null)
  const preferredStoredResultSnapshot = pickPreferredResultSnapshot(
    archived.resultVisualizationSnapshot,
    archived.visualizationSnapshot,
  )
  const synthesizedResultSnapshot = buildResultSnapshotFromResult(
    normalizedLatestResult,
    archived.title || 'Conversation',
    toModelFromVisualizationSnapshot(archived.modelVisualizationSnapshot || preferredStoredResultSnapshot),
  )
  const repairedResultSnapshot = pickPreferredResultSnapshot(preferredStoredResultSnapshot, synthesizedResultSnapshot)
  const staleStructuralData =
    isStaleVisualizationSnapshot(archived.modelVisualizationSnapshot)
    || isStaleVisualizationSnapshot(repairedResultSnapshot)
    || isStaleStructuralResult(normalizedLatestResult)

  if (staleStructuralData) {
    return {
      ...archived,
      messages: normalizedMessages,
      modelText: '',
      modelSyncMessage: '',
      activePanel: archived.activePanel === 'report' ? 'analysis' : archived.activePanel,
      latestResult: null,
      modelVisualizationSnapshot: null,
      resultVisualizationSnapshot: null,
      visualizationSnapshot: null,
      staleStructuralData: true,
    }
  }

  return {
    ...archived,
    messages: normalizedMessages,
    latestResult: normalizedLatestResult,
    resultVisualizationSnapshot: repairedResultSnapshot,
    visualizationSnapshot: repairedResultSnapshot || archived.visualizationSnapshot || null,
    staleStructuralData: false,
  }
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
  const visualizationHints = extractVisualizationHints(normalizedResult)

  return buildVisualizationSnapshot({
    title: buildVisualizationTitle(normalizedResult, title),
    model: modelFromResult ?? fallbackModel ?? null,
    analysis: extractAnalysis(normalizedResult),
    mode: 'analysis-result',
    memberUtilizationMap: visualizationHints?.memberUtilizationMap,
    bucklingModes: visualizationHints?.bucklingModes,
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

function AnalysisPanel({
  result,
  modelVisualizationSnapshot,
  visualizationSnapshot,
  onOpenVisualization,
  activeTab,
  onTabChange,
  t,
  locale,
  panelIdPrefix = 'output',
}: {
  result: AgentResult | null
  modelVisualizationSnapshot: VisualizationSnapshot | null
  visualizationSnapshot: VisualizationSnapshot | null
  onOpenVisualization: (source: 'result' | 'model') => void
  activeTab: PanelTab
  onTabChange: (tab: PanelTab) => void
  t: (key: MessageKey) => string
  locale: AppLocale
  panelIdPrefix?: string
}) {
  const analysis = extractAnalysis(result)
  const stats = extractSummaryStats(analysis, t, locale)
  const engineInfo = extractEngineLabel(analysis, result, t)
  const reportMarkdown = result?.report?.markdown?.trim()
  const reportSummary = result?.report?.summary?.trim()
  const reportPdfUrl = (result?.report as Record<string, unknown>)?.pdfUrl as string | undefined
  const guidance = result?.interaction
  const hasVisualizationData = Boolean(visualizationSnapshot || modelVisualizationSnapshot)
  const showVisualizationAction = Boolean(result || visualizationSnapshot)
  const analysisTabId = `${panelIdPrefix}-tab-analysis`
  const reportTabId = `${panelIdPrefix}-tab-report`
  const tabPanelId = `${panelIdPrefix}-tabpanel-output`

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
          <div className="grid w-full grid-cols-2 rounded-2xl border border-border/70 bg-background/70 p-1 sm:w-auto dark:border-white/10 dark:bg-white/5"
            role="tablist" aria-label={t('tabPanelAnalysisLabel')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault()
                const nextTab = activeTab === 'analysis' ? 'report' : 'analysis'
                onTabChange(nextTab)
                requestAnimationFrame(() => {
                  document.getElementById(nextTab === 'analysis' ? analysisTabId : reportTabId)?.focus()
                })
              } else if (e.key === 'Home') {
                e.preventDefault()
                onTabChange('analysis')
                requestAnimationFrame(() => { document.getElementById(analysisTabId)?.focus() })
              } else if (e.key === 'End') {
                e.preventDefault()
                onTabChange('report')
                requestAnimationFrame(() => { document.getElementById(reportTabId)?.focus() })
              }
            }}
          >
            <button
              className={cn(
                'rounded-xl px-4 py-2.5 text-sm font-medium transition',
                activeTab === 'analysis'
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => onTabChange('analysis')}
              type="button"
              role="tab"
              id={analysisTabId}
              aria-selected={activeTab === 'analysis'}
              aria-controls={tabPanelId}
              tabIndex={activeTab === 'analysis' ? 0 : -1}
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
              role="tab"
              id={reportTabId}
              aria-selected={activeTab === 'report'}
              aria-controls={tabPanelId}
              tabIndex={activeTab === 'report' ? 0 : -1}
            >
              {t('reportTab')}
            </button>
          </div>
        </div>
      </div>

      <div data-testid="console-output-scroll" className="flex-1 overflow-auto p-5 xl:min-h-0" role="tabpanel" id={tabPanelId} aria-labelledby={activeTab === 'analysis' ? analysisTabId : reportTabId}>
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
                  <MarkdownBody compact content={result.response || t('noNaturalLanguageSummary')} />
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
                  <MarkdownBody compact content={result.response || t('guidancePanelBody')} />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
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
                      <MarkdownBody compact content={guidance.fallbackSupportNote} className="prose-p:text-foreground dark:prose-p:text-foreground" />
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
                      <MarkdownBody compact content={guidance.recommendedNextStep} className="prose-p:text-foreground dark:prose-p:text-foreground" />
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
            {reportPdfUrl && (
              <Card className="border-border\70 bg-card\85 text-foreground shadow-none dark:border-white/10 dark:bg-slate-950/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FileText className="h-5 w-5 text-cyan-500 dark:text-cyan-300" />
                    {t('calculationBookPdf')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 dark:border-white/10">
                    <span className="text-xs font-medium text-muted-foreground">PDF</span>
                    <button
                      type="button"
                      onClick={() => window.open(`${API_BASE}${reportPdfUrl}`, '_blank')}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Maximize2 className="h-3 w-3" />
                      {locale === 'zh' ? '全屏查看' : 'Fullscreen'}
                    </button>
                  </div>
                  <iframe
                    src={`${API_BASE}${reportPdfUrl}`}
                    className="h-[600px] w-full border-0"
                    title="PDF Preview"
                  />
                </CardContent>
              </Card>
            )}

            {reportSummary && (
              <Card className="border-border/70 bg-card/85 text-foreground shadow-none dark:border-white/10 dark:bg-slate-950/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FileText className="h-5 w-5 text-cyan-500 dark:text-cyan-300" />
                    {t('reportSummary')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <MarkdownBody content={reportSummary} />
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
                  <article>
                    <MarkdownBody content={reportMarkdown} />
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

const PDF_LINK_RE = /\[PDF[^\]]*\]\(([^)\s]+)\)/

function extractPdfUrl(content: string): string | null {
  const m = content.match(PDF_LINK_RE)
  if (!m) return null
  const relative = m[1]
  if (relative.startsWith('http') || relative.startsWith('//')) return relative
  return `${API_BASE}${relative}`
}

export function AIConsole() {
  const { t, locale } = useI18n()
  const openWorkspaceSettings = useStore((state) => state.openWorkspaceSettings)
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
  const [messages, setMessages] = useState<Message[]>([initialAssistantMessage])
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [serverConversations, setServerConversations] = useState<ConversationSummary[]>([])
  const [conversationArchive, setConversationArchive] = useState<Record<string, PersistedConversation>>({})
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [streamingSessions, setStreamingSessions] = useState<Map<string, StreamSession>>(new Map())
  const streamingSessionsRef = useRef<Map<string, StreamSession>>(new Map())
  const currentPresentationRef = useRef<AssistantPresentation | null>(null)
  const conversationIdRef = useRef(conversationId)
  const submittingRef = useRef(false)
  const [isStreaming, setIsStreaming] = useState(false)
  useEffect(() => { conversationIdRef.current = conversationId }, [conversationId])
  const [errorMessage, setErrorMessage] = useState('')
  const [contextOpen, setContextOpen] = useState(false)
  const [modelText, setModelText] = useState('')
  const [modelSyncMessage, setModelSyncMessage] = useState('')
  const [availableSkills, setAvailableSkills] = useState<AgentSkillSummary[]>([])
  const [capabilityMatrix, setCapabilityMatrix] = useState<CapabilityMatrixPayload | null>(null)
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([])
  const [hasExplicitSkillSelection, setHasExplicitSkillSelection] = useState(false)
  const [hasExplicitToolSelection, setHasExplicitToolSelection] = useState(false)
  const [allEngines, setAllEngines] = useState<Array<{ id: string; name: string; available: boolean; priority: number; status: string; unavailableReason?: string }>>([])

  const [probeResults, setProbeResults] = useState<Record<string, { passed: boolean; durationMs?: number; error?: string; loading?: boolean }>>({})
  const [latestResult, setLatestResult] = useState<AgentResult | null>(null)
  const [latestModelVisualizationSnapshot, setLatestModelVisualizationSnapshot] = useState<VisualizationSnapshot | null>(null)
  const [latestResultVisualizationSnapshot, setLatestResultVisualizationSnapshot] = useState<VisualizationSnapshot | null>(null)
  const [visualizationOpen, setVisualizationOpen] = useState(false)
  const [visualizationSource, setVisualizationSource] = useState<'model' | 'result'>('result')
  const [activePanel, setActivePanel] = useState<PanelTab>('analysis')
  const [pendingDeleteConversationId, setPendingDeleteConversationId] = useState('')
  const [deletingConversationId, setDeletingConversationId] = useState('')
  const [conversationActivityAt, setConversationActivityAt] = useState<Record<string, string>>({})
  const [uiPreferences, setUiPreferences] = useState<ConsoleUiPreferences>(DEFAULT_CONSOLE_UI_PREFERENCES)
  const [uiPreferencesHydrated, setUiPreferencesHydrated] = useState(false)
  const [resultDialogOpen, setResultDialogOpen] = useState(false)
  const [isSidebarLayout, setIsSidebarLayout] = useState(getIsSidebarLayout)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const capabilityPreferencesHydratedRef = useRef(false)
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  const [capabilityMatrixLoaded, setCapabilityMatrixLoaded] = useState(false)
  // 追踪最后有效的结果用于持久化（不会被引擎切换清除）
  const lastValidResultRef = useRef<AgentResult | null>(null)
  const lastValidResultVisualizationRef = useRef<VisualizationSnapshot | null>(null)
  // Track whether the LangGraph agent is paused waiting for user input (interrupt)
  const resumeRequiredRef = useRef(false)
  // Interaction option chips from ask_user_clarification
  const [pendingOptions, setPendingOptions] = useState<string[]>([])

  const outputMode = uiPreferences.outputMode

  const messageRenderGroups = useMemo(() => groupMessagesForRendering(messages), [messages])

  function setOutputMode(nextMode: ConsoleOutputMode) {
    setUiPreferences((current) => ({
      ...current,
      outputMode: nextMode,
    }))
  }

  useEffect(() => {
    setUiPreferences(loadConsoleUiPreferences())
    setUiPreferencesHydrated(true)
  }, [])

  useEffect(() => {
    if (!uiPreferencesHydrated) {
      return
    }

    saveConsoleUiPreferences(uiPreferences)
  }, [uiPreferences, uiPreferencesHydrated])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia(`(min-width: ${SIDEBAR_LAYOUT_MIN_WIDTH}px)`)
      : null
    const updateSidebarLayout = () => {
      setIsSidebarLayout(media ? media.matches : window.innerWidth >= SIDEBAR_LAYOUT_MIN_WIDTH)
    }

    updateSidebarLayout()

    if (media) {
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', updateSidebarLayout)
        return () => media.removeEventListener('change', updateSidebarLayout)
      }

      media.addListener(updateSidebarLayout)
      return () => media.removeListener(updateSidebarLayout)
    }

    window.addEventListener('resize', updateSidebarLayout)
    return () => window.removeEventListener('resize', updateSidebarLayout)
  }, [])

  // Streaming session helpers
  function registerStreamSession(session: StreamSession) {
    setStreamingSessions((prev) => new Map(prev).set(session.conversationId, session))
    streamingSessionsRef.current.set(session.conversationId, session)
  }

  function updateStreamSessionStatus(convId: string, status: StreamSession['status']) {
    setStreamingSessions((prev) => {
      const next = new Map(prev)
      const existing = next.get(convId)
      if (existing) next.set(convId, { ...existing, status })
      return next
    })
    const existing = streamingSessionsRef.current.get(convId)
    if (existing) streamingSessionsRef.current.set(convId, { ...existing, status })
  }

  function removeStreamSession(convId: string) {
    setStreamingSessions((prev) => {
      const next = new Map(prev)
      next.delete(convId)
      return next
    })
    streamingSessionsRef.current.delete(convId)
  }

  function stopStream(targetConversationId?: string) {
    const id = targetConversationId || conversationId
    const session = streamingSessionsRef.current.get(id)
    if (session?.status === 'streaming') {
      session.abortController.abort()
      session.reader?.cancel().catch(() => {})
      updateStreamSessionStatus(id, 'aborted')
    }
  }

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

  const skillNormalization = useMemo(
    () => buildSkillNormalizationContext(availableSkills, capabilityMatrix),
    [availableSkills, capabilityMatrix]
  )
  const skillDomainById = skillNormalization.skillDomainById

  const hasSelectedCodeCheckSkill = useMemo(
    () => selectedSkillIds.some((skillId) => skillDomainById[skillId] === 'code-check'),
    [selectedSkillIds, skillDomainById]
  )

  const defaultSelectedSkillIds = useMemo(() => {
    const available = new Set(availableSkills.map((skill) => skill.id))
    return ['opensees-static', 'generic'].filter((skillId) => available.has(skillId))
  }, [availableSkills])

  const availableTools = useMemo(() => {
    return [...resolveCallableTools(capabilityMatrix, selectedSkillIds, skillDomainById)].sort((a, b) => {
      const left = resolveToolLabel(a, locale)
      const right = resolveToolLabel(b, locale)
      return left.localeCompare(right)
    })
  }, [capabilityMatrix, locale, selectedSkillIds, skillDomainById])

  const initialDefaultToolIds = useMemo(
    () => toToolIdList(resolveCallableTools(capabilityMatrix, defaultSelectedSkillIds, skillDomainById)),
    [capabilityMatrix, defaultSelectedSkillIds, skillDomainById]
  )

  const baseCallableToolIds = useMemo(
    () => toToolIdList(resolveCallableTools(capabilityMatrix, [], skillDomainById)),
    [capabilityMatrix, skillDomainById]
  )

  const loadedModules = useMemo(() => {
    return availableSkills
      .filter((skill) => selectedSkillIds.includes(skill.id))
      .map((skill) => ({
        id: skill.id,
        domain: skillDomainById[skill.id] || 'unknown',
        label: locale === 'zh' ? (skill.name.zh || skill.id) : (skill.name.en || skill.id),
        source: 'local' as const,
      }))
      .sort((a, b) => {
        const domainOrder = new Map(ALL_SKILL_DOMAINS.map((domain, index) => [domain, index]))
        const left = domainOrder.get(a.domain) ?? Number.MAX_SAFE_INTEGER
        const right = domainOrder.get(b.domain) ?? Number.MAX_SAFE_INTEGER
        if (left !== right) {
          return left - right
        }
        return a.label.localeCompare(b.label)
      })
  }, [availableSkills, locale, selectedSkillIds, skillDomainById])

  const loadedTools = useMemo(() => {
    return availableTools
      .filter((tool) => selectedToolIds.includes(tool.id))
      .map((tool) => ({
        id: tool.id,
        category: normalizeToolCategory(tool.category),
        label: resolveToolLabel(tool, locale),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [availableTools, locale, selectedToolIds])

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
        behavior: isStreaming ? 'auto' : 'smooth',
      })
      return
    }

    chatScrollElement.scrollTop = chatScrollElement.scrollHeight
  }, [messages, isStreaming])

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
          if (active) {
            setSkillsLoaded(true)
          }
          return
        }
        const payload = await response.json()
        if (!active || !Array.isArray(payload)) {
          return
        }
        const skills = payload as AgentSkillSummary[]
        setAvailableSkills(skills)
        setSkillsLoaded(true)
      } catch {
        if (active) {
          setAvailableSkills([])
          setSkillsLoaded(true)
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
        if (!response.ok || !active) return
        const payload = await response.json()
        if (!active || !Array.isArray(payload?.engines)) return
        const engines = (payload.engines as Record<string, unknown>[]).map((e) => ({
          id: String(e.id ?? ''),
          name: String(e.name ?? e.id ?? ''),
          available: Boolean(e.available),
          priority: Number(e.priority ?? 0),
          status: String(e.status ?? 'unknown'),
          unavailableReason: typeof e.unavailableReason === 'string' ? e.unavailableReason : undefined,
        }))
        setAllEngines(engines.sort((a, b) => b.priority - a.priority))
      } catch {
        if (active) {
          setAllEngines([])
        }
      }
    }

    loadEngines()
    return () => { active = false }
  }, [])

  const [probePopupOpen, setProbePopupOpen] = useState(false)
  const [probeAllRunning, setProbeAllRunning] = useState(false)
  const probeButtonRef = useRef<HTMLButtonElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)

  async function probeAllEngines() {
    setProbeAllRunning(true)
    setProbePopupOpen(true)
    const initial: typeof probeResults = {}
    allEngines.forEach((e) => { initial[e.id] = { passed: false, loading: true } })
    setProbeResults(initial)

    let active = true

    await Promise.allSettled(
      allEngines.map(async (engine) => {
        try {
          const response = await fetch(`${API_BASE}/api/v1/analysis-engines/${encodeURIComponent(engine.id)}/probe`, { method: 'POST' })
          if (!response.ok) {
            const text = await response.text()
            if (active) setProbeResults((prev) => ({ ...prev, [engine.id]: { passed: false, error: text || `HTTP ${response.status}`, loading: false } }))
            return
          }
          const payload = await response.json()
          if (active) {
            setProbeResults((prev) => ({
              ...prev,
              [engine.id]: {
                passed: Boolean(payload.passed),
                durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
                error: typeof payload.error === 'string' ? payload.error : undefined,
                loading: false,
              },
            }))
          }
        } catch (err) {
          if (active) setProbeResults((prev) => ({ ...prev, [engine.id]: { passed: false, error: String(err), loading: false } }))
        }
      }),
    )

    if (active) setProbeAllRunning(false)
  }

  async function probeSingleEngine(engineId: string) {
    setProbeResults((prev) => ({ ...prev, [engineId]: { passed: false, loading: true } }))
    try {
      const response = await fetch(`${API_BASE}/api/v1/analysis-engines/${encodeURIComponent(engineId)}/probe`, { method: 'POST' })
      if (!response.ok) {
        const text = await response.text()
        setProbeResults((prev) => ({ ...prev, [engineId]: { passed: false, error: text || `HTTP ${response.status}`, loading: false } }))
        return
      }
      let payload: { passed?: unknown; durationMs?: unknown; error?: unknown }
      try {
        payload = await response.json()
      } catch {
        setProbeResults((prev) => ({ ...prev, [engineId]: { passed: false, error: 'Invalid JSON response', loading: false } }))
        return
      }
      setProbeResults((prev) => ({
        ...prev,
        [engineId]: {
          passed: Boolean(payload.passed),
          durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
          error: typeof payload.error === 'string' ? payload.error : undefined,
          loading: false,
        },
      }))
    } catch (err) {
      setProbeResults((prev) => ({ ...prev, [engineId]: { passed: false, error: String(err), loading: false } }))
    }
  }


  useEffect(() => {
    if (capabilityPreferencesHydratedRef.current) {
      return
    }
    if (!skillsLoaded || !capabilityMatrixLoaded) {
      return
    }

    const storedPreferences = loadCapabilityPreferences()
    if (storedPreferences) {
      const validSkillIds = skillNormalization.normalizeSkillIds(storedPreferences.skillIds)
        .filter((skillId) => availableSkills.some((skill) => skill.id === skillId))
      const resolvedTools = resolveCallableTools(capabilityMatrix, validSkillIds, skillDomainById)
      const validToolIds = storedPreferences.toolIds.filter((toolId) => resolvedTools.some((tool) => tool.id === toolId))
      const shouldRepairLegacyDefaultTools =
        hasSameIds(validSkillIds, defaultSelectedSkillIds)
        && hasSameIds(validToolIds, baseCallableToolIds)
        && initialDefaultToolIds.length > baseCallableToolIds.length

      setSelectedSkillIds(validSkillIds)
      setSelectedToolIds(shouldRepairLegacyDefaultTools ? initialDefaultToolIds : validToolIds)
      setHasExplicitSkillSelection(true)
      setHasExplicitToolSelection(true)
    } else {
      setSelectedSkillIds(defaultSelectedSkillIds)
      setSelectedToolIds(initialDefaultToolIds)
      setHasExplicitSkillSelection(false)
      setHasExplicitToolSelection(false)
    }
    capabilityPreferencesHydratedRef.current = true
  }, [availableSkills, baseCallableToolIds, capabilityMatrix, capabilityMatrixLoaded, defaultSelectedSkillIds, initialDefaultToolIds, skillDomainById, skillNormalization, skillsLoaded])

  useEffect(() => {
    let active = true

    async function loadCapabilityMatrix() {
      try {
        const response = await fetch(`${API_BASE}/api/v1/agent/capability-matrix`)
        if (!response.ok) {
          if (active) {
            setCapabilityMatrixLoaded(true)
          }
          return
        }
        const payload = await response.json()
        if (!active || !payload || typeof payload !== 'object') {
          return
        }
        setCapabilityMatrix(payload as CapabilityMatrixPayload)
        setCapabilityMatrixLoaded(true)
      } catch {
        if (active) {
          setCapabilityMatrix(null)
          setCapabilityMatrixLoaded(true)
        }
      }
    }

    loadCapabilityMatrix()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!capabilityPreferencesHydratedRef.current) {
      return
    }
    if (!skillsLoaded || !capabilityMatrixLoaded) {
      return
    }

    saveCapabilityPreferences({
      skillIds: skillNormalization.normalizeSkillIds(selectedSkillIds),
      toolIds: selectedToolIds,
    })
  }, [capabilityMatrixLoaded, selectedSkillIds, selectedToolIds, skillNormalization, skillsLoaded])

  useEffect(() => {
    let cancelled = false

    async function fetchConversations() {
      setHistoryLoading(true)
      setHistoryError('')

      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 8000)

      try {
        const response = await fetch(`${API_BASE}/api/v1/chat/conversations`, { signal: controller.signal })
        window.clearTimeout(timeoutId)
        if (!response.ok) {
          throw new Error(`${t('loadConversationFailed')}: HTTP ${response.status}`)
        }
        const payload = await response.json()
        if (!cancelled) {
          setServerConversations(Array.isArray(payload) ? (payload as ConversationSummary[]) : [])
        }
      } catch (error) {
        if (!cancelled) {
          const isAbort =
            (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
            (error instanceof Error && error.name === 'AbortError')
          if (isAbort) {
            setHistoryError(t('conversationsLoadTimeout'))
          } else {
            setHistoryError(error instanceof Error ? error.message : `${t('loadConversationFailed')}.`)
          }
        }
      } finally {
        window.clearTimeout(timeoutId)
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
  }, [conversationId, modelPreviewBaseTitle, parsedComposerModel, t])

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

  // Track which conversation IDs have been deleted locally to prevent auto-persist from restoring them
  const deletedConversationIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!conversationId || deletedConversationIdsRef.current.has(conversationId)) {
      return
    }

    setConversationArchive((current) => {
      const nextEntry = sanitizePersistedConversation({
        id: conversationId,
        title:
          current[conversationId]?.title
          || serverConversations.find((conversation) => conversation.id === conversationId)?.title
          || messages.find((message) => message.role === 'user')?.content.slice(0, 48)
          || t('untitledConversation'),
        type: 'general',
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
        selectedSkillIds,
        selectedToolIds,
        hasExplicitSkillSelection,
        hasExplicitToolSelection,
        modelSyncMessage,
        activePanel,
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
        visualizationSnapshot:
          latestResultVisualizationSnapshot
          ?? current[conversationId]?.resultVisualizationSnapshot
          ?? current[conversationId]?.visualizationSnapshot
          ?? null,
        staleStructuralData: current[conversationId]?.staleStructuralData ?? false,
      })

      return {
        ...current,
        [conversationId]: nextEntry,
      }
    })
  }, [
    activePanel,
    conversationId,
    latestModelVisualizationSnapshot,
    latestResult,
    latestResultVisualizationSnapshot,
    messages,
    modelSyncMessage,
    modelText,
    selectedSkillIds,
    selectedToolIds,
    hasExplicitSkillSelection,
    hasExplicitToolSelection,
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
        type: 'general',
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
      type: (payload.type as string) || 'general',
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

  function markConversationActivity(targetConversationId: string | undefined) {
    if (!targetConversationId) {
      return
    }

    setConversationActivityAt((current) => ({
      ...current,
      [targetConversationId]: new Date().toISOString(),
    }))
  }

  function appendMessageForConversation(targetConvId: string, message: Message) {
    if (targetConvId === conversationIdRef.current) {
      setMessages((current) => [...current, message])
    } else {
      setConversationArchive((current) => {
        const existing = current[targetConvId]
        if (!existing) return current
        return {
          ...current,
          [targetConvId]: {
            ...existing,
            messages: [...existing.messages, message],
          },
        }
      })
    }
  }

  function replaceMessageForConversation(
    targetConvId: string,
    messageId: string,
    updater: (message: Message) => Message,
  ) {
    if (targetConvId === conversationIdRef.current) {
      setMessages((current) =>
        current.map((message) => (message.id === messageId ? updater(message) : message))
      )
    } else {
      setConversationArchive((current) => {
        const existing = current[targetConvId]
        if (!existing) return current
        return {
          ...current,
          [targetConvId]: {
            ...existing,
            messages: existing.messages.map((message) =>
              (message.id === messageId ? updater(message) : message)
            ),
          },
        }
      })
    }
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

      const nextEntry = sanitizePersistedConversation({
        id: targetConversationId,
        title: existing?.title || serverConversation?.title || t('untitledConversation'),
        type: existing?.type || serverConversation?.type || 'general',
        createdAt: existing?.createdAt || serverConversation?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: existing?.messages || messages,
        modelText: existing?.modelText ?? modelText,
        selectedSkillIds: existing?.selectedSkillIds || selectedSkillIds,
        selectedToolIds: existing?.selectedToolIds || selectedToolIds,
        hasExplicitSkillSelection: existing?.hasExplicitSkillSelection ?? hasExplicitSkillSelection,
        hasExplicitToolSelection: existing?.hasExplicitToolSelection ?? hasExplicitToolSelection,
        modelSyncMessage: existing?.modelSyncMessage || modelSyncMessage,
        activePanel: existing?.activePanel || activePanel,
        latestResult: latestResultValue,
        modelVisualizationSnapshot: modelSnapshot,
        resultVisualizationSnapshot: resultSnapshot,
        visualizationSnapshot: resultSnapshot,
        staleStructuralData: existing?.staleStructuralData ?? false,
      })

      return {
        ...current,
        [targetConversationId]: nextEntry,
      }
    })
  }

  async function handleSelectConversation(nextConversationId: string) {
    if (nextConversationId === conversationId) {
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
        ? payload.messages.flatMap((message): Message[] => {
            // Handle tool messages — these come from persistFullConversationMessages
            if (message.role === 'tool') {
              return [{
                id: message.id,
                role: 'tool' as const,
                content: message.content,
                status: 'done' as const,
                timestamp: message.createdAt,
                toolStep: {
                  id: (message as any).toolCallId || message.id,
                  phase: mapToolNameToPhase((message as any).name || 'unknown'),
                  status: 'done' as const,
                  tool: (message as any).name || 'unknown',
                  title: (message as any).name || 'unknown',
                  output: message.content,
                  completedAt: message.createdAt,
                },
              }]
            }
            // Handle assistant messages with toolCalls metadata
            if (message.role === 'assistant') {
              const toolCalls = (message as any).toolCalls as Array<{ id?: string; name: string; args?: Record<string, unknown> }> | undefined
              const mapped: Message = {
                id: message.id,
                role: 'assistant' as const,
                content: stripLegacyAbortedSuffix(message.content),
                status: parsePersistedMessageStatus(message.metadata, message.content),
                timestamp: message.createdAt,
                debugDetails: parsePersistedDebugDetails(message.metadata),
                presentation: parsePersistedPresentation(message.metadata),
              }
              // Store toolCalls on the assistant message so ToolCallCard can
              // render the expandable args section.  Do NOT emit separate
              // "running" step messages — the DB already has tool-role
              // messages that carry the completion status.
              if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                mapped.toolCalls = toolCalls
              }
              return [mapped]
            }
            // User messages
            return [{
              id: message.id,
              role: 'user' as const,
              content: message.content,
              status: parsePersistedMessageStatus(message.metadata, message.content),
              timestamp: message.createdAt,
              debugDetails: parsePersistedDebugDetails(message.metadata),
              presentation: parsePersistedPresentation(message.metadata),
            }]
          })
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
      const restoredModelText =
        toModelText(session?.model)
        || archived?.modelText
        || toModelText(nextLatestResult?.model)
        || toModelTextFromSnapshot(nextModelSnapshot)
        || toModelTextFromSnapshot(nextFinalResultSnapshot)
        || ''
      const hasStaleStructuralData =
        isStaleVisualizationSnapshot(nextModelSnapshot)
        || isStaleVisualizationSnapshot(nextFinalResultSnapshot)
        || isStaleStructuralResult(nextLatestResult)
      const safeLatestResult = hasStaleStructuralData ? null : nextLatestResult
      const safeModelSnapshot = hasStaleStructuralData ? null : nextModelSnapshot
      const safeResultSnapshot = hasStaleStructuralData ? null : nextFinalResultSnapshot
      const safeModelText = hasStaleStructuralData ? '' : restoredModelText
      const safeModelSyncMessage = hasStaleStructuralData ? '' : nextModelSyncMessage
      const safeActivePanel = hasStaleStructuralData ? 'analysis' : nextActivePanel

      setConversationId(nextConversationId)
      setMessages(nextMessages)
      setModelText(safeModelText)
      setModelSyncMessage(safeModelSyncMessage)
      setLatestResult(safeLatestResult)
      setLatestModelVisualizationSnapshot(safeModelSnapshot)
      setLatestResultVisualizationSnapshot(safeResultSnapshot)
      setActivePanel(safeActivePanel)

      if (hasStaleStructuralData) {
        setConversationArchive((current) => {
          const existing = current[nextConversationId]
          if (!existing) {
            return current
          }
          return {
            ...current,
            [nextConversationId]: sanitizePersistedConversation({
              ...existing,
              modelText: '',
              modelSyncMessage: '',
              activePanel: 'analysis',
              latestResult: null,
              modelVisualizationSnapshot: null,
              resultVisualizationSnapshot: null,
              visualizationSnapshot: null,
              staleStructuralData: true,
            }),
          }
        })
        toast.error(`${t('staleStructuralSessionTitle')}: ${t('staleStructuralSessionBody')}`)
      }
    } catch (error) {
      if (archived) {
        const restoredArchive = sanitizePersistedConversation(archived)
        setConversationId(nextConversationId)
        setMessages(restoredArchive.messages.length ? restoredArchive.messages : [initialAssistantMessage])
        setModelText(
          restoredArchive.modelText
          || toModelText(restoredArchive.latestResult?.model)
          || toModelTextFromSnapshot(restoredArchive.modelVisualizationSnapshot)
          || toModelTextFromSnapshot(restoredArchive.resultVisualizationSnapshot || restoredArchive.visualizationSnapshot)
          || ''
        )
        setModelSyncMessage(restoredArchive.modelSyncMessage || '')
        const archivedLatestResult = normalizeAgentResultPayload(restoredArchive.latestResult || null)
        setLatestResult(archivedLatestResult)
        setLatestModelVisualizationSnapshot(restoredArchive.modelVisualizationSnapshot || null)
        const archivedSynthesizedResultSnapshot = buildResultSnapshotFromResult(
          archivedLatestResult,
          restoredArchive.title || t('untitledConversation'),
          toModelFromVisualizationSnapshot(restoredArchive.modelVisualizationSnapshot || restoredArchive.resultVisualizationSnapshot || restoredArchive.visualizationSnapshot)
        )
        const archivedResultSnapshot = pickPreferredResultSnapshot(
          pickPreferredResultSnapshot(restoredArchive.resultVisualizationSnapshot, restoredArchive.visualizationSnapshot),
          archivedSynthesizedResultSnapshot
        )
        setLatestResultVisualizationSnapshot(archivedResultSnapshot)
        setActivePanel(restoredArchive.activePanel || (archivedLatestResult?.report?.markdown ? 'report' : 'analysis'))

        if (restoredArchive.staleStructuralData) {
          toast.error(`${t('staleStructuralSessionTitle')}: ${t('staleStructuralSessionBody')}`)
        }

        return
      }

      setErrorMessage(error instanceof Error ? error.message : `${t('loadConversationFailed')}.`)
    }
  }

  function resetConsoleState() {
    setConversationId('')
    setMessages([initialAssistantMessage])
    setModelText('')
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
    resetConsoleState()
  }

  async function handleDeleteConversation(targetConversationId: string) {
    if (streamingSessions.get(targetConversationId)?.status === 'streaming' || deletingConversationId || !targetConversationId) {
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

      deletedConversationIdsRef.current.add(targetConversationId)
      const remainingConversations = mergedConversations.filter((conversation) => conversation.id !== targetConversationId)
      setServerConversations((current) => current.filter((conversation) => conversation.id !== targetConversationId))
      setConversationArchive((current) => {
        const next = { ...current }
        delete next[targetConversationId]
        return next
      })
      setConversationActivityAt((current) => {
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

  function applySynchronizedModel(nextModel: Record<string, unknown>, source: 'conversation' | 'tool') {
    const nextText = JSON.stringify(nextModel, null, 2)
    if (nextText !== modelText) {
      setModelText(nextText)
    }
    if (source === 'conversation') {
      setModelSyncMessage(t('modelSyncFromChat'))
      setContextOpen(true)
    }
    setErrorMessage('')
  }

  async function handleSubmit(overrideInput?: string) {
    const trimmedInput = (overrideInput ?? input).trim()
    if (!trimmedInput || submittingRef.current) {
      return
    }
    submittingRef.current = true

    const parsedModel = parseModelJson(modelText, t)
    if (parsedModel.error) {
      setErrorMessage(parsedModel.error)
      setContextOpen(true)
    }
    const contextModel = parsedModel.error ? undefined : parsedModel.model
    const resumeFromMessage = resolveResumeFromMessage(messagesRef.current, trimmedInput)

    const userMessage: Message = {
      id: createId('user'),
      role: 'user',
      content: trimmedInput,
      status: 'done',
      timestamp: new Date().toISOString(),
    }

    const assistantMessageId = createId('assistant')
    const assistantSeed = t('assistantSeedAuto')

    currentPresentationRef.current = null
    setErrorMessage('')
    setInput('')
    setVisualizationOpen(false)
    setVisualizationSource('result')
    setModelSyncMessage('')
    // Append user message and assistant seed immediately (before async work)
    setMessages((current) => [...current, userMessage])
    setMessages((current) => [...current, {
      id: assistantMessageId,
      role: 'assistant',
      content: assistantSeed,
      status: 'streaming',
      timestamp: new Date().toISOString(),
    }])
    let receivedResult = false
    let assistantContent = assistantSeed
    let activeConversationId = conversationId
    let shouldBumpConversationActivity = false
    const abortController = new AbortController()
    const traceId = assistantMessageId
    setIsStreaming(true)

    // --- Multi-bubble tracking ---
    // currentTextMessageId: the active text assistant message being appended to.
    // Set to '' when a tool call starts (text finalized). Next token creates a new one.
    let currentTextMessageId = assistantMessageId
    // toolMessageIds: maps stepId → messageId for tool bubbles
    const toolMessageIds = new Map<string, string>()
    // turnMessageIds: all message IDs created during this turn (for finalization)
    const turnMessageIds = new Set<string>([assistantMessageId])

    /** Ensure a text assistant message exists for writing. Creates one if needed. */
    const ensureTextMessage = () => {
      if (!currentTextMessageId) {
        currentTextMessageId = createId('assistant')
        turnMessageIds.add(currentTextMessageId)
        appendMessageForConversation(activeConversationId, {
          id: currentTextMessageId,
          role: 'assistant',
          content: '',
          status: 'streaming',
          timestamp: new Date().toISOString(),
        })
      }
    }

    const syncTextPresentation = (
      nextPresentation: AssistantPresentation,
      nextStatus: Message['status'] = nextPresentation.status === 'done'
        ? 'done'
        : nextPresentation.status === 'error'
          ? 'error'
          : nextPresentation.status === 'aborted'
            ? 'aborted'
            : 'streaming',
    ) => {
      currentPresentationRef.current = nextPresentation
      ensureTextMessage()
      replaceMessageForConversation(activeConversationId, currentTextMessageId, (message) => ({
        ...message,
        content: nextPresentation.summaryText || assistantContent,
        status: nextStatus,
        presentation: nextPresentation,
      }))
    }

    const finalizeAbortedTurn = async () => {
      const abortedContent = resolveAbortedAssistantContent(assistantContent, assistantSeed)
      const abortedPresentation = currentPresentationRef.current
        ? {
            ...currentPresentationRef.current,
            status: 'aborted' as const,
            completedAt: currentPresentationRef.current.completedAt || new Date().toISOString(),
            summaryText: currentPresentationRef.current.summaryText || abortedContent,
          }
        : undefined

      // Finalize ALL messages created during this turn
      for (const msgId of turnMessageIds) {
        replaceMessageForConversation(activeConversationId, msgId, (message) => {
          if (message.status !== 'streaming') return message
          return message.role === 'tool'
            ? { ...message, status: 'aborted' as const }
            : {
                ...message,
                content: message.id === currentTextMessageId ? abortedContent : message.content || abortedContent,
                status: 'aborted' as const,
                presentation: abortedPresentation ?? message.presentation,
              }
        })
      }

      if (activeConversationId) {
        await saveConversationMessagesToBackend(activeConversationId, {
          userMessage: trimmedInput,
          assistantContent: abortedContent,
          assistantAborted: true,
          traceId,
          assistantPresentation: abortedPresentation,
        })
      }
    }

    try {
      const nextConversationId = await ensureConversation(trimmedInput)
      activeConversationId = nextConversationId

      // Set conversationId immediately so the Stop button appears
      // without waiting for the SSE start event.
      if (nextConversationId !== conversationId) {
        conversationIdRef.current = nextConversationId
        setConversationId(nextConversationId)
      }

      registerStreamSession({
        conversationId: nextConversationId,
        status: 'streaming',
        abortController,
        assistantMessageId,
        reader: null,
      })

      const storedPreferences = capabilityPreferencesHydratedRef.current ? null : loadCapabilityPreferences()
      const storedSkillIds = storedPreferences
        ? skillNormalization.normalizeSkillIds(storedPreferences.skillIds)
        : []
      const hasStoredExplicitSkillSelection = Boolean(storedPreferences)
      const hasStoredExplicitToolSelection = Boolean(storedPreferences)
      const normalizedSkillIds = skillNormalization.normalizeSkillIds(selectedSkillIds)
      const fallbackDefaultSkillIds = skillNormalization.normalizeSkillIds(
        defaultSelectedSkillIds.length > 0
          ? defaultSelectedSkillIds
          : [...DEFAULT_CONSOLE_SKILL_IDS]
      )
      const effectiveSkillIds = normalizedSkillIds.length > 0
        ? normalizedSkillIds
        : hasExplicitSkillSelection
          ? []
          : hasStoredExplicitSkillSelection
            ? storedSkillIds
            : fallbackDefaultSkillIds
      const effectiveEnabledToolIds = selectedToolIds.length > 0
        ? selectedToolIds
        : hasExplicitToolSelection
          ? []
          : hasStoredExplicitToolSelection
            ? storedPreferences?.toolIds ?? []
            : undefined
      const contextPayload = {
        locale,
        skillIds: effectiveSkillIds,
        enabledToolIds: effectiveEnabledToolIds,
        model: contextModel,
        modelFormat: contextModel ? 'structuremodel-v2' : undefined,
        engineId: undefined,
        autoCodeCheck: hasSelectedCodeCheckSkill || undefined,
        resumeFromMessage,
      }
      const promptSnapshot = buildPromptSnapshot(trimmedInput, contextPayload as Record<string, unknown>)
      const debugSkillIds = Array.isArray((contextPayload as Record<string, unknown>).skillIds)
        ? ((contextPayload as Record<string, unknown>).skillIds as string[])
        : []
      const debugToolIds = Array.isArray((contextPayload as Record<string, unknown>).enabledToolIds)
        ? ((contextPayload as Record<string, unknown>).enabledToolIds as string[])
        : []

      // If the LangGraph agent is paused with interrupt(), resume it
      // by calling /stream/resume instead of starting a new /stream
      const isResume = resumeRequiredRef.current
      resumeRequiredRef.current = false
      setPendingOptions([])

      const response = isResume
        ? await fetch(`${API_BASE}/api/v1/chat/stream/resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversationId: nextConversationId,
              resumeValue: trimmedInput,
            }),
            signal: abortController.signal,
          })
        : await fetch(`${API_BASE}/api/v1/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: trimmedInput,
              conversationId: nextConversationId,
              traceId,
              context: contextPayload,
            }),
            signal: abortController.signal,
          })

      if (!response.ok || !response.body) {
        throw new Error(`${t('requestFailedHttp')}: HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      // Store reader so stopStream can cancel it directly
      const existingSession = streamingSessionsRef.current.get(nextConversationId)
      if (existingSession) {
        existingSession.reader = reader
      }
      const decoder = new TextDecoder()
      let buffer = ''
      let chatBuffer = ''

      while (true) {
        if (abortController.signal.aborted) break
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          if (abortController.signal.aborted) break
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
            ensureTextMessage()
            replaceMessageForConversation(activeConversationId, currentTextMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'streaming',
            }))
          }

          if (payload.type === 'interaction_update') {
            const interactionMessage = buildInteractionMessage(payload, t, locale)
            assistantContent = interactionMessage
            if (currentPresentationRef.current) {
              const existingSummary = currentPresentationRef.current.summaryText || ''
              const combinedSummary = existingSummary
                ? `${existingSummary}\n\n---\n\n${interactionMessage}`
                : interactionMessage
              const nextPresentation = reducePresentationEvent(currentPresentationRef.current, {
                type: 'summary_replace',
                summaryText: combinedSummary,
              })
              syncTextPresentation(nextPresentation, 'streaming')
            } else {
              ensureTextMessage()
              replaceMessageForConversation(activeConversationId, currentTextMessageId, (message) => ({
                ...message,
                content: assistantContent,
                status: 'streaming',
              }))
            }
            if ((payload.content as Record<string, unknown>)?.resumeRequired) {
              resumeRequiredRef.current = true
            }
            const interactionOpts = (payload.content as AgentInteraction)?.options || []
            if (interactionOpts.length > 0) setPendingOptions(interactionOpts)
          }

          // 处理 'start' 类型消息（包含 conversationId）
          if (payload.type === 'start' && payload.content && typeof payload.content === 'object') {
            const { conversationId: newConversationId } = payload.content as { conversationId?: string; startedAt?: string }
            if (newConversationId && (!conversationIdRef.current || activeConversationId === conversationIdRef.current)) {
              setConversationId(newConversationId)
            }
          }

          if (payload.type === 'presentation_init' && payload.presentation) {
            syncTextPresentation(payload.presentation, 'streaming')
          }

          if (payload.type === 'phase_upsert' && payload.phase && currentPresentationRef.current) {
            const nextPresentation = reducePresentationEvent(currentPresentationRef.current, {
              type: 'phase_upsert',
              phase: payload.phase,
            })
            syncTextPresentation(nextPresentation, 'streaming')
          }

          if (payload.type === 'step_upsert' && payload.phaseId && payload.step) {
            if (payload.step.status === 'running') {
              // Finalize current text message
              if (currentTextMessageId) {
                replaceMessageForConversation(activeConversationId, currentTextMessageId, (msg) => {
                  if (msg.status !== 'streaming') return msg
                  return { ...msg, status: 'done' as const }
                })
                currentTextMessageId = ''
                chatBuffer = ''  // Reset so next text bubble only contains new tokens
              }
              // Create a new tool message bubble
              const toolMsgId = createId('tool')
              toolMessageIds.set(payload.step.id, toolMsgId)
              turnMessageIds.add(toolMsgId)
              appendMessageForConversation(activeConversationId, {
                id: toolMsgId,
                role: 'tool',
                content: '',
                status: 'streaming',
                timestamp: new Date().toISOString(),
                toolStep: payload.step,
              })
              // Also track in presentation (for data continuity)
              if (currentPresentationRef.current) {
                const nextPresentation = reducePresentationEvent(currentPresentationRef.current, {
                  type: 'step_upsert',
                  phaseId: payload.phaseId,
                  step: payload.step,
                })
                currentPresentationRef.current = nextPresentation
              }
            } else {
              // Update existing tool message (done / error)
              const toolMsgId = toolMessageIds.get(payload.step.id)
              if (toolMsgId) {
                replaceMessageForConversation(activeConversationId, toolMsgId, (msg) => ({
                  ...msg,
                  status: (payload.step!.status === 'error' ? 'error' : 'done') as Message['status'],
                  toolStep: { ...msg.toolStep!, ...payload.step },
                }))
              }
              // On tool done, create a "thinking" text bubble so the user sees
              // the LLM is still running. The next token will replace this content.
              if (payload.step.status === 'done' && !currentTextMessageId) {
                currentTextMessageId = createId('assistant')
                turnMessageIds.add(currentTextMessageId)
                appendMessageForConversation(activeConversationId, {
                  id: currentTextMessageId,
                  role: 'assistant',
                  content: '',
                  status: 'streaming',
                  timestamp: new Date().toISOString(),
                })
              }
              // Also track in presentation
              if (currentPresentationRef.current) {
                const nextPresentation = reducePresentationEvent(currentPresentationRef.current, {
                  type: 'step_upsert',
                  phaseId: payload.phaseId,
                  step: payload.step,
                })
                currentPresentationRef.current = nextPresentation
              }
            }
          }

          if (payload.type === 'artifact_upsert' && payload.artifact && currentPresentationRef.current) {
            const nextPresentation = reducePresentationEvent(currentPresentationRef.current, {
              type: 'artifact_upsert',
              artifact: payload.artifact,
            })
            syncTextPresentation(nextPresentation, 'streaming')
          }

          if (payload.type === 'summary_replace' && typeof payload.summaryText === 'string' && currentPresentationRef.current) {
            assistantContent = payload.summaryText
            const nextPresentation = reducePresentationEvent(currentPresentationRef.current, {
              type: 'summary_replace',
              summaryText: payload.summaryText,
            })
            syncTextPresentation(nextPresentation, 'streaming')
          }

          if (payload.type === 'presentation_complete' && typeof payload.completedAt === 'string' && currentPresentationRef.current) {
            const nextPresentation = reducePresentationEvent(currentPresentationRef.current, {
              type: 'presentation_complete',
              completedAt: payload.completedAt,
            })
            syncTextPresentation(nextPresentation, 'done')
          }

          if (payload.type === 'presentation_error' && payload.phase && payload.message && currentPresentationRef.current) {
            assistantContent = payload.message || assistantContent
            const nextPresentation = reducePresentationEvent(currentPresentationRef.current, {
              type: 'presentation_error',
              phase: payload.phase as 'understanding' | 'modeling' | 'validation' | 'analysis' | 'report',
              message: payload.message,
            })
            syncTextPresentation(nextPresentation, 'error')
          }

          if (payload.type === 'artifact_payload_sync') {
            if (payload.artifact === 'model' && payload.model) {
              if (activeConversationId === conversationIdRef.current) {
                applySynchronizedModel(payload.model, 'tool')
              }
            }
            if (payload.artifact === 'analysis' && payload.latestResult && activeConversationId === conversationIdRef.current) {
              setLatestResult((current) => ({
                ...(current || {}),
                ...(payload.latestResult || {}),
              }))
            }
            if (payload.artifact === 'report' && payload.latestResult && activeConversationId === conversationIdRef.current) {
              setLatestResult((current) => ({
                ...(current || {}),
                ...(payload.latestResult || {}),
              }))
              setActivePanel(payload.latestResult.report?.markdown ? 'report' : 'analysis')
            }
          }

          if (payload.type === 'result' && payload.content && typeof payload.content === 'object') {
            const result = {
              ...(payload.content as AgentResult),
            }
            const visualizationHints = extractVisualizationHints(result)
            const debugDetails = buildMessageDebugDetails(promptSnapshot, debugSkillIds, debugToolIds, result)
            if (result.model && typeof result.model === 'object' && !Array.isArray(result.model)) {
              if (activeConversationId === conversationIdRef.current) {
                applySynchronizedModel(result.model, result.analysis ? 'tool' : 'conversation')
              }
            }
            const visualizationSnapshot = buildVisualizationSnapshot({
              title: buildVisualizationTitle(result, trimmedInput.slice(0, 48) || t('untitledConversation')),
              model: (result.model && typeof result.model === 'object' && !Array.isArray(result.model) ? result.model : contextModel) ?? null,
              analysis: extractAnalysis(result),
              mode: 'analysis-result',
              memberUtilizationMap: visualizationHints?.memberUtilizationMap,
              bucklingModes: visualizationHints?.bucklingModes,
            })
            const modelSnapshot = buildVisualizationSnapshot({
              title: buildVisualizationTitle(result, trimmedInput.slice(0, 48) || t('untitledConversation')),
              model: (result.model && typeof result.model === 'object' && !Array.isArray(result.model) ? result.model : contextModel) ?? null,
              mode: 'model-only',
            })
            receivedResult = true
            // Only update active conversation state when this is the foreground stream
            if (activeConversationId === conversationIdRef.current) {
              setLatestResult(result)
              setLatestModelVisualizationSnapshot(modelSnapshot)
              setLatestResultVisualizationSnapshot(visualizationSnapshot)
              setActivePanel(result.report?.markdown ? 'report' : 'analysis')
            }
            // Always persist results to archive (for both active and background)
            persistConversationSnapshotsToArchive(activeConversationId, {
              latestResult: result,
              modelSnapshot,
              resultSnapshot: visualizationSnapshot,
            })
            // 保存结果快照到后端（fire-and-forget to avoid blocking the stream loop）
            saveConversationSnapshotToBackend(activeConversationId, {
              modelSnapshot,
              resultSnapshot: visualizationSnapshot,
              latestResult: result,
            }).catch(() => {})
            assistantContent = result.response || result.clarification?.question || t('returnedResult')
            let nextPresentation: AssistantPresentation | null = currentPresentationRef.current
            if (nextPresentation) {
              if (!nextPresentation.summaryText) {
                nextPresentation = reducePresentationEvent(nextPresentation, {
                  type: 'summary_replace',
                  summaryText: assistantContent,
                })
              }
              nextPresentation = reducePresentationEvent(nextPresentation, {
                type: 'presentation_complete',
                completedAt: result.completedAt || new Date().toISOString(),
              })
              currentPresentationRef.current = nextPresentation
            }
            ensureTextMessage()
            replaceMessageForConversation(activeConversationId, currentTextMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'done',
              debugDetails,
              presentation: currentPresentationRef.current ?? message.presentation,
            }))
            shouldBumpConversationActivity = true
          }

          if (payload.type === 'error') {
            let nextError = typeof payload.error === 'string' ? payload.error : t('requestFailed')
            if (payload.code === 'CONTEXT_OVERFLOW') {
              nextError = t('contextOverflowError')
            }
            assistantContent = nextError
            setPendingOptions([])
            if (activeConversationId === conversationIdRef.current) {
              setErrorMessage(nextError)
            }
            ensureTextMessage()
            replaceMessageForConversation(activeConversationId, currentTextMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'error',
              presentation: currentPresentationRef.current ?? message.presentation,
            }))
            shouldBumpConversationActivity = true
          }
        }
      }

      if (abortController.signal.aborted) {
        await finalizeAbortedTurn()
      } else {
        // Finalize all still-streaming messages from this turn
        for (const msgId of turnMessageIds) {
          replaceMessageForConversation(activeConversationId, msgId, (message) => {
            if (message.status !== 'streaming') return message
            return {
              ...message,
              content: message.content || assistantSeed,
              status: 'done' as const,
              presentation: message.role === 'tool' ? undefined : (currentPresentationRef.current ?? message.presentation),
            }
          })
        }
        if (assistantContent !== assistantSeed || receivedResult) {
          shouldBumpConversationActivity = true
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        await finalizeAbortedTurn()
      } else {
        const nextError = error instanceof Error ? error.message : t('requestFailed')

        if ((receivedResult || assistantContent !== assistantSeed) && nextError === 'Failed to fetch') {
          for (const msgId of turnMessageIds) {
            replaceMessageForConversation(activeConversationId, msgId, (message) => {
              if (message.status !== 'streaming') return message
              return {
                ...message,
                status: 'done' as const,
                presentation: message.role === 'tool' ? undefined : (currentPresentationRef.current ?? message.presentation),
              }
            })
          }
        } else {
          if (activeConversationId === conversationIdRef.current) {
            setErrorMessage(nextError)
          }
          ensureTextMessage()
          replaceMessageForConversation(activeConversationId, currentTextMessageId, (message) => ({
            ...message,
            content: nextError,
            status: 'error',
            presentation: currentPresentationRef.current ?? message.presentation,
          }))
          shouldBumpConversationActivity = Boolean(activeConversationId)
        }
      }
    } finally {
      submittingRef.current = false
      setIsStreaming(false)
      if (shouldBumpConversationActivity || abortController.signal.aborted) {
        markConversationActivity(activeConversationId)
      }
      const finalStatus = abortController.signal.aborted ? 'aborted' : 'completed'
      updateStreamSessionStatus(activeConversationId, finalStatus)
      setTimeout(() => removeStreamSession(activeConversationId), 2000)
    }
  }

  const historyCollapsed = uiPreferences.historyCollapsed && isSidebarLayout

  return (
    <div
      data-testid="console-layout-grid"
      data-history-collapsed={String(historyCollapsed)}
      data-output-mode={outputMode}
      className={cn(
        'grid min-h-[calc(100vh-5.5rem)] gap-3 xl:gap-4 xl:h-full xl:min-h-0 xl:overflow-hidden transition-[grid-template-columns] duration-300 ease-in-out',
        outputMode === 'modal'
          ? (
              historyCollapsed
                ? 'xl:grid-cols-[72px_minmax(0,1fr)] 2xl:grid-cols-[80px_minmax(0,1fr)]'
                : 'xl:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)]'
            )
          : (
              historyCollapsed
                ? 'xl:grid-cols-[72px_minmax(0,2.6fr)_420px] 2xl:grid-cols-[80px_minmax(0,2.8fr)_460px]'
                : 'xl:grid-cols-[260px_minmax(0,2.2fr)_420px] 2xl:grid-cols-[280px_minmax(0,2.4fr)_460px]'
            )
      )}
    >
      <aside
        data-testid="console-history-panel"
        className={cn(
          'flex h-full flex-col rounded-[28px] border border-border/70 bg-card/80 backdrop-blur-xl xl:min-h-0 dark:border-white/10 dark:bg-white/5',
          historyCollapsed ? 'min-h-[220px] items-center px-2 py-4' : 'min-h-[320px]'
        )}
      >
        {historyCollapsed ? (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-10 w-10 rounded-full text-muted-foreground hover:bg-cyan-300/10 hover:text-foreground"
              aria-label={t('expandHistoryPanel')}
              onClick={() => setUiPreferences((current) => ({ ...current, historyCollapsed: false }))}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              className="mt-3 h-10 w-10 rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
              aria-label={t('newConversation')}
              onClick={handleNewConversation}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
            <div className="mt-5 flex flex-1 items-center justify-center">
              <div className="flex items-center gap-3 [writing-mode:vertical-rl]">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-700/80 dark:text-cyan-200/70">
                  {t('historyCollapsedTitle')}
                </span>
                <span className="sr-only">{t('historyCollapsedBody')}</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-border/70 px-5 py-4 dark:border-white/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-700/80 dark:text-cyan-200/70">{t('conversationMemory')}</p>
                  <h2 className="mt-1 text-lg font-semibold text-foreground">{t('conversationHistory')}</h2>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:bg-cyan-300/10 hover:text-foreground"
                  aria-label={t('collapseHistoryPanel')}
                  onClick={() => setUiPreferences((current) => ({ ...current, historyCollapsed: true }))}
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t('conversationHistoryDesc')}
              </p>
              <Button
                type="button"
                className="mt-4 w-full rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                onClick={handleNewConversation}
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
                                  {streamingSessions.get(conversation.id)?.status === 'streaming' && (
                                    <span className="flex items-center gap-1 text-cyan-600 dark:text-cyan-400">
                                      <span className="inline-flex h-2 w-2 rounded-full bg-cyan-500 animate-pulse" />
                                      {t('streamingInProgress')}
                                    </span>
                                  )}
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
          </>
        )}
      </aside>

      <section
        data-testid="console-chat-panel"
        className="relative flex h-full flex-col overflow-hidden rounded-[32px] border border-border/70 bg-card/85 shadow-[0_40px_120px_-50px_rgba(34,211,238,0.2)] backdrop-blur-xl xl:min-h-0 dark:border-white/10 dark:bg-slate-950/70 dark:shadow-[0_40px_120px_-50px_rgba(34,211,238,0.45)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.12),transparent_30%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.18),transparent_30%)]" />
        <div className="relative flex h-full min-h-[320px] flex-col xl:min-h-0">
          <div className="border-b border-border/70 px-4 py-3 2xl:px-5 2xl:py-4 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-700/80 dark:text-cyan-200/70">{t('aiConsoleEyebrow')}</p>
                <h1 className="mt-1 text-2xl font-semibold text-foreground">{t('aiConsoleTitle')}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {outputMode === 'modal' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full border-cyan-300/35 bg-cyan-300/10 text-cyan-800 hover:bg-cyan-300/20 dark:text-cyan-100"
                    onClick={() => setResultDialogOpen(true)}
                  >
                    <PanelRightOpen className="h-4 w-4" />
                    {t('openResultPanel')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setOutputMode(outputMode === 'dock' ? 'modal' : 'dock')}
                >
                  {outputMode === 'dock' ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                  {outputMode === 'dock' ? t('usePopupResults') : t('dockResultPanel')}
                </Button>
                <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-700 dark:text-cyan-100" variant="outline">
                  {t('aiConsoleBadgePrimary')}
                </Badge>
                <Badge className="border-border/70 bg-background/70 text-muted-foreground dark:border-white/10 dark:bg-white/5" variant="outline">
                  {t('aiConsoleBadgeSecondary')}
                </Badge>
              </div>
            </div>
            <p className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground">
              {t('aiConsoleIntro')}
            </p>
            <div className="mt-4 max-w-5xl rounded-[22px] border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/5">
              <div className="font-medium text-foreground">{t('databaseAdminConsoleCardTitle')}</div>
              <div className="mt-1 leading-6">{t('databaseAdminConsoleCardBody')}</div>
            </div>
          </div>

          <div
            ref={chatScrollRef}
            data-testid="console-chat-scroll"
            className="flex-1 overflow-auto px-4 py-4 2xl:px-5 2xl:py-5 xl:min-h-0"
          >
            <div className="flex w-full flex-col gap-4">
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

              {messageRenderGroups.map((group, groupIndex) => {
                if (group.type === 'assistant-execution') {
                  const message = group.assistant
                  return (
                    <div key={message.id} data-testid="assistant-execution-group" className="flex justify-start gap-3">
                      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-700 dark:text-cyan-200">
                        <Bot className="h-5 w-5" />
                      </div>
                      <div className="max-w-[88%] space-y-2">
                        <div className="rounded-[26px] border border-border/70 bg-background/70 px-5 py-4 text-foreground shadow-lg dark:border-white/10 dark:bg-white/5">
                          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            <BrainCircuit className="h-3.5 w-3.5" />
                            <span>{t('structureClawAi')}</span>
                            <span className="text-slate-500">{formatDate(message.timestamp, locale)}</span>
                          </div>
                          {message.presentation ? (
                            <MessagePresentationView
                              presentation={message.presentation}
                              t={t}
                              resolveSkillName={(skillId: string) => {
                                const skill = availableSkills.find((s) => s.id === skillId)
                                if (!skill) return skillId
                                return locale === 'zh' ? (skill.name.zh || skill.name.en || skillId) : (skill.name.en || skill.name.zh || skillId)
                              }}
                            />
                          ) : message.content ? (
                            <MarkdownBody compact content={message.content} />
                          ) : null}
                          {message.status === 'streaming' && (
                            <span className="inline-flex items-center gap-1.5 mt-1" role="status">
                              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500 dark:bg-cyan-400" />
                              <span className="text-xs text-muted-foreground animate-pulse">{t('streamingInProgress')}</span>
                            </span>
                          )}
                          {message.status === 'aborted' && (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs text-rose-500 dark:text-rose-400">
                              <Square className="h-2.5 w-2.5" />
                              {t('streamAborted')}
                            </span>
                          )}
                          {message.status === 'error' && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-xs text-rose-500 dark:text-rose-400">{t('streamAborted')}</span>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-full border border-rose-300/40 bg-rose-300/10 px-2.5 py-1 text-[11px] text-rose-800 hover:bg-rose-300/20 dark:text-rose-200"
                                onClick={() => {
                                  const prevUserMsg = findPreviousUserMessage(messages, message.id)
                                  if (prevUserMsg) {
                                    setInput(prevUserMsg.content)
                                    composerTextareaRef.current?.focus()
                                  }
                                }}
                              >
                                <RefreshCw className="h-3 w-3" />
                                {t('retrySend')}
                              </button>
                            </div>
                          )}
                        </div>
                        {group.tools.length > 0 ? (
                          <div className="ml-4 space-y-2 border-l border-cyan-300/30 pl-4">
                            {group.tools.map((toolMessage) => (
                              toolMessage.toolStep ? (
                                <ToolCallCard key={toolMessage.id} step={toolMessage.toolStep} t={t} attached />
                              ) : toolMessage.status === 'streaming' ? (
                                <span key={toolMessage.id} className="inline-flex items-center gap-1.5" role="status">
                                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500 dark:bg-cyan-400" />
                                  <span className="text-xs text-muted-foreground animate-pulse">{t('streamingInProgress')}</span>
                                </span>
                              ) : null
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                }

                const message = group.message
                return (
                <div
                  key={message.id}
                  className={cn('flex gap-3', message.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {/* Tool message — compact card, no avatar/header */}
                  {message.role === 'tool' && (
                    <div className="max-w-[82%]">
                      {message.toolStep && (
                        <ToolCallCard step={message.toolStep} t={t} />
                      )}
                      {message.status === 'streaming' && !message.toolStep && (
                        <span className="inline-flex items-center gap-1.5" role="status">
                          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500 dark:bg-cyan-400" />
                          <span className="text-xs text-muted-foreground animate-pulse">{t('streamingInProgress')}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* User and assistant messages */}
                  {message.role !== 'tool' && (
                    <>
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
                        {message.presentation ? (
                          <MessagePresentationView
                            presentation={message.presentation}
                            t={t}
                            resolveSkillName={(skillId: string) => {
                              const skill = availableSkills.find((s) => s.id === skillId)
                              if (!skill) return skillId
                              return locale === 'zh' ? (skill.name.zh || skill.name.en || skillId) : (skill.name.en || skill.name.zh || skillId)
                            }}
                          />
                        ) : message.content ? (
                          message.role === 'assistant'
                            ? <MarkdownBody compact content={message.content} />
                            : <div className="whitespace-pre-wrap text-sm leading-7">{message.content}</div>
                        ) : null}
                        {message.status === 'streaming' && (
                          <span className="inline-flex items-center gap-1.5 mt-1" role="status">
                            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500 dark:bg-cyan-400" />
                            <span className="text-xs text-muted-foreground animate-pulse">{t('streamingInProgress')}</span>
                          </span>
                        )}
                        {message.status === 'aborted' && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-rose-500 dark:text-rose-400">
                            <Square className="h-2.5 w-2.5" />
                            {t('streamAborted')}
                          </span>
                        )}
                        {message.status === 'error' && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-rose-500 dark:text-rose-400">{t('streamAborted')}</span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-rose-300/40 bg-rose-300/10 px-2.5 py-1 text-[11px] text-rose-800 hover:bg-rose-300/20 dark:text-rose-200"
                          onClick={() => {
                            const prevUserMsg = findPreviousUserMessage(messages, message.id)
                            if (prevUserMsg) {
                              setInput(prevUserMsg.content)
                              composerTextareaRef.current?.focus()
                            }
                          }}
                        >
                          <RefreshCw className="h-3 w-3" />
                          {t('retrySend')}
                        </button>
                      </div>
                    )}
                    {message.role === 'assistant' && extractPdfUrl(message.content) && (
                      <div className="group/pdf mt-3 overflow-hidden rounded-xl border border-border/70 dark:border-white/10">
                        <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 dark:border-white/10">
                          <span className="text-xs font-medium text-muted-foreground">PDF</span>
                          <button
                            type="button"
                            onClick={() => window.open(extractPdfUrl(message.content)!, '_blank')}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Maximize2 className="h-3 w-3" />
                            {locale === 'zh' ? '全屏查看' : 'Fullscreen'}
                          </button>
                        </div>
                        <iframe
                          src={extractPdfUrl(message.content)!}
                          className="h-[480px] w-full border-0"
                          title="PDF Preview"
                        />
                      </div>
                    )}
                    {message.role === 'assistant' && message.debugDetails && !message.presentation && (
                      <details className="mt-3 rounded-2xl border border-border/70 bg-background/60 px-3 py-2 dark:border-white/10 dark:bg-slate-950/40">
                        <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          {t('promptThinkingToggle')}
                        </summary>
                        <div className="mt-3 space-y-3">
                          <div>
                            <div className="mb-1 text-xs font-medium text-foreground">{t('promptThinkingPrompt')}</div>
                            <pre className="max-h-52 overflow-auto rounded-xl border border-border/70 bg-background/70 p-2 text-[11px] leading-5 text-foreground dark:border-white/10 dark:bg-black/20">
                              {message.debugDetails.promptSnapshot}
                            </pre>
                          </div>

                          <div>
                            <div className="mb-1 text-xs font-medium text-foreground">{t('promptThinkingSkills')}</div>
                            {message.debugDetails.skillIds.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {message.debugDetails.skillIds.map((skillId) => (
                                  <Badge key={`${message.id}-skill-${skillId}`} variant="outline" className="text-[10px]">
                                    {skillId}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">{t('promptThinkingNoSkills')}</div>
                            )}
                          </div>

                          <div>
                            <div className="mb-1 text-xs font-medium text-foreground">{t('promptThinkingResolvedSkills')}</div>
                            {message.debugDetails.routing ? (
                              <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 px-2.5 py-2 text-xs leading-5 text-muted-foreground dark:border-white/10 dark:bg-black/20">
                                {message.debugDetails.routing.structuralSkillId ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-foreground">{t('promptThinkingStructuralSkill')}</span>
                                    <Badge variant="outline" className="text-[10px]">
                                      {message.debugDetails.routing.structuralSkillId}
                                    </Badge>
                                  </div>
                                ) : null}
                                {message.debugDetails.routing.analysisSkillId ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-foreground">{t('promptThinkingAnalysisSkill')}</span>
                                    <Badge variant="outline" className="text-[10px]">
                                      {message.debugDetails.routing.analysisSkillId}
                                    </Badge>
                                  </div>
                                ) : null}
                                {message.debugDetails.routing.analysisSkillIds && message.debugDetails.routing.analysisSkillIds.length > 1 ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {message.debugDetails.routing.analysisSkillIds.map((skillId) => (
                                      <Badge key={`${message.id}-resolved-analysis-${skillId}`} variant="outline" className="text-[10px]">
                                        {skillId}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">{t('promptThinkingNoResolvedSkills')}</div>
                            )}
                          </div>

                          <div>
                            <div className="mb-1 text-xs font-medium text-foreground">{t('promptThinkingResponse')}</div>
                            <div className="rounded-xl border border-border/70 bg-background/70 px-2.5 py-2 text-xs leading-5 text-muted-foreground dark:border-white/10 dark:bg-black/20">
                              {message.debugDetails.responseSummary || t('noNaturalLanguageSummary')}
                            </div>
                          </div>

                          <div>
                            <div className="mb-1 text-xs font-medium text-foreground">{t('promptThinkingProcess')}</div>
                            {message.debugDetails.plan.length > 0 ? (
                              <ol className="space-y-1.5 text-xs text-muted-foreground">
                                {message.debugDetails.plan.map((step, index) => (
                                  <li key={`${message.id}-plan-${index}`} className="flex gap-2">
                                    <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cyan-300/15 text-[10px] text-cyan-700 dark:text-cyan-200">
                                      {index + 1}
                                    </span>
                                    <span>{step}</span>
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <div className="text-xs text-muted-foreground">{t('promptThinkingNoPlan')}</div>
                            )}
                          </div>

                          <div>
                            <div className="mb-1 text-xs font-medium text-foreground">{t('promptThinkingToolCalls')}</div>
                            {message.debugDetails.toolCalls.length > 0 ? (
                              <div className="space-y-2">
                                {message.debugDetails.toolCalls.map((call, index) => (
                                  <div key={`${message.id}-tool-${call.tool}-${index}`} className="rounded-xl border border-border/70 bg-background/70 px-2.5 py-2 text-xs dark:border-white/10 dark:bg-black/20">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium text-foreground">{call.tool}</span>
                                      <Badge variant="outline" className="text-[10px]">
                                        {call.status === 'success' ? t('toolCallStatusSuccess') : t('toolCallStatusError')}
                                      </Badge>
                                      {typeof call.durationMs === 'number' ? (
                                        <span className="text-muted-foreground">{call.durationMs} ms</span>
                                      ) : null}
                                    </div>
                                    {call.error ? (
                                      <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">{call.error}</div>
                                    ) : null}
                                    <details className="mt-2 rounded-lg border border-border/70 bg-background/60 px-2 py-1.5 dark:border-white/10 dark:bg-slate-950/40">
                                      <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                                        {t('promptThinkingToolCallToggle')} #{index + 1}
                                      </summary>
                                      <div className="mt-2 space-y-2">
                                        <div>
                                          <div className="mb-1 text-[11px] font-medium text-foreground">{t('promptThinkingToolInput')}</div>
                                          <pre className="max-h-44 overflow-auto rounded-md border border-border/70 bg-background/70 p-2 text-[10px] leading-5 text-foreground dark:border-white/10 dark:bg-black/20">
                                            {formatDebugPayload(call.input, t('promptThinkingNoInput'))}
                                          </pre>
                                        </div>
                                        <div>
                                          <div className="mb-1 text-[11px] font-medium text-foreground">{t('promptThinkingToolOutput')}</div>
                                          <pre className="max-h-44 overflow-auto rounded-md border border-border/70 bg-background/70 p-2 text-[10px] leading-5 text-foreground dark:border-white/10 dark:bg-black/20">
                                            {formatDebugPayload(call.output, t('promptThinkingNoOutput'))}
                                          </pre>
                                        </div>
                                      </div>
                                    </details>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">{t('promptThinkingNoToolCalls')}</div>
                            )}
                          </div>
                        </div>
                      </details>
                    )}
                  </div>

                  {message.role === 'user' && (
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground dark:bg-white/10 dark:text-slate-200">
                      <User className="h-5 w-5" />
                    </div>
                  )}
                  </>
                  )}
                </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {pendingOptions.length > 0 && !isStreaming && (
            <div className="flex flex-wrap gap-2 px-4 py-2">
              {pendingOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    handleSubmit(option)
                  }}
                  className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-sm text-cyan-700 transition hover:bg-cyan-300/20 hover:border-cyan-300/50 dark:text-cyan-300"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          <div data-testid="console-composer" className="border-t border-border/70 px-3 py-3 2xl:px-4 dark:border-white/10 overflow-y-auto max-h-[40vh]">
            <div className="w-full space-y-3">
              {errorMessage && (
                <div role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {errorMessage}
                </div>
              )}

              <div className="rounded-[24px] border border-border/70 bg-background/70 p-2.5 dark:border-white/10 dark:bg-black/20">
                <div className="mb-2 rounded-[18px] border border-border/70 bg-card/60 px-3 py-3 dark:border-white/10 dark:bg-white/5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{t('capabilitySettingsSummaryTitle')}</p>
                        <button
                          type="button"
                          title={t('skillVsToolSkillHelp')}
                          className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground dark:border-white/10 dark:bg-white/5"
                        >
                          {t('skillShortLabel')}
                        </button>
                        <button
                          type="button"
                          title={t('skillVsToolToolHelp')}
                          className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground dark:border-white/10 dark:bg-white/5"
                        >
                          {t('toolShortLabel')}
                        </button>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground hidden 2xl:block">{t('capabilitySettingsSummaryBody')}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-800 transition hover:bg-cyan-300/20 dark:text-cyan-100"
                      onClick={() => openWorkspaceSettings('capabilities')}
                    >
                      {t('capabilitySettingsOpen')}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {t('loadedSkillsTitle')}: {loadedModules.length}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {t('loadedToolsTitle')}: {loadedTools.length}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {loadedModules.slice(0, 4).map((module) => (
                      <div
                        key={module.id}
                        className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs dark:border-white/10 dark:bg-black/20"
                      >
                        <span className="font-medium text-foreground">{module.label}</span>
                        <span className="text-muted-foreground">{resolveSkillDomainLabel(module.domain, t)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Textarea
                  ref={composerTextareaRef}
                  className="min-h-[96px] resize-none border-0 bg-transparent px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder={t('composerPlaceholder')}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                />
                <Separator className="bg-border dark:bg-white/10" />

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-border bg-background/70 px-3 py-1.5 text-sm text-muted-foreground transition hover:border-cyan-300/30 hover:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:text-white"
                      onClick={() => setContextOpen((current) => !current)}
                      aria-expanded={contextOpen}
                      aria-controls={contextOpen ? 'context-section' : undefined}
                    >
                      {contextOpen ? t('collapseContext') : t('expandContext')}
                    </button>
                    <Badge className="border-border/70 bg-background/70 text-muted-foreground dark:border-white/10 dark:bg-white/5" variant="outline">
                      {t('conversationIdShort')} {conversationId ? conversationId.slice(0, 8) : t('notCreated')}
                    </Badge>
                    {allEngines.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        {allEngines.map((engine) => {
                          const probe = probeResults[engine.id]
                          const dotColor = probe
                            ? (probe.loading ? 'bg-amber-400 dark:bg-amber-300' : (probe.passed ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-red-400 dark:bg-red-500'))
                            : 'bg-gray-400 dark:bg-gray-500'
                          return (
                            <span
                              key={engine.id}
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                              title={probe ? undefined : (engine.unavailableReason || (engine.available ? t('engineStatusAvailable') : t('engineStatusUnavailable')))}
                            >
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
                              <span className={probe ? (probe.passed ? '' : 'opacity-50') : 'opacity-60'}>{engine.name}</span>
                            </span>
                          )
                        })}
                        <div className="relative ml-1">
                          <button
                            ref={probeButtonRef}
                            type="button"
                            aria-haspopup="dialog"
                            aria-expanded={probePopupOpen}
                            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-cyan-300/30 hover:text-foreground disabled:opacity-50 dark:border-white/10 dark:bg-white/5"
                            onClick={() => {
                              const hasResults = Object.keys(probeResults).length > 0
                              if (hasResults) {
                                setProbePopupOpen((v) => !v)
                              } else {
                                probeAllEngines()
                              }
                            }}
                            disabled={probeAllRunning}
                          >
                            {probeAllRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            {t('engineProbeButton')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {streamingSessions.get(conversationId)?.status === 'streaming' ? (
                      <Button
                        type="button"
                        className="rounded-full bg-rose-500 px-5 text-white hover:bg-rose-400"
                        onClick={() => stopStream()}
                      >
                        <Square className="h-4 w-4" />
                        {t('stopStreaming')}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        className="rounded-full bg-cyan-300 px-5 text-slate-950 hover:bg-cyan-200"
                        onClick={() => handleSubmit()}
                        disabled={!input.trim() || submittingRef.current}
                      >
                        <ArrowUp className="h-4 w-4" />
                        {t('sendMessage')}
                      </Button>
                    )}
                  </div>
                </div>

                {contextOpen && (
                  <div id="context-section" role="region" aria-label={t('contextPanelLabel')} className="mt-3 max-h-[50vh] overflow-y-auto rounded-[24px] border border-border/70 bg-background/70 p-4 dark:border-white/10 dark:bg-white/5">
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
                      {modelSyncMessage ? (
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
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {outputMode === 'dock' && (
        <div data-testid="console-output-dock" className="xl:min-h-0">
          <AnalysisPanel
            activeTab={activePanel}
            locale={locale}
            modelVisualizationSnapshot={latestModelVisualizationSnapshot}
            onOpenVisualization={openVisualization}
            onTabChange={setActivePanel}
            panelIdPrefix="dock-output"
            result={latestResult}
            t={t}
            visualizationSnapshot={latestResultVisualizationSnapshot}
          />
        </div>
      )}
      <StructuralVisualizationModal
        locale={locale}
        onClose={() => setVisualizationOpen(false)}
        open={visualizationOpen}
        snapshot={activeVisualizationSnapshot}
        t={t}
      />
      <DialogShell
        open={resultDialogOpen}
        title={t('resultPanelDialogTitle')}
        closeLabel={t('closeResultPanel')}
        onClose={() => setResultDialogOpen(false)}
        className="max-w-7xl"
        contentClassName="p-0"
      >
        <div className="h-full p-2 sm:p-4">
          <AnalysisPanel
            activeTab={activePanel}
            locale={locale}
            modelVisualizationSnapshot={latestModelVisualizationSnapshot}
            onOpenVisualization={openVisualization}
            onTabChange={setActivePanel}
            panelIdPrefix="dialog-output"
            result={latestResult}
            t={t}
            visualizationSnapshot={latestResultVisualizationSnapshot}
          />
        </div>
      </DialogShell>
      {probePopupOpen && Object.keys(probeResults).length > 0 && probeButtonRef.current && typeof window !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-[70]"
            onClick={() => setProbePopupOpen(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') setProbePopupOpen(false) }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('probeResultsDialogTitle')}
            className="fixed z-[71] w-80 rounded-xl border border-border/70 bg-card p-4 shadow-xl dark:border-white/10 dark:bg-slate-950"
            style={{
              bottom: window.innerHeight - probeButtonRef.current.getBoundingClientRect().top + 8,
              left: Math.max(0, Math.min(probeButtonRef.current.getBoundingClientRect().left, window.innerWidth - 336)),
            }}
            onKeyDown={(e) => { if (e.key === 'Escape') setProbePopupOpen(false) }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">{t('engineProbeButton')}</span>
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setProbePopupOpen(false)}
                aria-label={t('closeLabel')}
              >
                ✕
              </button>
            </div>
            <div className="space-y-2.5">
              {allEngines.map((engine) => {
                const probe = probeResults[engine.id]
                if (!probe) return null
                return (
                  <div key={engine.id} className="rounded-lg border border-border/50 bg-background/60 p-2.5 dark:border-white/5 dark:bg-white/5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {probe.loading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
                        ) : (
                          <span className={`inline-block h-2 w-2 rounded-full ${probe.passed ? 'bg-emerald-500' : 'bg-red-400'}`} />
                        )}
                        <span className="text-xs font-medium text-foreground">{engine.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {probe.loading ? t('engineProbeRunning')
                            : probe.passed ? t('engineProbePassed')
                            : t('engineProbeFailed')}
                        </span>
                        {!probe.loading && !probe.passed && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-cyan-700 hover:bg-cyan-50 dark:text-cyan-300 dark:hover:bg-cyan-900/30"
                            onClick={() => probeSingleEngine(engine.id)}
                            aria-label={`${t('retryLabel')} ${engine.name}`}
                          >
                            <RefreshCw className="h-2.5 w-2.5" />
                            {t('retryLabel')}
                          </button>
                        )}
                      </div>
                    </div>
                    {probe.durationMs != null && !probe.loading && (
                      <div className="mt-1 text-[11px] text-muted-foreground">{t('engineProbeDuration')}: {probe.durationMs}ms</div>
                    )}
                    {probe.error && !probe.loading && (
                      <div className="mt-1 text-[11px] leading-4 text-red-600 dark:text-red-400" role="alert">{probe.error}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
