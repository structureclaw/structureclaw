'use client'

import { useCallback } from 'react'
import { useStore } from '@/lib/stores/context'
import type {
  AgentResult,
  AgentError,
  StreamFrame,
  ChatMessageRequest,
  ChatExecuteRequest,
  AgentRunRequest,
} from '@/lib/api/contracts/agent'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

/**
 * Endpoint path mapping
 */
const ENDPOINT_PATHS = {
  'chat-message': '/api/v1/chat/message',
  'chat-execute': '/api/v1/chat/execute',
  'agent-run': '/api/v1/agent/run',
} as const

const normalizeOptionalString = (value: string | null | undefined): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const pruneEmptyValues = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map((item) => pruneEmptyValues(item))
      .filter((item) => item !== undefined) as T
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, pruneEmptyValues(item)] as const)
      .filter(([, item]) => item !== undefined)

    if (entries.length === 0) {
      return undefined as T
    }

    return Object.fromEntries(entries) as T
  }

  if (value === null || value === undefined) {
    return undefined as T
  }

  if (typeof value === 'string' && value.trim() === '') {
    return undefined as T
  }

  return value
}

const parseModel = (value: string): Record<string, unknown> | undefined => {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = JSON.parse(trimmed)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
}

const normalizeResult = (data: unknown): AgentResult => {
  const payload = data && typeof data === 'object' && 'result' in data
    ? (data as { result?: unknown }).result
    : data

  if (!payload || typeof payload !== 'object') {
    return {}
  }

  return payload as AgentResult
}

/**
 * useConsoleExecution - Hook for console execution operations
 *
 * CONS-07: Execute button triggers sync + SSE streaming
 * CONS-12: SSE streaming execution support
 *
 * Handles both synchronous requests and SSE streaming.
 */
export function useConsoleExecution() {
  // Get store state and actions
  const endpoint = useStore((state) => state.endpoint)
  const mode = useStore((state) => state.mode)
  const message = useStore((state) => state.message)
  const modelText = useStore((state) => state.modelText)
  const includeModel = useStore((state) => state.includeModel)
  const analysisType = useStore((state) => state.analysisType)
  const reportFormat = useStore((state) => state.reportFormat)
  const reportOutput = useStore((state) => state.reportOutput)
  const autoAnalyze = useStore((state) => state.autoAnalyze)
  const autoCodeCheck = useStore((state) => state.autoCodeCheck)
  const includeReport = useStore((state) => state.includeReport)
  const conversationId = useStore((state) => state.conversationId)
  const traceId = useStore((state) => state.traceId)

  const setLoading = useStore((state) => state.setLoading)
  const setConnectionState = useStore((state) => state.setConnectionState)
  const setResult = useStore((state) => state.setResult)
  const setRawResponse = useStore((state) => state.setRawResponse)
  const setStreamFrames = useStore((state) => state.setStreamFrames)
  const setError = useStore((state) => state.setError)

  /**
   * Validate model JSON if includeModel is true
   */
  const validateModelJson = useCallback((): { valid: boolean; error?: string } => {
    if (!message.trim()) {
      return { valid: false, error: 'Message is required' }
    }

    if (!includeModel) {
      return { valid: true }
    }

    if (!modelText.trim()) {
      return { valid: false, error: 'Model JSON is required when includeModel is enabled' }
    }

    try {
      JSON.parse(modelText)
      return { valid: true }
    } catch {
      return { valid: false, error: 'Invalid JSON in model text' }
    }
  }, [message, includeModel, modelText])

  /**
   * Build request payload based on endpoint type
   */
  const buildPayload = useCallback(() => {
    const parsedModel = includeModel ? parseModel(modelText) : undefined
    const context = pruneEmptyValues({
      model: parsedModel,
      modelFormat: parsedModel ? 'structuremodel-v1' : undefined,
      analysisType,
      autoAnalyze,
      autoCodeCheck,
      includeReport,
      reportFormat,
      reportOutput,
    })

    const basePayload = {
      message: message.trim(),
      conversationId: normalizeOptionalString(conversationId),
      traceId: normalizeOptionalString(traceId),
      context,
    }

    switch (endpoint) {
      case 'chat-message':
        return basePayload as ChatMessageRequest

      case 'chat-execute':
        return pruneEmptyValues(basePayload) as ChatExecuteRequest

      case 'agent-run':
        return pruneEmptyValues({
          ...basePayload,
          mode,
        }) as AgentRunRequest

      default:
        return basePayload
    }
  }, [
    endpoint,
    mode,
    message,
    modelText,
    includeModel,
    analysisType,
    reportFormat,
    reportOutput,
    autoAnalyze,
    autoCodeCheck,
    includeReport,
    conversationId,
    traceId,
  ])

  /**
   * Execute synchronous request
   */
  const executeSync = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    // Validate model JSON if needed
    const validation = validateModelJson()
    if (!validation.valid) {
      setError({ message: validation.error! })
      return { success: false, error: validation.error }
    }

    // Clear previous state
    setLoading(true)
    setConnectionState('connecting')
    setError(null)
    setResult(null)
    setRawResponse(null)
    setStreamFrames([])

    const payload = buildPayload()
    const path = ENDPOINT_PATHS[endpoint]

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        let errorData: AgentError
        try {
          errorData = await response.json()
        } catch {
          errorData = { message: `${response.status} ${response.statusText}` }
        }

        setError(errorData)
        setConnectionState('error')
        setLoading(false)
        return { success: false, error: errorData.message }
      }

      const data = await response.json()
      setRawResponse(data)
      const result = normalizeResult(data)

      setResult(result)
      setConnectionState('connected')
      setLoading(false)
      return { success: true }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError({ message: errorMessage })
      setConnectionState('error')
      setLoading(false)
      return { success: false, error: errorMessage }
    }
  }, [
    endpoint,
    validateModelJson,
    buildPayload,
    setLoading,
    setConnectionState,
    setError,
    setResult,
    setRawResponse,
    setStreamFrames,
  ])

  /**
   * Execute SSE streaming request
   */
  const executeStream = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    // Validate model JSON if needed
    const validation = validateModelJson()
    if (!validation.valid) {
      setError({ message: validation.error! })
      return { success: false, error: validation.error }
    }

    // Clear previous state
    setLoading(true)
    setConnectionState('connecting')
    setError(null)
    setResult(null)
    setRawResponse(null)
    setStreamFrames([])

    const payload = buildPayload()
    const path = '/api/v1/chat/stream'

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        let errorData: AgentError
        try {
          errorData = await response.json()
        } catch {
          errorData = { message: `${response.status} ${response.statusText}` }
        }

        setError(errorData)
        setConnectionState('error')
        setLoading(false)
        return { success: false, error: errorData.message }
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setError({ message: 'Response body is not readable' })
        setConnectionState('error')
        setLoading(false)
        return { success: false, error: 'Response body is not readable' }
      }

      setConnectionState('connected')
      const frames: StreamFrame[] = []
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })

        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''

        for (const chunk of chunks) {
          const line = chunk
            .split('\n')
            .map((item) => item.trim())
            .find((item) => item.startsWith('data:'))

          if (!line) {
            continue
          }

          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') {
            continue
          }

          try {
            const frame = JSON.parse(data) as StreamFrame
            frames.push(frame)

            if (frame.type === 'result' && frame.content && typeof frame.content === 'object') {
              setResult(frame.content as AgentResult)
              setRawResponse(frame.content as Record<string, unknown>)
            }

            if (frame.type === 'error') {
              setError({ message: frame.error || 'Unknown error occurred' })
            }
          } catch {
            // Skip unparseable frames
          }
        }
      }

      setStreamFrames(frames)
      setConnectionState('connected')
      setLoading(false)
      return { success: true }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError({ message: errorMessage })
      setConnectionState('error')
      setLoading(false)
      return { success: false, error: errorMessage }
    }
  }, [
    validateModelJson,
    buildPayload,
    setLoading,
    setConnectionState,
    setError,
    setResult,
    setRawResponse,
    setStreamFrames,
  ])

  return {
    executeSync,
    executeStream,
  }
}
