import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'

describe('AIConsole SkillHub actions', () => {
  it('shows capability settings entrypoint in console', async () => {
    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /manage capabilities/i })).toHaveAttribute('href', '/console/capabilities')
    }, { timeout: 15_000 })
  })

  it('moves capability editing out of inline console controls', async () => {
    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByText(/selected skills:/i)).toBeInTheDocument()
    }, { timeout: 15_000 })

    expect(screen.getByText(/selected tools:/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /expand engineering context/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand skills/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand skillhub/i })).not.toBeInTheDocument()
  })
})
