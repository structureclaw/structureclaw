'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { MessageKey } from '@/lib/i18n'
import type { VisualizationCase, VisualizationPlane, VisualizationSnapshot, VisualizationViewMode } from './types'

type ForceMetric = 'axial' | 'shear' | 'moment'

type StructuralSceneProps = {
  snapshot: VisualizationSnapshot
  plane: VisualizationPlane
  activeCase: VisualizationCase
  deformationScale: number
  forceMetric: ForceMetric
  resetToken: number
  selectedElementId: string | null
  selectedNodeId: string | null
  showElementLabels: boolean
  showLegend: boolean
  showLoads: boolean
  showNodeLabels: boolean
  showUndeformed: boolean
  view: VisualizationViewMode
  onSelectElement: (id: string | null) => void
  onSelectNode: (id: string | null) => void
  onClearSelection: () => void
  t: (key: MessageKey) => string
}

function getCaseNodeDisplacement(activeCase: VisualizationCase, nodeId: string) {
  const displacement = activeCase.nodeResults[nodeId]?.displacement
  return {
    x: displacement?.ux ?? 0,
    y: displacement?.uy ?? 0,
    z: displacement?.uz ?? 0,
  }
}

function getElementMetric(activeCase: VisualizationCase, elementId: string, forceMetric: ForceMetric) {
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

function getNodeReactionMagnitude(activeCase: VisualizationCase, nodeId: string) {
  const reaction = activeCase.nodeResults[nodeId]?.reaction
  if (activeCase.kind === 'envelope') {
    return Number(activeCase.nodeResults[nodeId]?.envelope?.maxAbsReaction || 0)
  }
  if (!reaction) {
    return 0
  }
  return Math.sqrt((reaction.fx || 0) ** 2 + (reaction.fy || 0) ** 2 + (reaction.fz || 0) ** 2)
}

function getNodeDisplacementMagnitude(activeCase: VisualizationCase, nodeId: string) {
  if (activeCase.kind === 'envelope') {
    return Number(activeCase.nodeResults[nodeId]?.envelope?.maxAbsDisplacement || 0)
  }
  const displacement = activeCase.nodeResults[nodeId]?.displacement
  if (!displacement) {
    return 0
  }
  return Math.sqrt((displacement.ux || 0) ** 2 + (displacement.uy || 0) ** 2 + (displacement.uz || 0) ** 2)
}

function createColorScale(value: number, maxValue: number) {
  const ratio = maxValue <= 0 ? 0 : Math.min(Math.abs(value) / maxValue, 1)
  const color = new THREE.Color()
  color.setRGB(
    0.18 + ratio * 0.72,
    0.82 - ratio * 0.32,
    0.92 - ratio * 0.55
  )
  return `#${color.getHexString()}`
}

function roundUpNice(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1
  }
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  const normalized = value / base
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * base
}

function orientToFloorPlane(position: THREE.Vector3, plane: VisualizationPlane) {
  if (plane === 'xy') {
    return new THREE.Vector3(position.x, position.z, position.y)
  }
  if (plane === 'yz') {
    return new THREE.Vector3(position.y, position.x, position.z)
  }
  return new THREE.Vector3(position.x, position.y, position.z)
}

function isRenderableLoadVector(vector: THREE.Vector3) {
  return vector.lengthSq() >= 1e-18
}

function getLoadArrowLength(snapshot: VisualizationSnapshot, plane: VisualizationPlane) {
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

function getAdaptiveGridConfig(snapshot: VisualizationSnapshot, plane: VisualizationPlane) {
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

function ColorBar({
  maxValue,
  valueScale = 1,
  unit,
  label,
  show,
}: {
  maxValue: number
  valueScale?: number
  unit?: string
  label: string
  show: boolean
}) {
  if (!show) return null

  const formatValue = (val: number) => {
    if (val >= 1000) return val.toFixed(0)
    if (val >= 1) return val.toFixed(2)
    return val.toExponential(1)
  }

  return (
    <div className="pointer-events-none absolute right-4 top-4 z-10 flex flex-col items-end gap-1.5">
      <div className="rounded-lg border border-border/70 bg-background/90 px-3 py-1.5 text-sm font-medium text-foreground shadow-lg dark:border-white/10 dark:bg-slate-950/85">
        {label}{unit ? ` (${unit})` : ''}
      </div>
      <div className="flex items-end gap-2.5 rounded-lg border border-border/70 bg-background/90 p-2.5 shadow-lg dark:border-white/10 dark:bg-slate-950/85">
        <div className="flex flex-col justify-between items-end text-xs text-muted-foreground" style={{ height: '128px' }}>
          <span>{formatValue(maxValue * valueScale)}</span>
          <span>{formatValue(maxValue * 0.5 * valueScale)}</span>
          <span>0</span>
        </div>
        <div
          className="h-32 w-6 rounded-sm"
          style={{
            background: `linear-gradient(to bottom, ${createColorScale(maxValue, maxValue)}, ${createColorScale(0, maxValue)})`,
          }}
        />
      </div>
    </div>
  )
}

function projectPosition(position: THREE.Vector3, plane: VisualizationPlane) {
  return orientToFloorPlane(position, plane)
}

function getPlaneCameraPreset() {
  return {
    position: [0, 10, 0] as [number, number, number],
    up: [0, 0, 1] as [number, number, number],
  }
}

function ElementTube({
  color,
  end,
  onClick,
  onHover,
  selected,
  start,
}: {
  color: string
  end: THREE.Vector3
  onClick: () => void
  onHover: (hovered: boolean) => void
  selected: boolean
  start: THREE.Vector3
}) {
  const group = useRef<THREE.Group | null>(null)
  const diff = useMemo(() => end.clone().sub(start), [end, start])
  const midpoint = useMemo(() => start.clone().add(end).multiplyScalar(0.5), [end, start])
  const length = diff.length()
  const quaternion = useMemo(() => {
    const normalized = diff.clone().normalize()
    const base = new THREE.Vector3(0, 1, 0)
    const next = new THREE.Quaternion()
    next.setFromUnitVectors(base, normalized.lengthSq() > 0 ? normalized : base)
    return next
  }, [diff])

  useEffect(() => {
    if (!group.current) {
      return
    }
    group.current.quaternion.copy(quaternion)
  }, [quaternion])

  return (
    <group position={midpoint} ref={group}>
      <mesh onClick={onClick} onPointerOut={() => onHover(false)} onPointerOver={() => onHover(true)}>
        <cylinderGeometry args={[selected ? 0.1 : 0.075, selected ? 0.1 : 0.075, Math.max(length, 0.001), 12]} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.32} />
      </mesh>
      <mesh onClick={onClick} onPointerOut={() => onHover(false)} onPointerOver={() => onHover(true)} visible={false}>
        <cylinderGeometry args={[0.22, 0.22, Math.max(length, 0.001), 10]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  )
}

function VectorArrow({
  color,
  origin,
  vector,
}: {
  color: string
  origin: THREE.Vector3
  vector: THREE.Vector3
}) {
  const direction = useMemo(() => vector.clone().normalize(), [vector])
  const length = Math.max(vector.length(), 0.01)
  const quaternion = useMemo(() => {
    const base = new THREE.Vector3(0, 1, 0)
    const next = new THREE.Quaternion()
    next.setFromUnitVectors(base, direction.lengthSq() > 0 ? direction : base)
    return next
  }, [direction])
  const shaftPosition = useMemo(() => origin.clone().add(vector.clone().multiplyScalar(0.4)), [origin, vector])
  const headPosition = useMemo(() => origin.clone().add(vector.clone().multiplyScalar(0.9)), [origin, vector])

  return (
    <>
      <group position={shaftPosition} quaternion={quaternion}>
        <mesh>
          <cylinderGeometry args={[0.025, 0.025, Math.max(length * 0.8, 0.001), 10]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
      <group position={headPosition} quaternion={quaternion}>
        <mesh>
          <coneGeometry args={[0.08, Math.max(length * 0.22, 0.05), 10]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
    </>
  )
}

function DistributedLoadMarker({
  color,
  start,
  end,
  vector,
  arrowCount = 6,
}: {
  color: string
  start: THREE.Vector3
  end: THREE.Vector3
  vector: THREE.Vector3
  arrowCount?: number
}) {
  const length = Math.max(vector.length(), 0.01)
  const direction = useMemo(() => vector.clone().normalize(), [vector])
  const topStart = useMemo(() => start.clone().sub(direction.clone().multiplyScalar(length)), [start, direction, length])
  const topEnd = useMemo(() => end.clone().sub(direction.clone().multiplyScalar(length)), [end, direction, length])
  const capLength = Math.max(length * 0.16, 0.08)
  const boundaryVector = useMemo(() => direction.clone().multiplyScalar(capLength), [direction, capLength])
  const ratios = useMemo(() => {
    const count = Math.max(2, arrowCount)
    return Array.from({ length: count }, (_, index) => index / (count - 1))
  }, [arrowCount])

  return (
    <>
      <Line color={color} lineWidth={1.5} points={[topStart.toArray(), topEnd.toArray()]} />
      <Line color={color} lineWidth={1.2} points={[topStart.toArray(), topStart.clone().add(boundaryVector).toArray()]} />
      <Line color={color} lineWidth={1.2} points={[topEnd.toArray(), topEnd.clone().add(boundaryVector).toArray()]} />
      {ratios.map((ratio, index) => {
        const arrowOrigin = topStart.clone().lerp(topEnd, ratio)
        return (
          <VectorArrow
            color={color}
            key={`distributed-arrow-${index}`}
            origin={arrowOrigin}
            vector={vector}
          />
        )
      })}
    </>
  )
}

function SceneContent({
  activeCase,
  deformationScale,
  forceMetric,
  resetToken,
  selectedElementId,
  selectedNodeId,
  showElementLabels,
  showLoads,
  showNodeLabels,
  showUndeformed,
  plane,
  snapshot,
  view,
  onSelectElement,
  onSelectNode,
  onClearSelection,
  maxElementMetric,
  maxReaction,
  maxDisplacement,
}: StructuralSceneProps & {
  maxElementMetric: number
  maxReaction: number
  maxDisplacement: number
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null)
  const gridConfig = useMemo(() => getAdaptiveGridConfig(snapshot, plane), [snapshot, plane])
  const cameraPreset = useMemo(() => getPlaneCameraPreset(), [])
  const nodeMap = useMemo(
    () =>
      new Map(
        snapshot.nodes.map((node) => {
          const position = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
          const displacement = getCaseNodeDisplacement(activeCase, node.id)
          const displacedPosition = position.clone().add(new THREE.Vector3(displacement.x, displacement.y, displacement.z).multiplyScalar(deformationScale))
          return [node.id, { node, position, displacedPosition }]
        })
      ),
    [activeCase, deformationScale, snapshot.nodes]
  )
  const loadArrowLength = useMemo(() => getLoadArrowLength(snapshot, plane), [snapshot, plane])

  return (
    <>
      {snapshot.dimension === 3 ? (
        <PerspectiveCamera
          key={`perspective-${plane}-${resetToken}`}
          makeDefault
          fov={42}
          position={[8, 8, 8]}
          onUpdate={(camera) => {
            camera.up.set(0, 1, 0)
          }}
        />
      ) : (
        <OrthographicCamera
          key={`ortho-${plane}-${resetToken}`}
          makeDefault
          position={cameraPreset.position}
          zoom={48}
          onUpdate={(camera) => {
            camera.up.set(cameraPreset.up[0], cameraPreset.up[1], cameraPreset.up[2])
          }}
        />
      )}
      <ambientLight intensity={0.9} />
      <directionalLight intensity={1.2} position={[10, 12, 8]} />
      <directionalLight intensity={0.45} position={[-8, -4, 10]} />
      <OrbitControls key={`controls-${plane}-${resetToken}`} makeDefault target={[0, 0, 0]} />
      <gridHelper args={[gridConfig.size, gridConfig.divisions, '#1f9dc2', '#334155']} position={gridConfig.position} rotation={gridConfig.rotation} />

      <Bounds clip fit margin={1.2} observe>
        <group onDoubleClick={() => {
          onClearSelection()
        }}>
          {snapshot.elements.map((element) => {
            const startData = nodeMap.get(element.nodeIds[0])
            const endData = nodeMap.get(element.nodeIds[1])
            if (!startData || !endData) {
              return null
            }
            // In deformed view, always render the main member geometry at deformed coordinates.
            // The "undeformed" toggle controls only the gray overlay reference line.
            const start = view === 'deformed' ? startData.displacedPosition : startData.position
            const end = view === 'deformed' ? endData.displacedPosition : endData.position
            const forceColor = createColorScale(getElementMetric(activeCase, element.id, forceMetric), maxElementMetric)
            const color = view === 'forces'
              ? forceColor
              : selectedElementId === element.id
                ? '#fb923c'
                : hoveredElementId === element.id
                  ? '#67e8f9'
                  : '#38bdf8'
            const undeformedStart = projectPosition(startData.position, plane)
            const undeformedEnd = projectPosition(endData.position, plane)
            const currentStart = projectPosition(start, plane)
            const currentEnd = projectPosition(end, plane)
            const distributedLoadVectors = showLoads
              ? snapshot.loads.reduce<THREE.Vector3[]>((vectors, load) => {
                  if (load.kind !== 'distributed' || load.elementId !== element.id) {
                    return vectors
                  }

                  if (view !== 'model' && load.caseId && load.caseId !== activeCase.id) {
                    return vectors
                  }

                  const raw = new THREE.Vector3(load.vector.x, load.vector.y, load.vector.z)
                  if (!isRenderableLoadVector(raw)) {
                    return vectors
                  }

                  vectors.push(raw.normalize().multiplyScalar(loadArrowLength))
                  return vectors
                }, [])
              : []
            return (
              <group key={element.id}>
                {(view === 'deformed' && showUndeformed) && (
                  <Line color="#64748b" lineWidth={1} points={[undeformedStart.toArray(), undeformedEnd.toArray()]} transparent opacity={0.45} />
                )}
                <ElementTube
                  color={color}
                  end={currentEnd}
                  onClick={() => {
                    onSelectElement(element.id)
                    onSelectNode(null)
                  }}
                  onHover={(hovered) => setHoveredElementId(hovered ? element.id : null)}
                  selected={selectedElementId === element.id}
                  start={currentStart}
                />
                {showElementLabels && (
                  <Html center position={currentStart.clone().add(currentEnd).multiplyScalar(0.5).toArray()}>
                    <div className="rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[10px] font-medium text-foreground shadow-lg dark:border-white/10 dark:bg-slate-950/85">
                      {element.id}
                    </div>
                  </Html>
                )}
                {showLoads && view === 'model' && distributedLoadVectors.map((vector, vectorIndex) => (
                  <DistributedLoadMarker
                    color="#22c55e"
                    key={`${element.id}-distributed-${vectorIndex}`}
                    start={currentStart}
                    end={currentEnd}
                    vector={projectPosition(vector, plane)}
                  />
                ))}
              </group>
            )
          })}

          {snapshot.nodes.map((entry) => {
            const nodeData = nodeMap.get(entry.id)
            if (!nodeData) {
              return null
            }
            const magnitude =
              view === 'reactions'
                ? getNodeReactionMagnitude(activeCase, entry.id)
                : view === 'deformed'
                  ? getNodeDisplacementMagnitude(activeCase, entry.id)
                  : 0
            const color =
              view === 'reactions'
                ? createColorScale(magnitude, maxReaction)
                : view === 'deformed'
                  ? createColorScale(magnitude, maxDisplacement)
                  : selectedNodeId === entry.id
                    ? '#fb923c'
                    : hoveredNodeId === entry.id
                      ? '#67e8f9'
                    : '#f8fafc'
            const position = view === 'deformed' ? nodeData.displacedPosition : nodeData.position
            const finalPosition = projectPosition(position, plane)
            const reaction = activeCase.nodeResults[entry.id]?.reaction
            const arrowVector = reaction
              ? new THREE.Vector3(reaction.fx || 0, reaction.fy || 0, reaction.fz || 0)
                  .multiplyScalar(0.03 / Math.max(maxReaction, 1))
              : null
            const loadVectors = showLoads
              ? snapshot.loads.reduce<THREE.Vector3[]>((vectors, load) => {
                  if (load.nodeId !== entry.id) {
                    return vectors
                  }

                  if (view !== 'model' && load.caseId && load.caseId !== activeCase.id) {
                    return vectors
                  }

                  const raw = new THREE.Vector3(load.vector.x, load.vector.y, load.vector.z)
                  if (!isRenderableLoadVector(raw)) {
                    return vectors
                  }

                  vectors.push(raw.normalize().multiplyScalar(loadArrowLength))
                  return vectors
                }, [])
              : []

            return (
              <group key={entry.id}>
                <mesh
                  onClick={() => {
                    onSelectNode(entry.id)
                    onSelectElement(null)
                  }}
                  onPointerOut={() => setHoveredNodeId(null)}
                  onPointerOver={() => setHoveredNodeId(entry.id)}
                  position={finalPosition.toArray()}
                >
                  <sphereGeometry args={[selectedNodeId === entry.id ? 0.18 : 0.14, 20, 20]} />
                  <meshStandardMaterial color={color} emissive={selectedNodeId === entry.id ? '#f97316' : '#000000'} emissiveIntensity={selectedNodeId === entry.id ? 0.2 : 0} />
                </mesh>
                <mesh
                  onClick={() => {
                    onSelectNode(entry.id)
                    onSelectElement(null)
                  }}
                  onPointerOut={() => setHoveredNodeId(null)}
                  onPointerOver={() => setHoveredNodeId(entry.id)}
                  position={finalPosition.toArray()}
                  visible={false}
                >
                  <sphereGeometry args={[snapshot.dimension === 3 ? 0.36 : 0.3, 16, 16]} />
                  <meshBasicMaterial transparent opacity={0} />
                </mesh>
                {showNodeLabels && (
                  <Html center position={finalPosition.clone().add(new THREE.Vector3(0, snapshot.dimension === 3 ? 0.24 : 0.18, 0)).toArray()}>
                    <div className="rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[10px] font-medium text-foreground shadow-lg dark:border-white/10 dark:bg-slate-950/85">
                      {entry.id}
                    </div>
                  </Html>
                )}
                {view === 'reactions' && arrowVector && arrowVector.length() > 0.0001 && (
                  <VectorArrow color="#fb923c" origin={finalPosition} vector={projectPosition(arrowVector, plane)} />
                )}
                {showLoads && view === 'model' && loadVectors.map((vector, index) => (
                  <VectorArrow
                    color="#22c55e"
                    key={`${entry.id}-load-${index}`}
                    origin={finalPosition}
                    vector={projectPosition(vector, plane)}
                  />
                ))}
              </group>
            )
          })}
        </group>
      </Bounds>
    </>
  )
}

export function StructuralScene(props: StructuralSceneProps) {
  const { snapshot, activeCase, forceMetric, view, showLegend, t } = props

  const webglAvailable = useMemo(() => {
    if (typeof document === 'undefined') {
      return false
    }
    if (process.env.NODE_ENV === 'test') {
      return false
    }
    try {
      const canvas = document.createElement('canvas')
      return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    } catch {
      return false
    }
  }, [])

  const maxElementMetric = useMemo(
    () => Math.max(1, ...snapshot.elements.map((element) => Math.abs(getElementMetric(activeCase, element.id, forceMetric)))),
    [activeCase, forceMetric, snapshot.elements]
  )
  const maxReaction = useMemo(
    () => Math.max(1, ...snapshot.nodes.map((node) => getNodeReactionMagnitude(activeCase, node.id))),
    [activeCase, snapshot.nodes]
  )
  const maxDisplacement = useMemo(
    () => Math.max(1e-12, ...snapshot.nodes.map((node) => getNodeDisplacementMagnitude(activeCase, node.id))),
    [activeCase, snapshot.nodes]
  )

  const invalidElementReferenceCount = useMemo(() => {
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id))
    return snapshot.elements.filter((element) => !nodeIds.has(element.nodeIds[0]) || !nodeIds.has(element.nodeIds[1])).length
  }, [snapshot.elements, snapshot.nodes])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      return
    }
    if (invalidElementReferenceCount <= 0) {
      return
    }
    console.warn('[Visualization] Some elements cannot be rendered because their node references do not exist in the node map.', {
      invalidElementReferenceCount,
      totalElements: snapshot.elements.length,
      totalNodes: snapshot.nodes.length,
    })
  }, [invalidElementReferenceCount, snapshot.elements.length, snapshot.nodes.length])

  const colorBarProps = useMemo(() => {
    if (view === 'forces') {
      const metricLabel = forceMetric === 'axial' ? t('visualizationForceAxial') : forceMetric === 'shear' ? t('visualizationForceShear') : t('visualizationForceMoment')
      const unit = forceMetric === 'moment' ? snapshot.momentUnit : snapshot.resultUnit
      return { maxValue: maxElementMetric, label: metricLabel, unit }
    }
    if (view === 'reactions') {
      return { maxValue: maxReaction, label: t('visualizationReactions'), unit: snapshot.resultUnit }
    }
    if (view === 'deformed') {
      return {
        maxValue: maxDisplacement,
        valueScale: snapshot.displacementDisplayFactor || 1,
        label: t('visualizationDisplacement'),
        unit: snapshot.displacementUnit || snapshot.nodeLabelUnit,
      }
    }
    return null
  }, [view, forceMetric, maxElementMetric, maxReaction, maxDisplacement, snapshot.resultUnit, snapshot.momentUnit, snapshot.displacementDisplayFactor, snapshot.displacementUnit, snapshot.nodeLabelUnit, t])

  if (!webglAvailable) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10 text-center" data-testid="visualization-scene-fallback">
        <div className="max-w-lg rounded-[28px] border border-dashed border-cyan-300/35 bg-cyan-300/8 p-8">
          <div className="text-sm uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-200">{props.t('visualizationTitle')}</div>
          <div className="mt-3 text-2xl font-semibold text-foreground">{props.t('visualizationLoadingScene')}</div>
          <div className="mt-3 text-sm leading-6 text-muted-foreground">{props.t('visualizationWebglFallback')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_24%),linear-gradient(180deg,rgba(148,163,184,0.08),transparent_30%)]">
      {invalidElementReferenceCount > 0 && invalidElementReferenceCount === snapshot.elements.length && (
        <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-lg rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs text-amber-900 shadow-lg dark:text-amber-100">
          <div className="font-semibold">{t('visualizationElementReferenceMismatchTitle')}</div>
          <div className="mt-1 leading-5">{t('visualizationElementReferenceMismatchBody')}</div>
        </div>
      )}
      <Canvas dpr={[1, 1.75]} frameloop="demand" onPointerMissed={props.onClearSelection}>
        <Suspense fallback={null}>
          <SceneContent {...props} maxElementMetric={maxElementMetric} maxReaction={maxReaction} maxDisplacement={maxDisplacement} />
        </Suspense>
      </Canvas>
      {showLegend && colorBarProps && (
        <ColorBar {...colorBarProps} show={true} />
      )}
    </div>
  )
}
