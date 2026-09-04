import type { DraftState } from '../../../agent-runtime/types.js';

/** Resolved design data for one composite beam (steel profile + concrete flange + studs). */
export interface CompositeBeamDesign {
  id: string;
  spanM: number;
  steelSection: string;
  slabThicknessMm: number;
  effectiveSlabWidthMm: number;
  modularRatio: number;
  transformedAreaMm2: number;
  transformedCentroidFromSlabTopMm: number;
  transformedInertiaMm4: number;
  lowerSectionModulusMm3: number;
  compressionForceKN: number;
  pnaDepthMm: number;
  pnaInSteel: boolean;
  flexuralCapacityKNM: number;
  studDiameterMm: number;
  studCapacityKN: number;
  studsPerHalfSpan: number;
  studRows: number;
  studPitchMm: number;
  fullShearConnection: boolean;
}

/** Resolved design data for one steel column line. */
export interface CompositeColumnDesign {
  id: string;
  steelSection: string;
  storyCount: number;
}

/** Design-level composite layout derived from the draft state. */
export interface CompositeDesignSummary {
  spanM: number;
  slabThicknessMm: number;
  slabWidthSource: 'provided' | 'derived';
  effectiveSlabWidthMm: number;
  steelGrade: string;
  concreteGrade: string;
  beams: CompositeBeamDesign[];
  columns: CompositeColumnDesign[];
  verificationNote: { zh: string; en: string };
}

/** Extended draft state carrying composite-specific fields. */
export interface CompositeDraftState extends DraftState {
  compositeSlabThicknessMm?: number;
  compositeSlabWidthM?: number;
  compositeSteelBeamSection?: string;
  compositeSteelColumnSection?: string;
  compositeSteelGrade?: string;
  compositeConcreteGrade?: string;
  compositeStudDiameterMm?: number;
}
