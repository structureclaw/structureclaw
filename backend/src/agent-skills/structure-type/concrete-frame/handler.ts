import { normalizeLegacyDraftPatch } from '../../../agent-runtime/legacy.js';
import type { SkillHandler } from '../../../agent-runtime/types.js';
import { detectConcreteFrameStructuralType } from './detect.js';
import { buildConcreteFrameDraftPatch, coerceConcreteFrameDimension, toConcreteFramePatch } from './extract-llm.js';
import {
  buildConcreteFrameDefaultProposals,
  buildConcreteFrameQuestions,
  buildConcreteFrameReportNarrative,
  computeConcreteFrameMissing,
  mapConcreteFrameLabels,
  resolveConcreteFrameStage,
} from './interaction.js';
import { mergeConcreteFrameState } from './merge.js';
import { buildConcreteFrameModel, getConcreteMaterial, isValidConcreteGrade, normalizeConcreteGrade, normalizeSectionName } from './model.js';
import { DEFAULT_FLOOR_LOAD_KN_PER_M2 } from './constants.js';
import type {
  ConcreteBeam,
  ConcreteColumn,
  ConcreteFrameInput,
  ConcreteFrameOutput,
  ConcreteSlab,
} from './types.js';

// ============================================================================
// 构件生成器
// ============================================================================

/** Span-thickness ratio limits per slab type (GB/T 50010-2010 §9.1.2) */
const SPAN_DEPTH_RATIO_LIMITS: Record<string, number> = {
  'one-way': 30,
  'two-way': 40,
  'flat-slab': 30,
  'waffle': 35,
};

/** Minimum slab thickness by slabType × slabUsage (mm) — GB/T 50010-2010 §9.1.2 */
const MIN_THICKNESS_MAP: Record<string, number> = {
  'one-way_roof': 60,
  'one-way_residential': 60,
  'one-way_commercial': 70,
  'one-way_vehicle': 80,
  'two-way_roof': 100,
  'two-way_residential': 80,
  'two-way_commercial': 80,
  'two-way_vehicle': 80,
  'flat-slab_roof': 150,
  'flat-slab_residential': 150,
  'flat-slab_commercial': 150,
  'flat-slab_vehicle': 150,
  'waffle_roof': 200,
  'waffle_residential': 200,
  'waffle_commercial': 200,
  'waffle_vehicle': 200,
};

/**
 * 验证混凝土框架输入参数
 * @throws Error 如果输入参数无效
 */
function validateConcreteFrameInput(input: ConcreteFrameInput): void {
  if (!input.bayWidthsM?.length) {
    throw new Error('bayWidthsM must be a non-empty array');
  }
  if (input.bayWidthsM.some(w => w <= 0)) {
    throw new Error('bayWidthsM must contain positive values');
  }
  if (input.storyHeightsM?.length !== input.storyCount) {
    throw new Error(
      `storyHeightsM length (${input.storyHeightsM?.length ?? 'undefined'}) must match storyCount (${input.storyCount})`,
    );
  }
  if (!isValidConcreteGrade(input.concreteGrade)) {
    throw new Error(`Invalid concrete grade: ${input.concreteGrade}`);
  }
}

/**
 * 生成所有混凝土构件
 * @param input 混凝土框架输入参数
 * @returns 包含梁、柱、板的输出对象
 */
export function generateMembers(input: ConcreteFrameInput): ConcreteFrameOutput {
  const errors: Array<{ code: string; message: string }> = [];
  const warnings: Array<{ code: string; message: string }> = [];

  try {
    validateConcreteFrameInput(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({ code: 'INPUT_VALIDATION_ERROR', message });
    return { concreteBeams: [], concreteColumns: [], concreteSlabs: [], warnings, errors };
  }

  let beams: ConcreteBeam[] = [];
  let columns: ConcreteColumn[] = [];
  let slabs: ConcreteSlab[] = [];

  try {
    beams = generateBeams(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({ code: 'BEAM_GENERATION_ERROR', message });
  }

  try {
    columns = generateColumns(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({ code: 'COLUMN_GENERATION_ERROR', message });
  }

  try {
    slabs = generateSlabs(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({ code: 'SLAB_GENERATION_ERROR', message });
  }

  return { concreteBeams: beams, concreteColumns: columns, concreteSlabs: slabs, warnings, errors };
}

/**
 * 生成梁构件 — 仅截面估算，验算交由 Python gb50010 层。
 * 矩形梁: h = span / 10, b = h / 2
 * T形梁: 根据 GB/T 50010-2010 表 5.2.4 计算翼缘宽度
 */
export function generateBeams(input: ConcreteFrameInput): ConcreteBeam[] {
  const beams: ConcreteBeam[] = [];
  const { bayWidthsM, beamType = 'rectangular' } = input;

  const spanDepthRatioTarget = 10;

  for (let i = 0; i < bayWidthsM.length; i++) {
    const spanM = bayWidthsM[i]!;
    const spanMM = spanM * 1000;

    let heightMM = Math.round((spanMM / spanDepthRatioTarget) / 50) * 50;
    heightMM = Math.max(heightMM, 250);

    let widthMM = Math.round((heightMM / 2) / 25) * 25;
    widthMM = Math.max(widthMM, 200);

    if (beamType === 't-shaped') {
      const slabSpanDepthLimit = SPAN_DEPTH_RATIO_LIMITS[input.slabType ?? 'one-way'] ?? 30;
      const slabMinThicknessKey = `${input.slabType ?? 'one-way'}_${input.slabUsage ?? 'residential'}`;
      const slabMinThickness = MIN_THICKNESS_MAP[slabMinThicknessKey] ?? 60;
      const slabThickness = Math.max(
        Math.ceil((spanMM / slabSpanDepthLimit) / 10) * 10, slabMinThickness);
      const flangeThicknessMM_compression = Math.min(Math.round(heightMM / 6), slabThickness);
      const bw = widthMM;
      const isEdge = i === 0 || i === bayWidthsM.length - 1;
      const candidateL0 = Math.round(spanMM / (isEdge ? 6 : 3));
      const candidateHf = bw + (isEdge ? 5 : 12) * flangeThicknessMM_compression;
      const flangeWidthMM_compression = Math.min(candidateL0, candidateHf);

      beams.push({
        id: `B-${i + 1}`, type: 't-shaped', spanM,
        webWidthMM: bw, flangeWidthMM_compression, flangeThicknessMM_compression,
        supportEffectiveWidthMM: bw, totalHeightMM: heightMM,
        spanDepthRatio: spanMM / heightMM,
        meetsRequirement: (spanMM / heightMM) >= 8 && (spanMM / heightMM) <= 16,
      });
    } else {
      beams.push({
        id: `B-${i + 1}`, type: 'rectangular', spanM,
        widthMM, heightMM,
        spanDepthRatio: spanMM / heightMM,
        meetsRequirement: (spanMM / heightMM) >= 8 && (spanMM / heightMM) <= 16,
      });
    }
  }

  return beams;
}

/**
 * 生成柱构件 — 仅截面估算，验算交由 Python gb50010 层。
 * 估算公式: Ac ≥ N / (0.9 × fc)
 */
export function generateColumns(input: ConcreteFrameInput): ConcreteColumn[] {
  const columns: ConcreteColumn[] = [];
  const { storyCount, storyHeightsM, bayWidthsM, concreteGrade, axialLoadKN, columnType = 'rectangular' } = input;

  const concrete = getConcreteMaterial(concreteGrade);
  const fc = concrete.fc;
  const axialLoadRatioLimit = 0.9;

  const avgSpanM = bayWidthsM.reduce((a, b) => a + b, 0) / bayWidthsM.length;
  const baseLoadKN = axialLoadKN ?? (avgSpanM * avgSpanM * storyCount * DEFAULT_FLOOR_LOAD_KN_PER_M2);

  for (let story = 0; story < storyCount; story++) {
    const heightM = storyHeightsM[story] ?? 3.6;

    const storyN_N = (baseLoadKN * (storyCount - story) / storyCount) * 1000;
    const storyAc = storyN_N / (axialLoadRatioLimit * fc);

    if (columnType === 'circular') {
      let diameterMM = Math.ceil(Math.sqrt(4 * storyAc / Math.PI) / 50) * 50;
      diameterMM = Math.max(diameterMM, 500);
      const Ac_actual = Math.PI * (diameterMM / 2) ** 2;
      const axialLoadRatio = storyN_N / (fc * Ac_actual);

      columns.push({
        id: `C-S${story + 1}-1`, type: 'circular', heightM,
        diameterMM, axialLoadRatio: Math.round(axialLoadRatio * 100) / 100,
        meetsRequirement: axialLoadRatio <= axialLoadRatioLimit,
      });
    } else {
      const commonSizes = [500, 550, 600, 650, 700, 750, 800, 850, 900];
      let selectedSize = commonSizes[0]!;
      for (const size of commonSizes) {
        if (size * size >= storyAc) { selectedSize = size; break; }
      }
      if (selectedSize === commonSizes[0] && commonSizes[0]! ** 2 < storyAc) {
        selectedSize = Math.ceil(Math.sqrt(storyAc) / 50) * 50;
      }

      const Ac_actual = selectedSize * selectedSize;
      const axialLoadRatio = storyN_N / (fc * Ac_actual);

      columns.push({
        id: `C-S${story + 1}-1`, type: 'rectangular', heightM,
        widthMM: selectedSize, heightMM: selectedSize,
        axialLoadRatio: Math.round(axialLoadRatio * 100) / 100,
        meetsRequirement: axialLoadRatio <= axialLoadRatioLimit,
      });
    }
  }

  return columns;
}

/**
 * 生成板构件
 * 依据: GB/T 50010-2010 第 9.1.2 条
 * 跨厚比限值:
 *   单向板 ≤ 30
 *   双向板 ≤ 40
 *   无梁板（有柱帽） ≤ 35
 *   无梁板（无柱帽） ≤ 30
 *   悬臂板 ≤ 12
 */
export function generateSlabs(input: ConcreteFrameInput): ConcreteSlab[] {
  const slabs: ConcreteSlab[] = [];
  const {
    bayWidthsM,
    slabType = 'one-way',
    slabUsage = 'residential',
  } = input;

  const spanDepthRatioLimit = SPAN_DEPTH_RATIO_LIMITS[slabType] ?? 30;
  const minThicknessKey = `${slabType}_${slabUsage}`;
  const minThickness = MIN_THICKNESS_MAP[minThicknessKey] ?? 60;

  for (let i = 0; i < bayWidthsM.length; i++) {
    const spanM = bayWidthsM[i]!;
    const spanMM = spanM * 1000;

    // 计算板厚: t = max(span / 跨厚比, 最小厚度)，向上取整保证跨厚比不超限
    let thicknessMM = Math.ceil((spanMM / spanDepthRatioLimit) / 10) * 10; // 向上取整到10mm
    thicknessMM = Math.max(thicknessMM, minThickness);

    // 验算跨厚比
    const actualSpanDepthRatio = spanMM / thicknessMM;
    const meetsRequirement = actualSpanDepthRatio <= spanDepthRatioLimit;

    slabs.push({
      id: `SL-${i + 1}`,
      type: slabType,
      spanXM: spanM,
      spanYM: spanM, // 假设板为方形区格
      thicknessMM: thicknessMM,
      usage: slabUsage,
      spanDepthRatio: Math.round(actualSpanDepthRatio * 10) / 10,
      meetsRequirement,
    });
  }

  return slabs;
}

export const handler: SkillHandler = {
  detectStructuralType(input) {
    return detectConcreteFrameStructuralType(input);
  },

  parseProvidedValues(values) {
    const base = coerceConcreteFrameDimension(
      toConcreteFramePatch(normalizeLegacyDraftPatch(values)),
      undefined,
    );
    return {
      ...base,
      // M1: Separate concrete and rebar grade
      ...(typeof values.frameConcreteGrade === 'string' && { frameConcreteGrade: normalizeConcreteGrade(values.frameConcreteGrade) }),
      ...(typeof values.frameRebarGrade === 'string' && { frameRebarGrade: normalizeConcreteGrade(values.frameRebarGrade) }),
      ...(typeof values.frameColumnSection === 'string' && { frameColumnSection: normalizeSectionName(values.frameColumnSection) }),
      ...(typeof values.frameBeamSection === 'string' && { frameBeamSection: normalizeSectionName(values.frameBeamSection) }),
    };
  },

  extractDraft({ llmDraftPatch, currentState }) {
    return buildConcreteFrameDraftPatch(llmDraftPatch, currentState);
  },

  mergeState(existing, patch) {
    return mergeConcreteFrameState(existing, patch);
  },

  computeMissing(state, phase) {
    return computeConcreteFrameMissing(state, phase);
  },

  mapLabels(keys, locale) {
    return mapConcreteFrameLabels(keys, locale);
  },

  buildQuestions(keys, criticalMissing, state, locale) {
    return buildConcreteFrameQuestions(keys, criticalMissing, state, locale);
  },

  buildDefaultProposals(keys, state, locale) {
    return buildConcreteFrameDefaultProposals(keys, state, locale);
  },

  buildReportNarrative(input) {
    return buildConcreteFrameReportNarrative(input);
  },

  buildModel(state) {
    try {
      const concreteGrade = (typeof state.frameConcreteGrade === 'string' && isValidConcreteGrade(state.frameConcreteGrade))
        ? state.frameConcreteGrade : 'C30';
      const rebarGrade = (typeof state.frameRebarGrade === 'string' && isValidConcreteGrade(state.frameRebarGrade))
        ? state.frameRebarGrade : 'HRB400';

      const memberInput: ConcreteFrameInput = {
        storyCount: state.storyCount as number,
        bayCount: state.bayCount as number,
        storyHeightsM: state.storyHeightsM as number[],
        bayWidthsM: state.bayWidthsM as number[],
        concreteGrade,
        rebarGrade,
        beamType: (state.beamType as ConcreteFrameInput['beamType']) ?? 'rectangular',
        columnType: (state.columnType as ConcreteFrameInput['columnType']) ?? 'rectangular',
        slabType: (state.slabType as ConcreteFrameInput['slabType']) ?? 'one-way',
        slabUsage: (state.slabUsage as ConcreteFrameInput['slabUsage']) ?? 'residential',
        axialLoadKN: state.axialLoadKN as number | undefined,
      };

      const memberResults = generateMembers(memberInput);
      return buildConcreteFrameModel(state, memberResults);
    } catch (error) {
      console.error('buildConcreteFrameModel failed:', error);
      return undefined;
    }
  },

  resolveStage(missingKeys) {
    return resolveConcreteFrameStage(missingKeys);
  },
};

export default handler;
