'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ArrowUp, Bot, BrainCircuit, Clock3, FileText, Loader2, MessageSquarePlus, Orbit, Sparkles, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
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

type AgentResult = {
  response?: string
  traceId?: string
  success?: boolean
  needsModelInput?: boolean
  plan?: string[]
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
}

type StreamPayload =
  | { type: 'start'; content?: { traceId?: string; conversationId?: string; startedAt?: string } }
  | { type: 'token'; content?: string }
  | { type: 'interaction_update'; content?: { questions?: Array<{ question?: string; label?: string }>; pending?: { criticalMissing?: string[]; nonCriticalMissing?: string[] } } }
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
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const STORAGE_KEY = 'structureclaw.console.conversations'

const quickPrompts = [
  '帮我梳理一个单跨钢梁静力分析需要哪些已知条件',
  '如果我要做两层钢框架分析，你会先向我确认哪些参数？',
  '我准备上传结构模型，请先告诉我分析报告应该包含哪些核心结论',
]

const analysisTypeOptions: Array<{ value: AnalysisType; label: string }> = [
  { value: 'static', label: '静力' },
  { value: 'dynamic', label: '动力' },
  { value: 'seismic', label: '抗震' },
  { value: 'nonlinear', label: '非线性' },
]

const initialAssistantMessage: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    '我会先用对话帮你澄清建模意图、荷载和边界条件。准备好结构模型后，再点击“执行分析”，右侧会生成分析结果和报告。',
  status: 'done',
  timestamp: new Date().toISOString(),
}

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

function parseModelJson(modelText: string): { model?: Record<string, unknown>; error?: string } {
  const trimmed = modelText.trim()
  if (!trimmed) {
    return {}
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: '模型 JSON 必须是对象。' }
    }
    return { model: parsed as Record<string, unknown> }
  } catch (error) {
    return {
      error: error instanceof Error ? `模型 JSON 解析失败：${error.message}` : '模型 JSON 解析失败。',
    }
  }
}

function buildInteractionMessage(payload: Extract<StreamPayload, { type: 'interaction_update' }>) {
  const questions = payload.content?.questions || []
  const criticalMissing = payload.content?.pending?.criticalMissing || []

  if (questions.length > 0) {
    return questions
      .map((item) => item.question || item.label)
      .filter(Boolean)
      .join('\n')
  }

  if (criticalMissing.length > 0) {
    return `还需要你补充这些关键信息：${criticalMissing.join('、')}`
  }

  return '我还需要补充一些参数后才能继续执行。'
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

function extractSummaryStats(analysis: Record<string, unknown> | null) {
  if (!analysis) return []
  const data = typeof analysis.data === 'object' && analysis.data ? (analysis.data as Record<string, unknown>) : analysis
  const meta = typeof analysis.meta === 'object' && analysis.meta ? (analysis.meta as Record<string, unknown>) : null
  const summary = typeof data.summary === 'object' && data.summary ? (data.summary as Record<string, unknown>) : null

  const stats: Array<{ label: string; value: string }> = []

  const candidatePairs: Array<[string, unknown]> = [
    ['节点数', summary?.nodeCount ?? meta?.nodeCount],
    ['单元数', summary?.elementCount ?? meta?.elementCount],
    ['工况数', summary?.loadCaseCount ?? meta?.loadCaseCount],
    ['组合数', summary?.combinationCount ?? meta?.combinationCount],
  ]

  candidatePairs.forEach(([label, value]) => {
    if (typeof value === 'number') {
      stats.push({ label, value: formatNumber(value) })
    }
  })

  return stats
}

function AnalysisPanel({
  result,
  activeTab,
  onTabChange,
}: {
  result: AgentResult | null
  activeTab: PanelTab
  onTabChange: (tab: PanelTab) => void
}) {
  const analysis = extractAnalysis(result)
  const stats = extractSummaryStats(analysis)
  const reportMarkdown = result?.report?.markdown?.trim()
  const reportSummary = result?.report?.summary?.trim()

  return (
    <div className="flex h-full flex-col rounded-[28px] border border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">Workspace Output</p>
          <h2 className="mt-1 text-lg font-semibold text-white">分析结果与报告</h2>
        </div>
        <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
          <button
            className={cn(
              'rounded-full px-4 py-2 text-sm transition',
              activeTab === 'analysis' ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'
            )}
            onClick={() => onTabChange('analysis')}
            type="button"
          >
            分析结果
          </button>
          <button
            className={cn(
              'rounded-full px-4 py-2 text-sm transition',
              activeTab === 'report' ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'
            )}
            onClick={() => onTabChange('report')}
            type="button"
          >
            报告
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {!result && (
          <Card className="border-white/10 bg-slate-950/40 text-slate-100 shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-xl">
                <Orbit className="h-5 w-5 text-cyan-300" />
                结果面板待命中
              </CardTitle>
              <CardDescription className="text-slate-400">
                对话阶段不会生成工程输出。准备好模型后点击“执行分析”，结果和报告会出现在这里。
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {result && activeTab === 'analysis' && (
          <div className="space-y-4">
            <Card className="border-white/10 bg-slate-950/50 text-slate-100 shadow-none">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-emerald-400/30 bg-emerald-400/15 text-emerald-200" variant="outline">
                    {result.success ? '分析完成' : result.needsModelInput ? '待补充信息' : '返回结果'}
                  </Badge>
                  {result.traceId && (
                    <Badge className="border-white/10 bg-white/5 text-slate-300" variant="outline">
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
                  <CardTitle className="text-xl text-white">执行概览</CardTitle>
                  <CardDescription className="text-slate-400">
                    {result.response || '当前返回未包含自然语言总结。'}
                  </CardDescription>
                </div>
              </CardHeader>
              {(stats.length > 0 || result.plan?.length) && (
                <CardContent className="space-y-4">
                  {stats.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {stats.map((item) => (
                        <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{item.label}</div>
                          <div className="mt-2 text-2xl font-semibold text-white">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.plan?.length ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 text-sm font-medium text-white">执行路径</div>
                      <ol className="space-y-2 text-sm text-slate-300">
                        {result.plan.map((step, index) => (
                          <li key={`${index}-${step}`} className="flex gap-3">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-[11px] text-cyan-200">
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
              <Card className="border-amber-300/20 bg-amber-300/10 text-amber-50 shadow-none">
                <CardHeader>
                  <CardTitle className="text-lg">需要补充的信息</CardTitle>
                  <CardDescription className="text-amber-100/80">
                    {result.clarification.question}
                  </CardDescription>
                </CardHeader>
                {result.clarification.missingFields?.length ? (
                  <CardContent className="flex flex-wrap gap-2">
                    {result.clarification.missingFields.map((field) => (
                      <Badge key={field} className="border-amber-200/20 bg-black/10 text-amber-50" variant="outline">
                        {field}
                      </Badge>
                    ))}
                  </CardContent>
                ) : null}
              </Card>
            )}

            {analysis && (
              <Card className="border-white/10 bg-slate-950/50 text-slate-100 shadow-none">
                <CardHeader>
                  <CardTitle className="text-lg">结构化结果</CardTitle>
                  <CardDescription className="text-slate-400">
                    当前后端返回的原始分析对象，便于工程人员查看关键字段。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-cyan-100">
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
              <Card className="border-white/10 bg-slate-950/50 text-slate-100 shadow-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FileText className="h-5 w-5 text-cyan-300" />
                    报告摘要
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-7 text-slate-300">
                  {reportSummary}
                </CardContent>
              </Card>
            )}

            <Card className="border-white/10 bg-slate-950/50 text-slate-100 shadow-none">
              <CardHeader>
                <CardTitle className="text-lg">Markdown 报告</CardTitle>
                <CardDescription className="text-slate-400">
                  这里展示后端返回的报告正文。如果当前运行只做了澄清，对应内容会为空。
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportMarkdown ? (
                  <article className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-p:text-slate-300 prose-strong:text-white prose-code:text-cyan-200">
                    <ReactMarkdown>{reportMarkdown}</ReactMarkdown>
                  </article>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">
                    当前还没有报告正文。请先执行一次分析，或在消息中明确要求生成报告。
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
  const [messages, setMessages] = useState<Message[]>([initialAssistantMessage])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [serverConversations, setServerConversations] = useState<ConversationSummary[]>([])
  const [conversationArchive, setConversationArchive] = useState<Record<string, PersistedConversation>>({})
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [contextOpen, setContextOpen] = useState(false)
  const [modelText, setModelText] = useState('')
  const [designCode, setDesignCode] = useState('GB50017')
  const [analysisType, setAnalysisType] = useState<AnalysisType>('static')
  const [latestResult, setLatestResult] = useState<AgentResult | null>(null)
  const [activePanel, setActivePanel] = useState<PanelTab>('analysis')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
    let cancelled = false

    async function fetchConversations() {
      setHistoryLoading(true)
      setHistoryError('')

      try {
        const response = await fetch(`${API_BASE}/api/v1/chat/conversations`)
        if (!response.ok) {
          throw new Error(`加载会话失败: HTTP ${response.status}`)
        }
        const payload = await response.json()
        if (!cancelled) {
          setServerConversations(Array.isArray(payload) ? (payload as ConversationSummary[]) : [])
        }
      } catch (error) {
        if (!cancelled) {
          setHistoryError(error instanceof Error ? error.message : '加载会话失败。')
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
  }, [])

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
          || '新对话',
        type: 'analysis',
        createdAt: current[conversationId]?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages,
        latestResult,
      },
    }))
  }, [conversationId, latestResult, messages, serverConversations])

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
      }),
    })

    if (!response.ok) {
      throw new Error(`创建会话失败: HTTP ${response.status}`)
    }

    const payload = await response.json()
    if (!payload?.id) {
      throw new Error('创建会话失败：未返回会话 ID。')
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
    const archived = conversationArchive[nextConversationId]

    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/conversation/${nextConversationId}`)
      if (!response.ok) {
        throw new Error(`加载会话失败: HTTP ${response.status}`)
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
      setActivePanel(archived?.latestResult?.report?.markdown ? 'report' : 'analysis')
    } catch (error) {
      if (archived) {
        setConversationId(nextConversationId)
        setMessages(archived.messages.length ? archived.messages : [initialAssistantMessage])
        setLatestResult(archived.latestResult || null)
        setActivePanel(archived.latestResult?.report?.markdown ? 'report' : 'analysis')
        return
      }

      setErrorMessage(error instanceof Error ? error.message : '加载会话失败。')
    }
  }

  function handleNewConversation() {
    if (isSending) {
      return
    }

    setConversationId('')
    setMessages([initialAssistantMessage])
    setLatestResult(null)
    setErrorMessage('')
    setActivePanel('analysis')
  }

  async function handleSubmit(action: ComposerAction) {
    const trimmedInput = input.trim()
    if (!trimmedInput || isSending) {
      return
    }

    const parsedModel = parseModelJson(modelText)
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
      action === 'chat' ? '我在整理你的需求，请稍等。' : '我在根据当前对话整理输入，并尝试执行分析。'

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
    let receivedResult = false
    let assistantContent = assistantSeed

    try {
      const nextConversationId = await ensureConversation(trimmedInput)
      const contextPayload =
        action === 'execute'
          ? {
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
          : undefined

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
          throw new Error(`请求失败: HTTP ${response.status}`)
        }

        const payload = await response.json()
        if (!payload || typeof payload !== 'object') {
          throw new Error('请求失败：返回数据无效。')
        }

        const result = payload as AgentResult
        receivedResult = true
        assistantContent = result.response || result.clarification?.question || '已完成当前请求。'
        setLatestResult(result)
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
        throw new Error(`请求失败: HTTP ${response.status}`)
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
            const interactionMessage = buildInteractionMessage(payload)
            assistantContent = interactionMessage
            replaceMessage(assistantMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'streaming',
            }))
          }

          if (payload.type === 'result' && payload.content && typeof payload.content === 'object') {
            const result = payload.content as AgentResult
            receivedResult = true
            setLatestResult(result)
            setActivePanel(result.report?.markdown ? 'report' : 'analysis')
            assistantContent = result.response || result.clarification?.question || '已完成当前请求。'
            replaceMessage(assistantMessageId, (message) => ({
              ...message,
              content: assistantContent,
              status: 'done',
            }))
          }

          if (payload.type === 'error') {
            const nextError = typeof payload.error === 'string' ? payload.error : '请求失败。'
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
      const nextError = error instanceof Error ? error.message : '请求失败。'

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
    <div className="grid min-h-[calc(100vh-5.5rem)] gap-4 xl:grid-cols-[280px_minmax(0,1.3fr)_420px]">
      <aside className="flex h-full flex-col rounded-[28px] border border-white/10 bg-white/5 backdrop-blur-xl">
        <div className="border-b border-white/10 px-5 py-4">
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">Conversation Memory</p>
          <h2 className="mt-1 text-lg font-semibold text-white">历史会话</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            聊天记录从后端读取，执行分析结果会优先从当前浏览器本地缓存恢复。
          </p>
          <Button
            type="button"
            className="mt-4 w-full rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            onClick={handleNewConversation}
            disabled={isSending}
          >
            <MessageSquarePlus className="h-4 w-4" />
            新建对话
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {historyLoading && (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
              正在加载会话列表…
            </div>
          )}

          {!historyLoading && historyError && (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {historyError}
            </div>
          )}

          {!historyLoading && mergedConversations.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
              还没有历史会话。发送第一条消息后，这里会出现可切换的会话列表。
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
                      ? 'border-cyan-300/40 bg-cyan-300/12 text-white'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10'
                  )}
                >
                  <div className="line-clamp-2 text-sm font-medium leading-6">
                    {conversation.title || '未命名会话'}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <Clock3 className="h-3.5 w-3.5" />
                    <span>{formatDate(conversation.updatedAt || conversation.createdAt || new Date().toISOString())}</span>
                  </div>
                  {preview?.content && (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">
                      {preview.content}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </aside>

      <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/70 shadow-[0_40px_120px_-50px_rgba(34,211,238,0.45)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.18),transparent_30%)]" />
        <div className="relative flex h-full flex-col">
          <div className="border-b border-white/10 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">AI Console</p>
                <h1 className="mt-1 text-2xl font-semibold text-white">结构工程对话工作台</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100" variant="outline">
                  默认先理解需求
                </Badge>
                <Badge className="border-white/10 bg-white/5 text-slate-300" variant="outline">
                  会话式分析助手
                </Badge>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
              先像和工程顾问对话一样描述目标、荷载和边界条件。准备好模型后，再切换到执行分析，右侧会持续展示最新分析结果与报告。
            </p>
          </div>

          <div className="flex-1 overflow-auto px-5 py-5">
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {messages.length === 1 && (
                <div className="grid gap-3 md:grid-cols-3">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="rounded-3xl border border-white/10 bg-white/5 p-4 text-left text-sm text-slate-300 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-white"
                    >
                      <Sparkles className="mb-3 h-4 w-4 text-cyan-300" />
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
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                      <Bot className="h-5 w-5" />
                    </div>
                  )}

                  <div
                    className={cn(
                      'max-w-[82%] rounded-[26px] border px-5 py-4 shadow-lg',
                      message.role === 'user'
                        ? 'border-cyan-400/30 bg-cyan-400/15 text-white'
                        : 'border-white/10 bg-white/5 text-slate-100'
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                      {message.role === 'user' ? <User className="h-3.5 w-3.5" /> : <BrainCircuit className="h-3.5 w-3.5" />}
                      <span>{message.role === 'user' ? '你' : 'StructureClaw AI'}</span>
                      <span className="text-slate-500">{formatDate(message.timestamp)}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-7">
                      {message.content}
                      {message.status === 'streaming' && (
                        <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
                      )}
                    </div>
                  </div>

                  {message.role === 'user' && (
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-slate-200">
                      <User className="h-5 w-5" />
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="border-t border-white/10 p-5">
            <div className="mx-auto max-w-4xl space-y-4">
              {errorMessage && (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {errorMessage}
                </div>
              )}

              <div className="rounded-[28px] border border-white/10 bg-black/20 p-3">
                <Textarea
                  className="min-h-[120px] resize-none border-0 bg-transparent px-3 py-3 text-base text-slate-100 placeholder:text-slate-500 focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="描述你的结构目标、分析意图、荷载条件或希望 AI 先帮你澄清的问题。"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                />
                <Separator className="bg-white/10" />

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 transition hover:border-cyan-300/30 hover:text-white"
                    onClick={() => setContextOpen((current) => !current)}
                  >
                    {contextOpen ? '收起工程上下文' : '展开工程上下文'}
                  </button>
                  <Badge className="border-white/10 bg-white/5 text-slate-400" variant="outline">
                    会话 ID {conversationId ? conversationId.slice(0, 8) : '未创建'}
                  </Badge>
                </div>

                {contextOpen && (
                  <div className="mt-4 grid gap-4 rounded-[24px] border border-white/10 bg-white/5 p-4 lg:grid-cols-[1fr_300px]">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-200">结构模型 JSON</label>
                      <Textarea
                        className="min-h-[220px] resize-y border-white/10 bg-slate-950/70 text-sm text-slate-200 placeholder:text-slate-500"
                        placeholder="将 StructureModel v1 JSON 粘贴到这里。留空时，AI 会先通过对话继续澄清建模条件。"
                        value={modelText}
                        onChange={(event) => setModelText(event.target.value)}
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-200">分析类型</label>
                        <div className="grid grid-cols-2 gap-2">
                          {analysisTypeOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setAnalysisType(option.value)}
                              className={cn(
                                'rounded-2xl border px-3 py-2 text-sm transition',
                                analysisType === option.value
                                  ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100'
                                  : 'border-white/10 bg-slate-950/40 text-slate-300 hover:text-white'
                              )}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-200">设计规范</label>
                        <Input
                          className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500"
                          value={designCode}
                          onChange={(event) => setDesignCode(event.target.value)}
                          placeholder="例如 GB50017"
                        />
                        <p className="text-xs leading-5 text-slate-500">
                          保留该字段时，执行分析会顺带请求生成更完整的工程报告。
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-500">
                    默认先聊天澄清需求。执行分析前建议补充模型 JSON，或先通过对话明确缺失条件。
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                      onClick={() => handleSubmit('chat')}
                      disabled={isSending || !input.trim()}
                    >
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                      先聊需求
                    </Button>
                    <Button
                      type="button"
                      className="rounded-full bg-cyan-300 px-5 text-slate-950 hover:bg-cyan-200"
                      onClick={() => handleSubmit('execute')}
                      disabled={isSending || !input.trim()}
                    >
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                      执行分析
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <AnalysisPanel result={latestResult} activeTab={activePanel} onTabChange={setActivePanel} />
    </div>
  )
}
