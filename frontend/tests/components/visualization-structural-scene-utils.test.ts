import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { getAdaptiveGridConfig, getNodeLabelOffset, getPlaneCameraPreset, projectPosition } from '@/components/visualization/structural-scene-utils'
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
  it('keeps canonical 3d coordinates fixed when switching grid planes', () => {
    const point = new THREE.Vector3(1, 2, 3)

    expect(projectPosition(point, 'xy', 3).toArray()).toEqual([1, 2, 3])
    expect(projectPosition(point, 'yz', 3).toArray()).toEqual([1, 2, 3])
    expect(projectPosition(point, 'xz', 3).toArray()).toEqual([1, 2, 3])
  })

  it('places the 3d grid on the xy floor plane for z-up scenes', () => {
    const config = getAdaptiveGridConfig(sample3dSnapshot, 'xy')

    expect(config.rotation).toEqual([Math.PI / 2, 0, 0])
    expect(config.position[0]).toBeCloseTo(3)
    expect(config.position[1]).toBeCloseTo(4)
    expect(config.position[2]).toBeLessThan(0)
  })

  it('keeps the 3d grid on the xy floor regardless of selected plane', () => {
    // Switching to xz or yz in 3D should NOT move the grid to a wall.
    const xzConfig = getAdaptiveGridConfig(sample3dSnapshot, 'xz')
    const yzConfig = getAdaptiveGridConfig(sample3dSnapshot, 'yz')

    // Both should produce the same XY floor grid as the 'xy' selection.
    const xyConfig = getAdaptiveGridConfig(sample3dSnapshot, 'xy')

    expect(xzConfig.rotation).toEqual(xyConfig.rotation)
    expect(xzConfig.position).toEqual(xyConfig.position)
    expect(yzConfig.rotation).toEqual(xyConfig.rotation)
    expect(yzConfig.position).toEqual(xyConfig.position)
  })

  it('uses a top-down orthographic preset for xy plane views', () => {
    expect(getPlaneCameraPreset('xy')).toEqual({
      position: [0, 0, 10],
      up: [0, 1, 0],
    })
  })

  it('offsets node labels along the active camera up direction', () => {
    expect(getNodeLabelOffset('xy', 3).toArray()).toEqual([0, 0.24, 0])
    expect(getNodeLabelOffset('yz', 3).toArray()).toEqual([0, 0, 0.24])
    expect(getNodeLabelOffset('xz', 2).toArray()).toEqual([0, 0, 0.18])
  })
})
