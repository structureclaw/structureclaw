import type { ArtifactKind, ArtifactEnvelope, ProjectArtifactKind } from './types.js';

// Reverse dependency map derived from CONTROLLED_ARTIFACT_GRAPH
const DOWNSTREAM_MAP: Record<ProjectArtifactKind, ProjectArtifactKind[]> = {
  designBasis: ['normalizedModel', 'analysisModel', 'codeCheckResult', 'drawingArtifact', 'reportArtifact'],
  normalizedModel: ['analysisModel', 'codeCheckResult', 'drawingArtifact', 'reportArtifact'],
  analysisModel: ['analysisRaw'],
  analysisRaw: ['postprocessedResult'],
  postprocessedResult: ['codeCheckResult'],
  codeCheckResult: [],
  drawingArtifact: [],
  reportArtifact: [],
};

/**
 * Given a changed artifact kind, mark all transitive downstream artifacts as stale.
 * Returns a new artifacts map with updated status and updatedAt.
 * Spec section 15.1.
 */
export function invalidateDownstream(
  changedKind: ArtifactKind,
  artifacts: Record<string, ArtifactEnvelope | undefined>,
): Record<string, ArtifactEnvelope | undefined> {
  const result = { ...artifacts };
  const queue: string[] = DOWNSTREAM_MAP[changedKind as ProjectArtifactKind] ?? [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const kind = queue.shift()!;
    if (visited.has(kind)) continue;
    visited.add(kind);

    const existing = result[kind];
    if (existing && existing.status === 'ready') {
      result[kind] = { ...existing, status: 'stale', updatedAt: Date.now() };
    }
    const children = DOWNSTREAM_MAP[kind as ProjectArtifactKind] ?? [];
    queue.push(...children);
  }

  return result;
}
