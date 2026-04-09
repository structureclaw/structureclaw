import {
  buildLegacyDraftPatchLlmFirst,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { composeStructuralDomainPatch } from '../../../agent-runtime/domains/structural-domains.js';
import { normalizeNumber } from '../../../agent-runtime/fallback.js';
import type { DraftExtraction, DraftFloorLoad, DraftState } from '../../../agent-runtime/types.js';
import {
  canonicalizeFramePatch,
  fillFrameDimensionSpecificGeometry,
  hasLateralYFloorLoad as hasLateralYFloorLoadCanonical,
  resolveFrameDimension,
} from './canonicalize.js';
import { GEOMETRY_KEYS, LOAD_BOUNDARY_KEYS } from './constants.js';
import { normalizeFrameNaturalPatch } from './extract-natural.js';
import { normalizeSectionName, normalizeSteelGrade } from './model.js';

export function toFramePatch(patch: DraftExtraction): DraftExtraction {
  const domainPatch = composeStructuralDomainPatch({
    patch,
    geometryKeys: GEOMETRY_KEYS,
    loadBoundaryKeys: LOAD_BOUNDARY_KEYS,
  });
  return restrictLegacyDraftPatch(domainPatch, 'frame', [...GEOMETRY_KEYS, ...LOAD_BOUNDARY_KEYS]);
}

function extractLlmScalar(raw: Record<string, unknown> | null | undefined, keys: string[]): number | undefined {
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
  lateralXKN: number | undefined,
  lateralYKN: number | undefined,
): DraftFloorLoad[] | undefined {
  if (!storyCount) return undefined;
  if (verticalKN === undefined && lateralXKN === undefined && lateralYKN === undefined) return undefined;
  return Array.from({ length: storyCount }, (_, index) => ({
    story: index + 1,
    verticalKN,
    lateralXKN,
    lateralYKN,
  }));
}

export function buildFramePatchFromLlm(
  rawPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalized = toFramePatch(normalizeLegacyDraftPatch(rawPatch));
  const storyCount = normalized.storyCount ?? existingState?.storyCount ?? existingState?.storyHeightsM?.length;
  const bayCount = normalized.bayCount ?? existingState?.bayCount;
  const bayCountX = normalized.bayCountX ?? existingState?.bayCountX;
  const bayCountY = normalized.bayCountY ?? existingState?.bayCountY;
  const storyHeightScalar = extractLlmScalar(rawPatch, ['storyHeightScalar', 'storyHeightM', 'uniformStoryHeightM']);
  const bayWidthScalar = extractLlmScalar(rawPatch, ['bayWidthScalar', 'bayWidthM', 'spacingM']);
  const bayWidthXScalar = extractLlmScalar(rawPatch, ['bayWidthXScalar', 'bayWidthXM', 'spacingXM']);
  const bayWidthYScalar = extractLlmScalar(rawPatch, ['bayWidthYScalar', 'bayWidthYM', 'spacingYM']);
  const verticalLoadKN = extractLlmScalar(rawPatch, ['verticalLoadKN', 'uniformVerticalLoadKN']);
  const lateralXKN = extractLlmScalar(rawPatch, ['lateralXKN', 'horizontalLoadKN', 'uniformLateralXKN']);
  const lateralYKN = extractLlmScalar(rawPatch, ['lateralYKN', 'uniformLateralYKN']);
  const frameDimension = normalized.frameDimension
    ?? (normalized.bayCountY !== undefined || normalized.bayWidthsYM !== undefined || lateralYKN !== undefined ? '3d' : undefined);

  const frameMaterial = typeof rawPatch?.frameMaterial === 'string'
    ? normalizeSteelGrade(rawPatch.frameMaterial)
    : undefined;
  const frameColumnSection = typeof rawPatch?.frameColumnSection === 'string'
    ? normalizeSectionName(rawPatch.frameColumnSection)
    : undefined;
  const frameBeamSection = typeof rawPatch?.frameBeamSection === 'string'
    ? normalizeSectionName(rawPatch.frameBeamSection)
    : undefined;

  return {
    ...normalized,
    frameDimension,
    storyHeightsM: normalized.storyHeightsM ?? repeatScalar(storyCount, storyHeightScalar),
    bayWidthsM: normalized.bayWidthsM ?? repeatScalar(bayCount, bayWidthScalar),
    bayWidthsXM: normalized.bayWidthsXM ?? repeatScalar(bayCountX, bayWidthXScalar ?? bayWidthScalar),
    bayWidthsYM: normalized.bayWidthsYM ?? repeatScalar(bayCountY, bayWidthYScalar ?? bayWidthScalar),
    floorLoads: normalized.floorLoads ?? buildUniformFloorLoads(storyCount, verticalLoadKN, lateralXKN, frameDimension === '3d' ? lateralYKN : undefined),
    ...(frameMaterial !== undefined && { frameMaterial }),
    ...(frameColumnSection !== undefined && { frameColumnSection }),
    ...(frameBeamSection !== undefined && { frameBeamSection }),
  };
}

export function hasLateralYFloorLoad(floorLoads: DraftFloorLoad[] | undefined): boolean {
  return hasLateralYFloorLoadCanonical(floorLoads);
}

export function coerceFrameDimension(
  patch: DraftExtraction,
  existingState: DraftState | undefined,
  message: string,
): DraftExtraction {
  const nextPatch: DraftExtraction = { ...patch };
  nextPatch.frameDimension = resolveFrameDimension(nextPatch, existingState, message);
  return fillFrameDimensionSpecificGeometry(nextPatch);
}

export function buildFrameDraftPatch(
  message: string,
  llmDraftPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalizedLlmPatch = buildFramePatchFromLlm(llmDraftPatch, existingState);
  const rawNaturalPatch = normalizeFrameNaturalPatch(message, existingState);
  const normalizedNaturalPatch = toFramePatch(rawNaturalPatch);
  const normalizedRulePatch = toFramePatch(buildLegacyDraftPatchLlmFirst(message, null));
  const nextPatch = canonicalizeFramePatch({
    message,
    existingState,
    naturalPatch: {
      ...normalizedRulePatch,
      ...normalizedNaturalPatch,
    },
    llmPatch: normalizedLlmPatch,
  });

  const frameMaterial = (normalizedLlmPatch.frameMaterial as string | undefined)
    ?? (rawNaturalPatch.frameMaterial as string | undefined);
  const frameColumnSection = (normalizedLlmPatch.frameColumnSection as string | undefined)
    ?? (rawNaturalPatch.frameColumnSection as string | undefined);
  const frameBeamSection = (normalizedLlmPatch.frameBeamSection as string | undefined)
    ?? (rawNaturalPatch.frameBeamSection as string | undefined);

  return coerceFrameDimension(
    {
      ...nextPatch,
      inferredType: 'frame',
      ...(frameMaterial !== undefined && { frameMaterial }),
      ...(frameColumnSection !== undefined && { frameColumnSection }),
      ...(frameBeamSection !== undefined && { frameBeamSection }),
    },
    existingState,
    message,
  );
}
