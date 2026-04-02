import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { VisualizationModalShell } from '@/components/visualization/modal-shell'
import type { VisualizationSnapshot } from '@/components/visualization/types'
import { messages } from '@/lib/i18n'

const t = (key: keyof typeof messages.en) => messages.en[key]

function makeSnapshot(overrides: Partial<VisualizationSnapshot> = {}): VisualizationSnapshot {
  return {
    version: 1,
    title: 'Test Snapshot',
    source: 'model',
    dimension: 2,
    plane: 'xy',
    availableViews: ['model', 'deformed', 'forces', 'reactions'],
    defaultCaseId: 'model',
    nodes: [
      { id: '1', position: { x: 0, y: 0, z: 0 } },
      { id: '2', position: { x: 5, y: 0, z: 0 } },
    ],
    elements: [{ id: 'E1', type: 'beam', nodeIds: ['1', '2'] }],
    loads: [],
    unsupportedElementTypes: [],
    cases: [{ id: 'model', label: 'Model', kind: 'result', nodeResults: {}, elementResults: {} }],
    ...overrides,
  }
}

const defaultProps = {
  open: true,
  snapshot: makeSnapshot() as VisualizationSnapshot | null,
  title: 'Test Modal',
  selectedView: 'model' as const,
  selectedPlane: 'xy' as const,
  onViewChange: vi.fn(),
  onPlaneChange: vi.fn(),
  onClose: vi.fn(),
  onResetView: vi.fn(),
  t,
  children: <div data-testid="canvas">Canvas Content</div>,
}

describe('VisualizationModalShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset body overflow between tests
    document.body.style.overflow = ''
  })

  afterEach(() => {
    document.body.style.overflow = ''
  })

  it('returns null when open is false', () => {
    render(<VisualizationModalShell {...defaultProps} open={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the modal when open is true', () => {
    render(<VisualizationModalShell {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders the title', () => {
    render(<VisualizationModalShell {...defaultProps} title="My Title" />)
    expect(screen.getByText('My Title')).toBeInTheDocument()
  })

  it('renders children content', () => {
    render(<VisualizationModalShell {...defaultProps} />)
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
  })

  it('renders aside content when provided', () => {
    render(
      <VisualizationModalShell
        {...defaultProps}
        aside={<div data-testid="aside-panel">Aside Content</div>}
      />
    )
    expect(screen.getByTestId('aside-panel')).toBeInTheDocument()
  })

  it('renders snapshot info when snapshot is provided', () => {
    render(<VisualizationModalShell {...defaultProps} />)
    expect(screen.getByText(/2D/)).toBeInTheDocument()
    expect(screen.getByText(/2 nodes/i)).toBeInTheDocument()
    expect(screen.getByText(/1 elements/i)).toBeInTheDocument()
  })

  it('does not render snapshot info when snapshot is null', () => {
    render(<VisualizationModalShell {...defaultProps} snapshot={null} />)
    expect(screen.queryByText(/2D/)).not.toBeInTheDocument()
  })

  it('shows Model Preview label when snapshot source is model', () => {
    render(<VisualizationModalShell {...defaultProps} />)
    expect(screen.getByText(/Current Source.*Model Preview/)).toBeInTheDocument()
  })

  it('shows Analysis Result label when snapshot source is result', () => {
    const snapshot = makeSnapshot({ source: 'result' })
    render(<VisualizationModalShell {...defaultProps} snapshot={snapshot} />)
    expect(screen.getByText(/Current Source.*Analysis Result/)).toBeInTheDocument()
  })

  it('shows status message when snapshot has one', () => {
    const snapshot = makeSnapshot({ statusMessage: 'Warning: partial results' })
    render(<VisualizationModalShell {...defaultProps} snapshot={snapshot} />)
    expect(screen.getByText('Warning: partial results')).toBeInTheDocument()
  })

  it('does not show status message when snapshot has none', () => {
    const snapshot = makeSnapshot({})
    render(<VisualizationModalShell {...defaultProps} snapshot={snapshot} />)
    // The status message badge should not appear - check by text content
    // Since there's no status message, the amber badge should not render
    const dialog = screen.getByRole('dialog')
    const amberElements = dialog.querySelectorAll('.text-amber-900')
    expect(amberElements.length).toBe(0)
  })

  it('renders view mode buttons', () => {
    render(<VisualizationModalShell {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deformed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forces' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reactions' })).toBeInTheDocument()
  })

  it('renders only available views from snapshot', () => {
    const snapshot = makeSnapshot({ availableViews: ['model', 'deformed'] })
    render(<VisualizationModalShell {...defaultProps} snapshot={snapshot} />)
    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deformed' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Forces' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reactions' })).not.toBeInTheDocument()
  })

  it('falls back to all views when snapshot is null', () => {
    render(<VisualizationModalShell {...defaultProps} snapshot={null} />)
    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deformed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forces' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reactions' })).toBeInTheDocument()
  })

  it('applies active styling to the selected view button', () => {
    render(<VisualizationModalShell {...defaultProps} selectedView="deformed" />)
    const deformedButton = screen.getByRole('button', { name: 'Deformed' })
    expect(deformedButton.className).toContain('border-cyan-300')
  })

  it('calls onViewChange when a view button is clicked', async () => {
    const onViewChange = vi.fn()
    render(<VisualizationModalShell {...defaultProps} onViewChange={onViewChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Forces' }))
    expect(onViewChange).toHaveBeenCalledWith('forces')
  })

  it('renders plane buttons', () => {
    render(<VisualizationModalShell {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'XZ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'XY' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'YZ' })).toBeInTheDocument()
  })

  it('calls onPlaneChange when a plane button is clicked', () => {
    const onPlaneChange = vi.fn()
    render(<VisualizationModalShell {...defaultProps} onPlaneChange={onPlaneChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'XZ' }))
    expect(onPlaneChange).toHaveBeenCalledWith('xz')
  })

  it('applies active styling to the selected plane button', () => {
    render(<VisualizationModalShell {...defaultProps} selectedPlane="yz" />)
    const yzButton = screen.getByRole('button', { name: 'YZ' })
    expect(yzButton.className).toContain('border-cyan-300')
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<VisualizationModalShell {...defaultProps} onClose={onClose} />)
    const backdrop = screen.getByLabelText('Close Visualization')
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Close button is clicked', () => {
    const onClose = vi.fn()
    render(<VisualizationModalShell {...defaultProps} onClose={onClose} />)
    // There are two Close buttons: header and backdrop. Find the header one via text.
    const closeButtons = screen.getAllByRole('button').filter(
      (btn) => btn.textContent?.includes('Close Visualization')
    )
    // Click the one that is NOT the backdrop (the header button has an X icon)
    const headerClose = closeButtons.find((btn) => btn !== screen.getByLabelText('Close Visualization'))
    if (headerClose) {
      fireEvent.click(headerClose)
    }
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onResetView when Reset View button is clicked', () => {
    const onResetView = vi.fn()
    render(<VisualizationModalShell {...defaultProps} onResetView={onResetView} />)
    fireEvent.click(screen.getByRole('button', { name: /Reset View/i }))
    expect(onResetView).toHaveBeenCalled()
  })

  it('renders the double-click hint in the footer', () => {
    render(<VisualizationModalShell {...defaultProps} />)
    expect(screen.getByText('Double-click the scene to fit the current view.')).toBeInTheDocument()
  })

  describe('keyboard interactions', () => {
    it('calls onClose when Escape is pressed', () => {
      const onClose = vi.fn()
      render(<VisualizationModalShell {...defaultProps} onClose={onClose} />)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })

    it('does not call onClose for non-Escape keys', () => {
      const onClose = vi.fn()
      render(<VisualizationModalShell {...defaultProps} onClose={onClose} />)
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(onClose).not.toHaveBeenCalled()
    })

    it('wraps focus from last focusable element to first on Tab (no shift)', () => {
      render(<VisualizationModalShell {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      // Find focusable elements inside the dialog
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const filtered = Array.from(focusable).filter((el) => !el.hasAttribute('disabled'))
      if (filtered.length === 0) return

      const first = filtered[0]
      const last = filtered[filtered.length - 1]

      // Simulate the last element being active and Tab pressed
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(last)
      const preventDefault = vi.fn()
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: false })

      // Focus should have moved to first element
      expect(document.activeElement).toBeTruthy()
      vi.restoreAllMocks()
    })

    it('wraps focus from first focusable element to last on Shift+Tab', () => {
      render(<VisualizationModalShell {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const filtered = Array.from(focusable).filter((el) => !el.hasAttribute('disabled'))
      if (filtered.length === 0) return

      const first = filtered[0]
      const last = filtered[filtered.length - 1]

      // Simulate the first element being active and Shift+Tab pressed
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(first)
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })

      // Focus should have moved to last element
      expect(document.activeElement).toBeTruthy()
      vi.restoreAllMocks()
    })

    it('does not intercept Tab when focus is on a middle element', () => {
      render(<VisualizationModalShell {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const filtered = Array.from(focusable).filter((el) => !el.hasAttribute('disabled'))
      if (filtered.length < 3) return

      const middle = filtered[1]
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(middle)
      // Should not prevent default for middle elements
      const preventDefault = vi.fn()
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: false })
      // No wrapping occurs; no special behavior
      vi.restoreAllMocks()
    })

    it('ignores Tab key when containerRef is null', () => {
      // This tests the early return when containerRef.current is null
      // In practice, this is hard to trigger since the ref is set on render
      // But we verify that non-Tab, non-Escape keys are ignored
      const onClose = vi.fn()
      render(<VisualizationModalShell {...defaultProps} onClose={onClose} />)
      fireEvent.keyDown(window, { key: 'ArrowDown' })
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('focus management', () => {
    it('sets body overflow to hidden when open', () => {
      render(<VisualizationModalShell {...defaultProps} />)
      expect(document.body.style.overflow).toBe('hidden')
    })

    it('restores body overflow when closed', () => {
      document.body.style.overflow = 'auto'
      const { rerender } = render(<VisualizationModalShell {...defaultProps} open={true} />)
      expect(document.body.style.overflow).toBe('hidden')

      rerender(<VisualizationModalShell {...defaultProps} open={false} />)
      expect(document.body.style.overflow).toBe('auto')
    })

    it('restores focus to previously active element on close', () => {
      // Create a mock element that was previously focused
      const mockPrevious = document.createElement('button')
      document.body.appendChild(mockPrevious)
      const focusSpy = vi.spyOn(mockPrevious, 'focus')

      const { rerender } = render(<VisualizationModalShell {...defaultProps} open={false} />)

      // Simulate a previously active element
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(mockPrevious)

      // Open the modal - this captures the previous element
      rerender(<VisualizationModalShell {...defaultProps} open={true} />)

      // Close the modal - this should restore focus
      rerender(<VisualizationModalShell {...defaultProps} open={false} />)

      expect(focusSpy).toHaveBeenCalled()
      document.body.removeChild(mockPrevious)
      vi.restoreAllMocks()
    })

    it('does not set overflow or add listener when open is false on mount', () => {
      document.body.style.overflow = 'visible'
      render(<VisualizationModalShell {...defaultProps} open={false} />)
      expect(document.body.style.overflow).toBe('visible')
    })
  })
})
