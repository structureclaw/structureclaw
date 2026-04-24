import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ConsolePage from '@/app/(console)/console/page'
import { AppStoreProvider } from '@/lib/stores/context'

describe('Semantic HTML (ACCS-03)', () => {
  Element.prototype.scrollIntoView = vi.fn()

  async function renderConsolePage() {
    render(<AppStoreProvider><ConsolePage /></AppStoreProvider>)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Structural Engineering|结构工程/ })).toBeInTheDocument()
    }, { timeout: 15_000 })
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
      expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    })

    it('exposes form fields with visible labels or placeholders', async () => {
      await renderConsolePage()
      expect(screen.getByPlaceholderText(/Describe your structural goal/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Expand Engineering Context' })).toBeInTheDocument()
      expect(screen.getByText('Analysis Results & Report')).toBeInTheDocument()
    })
  })
})
