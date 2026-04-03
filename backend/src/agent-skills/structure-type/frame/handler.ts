import {
  buildLegacyDraftPatchLlmFirst,
  buildLegacyLabels,
  computeLegacyMissing,
  mergeLegacyDraftPatchLlmFirst,
  mergeLegacyState,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { combineDomainKeys, composeStructuralDomainPatch } from '../../../agent-runtime/domains/structural-domains.js';
import { buildStructuralTypeMatch, resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
import { buildInteractionQuestions, normalizeNumber, normalizePositiveInteger } from '../../../agent-runtime/fallback.js';
import { computeMissingCriticalKeys } from '../../../agent-runtime/draft-guidance.js';
import { buildDefaultReportNarrative } from '../../../agent-runtime/report-template.js';
import type { AppLocale } from '../../../services/locale.js';
import type {
  DraftExtraction,
  DraftFloorLoad,
  DraftState,
  InteractionQuestion,
  StructuralTypeMatch,
  SkillDefaultProposal,
  SkillHandler,
  SkillReportNarrativeInput,
} from '../../../agent-runtime/types.js';

// ─── Domain key sets ────────────────────────────────────────────────────────

const GEOMETRY_KEYS = [
  'frameDimension',
  'storyCount',
  'bayCount',
  'bayCountX',
  'bayCountY',
  'storyHeightsM',
  'bayWidthsM',
  'bayWidthsXM',
  'bayWidthsYM',
] as const;

const LOAD_BOUNDARY_KEYS = ['floorLoads', 'frameBaseSupportType'] as const;
const ALLOWED_KEYS = combineDomainKeys(GEOMETRY_KEYS, LOAD_BOUNDARY_KEYS);

// Geometry + loads required keys (material/section checked separately in computeMissing)
const REQUIRED_KEYS = [
  'frameDimension',
  'storyCount',
  'bayCount',
  'bayCountX',
  'bayCountY',
  'storyHeightsM',
  'bayWidthsM',
  'bayWidthsXM',
  'bayWidthsYM',
  'floorLoads',
] as const;

// Frame-specific material/section fields — extracted and proposed but NOT blocking.
// The model builder falls back to grade-appropriate defaults when these are absent,
// so they never appear as critical-missing and do not block model generation.
const FRAME_MATERIAL_KEYS = ['frameMaterial', 'frameColumnSection', 'frameBeamSection'] as const;

// ─── Steel grade properties ──────────────────────────────────────────────────
// E, G: MPa; nu: –; rho: kg/m³; fy: MPa (yield strength)

const STEEL_GRADE_PROPERTIES: Record<string, { E: number; G: number; nu: number; rho: number; fy: number }> = {
  Q235: { E: 206000, G: 79000, nu: 0.3, rho: 7850, fy: 235 },
  Q345: { E: 206000, G: 79000, nu: 0.3, rho: 7850, fy: 345 },
  Q355: { E: 206000, G: 79000, nu: 0.3, rho: 7850, fy: 355 },
  Q390: { E: 206000, G: 79000, nu: 0.3, rho: 7850, fy: 390 },
  Q420: { E: 206000, G: 79000, nu: 0.3, rho: 7850, fy: 420 },
  S235: { E: 210000, G: 81000, nu: 0.3, rho: 7850, fy: 235 },
  S275: { E: 210000, G: 81000, nu: 0.3, rho: 7850, fy: 275 },
  S355: { E: 210000, G: 81000, nu: 0.3, rho: 7850, fy: 355 },
  A36:  { E: 200000, G: 77000, nu: 0.3, rho: 7850, fy: 248 },
};

// ─── H-section properties ────────────────────────────────────────────────────
// A: m²; Iy (strong): m⁴; Iz (weak): m⁴; J (St. Venant torsion): m⁴
// Keys use uppercase X as delimiter (e.g. HW350X350)

const H_SECTION_PROPERTIES: Record<string, { A: number; Iy: number; Iz: number; J: number }> = {
  'HW200X200': { A: 0.00640, Iy: 4.72e-5, Iz: 1.60e-5, J: 1.70e-6 },
  'HW250X250': { A: 0.00920, Iy: 1.07e-4, Iz: 3.65e-5, J: 2.90e-6 },
  'HW300X300': { A: 0.01192, Iy: 2.04e-4, Iz: 6.75e-5, J: 4.23e-6 },
  'HW350X350': { A: 0.01739, Iy: 4.03e-4, Iz: 1.36e-4, J: 8.63e-6 },
  'HW400X400': { A: 0.01972, Iy: 6.67e-4, Iz: 2.24e-4, J: 1.01e-5 },
  'HW450X300': { A: 0.01870, Iy: 7.93e-4, Iz: 2.03e-4, J: 9.86e-6 },
  'HN300X150': { A: 0.00487, Iy: 7.21e-5, Iz: 5.08e-6, J: 5.18e-7 },
  'HN350X175': { A: 0.00629, Iy: 1.36e-4, Iz: 9.84e-6, J: 6.32e-7 },
  'HN400X200': { A: 0.00842, Iy: 2.37e-4, Iz: 1.74e-5, J: 8.44e-7 },
  'HN450X200': { A: 0.00961, Iy: 3.32e-4, Iz: 1.87e-5, J: 9.68e-7 },
  'HN500X200': { A: 0.01143, Iy: 5.02e-4, Iz: 2.14e-5, J: 1.24e-6 },
  'HN600X200': { A: 0.01341, Iy: 9.06e-4, Iz: 2.27e-5, J: 1.48e-6 },
};

function getDefaultColumnSection(storyCount: number): string {
  if (storyCount > 10) return 'HW400X400';
  if (storyCount > 5) return 'HW350X350';
  return 'HW300X300';
}

function getDefaultBeamSection(storyCount: number): string {
  if (storyCount > 10) return 'HN500X200';
  if (storyCount > 5) return 'HN400X200';
  return 'HN300X150';
}

function normalizeSteelGrade(raw: string): string {
  const upper = raw.toUpperCase();
  return Object.keys(STEEL_GRADE_PROPERTIES).find((g) => g === upper) ?? upper;
}

function normalizeSectionName(raw: string): string {
  return raw.toUpperCase().replace(/[×x]/gi, 'X');
}

type SteelGradeProps = { E: number; G: number; nu: number; rho: number; fy: number };
type SectionProps = { name: string; A: number; Iy: number; Iz: number; J: number; G: number };

function resolveSteelGradeProps(grade: string | undefined): SteelGradeProps & { resolvedGrade: string } {
  const normalized = normalizeSteelGrade(grade ?? 'Q355');
  const resolved = STEEL_GRADE_PROPERTIES[normalized] ? normalized : 'Q355';
  return { ...STEEL_GRADE_PROPERTIES[resolved]!, resolvedGrade: resolved };
}

function resolveSectionProps(
  section: string | undefined,
  role: 'column' | 'beam',
  storyCount: number,
  matG: number,
): SectionProps {
  const defaultSection = role === 'column'
    ? getDefaultColumnSection(storyCount)
    : getDefaultBeamSection(storyCount);
  const normalized = section ? normalizeSectionName(section) : defaultSection;
  const sectionKey = H_SECTION_PROPERTIES[normalized] ? normalized : defaultSection;
  return { name: sectionKey, ...H_SECTION_PROPERTIES[sectionKey]!, G: matG };
}

// ─── Domain projection ───────────────────────────────────────────────────────

function toFramePatch(patch: DraftExtraction): DraftExtraction {
  const domainPatch = composeStructuralDomainPatch({
    patch,
    geometryKeys: GEOMETRY_KEYS,
    loadBoundaryKeys: LOAD_BOUNDARY_KEYS,
  });
  return restrictLegacyDraftPatch(domainPatch, 'frame', [...ALLOWED_KEYS]);
}

// ─── Chinese numeral helpers ─────────────────────────────────────────────────

const CHINESE_NUMERAL_MAP: Record<string, number> = {
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

function parseLocalizedPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const direct = normalizePositiveInteger(trimmed);
  if (direct !== undefined) return direct;
  if (trimmed === '十') return 10;
  if (trimmed.length === 2 && trimmed.startsWith('十')) {
    const ones = CHINESE_NUMERAL_MAP[trimmed[1]];
    return ones ? 10 + ones : undefined;
  }
  if (trimmed.length === 2 && trimmed.endsWith('十')) {
    const tens = CHINESE_NUMERAL_MAP[trimmed[0]];
    return tens ? tens * 10 : undefined;
  }
  return CHINESE_NUMERAL_MAP[trimmed];
}

function extractPositiveInt(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = parseLocalizedPositiveInt(match[1]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function extractScalar(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = normalizeNumber(match[1]);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function extractDirectionalLoadScalar(text: string, axis: 'x' | 'y'): number | undefined {
  const axisToken = axis;
  return extractScalar(text, [
    new RegExp(`${axisToken}(?:方)?向(?:水平|横向|侧向)?(?:总)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`(?:水平|横向|侧向)?(?:总)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是)?[^\\n]{0,24}?${axisToken}(?:方)?向\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`${axisToken}(?:方)?向\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:kn|千牛)`, 'i'),
  ]);
}

function shouldMirrorHorizontalLoadToBothAxes(
  text: string,
  existingState: DraftState | undefined,
  inferred3d: boolean,
): boolean {
  if (!(inferred3d || existingState?.frameDimension === '3d')) return false;
  return (
    text.includes('水平方向荷载')
    || text.includes('水平荷载都是')
    || text.includes('水平荷载均为')
    || text.includes('横向荷载两个方向')
    || text.includes('侧向荷载两个方向')
    || text.includes('两个方向都是')
    || text.includes('horizontal loads')
    || text.includes('水平总荷载')
    || /x(?:、|\/|和|及)\s*y(?:方)?向.{0,5}各/.test(text)
  );
}

function repeatScalar(count: number | undefined, value: number | undefined): number[] | undefined {
  if (!count || !value) return undefined;
  return Array.from({ length: count }, () => value);
}

function extractDirectionalSegment(text: string, axis: 'x' | 'y'): string {
  const pattern = axis === 'x'
    ? /x(?:方向|向)([\s\S]*?)(?=y(?:方向|向)|$)/i
    : /y(?:方向|向)([\s\S]*?)$/i;
  return text.match(pattern)?.[1] || '';
}

/**
 * Extract unequal span array from a directional segment.
 * Handles patterns such as "跨度分别6m、9m、6m", "跨度5m、7m", "分别6m和9m".
 * Returns the values only when 2+ distinct values are found to avoid confusing
 * a scalar mention with a list.
 */
function extractSpanArray(segment: string): number[] | undefined {
  if (!segment) return undefined;

  const tryExtract = (re: RegExp): number[] | undefined => {
    const match = segment.match(re);
    if (!match?.[1]) return undefined;
    const values = [...match[1].matchAll(/([\d.]+)(?=\s*(?:m|米))/gi)]
      .map((m) => parseFloat(m[1]))
      .filter((v) => Number.isFinite(v) && v > 0 && v < 500);
    return values.length >= 2 ? values : undefined;
  };

  // Anchor to span-context keyword, then collect consecutive Xm tokens
  const spanContextRe = /(?:跨度|各跨|bay\s*width)\s*(?:分别|各为|为|是)?\s*((?:[\d.]+\s*(?:m|米)\s*[、，,和\s]?\s*)+)/i;
  // Fallback: "分别" prefix alone (e.g. "分别6m、9m")
  const dividedRe = /(?:^|[，,、\s])分别\s*((?:[\d.]+\s*(?:m|米)\s*[、，,和\s]?\s*)+)/i;

  return tryExtract(spanContextRe) ?? tryExtract(dividedRe);
}

// ─── Load helpers ────────────────────────────────────────────────────────────

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

function mergeFloorLoads(
  existing: DraftFloorLoad[] | undefined,
  incoming: DraftFloorLoad[] | undefined,
): DraftFloorLoad[] | undefined {
  if (!existing?.length) return incoming;
  if (!incoming?.length) return existing;
  const merged = new Map<number, DraftFloorLoad>();
  for (const load of existing) merged.set(load.story, { ...load });
  for (const load of incoming) {
    const current = merged.get(load.story);
    merged.set(load.story, {
      story: load.story,
      verticalKN: load.verticalKN ?? current?.verticalKN,
      lateralXKN: load.lateralXKN ?? current?.lateralXKN,
      lateralYKN: load.lateralYKN ?? current?.lateralYKN,
    });
  }
  return Array.from(merged.values()).sort((left, right) => left.story - right.story);
}

// ─── Material and section extraction ────────────────────────────────────────

function extractSteelGrade(text: string): string | undefined {
  // With explicit material keyword (highest priority)
  const withKeyword = text.match(
    /(?:材料|钢材|钢种|牌号|采用|选用)[\s:：]*([Qq][0-9]{3,4}|[Ss][0-9]{3}|[Aa]36)/i,
  );
  if (withKeyword?.[1]) return normalizeSteelGrade(withKeyword[1]);

  // Standalone grade identifier, anchored to avoid false positives
  const gradeMatch = text.match(/(?:^|[^a-zA-Z0-9])([Qq](?:235|345|355|390|420))(?![0-9])/);
  if (gradeMatch?.[1]) return normalizeSteelGrade(gradeMatch[1]);

  // International grades
  const intlMatch = text.match(/(?:steel\s*grade|grade|material)\s*([Ss](?:235|275|355)|[Aa]36)\b/i);
  if (intlMatch?.[1]) return normalizeSteelGrade(intlMatch[1]);

  return undefined;
}

function extractSectionDesignation(text: string, role: 'column' | 'beam'): string | undefined {
  const roleZh = role === 'column' ? '柱' : '梁';
  const roleEn = role === 'column' ? 'column' : 'beam';
  const secPat = '[Hh][WwNn][0-9]+(?:[xX×][0-9]+){1,3}';

  const withRoleBefore = new RegExp(`${roleZh}(?:截面|断面|型号|规格)?[\\s:：]*(${secPat})`, 'i');
  const withRoleAfter = new RegExp(`(${secPat})\\s*${roleZh}`, 'i');
  const withEnBefore = new RegExp(`${roleEn}\\s*section\\s*(${secPat})`, 'i');

  const m1 = text.match(withRoleBefore);
  if (m1?.[1]) return normalizeSectionName(m1[1]);
  const m2 = text.match(withRoleAfter);
  if (m2?.[1]) return normalizeSectionName(m2[1]);
  const m3 = text.match(withEnBefore);
  if (m3?.[1]) return normalizeSectionName(m3[1]);
  return undefined;
}

// ─── Natural language extraction ─────────────────────────────────────────────

function normalizeFrameNaturalPatch(message: string, existingState: DraftState | undefined): DraftExtraction {
  const text = message.toLowerCase();

  const storyCount = extractPositiveInt(text, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*层/i,
    /([0-9]+|[一二两三四五六七八九十]+)\s*stories?/i,
  ]);
  const genericBayCount = extractPositiveInt(text, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*跨/i,
    /([0-9]+|[一二两三四五六七八九十]+)\s*bays?/i,
  ]);

  const xSegment = extractDirectionalSegment(text, 'x');
  const ySegment = extractDirectionalSegment(text, 'y');

  const bayCountX = extractPositiveInt(xSegment, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*跨/i,
    /([0-9]+|[一二两三四五六七八九十]+)\s*bays?/i,
  ]);
  const bayCountY = extractPositiveInt(ySegment, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*跨/i,
    /([0-9]+|[一二两三四五六七八九十]+)\s*bays?/i,
  ]);

  const storyHeightScalar = extractScalar(text, [
    /每层(?:层高)?(?:都?是|统一为|为|高)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
    /层高(?:都?是|统一为|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
  ]);

  // Span extraction: array-first (unequal spans), scalar fallback
  const xSpanArray = extractSpanArray(xSegment);
  const ySpanArray = extractSpanArray(ySegment);
  const xBayScalar = xSpanArray
    ? undefined
    : extractScalar(xSegment, [
      /(?:间隔|跨度|每跨)(?:也?是|都?是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
    ]);
  const yBayScalar = ySpanArray
    ? undefined
    : extractScalar(ySegment, [
      /(?:间隔|跨度|每跨)(?:也?是|都?是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
    ]);
  const genericBayScalar = extractScalar(text, [
    /每跨(?:都?是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
    /跨度(?:都?是|也是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
    /间隔(?:都?是|也是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
  ]);

  // Vertical load — with or without 荷载 keyword; 竖直=竖向=垂直
  const verticalLoadKN = extractScalar(text, [
    /(?:每层|各层)(?:节点)?(?:竖向|垂直|竖直|总)?(?:方向)?荷载(?:都?是|均为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /(?:每层|各层)(?:竖向|垂直|竖直)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /(?:竖向|垂直|竖直)荷载[^0-9]{0,10}(?:每层|各层)[^0-9]{0,5}([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /(?:竖向|垂直|竖直)(?:方向)?(?:都?是|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
  ]);

  const dualLateralLoadKN = extractScalar(text, [
    /x(?:、|\/|和|及)\s*y(?:方)?向(?:水平|横向|侧向)?(?:总)?荷载(?:都?是|均为|各为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /水平(?:总)?荷载[^0-9]{0,24}?x(?:方)?向(?:和|\/|、|及)\s*y(?:方)?向(?:都?是|均为|各为|各|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /水平(?:总)?荷载x(?:、|\/|和|及)\s*y(?:方)?向(?:水平|横向|侧向)?(?:都?是|均为|各为|各|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /x(?:方)?向(?:和|\/|、|及)\s*y(?:方)?向(?:都?是|均为|各为|分别为|分别取|为|是)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
  ]);
  const extractedLateralXLoadKN = dualLateralLoadKN ?? extractScalar(text, [
    /(?:横向|侧向|水平)(?:总)?(?:方向)?荷载(?:两个方向)?(?:都?是|均为|都为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /水平(?:总)?方向荷载(?:都?是|均为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /(?:横向|侧向|水平)(?:总)?荷载(?:都?是|均为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
  ]) ?? extractDirectionalLoadScalar(text, 'x');
  const extractedLateralYLoadKN = dualLateralLoadKN ?? extractDirectionalLoadScalar(text, 'y');

  const resolvedStoryCount = storyCount ?? existingState?.storyCount ?? existingState?.storyHeightsM?.length;
  const resolvedBayCountX = bayCountX ?? existingState?.bayCountX;
  const resolvedBayCountY = bayCountY ?? existingState?.bayCountY;

  const inferred3d = text.includes('y方向')
    || text.includes('y向')
    || bayCountY !== undefined
    || yBayScalar !== undefined
    || ySpanArray !== undefined
    || extractedLateralYLoadKN !== undefined;
  const resolvedFrameDimension = inferred3d
    ? '3d'
    : (existingState?.frameDimension ?? (bayCountX !== undefined ? '3d' : undefined));
  const mirrorHorizontalLoad = shouldMirrorHorizontalLoadToBothAxes(text, existingState, inferred3d);
  const lateralXLoadKN = extractedLateralXLoadKN;
  const lateralYLoadKN = extractedLateralYLoadKN ?? (mirrorHorizontalLoad ? extractedLateralXLoadKN : undefined);

  // Material and section (use original message for case-sensitive grade patterns)
  const frameMaterial = extractSteelGrade(message) ?? extractSteelGrade(text);
  const frameColumnSection = extractSectionDesignation(message, 'column');
  const frameBeamSection = extractSectionDesignation(message, 'beam');

  return {
    inferredType: 'frame',
    frameDimension: resolvedFrameDimension,
    storyCount,
    bayCount: resolvedFrameDimension !== '3d' ? genericBayCount : undefined,
    bayCountX: xSpanArray ? xSpanArray.length : bayCountX,
    bayCountY: ySpanArray ? ySpanArray.length : bayCountY,
    storyHeightsM: repeatScalar(resolvedStoryCount, storyHeightScalar),
    bayWidthsM: resolvedFrameDimension !== '3d'
      ? repeatScalar(genericBayCount ?? existingState?.bayCount, genericBayScalar)
      : undefined,
    bayWidthsXM: xSpanArray
      ?? repeatScalar(resolvedBayCountX, xBayScalar ?? (resolvedFrameDimension === '3d' ? genericBayScalar : undefined)),
    bayWidthsYM: ySpanArray ?? repeatScalar(resolvedBayCountY, yBayScalar),
    floorLoads: buildUniformFloorLoads(
      resolvedStoryCount,
      verticalLoadKN,
      lateralXLoadKN,
      resolvedFrameDimension === '3d' ? lateralYLoadKN : undefined,
    ),
    ...(frameMaterial !== undefined && { frameMaterial }),
    ...(frameColumnSection !== undefined && { frameColumnSection }),
    ...(frameBeamSection !== undefined && { frameBeamSection }),
  };
}

function extractLlmScalar(raw: Record<string, unknown> | null | undefined, keys: string[]): number | undefined {
  if (!raw) return undefined;
  for (const key of keys) {
    const value = normalizeNumber(raw[key]);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function buildFramePatchFromLlm(
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

  // Material/section from LLM patch — bypass toFramePatch domain filter
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

function hasLateralYFloorLoad(floorLoads: DraftFloorLoad[] | undefined): boolean {
  return Boolean(floorLoads?.some((load) => load.lateralYKN !== undefined));
}

function coerceFrameDimension(
  patch: DraftExtraction,
  existingState: DraftState | undefined,
  message: string,
): DraftExtraction {
  const text = message.toLowerCase();
  const mentions3dDirections = (
    text.includes('x、y向')
    || text.includes('x/y向')
    || (text.includes('x 向') && text.includes('y 向'))
    || (text.includes('x向') && text.includes('y向'))
    || text.includes('3d')
    || text.includes('三维')
  );
  const nextPatch: DraftExtraction = { ...patch };
  // Explicit 3D/三维 in user message overrides any LLM default (which may be '2d')
  if (mentions3dDirections) {
    nextPatch.frameDimension = '3d';
    return nextPatch;
  }
  if (nextPatch.frameDimension !== undefined) return nextPatch;
  if (hasLateralYFloorLoad(nextPatch.floorLoads)) {
    nextPatch.frameDimension = '3d';
    return nextPatch;
  }
  if (existingState?.frameDimension) {
    nextPatch.frameDimension = existingState.frameDimension;
  }
  return nextPatch;
}

function buildFrameDraftPatch(
  message: string,
  llmDraftPatch: Record<string, unknown> | null | undefined,
  existingState: DraftState | undefined,
): DraftExtraction {
  const normalizedLlmPatch = buildFramePatchFromLlm(llmDraftPatch, existingState);
  const rawNaturalPatch = normalizeFrameNaturalPatch(message, existingState);
  const normalizedNaturalPatch = toFramePatch(rawNaturalPatch);
  const normalizedRulePatch = toFramePatch(buildLegacyDraftPatchLlmFirst(message, null));
  const mergedRulePatch = mergeFloorLoads(
    normalizedRulePatch.floorLoads,
    normalizedNaturalPatch.floorLoads,
  )
    ? {
        ...mergeLegacyDraftPatchLlmFirst(normalizedNaturalPatch, normalizedRulePatch),
        floorLoads: mergeFloorLoads(normalizedRulePatch.floorLoads, normalizedNaturalPatch.floorLoads),
      }
    : mergeLegacyDraftPatchLlmFirst(normalizedNaturalPatch, normalizedRulePatch);
  const nextPatch = mergeLegacyDraftPatchLlmFirst(normalizedLlmPatch, mergedRulePatch);

  // Material/section: LLM takes priority over natural language extraction.
  // These fields bypass toFramePatch and are merged manually here.
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

// ─── Dimension inference ─────────────────────────────────────────────────────

function inferFrameDimensionProposal(state: DraftState): '2d' | '3d' {
  if (state.frameDimension === '3d') return '3d';
  if ((state.bayCountY ?? 0) > 0) return '3d';
  if ((state.bayWidthsYM?.length ?? 0) > 0) return '3d';
  if (hasLateralYFloorLoad(state.floorLoads)) return '3d';
  return '2d';
}

// ─── Local frame model builders ──────────────────────────────────────────────

function accumulateCoords(lengths: number[]): number[] {
  const coords = [0];
  for (const v of lengths) coords.push(coords[coords.length - 1] + v);
  return coords;
}

function buildBaseRestraint(baseSupport: string): boolean[] {
  return baseSupport === 'pinned'
    ? [true, true, true, false, false, false]
    : [true, true, true, true, true, true];
}

function n2dId(storyIdx: number, bayNodeIdx: number): string {
  return `N${storyIdx}_${bayNodeIdx}`;
}

function n3dId(storyIdx: number, xIdx: number, yIdx: number): string {
  return `N${storyIdx}_${xIdx}_${yIdx}`;
}

function buildFrame2dLocalModel(
  state: DraftState,
  matProps: SteelGradeProps & { resolvedGrade: string },
  colProps: SectionProps,
  beamProps: SectionProps,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const bayWidths = state.bayWidthsM!;
  const storyHeights = state.storyHeightsM!;
  const floorLoads = state.floorLoads!;
  const baseSupport = (state.frameBaseSupportType as string | undefined) ?? 'fixed';
  const xCoords = accumulateCoords(bayWidths);
  const yCoords = accumulateCoords(storyHeights);
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const loads: Array<Record<string, unknown>> = [];
  let elementId = 1;

  for (let si = 0; si < yCoords.length; si++) {
    for (let bi = 0; bi < xCoords.length; bi++) {
      const node: Record<string, unknown> = { id: n2dId(si, bi), x: xCoords[bi], y: yCoords[si], z: 0 };
      if (si === 0) node.restraints = buildBaseRestraint(baseSupport);
      nodes.push(node);
    }
  }
  for (let si = 1; si < yCoords.length; si++) {
    for (let bi = 0; bi < xCoords.length; bi++) {
      elements.push({ id: `C${elementId}`, type: 'beam', nodes: [n2dId(si - 1, bi), n2dId(si, bi)], material: '1', section: '1' });
      elementId += 1;
    }
  }
  for (let si = 1; si < yCoords.length; si++) {
    for (let bi = 0; bi < bayWidths.length; bi++) {
      elements.push({ id: `B${elementId}`, type: 'beam', nodes: [n2dId(si, bi), n2dId(si, bi + 1)], material: '1', section: '2' });
      elementId += 1;
    }
  }
  const levelNodeCount = xCoords.length;
  for (const load of floorLoads) {
    const si = load.story;
    if (si <= 0 || si >= yCoords.length) continue;
    const vPerNode = load.verticalKN !== undefined ? -load.verticalKN / levelNodeCount : undefined;
    const lPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    for (let bi = 0; bi < xCoords.length; bi++) {
      const nodeLoad: Record<string, unknown> = { node: n2dId(si, bi) };
      if (vPerNode !== undefined) nodeLoad.fy = vPerNode;
      if (lPerNode !== undefined) nodeLoad.fx = lPerNode;
      if (Object.keys(nodeLoad).length > 1) loads.push(nodeLoad);
    }
  }

  return {
    schema_version: '1.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [{ id: '1', name: matProps.resolvedGrade, E: matProps.E, nu: matProps.nu, rho: matProps.rho, fy: matProps.fy }],
    sections: [
      { id: '1', name: colProps.name, type: 'beam', properties: { A: colProps.A, Iy: colProps.Iy, Iz: colProps.Iz, J: colProps.J, G: colProps.G } },
      { id: '2', name: beamProps.name, type: 'beam', properties: { A: beamProps.A, Iy: beamProps.Iy, Iz: beamProps.Iz, J: beamProps.J, G: beamProps.G } },
    ],
    load_cases: [{ id: 'LC1', type: 'other', loads }],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      baseSupport,
      material: matProps.resolvedGrade,
      columnSection: colProps.name,
      beamSection: beamProps.name,
      storyCount: storyHeights.length,
      bayCount: bayWidths.length,
      geometry: { storyHeightsM: storyHeights, bayWidthsM: bayWidths },
    },
  };
}

function buildFrame3dLocalModel(
  state: DraftState,
  matProps: SteelGradeProps & { resolvedGrade: string },
  colProps: SectionProps,
  beamProps: SectionProps,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const bayWidthsX = state.bayWidthsXM!;
  const bayWidthsY = state.bayWidthsYM!;
  const storyHeights = state.storyHeightsM!;
  const floorLoads = state.floorLoads!;
  const baseSupport = (state.frameBaseSupportType as string | undefined) ?? 'fixed';
  const xCoords = accumulateCoords(bayWidthsX);
  const zCoords = accumulateCoords(bayWidthsY);
  const yCoords = accumulateCoords(storyHeights);
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const loads: Array<Record<string, unknown>> = [];
  let elementId = 1;

  for (let si = 0; si < yCoords.length; si++) {
    for (let xi = 0; xi < xCoords.length; xi++) {
      for (let yi = 0; yi < zCoords.length; yi++) {
        const node: Record<string, unknown> = { id: n3dId(si, xi, yi), x: xCoords[xi], y: yCoords[si], z: zCoords[yi] };
        if (si === 0) node.restraints = buildBaseRestraint(baseSupport);
        nodes.push(node);
      }
    }
  }
  for (let si = 1; si < yCoords.length; si++) {
    for (let xi = 0; xi < xCoords.length; xi++) {
      for (let yi = 0; yi < zCoords.length; yi++) {
        elements.push({ id: `C${elementId}`, type: 'beam', nodes: [n3dId(si - 1, xi, yi), n3dId(si, xi, yi)], material: '1', section: '1' });
        elementId += 1;
      }
    }
  }
  for (let si = 1; si < yCoords.length; si++) {
    for (let xi = 0; xi < bayWidthsX.length; xi++) {
      for (let yi = 0; yi < zCoords.length; yi++) {
        elements.push({ id: `BX${elementId}`, type: 'beam', nodes: [n3dId(si, xi, yi), n3dId(si, xi + 1, yi)], material: '1', section: '2' });
        elementId += 1;
      }
    }
  }
  for (let si = 1; si < yCoords.length; si++) {
    for (let xi = 0; xi < xCoords.length; xi++) {
      for (let yi = 0; yi < bayWidthsY.length; yi++) {
        elements.push({ id: `BY${elementId}`, type: 'beam', nodes: [n3dId(si, xi, yi), n3dId(si, xi, yi + 1)], material: '1', section: '2' });
        elementId += 1;
      }
    }
  }
  const levelNodeCount = xCoords.length * zCoords.length;
  for (const load of floorLoads) {
    const si = load.story;
    if (si <= 0 || si >= yCoords.length) continue;
    const vPerNode = load.verticalKN !== undefined ? -load.verticalKN / levelNodeCount : undefined;
    const lxPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    const lyPerNode = load.lateralYKN !== undefined ? load.lateralYKN / levelNodeCount : undefined;
    for (let xi = 0; xi < xCoords.length; xi++) {
      for (let yi = 0; yi < zCoords.length; yi++) {
        const nodeLoad: Record<string, unknown> = { node: n3dId(si, xi, yi) };
        if (vPerNode !== undefined) nodeLoad.fy = vPerNode;
        if (lxPerNode !== undefined) nodeLoad.fx = lxPerNode;
        if (lyPerNode !== undefined) nodeLoad.fz = lyPerNode;
        if (Object.keys(nodeLoad).length > 1) loads.push(nodeLoad);
      }
    }
  }

  return {
    schema_version: '1.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [{ id: '1', name: matProps.resolvedGrade, E: matProps.E, nu: matProps.nu, rho: matProps.rho, fy: matProps.fy }],
    sections: [
      { id: '1', name: colProps.name, type: 'beam', properties: { A: colProps.A, Iy: colProps.Iy, Iz: colProps.Iz, J: colProps.J, G: colProps.G } },
      { id: '2', name: beamProps.name, type: 'beam', properties: { A: beamProps.A, Iy: beamProps.Iy, Iz: beamProps.Iz, J: beamProps.J, G: beamProps.G } },
    ],
    load_cases: [{ id: 'LC1', type: 'other', loads }],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      baseSupport,
      material: matProps.resolvedGrade,
      columnSection: colProps.name,
      beamSection: beamProps.name,
      storyCount: storyHeights.length,
      bayCountX: bayWidthsX.length,
      bayCountY: bayWidthsY.length,
      geometry: { storyHeightsM: storyHeights, bayWidthsXM: bayWidthsX, bayWidthsYM: bayWidthsY },
    },
  };
}

function buildFrameLocalModel(state: DraftState): Record<string, unknown> {
  const matGrade = state.frameMaterial as string | undefined;
  const colSection = state.frameColumnSection as string | undefined;
  const beamSection = state.frameBeamSection as string | undefined;
  const storyCount = state.storyHeightsM?.length ?? (state.storyCount as number | undefined) ?? 0;
  const matProps = resolveSteelGradeProps(matGrade);
  const colProps = resolveSectionProps(colSection, 'column', storyCount, matProps.G);
  const beamProps = resolveSectionProps(beamSection, 'beam', storyCount, matProps.G);
  const metadata: Record<string, unknown> = { source: 'markdown-skill-draft', inferredType: 'frame' };
  if (state.frameDimension === '3d') {
    return buildFrame3dLocalModel(state, matProps, colProps, beamProps, metadata);
  }
  return buildFrame2dLocalModel(state, matProps, colProps, beamProps, metadata);
}

// ─── Default proposals and questions ────────────────────────────────────────

function buildFrameDefaultReason(paramKey: string, locale: AppLocale, state: DraftState): string {
  const storyCount = (state.storyHeightsM?.length ?? (state.storyCount as number | undefined)) ?? 0;
  switch (paramKey) {
    case 'frameDimension': {
      const dimension = inferFrameDimensionProposal(state);
      if (dimension === '3d') {
        return locale === 'zh'
          ? '已识别到 Y 向信息或双向侧向荷载，默认按 3D 规则轴网框架继续补参。'
          : 'Y-direction information or bi-directional lateral loading is detected, so default to a 3D regular-grid frame.';
      }
      return locale === 'zh'
        ? '未发现明确 Y 向输入，默认按 2D 平面框架先完成首轮分析。'
        : 'No explicit Y-direction inputs were found, so default to a 2D planar frame for the first analysis round.';
    }
    case 'frameBaseSupportType':
      return locale === 'zh'
        ? '框架柱脚默认采用固定支座，便于获得更稳健的初始刚度评估。'
        : 'Default frame base support to fixed to obtain a stable initial stiffness assessment.';
    case 'frameMaterial':
      return locale === 'zh'
        ? '钢框架默认采用 Q355 钢材，符合 GB 50017 常规设计要求。'
        : 'Default steel grade Q355, compliant with GB 50017 standard design practice.';
    case 'frameColumnSection':
      return locale === 'zh'
        ? `根据 ${storyCount} 层框架规模，建议柱截面采用 ${getDefaultColumnSection(storyCount)}（GB/T 11263 热轧 H 型钢）。`
        : `For a ${storyCount}-story frame, the recommended column section is ${getDefaultColumnSection(storyCount)} (GB/T 11263 hot-rolled H-section).`;
    case 'frameBeamSection':
      return locale === 'zh'
        ? `根据 ${storyCount} 层框架规模，建议梁截面采用 ${getDefaultBeamSection(storyCount)}（GB/T 11263 热轧 H 型钢）。`
        : `For a ${storyCount}-story frame, the recommended beam section is ${getDefaultBeamSection(storyCount)} (GB/T 11263 hot-rolled H-section).`;
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

function buildFrameDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
  const storyCount = (state.storyHeightsM?.length ?? (state.storyCount as number | undefined)) ?? 0;
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'frame' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) continue;
    next.set(question.paramKey, {
      paramKey: question.paramKey,
      value: question.suggestedValue,
      reason: buildFrameDefaultReason(question.paramKey, locale, state),
    });
  }

  if (keys.includes('frameDimension')) {
    next.set('frameDimension', {
      paramKey: 'frameDimension',
      value: inferFrameDimensionProposal(state),
      reason: buildFrameDefaultReason('frameDimension', locale, state),
    });
  }
  if (keys.includes('frameBaseSupportType')) {
    next.set('frameBaseSupportType', {
      paramKey: 'frameBaseSupportType',
      value: 'fixed',
      reason: buildFrameDefaultReason('frameBaseSupportType', locale, state),
    });
  }
  if (keys.includes('frameMaterial')) {
    next.set('frameMaterial', {
      paramKey: 'frameMaterial',
      value: 'Q355',
      reason: buildFrameDefaultReason('frameMaterial', locale, state),
    });
  }
  if (keys.includes('frameColumnSection')) {
    next.set('frameColumnSection', {
      paramKey: 'frameColumnSection',
      value: getDefaultColumnSection(storyCount),
      reason: buildFrameDefaultReason('frameColumnSection', locale, state),
    });
  }
  if (keys.includes('frameBeamSection')) {
    next.set('frameBeamSection', {
      paramKey: 'frameBeamSection',
      value: getDefaultBeamSection(storyCount),
      reason: buildFrameDefaultReason('frameBeamSection', locale, state),
    });
  }

  return Array.from(next.values());
}

function buildFrameQuestions(
  keys: string[],
  criticalMissing: string[],
  state: DraftState,
  locale: AppLocale,
): InteractionQuestion[] {
  const inferredDimension = inferFrameDimensionProposal(state);
  const storyCount = (state.storyHeightsM?.length ?? (state.storyCount as number | undefined)) ?? 0;

  return buildInteractionQuestions(keys, criticalMissing, { ...state, inferredType: 'frame' }, locale).map((question) => {
    if (question.paramKey === 'frameDimension') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认框架维度（2d / 3d）。若有 Y 向跨数、Y 向跨度或双向水平荷载，建议选择 3d。'
          : 'Please confirm frame dimension (2d / 3d). If Y-direction bays/widths or bi-directional lateral loads exist, 3d is recommended.',
        suggestedValue: inferredDimension,
      };
    }
    if (question.paramKey === 'frameBaseSupportType') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认柱脚边界（fixed / pinned）。常规首轮分析建议先按 fixed。'
          : 'Please confirm base support condition (fixed / pinned). For initial frame analysis, fixed is usually recommended.',
        suggestedValue: 'fixed',
      };
    }
    if (question.paramKey === 'floorLoads') {
      const loadHint = inferredDimension === '3d'
        ? (locale === 'zh' ? '请至少给出各层竖向荷载，并补充 X/Y 向水平荷载。' : 'At minimum provide vertical load per story, plus lateral loads in both X and Y.')
        : (locale === 'zh' ? '请至少给出各层竖向荷载，可按需补充一个方向的水平荷载。' : 'At minimum provide vertical load per story, and optionally one-direction lateral load.');
      return {
        ...question,
        question: locale === 'zh'
          ? `请确认各层总荷载（单位 kN）。该值为整层总荷载，程序会按该层节点数均匀分配到各节点。${loadHint}`
          : `Please confirm per-story total load (kN). This is the total load on each story, and it will be distributed equally to all nodes on that floor. ${loadHint}`,
      };
    }
    if (question.paramKey === 'frameMaterial') {
      return {
        paramKey: 'frameMaterial',
        label: locale === 'zh' ? '钢材牌号' : 'Steel grade',
        question: locale === 'zh'
          ? '请确认钢材牌号（如 Q355、Q345、Q235、S355）。钢框架通常采用 Q355。'
          : 'Please confirm the steel grade (e.g. Q355, Q345, Q235, S355). Q355 is common for steel frames.',
        required: true,
        critical: criticalMissing.includes('frameMaterial'),
        suggestedValue: 'Q355',
      };
    }
    if (question.paramKey === 'frameColumnSection') {
      const suggested = storyCount > 0 ? getDefaultColumnSection(storyCount) : undefined;
      return {
        paramKey: 'frameColumnSection',
        label: locale === 'zh' ? '柱截面' : 'Column section',
        question: locale === 'zh'
          ? `请确认柱截面规格（如 HW350X350）。${suggested ? `当前层数建议 ${suggested}。` : ''}`
          : `Please confirm the column section designation (e.g. HW350X350).${suggested ? ` Suggested: ${suggested}.` : ''}`,
        required: true,
        critical: criticalMissing.includes('frameColumnSection'),
        suggestedValue: suggested,
      };
    }
    if (question.paramKey === 'frameBeamSection') {
      const suggested = storyCount > 0 ? getDefaultBeamSection(storyCount) : undefined;
      return {
        paramKey: 'frameBeamSection',
        label: locale === 'zh' ? '梁截面' : 'Beam section',
        question: locale === 'zh'
          ? `请确认梁截面规格（如 HN400X200）。${suggested ? `当前层数建议 ${suggested}。` : ''}`
          : `Please confirm the beam section designation (e.g. HN400X200).${suggested ? ` Suggested: ${suggested}.` : ''}`,
        required: true,
        critical: criticalMissing.includes('frameBeamSection'),
        suggestedValue: suggested,
      };
    }
    return question;
  });
}

// ─── Report narrative ────────────────────────────────────────────────────────

function buildFrameReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const frameSpecificNotes = [
    '',
    input.locale === 'zh' ? '## 框架专项说明' : '## Frame-Specific Notes',
    input.locale === 'zh'
      ? '- 本报告按规则轴网框架草稿生成，建议结合实际结构布置复核边界条件与荷载路径。'
      : '- This report is generated from a regular-grid frame draft; verify boundary conditions and load paths against the actual structural layout.',
    input.locale === 'zh'
      ? '- 对于退台、缺跨或明显不规则框架，建议补充更细化模型后重新分析与校核。'
      : '- For setbacks, missing bays, or strongly irregular frames, refine the model and rerun analysis/code checks.',
  ];
  return [base, ...frameSpecificNotes].join('\n');
}

// ─── Skill handler export ────────────────────────────────────────────────────

export const handler: SkillHandler = {
  detectStructuralType({ message, locale, currentState }) {
    const text = message.toLowerCase();
    if (
      (text.includes('frame') || text.includes('框架') || text.includes('钢框架'))
      && (text.includes('irregular') || text.includes('不规则') || text.includes('退台') || text.includes('缺跨'))
    ) {
      return buildStructuralTypeMatch('frame', 'unknown', 'frame', 'unsupported', locale, {
        zh: '当前 frame skill 只支持规则楼层和规则轴网框架。若结构存在退台、缺跨或明显不规则，请直接提供 JSON 或更具体的节点构件描述。',
        en: 'The current frame skill only supports regular stories and regular grids. If the structure has setbacks, missing bays, or strong irregularities, please provide JSON or a more explicit node/member description.',
      });
    }
    if (text.includes('steel frame') || text.includes('钢框架')) {
      return buildStructuralTypeMatch('steel-frame', 'frame', 'frame', 'supported', locale);
    }
    if (text.includes('frame') || text.includes('框架')) {
      return buildStructuralTypeMatch('frame', 'frame', 'frame', 'supported', locale);
    }
    // Sticky: maintain the active frame structural type for follow-up messages that lack
    // an explicit frame keyword (e.g. "层高3.6m" as a second turn).
    if (currentState?.inferredType === 'frame' && currentState.supportLevel !== 'unsupported') {
      const key = (currentState.structuralTypeKey === 'steel-frame' ? 'steel-frame' : 'frame') as StructuralTypeMatch['key'];
      return buildStructuralTypeMatch(key, 'frame', 'frame', 'supported', locale);
    }
    return null;
  },

  parseProvidedValues(values) {
    const base = coerceFrameDimension(
      toFramePatch(normalizeLegacyDraftPatch(values)),
      undefined,
      JSON.stringify(values),
    );
    return {
      ...base,
      ...(typeof values.frameMaterial === 'string' && { frameMaterial: normalizeSteelGrade(values.frameMaterial) }),
      ...(typeof values.frameColumnSection === 'string' && { frameColumnSection: normalizeSectionName(values.frameColumnSection) }),
      ...(typeof values.frameBeamSection === 'string' && { frameBeamSection: normalizeSectionName(values.frameBeamSection) }),
    };
  },

  extractDraft({ message, llmDraftPatch, currentState }) {
    return buildFrameDraftPatch(message, llmDraftPatch, currentState);
  },

  mergeState(existing, patch) {
    const domainMerged = mergeLegacyState(
      existing,
      coerceFrameDimension(toFramePatch(patch), existing, ''),
      'frame',
      'frame',
    );
    // Material/section bypass toFramePatch — merge manually on top of domain state
    return {
      ...domainMerged,
      frameMaterial: (patch.frameMaterial as string | undefined) ?? (existing?.frameMaterial as string | undefined),
      frameColumnSection: (patch.frameColumnSection as string | undefined) ?? (existing?.frameColumnSection as string | undefined),
      frameBeamSection: (patch.frameBeamSection as string | undefined) ?? (existing?.frameBeamSection as string | undefined),
    };
  },

  computeMissing(state, phase) {
    // Material/section auto-fill from defaults in buildFrameLocalModel, so they are
    // never critical blockers. Only geometry + load keys are checked here.
    return computeLegacyMissing(
      { ...state, inferredType: 'frame' },
      phase,
      [...REQUIRED_KEYS],
    );
  },

  mapLabels(keys, locale) {
    return keys.map((key) => {
      switch (key) {
        case 'frameMaterial': return locale === 'zh' ? '钢材牌号' : 'Steel grade';
        case 'frameColumnSection': return locale === 'zh' ? '柱截面' : 'Column section';
        case 'frameBeamSection': return locale === 'zh' ? '梁截面' : 'Beam section';
        default: return buildLegacyLabels([key], locale)[0];
      }
    });
  },

  buildQuestions(keys, criticalMissing, state, locale) {
    return buildFrameQuestions(keys, criticalMissing, state, locale);
  },

  buildDefaultProposals(keys, state, locale) {
    return buildFrameDefaultProposals(keys, state, locale);
  },

  buildReportNarrative(input) {
    return buildFrameReportNarrative(input);
  },

  buildModel(state) {
    const critical = computeMissingCriticalKeys(state).filter((k) => (REQUIRED_KEYS as readonly string[]).includes(k));
    if (critical.length > 0) return undefined;
    return buildFrameLocalModel(state);
  },

  resolveStage(missingKeys) {
    // Material/section are not blocking — exclude them from stage routing
    return resolveLegacyStructuralStage(missingKeys.filter((k) => !FRAME_MATERIAL_KEYS.includes(k as typeof FRAME_MATERIAL_KEYS[number])));
  },
};

export default handler;
