import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VisualizationToolbar } from '@/components/visualization/toolbar'
import type { VisualizationSnapshot } from '@/components/visualization/types'
import { messages } from '@/lib/i18n'

const t = (key: keyof typeof messages.en) => messages.en[key]

function makeSnapshot(overrides: Partial<VisualizationSnapshot> = {}): VisualizationSnapshot {
  return {
    version: 1,
    title: 'Test',
    source: 'model',
    dimension: 2,
    plane: 'xy',
    availableViews: ['model', 'deformed', 'forces'],
    defaultCaseId: 'model',
    nodes: [],
    elements: [],
    loads: [],
    unsupportedElementTypes: [],
    cases: [{ id: 'model', label: 'Model', kind: 'result', nodeResults: {}, elementResults: {} }],
    ...overrides,
  }
}

const defaultProps = {
  snapshot: makeSnapshot(),
  activeCaseId: 'model',
  deformationScale: 1.0,
  deformationScaleMin: 0,
  deformationScaleMax: 10,
  deformationScaleStep: 0.1,
  forceMetric: 'axial' as const,
  selectedView: 'model' as const,
  showElementLabels: false,
  showLegend: false,
  showLoads: false,
  showNodeLabels: false,
  showUndeformed: false,
  onActiveCaseChange: vi.fn(),
  onDeformationScaleChange: vi.fn(),
  onForceMetricChange: vi.fn(),
  onSwitchToForcesView: vi.fn(),
  onToggleElementLabels: vi.fn(),
  onToggleLegend: vi.fn(),
  onToggleLoads: vi.fn(),
  onToggleNodeLabels: vi.fn(),
  onToggleUndeformed: vi.fn(),
  t,
}

describe('VisualizationToolbar', () => {
  it('renders toggle buttons for node labels, element labels, loads, and legend', () => {
    render(<VisualizationToolbar {...defaultProps} />)
    expect(screen.getByText('Node Labels')).toBeInTheDocument()
    expect(screen.getByText('Element Labels')).toBeInTheDocument()
    expect(screen.getByText('Load Markers')).toBeInTheDocument()
    expect(screen.getByText('Legend')).toBeInTheDocument()
  })

  it('renders force metric buttons when snapshot supports forces view', () => {
    render(<VisualizationToolbar {...defaultProps} />)
    expect(screen.getByText('Axial')).toBeInTheDocument()
    expect(screen.getByText('Shear')).toBeInTheDocument()
    expect(screen.getByText('Moment')).toBeInTheDocument()
  })

  it('does not render force metric buttons when forces view is not available', () => {
    const snapshot = makeSnapshot({ availableViews: ['model'] })
    render(<VisualizationToolbar {...defaultProps} snapshot={snapshot} />)
    expect(screen.queryByText('Axial')).not.toBeInTheDocument()
    expect(screen.queryByText('Shear')).not.toBeInTheDocument()
    expect(screen.queryByText('Moment')).not.toBeInTheDocument()
  })

  it('renders deformation scale slider when deformed view is available', () => {
    render(<VisualizationToolbar {...defaultProps} />)
    expect(screen.getByText('Scale')).toBeInTheDocument()
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider).toBeInTheDocument()
    expect(slider.value).toBe('1')
  })

  it('does not render deformation scale slider when deformed view is not available', () => {
    const snapshot = makeSnapshot({ availableViews: ['model'] })
    render(<VisualizationToolbar {...defaultProps} snapshot={snapshot} />)
    expect(screen.queryByText('Scale')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('renders undeformed overlay toggle when deformed view is available', () => {
    render(<VisualizationToolbar {...defaultProps} />)
    expect(screen.getByText('Undeformed Overlay')).toBeInTheDocument()
  })

  it('does not render undeformed overlay toggle when deformed view is unavailable', () => {
    const snapshot = makeSnapshot({ availableViews: ['model'] })
    render(<VisualizationToolbar {...defaultProps} snapshot={snapshot} />)
    expect(screen.queryByText('Undeformed Overlay')).not.toBeInTheDocument()
  })

  describe('case selector', () => {
    it('renders case selector when source is result and multiple cases exist', () => {
      const snapshot = makeSnapshot({
        source: 'result',
        cases: [
          { id: 'case1', label: 'Case 1', kind: 'case', nodeResults: {}, elementResults: {} },
          { id: 'case2', label: 'Case 2', kind: 'case', nodeResults: {}, elementResults: {} },
        ],
      })
      render(<VisualizationToolbar {...defaultProps} snapshot={snapshot} activeCaseId="case1" />)
      expect(screen.getByText('Current Case')).toBeInTheDocument()
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select).toBeInTheDocument()
      expect(select.options.length).toBe(2)
    })

    it('does not render case selector when source is model', () => {
      const snapshot = makeSnapshot({
        source: 'model',
        cases: [
          { id: 'case1', label: 'Case 1', kind: 'case', nodeResults: {}, elementResults: {} },
          { id: 'case2', label: 'Case 2', kind: 'case', nodeResults: {}, elementResults: {} },
        ],
      })
      render(<VisualizationToolbar {...defaultProps} snapshot={snapshot} />)
      expect(screen.queryByText('Current Case')).not.toBeInTheDocument()
    })

    it('does not render case selector when only one case exists', () => {
      const snapshot = makeSnapshot({
        source: 'result',
        cases: [
          { id: 'case1', label: 'Case 1', kind: 'case', nodeResults: {}, elementResults: {} },
        ],
      })
      render(<VisualizationToolbar {...defaultProps} snapshot={snapshot} />)
      expect(screen.queryByText('Current Case')).not.toBeInTheDocument()
    })

    it('calls onActiveCaseChange when a different case is selected', async () => {
      const onActiveCaseChange = vi.fn()
      const snapshot = makeSnapshot({
        source: 'result',
        cases: [
          { id: 'case1', label: 'Case 1', kind: 'case', nodeResults: {}, elementResults: {} },
          { id: 'case2', label: 'Case 2', kind: 'case', nodeResults: {}, elementResults: {} },
        ],
      })
      const user = userEvent.setup()
      render(
        <VisualizationToolbar
          {...defaultProps}
          snapshot={snapshot}
          activeCaseId="case1"
          onActiveCaseChange={onActiveCaseChange}
        />
      )
      await user.selectOptions(screen.getByRole('combobox'), 'case2')
      expect(onActiveCaseChange).toHaveBeenCalledWith('case2')
    })

    it('shows special labels for model, result, and envelope case IDs', () => {
      const snapshot = makeSnapshot({
        source: 'result',
        cases: [
          { id: 'model', label: 'Ignored', kind: 'result', nodeResults: {}, elementResults: {} },
          { id: 'result', label: 'Ignored', kind: 'result', nodeResults: {}, elementResults: {} },
          { id: 'envelope', label: 'Ignored', kind: 'envelope', nodeResults: {}, elementResults: {} },
          { id: 'custom', label: 'Custom Label', kind: 'case', nodeResults: {}, elementResults: {} },
        ],
      })
      render(<VisualizationToolbar {...defaultProps} snapshot={snapshot} activeCaseId="model" />)
      const select = screen.getByRole('combobox') as HTMLSelectElement
      const optionTexts = Array.from(select.options).map((o) => o.textContent)
      expect(optionTexts).toContain('Model Preview')
      expect(optionTexts).toContain('Analysis Result')
      expect(optionTexts).toContain('Envelope')
      expect(optionTexts).toContain('Custom Label')
    })
  })

  describe('force metric buttons', () => {
    it('calls onForceMetricChange when a force button is clicked', async () => {
      const onForceMetricChange = vi.fn()
      const user = userEvent.setup()
      render(<VisualizationToolbar {...defaultProps} onForceMetricChange={onForceMetricChange} />)
      await user.click(screen.getByText('Shear'))
      expect(onForceMetricChange).toHaveBeenCalledWith('shear')
    })

    it('calls onSwitchToForcesView when force button is clicked and current view is not forces', async () => {
      const onSwitchToForcesView = vi.fn()
      const user = userEvent.setup()
      render(
        <VisualizationToolbar
          {...defaultProps}
          selectedView="model"
          onSwitchToForcesView={onSwitchToForcesView}
        />
      )
      await user.click(screen.getByText('Axial'))
      expect(onSwitchToForcesView).toHaveBeenCalled()
    })

    it('does not call onSwitchToForcesView when already on forces view', async () => {
      const onSwitchToForcesView = vi.fn()
      const user = userEvent.setup()
      render(
        <VisualizationToolbar
          {...defaultProps}
          selectedView="forces"
          onSwitchToForcesView={onSwitchToForcesView}
        />
      )
      await user.click(screen.getByText('Moment'))
      expect(onSwitchToForcesView).not.toHaveBeenCalled()
    })

    it('applies active styling to the currently selected force metric button', () => {
      render(
        <VisualizationToolbar
          {...defaultProps}
          selectedView="forces"
          forceMetric="shear"
        />
      )
      const shearButton = screen.getByText('Shear')
      expect(shearButton.className).toContain('border-cyan-300')
      // Axial should not have active styling
      const axialButton = screen.getByText('Axial')
      expect(axialButton.className).not.toContain('border-cyan-300/45')
    })
  })

  describe('deformation scale slider', () => {
    it('calls onDeformationScaleChange when slider value changes', () => {
      const onDeformationScaleChange = vi.fn()
      render(
        <VisualizationToolbar
          {...defaultProps}
          onDeformationScaleChange={onDeformationScaleChange}
        />
      )
      const slider = screen.getByRole('slider') as HTMLInputElement
      fireEvent.change(slider, { target: { value: '5' } })
      expect(onDeformationScaleChange).toHaveBeenCalledWith(5)
    })

    it('displays the current deformation scale value formatted to one decimal', () => {
      render(<VisualizationToolbar {...defaultProps} deformationScale={3.25} />)
      expect(screen.getByText('3.3x')).toBeInTheDocument()
    })

    it('sets min, max, and step attributes on the slider', () => {
      render(
        <VisualizationToolbar
          {...defaultProps}
          deformationScaleMin={0}
          deformationScaleMax={20}
          deformationScaleStep={0.5}
        />
      )
      const slider = screen.getByRole('slider') as HTMLInputElement
      expect(slider.min).toBe('0')
      expect(slider.max).toBe('20')
      expect(slider.step).toBe('0.5')
    })
  })

  describe('toggle buttons', () => {
    it('calls onToggleNodeLabels when Node Labels button is clicked', async () => {
      const onToggleNodeLabels = vi.fn()
      const user = userEvent.setup()
      render(<VisualizationToolbar {...defaultProps} onToggleNodeLabels={onToggleNodeLabels} />)
      await user.click(screen.getByText('Node Labels'))
      expect(onToggleNodeLabels).toHaveBeenCalled()
    })

    it('calls onToggleElementLabels when Element Labels button is clicked', async () => {
      const onToggleElementLabels = vi.fn()
      const user = userEvent.setup()
      render(
        <VisualizationToolbar {...defaultProps} onToggleElementLabels={onToggleElementLabels} />
      )
      await user.click(screen.getByText('Element Labels'))
      expect(onToggleElementLabels).toHaveBeenCalled()
    })

    it('calls onToggleLoads when Load Markers button is clicked', async () => {
      const onToggleLoads = vi.fn()
      const user = userEvent.setup()
      render(<VisualizationToolbar {...defaultProps} onToggleLoads={onToggleLoads} />)
      await user.click(screen.getByText('Load Markers'))
      expect(onToggleLoads).toHaveBeenCalled()
    })

    it('calls onToggleLegend when Legend button is clicked', async () => {
      const onToggleLegend = vi.fn()
      const user = userEvent.setup()
      render(<VisualizationToolbar {...defaultProps} onToggleLegend={onToggleLegend} />)
      await user.click(screen.getByText('Legend'))
      expect(onToggleLegend).toHaveBeenCalled()
    })

    it('calls onToggleUndeformed when Undeformed Overlay button is clicked', async () => {
      const onToggleUndeformed = vi.fn()
      const user = userEvent.setup()
      render(<VisualizationToolbar {...defaultProps} onToggleUndeformed={onToggleUndeformed} />)
      await user.click(screen.getByText('Undeformed Overlay'))
      expect(onToggleUndeformed).toHaveBeenCalled()
    })

    it('applies active styling to toggled-on buttons', () => {
      render(
        <VisualizationToolbar
          {...defaultProps}
          showNodeLabels={true}
          showElementLabels={false}
        />
      )
      const nodeButton = screen.getByText('Node Labels')
      const elemButton = screen.getByText('Element Labels')
      expect(nodeButton.className).toContain('border-cyan-300')
      expect(elemButton.className).not.toContain('border-cyan-300/45')
    })
  })
})
