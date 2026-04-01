import type {
  VisualizationCase,
  VisualizationLoad,
  VisualizationNodeResults,
  VisualizationPlane,
  VisualizationSnapshot,
  VisualizationVector3,
} from './types'

const EPSILON = 1e-12

function isSignificant(value: number | undefined) {
  return typeof value === 'number' && Math.abs(value) > EPSILON
}

function normalizeVectorForPlane(
  vector: VisualizationVector3,
  plane: VisualizationPlane,
): { changed: boolean; value: VisualizationVector3 } {
  if (plane === 'xz' && !isSignificant(vector.z) && isSignificant(vector.y)) {
    return {
      changed: true,
      value: { x: vector.x, y: 0, z: vector.y },
    }
  }

  if (plane === 'xy' && !isSignificant(vector.y) && isSignificant(vector.z)) {
    return {
      changed: true,
      value: { x: vector.x, y: vector.z, z: 0 },
    }
  }

  return { changed: false, value: vector }
}

function normalizeXzDisplacement(displacement: NonNullable<VisualizationNodeResults['displacement']>) {
  if (isSignificant(displacement.uz) || !isSignificant(displacement.uy)) {
    return { changed: false, value: displacement }
  }

  const next = {
    ...displacement,
    uy: displacement.uy === undefined ? undefined : 0,
    uz: displacement.uy,
  }

  if (!isSignificant(displacement.ry) && displacement.rz !== undefined) {
    next.ry = displacement.rz
    next.rz = 0
  }

  return { changed: true, value: next }
}

function normalizeXzReaction(reaction: NonNullable<VisualizationNodeResults['reaction']>) {
  if (isSignificant(reaction.fz) || !isSignificant(reaction.fy)) {
    return { changed: false, value: reaction }
  }

  const next = {
    ...reaction,
    fy: reaction.fy === undefined ? undefined : 0,
    fz: reaction.fy,
  }

  if (!isSignificant(reaction.my) && reaction.mz !== undefined) {
    next.my = reaction.mz
    next.mz = 0
  }

  return { changed: true, value: next }
}

function normalizeXyDisplacement(displacement: NonNullable<VisualizationNodeResults['displacement']>) {
  if (isSignificant(displacement.uy) || !isSignificant(displacement.uz)) {
    return { changed: false, value: displacement }
  }

  const next = {
    ...displacement,
    uy: displacement.uz,
    uz: displacement.uz === undefined ? undefined : 0,
  }

  if (!isSignificant(displacement.rz) && displacement.ry !== undefined) {
    next.rz = displacement.ry
    next.ry = 0
  }

  return { changed: true, value: next }
}

function normalizeXyReaction(reaction: NonNullable<VisualizationNodeResults['reaction']>) {
  if (isSignificant(reaction.fy) || !isSignificant(reaction.fz)) {
    return { changed: false, value: reaction }
  }

  const next = {
    ...reaction,
    fy: reaction.fz,
    fz: reaction.fz === undefined ? undefined : 0,
  }

  if (!isSignificant(reaction.mz) && reaction.my !== undefined) {
    next.mz = reaction.my
    next.my = 0
  }

  return { changed: true, value: next }
}

function normalizeNodeResultsForPlane(
  result: VisualizationNodeResults,
  plane: VisualizationPlane,
): { changed: boolean; value: VisualizationNodeResults } {
  if (plane !== 'xz' && plane !== 'xy') {
    return { changed: false, value: result }
  }

  const displacementResult = result.displacement
    ? (plane === 'xz' ? normalizeXzDisplacement(result.displacement) : normalizeXyDisplacement(result.displacement))
    : { changed: false, value: result.displacement }
  const reactionResult = result.reaction
    ? (plane === 'xz' ? normalizeXzReaction(result.reaction) : normalizeXyReaction(result.reaction))
    : { changed: false, value: result.reaction }

  if (!displacementResult.changed && !reactionResult.changed) {
    return { changed: false, value: result }
  }

  return {
    changed: true,
    value: {
      ...result,
      ...(displacementResult.value ? { displacement: displacementResult.value } : {}),
      ...(reactionResult.value ? { reaction: reactionResult.value } : {}),
    },
  }
}

function normalizeCaseForPlane(
  entry: VisualizationCase,
  plane: VisualizationPlane,
): { changed: boolean; value: VisualizationCase } {
  let changed = false
  const nodeResults = Object.fromEntries(
    Object.entries(entry.nodeResults).map(([nodeId, result]) => {
      const normalized = normalizeNodeResultsForPlane(result, plane)
      changed = changed || normalized.changed
      return [nodeId, normalized.value]
    }),
  )

  if (!changed) {
    return { changed: false, value: entry }
  }

  return {
    changed: true,
    value: {
      ...entry,
      nodeResults,
    },
  }
}

function normalizeLoadForPlane(
  load: VisualizationLoad,
  plane: VisualizationPlane,
): { changed: boolean; value: VisualizationLoad } {
  const normalizedVector = normalizeVectorForPlane(load.vector, plane)
  if (!normalizedVector.changed) {
    return { changed: false, value: load }
  }

  return {
    changed: true,
    value: {
      ...load,
      vector: normalizedVector.value,
    },
  }
}

export function normalizeVisualizationSnapshot(snapshot: VisualizationSnapshot): VisualizationSnapshot {
  if (snapshot.dimension !== 2) {
    return snapshot
  }

  let changed = false

  const loads = snapshot.loads.map((load) => {
    const normalized = normalizeLoadForPlane(load, snapshot.plane)
    changed = changed || normalized.changed
    return normalized.value
  })

  const cases = snapshot.cases.map((entry) => {
    const normalized = normalizeCaseForPlane(entry, snapshot.plane)
    changed = changed || normalized.changed
    return normalized.value
  })

  if (!changed) {
    return snapshot
  }

  return {
    ...snapshot,
    loads,
    cases,
  }
}
