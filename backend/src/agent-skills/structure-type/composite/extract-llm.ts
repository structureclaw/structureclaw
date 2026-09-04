import {
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { normalizeNumber } from '../../../agent-runtime/fallback.js';
import {
  LEGACY_ALLOWED_KEYS,
  toPositiveNumberFromUnknown,
} from './constants.js';
import {
  isValidConcreteGrade,
  isValidSteelGrade,
  normalizeConcreteGrade,
  normalizeSectionName,
  normalizeSteelGrade,
} from './design.js';
import type { DraftExtraction, DraftFloorLoad, DraftState } from '../../../agent-runtime/types.js';

function extractScalar(raw: Record<string, unknown> | null | undefined, keys: string[]): number | undefined {
  if (!raw) return undefined;
  for (const key of keys) {
    const value = normalizeNumber(raw[key]);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function repeatScalar(count: number | undefined, value: number | undefined): number[] | undefined {
  if (!count || value === undefined) return undefined;
  return Array.from({ length: count }, () => value);
}

function buildUniformFloorLoads(
  storyCount: number | undefined,
  verticalKN: number | undefined,
  liveLoadKN: number | undefined,
  lateralXKN: number | undefined,
): DraftFloorLoad[] | undefined {
  if (!storyCount) return undefined;
  if (verticalKN === undefined && liveLoadKN === undefined && lateralXKN === undefined) return undefined;
  return Array.from({ length: storyCount }, (_, index) => ({
    story: index + 1,
    verticalKN,
    liveLoadKN,
    lateralXKN,
  }));
}

/** Normalize a raw composite patch into composite-specific fields (scalar expansion, grade/section normalization). */
export function buildCompositePatchFromLlm(
  rawPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalized = restrictLegacyDraftPatch(normalizeLegacyDraftPatch(rawPatch), 'frame', [...LEGACY_ALLOWED_KEYS]);
  const storyCount = normalized.storyCount ?? existingState?.storyCount ?? existingState?.storyHeightsM?.length;
  const storyHeightScalar = extractScalar(rawPatch, ['storyHeightScalar', 'storyHeightM', 'uniformStoryHeightM']);
  const bayWidthScalar = extractScalar(rawPatch, ['bayWidthScalar', 'bayWidthM', 'spanM', 'compositeSpanM']);
  const bayCount = normalized.bayCount
    ?? existingState?.bayCount
    ?? normalized.bayWidthsM?.length
    ?? existingState?.bayWidthsM?.length
    // A bare span scalar describes a single-bay composite frame.
    ?? (bayWidthScalar !== undefined ? 1 : undefined);
  const verticalKN = extractScalar(rawPatch, ['verticalLoadKN', 'uniformVerticalLoadKN']);
  const liveLoadKN = extractScalar(rawPatch, ['liveLoadKN', 'uniformLiveLoadKN']);
  const lateralXKN = extractScalar(rawPatch, ['lateralXKN', 'horizontalLoadKN', 'uniformLateralXKN']);

  const compositeSlabThicknessMm = extractScalar(rawPatch, ['compositeSlabThicknessMm', 'slabThicknessMm', 'slabThickness']);
  const compositeSlabWidthM = extractScalar(rawPatch, ['compositeSlabWidthM', 'slabWidthM', 'flangeWidthM']);
  const rawBeamSection = rawPatch?.compositeSteelBeamSection ?? rawPatch?.steelBeamSection;
  const compositeSteelBeamSection = typeof rawBeamSection === 'string' && rawBeamSection.trim()
    ? normalizeSectionName(rawBeamSection)
    : undefined;
  const rawColumnSection = rawPatch?.compositeSteelColumnSection ?? rawPatch?.steelColumnSection;
  const compositeSteelColumnSection = typeof rawColumnSection === 'string' && rawColumnSection.trim()
    ? normalizeSectionName(rawColumnSection)
    : undefined;
  const rawSteelGrade = rawPatch?.compositeSteelGrade ?? rawPatch?.steelGrade;
  const compositeSteelGrade = typeof rawSteelGrade === 'string' && isValidSteelGrade(rawSteelGrade)
    ? normalizeSteelGrade(rawSteelGrade)
    : undefined;
  const rawConcreteGrade = rawPatch?.compositeConcreteGrade ?? rawPatch?.concreteGrade;
  const compositeConcreteGrade = typeof rawConcreteGrade === 'string' && isValidConcreteGrade(rawConcreteGrade)
    ? normalizeConcreteGrade(rawConcreteGrade)
    : undefined;
  const compositeStudDiameterMm = toPositiveNumberFromUnknown(rawPatch?.compositeStudDiameterMm ?? rawPatch?.studDiameterMm);

  return {
    ...normalized,
    // The composite model is always a 2D frame elevation; pinning the dimension
    // keeps mergeDraftState from dropping the bay widths.
    frameDimension: '2d',
    ...(bayCount !== undefined && { bayCount }),
    storyHeightsM: normalized.storyHeightsM ?? repeatScalar(storyCount, storyHeightScalar),
    bayWidthsM: normalized.bayWidthsM ?? repeatScalar(bayCount, bayWidthScalar),
    floorLoads: normalized.floorLoads ?? buildUniformFloorLoads(storyCount, verticalKN, liveLoadKN, lateralXKN),
    ...(compositeSlabThicknessMm !== undefined && { compositeSlabThicknessMm }),
    ...(compositeSlabWidthM !== undefined && { compositeSlabWidthM }),
    ...(compositeSteelBeamSection !== undefined && { compositeSteelBeamSection }),
    ...(compositeSteelColumnSection !== undefined && { compositeSteelColumnSection }),
    ...(compositeSteelGrade !== undefined && { compositeSteelGrade }),
    ...(compositeConcreteGrade !== undefined && { compositeConcreteGrade }),
    ...(compositeStudDiameterMm !== undefined && { compositeStudDiameterMm }),
  };
}

/** Normalize explicitly provided values (form input) the same way the LLM patch is normalized. */
export function parseCompositeProvidedValues(values: Record<string, unknown>): DraftExtraction {
  return buildCompositePatchFromLlm(values, undefined);
}
