import { normalizeNumber, normalizePositiveInteger } from '../../../agent-runtime/fallback.js';
import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';

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
  if (!raw) return undefined;
  const direct = normalizePositiveInteger(raw);
  if (direct !== undefined) return direct;
  if (raw === '十') return 10;
  return CHINESE_NUMERAL_MAP[raw.trim()];
}

function repeatScalar(count: number | undefined, value: number | undefined): number[] | undefined {
  if (!count || value === undefined) return undefined;
  return Array.from({ length: count }, () => value);
}

function extractMatch(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  return match?.[1];
}

export function normalizeFrameNaturalPatch(message: string, existingState: DraftState | undefined): DraftExtraction {
  const text = message.toLowerCase();

  const storyCount = parseLocalizedPositiveInt(extractMatch(text, /([0-9]+|[一二两三四五六七八九十]+)\s*层/i));
  const xCount = parseLocalizedPositiveInt(extractMatch(text, /x(?:方向|向).*?([0-9]+|[一二两三四五六七八九十]+)\s*跨/i));
  const yCount = parseLocalizedPositiveInt(extractMatch(text, /y(?:方向|向).*?([0-9]+|[一二两三四五六七八九十]+)\s*跨/i));

  const storyHeight = normalizeNumber(extractMatch(text, /每层(?:层高)?(?:都?是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i));
  const xSpan = normalizeNumber(extractMatch(text, /x(?:方向|向).*?(?:间隔|跨度|每跨)(?:也?是|都?是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i));
  const ySpan = normalizeNumber(extractMatch(text, /y(?:方向|向).*?(?:间隔|跨度|每跨)(?:也?是|都?是|为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m|米)/i));

  return {
    inferredType: 'frame',
    frameDimension: yCount !== undefined || ySpan !== undefined ? '3d' : existingState?.frameDimension,
    storyCount,
    storyHeightsM: repeatScalar(storyCount ?? existingState?.storyCount, storyHeight),
    bayCountX: xCount,
    bayCountY: yCount,
    bayWidthsXM: repeatScalar(xCount, xSpan),
    bayWidthsYM: repeatScalar(yCount, ySpan),
  };
}
