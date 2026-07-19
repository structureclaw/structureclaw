import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { classifySupport, getAdaptiveGridConfig, getNodeLabelOffset, getNodeReactionMomentMagnitude, getPlaneCameraFrame, getPlaneCameraPreset, getSnapshotCenter, projectPosition } from '@/components/visualization/structural-scene-utils'
import type { VisualizationSnapshot } from '@/components/visualization/types'

const sample3dSnapshot: VisualizationSnapshot = {
  version: 1,
  title: '3D Frame',
  source: 'result',
  dimension: 3,
  plane: 'xy',
  availableViews: ['model', 'deformed'],
  defaultCaseId: 'result',
  nodes: [
    { id: 'N1', position: { x: 0, y: 0, z: 0 } },
    { id: 'N2', position: { x: 6, y: 8, z: 9 } },
  ],
  elements: [{ id: 'E1', type: 'beam', nodeIds: ['N1', 'N2'] }],
  loads: [],
  unsupportedElementTypes: [],
  cases: [{ id: 'result', label: 'Result', kind: 'result', nodeResults: {}, elementResults: {} }],
}

describe('structural-scene-utils', () => {
  it('classifies supports from canonical six-dof restraints', () => {
    expect(classifySupport([true, true, true, true, true, true], 2)).toBe('fixed')
    expect(classifySupport([true, true, true, false, false, false], 2)).toBe('pinned')
    expect(classifySupport([false, true, true, false, false, false], 2)).toBe('roller-x')
    expect(classifySupport([true, false, true, false, false, false], 3)).toBe('roller-y')
    expect(classifySupport([true, true, false, false, false, false], 3)).toBe('roller-z')
    expect(classifySupport([true, false, false, false, true, false], 3)).toBe('partial')
    expect(classifySupport(undefined, 3)).toBe('none')
  })

  it('lays the selected 3d source plane onto the horizontal render ground', () => {
    const point = new THREE.Vector3(1, 2, 3)

    expect(projectPosition(point, 'xy', 3).toArray()).toEqual([1, 2, 3])
    expect(projectPosition(point, 'xz', 3).toArray()).toEqual([1, -3, 2])
    expect(projectPosition(point, 'yz', 3).toArray()).toEqual([2, 3, 1])
    expect(projectPosition(point, 'xz', 2).toArray()).toEqual([1, 2, 3])
  })

  it('computes reaction moments independently from translational reactions', () => {
    const activeCase = {
      id: 'LC1',
      label: 'LC1',
      kind: 'result' as const,
      nodeResults: { N1: { reaction: { fx: 100, mx: 3, my: 4, mz: 12 } } },
      elementResults: {},
    }

    expect(getNodeReactionMomentMagnitude(activeCase, 'N1')).toBe(13)
    expect(getNodeReactionMomentMagnitude(activeCase, 'missing')).toBe(0)
  })

  it('places the default 3d grid just below the transformed model base', () => {
    const config = getAdaptiveGridConfig(sample3dSnapshot, 'xy')

    expect(config.rotation).toEqual([Math.PI / 2, 0, 0])
    expect(config.position[0]).toBeCloseTo(3)
    expect(config.position[1]).toBeCloseTo(4)
    expect(config.position[2]).toBeLessThan(0)
  })

  it('keeps every selected 3d grid horizontal at the transformed model base', () => {
    const xyConfig = getAdaptiveGridConfig(sample3dSnapshot, 'xy')
    const xzConfig = getAdaptiveGridConfig(sample3dSnapshot, 'xz')
    const yzConfig = getAdaptiveGridConfig(sample3dSnapshot, 'yz')

    expect(xyConfig.rotation).toEqual([Math.PI / 2, 0, 0])
    expect(xzConfig.rotation).toEqual([Math.PI / 2, 0, 0])
    expect(yzConfig.rotation).toEqual([Math.PI / 2, 0, 0])
    expect(xyConfig.position.slice(0, 2)).toEqual([3, 4])
    expect(xzConfig.position.slice(0, 2)).toEqual([3, -4.5])
    expect(yzConfig.position.slice(0, 2)).toEqual([4, 4.5])
    expect(xyConfig.position[2]).toBeLessThan(0)
    expect(xzConfig.position[2]).toBeLessThan(0)
    expect(yzConfig.position[2]).toBeLessThan(0)
  })

  it('keeps empty 3d grid fallbacks horizontal at the origin', () => {
    const emptySnapshot = { ...sample3dSnapshot, nodes: [] }

    expect(getAdaptiveGridConfig(emptySnapshot, 'xy').position).toEqual([0, 0, 0])
    expect(getAdaptiveGridConfig(emptySnapshot, 'xz').position).toEqual([0, 0, 0])
    expect(getAdaptiveGridConfig(emptySnapshot, 'yz').position).toEqual([0, 0, 0])
    expect(getAdaptiveGridConfig(emptySnapshot, 'xy').rotation).toEqual([Math.PI / 2, 0, 0])
    expect(getAdaptiveGridConfig(emptySnapshot, 'xz').rotation).toEqual([Math.PI / 2, 0, 0])
    expect(getAdaptiveGridConfig(emptySnapshot, 'yz').rotation).toEqual([Math.PI / 2, 0, 0])
  })

  it('uses one low-angle perspective preset for all 3d ground planes', () => {
    expect(getPlaneCameraPreset('xy', 3)).toEqual({
      direction: [1.25, -1.5, 0.65],
      up: [0, 0, 1],
    })
    expect(getPlaneCameraPreset('xz', 3)).toEqual(getPlaneCameraPreset('xy', 3))
    expect(getPlaneCameraPreset('yz', 3)).toEqual(getPlaneCameraPreset('xy', 3))
  })

  it('centers 3d cameras on each transformed model orientation', () => {
    expect(getSnapshotCenter(sample3dSnapshot, 'xy')).toEqual([3, 4, 4.5])
    expect(getSnapshotCenter(sample3dSnapshot, 'xz')).toEqual([3, -4.5, 4])
    expect(getSnapshotCenter(sample3dSnapshot, 'yz')).toEqual([4, 4.5, 3])

    const center = getSnapshotCenter(sample3dSnapshot, 'xz')
    const frame = getPlaneCameraFrame('xz', 3, center, 10)
    const viewOffset = new THREE.Vector3(...frame.position).sub(new THREE.Vector3(...frame.target))

    expect(frame.target).toEqual(center)
    expect(viewOffset.length()).toBeCloseTo(10)
    expect(viewOffset.z).toBeGreaterThan(0)
    expect(frame.up).toEqual([0, 0, 1])
  })

  it('keeps 2d xz views face-on and upright', () => {
    const center: [number, number, number] = [3, 0, 4.5]
    const frame = getPlaneCameraFrame('xz', 2, center, 10)

    expect(frame).toEqual({
      position: [3, -10, 4.5],
      target: center,
      up: [0, 0, 1],
    })
  })

  it('offsets node labels along the active camera up direction', () => {
    expect(getNodeLabelOffset('xy', 3).toArray()).toEqual([0, 0, 0.24])
    expect(getNodeLabelOffset('yz', 3).toArray()).toEqual([0, 0, 0.24])
    expect(getNodeLabelOffset('xz', 2).toArray()).toEqual([0, 0, 0.18])
  })
})
