import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'

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

  it('renders summary and grouped phases from v2 presentation events', async () => {
    const user = userEvent.setup()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          {
            type: 'presentation_init',
            presentation: {
              version: 2,
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
              items: [],
            },
          },
          {
            type: 'timeline_item_upsert',
            phaseId: 'phase:modeling',
            item: {
              id: 'tool:draft_model:result',
              kind: 'tool_result',
              phase: 'modeling',
              tool: 'draft_model',
              status: 'done',
              title: '结构模型已生成',
            },
          },
          {
            type: 'phase_upsert',
            phase: {
              phaseId: 'phase:modeling',
              phase: 'modeling',
              title: '建模',
              status: 'done',
              items: [],
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

    render(<AIConsole />)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'Create a portal frame')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      const chatPanel = screen.getByTestId('console-chat-scroll')
      expect(within(chatPanel).getAllByText('模型已生成，可继续分析。').length).toBeGreaterThan(0)
      expect(within(chatPanel).getByText('建模')).toBeInTheDocument()
      expect(within(chatPanel).getByText('结构模型已生成')).toBeInTheDocument()
      expect(within(chatPanel).queryByText(/show prompt & thinking/i)).not.toBeInTheDocument()
    })
  })

  it('renders clarification turns with collapsed status and expandable raw reply text', async () => {
    const user = userEvent.setup()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          {
            type: 'presentation_init',
            presentation: {
              version: 2,
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
              phaseId: 'phase:understanding',
              phase: 'understanding',
              title: '理解需求',
              status: 'running',
              items: [],
            },
          },
          {
            type: 'timeline_item_upsert',
            phaseId: 'phase:understanding',
            item: {
              id: 'note:interaction-turn-1',
              kind: 'phase_start',
              phase: 'understanding',
              status: 'running',
              title: '当前处于建模信息收集中',
            },
          },
          {
            type: 'timeline_item_upsert',
            phaseId: 'phase:understanding',
            item: {
              id: 'interaction:turn-1',
              kind: 'clarification',
              phase: 'understanding',
              status: 'done',
              title: '当前需要补充参数',
              previewText: '还缺截面尺寸和材料参数',
              explanationText: '这个合成解释不应优先显示。',
              rawUserFacingText: '已记录简支梁，跨度10m，跨中集中荷载1kN。请补充梁截面尺寸和材料信息，例如截面宽高及弹性模量，以便开始分析。',
              missingCritical: ['截面尺寸', '材料参数'],
              question: '请补充梁截面尺寸和材料参数。',
            },
          },
          {
            type: 'summary_replace',
            summaryText: '已记录简支梁，跨度10m，跨中集中荷载1kN。请补充梁截面尺寸和材料信息，例如截面宽高及弹性模量，以便开始分析。',
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
          id: 'conv-clarification-test',
          title: 'Design a simply supported beam',
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

    render(<AIConsole />)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'Design a simply supported beam')
    await user.click(screen.getByRole('button', { name: /send/i }))

    const chatPanel = await screen.findByTestId('console-chat-scroll')
    expect(within(chatPanel).getByText('还缺截面尺寸和材料参数')).toBeInTheDocument()
    expect(within(chatPanel).queryByText('这个合成解释不应优先显示。')).not.toBeInTheDocument()

    const detailToggles = within(chatPanel).getAllByText(/show details/i)
    await user.click(detailToggles[0])

    await waitFor(() => {
      expect(
        within(chatPanel).getAllByText(
          '已记录简支梁，跨度10m，跨中集中荷载1kN。请补充梁截面尺寸和材料信息，例如截面宽高及弹性模量，以便开始分析。',
        ).length,
      ).toBeGreaterThan(0)
      expect(within(chatPanel).queryByText('这个合成解释不应优先显示。')).not.toBeInTheDocument()
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
                  version: 2,
                  mode: 'execution',
                  status: 'done',
                  summaryText: '后端 presentation 摘要应该恢复出来',
                  phases: [
                    {
                      phaseId: 'phase:understanding',
                      phase: 'understanding',
                      title: '理解需求',
                      status: 'done',
                      items: [
                        {
                          id: 'interaction:restore',
                          kind: 'clarification',
                          phase: 'understanding',
                          status: 'done',
                          title: '当前需要补充参数',
                          previewText: '还缺截面尺寸和材料参数',
                          rawUserFacingText: '后端恢复时应该优先看到这一段原始回复。',
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

    render(<AIConsole />)

    await user.click(await screen.findByRole('button', { name: /portal frame restore test/i }))

    await waitFor(() => {
      const chatPanel = screen.getByTestId('console-chat-scroll')
      expect(within(chatPanel).getByText('后端 presentation 摘要应该恢复出来')).toBeInTheDocument()
      expect(within(chatPanel).queryByText('本地缓存摘要不应成为主显示')).not.toBeInTheDocument()
      expect(within(chatPanel).getByText('还缺截面尺寸和材料参数')).toBeInTheDocument()
    })

    const chatPanel = screen.getByTestId('console-chat-scroll')
    await user.click(within(chatPanel).getByText(/show details/i))

    await waitFor(() => {
      expect(within(chatPanel).getByText('后端恢复时应该优先看到这一段原始回复。')).toBeInTheDocument()
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
              version: 2,
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

    render(<AIConsole />)

    await user.click(screen.getByRole('button', { name: /expand engineering context/i }))
    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'Create a portal frame')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /preview model/i })).toBeEnabled()
      expect(screen.getByDisplayValue(/"nodes": \[/)).toBeInTheDocument()
    })
  })
})
