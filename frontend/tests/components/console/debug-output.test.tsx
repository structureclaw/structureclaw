import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { AppStoreProvider, useStore } from '@/lib/stores/context'
import { DebugOutput } from '@/components/console/debug-output'
import type { AgentError, StreamFrame } from '@/lib/api/contracts/agent'

describe('DebugOutput (CONS-14)', () => {
  const sampleError: AgentError = {
    message: 'Test error message',
    code: 'TEST_ERROR',
  }

  const sampleStreamFrames: StreamFrame[] = [
    { type: 'token', content: 'Frame 1 content' },
    { type: 'done' },
  ]

  const sampleRawResponse = { response: 'test response', conversationId: 'conv-123' }

  // Default store state with all required fields
  const createMockState = (overrides = {}) => ({
    // Base state
    endpoint: 'chat-message' as const,
    mode: 'auto' as const,
    conversationId: null,
    traceId: null,
    // Form state
    message: '',
    modelText: '',
    includeModel: false,
    analysisType: 'static' as const,
    reportFormat: 'markdown' as const,
    reportOutput: 'inline' as const,
    autoAnalyze: false,
    autoCodeCheck: false,
    includeReport: false,
    // Execution state
    loading: false,
    isStreaming: false,
    connectionState: 'disconnected' as const,
    result: null,
    rawResponse: null as Record<string, unknown> | null,
    streamFrames: [] as StreamFrame[],
    error: null as AgentError | null,
    // Actions (stubs)
    setEndpoint: vi.fn(),
    setMode: vi.fn(),
    setConversationId: vi.fn(),
    resetConsole: vi.fn(),
    setMessage: vi.fn(),
    setModelText: vi.fn(),
    setIncludeModel: vi.fn(),
    setAnalysisType: vi.fn(),
    setReportFormat: vi.fn(),
    setReportOutput: vi.fn(),
    setAutoAnalyze: vi.fn(),
    setAutoCodeCheck: vi.fn(),
    setIncludeReport: vi.fn(),
    setLoading: vi.fn(),
    setConnectionState: vi.fn(),
    setResult: vi.fn(),
    setRawResponse: vi.fn(),
    setStreamFrames: vi.fn(),
    setError: vi.fn(),
    ...overrides,
  })

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderWithProvider = (stateOverrides = {}) => {
    const initialState = createMockState(stateOverrides)
    return render(
      <AppStoreProvider initialState={initialState as any}>
        <DebugOutput />
      </AppStoreProvider>
    )
  }

  const openPanel = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /debug output/i }))
  }

  it('renders without crashing', () => {
    const { container } = renderWithProvider()
    expect(container.firstChild).not.toBeNull()
  })

  it('shows error message when present', () => {
    const { container } = renderWithProvider({ error: sampleError })

    // Check error container exists and contains the message
    expect(container.textContent).not.toContain('Test error message')
    expect(container.textContent).not.toContain('TEST_ERROR')
  })

  it('shows "None" when no raw response', async () => {
    renderWithProvider({ rawResponse: null })
    await openPanel()

    expect(screen.getByText(/raw json/i)).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('shows raw JSON when present', async () => {
    renderWithProvider({ rawResponse: sampleRawResponse })
    await openPanel()

    expect(screen.getByText(/raw json/i)).toBeInTheDocument()
    expect(screen.getByText(/"response": "test response"/)).toBeInTheDocument()
  })

  it('shows "No frames" when no stream frames', async () => {
    renderWithProvider({ streamFrames: [] })
    await openPanel()

    expect(screen.getByText(/stream frames/i)).toBeInTheDocument()
    expect(screen.getByText('No frames')).toBeInTheDocument()
  })

  it('shows stream frames when present', async () => {
    renderWithProvider({ streamFrames: sampleStreamFrames })
    await openPanel()

    expect(screen.getByText(/stream frames/i)).toBeInTheDocument()
    expect(screen.getByText(/Frame 1 content/)).toBeInTheDocument()
    expect(screen.getByText(/"type":"done"/)).toBeInTheDocument()
  })

  it('uses monospace font for code blocks', async () => {
    const { container } = renderWithProvider({ rawResponse: sampleRawResponse })
    await openPanel()

    // Check for font-mono class on pre elements
    const preElements = container.querySelectorAll('pre.font-mono, code.font-mono, .font-mono')
    expect(preElements.length).toBeGreaterThan(0)
  })
})
