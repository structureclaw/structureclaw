'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { MessageKey } from '@/lib/i18n'
import type { VisualizationCase, VisualizationElement, VisualizationSnapshot, VisualizationViewMode } from './types'

type ForceMetric = 'axial' | 'shear' | 'moment'

type StructuralSceneProps = {
  snapshot: VisualizationSnapshot
  activeCase: VisualizationCase
  deformationScale: number
  forceMetric: ForceMetric
  resetToken: number
  selectedElementId: string | null
  selectedNodeId: string | null
  showElementLabels: boolean
  showLegend: boolean
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

function projectPosition(position: THREE.Vector3, plane: 'xy' | 'xz') {
  return plane === 'xz'
    ? new THREE.Vector3(position.x, position.z, 0)
    : new THREE.Vector3(position.x, position.y, 0)
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

function SceneContent({
  activeCase,
  deformationScale,
  forceMetric,
  resetToken,
  selectedElementId,
  selectedNodeId,
  showElementLabels,
  showLegend,
  showNodeLabels,
  showUndeformed,
  snapshot,
  view,
  onSelectElement,
  onSelectNode,
  onClearSelection,
  t,
}: StructuralSceneProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null)
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

  const maxElementMetric = useMemo(
    () => Math.max(1, ...snapshot.elements.map((element) => Math.abs(getElementMetric(activeCase, element.id, forceMetric)))),
    [activeCase, forceMetric, snapshot.elements]
  )
  const maxReaction = useMemo(
    () => Math.max(1, ...snapshot.nodes.map((node) => getNodeReactionMagnitude(activeCase, node.id))),
    [activeCase, snapshot.nodes]
  )
  const maxDisplacement = useMemo(
    () => Math.max(1, ...snapshot.nodes.map((node) => getNodeDisplacementMagnitude(activeCase, node.id))),
    [activeCase, snapshot.nodes]
  )

  return (
    <>
      {snapshot.dimension === 3 ? (
        <PerspectiveCamera key={`perspective-${resetToken}`} makeDefault fov={42} position={[8, 8, 8]} />
      ) : (
        <OrthographicCamera key={`ortho-${resetToken}`} makeDefault position={[0, 0, 10]} zoom={48} />
      )}
      <ambientLight intensity={0.9} />
      <directionalLight intensity={1.2} position={[10, 12, 8]} />
      <directionalLight intensity={0.45} position={[-8, -4, 10]} />
      <OrbitControls makeDefault />
      <gridHelper args={[24, 24, '#1f9dc2', '#334155']} position={[0, -0.001, 0]} rotation={snapshot.dimension === 3 ? [0, 0, 0] : [Math.PI / 2, 0, 0]} />

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
            const start = (view === 'deformed' && !showUndeformed) ? startData.displacedPosition : startData.position
            const end = (view === 'deformed' && !showUndeformed) ? endData.displacedPosition : endData.position
            const forceColor = createColorScale(getElementMetric(activeCase, element.id, forceMetric), maxElementMetric)
            const color = view === 'forces'
              ? forceColor
              : selectedElementId === element.id
                ? '#fb923c'
                : hoveredElementId === element.id
                  ? '#67e8f9'
                  : '#38bdf8'
            const undeformedStart = snapshot.dimension === 2 ? projectPosition(startData.position, snapshot.plane) : startData.position
            const undeformedEnd = snapshot.dimension === 2 ? projectPosition(endData.position, snapshot.plane) : endData.position
            const currentStart = snapshot.dimension === 2 ? projectPosition(start, snapshot.plane) : start
            const currentEnd = snapshot.dimension === 2 ? projectPosition(end, snapshot.plane) : end

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
            const finalPosition = snapshot.dimension === 2 ? projectPosition(position, snapshot.plane) : position
            const reaction = activeCase.nodeResults[entry.id]?.reaction
            const arrowVector = reaction
              ? new THREE.Vector3(reaction.fx || 0, reaction.fy || 0, reaction.fz || 0)
                  .multiplyScalar(0.03 / Math.max(maxReaction, 1))
              : null
            const loadVectors = snapshot.loads
              .filter((load) => load.nodeId === entry.id && (!load.caseId || load.caseId === activeCase.id))
              .map((load) => new THREE.Vector3(load.vector.x, load.vector.y, load.vector.z).multiplyScalar(0.03))

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
                  <VectorArrow color="#fb923c" origin={finalPosition} vector={snapshot.dimension === 2 ? projectPosition(arrowVector, snapshot.plane) : arrowVector} />
                )}
                {view === 'model' && loadVectors.map((vector, index) => (
                  <VectorArrow
                    color="#22c55e"
                    key={`${entry.id}-load-${index}`}
                    origin={finalPosition}
                    vector={snapshot.dimension === 2 ? projectPosition(vector, snapshot.plane) : vector}
                  />
                ))}
              </group>
            )
          })}
        </group>
      </Bounds>

      {showLegend && (
        <Html position={[0, 0, 0]} wrapperClass="pointer-events-none !absolute !left-4 !top-4">
          <div className="rounded-2xl border border-border/70 bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-lg dark:border-white/10 dark:bg-slate-950/85">
            {view === 'forces' ? `${t('visualizationLegend')}: ${t(view === 'forces' ? 'visualizationForceMetricHint' : 'visualizationLegend')}` : t('visualizationLegend')}
          </div>
        </Html>
      )}
    </>
  )
}

export function StructuralScene(props: StructuralSceneProps) {
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
      <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_24%),linear-gradient(180deg,rgba(148,163,184,0.08),transparent_30%)]">
      <Canvas dpr={[1, 1.75]} frameloop="demand" onPointerMissed={props.onClearSelection}>
        <Suspense fallback={null}>
          <SceneContent {...props} />
        </Suspense>
      </Canvas>
    </div>
  )
}
