import crypto from 'node:crypto';

/**
 * Check whether an existing artifact can be reused (spec section 15.2).
 *
 * Conditions checked explicitly:
 * 1. status === 'ready'
 * 2. dependencyFingerprint matches current deps
 * 3. producerSkillId stable (provider binding unchanged)
 *
 * Conditions covered implicitly:
 * 4. Contract version compatibility: if the skill API version changes, the
 *    upstream artifacts will change, causing a fingerprint mismatch (condition 2).
 *    For explicit version tracking, add a `skillApiVersion` field to ArtifactEnvelope
 *    in a follow-up.
 * 5. Upstream artifact validity: cascade invalidation (Phase 3) marks downstream
 *    artifacts as 'stale' when upstream changes, caught by condition 1.
 *    The fingerprint also captures upstream identity, so stale-but-not-cascaded
 *    artifacts are caught by condition 2.
 */
export function canReuseArtifact(
  artifact: { status: string; dependencyFingerprint: string; producerSkillId?: string },
  currentFingerprint: string,
  forceRecompute: boolean,
  producerSkillId?: string,
): boolean {
  if (forceRecompute) return false;
  if (artifact.status !== 'ready') return false;
  if (artifact.dependencyFingerprint !== currentFingerprint) return false;
  // Spec section 15.2 condition 3: provider binding stability
  if (producerSkillId && artifact.producerSkillId && artifact.producerSkillId !== producerSkillId) return false;
  return true;
}

export function computeDependencyFingerprint(
  refs: Record<string, { artifactId: string; revision: number }>,
  providerBindings?: { analysisProviderSkillId?: string; codeCheckProviderSkillId?: string },
  draftStateHash?: string,
): string {
  const keys = Object.keys(refs).sort();
  const parts = keys.map((k) => `${k}:${refs[k].artifactId}:${refs[k].revision}`);
  // Include provider identity in fingerprint (spec section 15.2 condition 3)
  if (providerBindings?.analysisProviderSkillId) {
    parts.push(`analysisProvider:${providerBindings.analysisProviderSkillId}`);
  }
  if (providerBindings?.codeCheckProviderSkillId) {
    parts.push(`codeCheckProvider:${providerBindings.codeCheckProviderSkillId}`);
  }
  if (draftStateHash) {
    parts.push(`draftState:${draftStateHash}`);
  }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Compute a content hash of the DraftState for fingerprint purposes.
 * Excludes `updatedAt` to avoid false positives when parameters are unchanged.
 */
export function computeDraftStateContentHash(draftState: Record<string, unknown>): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { updatedAt, ...rest } = draftState;
  return crypto.createHash('sha256')
    .update(JSON.stringify(rest, Object.keys(rest).sort()))
    .digest('hex').slice(0, 16);
}
