import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

describe('AIConsole SkillHub actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()

    let installed = false
    let enabled = false

    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init?.method || 'GET').toUpperCase()

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
            domainSummaries: [{ domain: 'structure-type', skillIds: ['beam'] }],
            skillDomainById: { beam: 'structure-type' },
            validEngineIdsBySkill: { beam: ['engine-frame-a'] },
            filteredEngineReasonsBySkill: {},
            validSkillIdsByEngine: { 'engine-frame-a': ['beam'] },
          }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/analysis-engines`) {
        return {
          ok: true,
          json: async () => ({
            engines: [
              {
                id: 'engine-frame-a',
                name: 'Frame Engine A',
                enabled: true,
                available: true,
              },
            ],
          }),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/skillhub/search`)) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: 'skillhub.seismic-simplified-policy',
                domain: 'analysis-strategy',
                name: { zh: '抗震简化策略', en: 'Seismic Simplified Policy' },
                installed,
                enabled,
              },
            ],
          }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/agent/skillhub/installed`) {
        return {
          ok: true,
          json: async () => ({
            items: installed
              ? [{ id: 'skillhub.seismic-simplified-policy', enabled }]
              : [],
          }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/agent/skillhub/install` && method === 'POST') {
        installed = true
        enabled = true
        return {
          ok: true,
          json: async () => ({ installed: true, enabled: true }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/agent/skillhub/disable` && method === 'POST') {
        enabled = false
        return {
          ok: true,
          json: async () => ({ enabled: false }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/agent/skillhub/enable` && method === 'POST') {
        enabled = true
        return {
          ok: true,
          json: async () => ({ enabled: true }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/agent/skillhub/uninstall` && method === 'POST') {
        installed = false
        enabled = false
        return {
          ok: true,
          json: async () => ({ uninstalled: true }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/chat/conversations`) {
        return { ok: true, json: async () => [] } as Response
      }

      if (url === `${API_BASE}/api/v1/models/latest`) {
        return { ok: true, json: async () => ({ model: null }) } as Response
      }

      return { ok: true, json: async () => ({}) } as Response
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs install-disable-enable-uninstall lifecycle', async () => {
    const user = userEvent.setup()
    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand skills/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /expand skills/i }))

    await waitFor(() => {
      expect(screen.getByText(/skillhub extensions/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Uninstall' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
    })
  })
})
