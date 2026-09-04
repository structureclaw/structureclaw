import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DesignIterationCard } from '@/components/chat/design-iteration-card'
import {
  reducePresentationEvent,
  type AssistantPresentation,
  type TimelineStepItem,
} from '@/components/chat/message-presentation'
import { messages, type MessageKey } from '@/lib/i18n'

const t = (key: MessageKey) => messages.zh[key]

function createEmptyPresentation(): AssistantPresentation {
  return {
    version: 3,
    mode: 'execution',
    status: 'streaming',
    summaryText: '',
    phases: [],
    artifacts: [],
  }
}

const designState = {
  iterations: [
    {
      iteration: 1,
      provider: 'design-ai-structure',
      action: 'iterate',
      applied: true,
      converged: false,
      changes: [
        {
          sectionId: '1',
          elementIds: ['C1'],
          before: 'HW200X200',
          after: 'HW250X250',
          utilizationBefore: 1.25,
          utilizationAfter: 0.95,
          reason: 'Utilization 1.25 exceeded 1.0',
        },
      ],
      summary: { zh: 'HW200X200 → HW250X250（利用率 1.25 → 预计 0.95）', en: 'HW200X200 → HW250X250 (utilization 1.25 → est. 0.95)' },
      completedAt: '2026-09-04T10:00:00.000Z',
    },
  ],
  maxIterations: 10,
  lastAction: 'iterate',
  converged: false,
}

const step: TimelineStepItem = {
  id: 'step-1',
  phase: 'design',
  status: 'done',
  tool: 'run_design',
  title: 'run_design',
}

describe('DesignIterationCard', () => {
  it('renders convergence status, iteration count, and the before → after change', async () => {
    render(<DesignIterationCard step={step} designState={designState} locale="zh" t={t} />)
    expect(screen.getByText('run_design')).toBeDefined()
    expect(screen.getByText('设计迭代 1/10')).toBeDefined()
    // collapsed view shows the localized summary line
    expect(screen.getByText(/HW200X200 → HW250X250（利用率 1.25 → 预计 0.95）/)).toBeDefined()
    expect(screen.queryByText('已收敛')).toBeNull()
    // expanded view shows the per-member comparison table
    fireEvent.click(screen.getByText('展开详情'))
    expect(await screen.findByText('HW200X200')).toBeDefined()
    expect(screen.getByText('HW250X250')).toBeDefined()
    expect(screen.getByText('1.25 → 0.95')).toBeDefined()
    expect(screen.getByText('Utilization 1.25 exceeded 1.0')).toBeDefined()
  })

  it('shows the converged status and hides iteration history when converged', () => {
    const convergedState = {
      ...designState,
      lastAction: 'converged',
      converged: true,
      iterations: [{
        ...designState.iterations[0],
        action: 'converged',
      }],
    }
    render(<DesignIterationCard step={step} designState={convergedState} locale="zh" t={t} />)
    expect(screen.getByText('已收敛')).toBeDefined()
  })

  it('shows approval-needed and max-iteration statuses', () => {
    const { unmount } = render(
      <DesignIterationCard
        step={step}
        designState={{ ...designState, lastAction: 'blocked_approval' }}
        locale="zh"
        t={t}
      />,
    )
    expect(screen.getByText('等待确认')).toBeDefined()
    unmount()
    render(
      <DesignIterationCard
        step={step}
        designState={{ ...designState, lastAction: 'max_iterations_reached' }}
        locale="zh"
        t={t}
      />,
    )
    expect(screen.getByText('已达最大迭代次数')).toBeDefined()
  })

  it('shows the cost estimate and local engine badge', () => {
    const costState = {
      ...designState,
      iterations: [{
        ...designState.iterations[0],
        provider: 'ai-structure',
        costEstimate: { amount: 0.5, currency: 'CNY' },
      }],
    }
    render(<DesignIterationCard step={step} designState={costState} locale="zh" t={t} />)
    expect(screen.queryByText('本地规则引擎')).toBeNull()
    expect(screen.getByText('ai-structure')).toBeDefined()
    expect(screen.getByText(/费用预估/)).toBeDefined()
    expect(screen.getByText(/0\.5 CNY/)).toBeDefined()
  })
})

describe('design presentation phase', () => {
  it('routes run_design steps into the design phase group', () => {
    let presentation = createEmptyPresentation()
    presentation = reducePresentationEvent(presentation, {
      type: 'step_upsert',
      phaseId: 'phase:design',
      step: { ...step, status: 'running' },
    })
    presentation = reducePresentationEvent(presentation, {
      type: 'step_upsert',
      phaseId: 'phase:design',
      step,
    })
    expect(presentation.phases).toHaveLength(1)
    expect(presentation.phases[0].phase).toBe('design')
    expect(presentation.phases[0].status).toBe('done')
  })

  it('orders the design phase between analysis and report', () => {
    let presentation = createEmptyPresentation()
    for (const phase of ['analysis', 'report', 'design'] as const) {
      presentation = reducePresentationEvent(presentation, {
        type: 'phase_upsert',
        phase: { phaseId: `phase:${phase}`, phase, status: 'done', steps: [] },
      })
    }
    expect(presentation.phases.map((phase) => phase.phase)).toEqual(['analysis', 'design', 'report'])
  })
})
