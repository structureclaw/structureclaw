import { normalizeNumber } from '../../../agent-runtime/fallback.js';
import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';
import { GEOMETRY_KEYS, LOAD_BOUNDARY_KEYS } from './constants.js';

function extractNaturalScalar(message: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return normalizeNumber(match[1]);
  }
  return undefined;
}

function extractNaturalCount(message: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return normalizeNumber(match[1]);
  }
  return undefined;
}

function extractNaturalArray(message: string, patterns: RegExp[]): number[] | undefined {
  for (const pattern of patterns) {
    const matches = message.matchAll(pattern);
    const values: number[] = [];
    for (const match of matches) {
      const value = normalizeNumber(match[1]);
      if (value !== undefined && value > 0) values.push(value);
    }
    if (values.length > 0) return values;
  }
  return undefined;
}

function extractStoryCount(message: string): number | undefined {
  return extractNaturalCount(message, [
    /(?:层数|楼层|story\s*count|story\s*number)\s*[：:]*\s*(\d+)/i,
    /(?:共|有|总共|总计)\s*(\d+)\s*(?:层|楼|story|floor)/i,
    /(\d+)\s*(?:层|楼|story|floor)/i,
  ]);
}

function extractStoryHeights(message: string): number[] | undefined {
  return extractNaturalArray(message, [
    /(?:层高|story\s*height)\s*[：:]*\s*(\d+(?:\.\d+)?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:米|m)\s*(?:层高|高|height)/gi,
  ]);
}

function extractBayCount(message: string): number | undefined {
  return extractNaturalCount(message, [
    /(?:跨数|bay\s*count|span\s*count)\s*[：:]*\s*(\d+)/i,
    /(?:共|有|总共|总计)\s*(\d+)\s*(?:跨|bay|span)/i,
    /(\d+)\s*(?:跨|bay|span)/i,
  ]);
}

function extractBayWidths(message: string): number[] | undefined {
  return extractNaturalArray(message, [
    /(?:跨度|bay\s*width|span\s*width)\s*[：:]*\s*(\d+(?:\.\d+)?)/gi,
    /(\d+(?:\.\d+)?)\s*(?:米|m)\s*(?:跨度|宽|width)/gi,
  ]);
}

function extractFrameDimension(message: string): '2d' | '3d' | undefined {
  if (/(?:3d|三维|y向|y方向|x、y向|x\/y向)/i.test(message)) return '3d';
  if (/(?:2d|二维|平面|x向)/i.test(message)) return '2d';
  return undefined;
}

function extractFrameMaterial(message: string): string | undefined {
  const concreteMatch = message.match(/(?:混凝土|concrete)\s*(?:等级|标号|grade)?\s*[：:]*\s*([Cc]\d+)/i);
  if (concreteMatch) return concreteMatch[1].toUpperCase();
  const rebarMatch = message.match(/(?:钢筋|rebar|steel)\s*(?:等级|牌号|grade)?\s*[：:]*\s*([Hh][PpRr][Bb]\d+)/i);
  if (rebarMatch) return rebarMatch[1].toUpperCase();
  return undefined;
}

function extractFrameColumnSection(message: string): string | undefined {
  const match = message.match(/(?:柱|column)\s*(?:截面|section)?\s*[：:]*\s*([\dXx×]+)/i);
  if (match) return match[1].toUpperCase().replace(/×/g, 'X');
  return undefined;
}

function extractFrameBeamSection(message: string): string | undefined {
  const match = message.match(/(?:梁|beam)\s*(?:截面|section)?\s*[：:]*\s*([\dXx×]+)/i);
  if (match) return match[1].toUpperCase().replace(/×/g, 'X');
  return undefined;
}

export function normalizeConcreteFrameNaturalPatch(
  message: string,
  existingState: DraftState | undefined,
): DraftExtraction {
  const storyCount = extractStoryCount(message) ?? existingState?.storyCount;
  const storyHeightsM = extractStoryHeights(message) ?? existingState?.storyHeightsM;
  const bayCount = extractBayCount(message) ?? existingState?.bayCount;
  const bayWidthsM = extractBayWidths(message) ?? existingState?.bayWidthsM;
  const frameDimension = extractFrameDimension(message) ?? existingState?.frameDimension;
  const frameMaterial = extractFrameMaterial(message) ?? existingState?.frameMaterial as string | undefined;
  const frameColumnSection = extractFrameColumnSection(message) ?? existingState?.frameColumnSection as string | undefined;
  const frameBeamSection = extractFrameBeamSection(message) ?? existingState?.frameBeamSection as string | undefined;

  return {
    ...(storyCount !== undefined && { storyCount }),
    ...(storyHeightsM !== undefined && { storyHeightsM }),
    ...(bayCount !== undefined && { bayCount }),
    ...(bayWidthsM !== undefined && { bayWidthsM }),
    ...(frameDimension !== undefined && { frameDimension }),
    ...(frameMaterial !== undefined && { frameMaterial }),
    ...(frameColumnSection !== undefined && { frameColumnSection }),
    ...(frameBeamSection !== undefined && { frameBeamSection }),
  };
}