import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'
import { AppStoreProvider } from '@/lib/stores/context'

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

describe('AIConsole presentation rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders summary from v3 presentation events', async () => {
    const user = userEvent.setup()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          {
            type: 'presentation_init',
            presentation: {
              version: 3,
              mode: 'execution',
              status: 'streaming',
              summaryText: '',
              phases: [],
              artifacts: [],
            },
          },
          {
            type: 'phase_upsert',
            phase: {
              phaseId: 'phase:modeling',
              phase: 'modeling',
              title: '建模',
              status: 'running',
              steps: [],
            },
          },
          {
            type: 'step_upsert',
            phaseId: 'phase:modeling',
            step: {
              id: 'step:build_model:2026-04-19T10:00:01.000Z',
              phase: 'modeling',
              tool: 'build_model',
              status: 'done',
              title: '结构模型已生成',
              startedAt: '2026-04-19T10:00:01.000Z',
              completedAt: '2026-04-19T10:00:02.000Z',
              durationMs: 1000,
            },
          },
          {
            type: 'phase_upsert',
            phase: {
              phaseId: 'phase:modeling',
              phase: 'modeling',
              title: '建模',
              status: 'done',
              steps: [],
            },
          },
          {
            type: 'summary_replace',
            summaryText: '模型已生成，可继续分析。',
          },
          {
            type: 'presentation_complete',
            completedAt: '2026-04-19T10:00:05.000Z',
          },
          {
            type: 'result',
            content: {
              response: '模型已生成，可继续分析。',
              success: true,
              routing: {
                selectedSkillIds: ['portal-frame'],
                structuralSkillId: 'portal-frame',
              },
              plan: ['Draft structural model'],
              toolCalls: [],
            },
          },
          {
            type: 'done',
          },
        ])
      }

      if (url.includes('/api/v1/chat/conversation') && !url.includes('/snapshot') && !url.includes('/messages')) {
        return Response.json({
          id: 'conv-presentation-test',
          title: 'Create a portal frame',
          type: 'general',
        })
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return Response.json([])
      }

      if (url.includes('/api/v1/agent/skills')) {
        return Response.json([])
      }

      if (url.includes('/api/v1/agent/capability-matrix')) {
        return Response.json({})
      }

      if (url.includes('/snapshot')) {
        return Response.json({ success: true })
      }

      if (url.includes('/messages')) {
        return Response.json({ success: true })
      }

      return Response.json({})
    })

    render(<AppStoreProvider><AIConsole /></AppStoreProvider>)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'Create a portal frame')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      const chatPanel = screen.getByTestId('console-chat-scroll')
      expect(within(chatPanel).getAllByText('模型已生成，可继续分析。').length).toBeGreaterThan(0)
      expect(within(chatPanel).queryByText(/show prompt & thinking/i)).not.toBeInTheDocument()
    })
  })

  it('renders a tool card when only a completed step event is streamed', async () => {
    const user = userEvent.setup()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          {
            type: 'presentation_init',
            presentation: {
              version: 3,
              mode: 'execution',
              status: 'streaming',
              summaryText: '',
              phases: [],
              artifacts: [],
            },
          },
          {
            type: 'step_upsert',
            phaseId: 'phase:understanding',
            step: {
              id: 'step:memory:2026-05-01T10:00:01.000Z',
              phase: 'understanding',
              tool: 'memory',
              status: 'done',
              title: 'Memory saved',
              output: '{"success":true}',
              startedAt: '2026-05-01T10:00:01.000Z',
              completedAt: '2026-05-01T10:00:02.000Z',
              durationMs: 1000,
            },
          },
          {
            type: 'done',
          },
        ])
      }

      if (url.includes('/api/v1/chat/conversation') && !url.includes('/snapshot') && !url.includes('/messages')) {
        return Response.json({
          id: 'conv-completed-tool-step-test',
          title: 'Remember project setting',
          type: 'general',
        })
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return Response.json([])
      }

      if (url.includes('/api/v1/agent/skills')) {
        return Response.json([])
      }

      if (url.includes('/api/v1/agent/capability-matrix')) {
        return Response.json({})
      }

      if (url.includes('/snapshot')) {
        return Response.json({ success: true })
      }

      if (url.includes('/messages')) {
        return Response.json({ success: true })
      }

      return Response.json({})
    })

    render(<AppStoreProvider><AIConsole /></AppStoreProvider>)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'Remember project setting')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      const chatPanel = screen.getByTestId('console-chat-scroll')
      expect(within(chatPanel).getByText('memory')).toBeInTheDocument()
      expect(within(chatPanel).getByText('{"success":true}')).toBeInTheDocument()
    })
  })

  it('prefers backend presentation when restoring a saved conversation', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('structureclaw.console.conversations', JSON.stringify({
      'conv-server': {
        id: 'conv-server',
        title: 'Portal frame restore test',
        type: 'general',
        createdAt: '2026-04-19T09:59:00.000Z',
        updatedAt: '2026-04-19T10:30:00.000Z',
        messages: [
          {
            id: 'archived-user',
            role: 'user',
            content: 'Archive user message',
            status: 'done',
            timestamp: '2026-04-19T10:00:00.000Z',
          },
          {
            id: 'archived-assistant',
            role: 'assistant',
            content: '本地缓存摘要不应成为主显示',
            status: 'done',
            timestamp: '2026-04-19T10:00:01.000Z',
          },
        ],
        modelText: '{"source":"archive"}',
        latestResult: null,
        modelVisualizationSnapshot: null,
        resultVisualizationSnapshot: null,
        visualizationSnapshot: null,
      },
    }))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url.includes('/api/v1/chat/conversations')) {
        return Response.json([
          {
            id: 'conv-server',
            title: 'Portal frame restore test',
            type: 'general',
            createdAt: '2026-04-19T09:59:00.000Z',
            updatedAt: '2026-04-19T10:05:00.000Z',
          },
        ])
      }

      if (url.includes('/api/v1/chat/conversation/conv-server?')) {
        return Response.json({
          id: 'conv-server',
          title: 'Portal frame restore test',
          type: 'general',
          createdAt: '2026-04-19T09:59:00.000Z',
          updatedAt: '2026-04-19T10:05:00.000Z',
          messages: [
            {
              id: 'backend-user',
              role: 'user',
              content: 'Backend user message',
              createdAt: '2026-04-19T10:00:00.000Z',
              metadata: {},
            },
            {
              id: 'backend-assistant',
              role: 'assistant',
              content: '后端 presentation 摘要应该恢复出来',
              createdAt: '2026-04-19T10:00:01.000Z',
              metadata: {
                presentation: {
                  version: 3,
                  mode: 'execution',
                  status: 'done',
                  summaryText: '后端 presentation 摘要应该恢复出来',
                  phases: [
                    {
                      phaseId: 'phase:understanding',
                      phase: 'understanding',
                      title: '理解需求',
                      status: 'done',
                      steps: [
                        {
                          id: 'step:build_model:2026-04-19T10:00:01.000Z',
                          phase: 'understanding',
                          tool: 'build_model',
                          status: 'done',
                          title: '参数收集完成',
                        },
                      ],
                    },
                  ],
                  artifacts: [],
                },
              },
            },
          ],
          session: {
            model: {
              nodes: [],
              elements: [],
              metadata: { source: 'backend' },
            },
          },
          snapshots: {
            latestResult: null,
            modelSnapshot: null,
            resultSnapshot: null,
          },
        })
      }

      if (url.includes('/api/v1/agent/skills')) {
        return Response.json([])
      }

      if (url.includes('/api/v1/agent/capability-matrix')) {
        return Response.json({})
      }

      return Response.json({})
    })

    render(<AppStoreProvider><AIConsole /></AppStoreProvider>)

    await user.click(await screen.findByRole('button', { name: /portal frame restore test/i }))

    await waitFor(() => {
      const chatPanel = screen.getByTestId('console-chat-scroll')
      expect(within(chatPanel).getByText('后端 presentation 摘要应该恢复出来')).toBeInTheDocument()
      expect(within(chatPanel).queryByText('本地缓存摘要不应成为主显示')).not.toBeInTheDocument()
    })
  })

  it('exposes model preview as soon as artifact payload sync arrives', async () => {
    const user = userEvent.setup()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          {
            type: 'presentation_init',
            presentation: {
              version: 3,
              mode: 'execution',
              status: 'streaming',
              summaryText: '',
              phases: [],
              artifacts: [],
            },
          },
          {
            type: 'artifact_upsert',
            artifact: {
              artifact: 'model',
              status: 'available',
              title: '结构模型',
              summary: '模型已生成，可立即预览',
              previewable: true,
              snapshotKey: 'modelSnapshot',
            },
          },
          {
            type: 'artifact_payload_sync',
            artifact: 'model',
            model: {
              nodes: [
                { id: 'N1', x: 0, y: 0, z: 0 },
                { id: 'N2', x: 6, y: 0, z: 0 },
              ],
              elements: [
                { id: 'E1', type: 'beam', nodes: ['N1', 'N2'] },
              ],
            },
          },
          {
            type: 'summary_replace',
            summaryText: '模型已生成，可立即预览。',
          },
          {
            type: 'presentation_complete',
            completedAt: '2026-04-19T10:00:05.000Z',
          },
          {
            type: 'done',
          },
        ])
      }

      if (url.includes('/api/v1/chat/conversation') && !url.includes('/snapshot') && !url.includes('/messages')) {
        return Response.json({
          id: 'conv-model-sync-test',
          title: 'Create a portal frame',
          type: 'general',
        })
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return Response.json([])
      }

      if (url.includes('/api/v1/agent/skills')) {
        return Response.json([])
      }

      if (url.includes('/api/v1/agent/capability-matrix')) {
        return Response.json({})
      }

      if (url.includes('/snapshot')) {
        return Response.json({ success: true })
      }

      if (url.includes('/messages')) {
        return Response.json({ success: true })
      }

      return Response.json({})
    })

    render(<AppStoreProvider><AIConsole /></AppStoreProvider>)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'Create a portal frame')
    await user.click(screen.getByRole('button', { name: /send/i }))
    await user.click(await screen.findByRole('button', { name: /show results/i }))
    await user.click(await screen.findByRole('tab', { name: /context/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /preview model/i })).toBeEnabled()
      expect(screen.getByDisplayValue(/"nodes": \[/)).toBeInTheDocument()
    })
  })
})
