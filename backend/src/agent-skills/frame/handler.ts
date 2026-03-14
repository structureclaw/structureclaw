import {
  buildLegacyLabels,
  buildLegacyModel,
  buildLegacyQuestions,
  computeLegacyMissing,
  mergeLegacyState,
  normalizeLegacyDraftPatch,
  restrictLegacyDraftPatch,
} from '../../services/agent-skills/legacy.js';
import { buildScenarioMatch, resolveLegacyStructuralStage } from '../../services/agent-skills/plugin-helpers.js';
import { extractDraftByRules, normalizeNumber, normalizePositiveInteger } from '../../services/agent-skills/fallback.js';
import type { DraftExtraction, DraftFloorLoad, DraftState, SkillHandler } from '../../services/agent-skills/types.js';

const ALLOWED_KEYS = [
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
  'frameBaseSupportType',
] as const;

function toFramePatch(patch: DraftExtraction): DraftExtraction {
  return restrictLegacyDraftPatch(patch, 'frame', [...ALLOWED_KEYS]);
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
  ]);
  const dualLateralLoadKN = extractScalar(text, [
    /x(?:、|\/|和|及)\s*y向(?:水平|横向|侧向)?荷载(?:都?是|均为|各为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
  ]);
  const extractedLateralXLoadKN = dualLateralLoadKN ?? extractScalar(text, [
    /(?:横向|侧向|水平)(?:方向)?荷载(?:两个方向)?(?:都?是|均为|都为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /水平方向荷载(?:都?是|均为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
    /(?:横向|侧向|水平)荷载(?:都?是|均为|为|是)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kn|千牛)/i,
  ]) ?? extractDirectionalLoadScalar(text, 'x');
  const extractedLateralYLoadKN = dualLateralLoadKN ?? extractDirectionalLoadScalar(text, 'y');
  const resolvedStoryCount = storyCount ?? existingState?.storyCount ?? existingState?.storyHeightsM?.length;
  const resolvedBayCountX = bayCountX ?? existingState?.bayCountX;
  const resolvedBayCountY = bayCountY ?? existingState?.bayCountY;
  const inferred3d = text.includes('y方向')
    || text.includes('y向')
    || bayCountY !== undefined
    || yBayScalar !== undefined
    || extractedLateralYLoadKN !== undefined;
  const resolvedFrameDimension = inferred3d
    ? '3d'
    : (existingState?.frameDimension ?? (bayCountX !== undefined ? '3d' : undefined));
  const mirrorHorizontalLoad = shouldMirrorHorizontalLoadToBothAxes(text, existingState, inferred3d);
  const lateralXLoadKN = extractedLateralXLoadKN;
  const lateralYLoadKN = extractedLateralYLoadKN ?? (mirrorHorizontalLoad ? extractedLateralXLoadKN : undefined);

  return {
    inferredType: 'frame',
    frameDimension: resolvedFrameDimension,
    storyCount,
    bayCount: resolvedFrameDimension !== '3d' ? genericBayCount : undefined,
    bayCountX,
    bayCountY,
    storyHeightsM: repeatScalar(resolvedStoryCount, storyHeightScalar),
    bayWidthsM: resolvedFrameDimension !== '3d' ? repeatScalar(genericBayCount ?? existingState?.bayCount, genericBayScalar) : undefined,
    bayWidthsXM: repeatScalar(resolvedBayCountX, xBayScalar ?? (resolvedFrameDimension === '3d' ? genericBayScalar : undefined)),
    bayWidthsYM: repeatScalar(resolvedBayCountY, yBayScalar),
    floorLoads: buildUniformFloorLoads(
      resolvedStoryCount,
      verticalLoadKN,
      lateralXLoadKN,
      resolvedFrameDimension === '3d' ? lateralYLoadKN : undefined,
    ),
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

  return {
    ...normalized,
    frameDimension,
    storyHeightsM: normalized.storyHeightsM ?? repeatScalar(storyCount, storyHeightScalar),
    bayWidthsM: normalized.bayWidthsM ?? repeatScalar(bayCount, bayWidthScalar),
    bayWidthsXM: normalized.bayWidthsXM ?? repeatScalar(bayCountX, bayWidthXScalar ?? bayWidthScalar),
    bayWidthsYM: normalized.bayWidthsYM ?? repeatScalar(bayCountY, bayWidthYScalar ?? bayWidthScalar),
    floorLoads: normalized.floorLoads ?? buildUniformFloorLoads(storyCount, verticalLoadKN, lateralXKN, frameDimension === '3d' ? lateralYKN : undefined),
  };
}

function preferPatch(primary: DraftExtraction, fallback: DraftExtraction): DraftExtraction {
  const nextPatch: DraftExtraction = { inferredType: 'frame' };
  for (const key of ALLOWED_KEYS) {
    const primaryValue = primary[key];
    const fallbackValue = fallback[key];
    if (key === 'floorLoads') {
      const mergedFloorLoads = mergeFloorLoads(
        fallbackValue as DraftFloorLoad[] | undefined,
        primaryValue as DraftFloorLoad[] | undefined,
      );
      if (mergedFloorLoads !== undefined) {
        nextPatch.floorLoads = mergedFloorLoads;
      }
      continue;
    }
    if (primaryValue !== undefined) {
      nextPatch[key as string] = primaryValue;
      continue;
    }
    if (fallbackValue !== undefined) {
      nextPatch[key as string] = fallbackValue;
    }
  }
  return nextPatch;
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
  const normalizedRulePatch = toFramePatch(extractDraftByRules(message));
  const nextPatch = preferPatch(
    normalizedLlmPatch,
    preferPatch(normalizedNaturalPatch, normalizedRulePatch),
  );

  return coerceFrameDimension(
    {
      ...nextPatch,
      inferredType: 'frame',
    },
    existingState,
    message,
  );
}

export const handler: SkillHandler = {
  detectScenario({ message, locale }) {
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
    return mergeLegacyState(existing, coerceFrameDimension(toFramePatch(patch), existing, ''), 'frame', 'frame');
  },
  computeMissing(state, mode) {
    return computeLegacyMissing(
      { ...state, inferredType: 'frame' },
      mode,
      ['frameDimension', 'storyCount', 'bayCount', 'bayCountX', 'bayCountY', 'storyHeightsM', 'bayWidthsM', 'bayWidthsXM', 'bayWidthsYM', 'floorLoads']
    );
  },
  mapLabels(keys, locale) {
    return buildLegacyLabels(keys, locale);
  },
  buildQuestions(keys, criticalMissing, state, locale) {
    return buildLegacyQuestions(keys, criticalMissing, { ...state, inferredType: 'frame' }, locale);
  },
  buildModel(state) {
    return buildLegacyModel({ ...state, inferredType: 'frame' });
  },
  resolveStage(missingKeys) {
    return resolveLegacyStructuralStage(missingKeys);
  },
};

export default handler;
