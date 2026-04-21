import crypto from 'node:crypto';

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
