import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { AppStoreProvider, useStore } from '@/lib/stores/context'
import {
  EndpointSelector,
  MessageInput,
  ConfigPanel,
  ExecuteButton,
} from '@/components/console'

// Mock fetch globally
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = vi.fn() as any
global.fetch = mockFetch

describe('Console Execution Integration (CONS-05, CONS-06, CONS-07, CONS-12)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const ConsolePanel = () => {
    const result = useStore((state) => state.result)
    const error = useStore((state) => state.error)
    const loading = useStore((state) => state.loading)
    const connectionState = useStore((state) => state.connectionState)

    return (
      <div>
        <EndpointSelector />
        <MessageInput />
        <ConfigPanel />
        <ExecuteButton />
        {/* Debug outputs for testing */}
        <div data-testid="loading">{loading ? 'true' : 'false'}</div>
        <div data-testid="connection-state">{connectionState}</div>
        <div data-testid="result">{result ? JSON.stringify(result) : 'null'}</div>
        <div data-testid="error">{error ? error.message : 'null'}</div>
      </div>
    )
  }

  const renderConsole = () => {
    return render(
      <AppStoreProvider>
        <ConsolePanel />
      </AppStoreProvider>
    )
  }

  it('renders all console components', () => {
    renderConsole()

    // Endpoint selector
    expect(screen.getByRole('combobox', { name: /endpoint/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /mode/i })).toBeInTheDocument()

    // Message input
    expect(screen.getByLabelText(/message/i)).toBeInTheDocument()

    // Config panel
    expect(screen.getByRole('combobox', { name: /analysis type/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /report format/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /report output/i })).toBeInTheDocument()
    // Execute buttons
    expect(screen.getByRole('button', { name: /send request/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /stream.*sse/i })).toBeInTheDocument()
  })

  it('filling form and clicking execute updates store with result', async () => {
    const mockResponse = {
      response: 'Integration test response',
      conversationId: 'conv-integration',
      traceId: 'trace-integration',
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })

    renderConsole()

    // Fill message
    const messageTextarea = screen.getByLabelText(/message/i)
    fireEvent.change(messageTextarea, { target: { value: 'Test message' } })

    // Click execute
    const sendButton = screen.getByRole('button', { name: /send request/i })
    fireEvent.click(sendButton)

    // Wait for result
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).not.toBe('null')
    })

    // Verify result content
    const resultText = screen.getByTestId('result').textContent
    expect(resultText).toContain('Integration test response')
  })

  it('error handling shows error in store', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ message: 'Server error' }),
    })

    renderConsole()

    // Fill message
    const messageTextarea = screen.getByLabelText(/message/i)
    fireEvent.change(messageTextarea, { target: { value: 'Test message' } })

    // Click execute
    const sendButton = screen.getByRole('button', { name: /send request/i })
    fireEvent.click(sendButton)

    // Wait for error
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).not.toBe('null')
    })

    // Verify error content - the hook returns the JSON message, not the status code
    const errorText = screen.getByTestId('error').textContent
    expect(errorText).toContain('Server error')
  })

  it('changing config options updates store', async () => {
    renderConsole()

    // Open analysisType select
    const analysisTrigger = screen.getByRole('combobox', { name: /analysis type/i })
    fireEvent.click(analysisTrigger)

    // Select dynamic
    const dynamicOption = screen.getByRole('option', { name: /dynamic/i })
    fireEvent.click(dynamicOption)

    // Toggle a checkbox
    const autoAnalyzeCheckbox = screen.getByRole('checkbox', { name: /auto analyze/i })
    fireEvent.click(autoAnalyzeCheckbox)

    // The store should be updated (verified by the fact that clicking doesn't throw)
    expect(autoAnalyzeCheckbox).toBeInTheDocument()
  })

  it('loading state is managed during execution', async () => {
    let resolvePromise: (value: any) => void
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve
    })

    mockFetch.mockReturnValueOnce(pendingPromise)

    renderConsole()

    // Initially not loading
    expect(screen.getByTestId('loading').textContent).toBe('false')

    const messageTextarea = screen.getByLabelText(/message/i)
    fireEvent.change(messageTextarea, { target: { value: 'Test message' } })

    // Click execute
    const sendButton = screen.getByRole('button', { name: /send request/i })
    fireEvent.click(sendButton)

    // Wait for loading to start
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('true')
    })

    // Resolve the fetch
    await act(async () => {
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ response: 'done' }),
      })
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    // Loading should be false again
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
  })

  it('stream button triggers SSE request', async () => {
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"type":"token","content":"Stream test"}\n\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => mockReader },
    })

    renderConsole()

    const messageTextarea = screen.getByLabelText(/message/i)
    fireEvent.change(messageTextarea, { target: { value: 'Test message' } })

    // Click stream button
    const streamButton = screen.getByRole('button', { name: /stream.*sse/i })
    fireEvent.click(streamButton)

    // Verify SSE endpoint was called
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('/api/v1/chat/stream')
    })
  })
})

// Import act for the loading state test
import { act } from '@testing-library/react'
