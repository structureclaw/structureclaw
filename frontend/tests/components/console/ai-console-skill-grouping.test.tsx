import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'
import { API_BASE } from '@/lib/api-base'

function createSseResponse(events: unknown[]) {
  const encoder = new TextEncoder()
  const chunks = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).concat('data: [DONE]\n\n')
  const stream = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })

  return {
    ok: true,
    body: stream,
  } as unknown as Response
}

describe('AIConsole grouped skill picker', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
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
            {
              id: 'seismic-policy',
              name: { zh: '抗震策略', en: 'Seismic Policy' },
              description: { zh: 'policy', en: 'policy' },
              autoLoadByDefault: true,
            },
            {
              id: 'opensees-static',
              name: { zh: 'OpenSees 静力分析', en: 'OpenSees Static Analysis' },
              description: { zh: 'static', en: 'static' },
              autoLoadByDefault: true,
            },
            {
              id: 'opensees-nonlinear',
              name: { zh: '非线性策略', en: 'Nonlinear Policy' },
              description: { zh: 'policy', en: 'policy' },
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
              { id: 'seismic-policy', domain: 'analysis-strategy' },
              { id: 'opensees-static', domain: 'analysis-strategy' },
              { id: 'opensees-nonlinear', domain: 'analysis-strategy' },
            ],
            domainSummaries: [
              {
                domain: 'structure-type',
                skillIds: ['beam', 'truss'],
                autoLoadSkillIds: ['beam', 'truss'],
              },
              {
                domain: 'analysis-strategy',
                skillIds: ['seismic-policy', 'opensees-static', 'opensees-nonlinear'],
                autoLoadSkillIds: ['opensees-static'],
              },
            ],
            skillDomainById: {
              beam: 'structure-type',
              truss: 'structure-type',
              'seismic-policy': 'analysis-strategy',
              'opensees-static': 'analysis-strategy',
              'opensees-nonlinear': 'analysis-strategy',
            },
            validEngineIdsBySkill: {
              beam: ['engine-frame-a'],
              truss: ['engine-truss-a'],
              'seismic-policy': ['engine-seismic-a'],
              'opensees-static': ['engine-static-a'],
              'opensees-nonlinear': ['engine-nonlinear-a'],
            },
            filteredEngineReasonsBySkill: {},
            validSkillIdsByEngine: {
              'engine-frame-a': ['beam'],
              'engine-truss-a': ['truss'],
              'engine-seismic-a': ['seismic-policy'],
              'engine-static-a': ['opensees-static'],
              'engine-nonlinear-a': ['opensees-nonlinear'],
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

      if (url === `${API_BASE}/api/v1/chat/conversation` && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ id: 'conv-ambiguous-analysis', title: 'Ambiguous Analysis', type: 'general' }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/chat/stream`) {
        return createSseResponse([
          {
            type: 'result',
            content: {
              response: 'ok',
              success: true,
              analysis: { meta: { analysisType: 'static' }, data: {} },
            },
          },
        ])
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
      expect(screen.getByLabelText(/category view/i)).toBeInTheDocument()
      expect(screen.getAllByText(/structure-type skills/i).length).toBeGreaterThan(0)
      // Auto-loaded skills may fully preselect the domain; UI shows Clear Category instead of Select Category.
      expect(screen.getByRole('button', { name: /select category|clear category/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Beam' }))

    await waitFor(() => {
      const enabledSelectButtons = screen.getAllByRole('button', { name: /select category/i }).filter((button) => !button.hasAttribute('disabled'))
      expect(enabledSelectButtons.length).toBeGreaterThan(0)
    })

    const enabledSelectButtons = screen.getAllByRole('button', { name: /select category/i }).filter((button) => !button.hasAttribute('disabled'))
    await user.click(enabledSelectButtons[0])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /clear category/i })).toBeInTheDocument()
    })
  })

  it('allows switching among all fourteen domain groups', async () => {
    const user = userEvent.setup()
    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand engineering context/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /expand skills/i }))

    await waitFor(() => {
      const selector = screen.getByLabelText(/category view/i)
      const options = selector.querySelectorAll('option')
      expect(options.length).toBe(14)
      expect(Array.from(options).map((option) => option.value)).toEqual([
        'data-input',
        'structure-type',
        'material',
        'section',
        'load-boundary',
        'analysis',
        'result-postprocess',
        'design',
        'code-check',
        'validation',
        'report-export',
        'drawing',
        'visualization',
        'general',
      ])
    })

    await user.selectOptions(screen.getByLabelText(/category view/i), 'material')

    await waitFor(() => {
      expect(screen.getAllByText(/^material skills$/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/no installed local skills in this category yet/i)).toBeInTheDocument()
    })
  })

  it('preselects only the OpenSees static analysis skill for a new conversation', async () => {
    const user = userEvent.setup()
    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand skills/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /expand skills/i }))
    await user.selectOptions(screen.getByLabelText(/category view/i), 'analysis')

    await waitFor(() => {
      const staticSkillButton = screen.getByRole('button', { name: 'OpenSees Static Analysis' })
      const nonlinearSkillButton = screen.getByRole('button', { name: 'Nonlinear Policy' })
      const seismicSkillButton = screen.getByRole('button', { name: 'Seismic Policy' })
      expect(staticSkillButton.className).toContain('border-cyan-300/50')
      expect(nonlinearSkillButton.className).not.toContain('border-cyan-300/50')
      expect(seismicSkillButton.className).not.toContain('border-cyan-300/50')
    })
  })

  it('does not send analysis type from frontend when executing with selected analysis skills', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(global.fetch)
    render(<AIConsole />)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'Analyze this beam with the default policy selection')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE}/api/v1/chat/stream`,
        expect.objectContaining({ method: 'POST' })
      )
    })

    const streamCall = fetchMock.mock.calls.find(([input]) => String(input) === `${API_BASE}/api/v1/chat/stream`)
    expect(streamCall).toBeTruthy()
    const requestInit = streamCall?.[1] as RequestInit | undefined
    const body = JSON.parse(String(requestInit?.body || '{}')) as { mode?: string; context?: { analysisType?: string } }
    expect(body.mode).toBe('auto')
    expect(body.context?.analysisType).toBeUndefined()
  })
})
