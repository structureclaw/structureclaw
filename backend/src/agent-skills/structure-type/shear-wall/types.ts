import type { DraftState } from '../../../agent-runtime/types.js';

/** Opening on a wall line, measured along the wall (m). */
export interface WallOpeningSpec {
  /** Horizontal offset from the wall start (m). Derived when omitted. */
  xM?: number;
  widthM: number;
  heightM: number;
  /** Sill height above the story floor (m). Default 0. */
  sillM?: number;
}

/** Design-level wall layout derived from the draft state. */
export interface WallPierDesign {
  id: string;
  lengthM: number;
  thicknessMm: number;
}

export interface CouplingBeamDesign {
  id: string;
  spanM: number;
  heightMm: number;
  spanDepthRatio: number;
  meetsRequirement: boolean;
}

/** Seismic grade: 1 (一级) is the most critical, 4 (四级) the least. */
export type SeismicGradeValue = 1 | 2 | 3 | 4;

export interface WallStoryDesign {
  story: number;
  storyId: string;
  storyHeightM: number;
  thicknessMm: number;
  isBottomStrengthenedZone: boolean;
}

export interface ShearWallDesignSummary {
  wallLengthM: number;
  seismicGrade: SeismicGradeValue | undefined;
  seismicGradeLabel: string;
  bottomStrengthenedStoryCount: number;
  stories: WallStoryDesign[];
  piers: WallPierDesign[];
  couplingBeams: CouplingBeamDesign[];
  /** Openings with resolved x offsets, sorted along the wall. */
  openings: Array<WallOpeningSpec & { xM: number }>;
  openingAreaRatio: number;
  distributedReinforcementRatio: number;
  boundaryElementNote: { zh: string; en: string };
}

/** Extended draft state carrying shear-wall specific fields. */
export interface ShearWallDraftState extends DraftState {
  wallLengthM?: number;
  wallThicknessMm?: number;
  wallConcreteGrade?: string;
  wallRebarGrade?: string;
  seismicGrade?: string;
  wallOpenings?: WallOpeningSpec[];
}
