import { describe, it, expect } from 'vitest'
import { normalizeVisualizationSnapshot } from '@/components/visualization/normalization'
import type { VisualizationSnapshot } from '@/components/visualization/types'

function makeSnapshot(overrides: Partial<VisualizationSnapshot> = {}): VisualizationSnapshot {
  return {
    version: 1,
    title: 'test',
    source: 'model',
    dimension: 2,
    plane: 'xz',
    availableViews: ['model'],
    defaultCaseId: 'case-1',
    nodes: [],
    elements: [],
    loads: [],
    unsupportedElementTypes: [],
    cases: [],
    ...overrides,
  }
}

describe('normalizeVisualizationSnapshot', () => {
  it('returns the same reference for any 2D xz snapshot (now a passthrough)', () => {
    const snap = makeSnapshot({
      plane: 'xz',
      loads: [{ nodeId: 'n1', vector: { x: 10, y: 5, z: 0 } }],
      cases: [{
        id: 'case-1',
        label: 'Case 1',
        kind: 'case',
        nodeResults: {
          n1: {
            displacement: { ux: 1, uy: 5, uz: 0 },
            reaction: { fx: 1, fy: 5, fz: 0 },
          },
        },
        elementResults: {},
      }],
    })
    expect(normalizeVisualizationSnapshot(snap)).toBe(snap)
  })

  it('returns the same reference for any 2D xy snapshot (now a passthrough)', () => {
    const snap = makeSnapshot({
      plane: 'xy',
      loads: [{ nodeId: 'n1', vector: { x: 10, y: 0, z: 5 } }],
      cases: [{
        id: 'case-1',
        label: 'Case 1',
        kind: 'case',
        nodeResults: {
          n1: {
            displacement: { ux: 1, uy: 0, uz: 5 },
            reaction: { fx: 1, fy: 0, fz: 5 },
          },
        },
        elementResults: {},
      }],
    })
    expect(normalizeVisualizationSnapshot(snap)).toBe(snap)
  })

  it('returns the same reference for 3D snapshots', () => {
    const snap = makeSnapshot({
      dimension: 3,
      plane: 'yz',
      loads: [{ nodeId: 'n1', vector: { x: 0, y: 5, z: 10 } }],
    })
    expect(normalizeVisualizationSnapshot(snap)).toBe(snap)
  })

  it('returns the same reference for canonical z-up snapshots', () => {
    const snap = makeSnapshot({
      coordinateSemantics: 'global-z-up',
      loads: [{ nodeId: 'n1', vector: { x: 0, y: 0, z: -10 } }],
    })
    expect(normalizeVisualizationSnapshot(snap)).toBe(snap)
  })

  it('returns the same reference for snapshots with empty loads and cases', () => {
    const snap = makeSnapshot({ loads: [], cases: [] })
    expect(normalizeVisualizationSnapshot(snap)).toBe(snap)
  })

  it('returns the same reference for 2D yz snapshots', () => {
    const snap = makeSnapshot({
      plane: 'yz',
      loads: [{ nodeId: 'n1', vector: { x: 0, y: 5, z: 10 } }],
    })
    expect(normalizeVisualizationSnapshot(snap)).toBe(snap)
  })
})
