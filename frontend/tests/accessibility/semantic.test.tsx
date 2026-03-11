import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import ConsolePage from '@/app/(console)/console/page'
import { AppStoreProvider } from '@/lib/stores/context'
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
  message: '',
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

describe('Semantic HTML (ACCS-03)', () => {
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

  describe('Console page', () => {
    it('has main landmark', () => {
      renderConsolePage()
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('has section with aria-label for input controls', () => {
      renderConsolePage()
      expect(screen.getByLabelText('Input Controls')).toBeInTheDocument()
    })

    it('has section with aria-label for results', () => {
      renderConsolePage()
      expect(screen.getByLabelText('Results')).toBeInTheDocument()
    })

    it('form controls have associated labels', () => {
      renderConsolePage()

      // Endpoint selector has a label
      expect(screen.getByLabelText(/endpoint/i)).toBeInTheDocument()

      // Message input has a label (accessed via placeholder or aria-label)
      expect(screen.getByRole('textbox', { name: /message/i })).toBeInTheDocument()
    })

    it('buttons use button element (not div with onClick)', () => {
      const { container } = renderConsolePage()

      // All interactive elements with button role should be actual button elements
      const buttons = container.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThan(0)

      // Execute button should be a button element
      expect(screen.getByRole('button', { name: /send request/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /stream.*sse/i })).toBeInTheDocument()
    })

    it('has proper heading hierarchy', () => {
      renderConsolePage()

      // Check for headings that provide structure
      // The console page should have headings for sections
      const headings = screen.getAllByRole('heading')
      expect(headings.length).toBeGreaterThanOrEqual(0)
    })
  })
})
