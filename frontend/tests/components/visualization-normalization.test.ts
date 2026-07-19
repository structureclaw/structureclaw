import { describe, expect, it } from 'vitest'
import {
  isCanonicalVisualizationSnapshot,
  normalizeVisualizationSnapshot,
} from '@/components/visualization/normalization'
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

describe('isCanonicalVisualizationSnapshot', () => {
  function makeCanonicalSnapshot(overrides: Partial<VisualizationSnapshot> = {}): VisualizationSnapshot {
    return makeSnapshot({
      coordinateSemantics: 'global-z-up',
      coordinateContractVersion: 1,
      defaultCaseId: 'model',
      nodes: [
        { id: 'N1', position: { x: 0, y: 0, z: 0 } },
        { id: 'N2', position: { x: 5, y: 0, z: 0 } },
      ],
      elements: [{
        id: 'E1',
        type: 'beam',
        nodeIds: ['N1', 'N2'],
        localAxes: {
          x: { x: 1, y: 0, z: 0 },
          y: { x: 0, y: 1, z: 0 },
          z: { x: 0, y: 0, z: 1 },
        },
      }],
      loads: [{
        kind: 'distributed',
        elementId: 'E1',
        vector: { x: 0, y: 0, z: -5 },
        sourceVector: { x: 0, y: 0, z: -5 },
        referenceFrame: 'element-local',
      }],
      cases: [{ id: 'model', label: 'Model', kind: 'case', nodeResults: {}, elementResults: {} }],
      ...overrides,
    })
  }

  it('accepts an exact canonical 2D XZ snapshot', () => {
    expect(isCanonicalVisualizationSnapshot(makeCanonicalSnapshot())).toBe(true)
  })

  it('rejects a 2D snapshot with a different plane or out-of-plane geometry', () => {
    expect(isCanonicalVisualizationSnapshot(makeCanonicalSnapshot({ plane: 'xy' }))).toBe(false)
    expect(isCanonicalVisualizationSnapshot(makeCanonicalSnapshot({
      nodes: [
        { id: 'N1', position: { x: 0, y: 0, z: 0 } },
        { id: 'N2', position: { x: 5, y: 1, z: 0 } },
      ],
    }))).toBe(false)
  })

  it('rejects stale topology, local axes, and local-load transforms', () => {
    expect(isCanonicalVisualizationSnapshot(makeCanonicalSnapshot({
      elements: [{
        id: 'E1',
        type: 'beam',
        nodeIds: ['N1', 'missing'],
      }],
    }))).toBe(false)
    expect(isCanonicalVisualizationSnapshot(makeCanonicalSnapshot({
      elements: [{
        id: 'E1',
        type: 'beam',
        nodeIds: ['N1', 'N2'],
        localAxes: {
          x: { x: 1, y: 0, z: 0 },
          y: { x: 0, y: 0, z: 1 },
          z: { x: 0, y: -1, z: 0 },
        },
      }],
    }))).toBe(false)
    expect(isCanonicalVisualizationSnapshot(makeCanonicalSnapshot({
      loads: [{
        kind: 'distributed',
        elementId: 'E1',
        vector: { x: -5, y: 0, z: 0 },
        sourceVector: { x: 0, y: 0, z: -5 },
        referenceFrame: 'element-local',
      }],
    }))).toBe(false)
  })

  it('rejects out-of-plane 2D result components', () => {
    expect(isCanonicalVisualizationSnapshot(makeCanonicalSnapshot({
      cases: [{
        id: 'model',
        label: 'Model',
        kind: 'result',
        nodeResults: { N2: { displacement: { uy: 0.01 } } },
        elementResults: {},
      }],
    }))).toBe(false)
  })

  it('allows all three observation planes for canonical 3D snapshots', () => {
    for (const plane of ['xy', 'xz', 'yz'] as const) {
      expect(isCanonicalVisualizationSnapshot(makeCanonicalSnapshot({ dimension: 3, plane }))).toBe(true)
    }
  })
})
