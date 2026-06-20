import {
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { projectEngineeringDraftToLegacyPatch } from '../../../agent-runtime/engineering-draft.js';
import { composeStructuralDomainPatch } from '../../../agent-runtime/domains/structural-domains.js';
import { normalizeNumber } from '../../../agent-runtime/fallback.js';
import type {
  DraftAnalysisControl,
  DraftExtraction,
  DraftFloorLoad,
  DraftSiteSeismicParams,
  DraftState,
  DraftWindParams,
} from '../../../agent-runtime/types.js';
import {
  canonicalizeConcreteFramePatch,
  fillConcreteFrameDimensionSpecificGeometry,
  hasLateralYFloorLoad as hasLateralYFloorLoadCanonical,
  resolveConcreteFrameDimension,
} from './canonicalize.js';
import { DESIGN_CONDITION_KEYS, GEOMETRY_KEYS, LOAD_BOUNDARY_KEYS } from './constants.js';
import {
  normalizeSeismicDesignGroup,
  normalizeSeismicSiteCategory,
  normalizeWindTerrainRoughness,
} from './design-conditions.js';
import { normalizeConcreteGrade, normalizeSectionName } from './model.js';

export function toConcreteFramePatch(patch: DraftExtraction): DraftExtraction {
  const semanticPatch = projectEngineeringDraftToLegacyPatch(patch, 'frame');
  const domainPatch = composeStructuralDomainPatch({
    patch: semanticPatch,
    geometryKeys: GEOMETRY_KEYS,
    loadBoundaryKeys: LOAD_BOUNDARY_KEYS,
  });
  const next = restrictLegacyDraftPatch(domainPatch, 'frame', [...GEOMETRY_KEYS, ...LOAD_BOUNDARY_KEYS]);
  for (const key of DESIGN_CONDITION_KEYS) {
    if (semanticPatch[key] !== undefined) {
      (next as Record<string, unknown>)[key] = semanticPatch[key];
    }
  }
  for (const key of ['frameMaterial', 'frameConcreteGrade', 'frameRebarGrade', 'frameColumnSection', 'frameBeamSection'] as const) {
    if (semanticPatch[key] !== undefined) {
      (next as Record<string, unknown>)[key] = semanticPatch[key];
    }
  }
  if (semanticPatch.engineeringDraft) {
    next.engineeringDraft = semanticPatch.engineeringDraft;
  }
  if (semanticPatch.skillState) {
    next.skillState = semanticPatch.skillState;
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

export function buildConcreteFramePatchFromLlm(
  rawPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalized = toConcreteFramePatch(normalizeLegacyDraftPatch(rawPatch));
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

  // M1: Separate concrete and rebar grade extraction
  const frameConcreteGrade = typeof rawPatch?.frameConcreteGrade === 'string'
    ? normalizeConcreteGrade(rawPatch.frameConcreteGrade)
    : undefined;
  const frameRebarGrade = typeof rawPatch?.frameRebarGrade === 'string'
    ? normalizeConcreteGrade(rawPatch.frameRebarGrade) // Reuse normalize for consistency
    : undefined;
  const frameColumnSection = typeof rawPatch?.frameColumnSection === 'string'
    ? normalizeSectionName(rawPatch.frameColumnSection)
    : undefined;
  const frameBeamSection = typeof rawPatch?.frameBeamSection === 'string'
    ? normalizeSectionName(rawPatch.frameBeamSection)
    : undefined;
  const siteSeismic = normalizeSiteSeismicPatch(rawPatch, existingState);
  const wind = normalizeWindPatch(rawPatch, existingState);
  const analysisControl = normalizeAnalysisControlPatch(rawPatch, existingState);

  return {
    ...normalized,
    frameDimension,
    storyHeightsM: normalized.storyHeightsM ?? repeatScalar(storyCount, storyHeightScalar),
    bayWidthsM: normalized.bayWidthsM ?? repeatScalar(bayCount, bayWidthScalar),
    bayWidthsXM: normalized.bayWidthsXM ?? repeatScalar(bayCountX, bayWidthXScalar ?? bayWidthScalar),
    bayWidthsYM: normalized.bayWidthsYM ?? repeatScalar(bayCountY, bayWidthYScalar ?? bayWidthScalar),
    floorLoads: normalized.floorLoads ?? buildUniformFloorLoads(storyCount, verticalLoadKN, liveLoadKN, lateralXKN, frameDimension === '3d' ? lateralYKN : undefined),
    ...(frameConcreteGrade !== undefined && { frameConcreteGrade }),
    ...(frameRebarGrade !== undefined && { frameRebarGrade }),
    ...(frameColumnSection !== undefined && { frameColumnSection }),
    ...(frameBeamSection !== undefined && { frameBeamSection }),
    ...(siteSeismic !== undefined && { siteSeismic }),
    ...(wind !== undefined && { wind }),
    ...(analysisControl !== undefined && { analysisControl }),
  };
}

export function hasLateralYFloorLoad(floorLoads: DraftFloorLoad[] | undefined): boolean {
  return hasLateralYFloorLoadCanonical(floorLoads);
}

export function coerceConcreteFrameDimension(
  patch: DraftExtraction,
  existingState: DraftState | undefined,
): DraftExtraction {
  const nextPatch: DraftExtraction = { ...patch };
  nextPatch.frameDimension = resolveConcreteFrameDimension(nextPatch, existingState);
  return fillConcreteFrameDimensionSpecificGeometry(nextPatch);
}

export function buildConcreteFrameDraftPatch(
  llmDraftPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalizedLlmPatch = buildConcreteFramePatchFromLlm(llmDraftPatch, existingState);
  const nextPatch = canonicalizeConcreteFramePatch({
    existingState,
    supplementalPatch: {},
    llmPatch: normalizedLlmPatch,
  });

  // M1: Separate concrete and rebar grade extraction
  const frameConcreteGrade = normalizedLlmPatch.frameConcreteGrade as string | undefined;
  const frameRebarGrade = normalizedLlmPatch.frameRebarGrade as string | undefined;
  const frameColumnSection = normalizedLlmPatch.frameColumnSection as string | undefined;
  const frameBeamSection = normalizedLlmPatch.frameBeamSection as string | undefined;
  const siteSeismic = normalizedLlmPatch.siteSeismic as DraftSiteSeismicParams | undefined;
  const wind = normalizedLlmPatch.wind as DraftWindParams | undefined;
  const analysisControl = normalizedLlmPatch.analysisControl as DraftAnalysisControl | undefined;

  return coerceConcreteFrameDimension(
    {
      ...nextPatch,
      inferredType: 'frame',
      ...(frameConcreteGrade !== undefined && { frameConcreteGrade }),
      ...(frameRebarGrade !== undefined && { frameRebarGrade }),
      ...(frameColumnSection !== undefined && { frameColumnSection }),
      ...(frameBeamSection !== undefined && { frameBeamSection }),
      ...(siteSeismic !== undefined && { siteSeismic }),
      ...(wind !== undefined && { wind }),
      ...(analysisControl !== undefined && { analysisControl }),
    },
    existingState,
  );
}

function normalizePlainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeSiteSeismicPatch(
  rawPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftSiteSeismicParams | undefined {
  const raw = normalizePlainRecord(rawPatch?.siteSeismic)
    ?? normalizePlainRecord(rawPatch?.site_seismic)
    ?? normalizePlainRecord(rawPatch?.seismic);
  const intensity = extractLlmScalar(raw ?? rawPatch, ['intensity', 'seismicIntensity', 'frameSeismicIntensity']);
  const accelerationG = extractLlmScalar(raw ?? rawPatch, ['accelerationG', 'seismicAccelerationG', 'frameSeismicAccelerationG']);
  const characteristicPeriod = extractLlmScalar(raw ?? rawPatch, ['characteristicPeriod', 'characteristic_period']);
  const maxInfluenceCoefficient = extractLlmScalar(raw ?? rawPatch, ['maxInfluenceCoefficient', 'max_influence_coefficient']);
  const dampingRatio = extractLlmScalar(raw ?? rawPatch, ['dampingRatio', 'damping_ratio']);
  const designGroup = normalizeSeismicDesignGroup(raw?.designGroup ?? raw?.design_group ?? rawPatch?.frameSeismicDesignGroup);
  const siteCategory = normalizeSeismicSiteCategory(raw?.siteCategory ?? raw?.site_category ?? rawPatch?.frameSeismicSiteCategory);
  const merged: DraftSiteSeismicParams = {
    ...(existingState?.siteSeismic ?? {}),
    ...(intensity !== undefined && { intensity }),
    ...(accelerationG !== undefined && { accelerationG }),
    ...(designGroup !== undefined && { designGroup }),
    ...(siteCategory !== undefined && { siteCategory }),
    ...(characteristicPeriod !== undefined && { characteristicPeriod }),
    ...(maxInfluenceCoefficient !== undefined && { maxInfluenceCoefficient }),
    ...(dampingRatio !== undefined && { dampingRatio }),
  };
  return Object.keys(merged).length ? merged : undefined;
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

function normalizeAnalysisControlPatch(
  rawPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftAnalysisControl | undefined {
  const raw = normalizePlainRecord(rawPatch?.analysisControl)
    ?? normalizePlainRecord(rawPatch?.analysis_control);
  if (!raw) return existingState?.analysisControl;
  const merged: DraftAnalysisControl = {
    ...(existingState?.analysisControl ?? {}),
    ...(typeof raw.pDelta === 'boolean' && { pDelta: raw.pDelta }),
    ...(typeof raw.p_delta === 'boolean' && { pDelta: raw.p_delta }),
    ...(typeof raw.rigidFloor === 'boolean' && { rigidFloor: raw.rigidFloor }),
    ...(typeof raw.rigid_floor === 'boolean' && { rigidFloor: raw.rigid_floor }),
    ...(typeof raw.considerationTorsion === 'boolean' && { considerationTorsion: raw.considerationTorsion }),
    ...(typeof raw.consideration_torsion === 'boolean' && { considerationTorsion: raw.consideration_torsion }),
    ...(typeof raw.liveLoadReduction === 'boolean' && { liveLoadReduction: raw.liveLoadReduction }),
    ...(typeof raw.live_load_reduction === 'boolean' && { liveLoadReduction: raw.live_load_reduction }),
    ...(extractLlmScalar(raw, ['periodReductionFactor', 'period_reduction_factor']) !== undefined && {
      periodReductionFactor: extractLlmScalar(raw, ['periodReductionFactor', 'period_reduction_factor']),
    }),
    ...(extractLlmScalar(raw, ['accidentalEccentricity', 'accidental_eccentricity']) !== undefined && {
      accidentalEccentricity: extractLlmScalar(raw, ['accidentalEccentricity', 'accidental_eccentricity']),
    }),
    ...(extractLlmScalar(raw, ['modalCount', 'modal_count']) !== undefined && {
      modalCount: extractLlmScalar(raw, ['modalCount', 'modal_count']),
    }),
    ...(extractLlmScalar(raw, ['basementCount', 'basement_count']) !== undefined && {
      basementCount: extractLlmScalar(raw, ['basementCount', 'basement_count']),
    }),
    ...(extractLlmScalar(raw, ['structureImportanceFactor', 'structure_importance_factor']) !== undefined && {
      structureImportanceFactor: extractLlmScalar(raw, ['structureImportanceFactor', 'structure_importance_factor']),
    }),
    ...(extractLlmScalar(raw, ['dampingRatioWind', 'damping_ratio_wind']) !== undefined && {
      dampingRatioWind: extractLlmScalar(raw, ['dampingRatioWind', 'damping_ratio_wind']),
    }),
    ...(normalizePlainRecord(raw.designParams ?? raw.design_params) !== undefined && {
      designParams: normalizePlainRecord(raw.designParams ?? raw.design_params),
    }),
  };
  return Object.keys(merged).length ? merged : undefined;
}
