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

export function orientToFloorPlane(position: THREE.Vector3, plane: VisualizationPlane) {
  if (plane === 'xy') {
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
    return 0.3
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  snapshot.nodes.forEach((node) => {
    const oriented = orientToFloorPlane(new THREE.Vector3(node.position.x, node.position.y, node.position.z), plane)
    minX = Math.min(minX, oriented.x)
    maxX = Math.max(maxX, oriented.x)
    minY = Math.min(minY, oriented.y)
    maxY = Math.max(maxY, oriented.y)
    minZ = Math.min(minZ, oriented.z)
    maxZ = Math.max(maxZ, oriented.z)
  })

  const spanX = maxX - minX
  const spanY = maxY - minY
  const spanZ = maxZ - minZ
  const modelSpan = Math.max(spanX, spanY, spanZ, 1)

  return Math.max(0.15, Math.min(modelSpan / 10, 1.2))
}

export function getAdaptiveGridConfig(snapshot: VisualizationSnapshot, plane: VisualizationPlane) {
  if (!snapshot.nodes.length) {
    return {
      size: 24,
      divisions: 24,
      position: [0, -0.001, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    }
  }

  const orientedNodes = snapshot.nodes.map((node) => orientToFloorPlane(new THREE.Vector3(node.position.x, node.position.y, node.position.z), plane))
  const xs = orientedNodes.map((node) => node.x)
  const ys = orientedNodes.map((node) => node.y)
  const zs = orientedNodes.map((node) => node.z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)

  const spanX = Math.max(maxX - minX, 1)
  const spanZ = Math.max(maxZ - minZ, 1)
  const span = Math.max(spanX, spanZ)
  const size = roundUpNice(span * 1.5)
  const divisions = Math.min(120, Math.max(8, Math.round(size / Math.max(span / 18, 0.25))))
  const offset = Math.max(span * 0.01, 0.001)

  return {
    size,
    divisions,
    position: [(minX + maxX) * 0.5, minY - offset, (minZ + maxZ) * 0.5] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
  }
}

export function projectPosition(position: THREE.Vector3, plane: VisualizationPlane) {
  return orientToFloorPlane(position, plane)
}

export function getPlaneCameraPreset() {
  return {
    position: [0, 10, 0] as [number, number, number],
    up: [0, 0, 1] as [number, number, number],
  }
}
