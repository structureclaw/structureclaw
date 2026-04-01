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

function normalizeVectorForPlane(vector: VisualizationVector3, plane: VisualizationPlane): VisualizationVector3 {
  if (plane === 'xz' && !isSignificant(vector.z) && isSignificant(vector.y)) {
    return { x: vector.x, y: 0, z: vector.y }
  }

  if (plane === 'xy' && !isSignificant(vector.y) && isSignificant(vector.z)) {
    return { x: vector.x, y: vector.z, z: 0 }
  }

  return vector
}

function normalizeNodeResultsForPlane(result: VisualizationNodeResults, plane: VisualizationPlane): VisualizationNodeResults {
  if (plane === 'xz') {
    const displacement = result.displacement && !isSignificant(result.displacement.uz) && isSignificant(result.displacement.uy)
      ? {
          ...result.displacement,
          uy: 0,
          uz: result.displacement.uy,
          ry: isSignificant(result.displacement.ry) ? result.displacement.ry : (result.displacement.rz ?? 0),
          rz: 0,
        }
      : result.displacement
    const reaction = result.reaction && !isSignificant(result.reaction.fz) && isSignificant(result.reaction.fy)
      ? {
          ...result.reaction,
          fy: 0,
          fz: result.reaction.fy,
          my: isSignificant(result.reaction.my) ? result.reaction.my : (result.reaction.mz ?? 0),
          mz: 0,
        }
      : result.reaction

    return {
      ...result,
      ...(displacement ? { displacement } : {}),
      ...(reaction ? { reaction } : {}),
    }
  }

  if (plane === 'xy') {
    const displacement = result.displacement && !isSignificant(result.displacement.uy) && isSignificant(result.displacement.uz)
      ? {
          ...result.displacement,
          uy: result.displacement.uz,
          uz: 0,
          rz: isSignificant(result.displacement.rz) ? result.displacement.rz : (result.displacement.ry ?? 0),
          ry: 0,
        }
      : result.displacement
    const reaction = result.reaction && !isSignificant(result.reaction.fy) && isSignificant(result.reaction.fz)
      ? {
          ...result.reaction,
          fy: result.reaction.fz,
          fz: 0,
          mz: isSignificant(result.reaction.mz) ? result.reaction.mz : (result.reaction.my ?? 0),
          my: 0,
        }
      : result.reaction

    return {
      ...result,
      ...(displacement ? { displacement } : {}),
      ...(reaction ? { reaction } : {}),
    }
  }

  return result
}

function normalizeCaseForPlane(entry: VisualizationCase, plane: VisualizationPlane): VisualizationCase {
  return {
    ...entry,
    nodeResults: Object.fromEntries(
      Object.entries(entry.nodeResults).map(([nodeId, result]) => [nodeId, normalizeNodeResultsForPlane(result, plane)])
    ),
  }
}

function normalizeLoadForPlane(load: VisualizationLoad, plane: VisualizationPlane): VisualizationLoad {
  return {
    ...load,
    vector: normalizeVectorForPlane(load.vector, plane),
  }
}

export function normalizeVisualizationSnapshot(snapshot: VisualizationSnapshot): VisualizationSnapshot {
  if (snapshot.dimension !== 2) {
    return snapshot
  }

  return {
    ...snapshot,
    loads: snapshot.loads.map((load) => normalizeLoadForPlane(load, snapshot.plane)),
    cases: snapshot.cases.map((entry) => normalizeCaseForPlane(entry, snapshot.plane)),
  }
}
