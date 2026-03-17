import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

describe('AIConsole grouped skill picker', () => {
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
            {
              id: 'truss',
              name: { zh: '桁架', en: 'Truss' },
              description: { zh: 'truss', en: 'truss' },
              autoLoadByDefault: true,
            },
          ]),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            generatedAt: '2026-03-17T00:00:00.000Z',
            skills: [
              { id: 'beam', domain: 'structure-type' },
              { id: 'truss', domain: 'structure-type' },
            ],
            domainSummaries: [
              {
                domain: 'structure-type',
                skillIds: ['beam', 'truss'],
                autoLoadSkillIds: ['beam', 'truss'],
              },
            ],
            skillDomainById: {
              beam: 'structure-type',
              truss: 'structure-type',
            },
            validEngineIdsBySkill: {
              beam: ['engine-frame-a'],
              truss: ['engine-truss-a'],
            },
            filteredEngineReasonsBySkill: {},
            validSkillIdsByEngine: {
              'engine-frame-a': ['beam'],
              'engine-truss-a': ['truss'],
            },
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
                status: 'available',
              },
            ],
          }),
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

  it('supports category-level select and clear actions', async () => {
    const user = userEvent.setup()
    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand engineering context/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /expand skills/i }))

    await waitFor(() => {
      expect(screen.getByText(/structure-type skills/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /clear category/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Beam' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /select category/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /select category/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /clear category/i })).toBeInTheDocument()
    })
  })
})
