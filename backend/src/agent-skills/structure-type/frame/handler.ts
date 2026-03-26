import {
  buildLegacyDraftPatchLlmFirst,
  buildLegacyLabels,
  buildLegacyModel,
  computeLegacyMissing,
  mergeLegacyDraftPatchLlmFirst,
  mergeLegacyState,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../../agent-runtime/legacy.js';
import { combineDomainKeys, composeStructuralDomainPatch } from '../../../agent-runtime/domains/structural-domains.js';
import { buildScenarioMatch, resolveLegacyStructuralStage } from '../../../agent-runtime/plugin-helpers.js';
import { buildInteractionQuestions, lookupSteelSection, normalizeNumber, normalizePositiveInteger, suggestBeamSection, suggestColumnSection } from '../../../agent-runtime/fallback.js';
import { buildDefaultReportNarrative } from '../../../agent-runtime/report-template.js';
import type { AppLocale } from '../../../services/locale.js';
import type {
  DraftExtraction,
  DraftFloorLoad,
  DraftState,
  InteractionQuestion,
  SkillDefaultProposal,
  SkillHandler,
  SkillReportNarrativeInput,
} from '../../../agent-runtime/types.js';

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
const MATERIAL_SECTION_KEYS = ['steelGrade', 'columnSection', 'beamSection'] as const;
const ALLOWED_KEYS = [...combineDomainKeys(GEOMETRY_KEYS, LOAD_BOUNDARY_KEYS), ...MATERIAL_SECTION_KEYS];

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
  'steelGrade',
  'columnSection',
  'beamSection',
] as const;

function toFramePatch(patch: DraftExtraction): DraftExtraction {
  const domainPatch = composeStructuralDomainPatch({
    patch,
    geometryKeys: GEOMETRY_KEYS,
    loadBoundaryKeys: LOAD_BOUNDARY_KEYS,
  });
  for (const key of MATERIAL_SECTION_KEYS) {
    if (patch[key] !== undefined) {
      domainPatch[key] = patch[key];
    }
  }
  return restrictLegacyDraftPatch(domainPatch, 'frame', [...ALLOWED_KEYS]);
}

const CHINESE_NUMERAL_MAP: Record<string, number> = {
  '一': 1,
  '二': 2,
  '两': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9,
  '十': 10,
};

function parseLocalizedPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  const direct = normalizePositiveInteger(trimmed);
  if (direct !== undefined) {
    return direct;
  }
  if (trimmed === '十') {
    return 10;
  }
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
    if (!match?.[1]) {
      continue;
    }
    const value = parseLocalizedPositiveInt(match[1]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function extractScalar(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const value = normalizeNumber(match[1]);
    if (value !== undefined && value > 0) {
      return value;
    }
  }
  return undefined;
}

function extractNumberArray(text: string, patterns: RegExp[]): number[] | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const items = match[1].split(/[、,，]\s*/);
    const values: number[] = [];
    for (const item of items) {
      const cleaned = item.trim().replace(/\s*(?:m|米)\s*$/i, '').trim();
      const v = normalizeNumber(cleaned);
      if (v === undefined || v <= 0) {
        values.length = 0;
        break;
      }
      values.push(v);
    }
    if (values.length >= 2) {
      return values;
    }
  }
  return undefined;
}

function extractSteelGrade(text: string): string | undefined {
  const match = text.match(/q\s*(235|345|390|420|460)/i);
  return match ? `Q${match[1]}` : undefined;
}

function extractColumnSection(text: string): string | undefined {
  const explicit = text.match(/(?:柱|col(?:umn)?)[^，,。\n]{0,12}?(h[wm]\d+x\d+)/i);
  if (explicit) {
    return explicit[1].toUpperCase();
  }
  const hw = text.match(/\b(hw\d+x\d+)\b/i);
  if (hw) {
    return hw[1].toUpperCase();
  }
  return undefined;
}

function extractBeamSection(text: string): string | undefined {
  const explicit = text.match(/(?:梁|beam)[^，,。\n]{0,12}?(h[wmn]\d+x\d+)/i);
  if (explicit) {
    return explicit[1].toUpperCase();
  }
  const hn = text.match(/\b(hn\d+x\d+)\b/i);
  if (hn) {
    return hn[1].toUpperCase();
  }
  const hm = text.match(/\b(hm\d+x\d+)\b/i);
  if (hm) {
    return hm[1].toUpperCase();
  }
  return undefined;
}

function isSupportedSection(name: string | undefined): boolean {
  return name !== undefined && lookupSteelSection(name) !== undefined;
}

function extractDirectionalLoadScalar(text: string, axis: 'x' | 'y'): number | undefined {
  const axisToken = axis === 'x' ? 'x' : 'y';
  return extractScalar(text, [
    new RegExp(`${axisToken}向(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|分别为|分别取|取|按|为|是)?[^\\n]{0,24}?${axisToken}向\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:kn|千牛)`, 'i'),
    new RegExp(`${axisToken}向\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:kn|千牛)`, 'i'),
  ]);
}

function shouldMirrorHorizontalLoadToBothAxes(
  text: string,
  existingState: DraftState | undefined,
  inferred3d: boolean,
): boolean {
  if (!(inferred3d || existingState?.frameDimension === '3d')) {
    return false;
  }
  return (
    text.includes('水平方向荷载')
    || text.includes('水平荷载都是')
    || text.includes('水平荷载均为')
    || text.includes('横向荷载两个方向')
    || text.includes('侧向荷载两个方向')
    || text.includes('两个方向都是')
    || text.includes('horizontal loads')
  );
}

function repeatScalar(count: number | undefined, value: number | undefined): number[] | undefined {
  if (!count || !value) {
    return undefined;
  }
  return Array.from({ length: count }, () => value);
}

function extractDirectionalSegment(text: string, axis: 'x' | 'y'): string {
  const pattern = axis === 'x'
    ? /x(?:方向|向)([\s\S]*?)(?=y(?:方向|向)|$)/i
    : /y(?:方向|向)([\s\S]*?)$/i;
  return text.match(pattern)?.[1] || '';
}

function buildUniformFloorLoads(
  storyCount: number | undefined,
  verticalKN: number | undefined,
  lateralXKN: number | undefined,
  lateralYKN: number | undefined,
): DraftFloorLoad[] | undefined {
  if (!storyCount) {
    return undefined;
  }
  if (verticalKN === undefined && lateralXKN === undefined && lateralYKN === undefined) {
    return undefined;
  }
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
  if (!existing?.length) {
    return incoming;
  }
  if (!incoming?.length) {
    return existing;
  }

  const merged = new Map<number, DraftFloorLoad>();
  for (const load of existing) {
    merged.set(load.story, { ...load });
  }
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
  const bayCountXFromText = extractPositiveInt(xSegment, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*跨/i,
    /([0-9]+|[一二两三四五六七八九十]+)\s*bays?/i,
  ]);
  const bayCountYFromText = extractPositiveInt(ySegment, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*跨/i,
    /([0-9]+|[一二两三四五六七八九十]+)\s*bays?/i,
  ]);
  const BAY_ARRAY_PATTERNS = [
    /(?:跨度分别|各跨分别|分别为)\s*((?:[0-9]+(?:\.[0-9]+)?)\s*(?:m|米)(?:\s*[、,，]\s*[0-9]+(?:\.[0-9]+)?\s*(?:m|米))+)/i,
  ];
  const xBayArray = extractNumberArray(xSegment, BAY_ARRAY_PATTERNS);
  const yBayArray = extractNumberArray(ySegment, BAY_ARRAY_PATTERNS);
  const storyHeightArray = extractNumberArray(text, [
    /(?:层高分别|各层层高|每层层高分别)\s*((?:[0-9]+(?:\.[0-9]+)?)\s*(?:m|米)(?:\s*[、,，]\s*[0-9]+(?:\.[0-9]+)?\s*(?:m|米))+)/i,
  ]);
  const bayCountX = bayCountXFromText ?? (xBayArray ? xBayArray.length : undefined);
  const bayCountY = bayCountYFromText ?? (yBayArray ? yBayArray.length : undefined);
  const storyHeightScalar = extractScalar(text, [
    /每层(?:层高)?(?:都?是|统一为|为|高)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
    /层高(?:都?是|统一为|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
  ]);
  const xBayScalar = extractScalar(xSegment, [
    /(?:间隔|跨度|每跨)(?:也?是|都?是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
  ]);
  const yBayScalar = extractScalar(ySegment, [
    /(?:间隔|跨度|每跨)(?:也?是|都?是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
  ]);
  const genericBayScalar = extractScalar(text, [
    /每跨(?:都?是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
    /跨度(?:都?是|也是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
    /间隔(?:都?是|也是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i,
  ]);
  const verticalLoadKN = extractScalar(text, [
    /(?:每层|各层)(?:节点)?(?:竖向)?荷载(?:都?是|均为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /(?:每层|各层)?竖向荷载(?:都?是|均为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /(?:每层|各层)?竖向\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
  ]);
  const dualLateralLoadKN = extractScalar(text, [
    /x(?:、|\/|和|及)\s*y向(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
  ]);
  const extractedLateralXLoadKN = dualLateralLoadKN ?? extractScalar(text, [
    /(?:横向|侧向|水平)(?:方向)?荷载(?:两个方向)?(?:都?是|均为|都为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /水平方向荷载(?:都?是|均为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /(?:横向|侧向|水平)荷载(?:都?是|均为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /(?:横向|侧向|水平)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
  ]) ?? extractDirectionalLoadScalar(text, 'x');
  const extractedLateralYLoadKN = dualLateralLoadKN ?? extractDirectionalLoadScalar(text, 'y');
  const resolvedStoryCount = storyCount ?? existingState?.storyCount ?? existingState?.storyHeightsM?.length;
  const resolvedBayCountX = bayCountX ?? existingState?.bayCountX;
  const resolvedBayCountY = bayCountY ?? existingState?.bayCountY;
  const inferred3d = text.includes('y方向')
    || text.includes('y向')
    || bayCountY !== undefined
    || yBayScalar !== undefined
    || yBayArray !== undefined
    || extractedLateralYLoadKN !== undefined;
  const resolvedFrameDimension = inferred3d
    ? '3d'
    : (existingState?.frameDimension ?? (bayCountX !== undefined ? '3d' : undefined));
  const mirrorHorizontalLoad = shouldMirrorHorizontalLoadToBothAxes(text, existingState, inferred3d);
  const lateralXLoadKN = extractedLateralXLoadKN;
  const lateralYLoadKN = extractedLateralYLoadKN ?? (mirrorHorizontalLoad ? extractedLateralXLoadKN : undefined);

  const extractedSteelGrade = extractSteelGrade(text);
  const extractedColSec = extractColumnSection(text);
  const extractedBeamSec = extractBeamSection(text);

  return {
    inferredType: 'frame',
    frameDimension: resolvedFrameDimension,
    storyCount,
    bayCount: resolvedFrameDimension !== '3d' ? genericBayCount : undefined,
    bayCountX,
    bayCountY,
    storyHeightsM: storyHeightArray ?? repeatScalar(resolvedStoryCount, storyHeightScalar),
    bayWidthsM: resolvedFrameDimension !== '3d' ? repeatScalar(genericBayCount ?? existingState?.bayCount, genericBayScalar) : undefined,
    bayWidthsXM: xBayArray ?? repeatScalar(resolvedBayCountX, xBayScalar ?? (resolvedFrameDimension === '3d' ? genericBayScalar : undefined)),
    bayWidthsYM: yBayArray ?? repeatScalar(resolvedBayCountY, yBayScalar),
    floorLoads: buildUniformFloorLoads(
      resolvedStoryCount,
      verticalLoadKN,
      lateralXLoadKN,
      resolvedFrameDimension === '3d' ? lateralYLoadKN : undefined,
    ),
    steelGrade: extractedSteelGrade,
    columnSection: isSupportedSection(extractedColSec) ? extractedColSec : undefined,
    beamSection: isSupportedSection(extractedBeamSec) ? extractedBeamSec : undefined,
  };
}

function extractLlmScalar(raw: Record<string, unknown> | null | undefined, keys: string[]): number | undefined {
  if (!raw) {
    return undefined;
  }
  for (const key of keys) {
    const value = normalizeNumber(raw[key]);
    if (value !== undefined && value > 0) {
      return value;
    }
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

  const rawSteelGrade = typeof rawPatch?.steelGrade === 'string' ? rawPatch.steelGrade : undefined;
  const rawColSec = typeof rawPatch?.columnSection === 'string' ? rawPatch.columnSection : undefined;
  const rawBeamSec = typeof rawPatch?.beamSection === 'string' ? rawPatch.beamSection : undefined;

  return {
    ...normalized,
    frameDimension,
    storyHeightsM: normalized.storyHeightsM ?? repeatScalar(storyCount, storyHeightScalar),
    bayWidthsM: normalized.bayWidthsM ?? repeatScalar(bayCount, bayWidthScalar),
    bayWidthsXM: normalized.bayWidthsXM ?? repeatScalar(bayCountX, bayWidthXScalar ?? bayWidthScalar),
    bayWidthsYM: normalized.bayWidthsYM ?? repeatScalar(bayCountY, bayWidthYScalar ?? bayWidthScalar),
    floorLoads: normalized.floorLoads ?? buildUniformFloorLoads(storyCount, verticalLoadKN, lateralXKN, frameDimension === '3d' ? lateralYKN : undefined),
    steelGrade: rawSteelGrade ?? normalized.steelGrade,
    columnSection: isSupportedSection(rawColSec) ? rawColSec : (isSupportedSection(normalized.columnSection as string | undefined) ? normalized.columnSection : undefined),
    beamSection: isSupportedSection(rawBeamSec) ? rawBeamSec : (isSupportedSection(normalized.beamSection as string | undefined) ? normalized.beamSection : undefined),
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
    || text.includes('x 向') && text.includes('y 向')
    || text.includes('x向') && text.includes('y向')
    || text.includes('3d')
    || text.includes('三维')
  );
  const nextPatch: DraftExtraction = { ...patch };
  if (nextPatch.frameDimension !== undefined) {
    return nextPatch;
  }
  if (nextPatch.frameDimension === '3d' || hasLateralYFloorLoad(nextPatch.floorLoads)) {
    nextPatch.frameDimension = '3d';
    return nextPatch;
  }
  if (existingState?.frameDimension === '2d' && mentions3dDirections) {
    nextPatch.frameDimension = '3d';
    return nextPatch;
  }
  if (!nextPatch.frameDimension && existingState?.frameDimension) {
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
  const normalizedNaturalPatch = toFramePatch(normalizeFrameNaturalPatch(message, existingState));
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

  return coerceFrameDimension(
    {
      ...nextPatch,
      inferredType: 'frame',
    },
    existingState,
    message,
  );
}

function inferFrameDimensionProposal(state: DraftState): '2d' | '3d' {
  if (state.frameDimension === '3d') {
    return '3d';
  }
  if ((state.bayCountY ?? 0) > 0) {
    return '3d';
  }
  if ((state.bayWidthsYM?.length ?? 0) > 0) {
    return '3d';
  }
  if (hasLateralYFloorLoad(state.floorLoads)) {
    return '3d';
  }
  return '2d';
}

function buildFrameDefaultReason(paramKey: string, locale: AppLocale, state: DraftState): string {
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
    case 'steelGrade':
      return locale === 'zh'
        ? '钢材牌号默认为 Q345，适合常规多层钢框架。如有其他要求请在确认时修改。'
        : 'Steel grade defaults to Q345, suitable for typical multi-story steel frames. Adjust when confirming if needed.';
    case 'columnSection':
      return locale === 'zh'
        ? `柱截面根据层数推荐 ${suggestColumnSection(state)}（宽翼缘 HW 系列）。如有其他规格请在确认时修改。`
        : `Column section ${suggestColumnSection(state)} is suggested based on story count (wide-flange HW series). Adjust when confirming if needed.`;
    case 'beamSection':
      return locale === 'zh'
        ? `梁截面根据跨度推荐 ${suggestBeamSection(state)}（窄翼缘 HN 系列）。如有其他规格请在确认时修改。`
        : `Beam section ${suggestBeamSection(state)} is suggested based on span length (narrow-flange HN series). Adjust when confirming if needed.`;
    default:
      return locale === 'zh'
        ? `根据 ${paramKey} 的推荐值采用默认配置。`
        : `Apply the recommended default value for ${paramKey}.`;
  }
}

function buildFrameDefaultProposals(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[] {
  const questions = buildInteractionQuestions(keys, [], { ...state, inferredType: 'frame' }, locale);
  const next = new Map<string, SkillDefaultProposal>();

  for (const question of questions) {
    if (question.suggestedValue === undefined) {
      continue;
    }
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
  if (keys.includes('steelGrade')) {
    next.set('steelGrade', {
      paramKey: 'steelGrade',
      value: 'Q345',
      reason: buildFrameDefaultReason('steelGrade', locale, state),
    });
  }
  if (keys.includes('columnSection')) {
    next.set('columnSection', {
      paramKey: 'columnSection',
      value: suggestColumnSection(state),
      reason: buildFrameDefaultReason('columnSection', locale, state),
    });
  }
  if (keys.includes('beamSection')) {
    next.set('beamSection', {
      paramKey: 'beamSection',
      value: suggestBeamSection(state),
      reason: buildFrameDefaultReason('beamSection', locale, state),
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
          ? `请确认各层节点荷载（单位 kN）。${loadHint}`
          : `Please confirm per-story nodal loads (kN). ${loadHint}`,
      };
    }
    if (question.paramKey === 'steelGrade') {
      return {
        ...question,
        question: locale === 'zh'
          ? '请确认钢材牌号（Q235 / Q345 / Q390 / Q420）。常规多层钢框架建议选 Q345。'
          : 'Please confirm the steel grade (Q235 / Q345 / Q390 / Q420). Q345 is recommended for typical multi-story steel frames.',
        suggestedValue: 'Q345',
      };
    }
    if (question.paramKey === 'columnSection') {
      const suggested = suggestColumnSection(state);
      return {
        ...question,
        question: locale === 'zh'
          ? `请确认柱截面型号（宽翼缘 HW 系列，如 HW300x300、HW350x350、HW400x400）。根据层数建议：${suggested}。`
          : `Please confirm column section (wide-flange HW series, e.g. HW300x300). Suggested based on story count: ${suggested}.`,
        suggestedValue: suggested,
      };
    }
    if (question.paramKey === 'beamSection') {
      const suggested = suggestBeamSection(state);
      return {
        ...question,
        question: locale === 'zh'
          ? `请确认梁截面型号（窄翼缘 HN 系列，如 HN400x200、HN500x200）。根据跨度建议：${suggested}。`
          : `Please confirm beam section (narrow-flange HN series, e.g. HN400x200). Suggested based on span: ${suggested}.`,
        suggestedValue: suggested,
      };
    }
    return question;
  });
}

function buildFrameReportNarrative(input: SkillReportNarrativeInput): string {
  const base = buildDefaultReportNarrative(input);
  const frameSpecificNotes = [
    '',
    input.locale === 'zh' ? '## 框架专项说明' : '## Frame-Specific Notes',
    input.locale === 'zh'
      ? '- 本报告按规则轴网框架场景生成，建议结合实际结构布置复核边界条件与荷载路径。'
      : '- This report is generated for regular-grid frame scenarios; verify boundary conditions and load paths against the actual structural layout.',
    input.locale === 'zh'
      ? '- 对于退台、缺跨或明显不规则框架，建议补充更细化模型后重新分析与校核。'
      : '- For setbacks, missing bays, or strongly irregular frames, refine the model and rerun analysis/code checks.',
  ];
  return [base, ...frameSpecificNotes].join('\n');
}

export const handler: SkillHandler = {
  detectScenario({ message, locale, currentState }) {
    const text = message.toLowerCase();
    if (
      (text.includes('frame') || text.includes('框架') || text.includes('钢框架'))
      && (text.includes('irregular') || text.includes('不规则') || text.includes('退台') || text.includes('缺跨'))
    ) {
      return buildScenarioMatch('frame', 'unknown', 'frame', 'unsupported', locale, {
        zh: '当前 frame skill 只支持规则楼层和规则轴网框架。若结构存在退台、缺跨或明显不规则，请直接提供 JSON 或更具体的节点构件描述。',
        en: 'The current frame skill only supports regular stories and regular grids. If the structure has setbacks, missing bays, or strong irregularities, please provide JSON or a more explicit node/member description.',
      });
    }
    if (text.includes('steel frame') || text.includes('钢框架')) {
      return buildScenarioMatch('steel-frame', 'frame', 'frame', 'supported', locale);
    }
    if (text.includes('frame') || text.includes('框架')) {
      return buildScenarioMatch('frame', 'frame', 'frame', 'supported', locale);
    }
    if (currentState?.inferredType === 'frame') {
      const key = currentState.scenarioKey ?? 'frame';
      return buildScenarioMatch(key, 'frame', 'frame', 'supported', locale);
    }
    return null;
  },
  parseProvidedValues(values) {
    return coerceFrameDimension(
      toFramePatch(normalizeLegacyDraftPatch(values)),
      undefined,
      JSON.stringify(values),
    );
  },
  extractDraft({ message, llmDraftPatch, currentState }) {
    return buildFrameDraftPatch(message, llmDraftPatch, currentState);
  },
  mergeState(existing, patch) {
    const framePatch = coerceFrameDimension(toFramePatch(patch), existing, '');
    const merged = mergeLegacyState(existing, framePatch, 'frame', 'frame');
    for (const key of MATERIAL_SECTION_KEYS) {
      const next = framePatch[key] ?? existing?.[key];
      if (next !== undefined) {
        merged[key] = next;
      }
    }
    return merged;
  },
  computeMissing(state, mode) {
    return computeLegacyMissing(
      { ...state, inferredType: 'frame' },
      mode,
      [...REQUIRED_KEYS]
    );
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
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
    return buildLegacyModel({ ...state, inferredType: 'frame' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
