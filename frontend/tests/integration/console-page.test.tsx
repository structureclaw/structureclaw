import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ConsolePage from '../../src/app/(console)/console/page'
import type { VisualizationSnapshot } from '../../src/components/visualization'
import { CAPABILITY_PREFERENCE_STORAGE_KEY } from '@/lib/capability-preference'
import { clearLocaleCookie, LOCALE_STORAGE_KEY, normalizeLocale } from '@/lib/locale-preference'
import { AppStoreProvider } from '@/lib/stores/context'
import type { AppLocale } from '@/lib/stores/slices/preferences'

const mockSkills = [
  {
    id: 'generic',
    name: { en: 'Generic Structure Type', zh: '通用结构类型' },
    description: { en: 'Generic structure workflow', zh: '通用结构工作流' },
    autoLoadByDefault: true,
  },
  {
    id: 'opensees-static',
    name: { en: 'OpenSees Static Analysis', zh: 'OpenSees 静力分析' },
    description: { en: 'OpenSees static workflow', zh: 'OpenSees 静力分析工作流' },
    autoLoadByDefault: true,
  },
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
  {
    id: 'code-check-gb50017',
    name: { en: 'Code Check GB50017', zh: '规范校核 GB50017' },
    description: { en: 'GB50017 code check', zh: 'GB50017 规范校核' },
    autoLoadByDefault: false,
  },
] as const

const sampleModelJson = JSON.stringify({
  schema_version: '1.0.0',
  metadata: {
    coordinateSemantics: 'global-z-up',
    frameDimension: '2d',
    inferredType: 'frame',
  },
  nodes: [
    { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
    { id: '2', x: 6, y: 0, z: 0 },
  ],
  elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
  materials: [{ id: 'M1', name: 'Steel', E: 200000, nu: 0.3, rho: 7850 }],
  sections: [{ id: 'S1', area: 1 }],
  load_cases: [{ id: 'D', type: 'dead', loads: [{ node: '2', fz: -10 }] }],
})

const sampleAnalysisResult = {
  response: 'Analysis finished.',
  success: true,
  model: JSON.parse(sampleModelJson),
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
        '1': { fx: 0, fy: 0, fz: 10 },
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
            '1': { fz: 10 },
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
  coordinateSemantics: 'global-z-up',
  availableViews: ['model', 'deformed', 'forces', 'reactions'],
  defaultCaseId: 'result',
  nodes: [
    { id: '1', position: { x: 0, y: 0, z: 0 }, restraints: [true, true, true, true, true, true] },
    { id: '2', position: { x: 6, y: 0, z: 0 } },
  ],
  elements: [
    { id: 'E1', type: 'beam', nodeIds: ['1', '2'], material: 'M1', section: 'S1' },
  ],
  loads: [{ nodeId: '2', caseId: 'D', vector: { x: 0, y: 0, z: -10 } }],
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

const archivedResult = {
  ...sampleAnalysisResult,
  report: {
    summary: 'Archived summary',
    markdown: '# Archived report',
  },
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

function mockConsoleSupportRequest(url: string) {
  if (url.includes('/api/v1/agent/capability-matrix')) {
    return {
      ok: true,
      json: vi.fn().mockResolvedValue({
        skills: [
          { id: 'generic', domain: 'structure-type' },
          { id: 'opensees-static', domain: 'analysis' },
          { id: 'beam', domain: 'structure-type' },
          { id: 'frame', domain: 'structure-type' },
          { id: 'code-check-gb50017', domain: 'code-check' },
        ],
        tools: [
          { id: 'draft_model', category: 'modeling' },
          { id: 'update_model', category: 'modeling' },
          { id: 'validate_model', category: 'modeling' },
          { id: 'run_analysis', category: 'analysis' },
          { id: 'run_code_check', category: 'checking' },
          { id: 'generate_report', category: 'reporting' },
        ],
        skillDomainById: {
          generic: 'structure-type',
          'opensees-static': 'analysis',
          beam: 'structure-type',
          frame: 'structure-type',
          'code-check-gb50017': 'code-check',
        },
        domainSummaries: [
          { domain: 'structure-type', skillIds: ['generic', 'beam', 'frame'] },
          { domain: 'analysis', skillIds: ['opensees-static'] },
          { domain: 'code-check', skillIds: ['code-check-gb50017'] },
        ],
      }),
    } as unknown as Response
  }

  if (url.includes('/api/v1/agent/skillhub/search')) {
    return {
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as Response
  }

  if (url.includes('/api/v1/agent/skillhub/installed')) {
    return {
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as Response
  }

  if (url.includes('/api/v1/models/latest')) {
    return {
      ok: true,
      json: vi.fn().mockResolvedValue({ model: null }),
    } as unknown as Response
  }

  return null
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

      if (url.includes('/api/v1/agent/capability-matrix')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            skills: [
              { id: 'generic', domain: 'structure-type' },
              { id: 'opensees-static', domain: 'analysis' },
              { id: 'beam', domain: 'structure-type' },
              { id: 'frame', domain: 'structure-type' },
              { id: 'code-check-gb50017', domain: 'code-check' },
            ],
            tools: [
              { id: 'draft_model', category: 'modeling' },
              { id: 'update_model', category: 'modeling' },
              { id: 'validate_model', category: 'modeling' },
              { id: 'run_analysis', category: 'analysis' },
              { id: 'run_code_check', category: 'checking' },
              { id: 'generate_report', category: 'reporting' },
            ],
            skillDomainById: {
              generic: 'structure-type',
              'opensees-static': 'analysis',
              beam: 'structure-type',
              frame: 'structure-type',
              'code-check-gb50017': 'code-check',
            },
            domainSummaries: [
              { domain: 'structure-type', skillIds: ['generic', 'beam', 'frame'] },
              { domain: 'analysis', skillIds: ['opensees-static'] },
              { domain: 'code-check', skillIds: ['code-check-gb50017'] },
            ],
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/agent/skillhub/search')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ items: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/agent/skillhub/installed')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ items: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/models/latest')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ model: null }),
        } as unknown as Response
      }

      return {
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      } as unknown as Response
    })
    window.localStorage.clear()
    clearLocaleCookie()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function renderConsolePage() {
    const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY))
    const initialLocale: AppLocale = stored ?? 'en'
    const view = render(
      <AppStoreProvider initialState={{ locale: initialLocale }}>
        <ConsolePage />
      </AppStoreProvider>,
    )
    await waitFor(() => {
      expect(
        vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/v1/chat/conversations')),
      ).toBe(true)
    })
    return view
  }

  function setCapabilityPreferences(skillIds: string[], toolIds: string[] = ['draft_model', 'update_model', 'validate_model', 'run_analysis', 'run_code_check', 'generate_report']) {
    window.localStorage.setItem(
      CAPABILITY_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        skillIds,
        toolIds,
      })
    )
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
    expect(screen.getByRole('link', { name: 'Manage Capabilities' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Engineering Context' })).toBeInTheDocument()
    expect(screen.getByText('Database tools')).toBeInTheDocument()
    expect(screen.getByText(/Review SQLite file health/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.queryByText('Analysis Engine Auto')).not.toBeInTheDocument()
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

  it('shows a compact capability summary and a link to the settings page', async () => {
    await renderConsolePage()

    expect(screen.getByText('Current capabilities')).toBeInTheDocument()
    expect(screen.getByText('Capability selection moved into a dedicated settings page so the chat workspace stays focused on conversation and results.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage Capabilities' })).toHaveAttribute('href', '/console/capabilities')
    expect(screen.queryByText('Beam Helper')).not.toBeInTheDocument()
    expect(screen.queryByText('Frame Checker')).not.toBeInTheDocument()
  })

  it('removes the old in-page skill picker from the console surface', async () => {
    await renderConsolePage()

    expect(screen.queryByRole('button', { name: /Expand Skills|展开技能/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Choose which built-in skills the model may use for engineering understanding and guidance. Checked skills stay in the callable list; unchecked skills are excluded.')).not.toBeInTheDocument()
  })

  it('keeps only the model section inside the engineering context panel', async () => {
    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))

    expect(screen.getAllByText(/^Model$|^模型$/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Analysis Settings$|^分析设置$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Execution Engine$|^执行引擎$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Design Code$|^设计规范$/)).not.toBeInTheDocument()
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

  it('shows conversation-list timeout when the backend request hangs', async () => {
    vi.useFakeTimers()

    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue(mockSkills),
        } as unknown as Response)
      }

      if (url.includes('/api/v1/analysis-engines')) {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({ engines: [] }),
        } as unknown as Response)
      }

      if (url.includes('/api/v1/models/latest')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as unknown as Response)
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal
          if (signal) {
            signal.addEventListener(
              'abort',
              () => {
                reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
              },
              { once: true }
            )
          }
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    render(<ConsolePage />)

    expect(screen.getByText(/Loading conversation list|正在加载会话列表/)).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000)
    })

    expect(screen.getByText(/Loading the conversation list timed out|加载会话列表超时/)).toBeInTheDocument()
  })

  it('restores model context and local result snapshots when selecting a conversation', async () => {
    window.localStorage.setItem('structureclaw.console.conversations', JSON.stringify({
      'conv-ctx': {
        id: 'conv-ctx',
        title: 'Stored conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T09:00:00.000Z',
        messages: [
          { id: 'welcome', role: 'assistant', content: 'welcome', status: 'done', timestamp: '2026-03-12T08:00:00.000Z' },
        ],
        modelText: sampleModelJson,
        analysisType: 'nonlinear',
        selectedSkillIds: ['frame'],
        selectedEngineId: 'builtin-simplified',
        modelSyncMessage: 'Model JSON was synchronized from the conversation draft.',
        activePanel: 'report',
        latestResult: archivedResult,
        modelVisualizationSnapshot: {
          ...archivedVisualizationSnapshot,
          source: 'model',
          availableViews: ['model'],
          defaultCaseId: 'model',
          cases: [{ ...archivedVisualizationSnapshot.cases[0], id: 'model', kind: 'model', label: 'Model' }],
        },
        resultVisualizationSnapshot: archivedVisualizationSnapshot,
      },
    }))

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
          json: vi.fn().mockResolvedValue([{ id: 'conv-ctx', title: 'Stored conversation', updatedAt: '2026-03-12T09:00:00.000Z' }]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-ctx')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-ctx',
            title: 'Stored conversation',
            messages: [
              { id: 'srv-1', role: 'user', content: 'backend user', createdAt: '2026-03-12T08:00:00.000Z' },
              { id: 'srv-2', role: 'assistant', content: 'backend assistant', createdAt: '2026-03-12T08:01:00.000Z' },
            ],
            session: {
              resolved: {
                analysisType: 'nonlinear',
                designCode: 'GB50017',
              },
              model: JSON.parse(sampleModelJson),
            },
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(await screen.findByRole('button', { name: /Stored conversation/ }))

    await waitFor(() => {
      expect(screen.getByText('backend assistant')).toBeInTheDocument()
    })
    expect(within(screen.getByTestId('console-chat-panel')).queryByText('welcome')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))

    const modelInput = screen.getByPlaceholderText(/Paste StructureModel v1 JSON here|将 StructureModel v1 JSON 粘贴到这里/) as HTMLTextAreaElement
    expect(modelInput.value).toContain('"schema_version": "1.0.0"')
    expect(screen.queryByText(/^Design Code$|^设计规范$/)).not.toBeInTheDocument()
    expect(screen.getByText('Archived summary')).toBeInTheDocument()
  })

  it('clears prior conversation context when starting a new conversation', async () => {
    window.localStorage.setItem('structureclaw.console.conversations', JSON.stringify({
      'conv-reset': {
        id: 'conv-reset',
        title: 'Reset conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T09:00:00.000Z',
        messages: [
          { id: 'm1', role: 'assistant', content: 'saved assistant', status: 'done', timestamp: '2026-03-12T08:00:00.000Z' },
        ],
        modelText: sampleModelJson,
        analysisType: 'nonlinear',
        selectedSkillIds: ['frame'],
        selectedEngineId: 'builtin-simplified',
        activePanel: 'report',
        latestResult: archivedResult,
      },
    }))

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
          json: vi.fn().mockResolvedValue([{ id: 'conv-reset', title: 'Reset conversation', updatedAt: '2026-03-12T09:00:00.000Z' }]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-reset')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-reset',
            title: 'Reset conversation',
            messages: [
              { id: 'srv-1', role: 'assistant', content: 'saved assistant', createdAt: '2026-03-12T08:00:00.000Z' },
            ],
            session: {
              resolved: {
                analysisType: 'nonlinear',
                designCode: 'GB50017',
              },
              model: JSON.parse(sampleModelJson),
            },
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(await screen.findByRole('button', { name: /Reset conversation/ }))
    await waitFor(() => {
      expect(screen.getByText('saved assistant')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /New Conversation|新建对话/ }))
    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))

    const modelInput = screen.getByPlaceholderText(/Paste StructureModel v1 JSON here|将 StructureModel v1 JSON 粘贴到这里/) as HTMLTextAreaElement
    expect(modelInput.value).toBe('')
    expect(screen.queryByText('Archived summary')).not.toBeInTheDocument()
    expect(screen.queryByText(/Analysis Engine Auto|计算引擎 自动选择/)).not.toBeInTheDocument()
  })

  it('keeps conversation order stable when selecting a history item without a new round', async () => {
    window.localStorage.setItem('structureclaw.console.conversations', JSON.stringify({
      'conv-newer': {
        id: 'conv-newer',
        title: 'Newer conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T10:00:00.000Z',
        messages: [{ id: 'm1', role: 'assistant', content: 'newer local', status: 'done', timestamp: '2026-03-12T10:00:00.000Z' }],
      },
      'conv-older': {
        id: 'conv-older',
        title: 'Older conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T09:00:00.000Z',
        messages: [{ id: 'm2', role: 'assistant', content: 'older local', status: 'done', timestamp: '2026-03-12T09:00:00.000Z' }],
      },
    }))

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return { ok: true, json: vi.fn().mockResolvedValue(mockSkills) } as unknown as Response
      }
      if (url.includes('/api/v1/analysis-engines')) {
        return { ok: true, json: vi.fn().mockResolvedValue({ engines: [] }) } as unknown as Response
      }
      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([
            { id: 'conv-newer', title: 'Newer conversation', updatedAt: '2026-03-12T10:00:00.000Z' },
            { id: 'conv-older', title: 'Older conversation', updatedAt: '2026-03-12T09:00:00.000Z' },
          ]),
        } as unknown as Response
      }
      if (url.includes('/api/v1/chat/conversation/conv-older') && !init?.method) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-older',
            title: 'Older conversation',
            messages: [{ id: 'srv-older', role: 'assistant', content: 'older backend', createdAt: '2026-03-12T09:00:00.000Z' }],
            session: null,
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    const titleButtonsBefore = screen.getAllByRole('button').filter((button) => (
      button.textContent?.includes('Newer conversation') || button.textContent?.includes('Older conversation')
    ))
    expect(titleButtonsBefore[0]).toHaveTextContent('Newer conversation')
    expect(titleButtonsBefore[1]).toHaveTextContent('Older conversation')

    fireEvent.click(screen.getByRole('button', { name: /Older conversation/ }))
    await waitFor(() => {
      expect(screen.getByText('older backend')).toBeInTheDocument()
    })

    const titleButtonsAfter = screen.getAllByRole('button').filter((button) => (
      button.textContent?.includes('Newer conversation') || button.textContent?.includes('Older conversation')
    ))
    expect(titleButtonsAfter[0]).toHaveTextContent('Newer conversation')
    expect(titleButtonsAfter[1]).toHaveTextContent('Older conversation')
  })

  it('keeps conversation order stable when only context fields change', async () => {
    window.localStorage.setItem('structureclaw.console.conversations', JSON.stringify({
      'conv-context': {
        id: 'conv-context',
        title: 'Context conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T09:00:00.000Z',
        messages: [{ id: 'm1', role: 'assistant', content: 'context local', status: 'done', timestamp: '2026-03-12T09:00:00.000Z' }],
      },
      'conv-top': {
        id: 'conv-top',
        title: 'Top conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T10:00:00.000Z',
        messages: [{ id: 'm2', role: 'assistant', content: 'top local', status: 'done', timestamp: '2026-03-12T10:00:00.000Z' }],
      },
    }))

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return { ok: true, json: vi.fn().mockResolvedValue(mockSkills) } as unknown as Response
      }
      if (url.includes('/api/v1/analysis-engines')) {
        return { ok: true, json: vi.fn().mockResolvedValue({ engines: [] }) } as unknown as Response
      }
      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([
            { id: 'conv-top', title: 'Top conversation', updatedAt: '2026-03-12T10:00:00.000Z' },
            { id: 'conv-context', title: 'Context conversation', updatedAt: '2026-03-12T09:00:00.000Z' },
          ]),
        } as unknown as Response
      }
      if (url.includes('/api/v1/chat/conversation/conv-context') && !init?.method) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-context',
            title: 'Context conversation',
            messages: [{ id: 'srv-context', role: 'assistant', content: 'context backend', createdAt: '2026-03-12T09:00:00.000Z' }],
            session: null,
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(screen.getByRole('button', { name: /Context conversation/ }))
    await waitFor(() => {
      expect(screen.getByText('context backend')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    const modelInput = screen.getByPlaceholderText(/Paste StructureModel v1 JSON here|将 StructureModel v1 JSON 粘贴到这里/) as HTMLTextAreaElement
    fireEvent.change(modelInput, { target: { value: sampleModelJson } })

    const titleButtons = screen.getAllByRole('button').filter((button) => (
      button.textContent?.includes('Top conversation') || button.textContent?.includes('Context conversation')
    ))
    expect(titleButtons[0]).toHaveTextContent('Top conversation')
    expect(titleButtons[1]).toHaveTextContent('Context conversation')
  })

  it('moves the active conversation to the top only after a completed new chat round', async () => {
    window.localStorage.setItem('structureclaw.console.conversations', JSON.stringify({
      'conv-active-round': {
        id: 'conv-active-round',
        title: 'Round conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T09:00:00.000Z',
        messages: [{ id: 'm1', role: 'assistant', content: 'round local', status: 'done', timestamp: '2026-03-12T09:00:00.000Z' }],
      },
      'conv-top-round': {
        id: 'conv-top-round',
        title: 'Top round conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T10:00:00.000Z',
        messages: [{ id: 'm2', role: 'assistant', content: 'top local', status: 'done', timestamp: '2026-03-12T10:00:00.000Z' }],
      },
    }))

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return { ok: true, json: vi.fn().mockResolvedValue(mockSkills) } as unknown as Response
      }
      if (url.includes('/api/v1/analysis-engines')) {
        return { ok: true, json: vi.fn().mockResolvedValue({ engines: [] }) } as unknown as Response
      }
      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([
            { id: 'conv-top-round', title: 'Top round conversation', updatedAt: '2026-03-12T10:00:00.000Z' },
            { id: 'conv-active-round', title: 'Round conversation', updatedAt: '2026-03-12T09:00:00.000Z' },
          ]),
        } as unknown as Response
      }
      if (url.includes('/api/v1/chat/conversation/conv-active-round') && !init?.method) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-active-round',
            title: 'Round conversation',
            messages: [{ id: 'srv-round', role: 'assistant', content: 'round backend', createdAt: '2026-03-12T09:00:00.000Z' }],
            session: null,
          }),
        } as unknown as Response
      }
      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          { type: 'token', content: 'New reply' },
          { type: 'done' },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(screen.getByRole('button', { name: /Round conversation/ }))
    await waitFor(() => {
      expect(screen.getByText('round backend')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/Describe your structural goal|描述你的结构目标/) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'New round message' } })
    fireEvent.click(screen.getByRole('button', { name: /Send|发送/ }))

    await waitFor(() => {
      expect(screen.getByText('New reply')).toBeInTheDocument()
    })

    // Bump to top runs in handleSubmit's `finally` after stream handling; DOM order can lag behind
    // the assistant message update on slower runners (e.g. windows-latest CI).
    await waitFor(() => {
      const titleButtons = screen.getAllByRole('button').filter((button) => (
        button.textContent?.includes('Top round conversation') || button.textContent?.includes('Round conversation')
      ))
      expect(titleButtons[0]?.textContent ?? '').toMatch(/Round conversation/)
      expect(titleButtons[1]?.textContent ?? '').toMatch(/Top round conversation/)
    }, { timeout: 8000 })
  })

  it('deletes a non-active conversation from history and local archive', async () => {
    window.localStorage.setItem('structureclaw.console.conversations', JSON.stringify({
      'conv-delete': {
        id: 'conv-delete',
        title: 'Delete me',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T09:00:00.000Z',
        messages: [
          { id: 'm1', role: 'assistant', content: 'saved assistant', status: 'done', timestamp: '2026-03-12T08:00:00.000Z' },
        ],
      },
      'conv-keep': {
        id: 'conv-keep',
        title: 'Keep me',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T10:00:00.000Z',
        messages: [
          { id: 'm2', role: 'assistant', content: 'keep assistant', status: 'done', timestamp: '2026-03-12T10:00:00.000Z' },
        ],
      },
    }))

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return { ok: true, json: vi.fn().mockResolvedValue(mockSkills) } as unknown as Response
      }

      if (url.includes('/api/v1/analysis-engines')) {
        return { ok: true, json: vi.fn().mockResolvedValue({ engines: [] }) } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([
            { id: 'conv-keep', title: 'Keep me', updatedAt: '2026-03-12T10:00:00.000Z' },
            { id: 'conv-delete', title: 'Delete me', updatedAt: '2026-03-12T09:00:00.000Z' },
          ]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-delete') && init?.method === 'DELETE') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true, id: 'conv-delete' }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.click(screen.getAllByRole('button', { name: /Delete Conversation|删除会话/ })[1])
    expect(screen.getByText(/Delete this conversation and its local workspace context|删除这个会话以及它的本地工作区上下文/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Delete$|^确认删除$/ }))

    await waitFor(() => {
      expect(screen.queryByText('Delete me')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Keep me')).toBeInTheDocument()

    const stored = JSON.parse(window.localStorage.getItem('structureclaw.console.conversations') || '{}')
    expect(stored['conv-delete']).toBeUndefined()
    expect(stored['conv-keep']).toBeDefined()
  })

  it('deletes the active conversation and falls back to the newest remaining one', async () => {
    window.localStorage.setItem('structureclaw.console.conversations', JSON.stringify({
      'conv-active': {
        id: 'conv-active',
        title: 'Active conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T10:00:00.000Z',
        messages: [
          { id: 'm1', role: 'assistant', content: 'active local', status: 'done', timestamp: '2026-03-12T10:00:00.000Z' },
        ],
      },
      'conv-next': {
        id: 'conv-next',
        title: 'Next conversation',
        type: 'analysis',
        createdAt: '2026-03-12T08:00:00.000Z',
        updatedAt: '2026-03-12T09:00:00.000Z',
        messages: [
          { id: 'm2', role: 'assistant', content: 'next local', status: 'done', timestamp: '2026-03-12T09:00:00.000Z' },
        ],
      },
    }))

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.includes('/api/v1/agent/skills')) {
        return { ok: true, json: vi.fn().mockResolvedValue(mockSkills) } as unknown as Response
      }

      if (url.includes('/api/v1/analysis-engines')) {
        return { ok: true, json: vi.fn().mockResolvedValue({ engines: [] }) } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversations')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue([
            { id: 'conv-active', title: 'Active conversation', updatedAt: '2026-03-12T10:00:00.000Z' },
            { id: 'conv-next', title: 'Next conversation', updatedAt: '2026-03-12T09:00:00.000Z' },
          ]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-active') && !init?.method) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-active',
            title: 'Active conversation',
            messages: [
              { id: 'srv-1', role: 'assistant', content: 'active backend', createdAt: '2026-03-12T10:00:00.000Z' },
            ],
            session: null,
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-next') && !init?.method) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-next',
            title: 'Next conversation',
            messages: [
              { id: 'srv-2', role: 'assistant', content: 'next backend', createdAt: '2026-03-12T09:00:00.000Z' },
            ],
            session: null,
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-active') && init?.method === 'DELETE') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true, id: 'conv-active' }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(await screen.findByRole('button', { name: /Active conversation/ }))
    await waitFor(() => {
      expect(screen.getByText('active backend')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByRole('button', { name: /Delete Conversation|删除会话/ })
    fireEvent.click(deleteButtons[0])
    fireEvent.click(screen.getByRole('button', { name: /^Delete$|^确认删除$/ }))

    await waitFor(() => {
      expect(screen.getByText('next backend')).toBeInTheDocument()
    })
    expect(screen.queryByText('Active conversation')).not.toBeInTheDocument()
    expect(screen.getByText('Next conversation')).toBeInTheDocument()
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
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh')

    await renderConsolePage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '结构工程对话工作台' })).toBeInTheDocument()
    })

    expect(screen.getByText('历史会话')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '管理能力' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开工程上下文' })).toBeInTheDocument()
    expect(screen.queryByText('计算引擎 自动选择')).not.toBeInTheDocument()
    expect(screen.queryByText('已选择技能')).not.toBeInTheDocument()
    expect(screen.queryByText('选择允许 agent 使用的本地 Markdown skills。不选择技能时，控制台会默认退回到直接和大模型对话。')).not.toBeInTheDocument()
  })

  it('sends the active locale with execute requests', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh')

    let executePayload: Record<string, unknown> | null = null
    vi.mocked(fetch).mockImplementation(async (input, init) => {
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
          json: vi.fn().mockResolvedValue([]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation') && init?.method === 'POST') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-zh',
            title: '新会话',
            type: 'general',
            createdAt: '2026-03-12T08:00:00.000Z',
            updatedAt: '2026-03-12T08:00:00.000Z',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        executePayload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return createSseResponse([
          {
            type: 'result',
            content: {
              response: '已完成',
              success: true,
              report: {
                summary: '摘要',
                markdown: '# 报告',
              },
            },
          },
        ])
      }

      if (url.includes('/api/v1/agent/capability-matrix')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            skills: [{ id: 'beam', domain: 'structure-type' }],
            skillDomainById: { beam: 'structure-type' },
            domainSummaries: [{ domain: 'structure-type', skillIds: ['beam'] }],
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/agent/skillhub/search')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ items: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/agent/skillhub/installed')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ items: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/models/latest')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ model: null }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    setCapabilityPreferences(['generic', 'beam', 'opensees-static'])
    await renderConsolePage()

    fireEvent.change(screen.getByPlaceholderText(/描述你的结构目标/i), {
      target: { value: '请分析这个模型' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(executePayload).not.toBeNull()
    })

    const executeContext = ((executePayload as Record<string, unknown> | null)?.['context']
      ?? null) as Record<string, unknown> | null
    expect(executeContext?.locale).toBe('zh')
    expect(executeContext?.engineId).toBeUndefined()
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

      if (url.includes('/api/v1/agent/capability-matrix')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            skills: [{ id: 'beam', domain: 'structure-type' }],
            skillDomainById: { beam: 'structure-type' },
            domainSummaries: [{ domain: 'structure-type', skillIds: ['beam'] }],
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/agent/skillhub/search')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ items: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/agent/skillhub/installed')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ items: [] }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/models/latest')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ model: null }),
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
            type: 'general',
            createdAt: '2026-03-12T08:00:00.000Z',
            updatedAt: '2026-03-12T08:00:00.000Z',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          {
            type: 'result',
            content: {
              response: 'Analysis finished.',
              success: true,
              requestedEngineId: 'builtin-opensees',
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
            },
          },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    setCapabilityPreferences(['generic', 'beam', 'opensees-static'])
    await renderConsolePage()
    fireEvent.change(screen.getByPlaceholderText(/Describe your structural goal|描述你的结构目标/), {
      target: { value: 'Analyze this model' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send|发送/ }))

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
    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    expect(screen.queryByRole('button', { name: /Expand Engine Settings|展开引擎设置/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Change Engine|更换引擎/ })).not.toBeInTheDocument()
  })

  it('renders guided discuss-first state in English', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    let streamPayload: Record<string, unknown> | null = null
    const interaction = {
      detectedStructuralType: 'unknown',
      interactionStageLabel: 'Intent',
      missingCritical: ['Structural system / topology description (any type, or provide computable model JSON directly)'],
      missingOptional: ['Whether to generate a report'],
      fallbackSupportNote: 'Continue with the generic structure skill and keep collecting key engineering parameters.',
      recommendedNextStep: 'Fill in the structural system first.',
      questions: [{ question: 'Please first describe the structural system, member connectivity, and main loads.' }],
      pending: {
        criticalMissing: ['Structural system / topology description (any type, or provide computable model JSON directly)'],
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
            type: 'general',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        streamPayload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return createSseResponse([
          { type: 'interaction_update', content: interaction },
          { type: 'result', content: { response: 'Using the generic structure skill to continue collecting parameters.', success: true, interaction } },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Help me size a steel frame' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByTestId('console-guidance-panel')).toBeInTheDocument()
    })

    const streamContext = ((streamPayload as Record<string, unknown> | null)?.['context']
      ?? null) as Record<string, unknown> | null
    expect(streamContext?.locale).toBe('en')
    expect(screen.getByText('Conversation Guidance')).toBeInTheDocument()
    expect(screen.getByText('Continue with the generic structure skill and keep collecting key engineering parameters.')).toBeInTheDocument()
    expect(screen.getByText('Fill in the structural system first.')).toBeInTheDocument()
  })

  it('synchronizes model json from a collecting chat result once the structural model is complete', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    const synchronizedModel = {
      schema_version: '1.0.0',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: 3, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' }],
      materials: [{ id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 }],
      sections: [{ id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001, Iz: 0.0001, J: 0.0001, G: 79000 } }],
      load_cases: [{ id: 'LC1', type: 'other', loads: [{ node: '2', fz: -10 }] }],
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
            type: 'general',
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
              interaction: {
                state: 'collecting',
                pending: { criticalMissing: [], nonCriticalMissing: ['Analysis type'] },
              },
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
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect((modelInput as HTMLTextAreaElement).value).toContain('"schema_version": "1.0.0"')
    })

    expect((modelInput as HTMLTextAreaElement).value).toContain('"nodes"')
    expect(screen.queryByText(/Model JSON parse failed|模型 JSON 解析失败/)).not.toBeInTheDocument()
    // latestModelVisualizationSnapshot is derived in a useEffect after modelText updates; avoid racing the DOM on CI.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Preview Model|预览模型/ })).toBeEnabled()
    })
    expect(screen.queryByText(/Current result is missing a model snapshot|当前结果缺少模型快照/)).not.toBeInTheDocument()
  })

  it('renders guided discuss-first state in Chinese', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh')
    const interaction = {
      detectedStructuralType: 'unknown',
      interactionStageLabel: '需求识别',
      missingCritical: ['结构体系/构件拓扑描述（不限类型，可直接给结构模型JSON）'],
      missingOptional: ['是否生成报告'],
      fallbackSupportNote: '继续使用通用结构类型 skill 处理当前对话，并继续补齐关键工程参数。',
      recommendedNextStep: '先补齐结构体系。',
      questions: [{ question: '请先描述结构体系、构件连接关系和主要荷载；如果你已经有可计算结构模型，也可以直接贴 JSON。' }],
      pending: {
        criticalMissing: ['结构体系/构件拓扑描述（不限类型，可直接给结构模型JSON）'],
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
            type: 'general',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          { type: 'interaction_update', content: interaction },
          { type: 'result', content: { response: '继续使用通用结构类型 skill 处理当前对话。', success: true, interaction } },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '请帮我梳理桥梁参数' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => {
      expect(screen.getByTestId('console-guidance-panel')).toBeInTheDocument()
    })

    expect(screen.getByText('对话引导')).toBeInTheDocument()
    expect(screen.getAllByText('继续使用通用结构类型 skill 处理当前对话。').length).toBeGreaterThan(0)
    expect(screen.getByText('先补齐结构体系。')).toBeInTheDocument()
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
            type: 'general',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        return createSseResponse([
          {
            type: 'result',
            content: sampleAnalysisResult,
          },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    setCapabilityPreferences(['generic', 'beam', 'opensees-static'])
    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    fireEvent.change(screen.getByPlaceholderText(/Paste StructureModel v1 JSON here|将 StructureModel v1 JSON 粘贴到这里/), {
      target: { value: sampleModelJson },
    })
    fireEvent.change(screen.getByPlaceholderText(/Describe your structural goal|描述你的结构目标/), {
      target: { value: 'Analyze and visualize this beam' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send|发送/ }))

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

  it('sends autoCodeCheck=true during execute when a code-check skill is selected', async () => {
    const executeBodies: Array<Record<string, unknown>> = []

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
            id: 'conv-code-check-on',
            title: 'Code check on',
            type: 'analysis',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        executeBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
        return createSseResponse([
          {
            type: 'result',
            content: sampleAnalysisResult,
          },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    setCapabilityPreferences(['generic', 'opensees-static', 'code-check-gb50017'])
    await renderConsolePage()
    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    fireEvent.change(screen.getByPlaceholderText(/Paste StructureModel v1 JSON here|将 StructureModel v1 JSON 粘贴到这里/), {
      target: { value: sampleModelJson },
    })
    fireEvent.change(screen.getByPlaceholderText(/Describe your structural goal|描述你的结构目标/), {
      target: { value: 'Analyze this model with code checks' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send|发送/ }))

    await waitFor(() => {
      expect(executeBodies.length).toBeGreaterThan(0)
    })

    const context = (executeBodies[0].context || {}) as Record<string, unknown>
    expect(context.autoCodeCheck).toBe(true)
    expect(context.skillIds).toEqual(expect.arrayContaining(['code-check-gb50017']))
  })

  it('sends autoCodeCheck=false during execute when no code-check skill is selected', async () => {
    const executeBodies: Array<Record<string, unknown>> = []

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
            id: 'conv-code-check-off',
            title: 'Code check off',
            type: 'analysis',
          }),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/stream')) {
        executeBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
        return createSseResponse([
          {
            type: 'result',
            content: sampleAnalysisResult,
          },
        ])
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    setCapabilityPreferences(['generic', 'beam', 'opensees-static'])
    await renderConsolePage()

    fireEvent.click(screen.getByRole('button', { name: /Expand Engineering Context|展开工程上下文/ }))
    fireEvent.change(screen.getByPlaceholderText(/Paste StructureModel v1 JSON here|将 StructureModel v1 JSON 粘贴到这里/), {
      target: { value: sampleModelJson },
    })
    fireEvent.change(screen.getByPlaceholderText(/Describe your structural goal|描述你的结构目标/), {
      target: { value: 'Analyze this model only' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send|发送/ }))

    await waitFor(() => {
      expect(executeBodies.length).toBeGreaterThan(0)
    })

    const context = (executeBodies[0].context || {}) as Record<string, unknown>
    expect(context.autoCodeCheck).toBeUndefined()
    expect(Array.isArray(context.skillIds) ? context.skillIds : []).not.toContain('code-check-gb50017')
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
          latestResult: { ...sampleAnalysisResult, model: null },
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

  it('clears stale archived structural snapshots instead of restoring them', async () => {
    window.localStorage.setItem(
      'structureclaw.console.conversations',
      JSON.stringify({
        'conv-stale-visual': {
          id: 'conv-stale-visual',
          title: 'Stale Visual',
          type: 'analysis',
          createdAt: '2026-03-12T08:00:00.000Z',
          updatedAt: '2026-03-12T08:00:00.000Z',
          messages: [{ id: 'assistant-1', role: 'assistant', content: 'done', status: 'done', timestamp: '2026-03-12T08:00:00.000Z' }],
          modelText: sampleModelJson,
          latestResult: sampleAnalysisResult,
          resultVisualizationSnapshot: {
            ...archivedVisualizationSnapshot,
            coordinateSemantics: undefined,
          },
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
          json: vi.fn().mockResolvedValue([{ id: 'conv-stale-visual', title: 'Stale Visual', updatedAt: '2026-03-12T08:00:00.000Z' }]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-stale-visual')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ messages: [] }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(await screen.findByText('Stale Visual'))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Open Visualization|打开可视化/ })).toBeNull()
    })
  })

  it('opens visualization from backend snapshots even when latestResult is missing', async () => {
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
          json: vi.fn().mockResolvedValue([{ id: 'conv-backend-snapshot', title: 'Backend Snapshot', updatedAt: '2026-03-12T08:00:00.000Z' }]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-backend-snapshot')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-backend-snapshot',
            title: 'Backend Snapshot',
            messages: [],
            snapshots: {
              resultSnapshot: archivedVisualizationSnapshot,
              latestResult: null,
            },
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(await screen.findByText('Backend Snapshot'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open Visualization|打开可视化/ })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Open Visualization|打开可视化/ }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(screen.getByText('Archived Beam')).toBeInTheDocument()
  })

  it('keeps result visualization after refresh-style restore without overwriting with null', async () => {
    window.localStorage.setItem(
      'structureclaw.console.conversations',
      JSON.stringify({
        'conv-refresh-visual': {
          id: 'conv-refresh-visual',
          title: 'Refresh Visual',
          type: 'analysis',
          createdAt: '2026-03-12T08:00:00.000Z',
          updatedAt: '2026-03-12T08:00:00.000Z',
          messages: [{ id: 'assistant-1', role: 'assistant', content: 'done', status: 'done', timestamp: '2026-03-12T08:00:00.000Z' }],
          latestResult: null,
          modelVisualizationSnapshot: {
            ...archivedVisualizationSnapshot,
            source: 'model',
            availableViews: ['model'],
            defaultCaseId: 'model',
            cases: [{ ...archivedVisualizationSnapshot.cases[0], id: 'model', kind: 'case', label: 'Model', nodeResults: {}, elementResults: {} }],
          },
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
          json: vi.fn().mockResolvedValue([{ id: 'conv-refresh-visual', title: 'Refresh Visual', updatedAt: '2026-03-12T08:00:00.000Z' }]),
        } as unknown as Response
      }

      if (url.includes('/api/v1/chat/conversation/conv-refresh-visual')) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: 'conv-refresh-visual',
            title: 'Refresh Visual',
            messages: [],
            snapshots: {
              modelSnapshot: {
                ...archivedVisualizationSnapshot,
                source: 'model',
                availableViews: ['model'],
                defaultCaseId: 'model',
                cases: [{ ...archivedVisualizationSnapshot.cases[0], id: 'model', kind: 'case', label: 'Model', nodeResults: {}, elementResults: {} }],
              },
              resultSnapshot: archivedVisualizationSnapshot,
              latestResult: null,
            },
          }),
        } as unknown as Response
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await renderConsolePage()
    fireEvent.click(await screen.findByText('Refresh Visual'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Open Visualization|打开可视化/ })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /Open Visualization|打开可视化/ }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText('Archived Beam')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { name: /Forces|内力/ }).length).toBeGreaterThan(0)
    expect(within(dialog).getAllByRole('button', { name: /Deformed|变形/ }).length).toBeGreaterThan(0)
  })
})
