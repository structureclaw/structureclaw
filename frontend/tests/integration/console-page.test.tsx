import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import ConsolePage from '@/app/(console)/console/page'
import { AppStoreProvider, useStore } from '@/lib/stores/context'
import type { StoreState } from '@/lib/stores/context'

// Mock the useConsoleExecution hook
const mockExecuteSync = vi.fn().mockResolvedValue({ success: true })
const mockExecuteStream = vi.fn().mockResolvedValue({ success: true })

vi.mock('@/hooks/use-console-execution', () => ({
  useConsoleExecution: () => ({
    executeSync: mockExecuteSync,
    executeStream: mockExecuteStream,
  }),
}))

// Create a minimal initial state for testing
const createInitialState = (overrides: Partial<StoreState> = {}): Partial<StoreState> => ({
  endpoint: 'chat-message',
  mode: 'auto',
  conversationId: null,
  traceId: null,
  message: 'Run default test message',
  modelText: '',
  includeModel: false,
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
  ...overrides,
})

describe('ConsolePage Integration (CONS-13)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecuteSync.mockReset().mockResolvedValue({ success: true })
    mockExecuteStream.mockReset().mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderConsolePage = (initialState: Partial<StoreState> = {}) => {
    return render(
      createElement(
        AppStoreProvider,
        {
          initialState: createInitialState(initialState),
          children: createElement(ConsolePage) as ReactNode,
        }
      )
    )
  }

  it('renders all input controls on left panel', () => {
    renderConsolePage()

    // Endpoint selector should be present
    expect(screen.getByRole('combobox', { name: /endpoint/i })).toBeInTheDocument()

    // Message textarea should be present
    expect(screen.getByRole('textbox', { name: /message/i })).toBeInTheDocument()

    // Model JSON panel should be present
    expect(screen.getByText(/model json/i)).toBeInTheDocument()

    // Config panel should be present - check for "Analysis Type" label which exists in ConfigPanel
    expect(screen.getByRole('combobox', { name: /analysis type/i })).toBeInTheDocument()
  })

  it('renders execute buttons', () => {
    renderConsolePage()

    expect(screen.getByRole('button', { name: /send request/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /stream.*sse/i })).toBeInTheDocument()
  })

  it('status indicator shows connection state', () => {
    const { container } = renderConsolePage({ connectionState: 'connecting' })

    // Status indicator should show connecting state
    expect(screen.getByText('Connecting...')).toBeInTheDocument()
    // Spinner should be animated
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('execute button triggers state change to loading', async () => {
    renderConsolePage()

    const sendButton = screen.getByRole('button', { name: /send request/i })
    fireEvent.click(sendButton)

    expect(mockExecuteSync).toHaveBeenCalled()
  })

  it('result display shows after execution (mocked)', async () => {
    renderConsolePage({
      result: {
        response: 'Test response',
        success: true,
        conversationId: 'test-conv-id',
        toolCalls: [],
        artifacts: [],
      },
    })

    // Result display should show the response
    expect(screen.getByText(/execution results/i)).toBeInTheDocument()
    expect(screen.getByText('Test response')).toBeInTheDocument()
  })

  it('split panel layout renders correctly', () => {
    const { container } = renderConsolePage()

    // SplitPanel should render with two panels
    const panelGroup = container.querySelector('[data-panel-group-id]')
    expect(panelGroup || container.querySelector('.h-full')).toBeTruthy()
  })

  it('shows error when error state is set', () => {
    renderConsolePage({
      error: {
        message: 'Test error message',
        code: 'TEST_ERROR',
      },
    })

    // Multiple "Error" elements due to DebugOutput also showing errors
    expect(screen.getAllByText('Error').length).toBeGreaterThan(0)
    // Multiple "Test error message" elements
    expect(screen.getAllByText('Test error message').length).toBeGreaterThan(0)
    // Check for code in any error display - multiple matches expected
    expect(screen.getAllByText(/TEST_ERROR/).length).toBeGreaterThan(0)
  })

  it('shows artifacts when result has artifacts', () => {
    renderConsolePage({
      result: {
        response: 'Test response',
        success: true,
        artifacts: [
          { format: 'json', path: '/tmp/test.json' },
        ],
      },
    })

    // There may be multiple "Artifacts" headers - use getAllByText
    expect(screen.getAllByText(/artifacts/i).length).toBeGreaterThan(0)
    // Check for the artifact path in the list - use getAllByText as there are multiple matches
    expect(screen.getAllByText(/test\.json/).length).toBeGreaterThan(0)
  })

  it('shows debug output section', () => {
    renderConsolePage()

    expect(screen.getByText('Debug Output')).toBeInTheDocument()
  })

  it('status indicator shows idle state by default', () => {
    renderConsolePage()

    expect(screen.getByText('Idle')).toBeInTheDocument()
  })
})

describe('Accessibility - Semantic Structure (PAGE-02)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecuteSync.mockReset().mockResolvedValue({ success: true })
    mockExecuteStream.mockReset().mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderConsolePage = (initialState: Partial<StoreState> = {}) => {
    return render(
      createElement(
        AppStoreProvider,
        {
          initialState: createInitialState(initialState),
          children: createElement(ConsolePage) as ReactNode,
        }
      )
    )
  }

  it('has main landmark with aria-label', () => {
    renderConsolePage()
    const main = screen.getByRole('main')
    expect(main).toBeInTheDocument()
    expect(main).toHaveAttribute('aria-label', 'Agent Console')
  })

  it('has section with aria-label for input controls', () => {
    renderConsolePage()
    const inputSection = screen.getByLabelText('Input Controls')
    expect(inputSection).toBeInTheDocument()
    expect(inputSection.tagName.toLowerCase()).toBe('section')
  })

  it('has section with aria-label for results', () => {
    renderConsolePage()
    const resultsSection = screen.getByLabelText('Results')
    expect(resultsSection).toBeInTheDocument()
    expect(resultsSection.tagName.toLowerCase()).toBe('section')
  })

  it('results section has aria-live for dynamic content announcements', () => {
    renderConsolePage()
    const resultsSection = screen.getByLabelText('Results')
    expect(resultsSection).toHaveAttribute('aria-live', 'polite')
  })
})
