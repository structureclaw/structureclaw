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

function hasSingleBayHint(message: string): boolean {
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
    const bayCount2d = patch.bayCount ?? bayWidths2d?.length ?? patch.bayCountX ?? patch.bayWidthsXM?.length;

    if (lineLoadKNm !== undefined && totalSpan2d !== undefined) {
      verticalKN = lineLoadKNm * totalSpan2d;
    }

    if (
      verticalKN === undefined
      && areaLoadKNm2 !== undefined
      && totalSpan2d !== undefined
      && (bayCount2d === 1 || hasSingleBayHint(message))
    ) {
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

  return {
    ...normalized,
    frameDimension,
    storyHeightsM: normalized.storyHeightsM ?? repeatScalar(storyCount, storyHeightScalar),
    bayWidthsM: normalized.bayWidthsM ?? repeatScalar(bayCount, bayWidthScalar),
    bayWidthsXM: normalized.bayWidthsXM ?? repeatScalar(bayCountX, bayWidthXScalar ?? bayWidthScalar),
    bayWidthsYM: normalized.bayWidthsYM ?? repeatScalar(bayCountY, bayWidthYScalar ?? bayWidthScalar),
    floorLoads: normalized.floorLoads ?? buildUniformFloorLoads(storyCount, verticalLoadKN, liveLoadKN, lateralXKN, frameDimension === '3d' ? lateralYKN : undefined),
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
  const nextPatchWithDerivedLoads = deriveFloorLoadsFromIntensity(message, nextPatch);

  const frameMaterial = (normalizedLlmPatch.frameMaterial as string | undefined)
    ?? (rawNaturalPatch.frameMaterial as string | undefined);
  const frameColumnSection = (normalizedLlmPatch.frameColumnSection as string | undefined)
    ?? (rawNaturalPatch.frameColumnSection as string | undefined);
  const frameBeamSection = (normalizedLlmPatch.frameBeamSection as string | undefined)
    ?? (rawNaturalPatch.frameBeamSection as string | undefined);

  return coerceFrameDimension(
    {
      ...nextPatchWithDerivedLoads,
      inferredType: 'frame',
      ...(frameMaterial !== undefined && { frameMaterial }),
      ...(frameColumnSection !== undefined && { frameColumnSection }),
      ...(frameBeamSection !== undefined && { frameBeamSection }),
    },
    existingState,
    message,
  );
}
