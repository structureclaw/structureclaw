import type {
  BucklingMode,
  VisualizationCase,
  VisualizationElement,
  VisualizationElementResults,
  VisualizationExtensionMap,
  VisualizationLoad,
  VisualizationLocalAxes,
  VisualizationNode,
  VisualizationNodeResults,
  VisualizationPlane,
  VisualizationSource,
  VisualizationSnapshot,
  VisualizationVector3,
  VisualizationViewMode,
} from './types'
import { normalizeVisualizationSnapshot } from './normalization'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asStringId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function getByPath(source: Record<string, unknown> | null, path: string): unknown {
  if (!source) {
    return null
  }
  const segments = path.split('.')
  let current: unknown = source
  for (const segment of segments) {
    const record = asRecord(current)
    if (!record) {
      return null
    }
    current = record[segment]
  }
  return current
}

function pickNumber(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return null
  for (const key of keys) {
    const value = asNumber(key.includes('.') ? getByPath(source, key) : source[key])
    if (value !== null) {
      return value
    }
  }
  return null
}

function pickNodeCoordinate(node: Record<string, unknown> | null, axis: 'x' | 'y' | 'z') {
  return node ? asNumber(node[axis]) : null
}

function pickElementNodeIds(element: Record<string, unknown> | null): string[] | null {
  if (!element || !Array.isArray(element.nodes)) {
    return null
  }
  const normalized = element.nodes.map((value) => asStringId(value))
  if (normalized.some((value) => value === null)) {
    return null
  }
  return normalized as string[]
}

function vectorMagnitude(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (filtered.length === 0) {
    return 0
  }
  return Math.sqrt(filtered.reduce((sum, value) => sum + value ** 2, 0))
}

const COORDINATE_TOLERANCE = 1e-9

function cleanCoordinate(value: number) {
  return Math.abs(value) <= COORDINATE_TOLERANCE ? 0 : value
}

function vectorLength(vector: VisualizationVector3) {
  return Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2)
}

function normalizeVector(vector: VisualizationVector3): VisualizationVector3 | null {
  const length = vectorLength(vector)
  if (!Number.isFinite(length) || length <= COORDINATE_TOLERANCE) {
    return null
  }
  return {
    x: cleanCoordinate(vector.x / length),
    y: cleanCoordinate(vector.y / length),
    z: cleanCoordinate(vector.z / length),
  }
}

function dotVector(left: VisualizationVector3, right: VisualizationVector3) {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function crossVector(left: VisualizationVector3, right: VisualizationVector3): VisualizationVector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

function scaleAndAdd(
  left: VisualizationVector3,
  leftScale: number,
  right: VisualizationVector3,
  rightScale: number,
): VisualizationVector3 {
  return {
    x: left.x * leftScale + right.x * rightScale,
    y: left.y * leftScale + right.y * rightScale,
    z: left.z * leftScale + right.z * rightScale,
  }
}

function transformLocalVectorToGlobal(vector: VisualizationVector3, axes: VisualizationLocalAxes): VisualizationVector3 {
  return {
    x: cleanCoordinate(axes.x.x * vector.x + axes.y.x * vector.y + axes.z.x * vector.z),
    y: cleanCoordinate(axes.x.y * vector.x + axes.y.y * vector.y + axes.z.y * vector.z),
    z: cleanCoordinate(axes.x.z * vector.x + axes.y.z * vector.y + axes.z.z * vector.z),
  }
}

function parseVector3(value: unknown): VisualizationVector3 | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return null
  }
  const [x, y, z] = value.map((component) => asNumber(component))
  return x !== null && y !== null && z !== null ? { x, y, z } : null
}

function buildElementLocalAxes(params: {
  start: VisualizationVector3
  end: VisualizationVector3
  dimension: 2 | 3
  referenceVector?: VisualizationVector3 | null
  rotationDegrees?: number | null
}): VisualizationLocalAxes | null {
  const localX = normalizeVector({
    x: params.end.x - params.start.x,
    y: params.end.y - params.start.y,
    z: params.end.z - params.start.z,
  })
  if (!localX) {
    return null
  }

  if (params.dimension === 2) {
    if (Math.abs(localX.y) > COORDINATE_TOLERANCE || Math.abs(params.rotationDegrees || 0) > COORDINATE_TOLERANCE) {
      return null
    }
    const localY = { x: 0, y: 1, z: 0 }
    const localZ = normalizeVector(crossVector(localX, localY))
    return localZ ? { x: localX, y: localY, z: localZ } : null
  }

  let reference = params.referenceVector
    ? normalizeVector(params.referenceVector)
    : null
  if (params.referenceVector && !reference) {
    return null
  }
  if (!reference) {
    reference = { x: 0, y: 0, z: 1 }
    if (Math.abs(dotVector(localX, reference)) > 0.9) {
      reference = { x: 1, y: 0, z: 0 }
    }
  }

  let localY = normalizeVector(crossVector(reference, localX))
  if (!localY) {
    return null
  }
  let localZ = normalizeVector(crossVector(localX, localY))
  if (!localZ) {
    return null
  }

  const angle = params.rotationDegrees || 0
  if (Math.abs(angle) > COORDINATE_TOLERANCE) {
    const radians = angle * Math.PI / 180
    const cosine = Math.cos(radians)
    const sine = Math.sin(radians)
    const rotatedY = normalizeVector(scaleAndAdd(localY, cosine, localZ, sine))
    const rotatedZ = normalizeVector(scaleAndAdd(localY, -sine, localZ, cosine))
    if (!rotatedY || !rotatedZ) {
      return null
    }
    localY = rotatedY
    localZ = rotatedZ
  }

  return { x: localX, y: localY, z: localZ }
}

function parseRestraints(value: unknown): boolean[] | null | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Array.isArray(value) || value.length !== 6 || !value.every((entry) => typeof entry === 'boolean')) {
    return null
  }
  return [...value]
}

function compactNumberRecord<T extends string>(entries: Array<[T, number | null]>) {
  return Object.fromEntries(entries.filter(([, value]) => value !== null)) as Partial<Record<T, number>>
}

function flattenEndForces(source: Record<string, unknown> | null) {
  if (!source) {
    return {}
  }
  const flattened: Record<string, number> = {}
  Object.entries(source).forEach(([key, value]) => {
    const direct = asNumber(value)
    if (direct !== null) {
      flattened[key] = direct
      return
    }
    const nested = asRecord(value)
    if (!nested) {
      return
    }
    Object.entries(nested).forEach(([nestedKey, nestedValue]) => {
      const numeric = asNumber(nestedValue)
      if (numeric !== null) {
        flattened[`${key}.${nestedKey}`] = numeric
      }
    })
  })
  return flattened
}

function extractElementMetrics(entry: Record<string, unknown> | null): VisualizationElementResults {
  const flat = flattenEndForces(entry)
  const flatValues = Object.values(flat)
  const shearCandidates = [
    flat.V,
    flat.Vy,
    flat.Vz,
    flat['n1.V'],
    flat['n2.V'],
    flat['n1.Vy'],
    flat['n2.Vy'],
    flat['n1.Vz'],
    flat['n2.Vz'],
    flat['n1.Fy'],
    flat['n2.Fy'],
    flat['n1.Fz'],
    flat['n2.Fz'],
  ].filter((value): value is number => typeof value === 'number')
  const momentCandidates = [
    flat.M,
    flat.My,
    flat.Mz,
    flat['n1.M'],
    flat['n2.M'],
    flat['n1.My'],
    flat['n2.My'],
    flat['n1.Mz'],
    flat['n2.Mz'],
  ].filter((value): value is number => typeof value === 'number')

  return {
    axial: pickNumber(entry, ['axial', 'N']) ?? undefined,
    shear: shearCandidates.length ? Math.max(...shearCandidates.map((value) => Math.abs(value))) : undefined,
    moment: momentCandidates.length ? Math.max(...momentCandidates.map((value) => Math.abs(value))) : undefined,
    torsion: pickNumber(entry, ['torsion', 'T', 'Mx']) ?? undefined,
    endForces: flatValues.length ? flat : undefined,
  }
}

function extractNodeResults(entry: Record<string, unknown> | null): VisualizationNodeResults {
  return {
    displacement: entry
      ? compactNumberRecord([
          ['ux', pickNumber(entry, ['ux'])],
          ['uy', pickNumber(entry, ['uy'])],
          ['uz', pickNumber(entry, ['uz'])],
          ['rx', pickNumber(entry, ['rx'])],
          ['ry', pickNumber(entry, ['ry'])],
          ['rz', pickNumber(entry, ['rz'])],
        ])
      : undefined,
    reaction: entry
      ? compactNumberRecord([
          ['fx', pickNumber(entry, ['fx'])],
          ['fy', pickNumber(entry, ['fy'])],
          ['fz', pickNumber(entry, ['fz'])],
          ['mx', pickNumber(entry, ['mx'])],
          ['my', pickNumber(entry, ['my'])],
          ['mz', pickNumber(entry, ['mz'])],
        ])
      : undefined,
  }
}

function buildCase(
  id: string,
  label: string,
  kind: VisualizationCase['kind'],
  displacementsInput: Record<string, unknown> | null,
  reactionsInput: Record<string, unknown> | null,
  forcesInput: Record<string, unknown> | null,
  envelopeInput?: Record<string, unknown> | null
): VisualizationCase {
  const nodeResults: Record<string, VisualizationNodeResults> = {}
  const elementResults: Record<string, VisualizationElementResults> = {}

  Object.entries(displacementsInput || {}).forEach(([nodeId, value]) => {
    nodeResults[nodeId] = {
      ...(nodeResults[nodeId] || {}),
      ...extractNodeResults(asRecord(value)),
    }
  })

  Object.entries(reactionsInput || {}).forEach(([nodeId, value]) => {
    nodeResults[nodeId] = {
      ...(nodeResults[nodeId] || {}),
      reaction: extractNodeResults(asRecord(value)).reaction,
    }
  })

  Object.entries(forcesInput || {}).forEach(([elementId, value]) => {
    elementResults[elementId] = {
      ...(elementResults[elementId] || {}),
      ...extractElementMetrics(asRecord(value)),
    }
  })

  const envelope = asRecord(envelopeInput)
  if (envelope) {
    Object.entries(nodeResults).forEach(([nodeId, entry]) => {
      const maxAbsDisplacement = asNumber(envelope[`node:${nodeId}:maxAbsDisplacement`])
      const maxAbsReaction = asNumber(envelope[`node:${nodeId}:maxAbsReaction`])
      if (maxAbsDisplacement !== null || maxAbsReaction !== null) {
        entry.envelope = {
          ...(entry.envelope || {}),
          ...(maxAbsDisplacement !== null ? { maxAbsDisplacement } : {}),
          ...(maxAbsReaction !== null ? { maxAbsReaction } : {}),
        }
      }
    })
  }

  return { id, label, kind, nodeResults, elementResults }
}

function applyEnvelopeTables(target: VisualizationCase, envelopeTables: Record<string, unknown> | null) {
  if (!envelopeTables) {
    return
  }

  const nodeDisplacement = asRecord(envelopeTables.nodeDisplacement)
  Object.entries(nodeDisplacement || {}).forEach(([nodeId, value]) => {
    const entry = asRecord(value)
    if (!entry) {
      return
    }
    target.nodeResults[nodeId] = {
      ...(target.nodeResults[nodeId] || {}),
      envelope: {
        ...(target.nodeResults[nodeId]?.envelope || {}),
        ...(pickNumber(entry, ['maxAbsDisplacement']) !== null ? { maxAbsDisplacement: pickNumber(entry, ['maxAbsDisplacement']) as number } : {}),
        ...(typeof entry.controlCase === 'string' ? { controlCase: entry.controlCase } : {}),
      },
    }
  })

  const nodeReaction = asRecord(envelopeTables.nodeReaction)
  Object.entries(nodeReaction || {}).forEach(([nodeId, value]) => {
    const entry = asRecord(value)
    if (!entry) {
      return
    }
    target.nodeResults[nodeId] = {
      ...(target.nodeResults[nodeId] || {}),
      envelope: {
        ...(target.nodeResults[nodeId]?.envelope || {}),
        ...(pickNumber(entry, ['maxAbsReaction']) !== null ? { maxAbsReaction: pickNumber(entry, ['maxAbsReaction']) as number } : {}),
        ...(typeof entry.controlCase === 'string' ? { controlCaseReaction: entry.controlCase } : {}),
      },
    }
  })

  const elementForce = asRecord(envelopeTables.elementForce)
  Object.entries(elementForce || {}).forEach(([elementId, value]) => {
    const entry = asRecord(value)
    if (!entry) {
      return
    }
    target.elementResults[elementId] = {
      ...(target.elementResults[elementId] || {}),
      envelope: {
        ...(target.elementResults[elementId]?.envelope || {}),
        ...(pickNumber(entry, ['maxAbsAxialForce']) !== null ? { maxAbsAxialForce: pickNumber(entry, ['maxAbsAxialForce']) as number } : {}),
        ...(pickNumber(entry, ['maxAbsShearForce']) !== null ? { maxAbsShearForce: pickNumber(entry, ['maxAbsShearForce']) as number } : {}),
        ...(pickNumber(entry, ['maxAbsMoment']) !== null ? { maxAbsMoment: pickNumber(entry, ['maxAbsMoment']) as number } : {}),
      },
      controlCases: {
        ...(target.elementResults[elementId]?.controlCases || {}),
        ...(typeof entry.controlCaseAxial === 'string' ? { axial: entry.controlCaseAxial } : {}),
        ...(typeof entry.controlCaseShear === 'string' ? { shear: entry.controlCaseShear } : {}),
        ...(typeof entry.controlCaseMoment === 'string' ? { moment: entry.controlCaseMoment } : {}),
      },
    }
  })
}

function nearlyEqual(left: number, right: number, tolerance = 1e-6) {
  return Math.abs(left - right) <= tolerance
}

function getStoryFloorLoadComponents(story: Record<string, unknown>): Array<{ type: string; value: number }> {
  const components: Array<{ type: string; value: number }> = []
  const seenTypes = new Set<string>()
  const floorLoads = Array.isArray(story.floor_loads) ? story.floor_loads : []

  floorLoads.forEach((entry) => {
    const record = asRecord(entry)
    const value = pickNumber(record, ['value'])
    if (!record || value === null || Math.abs(value) <= 1e-12) {
      return
    }
    if (value < 0) {
      throw new Error('Story floor-load intensities must be nonnegative')
    }
    const type = asNonEmptyString(record.type)?.toLowerCase() || 'other'
    components.push({ type, value })
    seenTypes.add(type)
  })

  const fallbackFields: Array<[string, string]> = [
    ['dead_load', 'dead'],
    ['live_load', 'live'],
  ]
  fallbackFields.forEach(([field, type]) => {
    if (seenTypes.has(type)) {
      return
    }
    const value = pickNumber(story, [field])
    if (value !== null && Math.abs(value) > 1e-12) {
      if (value < 0) {
        throw new Error('Story floor-load intensities must be nonnegative')
      }
      components.push({ type, value })
    }
  })

  return components
}

function getFloorAreaLoads(model: Record<string, unknown> | null, nodes: VisualizationNode[]): VisualizationLoad[] {
  const stories = Array.isArray(model?.stories) ? model.stories : []
  if (!stories.length || nodes.length < 4) {
    return []
  }

  const rawNodes = Array.isArray(model?.nodes) ? model.nodes : []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const rawNodeById = new Map<string, Record<string, unknown>>()
  rawNodes.forEach((entry) => {
    const record = asRecord(entry)
    const id = asStringId(record?.id)
    if (record && id) {
      rawNodeById.set(id, record)
    }
  })

  const loads: VisualizationLoad[] = []
  stories.forEach((entry, storyIndex) => {
    const story = asRecord(entry)
    if (!story) {
      return
    }

    const components = getStoryFloorLoadComponents(story)
    const intensity = components.reduce((sum, component) => sum + component.value, 0)
    if (Math.abs(intensity) <= 1e-12) {
      return
    }

    const storyId = asStringId(story.id)
    if (!storyId) {
      throw new Error(`Story at index ${storyIndex} must have a non-empty id`)
    }
    const height = pickNumber(story, ['height'])
    const baseElevation = pickNumber(story, ['elevation'])
    if (height === null || height <= 0 || baseElevation === null) {
      throw new Error(`Story '${storyId}' must declare finite elevation and positive height`)
    }
    const floorElevation = baseElevation + height

    const storyNodeIds = new Set<string>()
    rawNodeById.forEach((rawNode, nodeId) => {
      const rawStoryId = asStringId(rawNode.story)
      const z = pickNodeCoordinate(rawNode, 'z')
      if (
        z !== null
        && nearlyEqual(z, floorElevation)
        && (rawStoryId === null || rawStoryId === storyId)
      ) {
        storyNodeIds.add(nodeId)
      }
    })

    const floorNodes = Array.from(storyNodeIds)
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is VisualizationNode => Boolean(node))
    if (floorNodes.length < 4) {
      return
    }

    const coordinateKey = (value: number) => value.toFixed(9)
    const uniqueX = Array.from(new Set(floorNodes.map((node) => coordinateKey(node.position.x))))
    const uniqueY = Array.from(new Set(floorNodes.map((node) => coordinateKey(node.position.y))))
    const planCoordinates = new Set(
      floorNodes.map((node) => `${coordinateKey(node.position.x)}:${coordinateKey(node.position.y)}`),
    )
    if (
      planCoordinates.size !== floorNodes.length
      || planCoordinates.size !== uniqueX.length * uniqueY.length
      || uniqueX.some((x) => uniqueY.some((y) => !planCoordinates.has(`${x}:${y}`)))
    ) {
      // A story without a complete rectangular Cartesian grid has no exact
      // footprint polygon in the current schema.  Its explicit nodal/member
      // loads remain renderable, but an inferred area polygon would be wrong.
      return
    }

    const minX = Math.min(...floorNodes.map((node) => node.position.x))
    const maxX = Math.max(...floorNodes.map((node) => node.position.x))
    const minY = Math.min(...floorNodes.map((node) => node.position.y))
    const maxY = Math.max(...floorNodes.map((node) => node.position.y))
    if (maxX - minX <= 1e-6 || maxY - minY <= 1e-6) {
      return
    }

    const z = floorElevation
    const area = (maxX - minX) * (maxY - minY)
    loads.push({
      kind: 'area',
      storyId,
      label: storyId,
      intensity,
      area,
      components,
      vector: {
        x: 0,
        y: 0,
        z: -intensity,
      },
      polygon: [
        { x: minX, y: minY, z },
        { x: maxX, y: minY, z },
        { x: maxX, y: maxY, z },
        { x: minX, y: maxY, z },
      ],
    })
  })

  return loads
}

function resolveTargetAlias(load: Record<string, unknown>, keys: string[], label: string): string | null {
  const values = keys
    .filter((key) => load[key] !== undefined && load[key] !== null)
    .map((key) => asStringId(load[key]))
  if (values.some((value) => value === null)) {
    throw new Error(`${label} target must have a non-empty id`)
  }
  const unique = Array.from(new Set(values as string[]))
  if (unique.length > 1) {
    throw new Error(`${label} contains conflicting target aliases`)
  }
  return unique[0] || null
}

function resolveNumericAliases(
  load: Record<string, unknown>,
  keys: string[],
  label: string,
  fallback = 0,
): number {
  const values = keys
    .filter((key) => load[key] !== undefined && load[key] !== null)
    .map((key) => {
      const value = asNumber(load[key])
      if (value === null) throw new Error(`${label} must be finite`)
      return value
    })
  if (!values.length) return fallback
  if (values.some((value) => Math.abs(value - values[0]) > COORDINATE_TOLERANCE)) {
    throw new Error(`${label} has conflicting aliases`)
  }
  return values[0]
}

function resolveDirectionalMagnitude(
  load: Record<string, unknown>,
  componentKeys: string[],
  magnitudeKeys: string[],
  label: string,
): number {
  const keys = [...magnitudeKeys, ...componentKeys]
  const present = keys.filter((key) => load[key] !== undefined && load[key] !== null)
  if (!present.length) throw new Error(`${label} requires a finite magnitude`)
  return resolveNumericAliases(load, present, label)
}

function resolveNodalLoadVectors(load: Record<string, unknown>): {
  force: VisualizationVector3
  moment: VisualizationVector3
} {
  if (load.forces !== undefined) {
    if (!Array.isArray(load.forces) || load.forces.length !== 6) {
      throw new Error('Nodal load forces must contain [fx, fy, fz, mx, my, mz]')
    }
    if (
      ['fx', 'fy', 'fz', 'mx', 'my', 'mz', 'value', 'magnitude', 'direction', 'axis']
        .some((key) => load[key] !== undefined)
    ) {
      throw new Error('Nodal load forces cannot be combined with component or directional aliases')
    }
    const values = load.forces.map((value) => asNumber(value))
    if (values.some((value) => value === null)) {
      throw new Error('Nodal load forces must contain six finite values')
    }
    return {
      force: { x: values[0] as number, y: values[1] as number, z: values[2] as number },
      moment: { x: values[3] as number, y: values[4] as number, z: values[5] as number },
    }
  }

  const direction = String(load.direction ?? load.axis ?? '').trim().toLowerCase()
  const magnitudeKeys = ['value', 'magnitude'].filter((key) => load[key] !== undefined)
  const legacyComponentNames = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz', 'momentX', 'momentY', 'momentZ']
    .filter((key) => load[key] !== undefined)
  if (legacyComponentNames.length) {
    throw new Error(`V2 nodal load components must use lowercase names: ${legacyComponentNames.join(', ')}`)
  }
  let x = resolveNumericAliases(load, ['fx'], 'Nodal load fx')
  let y = resolveNumericAliases(load, ['fy'], 'Nodal load fy')
  let z = resolveNumericAliases(load, ['fz'], 'Nodal load fz')
  let mx = resolveNumericAliases(load, ['mx'], 'Nodal load mx')
  let my = resolveNumericAliases(load, ['my'], 'Nodal load my')
  let mz = resolveNumericAliases(load, ['mz'], 'Nodal load mz')
  if (direction === 'x' || direction === 'fx') {
    x = resolveDirectionalMagnitude(load, ['fx'], magnitudeKeys, 'Nodal load X')
  } else if (direction === 'y' || direction === 'fy') {
    y = resolveDirectionalMagnitude(load, ['fy'], magnitudeKeys, 'Nodal load Y')
  } else if (direction === 'z' || direction === 'fz') {
    z = resolveDirectionalMagnitude(load, ['fz'], magnitudeKeys, 'Nodal load Z')
  } else if (direction === 'mx' || direction === 'rx') {
    mx = resolveDirectionalMagnitude(load, ['mx'], magnitudeKeys, 'Nodal moment X')
  } else if (direction === 'my' || direction === 'ry') {
    my = resolveDirectionalMagnitude(load, ['my'], magnitudeKeys, 'Nodal moment Y')
  } else if (direction === 'mz' || direction === 'rz') {
    mz = resolveDirectionalMagnitude(load, ['mz'], magnitudeKeys, 'Nodal moment Z')
  } else if (direction) {
    throw new Error(`Nodal load has unknown direction '${direction}'`)
  } else if (!direction && magnitudeKeys.length) {
    throw new Error('Nodal load value/magnitude requires an explicit direction')
  }
  return { force: { x, y, z }, moment: { x: mx, y: my, z: mz } }
}

function resolveDistributedLoadVector(load: Record<string, unknown>): VisualizationVector3 {
  const direction = String(load.direction ?? load.axis ?? '').trim().toLowerCase()
  const magnitudeKeys = ['q', 'w', 'value', 'magnitude'].filter((key) => load[key] !== undefined)
  let x = resolveNumericAliases(load, ['wx'], 'Distributed load wx')
  let y = resolveNumericAliases(load, ['wy'], 'Distributed load wy')
  let z = resolveNumericAliases(load, ['wz'], 'Distributed load wz')
  if (['x', 'local-x', '0'].includes(direction)) {
    x = resolveDirectionalMagnitude(load, ['wx'], magnitudeKeys, 'Distributed load X')
    y = 0
    z = 0
  } else if (['y', 'local-y', '1'].includes(direction)) {
    y = resolveDirectionalMagnitude(load, ['wy'], magnitudeKeys, 'Distributed load Y')
    z = 0
  } else if (['z', 'local-z', '2'].includes(direction)) {
    y = 0
    z = resolveDirectionalMagnitude(load, ['wz'], magnitudeKeys, 'Distributed load Z')
  } else if (direction) {
    throw new Error(`Distributed load has unknown direction '${direction}'`)
  } else if (magnitudeKeys.length) {
    throw new Error('Distributed load q/w/value/magnitude requires an explicit direction')
  }
  return { x, y, z }
}

function getLoads(
  model: Record<string, unknown> | null,
  nodes: VisualizationNode[],
  elements: VisualizationElement[],
  dimension: 2 | 3,
): VisualizationLoad[] {
  const loadCases = Array.isArray(model?.load_cases) ? model?.load_cases : []
  const loads: VisualizationLoad[] = getFloorAreaLoads(model, nodes)
  const representedFloorLoads = new Set(
    loads.flatMap((load) => (load.kind === 'area' && load.storyId
      ? (load.components || []).map((component) => `${load.storyId}:${component.type}`)
      : [])),
  )
  const elementById = new Map(elements.map((element) => [element.id, element]))
  const nodeIds = new Set(nodes.map((node) => node.id))

  loadCases.forEach((loadCase) => {
    const loadCaseRecord = asRecord(loadCase)
    const caseId = typeof loadCaseRecord?.id === 'string' ? loadCaseRecord.id : undefined
    const caseLoads = Array.isArray(loadCaseRecord?.loads) ? loadCaseRecord.loads : []
    caseLoads.forEach((entry) => {
      const load = asRecord(entry)
      if (!load) {
        return
      }
      const referenceFrameValue = load.reference_frame ?? 'global'
      if (referenceFrameValue !== 'global' && referenceFrameValue !== 'element-local') {
        throw new Error(`Unsupported load reference frame '${String(referenceFrameValue)}'`)
      }
      const referenceFrame = referenceFrameValue
      const declaredDirection = String(load.direction ?? load.axis ?? '').trim().toLowerCase()
      if (declaredDirection.startsWith('local-') && referenceFrame !== 'element-local') {
        throw new Error(`Load direction '${declaredDirection}' requires reference_frame='element-local'`)
      }
      const nodeId = resolveTargetAlias(load, ['node', 'nodeId', 'node_id'], 'Nodal load')
      const elementId = resolveTargetAlias(load, ['element', 'elementId', 'element_id'], 'Distributed load')
      if (nodeId && elementId) {
        throw new Error('A load cannot target both a node and an element')
      }
      if (nodeId) {
        if (!nodeIds.has(nodeId)) {
          throw new Error(`Nodal load references unknown node '${nodeId}'`)
        }
        if (referenceFrame !== 'global') {
          throw new Error(`Nodal load on '${nodeId}' cannot use an element-local reference frame`)
        }
        if (['wx', 'wy', 'wz'].some((key) => load[key] !== undefined)) {
          throw new Error(`Nodal load on '${nodeId}' must not use member-load w components`)
        }
        const { force, moment } = resolveNodalLoadVectors(load)
        if (dimension === 2 && Math.abs(force.y) > COORDINATE_TOLERANCE) {
          throw new Error(`Nodal load on '${nodeId}' has an out-of-plane global Y component in a 2-D model`)
        }
        if (dimension === 2 && (Math.abs(moment.x) > COORDINATE_TOLERANCE || Math.abs(moment.z) > COORDINATE_TOLERANCE)) {
          throw new Error(`Nodal moment on '${nodeId}' must act only about global Y in a 2-D model`)
        }
        const derivedFloorLoadKey = `${asStringId(load.story) || ''}:${asNonEmptyString(load.load_kind)?.toLowerCase() || ''}`
        if (load.source === 'story_floor_loads' && representedFloorLoads.has(derivedFloorLoadKey)) {
          return
        }
        if (vectorMagnitude([force.x, force.y, force.z]) > COORDINATE_TOLERANCE) {
          loads.push({
            nodeId,
            caseId,
            kind: 'nodal',
            vector: force,
            referenceFrame,
            sourceVector: force,
          })
        }
        if (vectorMagnitude([moment.x, moment.y, moment.z]) > COORDINATE_TOLERANCE) {
          loads.push({
            nodeId,
            caseId,
            kind: 'moment',
            vector: moment,
            referenceFrame,
            sourceVector: moment,
          })
        }
        return
      }
      if (elementId) {
        const element = elementById.get(elementId)
        if (!element) {
          throw new Error(`Distributed load references unknown element '${elementId}'`)
        }
        if (['fx', 'fy', 'fz', 'mx', 'my', 'mz', 'forces'].some((key) => load[key] !== undefined)) {
          throw new Error(`Distributed load on '${elementId}' must use only wx/wy/wz components`)
        }
        const sourceVector = resolveDistributedLoadVector(load)
        if (dimension === 2 && Math.abs(sourceVector.y) > COORDINATE_TOLERANCE) {
          throw new Error(`Distributed load on '${elementId}' has an out-of-plane Y component in a 2-D model`)
        }
        if (referenceFrame === 'element-local' && !element.localAxes) {
          throw new Error(`Distributed load on '${elementId}' cannot be transformed because local axes are unavailable`)
        }
        loads.push({
          elementId,
          caseId,
          kind: 'distributed',
          vector: referenceFrame === 'element-local'
            ? transformLocalVectorToGlobal(sourceVector, element.localAxes as VisualizationLocalAxes)
            : sourceVector,
          referenceFrame,
          sourceVector,
        })
        return
      }
      throw new Error('Every visualization load must target exactly one node or element')
    })
  })

  return loads
}

function deriveCoordinateSemantics(model: Record<string, unknown> | null): {
  dimension: 2 | 3
  plane?: VisualizationPlane
  semantics: string
  version?: number
} | null {
  if (!model || typeof model !== 'object') return null
  const coordinateSystem = asRecord(model.coordinate_system)
  const metadata = asRecord(model.metadata)
  if (coordinateSystem) {
    if (coordinateSystem.semantics !== 'global-z-up') {
      throw new Error(`Unsupported coordinate semantics '${String(coordinateSystem.semantics)}'`)
    }
    if (coordinateSystem.version !== 1) {
      throw new Error(`Unsupported coordinate contract version '${String(coordinateSystem.version)}'`)
    }
    if (coordinateSystem.dimension !== '2d' && coordinateSystem.dimension !== '3d') {
      throw new Error(`Unsupported coordinate dimension '${String(coordinateSystem.dimension)}'`)
    }
    const dimension = coordinateSystem.dimension === '3d' ? 3 : 2
    if (dimension === 2 && coordinateSystem.plane !== 'xz') {
      throw new Error("Canonical 2-D visualization requires the global X-Z plane")
    }
    if (dimension === 3 && coordinateSystem.plane !== null) {
      throw new Error("Canonical 3-D visualization cannot declare a 2-D plane")
    }
    const dofOrder = coordinateSystem.dof_order
    const canonicalDofOrder = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz']
    if (!Array.isArray(dofOrder) || dofOrder.length !== canonicalDofOrder.length || !dofOrder.every((value, index) => value === canonicalDofOrder[index])) {
      throw new Error('Coordinate contract has an invalid six-DOF order')
    }
    if (metadata?.coordinateSemantics !== undefined && metadata.coordinateSemantics !== 'global-z-up') {
      throw new Error('Model metadata conflicts with coordinate_system.semantics')
    }
    if (metadata?.coordinateContractVersion !== undefined && metadata.coordinateContractVersion !== 1) {
      throw new Error('Model metadata conflicts with coordinate_system.version')
    }
    const metadataDimension = metadata?.frameDimension
    if (metadataDimension !== undefined && metadataDimension !== coordinateSystem.dimension) {
      throw new Error('Model metadata conflicts with coordinate_system.dimension')
    }
    return {
      dimension,
      plane: dimension === 2 ? 'xz' : 'xy',
      semantics: 'global-z-up',
      version: 1,
    }
  }
  return null
}

function analysisCoordinateContractMatches(
  analysis: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
  dimension: 2 | 3,
): boolean {
  const coordinateKeys = [
    'coordinateSemantics',
    'coordinateContractVersion',
    'dimension',
    'plane',
    'dofOrder',
    'activeDofs',
    'nodalResultFrame',
    'elementForceFrame',
  ]
  const declarations = [asRecord(data?.meta), asRecord(analysis?.meta)]
    .filter((meta): meta is Record<string, unknown> => Boolean(meta))
    .filter((meta) => coordinateKeys.some((key) => meta[key] !== undefined))
  if (!declarations.length) return false
  const expectedDimension = dimension === 2 ? '2d' : '3d'
  const dofOrder = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz']
  const activeDofs = dimension === 2 ? ['ux', 'uz', 'ry'] : dofOrder
  const matchesOrder = (value: unknown, expected: string[]) => (
    Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index])
  )
  return declarations.every((meta) => (
    meta.coordinateSemantics === 'global-z-up'
    && meta.coordinateContractVersion === 1
    && meta.dimension === expectedDimension
    && meta.plane === (dimension === 2 ? 'xz' : null)
    && matchesOrder(meta.dofOrder, dofOrder)
    && matchesOrder(meta.activeDofs, activeDofs)
    && meta.nodalResultFrame === 'global'
    && meta.elementForceFrame === 'element-local'
  ))
}

function validateResultEntityMap(
  value: unknown,
  validIds: Set<string>,
  label: string,
  componentKeys: string[],
): void {
  if (value === undefined || value === null) return
  const record = asRecord(value)
  if (!record) throw new Error(`${label} must be an object keyed by canonical model ids`)
  for (const [id, rawEntry] of Object.entries(record)) {
    if (!validIds.has(id)) throw new Error(`${label} references unknown id '${id}'`)
    const entry = asRecord(rawEntry)
    if (!entry) throw new Error(`${label} entry '${id}' must be an object`)
    for (const key of componentKeys) {
      if (entry[key] !== undefined && asNumber(entry[key]) === null) {
        throw new Error(`${label} entry '${id}.${key}' must be finite`)
      }
    }
  }
}

function validateElementForceMap(
  value: unknown,
  elements: Map<string, VisualizationElement>,
  label: string,
): void {
  validateResultEntityMap(value, new Set(elements.keys()), label, [
    'axial', 'stress', 'N', 'V', 'Vy', 'Vz', 'T', 'M', 'My', 'Mz', 'torsion',
  ])
  const record = asRecord(value)
  if (!record) return
  const componentKeys = ['N', 'V', 'Vy', 'Vz', 'V2', 'V3', 'T', 'M', 'My', 'Mz', 'M2', 'M3']
  for (const [elementId, rawEntry] of Object.entries(record)) {
    const entry = asRecord(rawEntry) as Record<string, unknown>
    if (entry.referenceFrame !== undefined && entry.referenceFrame !== 'element-local') {
      throw new Error(`${label} entry '${elementId}' must use the element-local frame`)
    }
    for (const end of ['n1', 'n2']) {
      if (entry[end] === undefined) continue
      const endRecord = asRecord(entry[end])
      if (!endRecord) throw new Error(`${label} entry '${elementId}.${end}' must be an object`)
      for (const key of componentKeys) {
        if (endRecord[key] !== undefined && asNumber(endRecord[key]) === null) {
          throw new Error(`${label} entry '${elementId}.${end}.${key}' must be finite`)
        }
      }
    }
    if (entry.localAxes !== undefined) {
      const axesRecord = asRecord(entry.localAxes)
      const resultAxes = axesRecord && {
        x: parseVector3(axesRecord.x),
        y: parseVector3(axesRecord.y),
        z: parseVector3(axesRecord.z),
      }
      const modelAxes = elements.get(elementId)?.localAxes
      if (!resultAxes || !resultAxes.x || !resultAxes.y || !resultAxes.z || !modelAxes) {
        throw new Error(`${label} entry '${elementId}.localAxes' must contain finite X/Y/Z vectors`)
      }
      const validatedAxes: VisualizationLocalAxes = {
        x: resultAxes.x,
        y: resultAxes.y,
        z: resultAxes.z,
      }
      for (const axis of ['x', 'y', 'z'] as const) {
        for (const component of ['x', 'y', 'z'] as const) {
          if (Math.abs(validatedAxes[axis][component] - modelAxes[axis][component]) > 1e-6) {
            throw new Error(`${label} entry '${elementId}.localAxes' conflicts with the model`)
          }
        }
      }
    }
  }
}

function validateAnalysisResultReferences(
  data: Record<string, unknown> | null,
  nodeIds: Set<string>,
  elements: Map<string, VisualizationElement>,
  dimension: 2 | 3,
): void {
  if (!data) throw new Error('Analysis result data must be an object')
  const rejectNonzeroComponents = (value: unknown, label: string, keys: string[]) => {
    if (dimension !== 2) return
    const record = asRecord(value)
    if (!record) return
    for (const [id, rawEntry] of Object.entries(record)) {
      const entry = asRecord(rawEntry)
      if (!entry) continue
      for (const key of keys) {
        const component = entry[key] === undefined ? 0 : asNumber(entry[key])
        if (component !== null && Math.abs(component) > COORDINATE_TOLERANCE) {
          throw new Error(`${label} entry '${id}.${key}' is out of plane for a canonical X-Z model`)
        }
      }
    }
  }
  const validateResultSet = (result: Record<string, unknown>) => {
    validateResultEntityMap(result.displacements, nodeIds, 'Displacements', ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'])
    validateResultEntityMap(result.reactions, nodeIds, 'Reactions', ['fx', 'fy', 'fz', 'mx', 'my', 'mz'])
    validateElementForceMap(result.forces, elements, 'Element forces')
    rejectNonzeroComponents(result.displacements, 'Displacements', ['uy', 'rx', 'rz'])
    rejectNonzeroComponents(result.reactions, 'Reactions', ['fy', 'mx', 'mz'])
  }
  validateResultSet(data)
  if (data.caseResults !== undefined && !asRecord(data.caseResults)) {
    throw new Error('caseResults must be an object')
  }
  for (const [caseId, rawCase] of Object.entries(asRecord(data.caseResults) || {})) {
    const caseResult = asRecord(rawCase)
    if (!caseResult) throw new Error(`caseResults.${caseId} must be an object`)
    validateResultSet(caseResult)
  }

  if (data.envelopeTables !== undefined && !asRecord(data.envelopeTables)) {
    throw new Error('envelopeTables must be an object')
  }
  const envelopeTables = asRecord(data.envelopeTables)
  validateResultEntityMap(
    envelopeTables?.nodeDisplacement,
    nodeIds,
    'Envelope node displacements',
    ['maxAbsDisplacement'],
  )
  validateResultEntityMap(
    envelopeTables?.nodeReaction,
    nodeIds,
    'Envelope node reactions',
    ['maxAbsReaction'],
  )
  validateResultEntityMap(
    envelopeTables?.elementForce,
    new Set(elements.keys()),
    'Envelope element forces',
    ['maxAbsAxialForce', 'maxAbsShearForce', 'maxAbsMoment'],
  )
}

function buildAvailableViews(cases: VisualizationCase[], source: VisualizationSource, hasUtilization = false, hasBuckling = false): VisualizationViewMode[] {
  if (source === 'model') {
    return ['model']
  }
  const hasDisplacements = cases.some((item) =>
    Object.values(item.nodeResults).some((result) => vectorMagnitude([result.displacement?.ux, result.displacement?.uy, result.displacement?.uz]) > 0)
  )
  const hasForces = cases.some((item) =>
    Object.values(item.elementResults).some((result) =>
      [result.axial, result.shear, result.moment, result.torsion].some((value) => typeof value === 'number')
    )
  )
  const hasReactions = cases.some((item) =>
    Object.values(item.nodeResults).some((result) =>
      vectorMagnitude([result.reaction?.fx, result.reaction?.fy, result.reaction?.fz]) > 0
      || vectorMagnitude([result.reaction?.mx, result.reaction?.my, result.reaction?.mz]) > 0
    )
  )

  return [
    'model',
    ...(hasDisplacements ? (['deformed'] as const) : []),
    ...(hasForces ? (['forces'] as const) : []),
    ...(hasReactions ? (['reactions'] as const) : []),
    ...(hasUtilization ? (['utilization'] as const) : []),
    ...(hasBuckling ? (['buckling'] as const) : []),
  ]
}

function deriveUnits(model: Record<string, unknown> | null, analysis: Record<string, unknown> | null) {
  const analysisMeta = asRecord(analysis?.meta)
  const unitSystemRaw = asNonEmptyString(model?.unit_system)
    || asNonEmptyString(model?.unitSystem)
    || asNonEmptyString(model?.units)
    || asNonEmptyString(analysisMeta?.unitSystem)
    || asNonEmptyString(analysisMeta?.unit_system)
    || 'SI'
  const unitSystem = unitSystemRaw.toUpperCase()
  const normalizedUnitSystem = unitSystem.replace(/[^A-Z0-9]/g, '')
  const unitTokens = unitSystem.split(/[^A-Z0-9]+/).filter(Boolean)
  const usesMillimeterLength = normalizedUnitSystem.includes('MM')
  const usesKilonewton = normalizedUnitSystem.includes('KN')
  const usesNewton = !usesKilonewton && (
    unitTokens.includes('N')
    || normalizedUnitSystem === 'N'
    || normalizedUnitSystem.startsWith('NM')
  )
  const lengthUnit = usesMillimeterLength ? 'mm' : 'm'
  const forceUnit = usesNewton ? 'N' : 'kN'
  const displacementDisplayFactor = lengthUnit === 'm' ? 1000 : 1

  // StructureClaw's SI convention is coordinates in m and forces in kN.
  return {
    unitSystem,
    lengthUnit,
    displacementUnit: 'mm',
    displacementDisplayFactor,
    forceUnit,
    momentUnit: `${forceUnit}.${lengthUnit}`,
    nodalLoadUnit: forceUnit,
    distributedLoadUnit: `${forceUnit}/${lengthUnit}`,
  }
}

function deriveMemberUtilizationMap(
  data: Record<string, unknown> | null,
  elementIds: Set<string>,
  providedMap?: Record<string, number> | null,
) {
  const steelCheck = asRecord(data?.steelCheck)
  const codeCheck = asRecord(data?.codeCheck)
  const source = providedMap && Object.keys(providedMap).length > 0
    ? providedMap
    : asRecord(steelCheck?.memberUtilization) || asRecord(codeCheck?.memberUtilization)
  if (!source) {
    return null
  }
  const normalized: Record<string, number> = {}
  for (const [elementId, value] of Object.entries(source)) {
    const ratio = asNumber(value)
    if (!elementIds.has(elementId) || ratio === null) {
      throw new Error(`Member utilization '${elementId}' must map a finite value to a model element`)
    }
    normalized[elementId] = ratio
  }
  return normalized
}

function deriveBucklingModes(
  data: Record<string, unknown> | null,
  nodeIds: Set<string>,
  dimension: 2 | 3,
  providedModes?: BucklingMode[] | null,
) {
  const buckling = asRecord(data?.buckling)
  const modes = Array.isArray(providedModes) && providedModes.length > 0
    ? providedModes
    : Array.isArray(buckling?.modes) ? buckling.modes : []
  const normalized: BucklingMode[] = []
  modes.forEach((entry, index) => {
    const record = asRecord(entry)
    const lambda = asNumber(record?.lambda)
    const rawModeShape = asRecord(record?.modeShape)
    if (!record || lambda === null || !rawModeShape) {
      throw new Error(`Buckling mode ${index + 1} must have a finite lambda and node mode-shape map`)
    }
    const modeShape: Record<string, [number, number, number]> = {}
    for (const [nodeId, rawVector] of Object.entries(rawModeShape)) {
      const vector = parseVector3(rawVector)
      if (!nodeIds.has(nodeId) || !vector) {
        throw new Error(`Buckling mode ${index + 1} references an invalid model node '${nodeId}'`)
      }
      if (dimension === 2 && Math.abs(vector.y) > COORDINATE_TOLERANCE) {
        throw new Error(`Buckling mode ${index + 1} has an out-of-plane global Y component`)
      }
      modeShape[nodeId] = [vector.x, vector.y, vector.z]
    }
    normalized.push({ lambda, modeShape })
  })
  return normalized.length > 0 ? normalized : null
}

export function buildVisualizationSnapshot(params: {
  title: string
  model: Record<string, unknown> | null
  analysis?: Record<string, unknown> | null
  mode?: 'model-only' | 'analysis-result'
  statusMessage?: string
  /** memberUtilizationMap from backend VisualizationHints: elementId → ratio (0~1+) */
  memberUtilizationMap?: Record<string, number> | null
  /** bucklingModes from backend VisualizationHints, sorted by λ ascending */
  bucklingModes?: BucklingMode[] | null
}): VisualizationSnapshot | null {
  const model = params.model
  if (!model) {
    return null
  }

  const source: VisualizationSource = params.mode === 'model-only' || !params.analysis ? 'model' : 'result'
  const analysis = asRecord(params.analysis)
  const data = asRecord(analysis?.data) || analysis
  const units = deriveUnits(model, analysis)
  const nodesInput = Array.isArray(model.nodes) ? model.nodes : []
  const elementsInput = Array.isArray(model.elements) ? model.elements : []
  const debugEnabled = process.env.NODE_ENV !== 'production'
  if (!nodesInput.length || !elementsInput.length) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped: model is missing nodes or elements array data.', {
        source,
        nodesInputCount: nodesInput.length,
        elementsInputCount: elementsInput.length,
      })
    }
    return null
  }

  let invalidNodeRecord = false
  const nodeIds = new Set<string>()
  const nodes: VisualizationNode[] = []
  for (const value of nodesInput) {
    const node = asRecord(value)
    const id = asStringId(node?.id)
    const x = node ? pickNodeCoordinate(node, 'x') : null
    const y = node ? pickNodeCoordinate(node, 'y') : null
    const z = node ? pickNodeCoordinate(node, 'z') : null
    const restraints = node ? parseRestraints(node.restraints) : null
    if (!node || !id || nodeIds.has(id) || x === null || y === null || z === null || restraints === null) {
      invalidNodeRecord = true
      continue
    }
    nodeIds.add(id)
    nodes.push({
      id,
      position: { x, y, z },
      restraints: restraints || undefined,
    })
  }

  if (invalidNodeRecord) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped: nodes require unique ids, finite X/Y/Z coordinates, and exactly six boolean restraints when present.')
    }
    return null
  }

  let semantics: ReturnType<typeof deriveCoordinateSemantics>
  try {
    semantics = deriveCoordinateSemantics(model)
  } catch (error) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped because its coordinate contract is invalid.', error)
    }
    return null
  }
  if (!semantics) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped: structural model has no explicit canonical coordinate contract.')
    }
    return null
  }
  const dimension = semantics.dimension
  const plane = semantics.plane as VisualizationPlane
  if (dimension === 2 && nodes.some((node) => Math.abs(node.position.y) > COORDINATE_TOLERANCE)) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped: canonical 2-D nodes must lie in the global X-Z plane.')
    }
    return null
  }
  if (source === 'result' && !analysisCoordinateContractMatches(analysis, data, dimension)) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped because analysis result axes do not match the model coordinate contract.')
    }
    return null
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const metadata = asRecord(model.metadata)
  const rawElementReferenceVectors = metadata?.elementReferenceVectors
  const elementReferenceVectors = asRecord(rawElementReferenceVectors)
  let invalidElementCoordinates = rawElementReferenceVectors !== undefined
    && (dimension === 2 || !elementReferenceVectors)
  const elementIds = new Set<string>()
  const elements: VisualizationElement[] = []
  for (const value of elementsInput) {
    const element = asRecord(value)
    const id = asStringId(element?.id)
    if (!element || !id || elementIds.has(id)) {
      invalidElementCoordinates = true
      continue
    }
    elementIds.add(id)
    const nodeIds = pickElementNodeIds(element)
    const elementType = typeof element.type === 'string' ? element.type : 'beam'
    const isLineElement = ['beam', 'truss', 'column', 'brace', 'link'].includes(elementType)
    if (
      !nodeIds
      || new Set(nodeIds).size !== nodeIds.length
      || (isLineElement && nodeIds.length !== 2)
      || (!isLineElement && nodeIds.length < 2)
    ) {
      invalidElementCoordinates = true
      continue
    }
    const start = nodeById.get(nodeIds[0])
    const end = nodeById.get(nodeIds[1])
    const rawReferenceVector = elementReferenceVectors?.[id]
    const referenceVector = rawReferenceVector === undefined ? undefined : parseVector3(rawReferenceVector)
    const rotationDegrees = element.rotation_angle === undefined || element.rotation_angle === null
      ? undefined
      : asNumber(element.rotation_angle)
    const localAxes = isLineElement && start && end && referenceVector !== null && rotationDegrees !== null
      ? buildElementLocalAxes({
          start: start.position,
          end: end.position,
          dimension,
          referenceVector,
          rotationDegrees,
        })
      : null
    if (
      !start
      || !end
      || referenceVector === null
      || rotationDegrees === null
      || (isLineElement && !localAxes)
    ) {
      invalidElementCoordinates = true
    }
    elements.push({
      id,
      type: elementType,
      nodeIds,
      material: typeof element.material === 'string' ? element.material : undefined,
      section: typeof element.section === 'string' ? element.section : undefined,
      localAxes: localAxes || undefined,
    })
  }
  if (elementReferenceVectors && Object.keys(elementReferenceVectors).some((id) => !elementIds.has(id))) {
    invalidElementCoordinates = true
  }

  const nodeIdSet = new Set(nodes.map((node) => node.id))
  const elementsWithInvalidNodeRefs = elements.filter(
    (element) => element.nodeIds.some((nodeId) => !nodeIdSet.has(nodeId))
  ).length

  if (debugEnabled) {
    console.info('[Visualization] Snapshot normalization summary:', {
      source,
      nodesInputCount: nodesInput.length,
      nodesNormalizedCount: nodes.length,
      elementsInputCount: elementsInput.length,
      elementsNormalizedCount: elements.length,
      elementsWithInvalidNodeRefs,
    })
  }

  if (!nodes.length || !elements.length || invalidElementCoordinates || elementsWithInvalidNodeRefs > 0) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped after normalization because its element geometry or local axes are invalid.', {
        source,
        nodesNormalizedCount: nodes.length,
        elementsNormalizedCount: elements.length,
        invalidElementCoordinates,
        elementsWithInvalidNodeRefs,
      })
    }
    return null
  }

  if (source === 'result') {
    try {
      validateAnalysisResultReferences(data, nodeIdSet, new Map(elements.map((element) => [element.id, element])), dimension)
    } catch (error) {
      if (debugEnabled) {
        console.warn('[Visualization] Snapshot skipped because analysis results do not map exactly to model ids.', error)
      }
      return null
    }
  }

  const baseDisplacements = asRecord(data?.displacements)
  let loads: VisualizationLoad[]
  try {
    loads = getLoads(model, nodes, elements, dimension)
  } catch (error) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped because a load reference frame cannot be rendered safely.', error)
    }
    return null
  }
  const cases: VisualizationCase[] = source === 'result'
    ? (() => {
        const baseReactions = asRecord(data?.reactions)
        const baseForces = asRecord(data?.forces)
        const baseEnvelope = asRecord(data?.envelope)
        const baseCase = buildCase('result', 'Result', 'result', baseDisplacements, baseReactions, baseForces, baseEnvelope)
        const nextCases: VisualizationCase[] = [baseCase]

        const caseResults = asRecord(data?.caseResults)
        Object.entries(caseResults || {}).forEach(([caseId, value]) => {
          const entry = asRecord(value)
          if (!entry) {
            return
          }
          nextCases.push(
            buildCase(
              caseId,
              caseId,
              'case',
              asRecord(entry.displacements),
              asRecord(entry.reactions),
              asRecord(entry.forces),
              asRecord(entry.envelope)
            )
          )
        })

        const envelopeTables = asRecord(data?.envelopeTables)
        if (envelopeTables) {
          const envelopeCase = buildCase('envelope', 'Envelope', 'envelope', null, null, null, null)
          applyEnvelopeTables(envelopeCase, envelopeTables)
          nextCases.push(envelopeCase)
        }

        return nextCases
      })()
    : [buildCase('model', 'Model', 'case', null, null, null, null)]

  const unsupportedElementTypes = Array.from(
    new Set(elements.map((element) => element.type).filter((type) => !['beam', 'truss', 'column', 'brace', 'link'].includes(type)))
  )
  let utilizationMap: Record<string, number> | null
  let bucklingModes: BucklingMode[] | null
  try {
    utilizationMap = deriveMemberUtilizationMap(data, elementIds, params.memberUtilizationMap)
    bucklingModes = deriveBucklingModes(data, nodeIdSet, dimension, params.bucklingModes)
  } catch (error) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped because an extension result uses invalid model coordinates or ids.', error)
    }
    return null
  }

  // Inject steel member utilization ratios into all cases' elementResults
  if (utilizationMap && Object.keys(utilizationMap).length > 0) {
    cases.forEach((vizCase) => {
      Object.entries(utilizationMap).forEach(([elementId, ratio]) => {
        if (typeof ratio === 'number' && Number.isFinite(ratio)) {
          vizCase.elementResults[elementId] = {
            ...(vizCase.elementResults[elementId] || {}),
            utilization: ratio,
          }
        }
      })
    })
  }

  // Build availableViews — include 'utilization' when any element has the field
  const hasUtilization = cases.some((item) =>
    Object.values(item.elementResults).some((result) => typeof result.utilization === 'number')
  )
  const hasBuckling = Array.isArray(bucklingModes) && bucklingModes.length > 0
  const extensions: VisualizationExtensionMap = {
    ...(hasUtilization && utilizationMap
      ? {
          'builtin.utilization': {
            id: 'builtin.utilization',
            available: true,
            data: {
              memberUtilizationMap: utilizationMap,
            },
          },
        }
      : {}),
    ...(hasBuckling && bucklingModes
      ? {
          'builtin.buckling': {
            id: 'builtin.buckling',
            available: true,
            data: {
              bucklingModes,
            },
          },
        }
      : {}),
  }

  return normalizeVisualizationSnapshot({
    version: 1,
    title: params.title,
    source,
    dimension,
    plane,
    coordinateSemantics: semantics?.semantics,
    coordinateContractVersion: semantics?.version,
    analysisType: typeof analysis?.analysis_type === 'string' ? analysis.analysis_type : undefined,
    availableViews: buildAvailableViews(cases, source, hasUtilization, hasBuckling),
    defaultCaseId: cases.find((item) => item.kind === 'result')?.id || cases[0]?.id || (source === 'model' ? 'model' : 'result'),
    unitSystem: units.unitSystem,
    lengthUnit: units.lengthUnit,
    displacementUnit: units.displacementUnit,
    displacementDisplayFactor: units.displacementDisplayFactor,
    nodeLabelUnit: units.lengthUnit,
    resultUnit: units.forceUnit,
    momentUnit: units.momentUnit,
    nodalLoadUnit: units.nodalLoadUnit,
    distributedLoadUnit: units.distributedLoadUnit,
    floorLoadUnit: `${units.forceUnit}/${units.lengthUnit}^2`,
    nodes,
    elements,
    loads,
    unsupportedElementTypes,
    cases,
    summary: asRecord(data?.summary) || undefined,
    statusMessage: params.statusMessage,
    extensions: Object.keys(extensions).length > 0 ? extensions : undefined,
    bucklingModes: hasBuckling ? bucklingModes || undefined : undefined,
  })
}
