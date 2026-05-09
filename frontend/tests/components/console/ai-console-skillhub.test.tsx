import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'
import { WorkspaceSettingsDialog } from '@/components/settings/workspace-settings-dialog'
import { AppStoreProvider } from '@/lib/stores/context'

describe('AIConsole SkillHub actions', () => {
  it('shows capability settings entrypoint in console', async () => {
    const user = userEvent.setup()
    render(
      <AppStoreProvider>
        <AIConsole />
        <WorkspaceSettingsDialog />
      </AppStoreProvider>
    )

    const capabilitySummary = await screen.findByRole('button', { name: /skills · .*tools/i }, { timeout: 15_000 })
    await user.click(capabilitySummary)

    expect(await screen.findByRole('heading', { name: /capability settings/i })).toBeInTheDocument()
  })

  it('moves capability editing out of inline console controls', async () => {
    render(<AppStoreProvider><AIConsole /></AppStoreProvider>)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /skills · .*tools/i })).toBeInTheDocument()
    }, { timeout: 15_000 })

    expect(screen.queryByText(/selected skills:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/selected tools:/i)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/describe your structural goal/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand skills/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand skillhub/i })).not.toBeInTheDocument()
  })
})
