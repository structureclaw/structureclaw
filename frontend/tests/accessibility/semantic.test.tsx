import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConsolePage from '@/app/(console)/console/page'

describe('Semantic HTML (ACCS-03)', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    } as unknown as Response)
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderConsolePage = () => render(<ConsolePage />)

  describe('Console page', () => {
    it('has main landmark', () => {
      renderConsolePage()
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('has conversation, composer, and output section headings', async () => {
      renderConsolePage()
      expect(await screen.findByRole('heading', { name: '历史会话' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '结构工程对话工作台' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '分析结果与报告' })).toBeInTheDocument()
    })

    it('buttons use button element (not div with onClick)', () => {
      const { container } = renderConsolePage()
      const buttons = container.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: '先聊需求' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '执行分析' })).toBeInTheDocument()
    })

    it('exposes form fields with visible labels or placeholders', () => {
      renderConsolePage()
      expect(screen.getByPlaceholderText(/描述你的结构目标、分析意图/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '展开工程上下文' })).toBeInTheDocument()
      expect(screen.getByText('分析结果与报告')).toBeInTheDocument()
    })
  })
})
