import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

describe('AIConsole engine filter reasons', () => {
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
                supportedAnalysisTypes: ['static'],
                supportedModelFamilies: ['frame'],
              },
              {
                id: 'engine-truss-a',
                name: 'Truss Engine A',
                enabled: true,
                available: true,
                status: 'available',
                supportedAnalysisTypes: ['static'],
                supportedModelFamilies: ['truss'],
              },
            ],
          }),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            generatedAt: '2026-03-17T00:00:00.000Z',
            skills: [{ id: 'beam' }],
            engines: [
              { id: 'engine-frame-a', name: 'Frame Engine A' },
              { id: 'engine-truss-a', name: 'Truss Engine A' },
            ],
            validEngineIdsBySkill: {
              beam: ['engine-frame-a'],
            },
            filteredEngineReasonsBySkill: {
              beam: {
                'engine-truss-a': ['model_family_mismatch'],
              },
            },
            validSkillIdsByEngine: {
              'engine-frame-a': ['beam'],
              'engine-truss-a': [],
            },
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

  it('shows filtered-out engines and reason text in engine picker', async () => {
    const user = userEvent.setup()
    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand engineering context/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /expand engineering context/i }))
    await user.click(screen.getByRole('button', { name: /expand engine settings/i }))
    await user.click(screen.getByRole('button', { name: /change engine/i }))

    await waitFor(() => {
      expect(screen.getByText(/filtered out by current skills/i)).toBeInTheDocument()
      expect(screen.getByText(/truss engine a/i)).toBeInTheDocument()
      expect(screen.getByText(/model family mismatch/i)).toBeInTheDocument()
    })
  })
})
