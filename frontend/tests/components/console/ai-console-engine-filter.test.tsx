import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'
import { AppStoreProvider } from '@/lib/stores/context'

describe('AIConsole engine controls removal', () => {
  it('does not render manual engine controls inside engineering context', async () => {
    const user = userEvent.setup()
    render(<AppStoreProvider><AIConsole /></AppStoreProvider>)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand engineering context/i })).toBeInTheDocument()
    }, { timeout: 15_000 })

    await user.click(screen.getByRole('button', { name: /expand engineering context/i }))

    expect(screen.queryByText(/^execution engine$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand engine settings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change engine/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/analysis engine auto/i)).not.toBeInTheDocument()
  })
})
