import { describe, it, expect } from 'vitest'
import { createConsoleSlice, initialConsoleState, type ConsoleSlice } from '@/lib/stores/slices/console'
import { createStore } from 'zustand/vanilla'

describe('Console Slice (STAT-01)', () => {
  const createTestStore = () => {
    return createStore<ConsoleSlice>()((...args) => ({
      ...createConsoleSlice(...args),
    }))
  }

  it('returns initial state with correct defaults', () => {
    const store = createTestStore()
    const state = store.getState()

    expect(state.endpoint).toBe('chat-message')
    expect(state.mode).toBe('auto')
    expect(state.conversationId).toBeNull()
    expect(state.traceId).toBeNull()
  })

  it('setEndpoint action updates endpoint value', () => {
    const store = createTestStore()

    store.getState().setEndpoint('agent-run')
    expect(store.getState().endpoint).toBe('agent-run')

    store.getState().setEndpoint('chat-execute')
    expect(store.getState().endpoint).toBe('chat-execute')

    store.getState().setEndpoint('chat-message')
    expect(store.getState().endpoint).toBe('chat-message')
  })

  it('setMode action updates mode value', () => {
    const store = createTestStore()

    store.getState().setMode('chat')
    expect(store.getState().mode).toBe('chat')

    store.getState().setMode('execute')
    expect(store.getState().mode).toBe('execute')

    store.getState().setMode('auto')
    expect(store.getState().mode).toBe('auto')
  })

  it('setConversationId action updates conversationId', () => {
    const store = createTestStore()

    store.getState().setConversationId('conv-123')
    expect(store.getState().conversationId).toBe('conv-123')

    store.getState().setConversationId('conv-456')
    expect(store.getState().conversationId).toBe('conv-456')

    store.getState().setConversationId(null)
    expect(store.getState().conversationId).toBeNull()
  })

  it('resetConsole action restores initial state', () => {
    const store = createTestStore()

    // Modify all state
    store.getState().setEndpoint('agent-run')
    store.getState().setMode('execute')
    store.getState().setConversationId('conv-123')

    // Verify modified state
    expect(store.getState().endpoint).toBe('agent-run')
    expect(store.getState().mode).toBe('execute')
    expect(store.getState().conversationId).toBe('conv-123')

    // Reset
    store.getState().resetConsole()

    // Verify reset
    expect(store.getState().endpoint).toBe('chat-message')
    expect(store.getState().mode).toBe('auto')
    expect(store.getState().conversationId).toBeNull()
    expect(store.getState().traceId).toBeNull()
  })
})

describe('Console Slice Extended State (CONS-01, CONS-02, CONS-03, CONS-04)', () => {
  const createTestStore = () => {
    return createStore<ConsoleSlice>()((...args) => ({
      ...createConsoleSlice(...args),
    }))
  }

  describe('Form State Fields', () => {
    it('has message field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().message).toBe('')
    })

    it('has modelText field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().modelText).toBe('')
    })

    it('has includeModel flag in initial state', () => {
      const store = createTestStore()
      expect(store.getState().includeModel).toBe(false)
    })

    it('has analysisType field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().analysisType).toBe('static')
    })

    it('has reportFormat field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().reportFormat).toBe('markdown')
    })

    it('has reportOutput field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().reportOutput).toBe('inline')
    })

    it('has autoAnalyze flag in initial state', () => {
      const store = createTestStore()
      expect(store.getState().autoAnalyze).toBe(false)
    })

    it('has autoCodeCheck flag in initial state', () => {
      const store = createTestStore()
      expect(store.getState().autoCodeCheck).toBe(false)
    })

    it('has includeReport flag in initial state', () => {
      const store = createTestStore()
      expect(store.getState().includeReport).toBe(false)
    })
  })

  describe('Execution State Fields', () => {
    it('has loading flag in initial state', () => {
      const store = createTestStore()
      expect(store.getState().loading).toBe(false)
    })

    it('has isStreaming flag in initial state', () => {
      const store = createTestStore()
      expect(store.getState().isStreaming).toBe(false)
    })

    it('has connectionState field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().connectionState).toBe('disconnected')
    })

    it('has result field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().result).toBeNull()
    })

    it('has rawResponse field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().rawResponse).toBeNull()
    })

    it('has streamFrames field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().streamFrames).toEqual([])
    })

    it('has error field in initial state', () => {
      const store = createTestStore()
      expect(store.getState().error).toBeNull()
    })
  })

  describe('Form State Actions', () => {
    it('setMessage updates message field', () => {
      const store = createTestStore()
      store.getState().setMessage('Hello world')
      expect(store.getState().message).toBe('Hello world')
    })

    it('setModelText updates modelText field', () => {
      const store = createTestStore()
      store.getState().setModelText('{"model": "test"}')
      expect(store.getState().modelText).toBe('{"model": "test"}')
    })

    it('setIncludeModel updates includeModel field', () => {
      const store = createTestStore()
      store.getState().setIncludeModel(true)
      expect(store.getState().includeModel).toBe(true)
    })

    it('setAnalysisType updates analysisType field', () => {
      const store = createTestStore()
      store.getState().setAnalysisType('dynamic')
      expect(store.getState().analysisType).toBe('dynamic')
    })

    it('setReportFormat updates reportFormat field', () => {
      const store = createTestStore()
      store.getState().setReportFormat('both')
      expect(store.getState().reportFormat).toBe('both')
    })

    it('setReportOutput updates reportOutput field', () => {
      const store = createTestStore()
      store.getState().setReportOutput('file')
      expect(store.getState().reportOutput).toBe('file')
    })

    it('setAutoAnalyze updates autoAnalyze field', () => {
      const store = createTestStore()
      store.getState().setAutoAnalyze(true)
      expect(store.getState().autoAnalyze).toBe(true)
    })

    it('setAutoCodeCheck updates autoCodeCheck field', () => {
      const store = createTestStore()
      store.getState().setAutoCodeCheck(true)
      expect(store.getState().autoCodeCheck).toBe(true)
    })

    it('setIncludeReport updates includeReport field', () => {
      const store = createTestStore()
      store.getState().setIncludeReport(true)
      expect(store.getState().includeReport).toBe(true)
    })
  })

  describe('Execution State Actions', () => {
    it('setLoading updates loading field', () => {
      const store = createTestStore()
      store.getState().setLoading(true)
      expect(store.getState().loading).toBe(true)
    })

    it('setConnectionState updates connectionState field', () => {
      const store = createTestStore()
      store.getState().setConnectionState('connected')
      expect(store.getState().connectionState).toBe('connected')
    })

    it('setResult updates result field', () => {
      const store = createTestStore()
      const mockResult = {
        response: 'test response',
        conversationId: 'conv-123',
        traceId: 'trace-456',
      }
      store.getState().setResult(mockResult)
      expect(store.getState().result).toEqual(mockResult)
    })

    it('setRawResponse updates rawResponse field', () => {
      const store = createTestStore()
      store.getState().setRawResponse({ raw: 'data' })
      expect(store.getState().rawResponse).toEqual({ raw: 'data' })
    })

    it('setStreamFrames updates streamFrames field', () => {
      const store = createTestStore()
      const frames: StreamFrame[] = [{ type: 'token', content: 'hello' }]
      store.getState().setStreamFrames(frames)
      expect(store.getState().streamFrames).toEqual(frames)
    })

    it('setError updates error field', () => {
      const store = createTestStore()
      const error = { message: 'Something went wrong', code: 'ERR_001' }
      store.getState().setError(error)
      expect(store.getState().error).toEqual(error)
    })
  })

  describe('Reset Console', () => {
    it('resetConsole resets all form and execution state to defaults', () => {
      const store = createTestStore()

      // Set various state
      store.getState().setMessage('test message')
      store.getState().setModelText('{"test": true}')
      store.getState().setIncludeModel(true)
      store.getState().setAnalysisType('dynamic')
      store.getState().setReportFormat('both')
      store.getState().setReportOutput('file')
      store.getState().setAutoAnalyze(true)
      store.getState().setAutoCodeCheck(true)
      store.getState().setIncludeReport(true)
      store.getState().setLoading(true)
      store.getState().setConnectionState('connected')
      store.getState().setResult({ response: 'test' })
      store.getState().setRawResponse({ raw: 'data' })
      store.getState().setStreamFrames([{ type: 'token' }])
      store.getState().setError({ message: 'error' })

      // Reset
      store.getState().resetConsole()

      // Verify all reset
      expect(store.getState().message).toBe('')
      expect(store.getState().modelText).toBe('')
      expect(store.getState().includeModel).toBe(false)
      expect(store.getState().analysisType).toBe('static')
      expect(store.getState().reportFormat).toBe('markdown')
      expect(store.getState().reportOutput).toBe('inline')
      expect(store.getState().autoAnalyze).toBe(false)
      expect(store.getState().autoCodeCheck).toBe(false)
      expect(store.getState().includeReport).toBe(false)
      expect(store.getState().loading).toBe(false)
      expect(store.getState().isStreaming).toBe(false)
      expect(store.getState().connectionState).toBe('disconnected')
      expect(store.getState().result).toBeNull()
      expect(store.getState().rawResponse).toBeNull()
      expect(store.getState().streamFrames).toEqual([])
      expect(store.getState().error).toBeNull()
    })
  })
})
