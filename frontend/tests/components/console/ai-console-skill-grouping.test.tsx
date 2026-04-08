import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIConsole } from '@/components/chat/ai-console'
import { CapabilitySettingsPanel } from '@/components/chat/capability-settings-panel'
import { API_BASE } from '@/lib/api-base'
import { CAPABILITY_PREFERENCE_STORAGE_KEY } from '@/lib/capability-preference'

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

describe('Capability settings and console integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'generic',
              name: { zh: '通用结构类型', en: 'Generic Structure Type' },
              description: { zh: 'generic', en: 'generic' },
              autoLoadByDefault: true,
            },
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
              { id: 'generic', domain: 'structure-type' },
              { id: 'beam', domain: 'structure-type' },
              { id: 'truss', domain: 'structure-type' },
              { id: 'seismic-policy', domain: 'analysis-strategy' },
              { id: 'opensees-static', domain: 'analysis-strategy' },
              { id: 'opensees-nonlinear', domain: 'analysis-strategy' },
            ],
            tools: [
              {
                id: 'draft_model',
                category: 'modeling',
                displayName: { zh: '草拟结构模型', en: 'Draft Structural Model' },
                description: { zh: '根据文本生成模型草稿', en: 'Draft a model from text' },
              },
              {
                id: 'update_model',
                category: 'modeling',
                displayName: { zh: '更新结构模型', en: 'Update Structural Model' },
                description: { zh: '根据当前会话更新模型', en: 'Update the model from session context' },
              },
              {
                id: 'run_analysis',
                category: 'analysis',
                displayName: { zh: '执行结构分析', en: 'Run Structural Analysis' },
                description: { zh: '执行分析求解', en: 'Execute analysis' },
              },
            ],
            domainSummaries: [
              {
                domain: 'structure-type',
                skillIds: ['generic', 'beam', 'truss'],
                autoLoadSkillIds: ['generic', 'beam', 'truss'],
              },
              {
                domain: 'analysis-strategy',
                skillIds: ['seismic-policy', 'opensees-static', 'opensees-nonlinear'],
                autoLoadSkillIds: ['opensees-static'],
              },
            ],
            skillDomainById: {
              generic: 'structure-type',
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
    render(<CapabilitySettingsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /capability settings/i })).toBeInTheDocument()
    })

    expect(await screen.findByLabelText(/category view/i)).toBeInTheDocument()
    expect(screen.getAllByText(/structure-type skills/i).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Beam' }))
    await user.click(screen.getAllByRole('button', { name: /select category/i })[0])

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /clear category/i }).length).toBeGreaterThan(0)
    })
  })

  it('allows switching among all fourteen domain groups', async () => {
    const user = userEvent.setup()
    render(<CapabilitySettingsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /capability settings/i })).toBeInTheDocument()
    })

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

  it('falls back to the /agent/skills domain when capability-matrix omits the skill mapping', async () => {
    const user = userEvent.setup()

    vi.restoreAllMocks()
    window.localStorage.clear()
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'dead-load',
              name: { zh: '恒荷载', en: 'Dead Load' },
              description: { zh: 'dead load', en: 'dead load' },
              autoLoadByDefault: true,
              domain: 'load-boundary',
            },
          ]),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            skills: [],
            tools: [],
            foundationToolIds: [],
            enabledToolIdsBySkill: {},
            skillDomainById: {},
            domainSummaries: [
              { domain: 'load-boundary', skillIds: [] },
            ],
          }),
        } as Response
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response
    })

    render(<CapabilitySettingsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /capability settings/i })).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText(/category view/i), 'load-boundary')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dead Load' })).toBeInTheDocument()
    })
  })

  it('renders catalog-projected skills and tools without registry-only metadata', async () => {
    const user = userEvent.setup()

    vi.restoreAllMocks()
    window.localStorage.clear()
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'generic',
              name: { zh: '通用结构类型', en: 'Generic Structure Type' },
              description: { zh: 'generic', en: 'generic' },
            },
            {
              id: 'beam',
              name: { zh: '梁', en: 'Beam' },
              description: { zh: 'beam', en: 'beam' },
            },
            {
              id: 'opensees-static',
              name: { zh: 'OpenSees 静力分析', en: 'OpenSees Static Analysis' },
              description: { zh: 'static', en: 'static' },
            },
          ]),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            skills: [
              { id: 'generic', domain: 'structure-type' },
              { id: 'beam', domain: 'structure-type' },
              { id: 'opensees-static', domain: 'analysis' },
            ],
            tools: [
              {
                id: 'draft_model',
                displayName: { zh: '草拟结构模型', en: 'Draft Structural Model' },
                description: { zh: '根据文本生成模型草稿', en: 'Draft a model from text' },
              },
              {
                id: 'run_analysis',
                displayName: { zh: '执行结构分析', en: 'Run Structural Analysis' },
                description: { zh: '执行分析求解', en: 'Execute analysis' },
                requiresTools: ['draft_model'],
              },
            ],
            foundationToolIds: ['draft_model'],
            enabledToolIdsBySkill: {
              generic: ['draft_model'],
              beam: ['draft_model'],
              'opensees-static': ['run_analysis'],
            },
            domainSummaries: [
              { domain: 'structure-type', skillIds: ['generic', 'beam'] },
              { domain: 'analysis', skillIds: ['opensees-static'] },
            ],
          }),
        } as Response
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response
    })

    render(<CapabilitySettingsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /capability settings/i })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Generic Structure Type' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beam' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/category view/i), 'analysis')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'OpenSees Static Analysis' })).toBeInTheDocument()
    })

    expect(screen.getAllByText(/utility tools/i).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Draft Structural Model' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Run Structural Analysis' }).length).toBeGreaterThan(0)
  })

  it('sends the explicit default skill and tool selection from the console', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(global.fetch)
    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /manage capabilities/i })).toBeInTheDocument()
    })

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'hello')
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
    const body = JSON.parse(String(requestInit?.body || '{}')) as { context?: { skillIds?: string[]; enabledToolIds?: string[]; model?: unknown } }
    expect(body.context?.skillIds).toEqual(['opensees-static', 'generic'])
    expect([...(body.context?.enabledToolIds ?? [])].sort()).toEqual(['draft_model', 'run_analysis', 'update_model'])
    expect(body.context?.model).toBeUndefined()
  })

  it('migrates legacy stored skill ids to canonical ids before sending console requests', async () => {
    const user = userEvent.setup()

    vi.restoreAllMocks()
    window.localStorage.setItem(CAPABILITY_PREFERENCE_STORAGE_KEY, JSON.stringify({
      skillIds: ['structure-json-validation'],
      toolIds: ['validate_model'],
    }))

    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'validation-structure-model',
              aliases: ['structure-json-validation'],
              name: { zh: '结构模型校验', en: 'Structure Model Validation' },
              description: { zh: 'validation', en: 'validation' },
              autoLoadByDefault: false,
              domain: 'validation',
            },
          ]),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            skills: [
              { id: 'validation-structure-model', domain: 'validation' },
            ],
            tools: [
              {
                id: 'validate_model',
                category: 'utility',
                displayName: { zh: '校验模型', en: 'Validate Model' },
                description: { zh: '校验结构模型', en: 'Validate the structural model' },
              },
            ],
            foundationToolIds: [],
            enabledToolIdsBySkill: {
              'validation-structure-model': ['validate_model'],
            },
            skillDomainById: {
              'validation-structure-model': 'validation',
            },
            canonicalSkillIdByAlias: {
              'structure-json-validation': 'validation-structure-model',
            },
            domainSummaries: [
              { domain: 'validation', skillIds: ['validation-structure-model'] },
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
          json: async () => ({ id: 'conv-validation', title: 'Validation', type: 'general' }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/chat/stream`) {
        return createSseResponse([
          {
            type: 'result',
            content: {
              response: 'ok',
              success: true,
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

    render(<AIConsole />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /manage capabilities/i })).toBeInTheDocument()
    })

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'validate model')
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
    const body = JSON.parse(String(requestInit?.body || '{}')) as { context?: { skillIds?: string[]; enabledToolIds?: string[] } }
    expect(body.context?.skillIds).toEqual(['validation-structure-model'])
    expect(body.context?.enabledToolIds).toEqual(['validate_model'])
  })

  it('hydrates all default callable tools in the console when the capability matrix gates tools by skill', async () => {
    const user = userEvent.setup()

    vi.restoreAllMocks()
    window.localStorage.clear()
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'generic',
              name: { zh: '通用结构类型', en: 'Generic Structure Type' },
              description: { zh: 'generic', en: 'generic' },
              autoLoadByDefault: true,
            },
            {
              id: 'opensees-static',
              name: { zh: 'OpenSees 静力分析', en: 'OpenSees Static Analysis' },
              description: { zh: 'static', en: 'static' },
              autoLoadByDefault: true,
            },
          ]),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            skills: [
              { id: 'generic', domain: 'structure-type' },
              { id: 'opensees-static', domain: 'analysis-strategy' },
            ],
            tools: [
              {
                id: 'convert_model',
                category: 'modeling',
                displayName: { zh: '转换结构模型', en: 'Convert Structural Model' },
                description: { zh: '转换模型格式', en: 'Convert model formats' },
              },
              {
                id: 'draft_model',
                category: 'modeling',
                displayName: { zh: '草拟结构模型', en: 'Draft Structural Model' },
                description: { zh: '根据文本生成模型草稿', en: 'Draft a model from text' },
              },
              {
                id: 'update_model',
                category: 'modeling',
                displayName: { zh: '更新结构模型', en: 'Update Structural Model' },
                description: { zh: '根据当前会话更新模型', en: 'Update the model from session context' },
              },
              {
                id: 'run_analysis',
                category: 'analysis',
                displayName: { zh: '执行结构分析', en: 'Run Structural Analysis' },
                description: { zh: '执行分析求解', en: 'Execute analysis' },
              },
            ],
            foundationToolIds: ['convert_model'],
            enabledToolIdsBySkill: {
              generic: ['draft_model', 'update_model'],
              'opensees-static': ['run_analysis'],
            },
            skillDomainById: {
              generic: 'structure-type',
              'opensees-static': 'analysis-strategy',
            },
            domainSummaries: [
              { domain: 'structure-type', skillIds: ['generic'] },
              { domain: 'analysis-strategy', skillIds: ['opensees-static'] },
            ],
          }),
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

      if (url === `${API_BASE}/api/v1/chat/conversation` && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ id: 'conv-default-tools', title: 'Default Tools', type: 'general' }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/chat/stream`) {
        return createSseResponse([{ type: 'result', content: { response: 'ok', success: true } }])
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

    render(<AIConsole />)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'use the full default tool set')
    await user.click(screen.getByRole('button', { name: /send/i }))

    const fetchMock = vi.mocked(global.fetch)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE}/api/v1/chat/stream`,
        expect.objectContaining({ method: 'POST' })
      )
    })

    const streamCall = fetchMock.mock.calls.findLast(([input]) => String(input) === `${API_BASE}/api/v1/chat/stream`)
    expect(streamCall).toBeTruthy()
    const requestInit = streamCall?.[1] as RequestInit | undefined
    const body = JSON.parse(String(requestInit?.body || '{}')) as { context?: { enabledToolIds?: string[] } }
    expect([...(body.context?.enabledToolIds ?? [])].sort()).toEqual(['convert_model', 'draft_model', 'run_analysis', 'update_model'])
  })

  it('falls back to default engineering skills when the console submits before capability hydration finishes', async () => {
    const user = userEvent.setup()

    let resolveSkills: ((value: Response) => void) | null = null
    let resolveCapabilityMatrix: ((value: Response) => void) | null = null

    vi.restoreAllMocks()
    window.localStorage.clear()
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return await new Promise<Response>((resolve) => {
          resolveSkills = resolve
        })
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return await new Promise<Response>((resolve) => {
          resolveCapabilityMatrix = resolve
        })
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
          json: async () => ({ id: 'conv-early-submit', title: 'Early Submit', type: 'general' }),
        } as Response
      }

      if (url === `${API_BASE}/api/v1/chat/stream`) {
        return createSseResponse([{ type: 'result', content: { response: 'ok', success: true } }])
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

    render(<AIConsole />)

    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'design immediately')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE}/api/v1/chat/stream`,
        expect.objectContaining({ method: 'POST' })
      )
    })

    const streamCall = fetchMock.mock.calls.findLast(([input]) => String(input) === `${API_BASE}/api/v1/chat/stream`)
    expect(streamCall).toBeTruthy()
    const requestInit = streamCall?.[1] as RequestInit | undefined
    const body = JSON.parse(String(requestInit?.body || '{}')) as { context?: { skillIds?: string[]; enabledToolIds?: string[] } }
    expect(body.context?.skillIds).toEqual(['opensees-static', 'generic'])
    expect(body.context?.enabledToolIds).toBeUndefined()

    resolveSkills?.({
      ok: true,
      json: async () => ([
        {
          id: 'generic',
          name: { zh: '通用结构类型', en: 'Generic Structure Type' },
          description: { zh: 'generic', en: 'generic' },
          autoLoadByDefault: true,
        },
        {
          id: 'opensees-static',
          name: { zh: 'OpenSees 静力分析', en: 'OpenSees Static Analysis' },
          description: { zh: 'static', en: 'static' },
          autoLoadByDefault: true,
        },
      ]),
    } as Response)
    resolveCapabilityMatrix?.({
      ok: true,
      json: async () => ({
        skills: [
          { id: 'generic', domain: 'structure-type' },
          { id: 'opensees-static', domain: 'analysis' },
        ],
        tools: [
          {
            id: 'draft_model',
            category: 'modeling',
            displayName: { zh: '草拟结构模型', en: 'Draft Structural Model' },
            description: { zh: '根据文本生成模型草稿', en: 'Draft a model from text' },
          },
        ],
        foundationToolIds: [],
        enabledToolIdsBySkill: {
          generic: ['draft_model'],
        },
        skillDomainById: {
          generic: 'structure-type',
          'opensees-static': 'analysis',
        },
        domainSummaries: [
          { domain: 'structure-type', skillIds: ['generic'] },
          { domain: 'analysis', skillIds: ['opensees-static'] },
        ],
      }),
    } as Response)
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
    expect(body.mode).toBeUndefined()
    expect(body.context?.analysisType).toBeUndefined()
  })

  it('surfaces callable tools and sends the remaining tool ids after the user deselects one', async () => {
    const user = userEvent.setup()
    const view = render(<CapabilitySettingsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /capability settings/i })).toBeInTheDocument()
    })

    expect(await screen.findByRole('button', { name: 'Run Structural Analysis' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Run Structural Analysis' })).toBeInTheDocument()

    const skillHelpChip = screen.getByRole('button', { name: 'Skill' })
    const toolHelpChip = screen.getByRole('button', { name: 'Tool' })
    expect(skillHelpChip).toHaveAttribute('title', expect.stringMatching(/domain understanding/i))
    expect(toolHelpChip).toHaveAttribute('title', expect.stringMatching(/executable action/i))

    await user.click(screen.getByRole('button', { name: 'Run Structural Analysis' }))

    const stored = JSON.parse(window.localStorage.getItem(CAPABILITY_PREFERENCE_STORAGE_KEY) || '{}') as { skillIds?: string[]; toolIds?: string[] }
    expect([...(stored.toolIds ?? [])].sort()).toEqual(['draft_model', 'update_model'])

    view.unmount()

    vi.restoreAllMocks()
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'generic',
              name: { zh: '通用结构类型', en: 'Generic Structure Type' },
              description: { zh: 'generic', en: 'generic' },
              autoLoadByDefault: true,
            },
            {
              id: 'opensees-static',
              name: { zh: 'OpenSees 静力分析', en: 'OpenSees Static Analysis' },
              description: { zh: 'static', en: 'static' },
              autoLoadByDefault: true,
            },
          ]),
        } as Response
      }
      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            skills: [
              { id: 'generic', domain: 'structure-type' },
              { id: 'opensees-static', domain: 'analysis-strategy' },
            ],
            tools: [
              {
                id: 'draft_model',
                category: 'modeling',
                displayName: { zh: '草拟结构模型', en: 'Draft Structural Model' },
                description: { zh: '根据文本生成模型草稿', en: 'Draft a model from text' },
              },
              {
                id: 'update_model',
                category: 'modeling',
                displayName: { zh: '更新结构模型', en: 'Update Structural Model' },
                description: { zh: '根据当前会话更新模型', en: 'Update the model from session context' },
              },
              {
                id: 'run_analysis',
                category: 'analysis',
                displayName: { zh: '执行结构分析', en: 'Run Structural Analysis' },
                description: { zh: '执行分析求解', en: 'Execute analysis' },
              },
            ],
            skillDomainById: { generic: 'structure-type', 'opensees-static': 'analysis-strategy' },
            domainSummaries: [
              { domain: 'structure-type', skillIds: ['generic'] },
              { domain: 'analysis-strategy', skillIds: ['opensees-static'] },
            ],
          }),
        } as Response
      }
      if (url === `${API_BASE}/api/v1/chat/conversations`) {
        return { ok: true, json: async () => [] } as Response
      }
      if (url === `${API_BASE}/api/v1/chat/conversation` && init?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'conv-tools', title: 'Tools', type: 'general' }) } as Response
      }
      if (url === `${API_BASE}/api/v1/chat/stream`) {
        return createSseResponse([{ type: 'result', content: { response: 'ok', success: true } }])
      }
      if (url === `${API_BASE}/api/v1/models/latest`) {
        return { ok: true, json: async () => ({ model: null }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<AIConsole />)
    const composer = await screen.findByPlaceholderText(/describe your structural goal/i)
    await user.type(composer, 'run it when ready')
    await user.click(screen.getByRole('button', { name: /send/i }))

    const sendFetchMock = vi.mocked(global.fetch)

    await waitFor(() => {
      expect(sendFetchMock).toHaveBeenCalledWith(
        `${API_BASE}/api/v1/chat/stream`,
        expect.objectContaining({ method: 'POST' })
      )
    })

    const streamCall = sendFetchMock.mock.calls.findLast(([input]) => String(input) === `${API_BASE}/api/v1/chat/stream`)
    expect(streamCall).toBeTruthy()
    const requestInit = streamCall?.[1] as RequestInit | undefined
    const body = JSON.parse(String(requestInit?.body || '{}')) as { context?: { enabledToolIds?: string[] } }
    expect([...(body.context?.enabledToolIds ?? [])].sort()).toEqual(['draft_model', 'update_model'])
  })

  it('does not overwrite default tool selection before the capability matrix finishes loading', async () => {
    let resolveMatrix: ((value: Response) => void) | null = null

    vi.restoreAllMocks()
    window.localStorage.clear()
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'generic',
              name: { zh: '通用结构类型', en: 'Generic Structure Type' },
              description: { zh: 'generic', en: 'generic' },
              autoLoadByDefault: true,
            },
            {
              id: 'opensees-static',
              name: { zh: 'OpenSees 静力分析', en: 'OpenSees Static Analysis' },
              description: { zh: 'static', en: 'static' },
              autoLoadByDefault: true,
            },
          ]),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return await new Promise<Response>((resolve) => {
          resolveMatrix = resolve
        })
      }

      return {
        ok: true,
        json: async () => ([]),
      } as Response
    })

    render(<CapabilitySettingsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /capability settings/i })).toBeInTheDocument()
    })

    expect(window.localStorage.getItem(CAPABILITY_PREFERENCE_STORAGE_KEY)).toBeNull()

    await act(async () => {
      resolveMatrix?.({
        ok: true,
        json: async () => ({
          skills: [
            { id: 'generic', domain: 'structure-type' },
            { id: 'opensees-static', domain: 'analysis-strategy' },
          ],
          tools: [
            {
              id: 'draft_model',
              category: 'modeling',
              displayName: { zh: '草拟结构模型', en: 'Draft Structural Model' },
              description: { zh: '根据文本生成模型草稿', en: 'Draft a model from text' },
            },
            {
              id: 'update_model',
              category: 'modeling',
              displayName: { zh: '更新结构模型', en: 'Update Structural Model' },
              description: { zh: '根据当前会话更新模型', en: 'Update the model from session context' },
            },
            {
              id: 'run_analysis',
              category: 'analysis',
              displayName: { zh: '执行结构分析', en: 'Run Structural Analysis' },
              description: { zh: '执行分析求解', en: 'Execute analysis' },
            },
          ],
          skillDomainById: {
            generic: 'structure-type',
            'opensees-static': 'analysis-strategy',
          },
          domainSummaries: [
            { domain: 'structure-type', skillIds: ['generic'] },
            { domain: 'analysis-strategy', skillIds: ['opensees-static'] },
          ],
        }),
      } as Response)
    })

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CAPABILITY_PREFERENCE_STORAGE_KEY) || '{}') as { toolIds?: string[] }
      expect([...(stored.toolIds ?? [])].sort()).toEqual(['draft_model', 'run_analysis', 'update_model'])
    })
  })

  it('repairs legacy foundation-only default tool preferences on the capability settings page', async () => {
    vi.restoreAllMocks()
    window.localStorage.setItem(CAPABILITY_PREFERENCE_STORAGE_KEY, JSON.stringify({
      skillIds: ['opensees-static', 'generic'],
      toolIds: ['convert_model'],
    }))

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'generic',
              name: { zh: '通用结构类型', en: 'Generic Structure Type' },
              description: { zh: 'generic', en: 'generic' },
              autoLoadByDefault: true,
            },
            {
              id: 'opensees-static',
              name: { zh: 'OpenSees 静力分析', en: 'OpenSees Static Analysis' },
              description: { zh: 'static', en: 'static' },
              autoLoadByDefault: true,
            },
          ]),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            skills: [
              { id: 'generic', domain: 'structure-type' },
              { id: 'opensees-static', domain: 'analysis-strategy' },
            ],
            tools: [
              {
                id: 'convert_model',
                category: 'modeling',
                displayName: { zh: '转换结构模型', en: 'Convert Structural Model' },
                description: { zh: '转换模型格式', en: 'Convert model formats' },
              },
              {
                id: 'draft_model',
                category: 'modeling',
                displayName: { zh: '草拟结构模型', en: 'Draft Structural Model' },
                description: { zh: '根据文本生成模型草稿', en: 'Draft a model from text' },
              },
              {
                id: 'update_model',
                category: 'modeling',
                displayName: { zh: '更新结构模型', en: 'Update Structural Model' },
                description: { zh: '根据当前会话更新模型', en: 'Update the model from session context' },
              },
              {
                id: 'run_analysis',
                category: 'analysis',
                displayName: { zh: '执行结构分析', en: 'Run Structural Analysis' },
                description: { zh: '执行分析求解', en: 'Execute analysis' },
              },
            ],
            foundationToolIds: ['convert_model'],
            enabledToolIdsBySkill: {
              generic: ['draft_model', 'update_model'],
              'opensees-static': ['run_analysis'],
            },
            skillDomainById: {
              generic: 'structure-type',
              'opensees-static': 'analysis-strategy',
            },
            domainSummaries: [
              { domain: 'structure-type', skillIds: ['generic'] },
              { domain: 'analysis-strategy', skillIds: ['opensees-static'] },
            ],
          }),
        } as Response
      }

      return {
        ok: true,
        json: async () => ([]),
      } as Response
    })

    render(<CapabilitySettingsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /capability settings/i })).toBeInTheDocument()
    })

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CAPABILITY_PREFERENCE_STORAGE_KEY) || '{}') as { toolIds?: string[] }
      expect([...(stored.toolIds ?? [])].sort()).toEqual(['convert_model', 'draft_model', 'run_analysis', 'update_model'])
    })
  })

  it('does not treat duplicated stored skill ids as the default skill set during repair', async () => {
    vi.restoreAllMocks()
    window.localStorage.setItem(CAPABILITY_PREFERENCE_STORAGE_KEY, JSON.stringify({
      skillIds: ['generic', 'generic'],
      toolIds: ['convert_model'],
    }))

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)

      if (url === `${API_BASE}/api/v1/agent/skills`) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'generic',
              name: { zh: '通用结构类型', en: 'Generic Structure Type' },
              description: { zh: 'generic', en: 'generic' },
              autoLoadByDefault: true,
            },
            {
              id: 'opensees-static',
              name: { zh: 'OpenSees 静力分析', en: 'OpenSees Static Analysis' },
              description: { zh: 'static', en: 'static' },
              autoLoadByDefault: true,
            },
          ]),
        } as Response
      }

      if (url.startsWith(`${API_BASE}/api/v1/agent/capability-matrix`)) {
        return {
          ok: true,
          json: async () => ({
            skills: [
              { id: 'generic', domain: 'structure-type' },
              { id: 'opensees-static', domain: 'analysis-strategy' },
            ],
            tools: [
              {
                id: 'convert_model',
                category: 'modeling',
                displayName: { zh: '转换结构模型', en: 'Convert Structural Model' },
                description: { zh: '转换模型格式', en: 'Convert model formats' },
              },
              {
                id: 'draft_model',
                category: 'modeling',
                displayName: { zh: '草拟结构模型', en: 'Draft Structural Model' },
                description: { zh: '根据文本生成模型草稿', en: 'Draft a model from text' },
              },
              {
                id: 'update_model',
                category: 'modeling',
                displayName: { zh: '更新结构模型', en: 'Update Structural Model' },
                description: { zh: '根据当前会话更新模型', en: 'Update the model from session context' },
              },
              {
                id: 'run_analysis',
                category: 'analysis',
                displayName: { zh: '执行结构分析', en: 'Run Structural Analysis' },
                description: { zh: '执行分析求解', en: 'Execute analysis' },
              },
            ],
            foundationToolIds: ['convert_model'],
            enabledToolIdsBySkill: {
              generic: ['draft_model', 'update_model'],
              'opensees-static': ['run_analysis'],
            },
            skillDomainById: {
              generic: 'structure-type',
              'opensees-static': 'analysis-strategy',
            },
            domainSummaries: [
              { domain: 'structure-type', skillIds: ['generic'] },
              { domain: 'analysis-strategy', skillIds: ['opensees-static'] },
            ],
          }),
        } as Response
      }

      return {
        ok: true,
        json: async () => ([]),
      } as Response
    })

    render(<CapabilitySettingsPanel />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /capability settings/i })).toBeInTheDocument()
    })

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(CAPABILITY_PREFERENCE_STORAGE_KEY) || '{}') as { toolIds?: string[] }
      expect(stored.toolIds).toEqual(['convert_model'])
    })
  })
})
