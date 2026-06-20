import {
  buildLegacyDraftPatchLlmFirst,
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
import { normalizeConcreteFrameNaturalPatch } from './extract-natural.js';
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

function sumPositive(values: number[] | undefined): number | undefined {
  if (!values?.length) return undefined;
  const total = values.reduce((acc, value) => acc + value, 0);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

function _hasSingleBayHint(message: string): boolean {
  return /(?:single[-\s]?bay|单跨|一跨|1\s*跨)/i.test(message);
}

const AREA_LOAD_UNIT_PATTERN = '(?:kn|千牛)\\s*\\/\\s*(?:m\\s*(?:\\^\\s*2|2|²)|㎡|平方米|平米)';
const LINE_LOAD_UNIT_PATTERN = '(?:kn|千牛)\\s*\\/\\s*m(?!\\s*(?:\\^\\s*2|2|²))';

function extractIntensityFromPatterns(message: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return normalizeNumber(match[1]);
  }
  return undefined;
}

function hasAdjacentLiveLoadContext(message: string, index: number): boolean {
  const prefix = message.slice(Math.max(0, index - 20), index);
  return /(?:活载|活荷载|live\s*load|live-load)\s*(?:of\s*)?[：:=为是,，、;\s-]*$/i.test(prefix);
}

function extractDeadLoadIntensity(message: string): number | undefined {
  return extractIntensityFromPatterns(message, [
    new RegExp(`(?:恒载|恒荷载|永久荷载|dead\\s*load|dead-load)\\s*[：:=]*\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${AREA_LOAD_UNIT_PATTERN}`, 'i'),
  ]);
}

function extractAreaLoadIntensity(message: string): number | undefined {
  const pattern = new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*${AREA_LOAD_UNIT_PATTERN}`, 'ig');
  for (const match of message.matchAll(pattern)) {
    if (hasAdjacentLiveLoadContext(message, match.index ?? 0)) continue;
    const value = normalizeNumber(match[1]);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function extractLiveLoadIntensity(message: string): number | undefined {
  return extractIntensityFromPatterns(message, [
    new RegExp(`活载[荷]?\\s*[：:]*\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${AREA_LOAD_UNIT_PATTERN}`, 'i'),
    new RegExp(`live\\s*load\\s*[：:]*\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${AREA_LOAD_UNIT_PATTERN}`, 'i'),
    new RegExp(`活荷载\\s*[：:]*\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${AREA_LOAD_UNIT_PATTERN}`, 'i'),
  ]);
}

function extractLineLoadIntensity(message: string): number | undefined {
  return extractLlmScalar({
    value: message,
    direct: message.match(new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*${LINE_LOAD_UNIT_PATTERN}`, 'i'))?.[1],
  }, ['direct']);
}

function calculateFloorAreaM2(patch: DraftExtraction): number | undefined {
  const dimension = patch.frameDimension
    ?? (patch.bayCountY !== undefined || patch.bayWidthsYM?.length ? '3d' : '2d');

  if (dimension === '3d') {
    const totalSpanX = sumPositive(patch.bayWidthsXM);
    const totalSpanY = sumPositive(patch.bayWidthsYM);
    return totalSpanX !== undefined && totalSpanY !== undefined ? totalSpanX * totalSpanY : undefined;
  }

  const bayWidths2d = patch.bayWidthsM ?? patch.bayWidthsXM;
  const totalSpan2d = sumPositive(bayWidths2d);
  return totalSpan2d !== undefined ? totalSpan2d * totalSpan2d : undefined;
}

function extractAreaLoadPair(segment: string): { dead?: number; live?: number } {
  const unit = `(?:\\s*${AREA_LOAD_UNIT_PATTERN})?`;
  const deadMatch = segment.match(new RegExp(`(?:恒载|恒荷载|永久荷载|dead\\s*load|dead-load)\\s*[：:=为是]*\\s*([0-9]+(?:\\.[0-9]+)?)${unit}`, 'i'));
  const liveMatch = segment.match(new RegExp(`(?:活载|活荷载|live\\s*load|live-load)\\s*[：:=为是]*\\s*([0-9]+(?:\\.[0-9]+)?)${unit}`, 'i'));
  return {
    dead: normalizeNumber(deadMatch?.[1]),
    live: normalizeNumber(liveMatch?.[1]),
  };
}

function chineseStoryOrdinal(raw: string): number | undefined {
  const text = raw.replace(/第/g, '').replace(/层/g, '').trim();
  const arabic = Number.parseInt(text, 10);
  if (Number.isFinite(arabic) && arabic > 0) return arabic;
  const table: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return table[text];
}

function extractTargetedAreaFloorLoads(
  message: string,
  patch: DraftExtraction,
): DraftFloorLoad[] | undefined {
  const storyCount = patch.storyCount ?? patch.storyHeightsM?.length;
  const floorAreaM2 = calculateFloorAreaM2(patch);
  if (!storyCount || !floorAreaM2 || floorAreaM2 <= 0) return undefined;

  const byStory = new Map<number, DraftFloorLoad>();
  const hasRoofLoad = /屋面[^，。；;]*(?:恒载|活载)/.test(message);
  const storyLabelPattern = '(?:第?[一二两三四五六七八九十]+|[0-9]+)层楼面';
  const storyPattern = new RegExp(`(${storyLabelPattern})(.*?)(?=${storyLabelPattern}|屋面|[。；;]|$)`, 'g');
  for (const match of message.matchAll(storyPattern)) {
    const label = match[1] ?? '';
    const storyOrdinal = chineseStoryOrdinal(label.replace(/楼面/g, ''));
    const pair = extractAreaLoadPair(match[2] ?? '');
    if (storyOrdinal === undefined || (pair.dead === undefined && pair.live === undefined)) continue;
    const story = hasRoofLoad && storyOrdinal > 1
      ? storyOrdinal - 1
      : storyOrdinal;
    if (story < 1 || story > storyCount) continue;
    byStory.set(story, {
      story,
      ...(pair.dead !== undefined && { verticalKN: Number((pair.dead * floorAreaM2).toFixed(6)) }),
      ...(pair.live !== undefined && { liveLoadKN: Number((pair.live * floorAreaM2).toFixed(6)) }),
    });
  }

  const roofMatch = message.match(/屋面([^。；;]*)/);
  if (roofMatch) {
    const pair = extractAreaLoadPair(roofMatch[1] ?? '');
    if (pair.dead !== undefined || pair.live !== undefined) {
      byStory.set(storyCount, {
        story: storyCount,
        ...(pair.dead !== undefined && { verticalKN: Number((pair.dead * floorAreaM2).toFixed(6)) }),
        ...(pair.live !== undefined && { liveLoadKN: Number((pair.live * floorAreaM2).toFixed(6)) }),
      });
    }
  }

  const genericFloorMatch = message.match(/(?:楼面|标准层|各层)([^。；;]*)/);
  if (!byStory.size && genericFloorMatch) {
    const pair = extractAreaLoadPair(genericFloorMatch[1] ?? '');
    if (pair.dead !== undefined || pair.live !== undefined) {
      const endStory = hasRoofLoad && storyCount > 1 ? storyCount - 1 : storyCount;
      for (let story = 1; story <= endStory; story++) {
        byStory.set(story, {
          story,
          ...(pair.dead !== undefined && { verticalKN: Number((pair.dead * floorAreaM2).toFixed(6)) }),
          ...(pair.live !== undefined && { liveLoadKN: Number((pair.live * floorAreaM2).toFixed(6)) }),
        });
      }
    }
  }

  return byStory.size
    ? Array.from(byStory.values()).sort((left, right) => left.story - right.story)
    : undefined;
}

function deriveFloorLoadsFromIntensity(
  message: string,
  patch: DraftExtraction,
): DraftExtraction {
  if (patch.floorLoads?.length) return patch;

  const storyCount = patch.storyCount ?? patch.storyHeightsM?.length;
  if (!storyCount || storyCount <= 0) return patch;

  const areaLoadKNm2 = extractDeadLoadIntensity(message) ?? extractAreaLoadIntensity(message);
  const lineLoadKNm = extractLineLoadIntensity(message);
  const liveLoadKNm2 = extractLiveLoadIntensity(message);
  const targetedAreaLoads = extractTargetedAreaFloorLoads(message, patch);
  if (targetedAreaLoads?.length) return { ...patch, floorLoads: targetedAreaLoads };
  if (areaLoadKNm2 === undefined && lineLoadKNm === undefined && liveLoadKNm2 === undefined) return patch;

  const dimension = patch.frameDimension
    ?? (patch.bayCountY !== undefined || patch.bayWidthsYM?.length ? '3d' : '2d');

  let verticalKN: number | undefined;
  let derivedLiveLoadKN: number | undefined;
  if (dimension === '3d') {
    const totalSpanX = sumPositive(patch.bayWidthsXM);
    const totalSpanY = sumPositive(patch.bayWidthsYM);
    if (areaLoadKNm2 !== undefined && totalSpanX !== undefined && totalSpanY !== undefined) {
      verticalKN = areaLoadKNm2 * totalSpanX * totalSpanY;
    }
  } else {
    const bayWidths2d = patch.bayWidthsM ?? patch.bayWidthsXM;
    const totalSpan2d = sumPositive(bayWidths2d);
    const _bayCount2d = patch.bayCount ?? bayWidths2d?.length ?? patch.bayCountX ?? patch.bayWidthsXM?.length;

    if (lineLoadKNm !== undefined && totalSpan2d !== undefined) {
      verticalKN = lineLoadKNm * totalSpan2d;
    }
    
    // For 2D frames with area load, assume square bay (transverse width = bay width)
    // This gives: verticalKN = areaLoadKNm2 * bayWidth * bayWidth
    if (areaLoadKNm2 !== undefined && totalSpan2d !== undefined) {
      verticalKN = areaLoadKNm2 * totalSpan2d * totalSpan2d;
    }
  }

  // Derive live load KN from intensity (same area logic as dead load)
  if (liveLoadKNm2 !== undefined) {
    if (dimension === '3d') {
      const totalSpanX = sumPositive(patch.bayWidthsXM);
      const totalSpanY = sumPositive(patch.bayWidthsYM);
      if (totalSpanX !== undefined && totalSpanY !== undefined) {
        derivedLiveLoadKN = liveLoadKNm2 * totalSpanX * totalSpanY;
      }
    } else {
      const bayWidths2d = patch.bayWidthsM ?? patch.bayWidthsXM;
      const totalSpan2d = sumPositive(bayWidths2d);
      if (totalSpan2d !== undefined) {
        derivedLiveLoadKN = liveLoadKNm2 * totalSpan2d;
      }
    }
  }

  if ((verticalKN === undefined || !Number.isFinite(verticalKN) || verticalKN <= 0)
    && (derivedLiveLoadKN === undefined || !Number.isFinite(derivedLiveLoadKN) || derivedLiveLoadKN <= 0)) {
    return patch;
  }

  const roundedVerticalKN = verticalKN && Number.isFinite(verticalKN) && verticalKN > 0
    ? Number(verticalKN.toFixed(6)) : undefined;
  const roundedLiveLoadKN = derivedLiveLoadKN && Number.isFinite(derivedLiveLoadKN) && derivedLiveLoadKN > 0
    ? Number(derivedLiveLoadKN.toFixed(6)) : undefined;
  const derivedFloorLoads = buildUniformFloorLoads(storyCount, roundedVerticalKN, roundedLiveLoadKN, undefined, undefined);
  return derivedFloorLoads ? { ...patch, floorLoads: derivedFloorLoads } : patch;
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
  message: string,
): DraftExtraction {
  const nextPatch: DraftExtraction = { ...patch };
  nextPatch.frameDimension = resolveConcreteFrameDimension(nextPatch, existingState, message);
  return fillConcreteFrameDimensionSpecificGeometry(nextPatch);
}

export function buildConcreteFrameDraftPatch(
  message: string,
  llmDraftPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalizedLlmPatch = buildConcreteFramePatchFromLlm(llmDraftPatch, existingState);
  const hasEngineeringDraft = normalizedLlmPatch.engineeringDraft !== undefined;
  const rawNaturalPatch: DraftExtraction = hasEngineeringDraft ? {} : normalizeConcreteFrameNaturalPatch(message, existingState);
  const normalizedNaturalPatch = toConcreteFramePatch(rawNaturalPatch);
  const normalizedRulePatch = hasEngineeringDraft ? {} : toConcreteFramePatch(buildLegacyDraftPatchLlmFirst(message, null));
  const nextPatch = canonicalizeConcreteFramePatch({
    message,
    existingState,
    naturalPatch: {
      ...normalizedRulePatch,
      ...normalizedNaturalPatch,
    },
    llmPatch: normalizedLlmPatch,
  });
  const nextPatchWithDerivedLoads = hasEngineeringDraft ? nextPatch : deriveFloorLoadsFromIntensity(message, nextPatch);

  // M1: Separate concrete and rebar grade extraction
  const frameConcreteGrade = (normalizedLlmPatch.frameConcreteGrade as string | undefined)
    ?? (rawNaturalPatch.frameConcreteGrade as string | undefined);
  const frameRebarGrade = (normalizedLlmPatch.frameRebarGrade as string | undefined)
    ?? (rawNaturalPatch.frameRebarGrade as string | undefined);
  const frameColumnSection = (normalizedLlmPatch.frameColumnSection as string | undefined)
    ?? (rawNaturalPatch.frameColumnSection as string | undefined);
  const frameBeamSection = (normalizedLlmPatch.frameBeamSection as string | undefined)
    ?? (rawNaturalPatch.frameBeamSection as string | undefined);
  const siteSeismic = (normalizedLlmPatch.siteSeismic as DraftSiteSeismicParams | undefined)
    ?? (rawNaturalPatch.siteSeismic as DraftSiteSeismicParams | undefined);
  const wind = (normalizedLlmPatch.wind as DraftWindParams | undefined)
    ?? (rawNaturalPatch.wind as DraftWindParams | undefined);
  const analysisControl = (normalizedLlmPatch.analysisControl as DraftAnalysisControl | undefined)
    ?? (rawNaturalPatch.analysisControl as DraftAnalysisControl | undefined);

  return coerceConcreteFrameDimension(
    {
      ...nextPatchWithDerivedLoads,
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
    message,
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
