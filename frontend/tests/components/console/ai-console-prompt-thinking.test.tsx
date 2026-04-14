import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'
import { hasLlmKey } from '../../helpers/backend-fixture'

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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.skipIf(!hasLlmKey)('shows expandable prompt and thinking details on assistant message', async () => {
    const user = userEvent.setup()

    const realFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

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

      return realFetch(input, init)
    })

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
