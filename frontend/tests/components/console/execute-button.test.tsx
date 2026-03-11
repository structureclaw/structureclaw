import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import { AppStoreProvider, useStore } from '@/lib/stores/context'
import { ExecuteButton } from '@/components/console/execute-button'

// Mock the useConsoleExecution hook
const mockExecuteSync = vi.fn().mockResolvedValue({ success: true })
const mockExecuteStream = vi.fn().mockResolvedValue({ success: true })

vi.mock('@/hooks/use-console-execution', () => ({
  useConsoleExecution: () => ({
    executeSync: mockExecuteSync,
    executeStream: mockExecuteStream,
  }),
}))

describe('ExecuteButton (CONS-07)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecuteSync.mockReset().mockResolvedValue({ success: true })
    mockExecuteStream.mockReset().mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderWithProvider = () => {
    return render(
      <AppStoreProvider initialState={{ message: 'run test' }}>
        <ExecuteButton />
      </AppStoreProvider>
    )
  }

  it('renders Send Request button', () => {
    renderWithProvider()
    expect(screen.getByRole('button', { name: /send request/i })).toBeInTheDocument()
  })

  it('renders Stream (SSE) button', () => {
    renderWithProvider()
    expect(screen.getByRole('button', { name: /stream.*sse/i })).toBeInTheDocument()
  })

  it('buttons are disabled when loading is true', () => {
    render(
      <AppStoreProvider initialState={{
        loading: true,
        endpoint: 'chat-message',
        mode: 'auto',
        conversationId: null,
        traceId: null,
        message: 'hello',
        modelText: '',
        includeModel: false,
        analysisType: 'static',
        reportFormat: 'markdown',
        reportOutput: 'inline',
        autoAnalyze: false,
        autoCodeCheck: false,
        includeReport: false,
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
      } as any}>
        <ExecuteButton />
      </AppStoreProvider>
    )

    const sendButton = screen.getByRole('button', { name: /send request/i })
    const streamButton = screen.getByRole('button', { name: /stream.*sse/i })

    expect(sendButton).toBeDisabled()
    expect(streamButton).toBeDisabled()
  })

  it('buttons are disabled when message is empty', () => {
    render(
      <AppStoreProvider initialState={{ message: '' }}>
        <ExecuteButton />
      </AppStoreProvider>
    )

    const sendButton = screen.getByRole('button', { name: /send request/i })
    const streamButton = screen.getByRole('button', { name: /stream.*sse/i })

    expect(sendButton).toBeDisabled()
    expect(streamButton).toBeDisabled()
  })

  it('clicking Send Request calls executeSync', async () => {
    renderWithProvider()

    const sendButton = screen.getByRole('button', { name: /send request/i })
    fireEvent.click(sendButton)

    expect(mockExecuteSync).toHaveBeenCalled()
  })

  it('clicking Stream (SSE) calls executeStream', async () => {
    renderWithProvider()

    const streamButton = screen.getByRole('button', { name: /stream.*sse/i })
    fireEvent.click(streamButton)

    expect(mockExecuteStream).toHaveBeenCalled()
  })

  it('Send Request button has primary variant styling', () => {
    const { container } = renderWithProvider()

    const sendButton = screen.getByRole('button', { name: /send request/i })
    expect(sendButton.className).toMatch(/bg-primary/)
  })

  it('Stream button has secondary or outline variant styling', () => {
    renderWithProvider()

    const streamButton = screen.getByRole('button', { name: /stream.*sse/i })
    // Either outline or secondary variant
    expect(
      streamButton.className.match(/bg-secondary|border-input/) ||
      streamButton.className.match(/outline/)
    ).toBeTruthy()
  })
})
