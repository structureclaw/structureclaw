import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  type ForceMetric,
  getCaseNodeDisplacement,
  getElementMetric,
  getNodeReactionMagnitude,
  getNodeDisplacementMagnitude,
  createColorScale,
  roundUpNice,
  orientToFloorPlane,
  isRenderableLoadVector,
  getLoadArrowLength,
  getAdaptiveGridConfig,
  projectPosition,
  getPlaneCameraPreset,
} from '@/components/visualization/structural-scene-utils'
import type { VisualizationCase, VisualizationSnapshot } from '@/components/visualization/types'

function makeCase(overrides: Partial<VisualizationCase> = {}): VisualizationCase {
  return {
    id: 'test-case',
    label: 'Test',
    kind: 'result',
    nodeResults: {},
    elementResults: {},
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<VisualizationSnapshot> = {}): VisualizationSnapshot {
  return {
    version: 1,
    title: 'Test',
    source: 'model',
    dimension: 2,
    plane: 'xz',
    availableViews: ['model'],
    defaultCaseId: 'test-case',
    nodes: [],
    elements: [],
    loads: [],
    unsupportedElementTypes: [],
    cases: [],
    ...overrides,
  }
}

describe('getCaseNodeDisplacement', () => {
  it('returns zeros when node has no results', () => {
    const c = makeCase()
    const result = getCaseNodeDisplacement(c, 'n1')
    expect(result).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('returns displacement values when present', () => {
    const c = makeCase({
      nodeResults: {
        n1: { displacement: { ux: 1.5, uy: -2.3, uz: 0.1 } },
      },
    })
    const result = getCaseNodeDisplacement(c, 'n1')
    expect(result).toEqual({ x: 1.5, y: -2.3, z: 0.1 })
  })

  it('handles partial displacement', () => {
    const c = makeCase({
      nodeResults: {
        n1: { displacement: { ux: 3.0 } },
      },
    })
    const result = getCaseNodeDisplacement(c, 'n1')
    expect(result).toEqual({ x: 3.0, y: 0, z: 0 })
  })
})

describe('getElementMetric', () => {
  it('returns 0 when element has no results', () => {
    const c = makeCase()
    expect(getElementMetric(c, 'e1', 'axial')).toBe(0)
  })

  it('returns axial value for result kind', () => {
    const c = makeCase({
      elementResults: { e1: { axial: 150, shear: 20, moment: 30 } },
    })
    expect(getElementMetric(c, 'e1', 'axial')).toBe(150)
  })

  it('returns shear value for result kind', () => {
    const c = makeCase({
      elementResults: { e1: { axial: 150, shear: 20, moment: 30 } },
    })
    expect(getElementMetric(c, 'e1', 'shear')).toBe(20)
  })

  it('returns moment value for result kind', () => {
    const c = makeCase({
      elementResults: { e1: { axial: 150, shear: 20, moment: 30 } },
    })
    expect(getElementMetric(c, 'e1', 'moment')).toBe(30)
  })

  it('returns envelope axial', () => {
    const c = makeCase({
      kind: 'envelope',
      elementResults: { e1: { envelope: { maxAbsAxialForce: 200, maxAbsShearForce: 50, maxAbsMoment: 80 } } },
    })
    expect(getElementMetric(c, 'e1', 'axial')).toBe(200)
  })

  it('returns envelope shear', () => {
    const c = makeCase({
      kind: 'envelope',
      elementResults: { e1: { envelope: { maxAbsAxialForce: 200, maxAbsShearForce: 50, maxAbsMoment: 80 } } },
    })
    expect(getElementMetric(c, 'e1', 'shear')).toBe(50)
  })

  it('returns envelope moment', () => {
    const c = makeCase({
      kind: 'envelope',
      elementResults: { e1: { envelope: { maxAbsAxialForce: 200, maxAbsShearForce: 50, maxAbsMoment: 80 } } },
    })
    expect(getElementMetric(c, 'e1', 'moment')).toBe(80)
  })

  it('handles string values with Number()', () => {
    const c = makeCase({
      elementResults: { e1: { axial: '150.5' as unknown as number } },
    })
    expect(getElementMetric(c, 'e1', 'axial')).toBe(150.5)
  })
})

describe('getNodeReactionMagnitude', () => {
  it('returns 0 when no reaction and not envelope', () => {
    const c = makeCase({ nodeResults: { n1: {} } })
    expect(getNodeReactionMagnitude(c, 'n1')).toBe(0)
  })

  it('returns magnitude from reaction components', () => {
    const c = makeCase({
      nodeResults: { n1: { reaction: { fx: 3, fy: 4, fz: 0 } } },
    })
    expect(getNodeReactionMagnitude(c, 'n1')).toBeCloseTo(5, 10)
  })

  it('returns envelope maxAbsReaction', () => {
    const c = makeCase({
      kind: 'envelope',
      nodeResults: { n1: { envelope: { maxAbsReaction: 42.5 } } },
    })
    expect(getNodeReactionMagnitude(c, 'n1')).toBe(42.5)
  })

  it('returns 0 when node has no results at all', () => {
    const c = makeCase()
    expect(getNodeReactionMagnitude(c, 'n1')).toBe(0)
  })
})

describe('getNodeDisplacementMagnitude', () => {
  it('returns 0 when no displacement', () => {
    const c = makeCase({ nodeResults: { n1: {} } })
    expect(getNodeDisplacementMagnitude(c, 'n1')).toBe(0)
  })

  it('returns magnitude from displacement components', () => {
    const c = makeCase({
      nodeResults: { n1: { displacement: { ux: 3, uy: 4, uz: 0 } } },
    })
    expect(getNodeDisplacementMagnitude(c, 'n1')).toBeCloseTo(5, 10)
  })

  it('returns envelope maxAbsDisplacement', () => {
    const c = makeCase({
      kind: 'envelope',
      nodeResults: { n1: { envelope: { maxAbsDisplacement: 12.3 } } },
    })
    expect(getNodeDisplacementMagnitude(c, 'n1')).toBe(12.3)
  })
})

describe('createColorScale', () => {
  it('returns low-ratio color for zero maxValue', () => {
    const result = createColorScale(50, 0)
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('returns gradient color for positive value', () => {
    const result = createColorScale(50, 100)
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('returns low end color for zero value', () => {
    const zero = createColorScale(0, 100)
    const full = createColorScale(100, 100)
    expect(zero).not.toBe(full)
  })

  it('clamps ratio at 1', () => {
    const over = createColorScale(200, 100)
    const at = createColorScale(100, 100)
    expect(over).toBe(at)
  })
})

describe('roundUpNice', () => {
  it('returns 1 for non-positive values', () => {
    expect(roundUpNice(0)).toBe(1)
    expect(roundUpNice(-5)).toBe(1)
    expect(roundUpNice(Infinity)).toBe(1)
    expect(roundUpNice(NaN)).toBe(1)
  })

  it('rounds up to nice numbers', () => {
    expect(roundUpNice(0.8)).toBe(1)
    expect(roundUpNice(1.5)).toBe(2)
    expect(roundUpNice(3)).toBe(5)
    expect(roundUpNice(8)).toBe(10)
    expect(roundUpNice(15)).toBe(20)
    expect(roundUpNice(30)).toBe(50)
    expect(roundUpNice(80)).toBe(100)
  })

  it('handles values at boundaries', () => {
    expect(roundUpNice(1)).toBe(1)
    expect(roundUpNice(2)).toBe(2)
    expect(roundUpNice(5)).toBe(5)
    expect(roundUpNice(10)).toBe(10)
  })
})

describe('orientToFloorPlane', () => {
  it('swaps y and z for xy plane', () => {
    const pos = new THREE.Vector3(1, 2, 3)
    const result = orientToFloorPlane(pos, 'xy')
    expect(result.x).toBe(1)
    expect(result.y).toBe(3)
    expect(result.z).toBe(2)
  })

  it('swaps x and y for yz plane', () => {
    const pos = new THREE.Vector3(1, 2, 3)
    const result = orientToFloorPlane(pos, 'yz')
    expect(result.x).toBe(2)
    expect(result.y).toBe(1)
    expect(result.z).toBe(3)
  })

  it('keeps xyz for xz plane', () => {
    const pos = new THREE.Vector3(1, 2, 3)
    const result = orientToFloorPlane(pos, 'xz')
    expect(result.x).toBe(1)
    expect(result.y).toBe(2)
    expect(result.z).toBe(3)
  })
})

describe('isRenderableLoadVector', () => {
  it('returns true for significant vectors', () => {
    expect(isRenderableLoadVector(new THREE.Vector3(1, 0, 0))).toBe(true)
  })

  it('returns false for zero vector', () => {
    expect(isRenderableLoadVector(new THREE.Vector3(0, 0, 0))).toBe(false)
  })

  it('returns false for very small vectors', () => {
    const tiny = new THREE.Vector3(1e-10, 0, 0)
    expect(isRenderableLoadVector(tiny)).toBe(false)
  })
})

describe('getLoadArrowLength', () => {
  it('returns default for empty snapshot', () => {
    const snap = makeSnapshot()
    expect(getLoadArrowLength(snap, 'xz')).toBe(0.3)
  })

  it('returns proportional length based on node span', () => {
    const snap = makeSnapshot({
      nodes: [
        { id: 'n1', position: { x: 0, y: 0, z: 0 } },
        { id: 'n2', position: { x: 10, y: 0, z: 0 } },
      ],
    })
    const length = getLoadArrowLength(snap, 'xz')
    expect(length).toBeGreaterThan(0.15)
    expect(length).toBeLessThanOrEqual(1.2)
  })
})

describe('getAdaptiveGridConfig', () => {
  it('returns defaults for empty snapshot', () => {
    const snap = makeSnapshot()
    const config = getAdaptiveGridConfig(snap, 'xz')
    expect(config.size).toBe(24)
    expect(config.divisions).toBe(24)
    expect(config.position).toEqual([0, -0.001, 0])
  })

  it('computes grid from node positions', () => {
    const snap = makeSnapshot({
      nodes: [
        { id: 'n1', position: { x: 0, y: 0, z: 0 } },
        { id: 'n2', position: { x: 20, y: 5, z: 0 } },
      ],
    })
    const config = getAdaptiveGridConfig(snap, 'xz')
    expect(config.size).toBeGreaterThan(0)
    expect(config.divisions).toBeGreaterThanOrEqual(8)
    expect(config.divisions).toBeLessThanOrEqual(120)
  })
})

describe('projectPosition', () => {
  it('delegates to orientToFloorPlane', () => {
    const pos = new THREE.Vector3(1, 2, 3)
    const result = projectPosition(pos, 'xy')
    expect(result.x).toBe(1)
    expect(result.y).toBe(3)
    expect(result.z).toBe(2)
  })
})

describe('getPlaneCameraPreset', () => {
  it('returns expected preset', () => {
    const preset = getPlaneCameraPreset()
    expect(preset.position).toEqual([0, 10, 0])
    expect(preset.up).toEqual([0, 0, 1])
  })
})
