import {
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { normalizeNumber } from '../../../agent-runtime/fallback.js';
import { normalizeWallOpenings } from './constants.js';
import { parseSeismicGrade, SEISMIC_GRADE_LABELS } from './design.js';
import {
  isValidConcreteGrade,
  isValidRebarGrade,
  normalizeConcreteGrade,
  normalizeRebarGrade,
} from './model.js';
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

/** Normalize a raw wall patch into wall-specific fields (scalar expansion, grade/section normalization). */
export function buildShearWallPatchFromLlm(
  rawPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalized = restrictLegacyDraftPatch(normalizeLegacyDraftPatch(rawPatch), 'frame', [
    'storyCount',
    'storyHeightsM',
    'floorLoads',
    'frameBaseSupportType',
    'siteSeismic',
  ]);
  const storyCount = normalized.storyCount ?? existingState?.storyCount ?? existingState?.storyHeightsM?.length;
  const storyHeightScalar = extractScalar(rawPatch, ['storyHeightScalar', 'storyHeightM', 'uniformStoryHeightM']);
  const verticalKN = extractScalar(rawPatch, ['verticalLoadKN', 'uniformVerticalLoadKN']);
  const liveLoadKN = extractScalar(rawPatch, ['liveLoadKN', 'uniformLiveLoadKN']);
  const lateralXKN = extractScalar(rawPatch, ['lateralXKN', 'horizontalLoadKN', 'uniformLateralXKN']);

  const wallLengthM = extractScalar(rawPatch, ['wallLengthM', 'wallLength', 'wallTotalLengthM']);
  const wallThicknessMm = extractScalar(rawPatch, ['wallThicknessMm', 'wallThickness', 'thicknessMm']);
  const rawWallConcreteGrade = rawPatch?.wallConcreteGrade;
  const wallConcreteGrade = typeof rawWallConcreteGrade === 'string' && isValidConcreteGrade(rawWallConcreteGrade)
    ? normalizeConcreteGrade(rawWallConcreteGrade)
    : undefined;
  const rawWallRebarGrade = rawPatch?.wallRebarGrade;
  const wallRebarGrade = typeof rawWallRebarGrade === 'string' && isValidRebarGrade(rawWallRebarGrade)
    ? normalizeRebarGrade(rawWallRebarGrade)
    : undefined;
  const seismicGradeValue = parseSeismicGrade(rawPatch?.seismicGrade ?? rawPatch?.wallSeismicGrade);
  const seismicGrade = seismicGradeValue !== undefined ? SEISMIC_GRADE_LABELS[seismicGradeValue] : undefined;
  const wallOpenings = normalizeWallOpenings(rawPatch?.wallOpenings ?? rawPatch?.openings);

  return {
    ...normalized,
    storyHeightsM: normalized.storyHeightsM ?? repeatScalar(storyCount, storyHeightScalar),
    floorLoads: normalized.floorLoads ?? buildUniformFloorLoads(storyCount, verticalKN, liveLoadKN, lateralXKN),
    ...(wallLengthM !== undefined && { wallLengthM }),
    ...(wallThicknessMm !== undefined && { wallThicknessMm }),
    ...(wallConcreteGrade !== undefined && { wallConcreteGrade }),
    ...(wallRebarGrade !== undefined && { wallRebarGrade }),
    ...(seismicGrade !== undefined && { seismicGrade }),
    ...(wallOpenings !== undefined && { wallOpenings }),
  };
}

/** Normalize explicitly provided values (form input) the same way the LLM patch is normalized. */
export function parseShearWallProvidedValues(values: Record<string, unknown>): DraftExtraction {
  return buildShearWallPatchFromLlm(values, undefined);
}
