import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomePage from '@/app/(marketing)/page'
import { AppStoreProvider } from '@/lib/stores'

const renderHomePage = () => render(
  <AppStoreProvider>
    <HomePage />
  </AppStoreProvider>
)

describe('Home Page Integration (PAGE-01)', () => {
  it('renders with main landmark', () => {
    renderHomePage()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders the current hero copy', () => {
    renderHomePage()

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Turn your structural analysis workspace into an AI that can actually talk.')
    expect(screen.getByText(/StructureClaw now starts with conversation/)).toBeInTheDocument()
  })

  it('renders workflow prompts and feature cards', () => {
    renderHomePage()

    expect(screen.getByText(/single-span steel beam static analysis/)).toBeInTheDocument()
    expect(screen.getByText('Clarify First, Execute Later')).toBeInTheDocument()
    expect(screen.getByText('Results and Reports Stay Separate')).toBeInTheDocument()
    expect(screen.getByText('Keep Engineering Context Intact')).toBeInTheDocument()
  })

  it('CTA button links to console', () => {
    renderHomePage()

    const ctaLink = screen.getByRole('link', { name: /Enter AI Console/i })
    expect(ctaLink).toHaveAttribute('href', '/console')
  })

  it('keeps the workflow anchor link', () => {
    renderHomePage()

    expect(screen.getByRole('link', { name: 'View Workflow' })).toHaveAttribute('href', '#workflow')
  })

  it('all interactive elements are keyboard accessible', async () => {
    const user = userEvent.setup()
    renderHomePage()

    await user.tab()
    const ctaLink = screen.getByRole('link', { name: /Enter AI Console/i })
    expect(ctaLink).toHaveFocus()
  })

  it('renders the live workspace preview content', () => {
    renderHomePage()

    expect(screen.getByText('Live Workspace')).toBeInTheDocument()
    expect(screen.getByText('Dialogue + Results Split View')).toBeInTheDocument()
    expect(screen.getByText(/I am understanding your analysis intent/)).toBeInTheDocument()
  })

  it('uses the new conversational positioning badge', () => {
    renderHomePage()

    expect(screen.getByText('Conversational Structural AI')).toBeInTheDocument()
  })
})
