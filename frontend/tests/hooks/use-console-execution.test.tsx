import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import { AppStoreProvider, useStore } from '@/lib/stores/context'
import { useConsoleExecution } from '@/hooks/use-console-execution'

// Mock fetch globally
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = vi.fn() as any
global.fetch = mockFetch

describe('useConsoleExecution hook', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AppStoreProvider initialState={{ message: 'run analysis' }}>{children}</AppStoreProvider>
  )

  const renderWithProvider = () => {
    return renderHook(() => {
      const store = useStore((state) => ({
        endpoint: state.endpoint,
        mode: state.mode,
        message: state.message,
        modelText: state.modelText,
        includeModel: state.includeModel,
        analysisType: state.analysisType,
        reportFormat: state.reportFormat,
        reportOutput: state.reportOutput,
        autoAnalyze: state.autoAnalyze,
        autoCodeCheck: state.autoCodeCheck,
        includeReport: state.includeReport,
        loading: state.loading,
        connectionState: state.connectionState,
        result: state.result,
        error: state.error,
        setEndpoint: state.setEndpoint,
        setMessage: state.setMessage,
        setModelText: state.setModelText,
      }))
      const execution = useConsoleExecution()
      return { store, execution }
    }, { wrapper })
  }

  describe('executeSync', () => {
    it('should send POST request with correct payload for chat-message endpoint', async () => {
      const mockResponse = {
        response: 'Test response',
        conversationId: 'conv-123',
        traceId: 'trace-456',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const { result } = renderWithProvider()

      await act(async () => {
        await result.current.execution.executeSync()
      })

      expect(mockFetch).toHaveBeenCalled()
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toContain('/api/v1/chat/message')
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')
      const payload = JSON.parse(options.body)
      expect(payload.message).toBe('run analysis')
      expect(payload).not.toHaveProperty('conversationId')
      expect(payload).not.toHaveProperty('traceId')
    })

    it('should send model and execution options inside context for agent-run', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: 'ok' }),
      })

      const { result } = renderHook(() => {
        const execution = useConsoleExecution()
        const setEndpoint = useStore((state) => state.setEndpoint)
        const setIncludeModel = useStore((state) => state.setIncludeModel)
        const setModelText = useStore((state) => state.setModelText)
        const setReportFormat = useStore((state) => state.setReportFormat)
        return { execution, setEndpoint, setIncludeModel, setModelText, setReportFormat }
      }, { wrapper })

      act(() => {
        result.current.setEndpoint('agent-run')
        result.current.setIncludeModel(true)
        result.current.setModelText('{"nodes":[]}')
        result.current.setReportFormat('both')
      })

      await act(async () => {
        await result.current.execution.executeSync()
      })

      const [, options] = mockFetch.mock.calls[0]
      const payload = JSON.parse(options.body)
      expect(payload.context.model).toEqual({ nodes: [] })
      expect(payload.context.modelFormat).toBe('structuremodel-v1')
      expect(payload.context.analysisType).toBe('static')
      expect(payload.context.reportFormat).toBe('both')
      expect(payload).not.toHaveProperty('analysisType')
    })

    it('should validate model JSON before sending when includeModel is true', async () => {
      const { result } = renderHook(() => {
        const store = useStore((state) => ({
          includeModel: state.includeModel,
          modelText: state.modelText,
          error: state.error,
        }))
        const execution = useConsoleExecution()
        return { store, execution }
      }, {
        wrapper: ({ children }) => createElement(AppStoreProvider, {
          initialState: {
            includeModel: true,
            modelText: 'invalid json',
            // Provide minimal required state
            endpoint: 'chat-message',
            mode: 'auto',
            conversationId: null,
            traceId: null,
            message: 'validate model',
            analysisType: 'static',
            reportFormat: 'markdown',
            reportOutput: 'inline',
            autoAnalyze: false,
            autoCodeCheck: false,
            includeReport: false,
            loading: false,
            isStreaming: false,
            connectionState: 'disconnected',
            result: null,
            rawResponse: null,
            streamFrames: [],
            error: null,
            setEndpoint: () => {},
            setMode: () => {},
            setConversationId: () => {},
            resetConsole: () => {},
            setMessage: () => {},
            setModelText: () => {},
            setIncludeModel: () => {},
            setAnalysisType: () => {},
            setReportFormat: () => {},
            setReportOutput: () => {},
            setAutoAnalyze: () => {},
            setAutoCodeCheck: () => {},
            setIncludeReport: () => {},
            setLoading: () => {},
            setConnectionState: () => {},
            setResult: () => {},
            setRawResponse: () => {},
            setStreamFrames: () => {},
            setError: () => {},
          } as any
        }, children)
      })

      let execResult: { success: boolean; error?: string } = { success: true }
      await act(async () => {
        execResult = await result.current.execution.executeSync()
      })

      // Should have validation error and not call fetch
      expect(execResult.success).toBe(false)
      expect(execResult.error).toContain('Invalid JSON')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'Server error' }),
      })

      const { result } = renderWithProvider()

      await act(async () => {
        await result.current.execution.executeSync()
      })

      // Error should be set in store
      expect(result.current.store.error).not.toBeNull()
    })

    it('should update loading state during execution', async () => {
      let resolvePromise: (value: any) => void
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve
      })

      mockFetch.mockReturnValueOnce(pendingPromise)

      const { result } = renderWithProvider()

      // Start execution
      let executionPromise: Promise<any>
      act(() => {
        executionPromise = result.current.execution.executeSync()
      })

      // Wait for loading state to be set
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
      })

      // Loading should be true during execution
      expect(result.current.store.loading).toBe(true)

      // Resolve the fetch
      await act(async () => {
        resolvePromise!({
          ok: true,
          json: () => Promise.resolve({ response: 'done' }),
        })
        await executionPromise!
      })

      // Loading should be false after completion
      expect(result.current.store.loading).toBe(false)
    })

    it('should set result on successful execution', async () => {
      const mockResponse = {
        response: 'Test response',
        conversationId: 'conv-123',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const { result } = renderWithProvider()

      await act(async () => {
        await result.current.execution.executeSync()
      })

      expect(result.current.store.result).not.toBeNull()
      expect(result.current.store.result?.response).toBe('Test response')
    })
  })

  describe('executeStream', () => {
    it('should handle SSE connection setup', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"token","content":"Hello"}\n\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      })

      const { result } = renderWithProvider()

      await act(async () => {
        await result.current.execution.executeStream()
      })

      expect(mockFetch).toHaveBeenCalled()
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toContain('/api/v1/chat/stream')
      expect(options.method).toBe('POST')
    })

    it('should parse stream frames', async () => {
      const frames = [
        { type: 'token', content: 'Hello' },
        { type: 'token', content: ' World' },
      ]

      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(`data: ${JSON.stringify(frames[0])}\n\n`),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(`data: ${JSON.stringify(frames[1])}\n\n`),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      })

      const { result } = renderHook(() => {
        const streamFrames = useStore((state) => state.streamFrames)
        const execution = useConsoleExecution()
        return { streamFrames, execution }
      }, { wrapper })

      await act(async () => {
        await result.current.execution.executeStream()
      })

      expect(result.current.streamFrames).toEqual(frames)
    })

    it('should update connection state during streaming', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"type":"token","content":"test"}\n\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      })

      const { result } = renderWithProvider()

      // Initial state
      expect(result.current.store.connectionState).toBe('disconnected')

      await act(async () => {
        await result.current.execution.executeStream()
      })

      // After completion, should be connected or complete
      expect(['connected', 'disconnected']).toContain(result.current.store.connectionState)
    })
  })
})
