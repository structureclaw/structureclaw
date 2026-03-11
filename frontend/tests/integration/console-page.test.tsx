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

  const renderConsolePage = () => render(<ConsolePage />)

  it('renders the active AI console shell', async () => {
    renderConsolePage()

    expect(await screen.findByRole('heading', { name: '结构工程对话工作台' })).toBeInTheDocument()
    expect(screen.getByText('历史会话')).toBeInTheDocument()
    expect(screen.getByText('分析结果与报告')).toBeInTheDocument()
  })

  it('shows the conversational composer controls', () => {
    renderConsolePage()

    expect(screen.getByPlaceholderText(/描述你的结构目标、分析意图/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开工程上下文' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '先聊需求' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '执行分析' })).toBeInTheDocument()
  })

  it('loads conversation history from the backend', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue([{ id: 'conv-1', title: '历史会话标题', updatedAt: '2026-03-10T12:00:00.000Z' }]),
    } as unknown as Response)
    renderConsolePage()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/chat/conversations'))
    })
    expect(await screen.findByText('历史会话标题')).toBeInTheDocument()
  })
})
