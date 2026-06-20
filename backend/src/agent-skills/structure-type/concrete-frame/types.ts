import type { DraftExtraction, DraftState } from '../../../agent-runtime/types.js';

export interface ConcreteFramePatchSources {
  existingState?: DraftState;
  supplementalPatch?: DraftExtraction | null;
  llmPatch?: DraftExtraction | null;
}

// ============================================================================
// 构件生成器接口
// ============================================================================

/**
 * 混凝土框架技能输入接口
 * 用于接收用户提供的混凝土框架结构参数
 */
export interface ConcreteFrameInput {
  // 结构体系
  structureSystem?: 'moment-frame' | 'frame-shear-wall' | 'shear-wall'; // 默认: moment-frame

  // 几何参数
  storyCount: number; // 层数（必填）
  bayCount: number; // 跨数（必填）
  storyHeightsM: number[]; // 每层层高(m)
  bayWidthsM: number[]; // 每跨跨度(m)

  // 抗震设计
  seismicGrade?: '一级' | '二级' | '三级' | '四级'; // 默认: 四级

  // 材料等级
  concreteGrade: string; // 混凝土等级 (C20-C80)
  rebarGrade: string; // 钢筋等级 (HRB400, HRB500)

  // 板设计参数
  slabType?: 'one-way' | 'two-way' | 'flat-slab' | 'waffle'; // 板类型
  slabUsage?: 'roof' | 'residential' | 'commercial' | 'vehicle'; // 板用途

  // 梁设计参数
  beamType?: 'rectangular' | 't-shaped'; // 梁类型

  // 柱设计参数
  columnType?: 'rectangular' | 'circular'; // 柱类型，默认: rectangular

  // 荷载信息（用于柱截面估算）
  axialLoadKN?: number; // 估算轴力(kN)
  floorLoadKNm2?: number; // 楼面均布荷载设计值 (kN/m², 默认 10)
  tributaryWidthM?: number; // 梁从属宽度 (m, 默认 3)

  // 柱内力参数 — 可选, 未提供时自动估算
  columnMomentKNm?: number; // 柱端设计弯矩 (kN·m, 默认按 2% 偏心率估算)
  columnShearKN?: number; // 柱端设计剪力 (kN, 默认按 0.2N 估算)
  columnLambda?: number; // 剪跨比 λ = M/(Vh0), 1~3 (默认 2.5)
}

/**
 * 混凝土梁构件
 *
 * T形截面符号 (GB/T 50010-2010):
 *   bf' / hf' — 受压区翼缘宽度/厚度（带撇，跨中正弯矩区有效）
 *   bf       — 受拉区翼缘宽度（不带撇，正T底面无翼缘 → bf = b）
 *   b        — 腹板宽度
 *   h        — 截面总高
 *
 * 命名约定: 与 model.ts 一致，用 _compression / _tension 后缀代替规范中的撇号。
 */
export interface ConcreteBeam {
  id: string;
  type: 'rectangular' | 't-shaped';
  spanM: number;
  widthMM?: number;
  heightMM?: number;
  webWidthMM?: number;
  flangeWidthMM_compression?: number;
  flangeThicknessMM_compression?: number;
  supportEffectiveWidthMM?: number;
  totalHeightMM?: number;
  spanDepthRatio?: number;
  meetsRequirement?: boolean;
}

export interface ConcreteColumn {
  id: string;
  type: 'rectangular' | 'circular';
  heightM: number;
  widthMM?: number;
  heightMM?: number;
  diameterMM?: number;
  axialLoadRatio?: number;
  meetsRequirement?: boolean;
}

export interface ConcreteSlab {
  id: string;
  type: 'one-way' | 'two-way' | 'flat-slab' | 'waffle';
  spanXM?: number;
  spanYM?: number;
  thicknessMM: number;
  usage: string;
  spanDepthRatio?: number;
  meetsRequirement?: boolean;
}

/**
 * 混凝土框架技能输出接口
 */
export interface ConcreteFrameOutput {
  concreteBeams: ConcreteBeam[];
  concreteColumns: ConcreteColumn[];
  concreteSlabs: ConcreteSlab[];
  warnings?: Array<{ code: string; message: string }>;
  errors?: Array<{ code: string; message: string }>;
}

/**
 * 混凝土框架特有状态接口
 */
export interface ConcreteFrameDraftState extends DraftState {
  concreteBeams?: ConcreteBeam[];
  concreteColumns?: ConcreteColumn[];
  concreteSlabs?: ConcreteSlab[];
  structureSystem?: 'moment-frame' | 'frame-shear-wall' | 'shear-wall';
  seismicGrade?: string;
  slabType?: 'one-way' | 'two-way' | 'flat-slab' | 'waffle';
  beamType?: 'rectangular' | 't-shaped';
}
