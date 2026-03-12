import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ConsolePage from '@/app/(console)/console/page'

describe('ConsolePage Integration (CONS-13)', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    } as unknown as Response)
    window.localStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function renderConsolePage() {
    const view = render(<ConsolePage />)
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/chat/conversations'))
    })
    return view
  }

  it('renders the active AI console shell', async () => {
    await renderConsolePage()

    expect(await screen.findByRole('heading', { name: 'Structural Engineering Conversation Workspace' })).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('Analysis Results & Report')).toBeInTheDocument()
  })

  it('shows the conversational composer controls', async () => {
    await renderConsolePage()

    expect(screen.getByPlaceholderText(/Describe your structural goal/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Engineering Context' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discuss First' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Analysis' })).toBeInTheDocument()
  })

  it('loads conversation history from the backend', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([{ id: 'conv-1', title: '历史会话标题', updatedAt: '2026-03-10T12:00:00.000Z' }]),
    } as unknown as Response)
    await renderConsolePage()
    expect(await screen.findByText('历史会话标题')).toBeInTheDocument()
  })

  it('keeps separate scroll containers for history, chat, and output', async () => {
    const { container } = await renderConsolePage()

    expect(await screen.findByTestId('console-layout-grid')).toBeInTheDocument()
    expect(screen.getByTestId('console-history-scroll')).toBeInTheDocument()
    expect(screen.getByTestId('console-chat-scroll')).toBeInTheDocument()
    expect(screen.getByTestId('console-output-scroll')).toBeInTheDocument()
    expect(screen.getByTestId('console-composer')).toBeInTheDocument()

    const chatScroll = screen.getByTestId('console-chat-scroll')
    expect(chatScroll).not.toContainElement(screen.getByTestId('console-composer'))
    expect(container.querySelector('[data-testid="console-history-scroll"].overflow-auto')).not.toBeNull()
    expect(container.querySelector('[data-testid="console-chat-scroll"].overflow-auto')).not.toBeNull()
    expect(container.querySelector('[data-testid="console-output-scroll"].overflow-auto')).not.toBeNull()
  })
})
