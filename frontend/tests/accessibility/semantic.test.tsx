import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ConsolePage from '@/app/page'
import { AppStoreProvider } from '@/lib/stores/context'

describe('Semantic HTML (ACCS-03)', () => {
  Element.prototype.scrollIntoView = vi.fn()

  async function renderConsolePage() {
    render(<main><AppStoreProvider><ConsolePage /></AppStoreProvider></main>)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Describe your structural goal/)).toBeInTheDocument()
    }, { timeout: 15_000 })
  }

  describe('Console page', () => {
    it('has main landmark', async () => {
      await renderConsolePage()
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('has conversation, composer, and output section headings', async () => {
      await renderConsolePage()
      expect(screen.getByRole('heading', { name: 'How can I help you today?' })).toBeInTheDocument()
      expect(screen.getByTestId('console-layout-grid')).toBeInTheDocument()
      expect(screen.getByTestId('console-history-panel')).toBeInTheDocument()
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
      expect(screen.getByRole('button', { name: 'New Conversation' })).toBeInTheDocument()
      expect(screen.getByTestId('console-history-panel')).toBeInTheDocument()
    })
  })
})
