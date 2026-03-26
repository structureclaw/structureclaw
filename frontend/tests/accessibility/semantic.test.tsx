import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  async function renderConsolePage() {
    render(<ConsolePage />)
    await waitFor(() => {
      expect(
        vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/v1/chat/conversations')),
      ).toBe(true)
    })
  }

  describe('Console page', () => {
    it('has main landmark', async () => {
      await renderConsolePage()
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('has conversation, composer, and output section headings', async () => {
      await renderConsolePage()
      expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Structural Engineering Conversation Workspace' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Analysis Results & Report' })).toBeInTheDocument()
    })

    it('buttons use button element (not div with onClick)', async () => {
      await renderConsolePage()
      const buttons = document.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'Discuss First' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Run Analysis' })).toBeInTheDocument()
    })

    it('exposes form fields with visible labels or placeholders', async () => {
      await renderConsolePage()
      expect(screen.getByPlaceholderText(/Describe your structural goal/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Expand Engineering Context' })).toBeInTheDocument()
      expect(screen.getByText('Analysis Results & Report')).toBeInTheDocument()
    })
  })
})
