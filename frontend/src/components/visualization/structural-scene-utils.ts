import * as THREE from 'three'
import type { VisualizationCase, VisualizationPlane, VisualizationSnapshot } from './types'

export type ForceMetric = 'axial' | 'shear' | 'moment'

export function getCaseNodeDisplacement(activeCase: VisualizationCase, nodeId: string) {
  const displacement = activeCase.nodeResults[nodeId]?.displacement
  return {
    x: displacement?.ux ?? 0,
    y: displacement?.uy ?? 0,
    z: displacement?.uz ?? 0,
  }
}

export function getElementMetric(activeCase: VisualizationCase, elementId: string, forceMetric: ForceMetric) {
  const result = activeCase.elementResults[elementId]
  if (!result) {
    return 0
  }
  if (activeCase.kind === 'envelope') {
    if (forceMetric === 'axial') {
      return Number(result.envelope?.maxAbsAxialForce || 0)
    }
    if (forceMetric === 'shear') {
      return Number(result.envelope?.maxAbsShearForce || 0)
    }
    return Number(result.envelope?.maxAbsMoment || 0)
  }
  if (forceMetric === 'axial') {
    return Number(result.axial || 0)
  }
  if (forceMetric === 'shear') {
    return Number(result.shear || 0)
  }
  return Number(result.moment || 0)
}

export function getNodeReactionMagnitude(activeCase: VisualizationCase, nodeId: string) {
  const reaction = activeCase.nodeResults[nodeId]?.reaction
  if (activeCase.kind === 'envelope') {
    return Number(activeCase.nodeResults[nodeId]?.envelope?.maxAbsReaction || 0)
  }
  if (!reaction) {
    return 0
  }
  return Math.sqrt((reaction.fx || 0) ** 2 + (reaction.fy || 0) ** 2 + (reaction.fz || 0) ** 2)
}

export function getNodeDisplacementMagnitude(activeCase: VisualizationCase, nodeId: string) {
  if (activeCase.kind === 'envelope') {
    return Number(activeCase.nodeResults[nodeId]?.envelope?.maxAbsDisplacement || 0)
  }
  const displacement = activeCase.nodeResults[nodeId]?.displacement
  if (!displacement) {
    return 0
  }
  return Math.sqrt((displacement.ux || 0) ** 2 + (displacement.uy || 0) ** 2 + (displacement.uz || 0) ** 2)
}

/**
 * Utilization ratio color: HSL rainbow from blue (0%) → green (50%) → yellow (85%) → red (100%+).
 * ratio > 1 clamps to deep red to highlight overstressed members.
 */
export function createUtilizationColor(ratio: number) {
  const clamped = Math.max(0, ratio)
  const color = new THREE.Color()
  if (clamped >= 1) {
    // Overstressed — deep red
    color.setRGB(0.85, 0.1, 0.1)
  } else {
    // Hue: 240° (blue) → 120° (green) → 60° (yellow) → 0° (red)
    const hue = (1 - clamped) * 240 / 360
    color.setHSL(hue, 0.9, 0.48)
  }
  return `#${color.getHexString()}`
}

export function createColorScale(value: number, maxValue: number) {
  const ratio = maxValue <= 0 ? 0 : Math.min(Math.abs(value) / maxValue, 1)
  const color = new THREE.Color()
  color.setRGB(
    0.18 + ratio * 0.72,
    0.82 - ratio * 0.32,
    0.92 - ratio * 0.55
  )
  return `#${color.getHexString()}`
}

export function roundUpNice(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1
  }
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  const normalized = value / base
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * base
}

export function projectPosition(position: THREE.Vector3, plane: VisualizationPlane, dimension: 2 | 3) {
  if (dimension === 3) {
    // Canonical 3D snapshots are already expressed in z-up world coordinates.
    return position.clone()
  }
  if (plane === 'xy') {
    // Orthographic XY views look down the global z axis.
    return new THREE.Vector3(position.x, position.z, position.y)
  }
  if (plane === 'yz') {
    return new THREE.Vector3(position.y, position.x, position.z)
  }
  return new THREE.Vector3(position.x, position.y, position.z)
}

export function isRenderableLoadVector(vector: THREE.Vector3) {
  return vector.lengthSq() >= 1e-18
}

export function getLoadArrowLength(snapshot: VisualizationSnapshot, plane: VisualizationPlane) {
  if (!snapshot.nodes.length) {
    return 0.6
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  snapshot.nodes.forEach((node) => {
    const projected = projectPosition(new THREE.Vector3(node.position.x, node.position.y, node.position.z), plane, snapshot.dimension)
    minX = Math.min(minX, projected.x)
    maxX = Math.max(maxX, projected.x)
    minY = Math.min(minY, projected.y)
    maxY = Math.max(maxY, projected.y)
    minZ = Math.min(minZ, projected.z)
    maxZ = Math.max(maxZ, projected.z)
  })

  const spanX = maxX - minX
  const spanY = maxY - minY
  const spanZ = maxZ - minZ
  const modelSpan = Math.max(spanX, spanY, spanZ, 1)

  return Math.max(0.45, Math.min(modelSpan / 6, 2.4))
}

function planeGridFallback(plane: VisualizationPlane) {
  if (plane === 'xy') {
    return {
      size: 24,
      divisions: 24,
      position: [0, 0, -0.001] as [number, number, number],
      rotation: [Math.PI / 2, 0, 0] as [number, number, number],
    }
  }
  if (plane === 'yz') {
    return {
      size: 24,
      divisions: 24,
      position: [-0.001, 0, 0] as [number, number, number],
      rotation: [0, 0, Math.PI / 2] as [number, number, number],
    }
  }
  return {
    size: 24,
    divisions: 24,
    position: [0, -0.001, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
  }
}

export function getAdaptiveGridConfig(snapshot: VisualizationSnapshot, plane: VisualizationPlane) {
  if (!snapshot.nodes.length) {
    return planeGridFallback(plane)
  }

  const projected = snapshot.nodes.map((node) =>
    projectPosition(new THREE.Vector3(node.position.x, node.position.y, node.position.z), plane, snapshot.dimension),
  )
  const xs = projected.map((p) => p.x)
  const ys = projected.map((p) => p.y)
  const zs = projected.map((p) => p.z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)

  const offsetBase = Math.max(
    maxX - minX,
    maxY - minY,
    maxZ - minZ,
    1,
  )
  const offset = Math.max(offsetBase * 0.01, 0.001)

  if (plane === 'xy') {
    const spanX = Math.max(maxX - minX, 1)
    const spanY = Math.max(maxY - minY, 1)
    const span = Math.max(spanX, spanY)
    const size = roundUpNice(span * 1.5)
    const divisions = Math.min(120, Math.max(8, Math.round(size / Math.max(span / 18, 0.25))))
    return {
      size,
      divisions,
      position: [(minX + maxX) * 0.5, (minY + maxY) * 0.5, minZ - offset] as [number, number, number],
      rotation: [Math.PI / 2, 0, 0] as [number, number, number],
    }
  }

  if (plane === 'yz') {
    const spanY = Math.max(maxY - minY, 1)
    const spanZ = Math.max(maxZ - minZ, 1)
    const span = Math.max(spanY, spanZ)
    const size = roundUpNice(span * 1.5)
    const divisions = Math.min(120, Math.max(8, Math.round(size / Math.max(span / 18, 0.25))))
    return {
      size,
      divisions,
      position: [minX - offset, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5] as [number, number, number],
      rotation: [0, 0, Math.PI / 2] as [number, number, number],
    }
  }

  const spanX = Math.max(maxX - minX, 1)
  const spanZ = Math.max(maxZ - minZ, 1)
  const span = Math.max(spanX, spanZ)
  const size = roundUpNice(span * 1.5)
  const divisions = Math.min(120, Math.max(8, Math.round(size / Math.max(span / 18, 0.25))))

  return {
    size,
    divisions,
    position: [(minX + maxX) * 0.5, minY - offset, (minZ + maxZ) * 0.5] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
  }
}

export function getPlaneCameraPreset(plane: VisualizationPlane) {
  if (plane === 'xy') {
    return {
      position: [0, 0, 10] as [number, number, number],
      up: [0, 1, 0] as [number, number, number],
    }
  }
  if (plane === 'yz') {
    return {
      position: [10, 0, 0] as [number, number, number],
      up: [0, 0, 1] as [number, number, number],
    }
  }
  return {
    position: [0, 10, 0] as [number, number, number],
    up: [0, 0, 1] as [number, number, number],
  }
}

export function getNodeLabelOffset(plane: VisualizationPlane, dimension: 2 | 3) {
  const [x, y, z] = getPlaneCameraPreset(plane).up
  const distance = dimension === 3 ? 0.24 : 0.18
  return new THREE.Vector3(x, y, z).multiplyScalar(distance)
}
