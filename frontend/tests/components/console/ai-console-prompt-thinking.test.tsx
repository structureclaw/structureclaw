import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'
import { API_BASE } from '@/lib/api-base'

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (typeof URL !== 'undefined' && input instanceof URL) {
    return input.href
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url
  }
  return String(input)
}

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

describe('AIConsole prompt and thinking details', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = fetchInputUrl(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return Response.json([
          {
            id: 'beam',
            name: { zh: '梁', en: 'Beam' },
            description: { zh: 'beam', en: 'beam' },
            autoLoadByDefault: true,
          },
        ])
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/skillhub/search`)) {
        return Response.json({ items: [] })
      }

      if (url === `${API_BASE}/api/v1/agent/skillhub/installed`) {
        return Response.json({ items: [] })
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return Response.json({
          skills: [{ id: 'beam', domain: 'structure-type' }],
          skillDomainById: { beam: 'structure-type' },
          domainSummaries: [{ domain: 'structure-type', skillIds: ['beam'] }],
        })
      }

      if (url === `${API_BASE}/api/v1/chat/conversations`) {
        return Response.json([])
      }

      if (url === `${API_BASE}/api/v1/models/latest`) {
        return Response.json({ model: null })
      }

      if (url === `${API_BASE}/api/v1/chat/conversation` && init?.method === 'POST') {
        return Response.json({ id: 'conv-debug-1', title: 'Prompt Debug' })
      }

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          {
            type: 'result',
            content: {
              response: 'Execution completed for prompt-debug test.',
              success: true,
              routing: {
                selectedSkillIds: ['beam'],
                structuralSkillId: 'beam',
                structuralScenarioKey: 'beam',
                analysisSkillId: 'opensees-static',
                analysisSkillIds: ['opensees-static'],
              },
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
            },
          },
        ])
      }

      if (url.includes('/snapshot') && init?.method === 'POST') {
        return Response.json({ ok: true })
      }

      return Response.json({})
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows expandable prompt and thinking details on assistant message', async () => {
    const user = userEvent.setup()
    render(<AIConsole />)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.click(screen.getByRole('button', { name: /expand engineering context/i }))
    await user.type(composer, 'Run static beam check for prompt debug test')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/execution completed for prompt-debug test/i).length).toBeGreaterThan(0)
    })

    await user.click(screen.getByText(/show prompt & thinking/i))
    await user.click(screen.getByText(/view tool call details #1/i))

    await waitFor(() => {
      expect(screen.getByText(/prompt snapshot/i)).toBeInTheDocument()
      expect(screen.getByText(/^skills$/i)).toBeInTheDocument()
      const resolvedSkillsSection = screen.getByText(/resolved skills/i).parentElement
      expect(resolvedSkillsSection).not.toBeNull()
      expect(screen.getAllByText(/beam/i).length).toBeGreaterThan(0)
      expect(within(resolvedSkillsSection as HTMLElement).getByText(/opensees-static/i)).toBeInTheDocument()
      expect(screen.getByText(/thinking process/i)).toBeInTheDocument()
      expect(screen.getByText(/tool calls/i)).toBeInTheDocument()
      expect(screen.getAllByText(/analyze_structure/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/mock report failure/i)).toBeInTheDocument()
      expect(screen.getByText(/"message": "Run static beam check for prompt debug test"/i)).toBeInTheDocument()
      expect(screen.getAllByText(/"analysisType": "static"/i).length).toBeGreaterThan(0)
    })
  })
})
