import { describe, expect, it } from 'vitest'
import { normalizeVisualizationSnapshot } from '@/components/visualization/normalization'
import type { VisualizationSnapshot } from '@/components/visualization/types'

function makeSnapshot(overrides: Partial<VisualizationSnapshot> = {}): VisualizationSnapshot {
  return {
    version: 1,
    title: 'Test',
    source: 'result',
    dimension: 2,
    plane: 'xz',
    availableViews: ['model', 'deformed'],
    defaultCaseId: 'result',
    nodes: [],
    elements: [],
    loads: [],
    unsupportedElementTypes: [],
    cases: [],
    ...overrides,
  }
}

describe('normalizeVisualizationSnapshot', () => {
  it('returns the original reference for canonical z-up 2d snapshots', () => {
    const snapshot = makeSnapshot({
      coordinateSemantics: 'global-z-up',
      loads: [{ nodeId: '1', kind: 'nodal', vector: { x: 0, y: 0, z: -10 } }],
    })

    expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
  })

  it('returns the original reference for canonical z-up 3d snapshots', () => {
    const snapshot = makeSnapshot({
      coordinateSemantics: 'global-z-up',
      dimension: 3,
      plane: 'yz',
      loads: [{ nodeId: '1', kind: 'nodal', vector: { x: 1, y: 2, z: 3 } }],
    })

    expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
  })

  it('does not try to rewrite metadata-free snapshots', () => {
    const snapshot = makeSnapshot({
      loads: [{ nodeId: '1', kind: 'nodal', vector: { x: 0, y: -10, z: 0 } }],
      cases: [{
        id: 'result',
        label: 'Result',
        kind: 'result',
        nodeResults: {
          '1': {
            displacement: { ux: 0, uy: -0.02 },
            reaction: { fy: 10 },
          },
        },
        elementResults: {},
      }],
    })

    expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
  })
})
