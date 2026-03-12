import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ConsolePage from '@/app/(console)/console/page'

const mockSkills = [
  {
    id: 'beam',
    name: { en: 'Beam Helper', zh: '梁助手' },
    description: { en: 'Beam workflow', zh: '梁工作流' },
    autoLoadByDefault: true,
  },
  {
    id: 'frame',
    name: { en: 'Frame Checker', zh: '框架校核' },
    description: { en: 'Frame workflow', zh: '框架工作流' },
    autoLoadByDefault: true,
  },
] as const

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

describe('ConsolePage Integration (CONS-13)', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue(mockSkills),
        } as unknown as Response
      }

      if (url.includes('/api/v1/analysis-engines')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            engines: [
              {
                id: 'builtin-opensees',
                name: 'OpenSees Builtin',
                version: '0.1.0',
                kind: 'python',
                available: true,
                enabled: true,
                supportedAnalysisTypes: ['static', 'dynamic', 'seismic', 'nonlinear'],
              },
              {
                id: 'builtin-simplified',
                name: 'Simplified Builtin',
                version: '0.1.0',
                kind: 'python',
                available: true,
                enabled: true,
                supportedAnalysisTypes: ['static', 'dynamic', 'seismic'],
              },
            ],
          }),
        } as unknown as Response
      }

      return {
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      } as unknown as Response
    })
    window.localStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function renderConsolePage() {
    const view = render(<ConsolePage />)
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/chat/conversations'))
    })
    return view
  }

  it('renders the active AI console shell', async () => {
    await renderConsolePage()

    expect(await screen.findByRole('heading', { name: 'Structural Engineering Conversation Workspace' })).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('Analysis Results & Report')).toBeInTheDocument()
  })

  it('shows the conversational composer controls', async () => {
    await renderConsolePage()

    expect(screen.getByPlaceholderText(/Describe your structural goal/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Skills' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Engineering Context' })).toBeInTheDocument()
    expect(screen.getByText('Analysis Engine Auto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discuss First' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Analysis' })).toBeInTheDocument()
  })

  it('keeps only one engineering context expand button on first load', async () => {
    await renderConsolePage()

    expect(screen.getAllByRole('button', { name: 'Expand Engineering Context' })).toHaveLength(1)
  })

  it('keeps loaded skills collapsed by default and toggles the list', async () => {
    await renderConsolePage()

    expect(screen.queryByText('Selected skills 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Beam Helper')).not.toBeInTheDocument()
    expect(screen.queryByText('Frame Checker')).not.toBeInTheDocument()
    expect(screen.queryByText('Choose which local Markdown skills the agent may use. Keep the default selection to preserve automatic routing.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Skills' }))

    expect(screen.getByRole('button', { name: 'Collapse Skills' })).toBeInTheDocument()
    expect(screen.getByText('Choose which local Markdown skills the agent may use. Keep the default selection to preserve automatic routing.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Skills' }))

    expect(screen.getByRole('button', { name: 'Expand Skills' })).toBeInTheDocument()
    expect(screen.queryByText('Choose which local Markdown skills the agent may use. Keep the default selection to preserve automatic routing.')).not.toBeInTheDocument()
  })

  it('hides composer help in the default collapsed state', async () => {
    await renderConsolePage()

    expect(screen.queryByText('The default path is to clarify through chat first. Before running analysis, it is recommended to provide model JSON or use chat to identify missing inputs.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))

    expect(screen.getByText('The default path is to clarify through chat first. Before running analysis, it is recommended to provide model JSON or use chat to identify missing inputs.')).toBeInTheDocument()
  })

  it('loads conversation history from the backend', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue(mockSkills),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([{ id: 'conv-1', title: '历史会话标题', updatedAt: '2026-03-10T12:00:00.000Z' }]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/analysis-engines')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ engines: [] }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    await renderConsolePage()
    expect(await screen.findByText('历史会话标题')).toBeInTheDocument()
  })

  it('keeps separate scroll containers for history, chat, and output', async () => {
    const { container } = await renderConsolePage()

    expect(await screen.findByTestId('console-layout-grid')).toBeInTheDocument()
    expect(screen.getByTestId('console-history-scroll')).toBeInTheDocument()
    expect(screen.getByTestId('console-chat-scroll')).toBeInTheDocument()
    expect(screen.getByTestId('console-output-scroll')).toBeInTheDocument()
    expect(screen.getByTestId('console-composer')).toBeInTheDocument()

    const chatScroll = screen.getByTestId('console-chat-scroll')
    expect(chatScroll).not.toContainElement(screen.getByTestId('console-composer'))
    expect(container.querySelector('[data-testid="console-history-scroll"].overflow-auto')).not.toBeNull()
    expect(container.querySelector('[data-testid="console-chat-scroll"].overflow-auto')).not.toBeNull()
    expect(container.querySelector('[data-testid="console-output-scroll"].overflow-auto')).not.toBeNull()
  })

  it('renders Chinese console copy when locale is set to zh', async () => {
    window.localStorage.setItem('structureclaw.locale', 'zh')

    render(<ConsolePage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '结构工程对话工作台' })).toBeInTheDocument()
    })

    expect(screen.getByText('历史会话')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '执行分析' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开技能' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开工程上下文' })).toBeInTheDocument()
    expect(screen.getByText('计算引擎 自动选择')).toBeInTheDocument()
    expect(screen.queryByText('已选择技能')).not.toBeInTheDocument()
    expect(screen.queryByText('默认先聊天澄清需求。执行分析前建议补充模型 JSON，或先通过对话明确缺失条件。')).not.toBeInTheDocument()
  })

  it('sends the active locale with execute requests', async () => {
    window.localStorage.setItem('structureclaw.locale', 'zh')

    let executePayload: Record<string, unknown> | null = null
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/analysis-engines')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ engines: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation') && init?.method === 'POST') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-zh',
            title: '新会话',
            type: 'analysis',
            createdAt: '2026-03-12T08:00:00.000Z',
            updatedAt: '2026-03-12T08:00:00.000Z',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/execute')) {
        executePayload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            response: '已完成',
            success: true,
            report: {
              summary: '摘要',
              markdown: '# 报告',
            },
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.change(screen.getByPlaceholderText(/描述你的结构目标/i), {
      target: { value: '请分析这个模型' },
    })
    fireEvent.click(screen.getByRole('button', { name: '执行分析' }))

    await waitFor(() => {
      expect(executePayload).not.toBeNull()
    })

    expect((executePayload?.context as Record<string, unknown>)?.locale).toBe('zh')
    expect((executePayload?.context as Record<string, unknown>)?.engineId).toBeUndefined()
  })

  it('allows selecting a manual engine for execution requests', async () => {
    let executePayload: Record<string, unknown> | null = null
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue(mockSkills),
        } as unknown as Response
      }

      if (url.includes('/api/v1/analysis-engines')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            engines: [
              {
                id: 'builtin-opensees',
                name: 'OpenSees Builtin',
                version: '0.1.0',
                kind: 'python',
                available: true,
                enabled: true,
                supportedAnalysisTypes: ['static'],
              },
            ],
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation') && init?.method === 'POST') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-engine',
            title: 'OpenSees selection',
            type: 'analysis',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/execute')) {
        executePayload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            response: 'done',
            success: true,
            analysis: {
              success: true,
              meta: {
                engineName: 'OpenSees Builtin',
                engineVersion: '0.1.0',
                selectionMode: 'manual',
              },
              data: {},
            },
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    fireEvent.click(screen.getByRole('button', { name: /OpenSees Builtin v0\.1\.0/ }))
    fireEvent.change(screen.getByPlaceholderText(/Describe your structural goal|描述你的结构目标/), {
      target: { value: 'Analyze beam with OpenSees' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis|执行分析/ }))

    await waitFor(() => {
      expect((executePayload?.context as Record<string, unknown>)?.engineId).toBe('builtin-opensees')
    })
  })

  it('shows the analysis engine used for execution results', async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue(mockSkills),
        } as unknown as Response
      }

      if (url.includes('/api/v1/analysis-engines')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            engines: [
              {
                id: 'builtin-opensees',
                name: 'OpenSees Builtin',
                version: '0.1.0',
                kind: 'python',
                available: true,
                enabled: true,
              },
            ],
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation') && init?.method === 'POST') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-engine',
            title: 'Engine visibility',
            type: 'analysis',
            createdAt: '2026-03-12T08:00:00.000Z',
            updatedAt: '2026-03-12T08:00:00.000Z',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/execute')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            response: 'Analysis finished.',
            success: true,
            analysis: {
              success: true,
              meta: {
                engineId: 'builtin-simplified',
                engineName: 'StructureClaw Analysis Engine',
                engineVersion: '0.1.0',
                engineKind: 'python',
                selectionMode: 'fallback',
                fallbackFrom: 'builtin-opensees',
              },
              data: {
                summary: {
                  nodeCount: 2,
                },
              },
            },
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Analyze this model' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis|执行分析/ }))

    await waitFor(() => {
      expect(screen.getByText('StructureClaw Analysis Engine v0.1.0')).toBeInTheDocument()
    })
    expect(screen.getByText(/Fallback engine used|已使用降级引擎/)).toBeInTheDocument()
    expect(screen.getByText(/Fallback from builtin-opensees|原优先引擎 builtin-opensees/)).toBeInTheDocument()
  })

  it('renders guided discuss-first state in English', async () => {
    window.localStorage.setItem('structureclaw.locale', 'en')
    let streamPayload: Record<string, unknown> | null = null
    const interaction = {
      detectedScenario: 'steel-frame',
      detectedScenarioLabel: 'Steel Frame',
      conversationStage: 'Intent',
      missingCritical: ['Structure type (portal frame / double-span beam / beam / truss)'],
      missingOptional: ['Whether to generate a report'],
      fallbackSupportNote: '“Steel frame” has been narrowed to the portal-frame template for now.',
      recommendedNextStep: 'Fill in Structure type first.',
      questions: [{ question: 'Please confirm the structure type (portal frame / double-span beam / beam / truss).' }],
      pending: {
        criticalMissing: ['Structure type (portal frame / double-span beam / beam / truss)'],
        nonCriticalMissing: ['Whether to generate a report'],
      },
    }

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/analysis-engines')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ engines: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation') && init?.method === 'POST') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-guidance',
            title: 'Guided conversation',
            type: 'analysis',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        streamPayload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return createSseResponse([
          { type: 'interaction_update', content: interaction },
          { type: 'result', content: { response: 'Detected scenario: Steel Frame', success: true, interaction } },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Help me size a steel frame' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discuss First' }))

    await waitFor(() => {
      expect(screen.getByTestId('console-guidance-panel')).toBeInTheDocument()
    })

    expect((streamPayload?.context as Record<string, unknown>)?.locale).toBe('en')
    expect(screen.getByText('Conversation Guidance')).toBeInTheDocument()
    expect(screen.getByText('Steel Frame')).toBeInTheDocument()
    expect(screen.getByText('Fill in Structure type first.')).toBeInTheDocument()
  })

  it('renders guided discuss-first state in Chinese', async () => {
    window.localStorage.setItem('structureclaw.locale', 'zh')
    const interaction = {
      detectedScenario: 'bridge',
      detectedScenarioLabel: '桥梁',
      conversationStage: '需求识别',
      missingCritical: ['结构类型（门式刚架/双跨梁/梁/平面桁架）'],
      missingOptional: ['是否生成报告'],
      fallbackSupportNote: '当前补参链路还不直接支持桥梁专用模板；若你只想先讨论单梁主梁近似，可收敛到梁模板。',
      recommendedNextStep: '先补齐结构类型。',
      questions: [{ question: '请确认结构类型（门式刚架/双跨梁/梁/平面桁架）。' }],
      pending: {
        criticalMissing: ['结构类型（门式刚架/双跨梁/梁/平面桁架）'],
        nonCriticalMissing: ['是否生成报告'],
      },
    }

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/analysis-engines')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ engines: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation') && init?.method === 'POST') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-guidance-zh',
            title: '引导对话',
            type: 'analysis',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          { type: 'interaction_update', content: interaction },
          { type: 'result', content: { response: '识别场景：桥梁', success: true, interaction } },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '请帮我梳理桥梁参数' },
    })
    fireEvent.click(screen.getByRole('button', { name: '先聊需求' }))

    await waitFor(() => {
      expect(screen.getByTestId('console-guidance-panel')).toBeInTheDocument()
    })

    expect(screen.getByText('对话引导')).toBeInTheDocument()
    expect(screen.getByText('桥梁')).toBeInTheDocument()
    expect(screen.getByText('先补齐结构类型。')).toBeInTheDocument()
  })
})
