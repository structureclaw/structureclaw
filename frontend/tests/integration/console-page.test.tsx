import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('renders Chinese console copy when locale is set to zh', async () => {
    window.localStorage.setItem('structureclaw.locale', 'zh')

    render(<ConsolePage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '结构工程对话工作台' })).toBeInTheDocument()
    })

    expect(screen.getByText('历史会话')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '执行分析' })).toBeInTheDocument()
  })

  it('sends the active locale with execute requests', async () => {
    window.localStorage.setItem('structureclaw.locale', 'zh')

    let executePayload: Record<string, unknown> | null = null
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation') && init?.method === 'POST') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-zh',
            title: '新会话',
            type: 'analysis',
            createdAt: '2026-03-12T08:00:00.000Z',
            updatedAt: '2026-03-12T08:00:00.000Z',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/execute')) {
        executePayload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            response: '已完成',
            success: true,
            report: {
              summary: '摘要',
              markdown: '# 报告',
            },
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.change(screen.getByPlaceholderText(/描述你的结构目标/i), {
      target: { value: '请分析这个模型' },
    })
    fireEvent.click(screen.getByRole('button', { name: '执行分析' }))

    await waitFor(() => {
      expect(executePayload).not.toBeNull()
    })

    expect((executePayload?.context as Record<string, unknown>)?.locale).toBe('zh')
  })
})
