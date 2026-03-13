import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ConsolePage from '@/app/(console)/console/page'
import type { VisualizationSnapshot } from '@/components/visualization'

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

const sampleModelJson = JSON.stringify({
  schema_version: '1.0.0',
  nodes: [
    { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
    { id: '2', x: 6, y: 0, z: 0 },
  ],
  elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
  materials: [{ id: 'M1', name: 'Steel', E: 200000, nu: 0.3, rho: 7850 }],
  sections: [{ id: 'S1', area: 1 }],
  load_cases: [{ id: 'D', type: 'dead', loads: [{ node: '2', fy: -10 }] }],
})

const sampleAnalysisResult = {
  response: 'Analysis finished.',
  success: true,
  analysis: {
    success: true,
    meta: {
      analysisType: 'static',
      engineName: 'StructureClaw Analysis Engine',
      engineVersion: '0.1.0',
      selectionMode: 'auto',
    },
    data: {
      summary: {
        nodeCount: 2,
        elementCount: 1,
      },
      displacements: {
        '1': { ux: 0, uy: 0, uz: 0 },
        '2': { ux: 0.012, uy: 0, uz: -0.032 },
      },
      reactions: {
        '1': { fx: 0, fy: 10, fz: 0 },
      },
      forces: {
        E1: { axial: 0, n1: { M: 20, V: 10 }, n2: { M: 0, V: 10 } },
      },
      caseResults: {
        D: {
          displacements: {
            '2': { ux: 0.012, uz: -0.032 },
          },
          reactions: {
            '1': { fy: 10 },
          },
          forces: {
            E1: { axial: 0, n1: { M: 20, V: 10 }, n2: { M: 0, V: 10 } },
          },
          envelope: {
            controlNodeDisplacement: '2',
          },
        },
      },
      envelopeTables: {
        nodeDisplacement: {
          '2': { maxAbsDisplacement: 0.032, controlCase: 'D' },
        },
        elementForce: {
          E1: { maxAbsMoment: 20, controlCaseMoment: 'D' },
        },
      },
    },
  },
}

const archivedVisualizationSnapshot: VisualizationSnapshot = {
  version: 1,
  title: 'Archived Beam',
  source: 'result',
  dimension: 2,
  plane: 'xz',
  availableViews: ['model', 'deformed', 'forces', 'reactions'],
  defaultCaseId: 'result',
  nodes: [
    { id: '1', position: { x: 0, y: 0, z: 0 }, restraints: [true, true, true, true, true, true] },
    { id: '2', position: { x: 6, y: 0, z: 0 } },
  ],
  elements: [
    { id: 'E1', type: 'beam', nodeIds: ['1', '2'], material: 'M1', section: 'S1' },
  ],
  loads: [{ nodeId: '2', caseId: 'D', vector: { x: 0, y: -10, z: 0 } }],
  unsupportedElementTypes: [],
  cases: [
    {
      id: 'result',
      label: 'Result',
      kind: 'result',
      nodeResults: {
        '2': { displacement: { ux: 0.012, uz: -0.032 } },
      },
      elementResults: {
        E1: { moment: 20, shear: 10 },
      },
    },
  ],
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
                available: false,
                enabled: true,
                status: 'unavailable',
                unavailableReason: 'OpenSees runtime is unavailable',
                supportedAnalysisTypes: ['static', 'dynamic', 'seismic', 'nonlinear'],
                supportedModelFamilies: ['frame', 'truss', 'generic'],
              },
              {
                id: 'builtin-simplified',
                name: 'Simplified Builtin',
                version: '0.1.0',
                kind: 'python',
                available: true,
                enabled: true,
                status: 'available',
                supportedAnalysisTypes: ['static', 'dynamic', 'seismic'],
                supportedModelFamilies: ['frame', 'truss', 'generic'],
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

  it('keeps the last valid model preview available when model json becomes invalid', async () => {
    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))

    const modelInput = screen.getByPlaceholderText(/Paste StructureModel v1 JSON here|将 StructureModel v1 JSON 粘贴到这里/)
    fireEvent.change(modelInput, { target: { value: sampleModelJson } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Preview Model|预览模型/ })).toBeEnabled()
    })

    fireEvent.change(modelInput, { target: { value: '{"schema_version":' } })

    expect(screen.getByText(/Model JSON parse failed|模型 JSON 解析失败/)).toBeInTheDocument()
    expect(screen.getByText(/Model JSON is invalid. The last valid preview is still available.|模型 JSON 无效，但仍可查看上一次有效预览。/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview Model|预览模型/ })).toBeEnabled()
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

    expect(screen.queryByText('The default path is to clarify through chat first. Before running analysis, it is recommended to provide model JSON or use chat to identify missing inputs.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Expand Analysis Settings|展开分析设置/ }))

    expect(screen.getByText('The default path is to clarify through chat first. Before running analysis, it is recommended to provide model JSON or use chat to identify missing inputs.')).toBeInTheDocument()
  })

  it('groups model analysis and engine settings inside the single engineering context panel', async () => {
    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))

    expect(screen.getAllByText(/^Model$|^模型$/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^Analysis Settings$|^分析设置$/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^Execution Engine$|^执行引擎$/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Design Code$|^设计规范$/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Expand Analysis Settings|展开分析设置/ }))

    expect(screen.getAllByText(/^Design Code$|^设计规范$/).length).toBeGreaterThan(0)
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
                status: 'available',
                supportedAnalysisTypes: ['static'],
                supportedModelFamilies: ['frame', 'generic'],
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
    fireEvent.click(screen.getByRole('button', { name: /Expand Engine Settings|展开引擎设置/ }))
    fireEvent.click(screen.getByRole('button', { name: /Change Engine|更换引擎/ }))
    fireEvent.click(screen.getByRole('button', { name: /OpenSees Builtin v0\.1\.0/ }))
    fireEvent.change(screen.getByPlaceholderText(/Describe your structural goal|描述你的结构目标/), {
      target: { value: 'Analyze beam with OpenSees' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis|执行分析/ }))

    await waitFor(() => {
      expect((executePayload?.context as Record<string, unknown>)?.engineId).toBe('builtin-opensees')
    })
  })

  it('shows unavailable engines but disables them in the selector', async () => {
    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    fireEvent.click(screen.getByRole('button', { name: /Expand Engine Settings|展开引擎设置/ }))
    fireEvent.click(screen.getByRole('button', { name: /Change Engine|更换引擎/ }))

    const unavailableButton = screen.getByRole('button', { name: /OpenSees Builtin v0\.1\.0/i })
    expect(unavailableButton).toBeDisabled()
    expect(screen.getByText(/OpenSees runtime is unavailable|未检测到 OpenSees 运行时/)).toBeInTheDocument()
    expect(screen.getByText(/Unavailable|不可用/)).toBeInTheDocument()
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
                status: 'available',
                supportedModelFamilies: ['frame', 'generic'],
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
                unavailableReason: 'OpenSees runtime is unavailable',
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

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    fireEvent.click(screen.getByRole('button', { name: /Expand Engine Settings|展开引擎设置/ }))
    fireEvent.click(screen.getByRole('button', { name: /Change Engine|更换引擎/ }))
    fireEvent.click(screen.getByRole('button', { name: /OpenSees Builtin v0\.1\.0/i }))
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Analyze this model' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis|执行分析/ }))

    await waitFor(() => {
      expect(screen.getByText('StructureClaw Analysis Engine v0.1.0')).toBeInTheDocument()
    })
    expect(screen.getByText(/Fallback engine used|已使用降级引擎/)).toBeInTheDocument()
    expect(screen.getByText(/Fallback from builtin-opensees|原优先引擎 builtin-opensees/)).toBeInTheDocument()
    expect(screen.getByText(/Requested engine builtin-opensees|请求引擎 builtin-opensees/)).toBeInTheDocument()
    expect(screen.getByText(/Actual engine builtin-simplified|实际引擎 builtin-simplified/)).toBeInTheDocument()
  })

  it('does not show an engine manager action on the conversation page', async () => {
    await renderConsolePage()

    expect(screen.queryByRole('button', { name: /Manage Engines|管理引擎/ })).not.toBeInTheDocument()
  })

  it('keeps extra engines collapsed by default and reveals them on demand', async () => {
    const { container } = await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))

    expect(screen.getByRole('button', { name: /Expand Analysis Settings|展开分析设置/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Expand Engine Settings|展开引擎设置/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /OpenSees Builtin v0\.1\.0/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Simplified Builtin v0\.1\.0/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Design Code|设计规范/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Expand Analysis Settings|展开分析设置/ }))
    expect(screen.getByRole('button', { name: /Collapse Analysis Settings|收起分析设置/ })).toBeInTheDocument()
    expect(screen.getByText(/Design Code|设计规范/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engine Settings|展开引擎设置/ }))
    expect(screen.getByRole('button', { name: /Change Engine|更换引擎/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Change Engine|更换引擎/ }))

    expect(screen.getByRole('button', { name: /Collapse Engine List|收起引擎列表/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /OpenSees Builtin v0\.1\.0/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Simplified Builtin v0\.1\.0/i })).toBeInTheDocument()
    expect(container.querySelector('[data-testid="engine-candidate-list"].max-h-56.overflow-y-auto')).not.toBeNull()
  })

  it('keeps the selected manual engine visible after collapsing more engines', async () => {
    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    fireEvent.click(screen.getByRole('button', { name: /Expand Engine Settings|展开引擎设置/ }))
    fireEvent.click(screen.getByRole('button', { name: /Change Engine|更换引擎/ }))
    fireEvent.click(screen.getByRole('button', { name: /Simplified Builtin v0\.1\.0/i }))

    expect(screen.getByText(/Current engine|当前引擎/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Collapse Engine List|收起引擎列表/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Collapse Engine List|收起引擎列表/ }))

    expect(screen.getByText(/Simplified Builtin v0\.1\.0/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /OpenSees Builtin v0\.1\.0/i })).not.toBeInTheDocument()
  })

  it('renders the more-engines controls in Chinese', async () => {
    window.localStorage.setItem('structureclaw.locale', 'zh')

    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: '展开工程上下文' }))
    expect(screen.getByRole('button', { name: '展开引擎设置' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '展开引擎设置' }))
    expect(screen.getByRole('button', { name: '更换引擎' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更换引擎' }))

    expect(screen.getByRole('button', { name: '收起引擎列表' })).toBeInTheDocument()
    expect(screen.getByText('可选引擎')).toBeInTheDocument()
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

  it('synchronizes model json from a ready chat result', async () => {
    window.localStorage.setItem('structureclaw.locale', 'en')
    const synchronizedModel = {
      schema_version: '1.0.0',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: 3, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
      materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
      sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001, Iz: 0.0001, J: 0.0001, G: 79000 } }],
      load_cases: [{ id: 'LC1', type: 'other', loads: [{ node: '2', fy: -10 }] }],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
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
            id: 'conv-sync-model',
            title: 'Sync model',
            type: 'analysis',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          {
            type: 'result',
            content: {
              response: 'The draft model is ready.',
              success: true,
              model: synchronizedModel,
              interaction: { state: 'ready', pending: { criticalMissing: [], nonCriticalMissing: [] } },
            },
          },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    const modelInput = screen.getByPlaceholderText(/Paste StructureModel v1 JSON here|将 StructureModel v1 JSON 粘贴到这里/)
    fireEvent.change(modelInput, { target: { value: '{"schema_version":' } })
    fireEvent.change(screen.getByPlaceholderText(/Describe your structural goal|描述你的结构目标/), {
      target: { value: 'Please draft a beam model' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discuss First' }))

    await waitFor(() => {
      expect(screen.getByText('Model JSON was synchronized from the conversation draft.')).toBeInTheDocument()
    })

    expect((modelInput as HTMLTextAreaElement).value).toContain('"schema_version": "1.0.0"')
    expect((modelInput as HTMLTextAreaElement).value).toContain('"nodes"')
    expect(screen.queryByText(/Model JSON parse failed|模型 JSON 解析失败/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview Model|预览模型/ })).toBeEnabled()
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

  it('opens the structural visualization modal after a successful execute run with model JSON', async () => {
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
            id: 'conv-visual',
            title: 'Visualization run',
            type: 'analysis',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/execute')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue(sampleAnalysisResult),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    fireEvent.change(screen.getByPlaceholderText(/Paste StructureModel v1 JSON here|将 StructureModel v1 JSON 粘贴到这里/), {
      target: { value: sampleModelJson },
    })
    fireEvent.change(screen.getByPlaceholderText(/Describe your structural goal|描述你的结构目标/), {
      target: { value: 'Analyze and visualize this beam' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis|执行分析/ }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open Visualization|打开可视化/ })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Open Visualization|打开可视化/ }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByText(/Structural Visualization|结构可视化/).length).toBeGreaterThan(0)
    expect(
      within(dialog).queryByTestId('visualization-modal-scene') || within(dialog).queryByTestId('visualization-scene-fallback')
    ).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('disables the visualization action when a restored result has no model snapshot', async () => {
    window.localStorage.setItem(
      'structureclaw.console.conversations',
      JSON.stringify({
        'conv-no-snapshot': {
          id: 'conv-no-snapshot',
          title: 'No Snapshot',
          type: 'analysis',
          createdAt: '2026-03-12T08:00:00.000Z',
          updatedAt: '2026-03-12T08:00:00.000Z',
          messages: [{ id: 'assistant-1', role: 'assistant', content: 'done', status: 'done', timestamp: '2026-03-12T08:00:00.000Z' }],
          latestResult: sampleAnalysisResult,
          visualizationSnapshot: null,
        },
      })
    )

    vi.mocked(fetch).mockImplementation(async (input) => {
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
          json: vi.fn().mockResolvedValue({ engines: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([{ id: 'conv-no-snapshot', title: 'No Snapshot', updatedAt: '2026-03-12T08:00:00.000Z' }]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-no-snapshot')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ messages: [] }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(await screen.findByText('No Snapshot'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open Visualization|打开可视化/ })).toBeDisabled()
    })
    expect(screen.getByText(/The current result is missing a model snapshot.|当前结果缺少模型快照。/)).toBeInTheDocument()
  })

  it('restores a persisted visualization snapshot from conversation archive', async () => {
    window.localStorage.setItem(
      'structureclaw.console.conversations',
      JSON.stringify({
        'conv-archived-visual': {
          id: 'conv-archived-visual',
          title: 'Archived Visual',
          type: 'analysis',
          createdAt: '2026-03-12T08:00:00.000Z',
          updatedAt: '2026-03-12T08:00:00.000Z',
          messages: [{ id: 'assistant-1', role: 'assistant', content: 'done', status: 'done', timestamp: '2026-03-12T08:00:00.000Z' }],
          latestResult: sampleAnalysisResult,
          resultVisualizationSnapshot: archivedVisualizationSnapshot,
        },
      })
    )

    vi.mocked(fetch).mockImplementation(async (input) => {
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
          json: vi.fn().mockResolvedValue({ engines: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([{ id: 'conv-archived-visual', title: 'Archived Visual', updatedAt: '2026-03-12T08:00:00.000Z' }]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-archived-visual')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ messages: [] }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(await screen.findByText('Archived Visual'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open Visualization|打开可视化/ })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Open Visualization|打开可视化/ }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(screen.getByText('Archived Beam')).toBeInTheDocument()
  })
})
