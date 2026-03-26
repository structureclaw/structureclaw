import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'
import { API_BASE } from '@/lib/api-base'

describe('AIConsole engine controls removal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'beam',
              name: { zh: '梁', en: 'Beam' },
              description: { zh: 'beam', en: 'beam' },
              autoLoadByDefault: true,
            },
          ]),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            skills: [{ id: 'beam', domain: 'structure-type' }],
            skillDomainById: { beam: 'structure-type' },
            domainSummaries: [{ domain: 'structure-type', skillIds: ['beam'] }],
          }),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/skillhub/search`)) {
        return {
          ok: true,
          json: async () => ({ items: [] }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/agent/skillhub/installed`) {
        return {
          ok: true,
          json: async () => ({ items: [] }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/chat/conversations`) {
        return {
          ok: true,
          json: async () => ([]),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/models/latest`) {
        return {
          ok: true,
          json: async () => ({ model: null }),
        } as Response
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render manual engine controls inside engineering context', async () => {
    const user = userEvent.setup()
    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand engineering context/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /expand engineering context/i }))

    expect(screen.queryByText(/^execution engine$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand engine settings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change engine/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/analysis engine auto/i)).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith(`${API_BASE}/api/v1/analysis-engines`)
  })
})
