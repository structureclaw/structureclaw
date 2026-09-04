import {
  BOTTOM_ZONE_MIN_THICKNESS_MM,
  BOTTOM_ZONE_NO_END_COLUMN_RATIO,
  BOTTOM_ZONE_STORY_RATIO,
  COUPLING_BEAM_MAX_SPAN_DEPTH_RATIO,
  COUPLING_BEAM_MIN_HEIGHT_MM,
  COUPLING_BEAM_MIN_SPAN_DEPTH_RATIO,
  DISTRIBUTED_REINFORCEMENT_RATIO,
  MIN_WALL_THICKNESS_MM,
  WALL_THICKNESS_STORY_RATIO,
} from './constants.js';
import type {
  CouplingBeamDesign,
  SeismicGradeValue,
  ShearWallDesignSummary,
  WallOpeningSpec,
  WallStoryDesign,
} from './types.js';

export const SEISMIC_GRADE_LABELS: Record<SeismicGradeValue, string> = {
  1: '一级',
  2: '二级',
  3: '三级',
  4: '四级',
};

const SEISMIC_GRADE_TEXT: Record<string | number, SeismicGradeValue> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  一: 1,
  一级: 1,
  first: 1,
  二: 2,
  二级: 2,
  second: 2,
  三: 3,
  三级: 3,
  third: 3,
  四: 4,
  四级: 4,
  fourth: 4,
};

/**
 * Parse a user/L provided seismic grade (GB/T 50011 抗震等级).
 * Accepts 1–4, 一级…四级, and English ordinal words.
 */
export function parseSeismicGrade(value: unknown): SeismicGradeValue | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return SEISMIC_GRADE_TEXT[value] as SeismicGradeValue | undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (/^[1-4]$/.test(normalized)) return Number(normalized) as SeismicGradeValue;
    return SEISMIC_GRADE_TEXT[normalized] ?? SEISMIC_GRADE_TEXT[value.trim()];
  }
  return undefined;
}

/**
 * Suggest a seismic grade from the fortification intensity for shear wall
 * structures in the common 25–80 m height band (GB/T 50011 table 6.1.2).
 */
export function suggestSeismicGradeFromIntensity(intensity: number | undefined): SeismicGradeValue | undefined {
  const table: Record<number, SeismicGradeValue> = { 6: 4, 7: 3, 8: 2, 9: 1 };
  if (intensity === undefined || !Number.isFinite(intensity)) return undefined;
  return table[Math.round(intensity)];
}

/**
 * Bottom strengthened stories from base — GB/T 50011 6.1.10:
 * max(bottom two stories, total height / 10).
 */
export function computeBottomStrengthenedStoryCount(storyHeightsM: number[]): number {
  const totalHeight = storyHeightsM.reduce((sum, height) => sum + height, 0);
  let accumulated = 0;
  let count = 0;
  for (const height of storyHeightsM) {
    accumulated += height;
    count += 1;
    if (accumulated >= totalHeight / 10) break;
  }
  return Math.max(count, 2);
}

function roundThicknessUp(thicknessMm: number): number {
  return Math.ceil(thicknessMm / 50) * 50;
}

/**
 * Estimate wall thickness (mm) for one story — GB/T 50011 6.4.1.
 * When no seismic grade is provided, the grade 3/4 (least seismic) limits are used.
 */
export function estimateWallThicknessMm(options: {
  storyHeightM: number;
  seismicGrade?: SeismicGradeValue;
  isBottomStrengthenedZone?: boolean;
  hasEndColumn?: boolean;
}): number {
  const { storyHeightM, seismicGrade, isBottomStrengthenedZone = false, hasEndColumn = false } = options;
  const highGrade = seismicGrade !== undefined && seismicGrade <= 2;
  const limits: number[] = [
    highGrade ? MIN_WALL_THICKNESS_MM.grade12 : MIN_WALL_THICKNESS_MM.grade34,
    (storyHeightM * 1000) / (highGrade ? WALL_THICKNESS_STORY_RATIO.grade12 : WALL_THICKNESS_STORY_RATIO.grade34),
  ];
  if (isBottomStrengthenedZone && highGrade) {
    limits.push(BOTTOM_ZONE_MIN_THICKNESS_MM, (storyHeightM * 1000) / BOTTOM_ZONE_STORY_RATIO);
    if (!hasEndColumn) {
      limits.push((storyHeightM * 1000) / BOTTOM_ZONE_NO_END_COLUMN_RATIO);
    }
  }
  return roundThicknessUp(Math.max(...limits));
}

/**
 * Split a wall line into piers between openings and lay out openings
 * without an explicit x offset evenly between the wall ends.
 * Openings outside the wall or overlapping each other are dropped.
 */
export function splitWallIntoPiers(wallLengthM: number, openings: WallOpeningSpec[]): {
  piers: Array<{ xM: number; lengthM: number }>;
  openings: Array<WallOpeningSpec & { xM: number }>;
} {
  const resolvedOpenings = filterValidOpenings(wallLengthM, resolveOpeningOffsets(wallLengthM, openings));
  const sorted = [...resolvedOpenings].sort((left, right) => left.xM - right.xM);
  const piers: Array<{ xM: number; lengthM: number }> = [];
  let cursor = 0;
  for (const opening of sorted) {
    const pierLength = opening.xM - cursor;
    if (pierLength > 1e-6) {
      piers.push({ xM: cursor, lengthM: pierLength });
    }
    cursor = opening.xM + opening.widthM;
  }
  const tailLength = wallLengthM - cursor;
  if (tailLength > 1e-6) {
    piers.push({ xM: cursor, lengthM: tailLength });
  }
  if (!piers.length) {
    piers.push({ xM: 0, lengthM: wallLengthM });
  }
  return { piers, openings: sorted };
}

/** Lay out openings that lack an explicit x offset evenly between the wall ends. */
function resolveOpeningOffsets(
  wallLengthM: number,
  openings: WallOpeningSpec[],
): Array<WallOpeningSpec & { xM: number }> {
  const explicit = openings
    .filter((opening) => opening.xM !== undefined)
    .map((opening) => ({ ...opening, xM: opening.xM as number }));
  const implicit = openings.filter((opening) => opening.xM === undefined);
  if (!implicit.length) {
    return explicit;
  }
  const totalOpeningWidth = implicit.reduce((sum, opening) => sum + opening.widthM, 0);
  const gap = implicit.length + 1;
  const evenGap = Math.max((wallLengthM - totalOpeningWidth) / gap, 0);
  let cursor = evenGap;
  const laidOut = implicit.map((opening) => {
    const placed = { ...opening, xM: cursor };
    cursor += opening.widthM + evenGap;
    return placed;
  });
  return [...explicit, ...laidOut];
}

/** Drop openings outside the wall or overlapping an earlier opening. */
function filterValidOpenings(
  wallLengthM: number,
  openings: Array<WallOpeningSpec & { xM: number }>,
): Array<WallOpeningSpec & { xM: number }> {
  const sorted = [...openings].sort((left, right) => left.xM - right.xM);
  const valid: Array<WallOpeningSpec & { xM: number }> = [];
  let cursor = 0;
  for (const opening of sorted) {
    if (opening.xM < cursor - 1e-9 || opening.xM + opening.widthM > wallLengthM + 1e-9) {
      continue;
    }
    valid.push(opening);
    cursor = opening.xM + opening.widthM;
  }
  return valid;
}

/** Design one coupling beam above an opening. */
export function designCouplingBeam(options: {
  id: string;
  spanM: number;
}): CouplingBeamDesign {
  const { id, spanM } = options;
  const targetHeightMm = Math.max(
    COUPLING_BEAM_MIN_HEIGHT_MM,
    roundThicknessUp((spanM * 1000) / COUPLING_BEAM_MAX_SPAN_DEPTH_RATIO),
  );
  const spanDepthRatio = (spanM * 1000) / targetHeightMm;
  return {
    id,
    spanM,
    heightMm: targetHeightMm,
    spanDepthRatio: Math.round(spanDepthRatio * 10) / 10,
    meetsRequirement: spanDepthRatio <= COUPLING_BEAM_MAX_SPAN_DEPTH_RATIO
      && spanDepthRatio >= COUPLING_BEAM_MIN_SPAN_DEPTH_RATIO,
  };
}

/** Distributed reinforcement minimum ratio for the grade (GB/T 50011 6.4.3). */
export function distributedReinforcementRatio(seismicGrade: SeismicGradeValue | undefined): number {
  if (seismicGrade === undefined) return DISTRIBUTED_REINFORCEMENT_RATIO[4];
  return DISTRIBUTED_REINFORCEMENT_RATIO[seismicGrade];
}

/**
 * Build the full wall design summary from the draft geometry.
 * `hasEndColumn` is false by default (plain wall ends), which keeps the
 * stricter story-height/12 bottom-zone thickness limit of GB/T 50011 6.4.1.
 */
export function buildShearWallDesignSummary(options: {
  wallLengthM: number;
  storyHeightsM: number[];
  openings?: WallOpeningSpec[];
  seismicGrade?: SeismicGradeValue;
  thicknessMm?: number;
}): ShearWallDesignSummary {
  const { wallLengthM, storyHeightsM, openings = [], seismicGrade, thicknessMm } = options;
  const bottomStrengthenedStoryCount = computeBottomStrengthenedStoryCount(storyHeightsM);
  const { piers, openings: resolvedOpenings } = splitWallIntoPiers(wallLengthM, openings);

  const stories: WallStoryDesign[] = storyHeightsM.map((storyHeightM, index) => {
    const isBottomStrengthenedZone = index < bottomStrengthenedStoryCount;
    const estimated = estimateWallThicknessMm({
      storyHeightM,
      seismicGrade,
      isBottomStrengthenedZone,
    });
    return {
      story: index + 1,
      storyId: `F${index + 1}`,
      storyHeightM,
      thicknessMm: thicknessMm !== undefined ? thicknessMm : estimated,
      isBottomStrengthenedZone,
    };
  });

  const governingThickness = thicknessMm
    ?? Math.max(...stories.map((story) => story.thicknessMm));

  const couplingBeams: CouplingBeamDesign[] = resolvedOpenings.map((opening, index) => (
    designCouplingBeam({ id: `CB-${index + 1}`, spanM: opening.widthM })
  ));

  const openingArea = resolvedOpenings.reduce((sum, opening) => sum + opening.widthM * opening.heightM, 0);
  const wallArea = wallLengthM * storyHeightsM.reduce((sum, height) => sum + height, 0);

  return {
    wallLengthM,
    seismicGrade,
    seismicGradeLabel: seismicGrade !== undefined ? SEISMIC_GRADE_LABELS[seismicGrade] : '',
    bottomStrengthenedStoryCount,
    stories,
    piers: piers.map((pier, index) => ({
      id: `WP-${index + 1}`,
      lengthM: Math.round(pier.lengthM * 1000) / 1000,
      thicknessMm: governingThickness,
    })),
    couplingBeams,
    openings: resolvedOpenings,
    openingAreaRatio: wallArea > 0 ? Math.round((openingArea / wallArea) * 1000) / 1000 : 0,
    distributedReinforcementRatio: distributedReinforcementRatio(seismicGrade),
    boundaryElementNote: {
      zh: seismicGrade !== undefined && seismicGrade <= 2
        ? '底部加强部位及相邻上一层应设置约束边缘构件，其余部位设置构造边缘构件。'
        : '按构造边缘构件要求设置墙肢端部边缘构件。',
      en: seismicGrade !== undefined && seismicGrade <= 2
        ? 'Constrained boundary elements are required in the bottom strengthened zone and the story above; other positions use constructive boundary elements.'
        : 'Provide constructive boundary elements at wall ends.',
    },
  };
}
