import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

describe('AIConsole prompt and thinking details', () => {
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
          ]),
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

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({ skills: [{ id: 'beam' }] }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/analysis-engines`) {
        return {
          ok: true,
          json: async () => ({ engines: [] }),
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

      if (url === `${API_BASE}/api/v1/chat/conversation` && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ id: 'conv-debug-1', title: 'Prompt Debug' }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/chat/execute`) {
        return {
          ok: true,
          json: async () => ({
            response: 'Execution completed for prompt-debug test.',
            success: true,
            plan: ['Draft model payload', 'Analyze structure', 'Generate report summary'],
            toolCalls: [
              {
                tool: 'analyze_structure',
                status: 'success',
                durationMs: 120,
                input: { analysisType: 'static' },
                output: { status: 'ok' },
              },
              {
                tool: 'generate_report',
                status: 'error',
                error: 'mock report failure',
              },
            ],
          }),
        } as Response
      }

      if (url.includes('/snapshot') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ ok: true }),
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

  it('shows expandable prompt and thinking details on assistant message', async () => {
    const user = userEvent.setup()
    render(<AIConsole />)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'Run static beam check for prompt debug test')
    await user.click(screen.getByRole('button', { name: /run analysis/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/execution completed for prompt-debug test/i).length).toBeGreaterThan(0)
    })

    await user.click(screen.getByText(/show prompt & thinking/i))
    await user.click(screen.getByText(/view tool call details #1/i))

    await waitFor(() => {
      expect(screen.getByText(/prompt snapshot/i)).toBeInTheDocument()
      expect(screen.getByText(/^skills$/i)).toBeInTheDocument()
      expect(screen.getAllByText(/beam/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/thinking process/i)).toBeInTheDocument()
      expect(screen.getByText(/tool calls/i)).toBeInTheDocument()
      expect(screen.getAllByText(/analyze_structure/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/mock report failure/i)).toBeInTheDocument()
      expect(screen.getByText(/"message": "Run static beam check for prompt debug test"/i)).toBeInTheDocument()
      expect(screen.getAllByText(/"analysisType": "static"/i).length).toBeGreaterThan(0)
    })
  })
})
