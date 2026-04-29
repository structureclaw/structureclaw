import { normalizeNumber, normalizePositiveInteger } from '../../../agent-runtime/fallback.js';
import type { DraftExtraction, DraftFloorLoad, DraftState } from '../../../agent-runtime/types.js';
import { normalizeSectionName, normalizeSteelGrade } from './model.js';

const CHINESE_NUMERAL_MAP: Record<string, number> = {
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

const ENGLISH_NUMERAL_MAP: Record<string, number> = {
  one: 1,
  single: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseLocalizedPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const direct = normalizePositiveInteger(trimmed);
  if (direct !== undefined) return direct;

  const structured = trimmed.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/);
  if (structured) {
    const tens = structured[1] ? CHINESE_NUMERAL_MAP[structured[1]] : 1;
    const ones = structured[2] ? CHINESE_NUMERAL_MAP[structured[2]] : 0;
    return tens !== undefined && ones !== undefined
      ? tens * 10 + ones
      : undefined;
  }
  return CHINESE_NUMERAL_MAP[trimmed] ?? ENGLISH_NUMERAL_MAP[trimmed.toLowerCase()];
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

function extractDirectionalLoadScalar(text: string, axis: 'x' | 'y' | 'z'): number | undefined {
  const a = axis;
  return extractScalar(text, [
    // Chinese: x方向荷载, x向水平荷载, x方向总荷载
    new RegExp(`${a}(?:方)?向(?:水平|横向|侧向)?(?:总)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`(?:水平|横向|侧向)?(?:总)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是)?[^\\n]{0,24}?${a}(?:方)?向\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`${a}(?:方)?向\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:kn|千牛)`, 'i'),
    // English: x-direction load, x-direction total load, z-direction load
    new RegExp(`${a}-direction\\s*(?:total\\s*)?load(?:\\s+is|=|\\s+of)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*kn`, 'i'),
    new RegExp(`${a}-direction\\s*([0-9]+(?:\\.[0-9]+)?)\\s*kn`, 'i'),
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

function extractSpanArray(segment: string): number[] | undefined {
  if (!segment) return undefined;

  const tryExtract = (pattern: RegExp): number[] | undefined => {
    const match = segment.match(pattern);
    if (!match?.[1]) return undefined;
    const values = [...match[1].matchAll(/([\d.]+)(?=\s*(?:m|米))/gi)]
      .map((capture) => Number.parseFloat(capture[1]))
      .filter((value) => Number.isFinite(value) && value > 0 && value < 500);
    return values.length >= 2 ? values : undefined;
  };

  const spanContextRe = /(?:跨度|各跨|bay\s*width)\s*(?:分别|各为|为|是)?\s*((?:[\d.]+\s*(?:m|米)\s*[、，,和\s]?\s*)+)/i;
  const dividedRe = /(?:^|[，,、\s])分别\s*((?:[\d.]+\s*(?:m|米)\s*[、，,和\s]?\s*)+)/i;

  return tryExtract(spanContextRe) ?? tryExtract(dividedRe);
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

function extractSteelGrade(text: string): string | undefined {
  const materialPattern = '[Qq](?:235|345|355|390|420)|[Cc](?:20|25|30|35|40|45|50|55|60)|[Ss](?:235|275|355)|[Aa]36';
  const withKeyword = text.match(
    new RegExp(`(?:材料|混凝土|砼|钢材|钢种|牌号|采用|选用)[\\s:：]*(${materialPattern})`, 'i'),
  );
  if (withKeyword?.[1]) return normalizeSteelGrade(withKeyword[1]);

  const gradeMatch = text.match(/(?:^|[^a-zA-Z0-9])([Qq](?:235|345|355|390|420))(?![0-9])/);
  if (gradeMatch?.[1]) return normalizeSteelGrade(gradeMatch[1]);

  const concreteMatch = text.match(/(?:^|[^a-zA-Z0-9])([Cc](?:20|25|30|35|40|45|50|55|60))(?![0-9])/);
  if (concreteMatch?.[1]) return normalizeSteelGrade(concreteMatch[1]);

  const intlMatch = text.match(new RegExp(`(?:(?:steel|concrete)\\s*grade|grade|material)\\s*(${materialPattern})\\b`, 'i'));
  if (intlMatch?.[1]) return normalizeSteelGrade(intlMatch[1]);

  return undefined;
}

function extractSectionDesignation(text: string, role: 'column' | 'beam'): string | undefined {
  const roleZh = role === 'column' ? '柱' : '梁';
  const roleEn = role === 'column' ? 'column' : 'beam';
  const sectionNumber = '\\d+(?:\\.\\d+)?';
  const prefixedHPattern = `[Hh][WwNn]${sectionNumber}[xX×*]${sectionNumber}`;
  const customHPattern = `[Hh]${sectionNumber}(?:[xX×*]${sectionNumber}){3}`;
  const hPattern = `(?:${prefixedHPattern}|${customHPattern})`;
  const rectangularPattern = `(?:[Rr](?:[Ee][Cc][Tt])?)?${sectionNumber}[xX×*]${sectionNumber}|[Bb]${sectionNumber}[Hh]${sectionNumber}`;
  const sectionPattern = `(?:${hPattern}|${rectangularPattern})`;

  const withRoleBefore = new RegExp(`${roleZh}(?:截面|断面|型号|规格)?(?:\\s*(?:为|是|采用|选用))?[\\s:：]*(${sectionPattern})`, 'i');
  const withRoleAfter = new RegExp(`(${sectionPattern})\\s*${roleZh}`, 'i');
  const withEnBefore = new RegExp(`${roleEn}\\s*section\\s*(${sectionPattern})`, 'i');

  const m1 = text.match(withRoleBefore);
  if (m1?.[1]) return normalizeSectionName(m1[1]);
  const m2 = text.match(withRoleAfter);
  if (m2?.[1]) return normalizeSectionName(m2[1]);
  const m3 = text.match(withEnBefore);
  if (m3?.[1]) return normalizeSectionName(m3[1]);
  return undefined;
}

export function normalizeFrameNaturalPatch(message: string, existingState: DraftState | undefined): DraftExtraction {
  const text = message.toLowerCase();

  const storyCount = extractPositiveInt(text, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*层/i,
    /([0-9]+|[一二两三四五六七八九十]+|one|two|three|four|five|six|seven|eight|nine|ten)\s*stories?/i,
  ]);
  const genericBayCount = extractPositiveInt(text, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*跨/i,
    /([0-9]+|[一二两三四五六七八九十]+|one|two|three|four|five|six|seven|eight|nine|ten|single)\s*bays?/i,
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
    /story\s*height(?:s)?(?:\s*(?:is|are|of|:))?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|meter|meters)/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:m|meter|meters)\s*each/i,
  ]);

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
    /single\s*bay\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|meter|meters)/i,
    /bay\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|meter|meters)/i,
  ]);

  const verticalLoadKN =
    extractDirectionalLoadScalar(text, 'z')
    ?? extractScalar(text, [
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

  const explicitDimension = /\b3d\b/i.test(text) || text.includes('三维')
    ? '3d' as const
    : /\b2d\b/i.test(text) || text.includes('二维')
      ? '2d' as const
      : undefined;
  const inferred3d = text.includes('y方向')
    || text.includes('y向')
    || bayCountY !== undefined
    || yBayScalar !== undefined
    || ySpanArray !== undefined
    || extractedLateralYLoadKN !== undefined;
  const resolvedFrameDimension = inferred3d
    ? '3d'
    : explicitDimension
      ?? existingState?.frameDimension
      ?? (bayCountX !== undefined ? '3d' : undefined);
  const resolved2dBayCount = genericBayCount ?? bayCountX ?? existingState?.bayCount;
  const resolved2dBayWidths = resolvedFrameDimension !== '3d'
    ? (
        xSpanArray
        ?? repeatScalar(
          resolved2dBayCount,
          xBayScalar ?? genericBayScalar,
        )
      )
    : undefined;
  const mirrorHorizontalLoad = shouldMirrorHorizontalLoadToBothAxes(text, existingState, inferred3d);
  const lateralXLoadKN = extractedLateralXLoadKN;
  const lateralYLoadKN = extractedLateralYLoadKN ?? (mirrorHorizontalLoad ? extractedLateralXLoadKN : undefined);

  const frameMaterial = extractSteelGrade(message) ?? extractSteelGrade(text);
  const frameColumnSection = extractSectionDesignation(message, 'column');
  const frameBeamSection = extractSectionDesignation(message, 'beam');

  return {
    inferredType: 'frame',
    frameDimension: resolvedFrameDimension,
    storyCount,
    bayCount: resolvedFrameDimension !== '3d'
      ? (resolved2dBayWidths?.length ?? resolved2dBayCount)
      : undefined,
    bayCountX: resolvedFrameDimension === '3d'
      ? (xSpanArray ? xSpanArray.length : bayCountX)
      : undefined,
    bayCountY: ySpanArray ? ySpanArray.length : bayCountY,
    storyHeightsM: repeatScalar(resolvedStoryCount, storyHeightScalar),
    bayWidthsM: resolved2dBayWidths,
    bayWidthsXM: resolvedFrameDimension === '3d'
      ? (
          xSpanArray
          ?? repeatScalar(resolvedBayCountX, xBayScalar ?? genericBayScalar)
        )
      : undefined,
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
