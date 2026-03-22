import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StructuralVisualizationModal } from '@/components/visualization/modal'
import { messages } from '@/lib/i18n'
import type { VisualizationSnapshot } from '@/components/visualization'

const t = (key: keyof typeof messages.en) => messages.en[key]

const modelSnapshot: VisualizationSnapshot = {
  version: 1,
  title: 'Model Preview',
  source: 'model',
  dimension: 2,
  plane: 'xy',
  availableViews: ['model'],
  defaultCaseId: 'model',
  statusMessage: 'Preview is using the last valid model because the current JSON could not be parsed.',
  nodes: [
    { id: '1', position: { x: 0, y: 0, z: 0 }, restraints: [true, true, true, true, true, true] },
    { id: '2', position: { x: 6, y: 0, z: 0 } },
  ],
  elements: [
    { id: 'E1', type: 'beam', nodeIds: ['1', '2'], material: 'M1', section: 'S1' },
  ],
  loads: [{ nodeId: '2', kind: 'nodal', caseId: 'L1', vector: { x: 0, y: -10, z: 0 } }],
  unsupportedElementTypes: [],
  cases: [
    {
      id: 'model',
      label: 'Model',
      kind: 'result',
      nodeResults: {},
      elementResults: {},
    },
  ],
}

describe('StructuralVisualizationModal', () => {
  it('renders model-only preview state with list-based selection', () => {
    render(
      <StructuralVisualizationModal
        locale="en"
        onClose={() => undefined}
        open
        snapshot={modelSnapshot}
        t={t}
      />
    )

    expect(screen.getByText('Current Source: Model Preview')).toBeInTheDocument()
    expect(screen.getAllByText(modelSnapshot.statusMessage as string)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Deformed' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load Markers' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByText('Selected Node')).toBeInTheDocument()
    expect(screen.getByText(/Restraints:/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'E1' }))
    expect(screen.getByText('Selected Element')).toBeInTheDocument()
    expect(screen.getByText(/Connected Nodes: 1 - 2/)).toBeInTheDocument()
  })
})
