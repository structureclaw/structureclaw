'use client'

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bounds, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { MessageKey } from '@/lib/i18n'
import { getBucklingModes, getVisualizationExtensionByView } from './extensions'
import type { BucklingMode, VisualizationCase, VisualizationPlane, VisualizationSnapshot, VisualizationViewMode } from './types'
import {
  type ForceMetric,
  getCaseNodeDisplacement,
  getElementMetric,
  getNodeReactionMagnitude,
  getNodeDisplacementMagnitude,
  getNodeLabelOffset,
  createColorScale,
  createUtilizationColor,
  isRenderableLoadVector as isRenderableLoadVectorCheck,
  getLoadArrowLength,
  getAdaptiveGridConfig,
  projectPosition,
  getPlaneCameraPreset,
} from './structural-scene-utils'

export type SceneExportHandle = {
  /** Capture current frame and trigger PNG download. scale = pixel density multiplier (1 | 2 | 4). onDone is called after the download link is triggered. */
  exportPng: (filename?: string, scale?: 1 | 2 | 4, onDone?: () => void) => void
}

type StructuralSceneProps = {
  snapshot: VisualizationSnapshot
  plane: VisualizationPlane
  activeCase: VisualizationCase
  deformationScale: number
  forceMetric: ForceMetric
  resetToken: number
  selectedElementId: string | null
  selectedLoadIndex?: number | null
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
  /** Optional ref to expose exportPng() to parent. */
  exportRef?: React.MutableRefObject<SceneExportHandle | null>
  /** Active buckling mode index (0-based) when view === 'buckling'. */
  bucklingModeIndex?: number
  t: (key: MessageKey) => string
}

const isRenderableLoadVector = isRenderableLoadVectorCheck

function ColorBar({
  maxValue,
  valueScale = 1,
  unit,
  label,
  show,
  colorMode = 'scale',
}: {
  maxValue: number
  valueScale?: number
  unit?: string
  label: string
  show: boolean
  colorMode?: 'scale' | 'utilization'
}) {
  if (!show) return null

  const formatValue = (val: number) => {
    if (val >= 1000) return val.toFixed(0)
    if (val >= 1) return val.toFixed(2)
    return val.toExponential(1)
  }

  const gradient = colorMode === 'utilization'
    // Matches createUtilizationColor: blue(0%) → green → yellow → red(100%)
    ? 'linear-gradient(to bottom, #d91a1a, #e6b800, #22c55e, #1a6fd9)'
    : `linear-gradient(to bottom, ${createColorScale(maxValue, maxValue)}, ${createColorScale(0, maxValue)})`

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
          style={{ background: gradient }}
        />
      </div>
    </div>
  )
}

function ElementTube({
  color,
  end,
  highlightColor = '#f8fafc',
  onClick,
  onHover,
  selected,
  start,
}: {
  color: string
  end: THREE.Vector3
  highlightColor?: string
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
      {selected ? (
        <mesh>
          <cylinderGeometry args={[0.16, 0.16, Math.max(length, 0.001), 18]} />
          <meshBasicMaterial color={highlightColor} transparent opacity={0.28} />
        </mesh>
      ) : null}
      <mesh onClick={onClick} onPointerOut={() => onHover(false)} onPointerOver={() => onHover(true)}>
        <cylinderGeometry args={[selected ? 0.1 : 0.075, selected ? 0.1 : 0.075, Math.max(length, 0.001), 12]} />
        <meshStandardMaterial color={color} emissive={selected ? highlightColor : '#000000'} emissiveIntensity={selected ? 0.4 : 0} metalness={0.15} roughness={0.32} />
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
  selected = false,
  vector,
}: {
  color: string
  origin: THREE.Vector3
  selected?: boolean
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
          <cylinderGeometry args={[selected ? 0.05 : 0.035, selected ? 0.05 : 0.035, Math.max(length * 0.8, 0.001), 12]} />
          <meshStandardMaterial color={color} emissive={selected ? '#fff7ed' : '#000000'} emissiveIntensity={selected ? 0.45 : 0} />
        </mesh>
      </group>
      <group position={headPosition} quaternion={quaternion}>
        <mesh>
          <coneGeometry args={[selected ? 0.14 : 0.1, Math.max(length * 0.26, 0.08), 12]} />
          <meshStandardMaterial color={color} emissive={selected ? '#fff7ed' : '#000000'} emissiveIntensity={selected ? 0.45 : 0} />
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
  arrowCount = 8,
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
            selected={color === '#f59e0b'}
            vector={vector}
          />
        )
      })}
    </>
  )
}

/** Animated tube for buckling view — updates position/orientation each frame from amplitudeRef. */
function BucklingMember({
  baseStart,
  baseEnd,
  modeStart,
  modeEnd,
  scale,
  amplitudeRef,
  color,
  selected,
  onClick,
  onHover,
}: {
  baseStart: THREE.Vector3
  baseEnd: THREE.Vector3
  modeStart: [number, number, number]
  modeEnd: [number, number, number]
  scale: number
  amplitudeRef: React.MutableRefObject<number>
  color: string
  selected: boolean
  onClick: () => void
  onHover: (hovered: boolean) => void
}) {
  const groupRef = useRef<THREE.Group | null>(null)
  const length = useMemo(() => baseStart.distanceTo(baseEnd), [baseStart, baseEnd])
  const modeStartVec = useMemo(() => new THREE.Vector3(modeStart[0], modeStart[1], modeStart[2]), [modeStart])
  const modeEndVec = useMemo(() => new THREE.Vector3(modeEnd[0], modeEnd[1], modeEnd[2]), [modeEnd])

  // Pre-allocate scratch objects to avoid per-frame GC pressure
  const _s = useRef(new THREE.Vector3())
  const _e = useRef(new THREE.Vector3())
  const _diff = useRef(new THREE.Vector3())
  const _norm = useRef(new THREE.Vector3())
  const _mid = useRef(new THREE.Vector3())
  const _q = useRef(new THREE.Quaternion())
  const _up = useRef(new THREE.Vector3(0, 1, 0))

  useFrame(() => {
    if (!groupRef.current) return
    const amp = amplitudeRef.current
    _s.current.copy(baseStart).addScaledVector(modeStartVec, scale * amp)
    _e.current.copy(baseEnd).addScaledVector(modeEndVec, scale * amp)
    _diff.current.subVectors(_e.current, _s.current)
    _mid.current.addVectors(_s.current, _e.current).multiplyScalar(0.5)
    groupRef.current.position.copy(_mid.current)
    // Copy into scratch _norm then normalize in-place — avoids a per-frame clone() allocation
    _norm.current.copy(_diff.current).normalize()
    _q.current.setFromUnitVectors(_up.current, _norm.current.lengthSq() > 0 ? _norm.current : _up.current)
    groupRef.current.quaternion.copy(_q.current)
  })

  return (
    <group ref={groupRef} position={baseStart.clone().add(baseEnd).multiplyScalar(0.5).toArray()}>
      <mesh onClick={onClick} onPointerOut={() => onHover(false)} onPointerOver={() => onHover(true)}>
        <cylinderGeometry args={[selected ? 0.1 : 0.075, selected ? 0.1 : 0.075, Math.max(length, 0.001), 12]} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.32} />
      </mesh>
    </group>
  )
}

/** R3F component that drives sinusoidal buckling animation via useFrame. */
function BucklingAnimator({ amplitudeRef }: { amplitudeRef: React.MutableRefObject<number> }) {
  useFrame(({ clock }) => {
    amplitudeRef.current = Math.sin(clock.getElapsedTime() * 2.2)
  })
  return null
}

function SceneContent({
  activeCase,
  deformationScale,
  forceMetric,
  resetToken,
  selectedElementId,
  selectedLoadIndex,
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
  rawMaxElementMetric,
  maxReaction,
  maxDisplacement,
  maxUtilization,
  bucklingModeIndex,
  bucklingAmplitudeRef,
}: StructuralSceneProps & {
  maxElementMetric: number
  rawMaxElementMetric: number
  maxReaction: number
  maxDisplacement: number
  maxUtilization: number
  bucklingAmplitudeRef: React.MutableRefObject<number>
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null)
  const gridConfig = useMemo(() => getAdaptiveGridConfig(snapshot, plane), [snapshot, plane])
  const cameraPreset = useMemo(() => getPlaneCameraPreset(plane), [plane])

  // Buckling mode shape for the active mode index
  const activeBucklingMode: BucklingMode | null = useMemo(() => {
    const bucklingModes = getBucklingModes(snapshot)
    if (view !== 'buckling' || !bucklingModes.length) return null
    return bucklingModes[bucklingModeIndex ?? 0] ?? bucklingModes[0]
  }, [view, snapshot, bucklingModeIndex])

  // Compute buckling scale: normalize mode shape so max displacement = 10% of model span
  const bucklingScale = useMemo(() => {
    if (!activeBucklingMode) return 1
    const modeShape = activeBucklingMode.modeShape
    const maxMag = Math.max(
      1e-12,
      ...Object.values(modeShape).map(([dx, dy, dz]) => Math.sqrt(dx * dx + dy * dy + dz * dz))
    )
    const xs = snapshot.nodes.map((n) => n.position.x)
    const ys = snapshot.nodes.map((n) => n.position.y)
    const zs = snapshot.nodes.map((n) => n.position.z)
    const span = Math.max(
      1,
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      Math.max(...zs) - Math.min(...zs)
    )
    return (span * 0.1) / maxMag
  }, [activeBucklingMode, snapshot.nodes])

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
  const selectedFocusPoint = useMemo(() => {
    if (selectedElementId) {
      const element = snapshot.elements.find((entry) => entry.id === selectedElementId)
      if (element) {
        const startData = nodeMap.get(element.nodeIds[0])
        const endData = nodeMap.get(element.nodeIds[1])
        if (startData && endData) {
          const start = view === 'deformed' ? startData.displacedPosition : startData.position
          const end = view === 'deformed' ? endData.displacedPosition : endData.position
          return projectPosition(start.clone().add(end).multiplyScalar(0.5), plane, snapshot.dimension)
        }
      }
    }

    if (selectedNodeId) {
      const nodeData = nodeMap.get(selectedNodeId)
      if (nodeData) {
        const position = view === 'deformed' ? nodeData.displacedPosition : nodeData.position
        return projectPosition(position, plane, snapshot.dimension)
      }
    }

    if (selectedLoadIndex !== null && selectedLoadIndex !== undefined) {
      const selectedLoad = snapshot.loads[selectedLoadIndex]
      if (selectedLoad?.elementId) {
        const element = snapshot.elements.find((entry) => entry.id === selectedLoad.elementId)
        if (element) {
          const startData = nodeMap.get(element.nodeIds[0])
          const endData = nodeMap.get(element.nodeIds[1])
          if (startData && endData) {
            return projectPosition(startData.position.clone().add(endData.position).multiplyScalar(0.5), plane, snapshot.dimension)
          }
        }
      }
      if (selectedLoad?.nodeId) {
        const nodeData = nodeMap.get(selectedLoad.nodeId)
        if (nodeData) {
          return projectPosition(nodeData.position, plane, snapshot.dimension)
        }
      }
    }

    return null
  }, [selectedElementId, selectedNodeId, selectedLoadIndex, snapshot.loads, snapshot.elements, snapshot.dimension, nodeMap, plane, view])

  return (
    <>
      {snapshot.dimension === 3 ? (
        <PerspectiveCamera
          key={`perspective-${plane}-${resetToken}`}
          makeDefault
          fov={42}
          position={[8, 8, 8]}
          onUpdate={(camera) => {
            camera.up.set(0, 0, 1)
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
      <FocusController focusTarget={selectedFocusPoint} resetToken={resetToken} />
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
            // In buckling view, positions are animated via BucklingMember component.
            const start = view === 'deformed' ? startData.displacedPosition : startData.position
            const end = view === 'deformed' ? endData.displacedPosition : endData.position
            const forceColor = rawMaxElementMetric > 0
              ? createColorScale(getElementMetric(activeCase, element.id, forceMetric), maxElementMetric)
              : '#38bdf8'
            const utilizationRatio = activeCase.elementResults[element.id]?.utilization ?? null
            const utilizationColor = utilizationRatio !== null
              ? createUtilizationColor(utilizationRatio)
              : createUtilizationColor(0)
            const deformedColor = (() => {
              if (selectedElementId === element.id) return '#fb923c'
              if (hoveredElementId === element.id) return '#67e8f9'
              const mag0 = getNodeDisplacementMagnitude(activeCase, element.nodeIds[0])
              const mag1 = getNodeDisplacementMagnitude(activeCase, element.nodeIds[1])
              return createColorScale((mag0 + mag1) / 2, maxDisplacement)
            })()
            const color = view === 'forces'
              ? forceColor
              : view === 'utilization'
                ? (selectedElementId === element.id ? '#fb923c' : hoveredElementId === element.id ? '#67e8f9' : utilizationColor)
                : view === 'deformed'
                  ? deformedColor
                  : view === 'buckling'
                    ? (selectedElementId === element.id ? '#fb923c' : hoveredElementId === element.id ? '#67e8f9' : '#a78bfa')
                    : selectedElementId === element.id
                      ? '#fb923c'
                      : hoveredElementId === element.id
                        ? '#67e8f9'
                        : '#38bdf8'
            const undeformedStart = projectPosition(startData.position, plane, snapshot.dimension)
            const undeformedEnd = projectPosition(endData.position, plane, snapshot.dimension)
            const currentStart = projectPosition(start, plane, snapshot.dimension)
            const currentEnd = projectPosition(end, plane, snapshot.dimension)
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

                  vectors.push(projectPosition(raw.normalize().multiplyScalar(loadArrowLength), plane, snapshot.dimension))
                  return vectors
                }, [])
              : []
            return (
              <group key={element.id}>
                {(view === 'deformed' && showUndeformed) && (
                  <Line color="#64748b" lineWidth={1} points={[undeformedStart.toArray(), undeformedEnd.toArray()]} transparent opacity={0.45} />
                )}
                {view === 'buckling' && activeBucklingMode ? (
                  <BucklingMember
                    amplitudeRef={bucklingAmplitudeRef}
                    baseStart={currentStart}
                    baseEnd={currentEnd}
                    modeStart={activeBucklingMode.modeShape[element.nodeIds[0]] ?? [0, 0, 0]}
                    modeEnd={activeBucklingMode.modeShape[element.nodeIds[1]] ?? [0, 0, 0]}
                    scale={bucklingScale}
                    color={color}
                    selected={selectedElementId === element.id}
                    onClick={() => {
                      onSelectElement(element.id)
                      onSelectNode(null)
                    }}
                    onHover={(hovered) => setHoveredElementId(hovered ? element.id : null)}
                  />
                ) : (
                  <ElementTube
                    color={color}
                    end={currentEnd}
                    highlightColor={view === 'utilization' ? '#fff7ed' : '#f8fafc'}
                    onClick={() => {
                      onSelectElement(element.id)
                      onSelectNode(null)
                    }}
                    onHover={(hovered) => setHoveredElementId(hovered ? element.id : null)}
                    selected={selectedElementId === element.id}
                    start={currentStart}
                  />
                )}
                {showElementLabels && (
                  <Html center position={currentStart.clone().add(currentEnd).multiplyScalar(0.5).toArray()}>
                    <div className="rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[10px] font-medium text-foreground shadow-lg dark:border-white/10 dark:bg-slate-950/85">
                      {element.id}
                    </div>
                  </Html>
                )}
                {showLoads && distributedLoadVectors.map((vector, vectorIndex) => (
                  <DistributedLoadMarker
                    color={typeof selectedLoadIndex === 'number' && snapshot.loads[selectedLoadIndex]?.elementId === element.id ? '#f59e0b' : '#22c55e'}
                    key={`${element.id}-distributed-${vectorIndex}`}
                    start={currentStart}
                    end={currentEnd}
                    vector={projectPosition(vector, plane, snapshot.dimension)}
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
            const finalPosition = projectPosition(position, plane, snapshot.dimension)
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

                  vectors.push(projectPosition(raw.normalize().multiplyScalar(loadArrowLength), plane, snapshot.dimension))
                  return vectors
                }, [])
              : []

            return (
              <group key={entry.id}>
                {selectedNodeId === entry.id ? (
                  <mesh position={finalPosition.toArray()}>
                    <sphereGeometry args={[snapshot.dimension === 3 ? 0.34 : 0.28, 24, 24]} />
                    <meshBasicMaterial color="#fff7ed" transparent opacity={0.26} />
                  </mesh>
                ) : null}
                <mesh
                  onClick={() => {
                    onSelectNode(entry.id)
                    onSelectElement(null)
                  }}
                  onPointerOut={() => setHoveredNodeId(null)}
                  onPointerOver={() => setHoveredNodeId(entry.id)}
                  position={finalPosition.toArray()}
                >
                  <sphereGeometry args={[selectedNodeId === entry.id ? 0.23 : 0.14, 20, 20]} />
                  <meshStandardMaterial color={color} emissive={selectedNodeId === entry.id ? '#fff7ed' : '#000000'} emissiveIntensity={selectedNodeId === entry.id ? 0.45 : 0} />
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
                  <Html center position={finalPosition.clone().add(getNodeLabelOffset(plane, snapshot.dimension)).toArray()}>
                    <div className="rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[10px] font-medium text-foreground shadow-lg dark:border-white/10 dark:bg-slate-950/85">
                      {entry.id}
                    </div>
                  </Html>
                )}
                {view === 'reactions' && arrowVector && arrowVector.length() > 0.0001 && (
                  <VectorArrow color="#fb923c" origin={finalPosition} vector={projectPosition(arrowVector, plane, snapshot.dimension)} />
                )}
                {showLoads && loadVectors.map((vector, index) => (
                  <VectorArrow
                    color={typeof selectedLoadIndex === 'number' && snapshot.loads[selectedLoadIndex]?.nodeId === entry.id ? '#f59e0b' : '#22c55e'}
                    key={`${entry.id}-load-${index}`}
                    origin={finalPosition.clone().sub(vector.clone().multiplyScalar(0.22))}
                    selected={typeof selectedLoadIndex === 'number' && snapshot.loads[selectedLoadIndex]?.nodeId === entry.id}
                    vector={projectPosition(vector, plane, snapshot.dimension)}
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

/** Internal R3F component that captures gl and invalidate into parent refs. */
function PngExporter({
  glRef,
  invalidateRef,
}: {
  glRef: React.MutableRefObject<THREE.WebGLRenderer | null>
  invalidateRef: React.MutableRefObject<(() => void) | null>
}) {
  const { gl, invalidate } = useThree()
  useEffect(() => {
    glRef.current = gl
    invalidateRef.current = invalidate
  }, [gl, glRef, invalidate, invalidateRef])
  return null
}

function FocusController({
  focusTarget,
  resetToken,
}: {
  focusTarget: THREE.Vector3 | null
  resetToken: number
}) {
  const { camera, controls } = useThree()

  useEffect(() => {
    if (!focusTarget || !controls) {
      return
    }

    const orbitControls = controls as unknown as {
      target: THREE.Vector3
      update: () => void
    }
    const direction = camera.position.clone().sub(orbitControls.target)
    if (direction.lengthSq() <= 1e-8) {
      direction.set(1, 1, 1)
    }
    const nextPosition = focusTarget.clone().add(direction)
    camera.position.copy(nextPosition)
    orbitControls.target.copy(focusTarget)
    orbitControls.update()
  }, [camera, controls, focusTarget, resetToken])

  return null
}

export function StructuralScene(props: StructuralSceneProps) {
  const { snapshot, activeCase, forceMetric, view, showLegend, t, exportRef, bucklingModeIndex } = props

  // Internal ref to the gl renderer; populated by PngExporter inside Canvas
  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  const invalidateRef = useRef<(() => void) | null>(null)
  // Shared amplitude ref for buckling animation — written by BucklingAnimator, read by BucklingMember
  const bucklingAmplitudeRef = useRef<number>(0)

  // Expose exportPng via the forwarded ref
  useEffect(() => {
    if (!exportRef) return
    const handle: SceneExportHandle = {
      exportPng: (filename = 'structureclaw-scene', scale = 1, onDone?: () => void) => {
        const gl = glRef.current
        const invalidate = invalidateRef.current
        if (!gl) return
        if (scale === 1) {
          // 1x: just capture current frame
          if (invalidate) invalidate()
          requestAnimationFrame(() => {
            const dataUrl = gl.domElement.toDataURL('image/png')
            const link = document.createElement('a')
            link.href = dataUrl
            link.download = `${filename}.png`
            link.click()
            onDone?.()
          })
          return
        }
        // 2x / 4x: temporarily upscale the renderer
        const origW = gl.domElement.width
        const origH = gl.domElement.height
        const origRatio = gl.getPixelRatio()
        gl.setPixelRatio(origRatio * scale)
        gl.setSize(origW / origRatio, origH / origRatio, false)
        if (invalidate) invalidate()
        requestAnimationFrame(() => {
          const dataUrl = gl.domElement.toDataURL('image/png')
          // restore
          gl.setPixelRatio(origRatio)
          gl.setSize(origW / origRatio, origH / origRatio, false)
          if (invalidate) invalidate()
          const link = document.createElement('a')
          link.href = dataUrl
          link.download = `${filename}@${scale}x.png`
          link.click()
          onDone?.()
        })
      },
    }
    exportRef.current = handle
    return () => {
      exportRef.current = null
    }
  }, [exportRef])

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

  const rawMaxElementMetric = useMemo(
    () => Math.max(0, ...snapshot.elements.map((element) => Math.abs(getElementMetric(activeCase, element.id, forceMetric)))),
    [activeCase, forceMetric, snapshot.elements]
  )
  const maxElementMetric = Math.max(1, rawMaxElementMetric)
  const maxReaction = useMemo(
    () => Math.max(1, ...snapshot.nodes.map((node) => getNodeReactionMagnitude(activeCase, node.id))),
    [activeCase, snapshot.nodes]
  )
  const maxDisplacement = useMemo(
    () => Math.max(1e-12, ...snapshot.nodes.map((node) => getNodeDisplacementMagnitude(activeCase, node.id))),
    [activeCase, snapshot.nodes]
  )
  const maxUtilization = useMemo(
    () => Math.max(1, ...snapshot.elements.map((element) => activeCase.elementResults[element.id]?.utilization ?? 0)),
    [activeCase, snapshot.elements]
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
      if (rawMaxElementMetric <= 0) return null
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
    if (view === 'utilization') {
      return getVisualizationExtensionByView('utilization')?.getLegend?.({
        snapshot,
        activeCase,
        activeView: view,
        bucklingModeIndex: bucklingModeIndex ?? 0,
        forceMetric,
        t,
      }) || null
    }
    if (view === 'buckling') {
      const modes = getBucklingModes(snapshot)
      if (modes?.length) {
        const mode = modes[bucklingModeIndex ?? 0] ?? modes[0]
        return {
          maxValue: mode.lambda,
          valueScale: 1,
          label: `λ${(bucklingModeIndex ?? 0) + 1}`,
          unit: '',
        }
      }
    }
    return null
  }, [view, forceMetric, maxElementMetric, rawMaxElementMetric, maxReaction, maxDisplacement, snapshot, activeCase, bucklingModeIndex, t])

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
      <Canvas dpr={[1, 1.75]} frameloop={view === 'buckling' ? 'always' : 'demand'} gl={{ preserveDrawingBuffer: true }} onPointerMissed={props.onClearSelection}>
        <PngExporter glRef={glRef} invalidateRef={invalidateRef} />
        {view === 'buckling' && <BucklingAnimator amplitudeRef={bucklingAmplitudeRef} />}
        <Suspense fallback={null}>
          <SceneContent {...props} maxElementMetric={maxElementMetric} rawMaxElementMetric={rawMaxElementMetric} maxReaction={maxReaction} maxDisplacement={maxDisplacement} maxUtilization={maxUtilization} bucklingAmplitudeRef={bucklingAmplitudeRef} />
        </Suspense>
      </Canvas>
      {showLegend && colorBarProps && (
        <ColorBar {...colorBarProps} show={true} />
      )}
    </div>
  )
}
