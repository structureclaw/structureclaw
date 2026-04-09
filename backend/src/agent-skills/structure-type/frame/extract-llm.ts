import { normalizeLegacyDraftPatch } from '../../../agent-runtime/legacy.js';
import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';

function normalizeSteelGrade(raw: string): string {
  return raw.toUpperCase();
}

function normalizeSectionName(raw: string): string {
  return raw.toUpperCase().replace(/[×x]/g, 'X');
}

function repeatScalar(count: number | undefined, value: number | undefined): number[] | undefined {
  if (!count || value === undefined) return undefined;
  return Array.from({ length: count }, () => value);
}

export function buildFramePatchFromLlm(
  rawPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalized = normalizeLegacyDraftPatch(rawPatch);
  const storyCount = normalized.storyCount ?? existingState?.storyCount;
  const bayCount = normalized.bayCount ?? existingState?.bayCount;
  const storyHeightScalar = typeof rawPatch?.storyHeightM === 'number' ? rawPatch.storyHeightM : undefined;
  const bayWidthScalar = typeof rawPatch?.bayWidthM === 'number' ? rawPatch.bayWidthM : undefined;

  return {
    ...normalized,
    storyHeightsM: normalized.storyHeightsM ?? repeatScalar(storyCount, storyHeightScalar),
    bayWidthsM: normalized.bayWidthsM ?? repeatScalar(bayCount, bayWidthScalar),
    ...(typeof rawPatch?.frameMaterial === 'string' && { frameMaterial: normalizeSteelGrade(rawPatch.frameMaterial) }),
    ...(typeof rawPatch?.frameColumnSection === 'string' && { frameColumnSection: normalizeSectionName(rawPatch.frameColumnSection) }),
    ...(typeof rawPatch?.frameBeamSection === 'string' && { frameBeamSection: normalizeSectionName(rawPatch.frameBeamSection) }),
  };
}
