import { describe, it, expectTypeOf } from 'vitest'
import type {
  ChatMessageRequest,
  ChatExecuteRequest,
  AgentRunRequest,
  ContextPayload,
  AnalysisType,
  ReportFormat,
  ReportOutput,
  ConnectionState,
  AgentResult,
  AgentError,
} from '@/lib/api/contracts/agent'

describe('API Contracts - Agent Types', () => {
  describe('ChatMessageRequest', () => {
    it('has required message field', () => {
      expectTypeOf<ChatMessageRequest>().toHaveProperty('message')
    })

    it('has optional conversationId field', () => {
      expectTypeOf<ChatMessageRequest>().toMatchTypeOf<{ conversationId?: string | null }>()
    })

    it('has optional traceId field', () => {
      expectTypeOf<ChatMessageRequest>().toMatchTypeOf<{ traceId?: string | null }>()
    })

    it('has optional context field', () => {
      expectTypeOf<ChatMessageRequest>().toMatchTypeOf<{ context?: ContextPayload }>()
    })
  })

  describe('ChatExecuteRequest', () => {
    it('has required message field', () => {
      expectTypeOf<ChatExecuteRequest>().toHaveProperty('message')
    })

    it('has optional conversationId field', () => {
      expectTypeOf<ChatExecuteRequest>().toMatchTypeOf<{ conversationId?: string | null }>()
    })

    it('has optional traceId field', () => {
      expectTypeOf<ChatExecuteRequest>().toMatchTypeOf<{ traceId?: string | null }>()
    })

    it('has optional context field', () => {
      expectTypeOf<ChatExecuteRequest>().toMatchTypeOf<{ context?: ContextPayload }>()
    })

    it('has mode field', () => {
      expectTypeOf<ChatExecuteRequest>().toHaveProperty('mode')
    })
  })

  describe('AgentRunRequest', () => {
    it('has required message field', () => {
      expectTypeOf<AgentRunRequest>().toHaveProperty('message')
    })

    it('has optional conversationId field', () => {
      expectTypeOf<AgentRunRequest>().toMatchTypeOf<{ conversationId?: string | null }>()
    })

    it('has optional traceId field', () => {
      expectTypeOf<AgentRunRequest>().toMatchTypeOf<{ traceId?: string | null }>()
    })

    it('has optional context field', () => {
      expectTypeOf<AgentRunRequest>().toMatchTypeOf<{ context?: ContextPayload }>()
    })

    it('has mode field', () => {
      expectTypeOf<AgentRunRequest>().toHaveProperty('mode')
    })

  })

  describe('ContextPayload', () => {
    it('has optional model field', () => {
      expectTypeOf<ContextPayload>().toMatchTypeOf<{ model?: Record<string, unknown> }>()
    })

    it('has optional analysis options in context', () => {
      expectTypeOf<ContextPayload>().toMatchTypeOf<{
        analysisType?: AnalysisType
        reportFormat?: ReportFormat
        reportOutput?: ReportOutput
        autoAnalyze?: boolean
        autoCodeCheck?: boolean
        includeReport?: boolean
      }>()
    })
  })

  describe('Enum-like Types', () => {
    it('AnalysisType is string', () => {
      expectTypeOf<AnalysisType>().toEqualTypeOf<string>()
    })

    it('ReportFormat is string', () => {
      expectTypeOf<ReportFormat>().toEqualTypeOf<string>()
    })

    it('ReportOutput is string', () => {
      expectTypeOf<ReportOutput>().toEqualTypeOf<string>()
    })

    it('ConnectionState is string', () => {
      expectTypeOf<ConnectionState>().toEqualTypeOf<string>()
    })
  })

  describe('AgentResult', () => {
    it('has response field', () => {
      expectTypeOf<AgentResult>().toHaveProperty('response')
    })

    it('has optional conversationId field', () => {
      expectTypeOf<AgentResult>().toMatchTypeOf<{ conversationId?: string }>()
    })

    it('has optional traceId field', () => {
      expectTypeOf<AgentResult>().toMatchTypeOf<{ traceId?: string }>()
    })
  })

  describe('AgentError', () => {
    it('has message field', () => {
      expectTypeOf<AgentError>().toHaveProperty('message')
    })

    it('has optional code field', () => {
      expectTypeOf<AgentError>().toMatchTypeOf<{ code?: string }>()
    })
  })
})
