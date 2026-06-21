import {
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import {
  mergeFrameFloorLoadValues,
  projectEngineeringDraftToLegacyPatch,
  projectWindPressureToFloorLoads,
} from '../../../agent-runtime/engineering-draft.js';
import { composeStructuralDomainPatch } from '../../../agent-runtime/domains/structural-domains.js';
import { normalizeNumber } from '../../../agent-runtime/fallback.js';
import type { DraftExtraction, DraftFloorLoad, DraftState, DraftWindParams } from '../../../agent-runtime/types.js';
import {
  canonicalizeFramePatch,
  fillFrameDimensionSpecificGeometry,
  hasLateralYFloorLoad as hasLateralYFloorLoadCanonical,
  resolveFrameDimension,
} from './canonicalize.js';
import { GEOMETRY_KEYS, LOAD_BOUNDARY_KEYS } from './constants.js';
import { normalizeSectionName, normalizeSteelGrade } from './model.js';

export function toFramePatch(patch: DraftExtraction): DraftExtraction {
  const semanticPatch = projectEngineeringDraftToLegacyPatch(patch, 'frame');
  const domainPatch = composeStructuralDomainPatch({
    patch: semanticPatch,
    geometryKeys: GEOMETRY_KEYS,
    loadBoundaryKeys: LOAD_BOUNDARY_KEYS,
  });
  const next = restrictLegacyDraftPatch(domainPatch, 'frame', [...GEOMETRY_KEYS, ...LOAD_BOUNDARY_KEYS]);
  if (semanticPatch.engineeringDraft) {
    next.engineeringDraft = semanticPatch.engineeringDraft;
  }
  if (semanticPatch.skillState) {
    next.skillState = semanticPatch.skillState;
  }
  if (semanticPatch.wind) {
    next.wind = semanticPatch.wind;
  }
  for (const key of ['frameMaterial', 'frameColumnSection', 'frameBeamSection'] as const) {
    if (semanticPatch[key] !== undefined) {
      (next as Record<string, unknown>)[key] = semanticPatch[key];
    }
  }
  return next;
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
  liveLoadKN: number | undefined,
  lateralXKN: number | undefined,
  lateralYKN: number | undefined,
): DraftFloorLoad[] | undefined {
  if (!storyCount) return undefined;
  if (verticalKN === undefined && liveLoadKN === undefined && lateralXKN === undefined && lateralYKN === undefined) return undefined;
  return Array.from({ length: storyCount }, (_, index) => ({
    story: index + 1,
    verticalKN,
    liveLoadKN,
    lateralXKN,
    lateralYKN,
  }));
}

function normalizePlainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeWindTerrainRoughness(value: unknown): DraftWindParams['terrainRoughness'] | undefined {
  const raw = typeof value === 'string' ? value.trim().toUpperCase().replace(/类$/, '') : undefined;
  return raw === 'A' || raw === 'B' || raw === 'C' || raw === 'D' ? raw : undefined;
}

function normalizeWindPatch(
  rawPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftWindParams | undefined {
  const raw = normalizePlainRecord(rawPatch?.wind)
    ?? normalizePlainRecord(rawPatch?.windParams);
  const basicPressureKNM2 = extractLlmScalar(raw ?? rawPatch, ['basicPressureKNM2', 'basic_pressure', 'basicPressure', 'windPressure', 'frameWindBasicPressureKNM2']);
  const shapeFactor = extractLlmScalar(raw ?? rawPatch, ['shapeFactor', 'shape_factor']);
  const heightVariationFactor = extractLlmScalar(raw ?? rawPatch, ['heightVariationFactor', 'height_variation_factor']);
  const terrainRoughness = normalizeWindTerrainRoughness(raw?.terrainRoughness ?? raw?.terrain_roughness ?? rawPatch?.frameWindTerrainRoughness);
  const merged: DraftWindParams = {
    ...(existingState?.wind ?? {}),
    ...(basicPressureKNM2 !== undefined && { basicPressureKNM2 }),
    ...(terrainRoughness !== undefined && { terrainRoughness }),
    ...(shapeFactor !== undefined && { shapeFactor }),
    ...(heightVariationFactor !== undefined && { heightVariationFactor }),
  };
  return Object.keys(merged).length ? merged : undefined;
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
  const liveLoadKN = extractLlmScalar(rawPatch, ['liveLoadKN', 'uniformLiveLoadKN']);
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
  const wind = normalizeWindPatch(rawPatch, existingState) ?? normalized.wind;
  const patchWithGeometry: DraftExtraction = {
    ...normalized,
    storyHeightsM: normalized.storyHeightsM ?? repeatScalar(storyCount, storyHeightScalar),
    bayWidthsM: normalized.bayWidthsM ?? repeatScalar(bayCount, bayWidthScalar),
    bayWidthsXM: normalized.bayWidthsXM ?? repeatScalar(bayCountX, bayWidthXScalar ?? bayWidthScalar),
    bayWidthsYM: normalized.bayWidthsYM ?? repeatScalar(bayCountY, bayWidthYScalar ?? bayWidthScalar),
    ...(wind !== undefined && { wind }),
  };
  const directFloorLoads = normalized.floorLoads ?? buildUniformFloorLoads(storyCount, verticalLoadKN, liveLoadKN, lateralXKN, frameDimension === '3d' ? lateralYKN : undefined);
  const windFloorLoads = projectWindPressureToFloorLoads(wind, {
    ...patchWithGeometry,
    storyCount: storyCount ?? patchWithGeometry.storyCount,
    storyHeightsM: patchWithGeometry.storyHeightsM ?? existingState?.storyHeightsM,
    bayWidthsM: patchWithGeometry.bayWidthsM ?? existingState?.bayWidthsM,
    bayWidthsXM: patchWithGeometry.bayWidthsXM ?? existingState?.bayWidthsXM,
    bayWidthsYM: patchWithGeometry.bayWidthsYM ?? existingState?.bayWidthsYM,
  });
  const floorLoads = mergeFrameFloorLoadValues(directFloorLoads, windFloorLoads);

  return {
    ...patchWithGeometry,
    frameDimension,
    floorLoads,
    ...(frameMaterial !== undefined && { frameMaterial }),
    ...(frameColumnSection !== undefined && { frameColumnSection }),
    ...(frameBeamSection !== undefined && { frameBeamSection }),
    ...(wind !== undefined && { wind }),
  };
}

export function hasLateralYFloorLoad(floorLoads: DraftFloorLoad[] | undefined): boolean {
  return hasLateralYFloorLoadCanonical(floorLoads);
}

export function coerceFrameDimension(
  patch: DraftExtraction,
  existingState: DraftState | undefined,
): DraftExtraction {
  const nextPatch: DraftExtraction = { ...patch };
  nextPatch.frameDimension = resolveFrameDimension(nextPatch, existingState);
  return fillFrameDimensionSpecificGeometry(nextPatch);
}

export function buildFrameDraftPatch(
  llmDraftPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalizedLlmPatch = buildFramePatchFromLlm(llmDraftPatch, existingState);
  const nextPatch = canonicalizeFramePatch({
    existingState,
    supplementalPatch: {},
    llmPatch: normalizedLlmPatch,
  });

  const frameMaterial = normalizedLlmPatch.frameMaterial as string | undefined;
  const frameColumnSection = normalizedLlmPatch.frameColumnSection as string | undefined;
  const frameBeamSection = normalizedLlmPatch.frameBeamSection as string | undefined;

  return coerceFrameDimension(
    {
      ...nextPatch,
      inferredType: 'frame',
      ...(frameMaterial !== undefined && { frameMaterial }),
      ...(frameColumnSection !== undefined && { frameColumnSection }),
      ...(frameBeamSection !== undefined && { frameBeamSection }),
    },
    existingState,
  );
}
