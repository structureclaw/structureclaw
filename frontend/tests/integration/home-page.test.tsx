import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import HomePage from '@/app/page'
import { AppStoreProvider } from '@/lib/stores'

const renderHomePage = () => render(
  <AppStoreProvider>
    <HomePage />
  </AppStoreProvider>
)

describe('Home Page Integration (PAGE-01)', () => {
  Element.prototype.scrollIntoView = vi.fn()

  it('renders the AI console as the root page', async () => {
    renderHomePage()

    expect(await screen.findByPlaceholderText(/Describe your structural goal/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Conversation' })).toBeInTheDocument()
  })

  it('renders conversation and output panels', async () => {
    renderHomePage()

    await waitFor(() => {
      expect(screen.getByTestId('console-layout-grid')).toBeInTheDocument()
    })
    expect(screen.getByTestId('console-history-panel')).toBeInTheDocument()
  })
})
