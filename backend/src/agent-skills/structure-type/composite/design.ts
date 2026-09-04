import {
  DEFAULT_CONCRETE_GRADE,
  DEFAULT_STEEL_GRADE,
  DEFAULT_STUD_DIAMETER_MM,
  DEFAULT_STUD_ROWS,
  EFFECTIVE_WIDTH_ROUND_MM,
  EFFECTIVE_WIDTH_SLAB_FACTOR,
  EFFECTIVE_WIDTH_SPAN_FACTOR,
  STUD_PITCH_MAX_MM,
  STUD_PITCH_MIN_DIAMETER_FACTOR,
  STUD_PITCH_ROUND_MM,
  STUD_TENSILE_STRENGTH_NMM2,
} from './constants.js';
import type {
  CompositeBeamDesign,
  CompositeColumnDesign,
  CompositeDesignSummary,
} from './types.js';

export interface SteelGradeMaterial {
  grade: string;
  fy: number;
  Es: number;
}

/** Structural steel grades (N/mm²) — GB/T 700 / GB/T 1591 (yield strength). */
const STEEL_GRADES: Record<string, SteelGradeMaterial> = {
  Q235: { grade: 'Q235', fy: 235, Es: 206000 },
  Q345: { grade: 'Q345', fy: 345, Es: 206000 },
  Q355: { grade: 'Q355', fy: 355, Es: 206000 },
  Q390: { grade: 'Q390', fy: 390, Es: 206000 },
  Q420: { grade: 'Q420', fy: 420, Es: 206000 },
};

export interface ConcreteGradeMaterial {
  grade: string;
  fc: number;
  Ec: number;
}

/** Concrete design values (N/mm²) — GB/T 50010 table 4.1.4 (subset for flanges). */
const CONCRETE_GRADES: Record<string, ConcreteGradeMaterial> = {
  C25: { grade: 'C25', fc: 11.9, Ec: 28000 },
  C30: { grade: 'C30', fc: 14.3, Ec: 30000 },
  C35: { grade: 'C35', fc: 16.7, Ec: 31500 },
  C40: { grade: 'C40', fc: 19.1, Ec: 32500 },
  C45: { grade: 'C45', fc: 21.1, Ec: 33500 },
  C50: { grade: 'C50', fc: 23.1, Ec: 34500 },
  C55: { grade: 'C55', fc: 25.3, Ec: 35500 },
  C60: { grade: 'C60', fc: 27.5, Ec: 36000 },
};

export interface HShape {
  kind: 'H';
  H: number;
  B: number;
  tw: number;
  tf: number;
}

export interface SteelSection {
  name: string;
  shape: HShape;
  /** Area in mm², inertias in mm⁴. */
  A: number;
  Iy: number;
  Iz: number;
  J: number;
  standardSteelName: string;
  /** Set when the requested designation was substituted with a library/default profile. */
  substituted?: string;
}

type SectionRole = 'beam' | 'column';

/** GB/T 11263 H-profile subset (areas in mm², inertias in mm⁴). */
const H_SECTION_LIBRARY: Record<string, Omit<SteelSection, 'name'> | undefined> = {
  HN300X150: { shape: { kind: 'H', H: 300, B: 150, tw: 6.5, tf: 9 }, A: 4870, Iy: 7.21e7, Iz: 5.08e6, J: 5.18e5, standardSteelName: 'HN300x150' },
  HN350X175: { shape: { kind: 'H', H: 350, B: 175, tw: 7, tf: 11 }, A: 6290, Iy: 1.36e8, Iz: 9.84e6, J: 6.32e5, standardSteelName: 'HN350x175' },
  HN400X200: { shape: { kind: 'H', H: 400, B: 200, tw: 8, tf: 13 }, A: 8420, Iy: 2.37e8, Iz: 1.74e7, J: 8.44e5, standardSteelName: 'HN400x200' },
  HN450X200: { shape: { kind: 'H', H: 450, B: 200, tw: 9, tf: 14 }, A: 9610, Iy: 3.32e8, Iz: 1.87e7, J: 9.68e5, standardSteelName: 'HN450x200' },
  HN500X200: { shape: { kind: 'H', H: 500, B: 200, tw: 10, tf: 16 }, A: 11430, Iy: 5.02e8, Iz: 2.14e7, J: 1.24e6, standardSteelName: 'HN500x200' },
  HN600X200: { shape: { kind: 'H', H: 600, B: 200, tw: 11, tf: 17 }, A: 13410, Iy: 9.06e8, Iz: 2.27e7, J: 1.48e6, standardSteelName: 'HN600x200' },
  HW250X250: { shape: { kind: 'H', H: 250, B: 250, tw: 9, tf: 14 }, A: 9200, Iy: 1.07e8, Iz: 3.65e7, J: 2.9e6, standardSteelName: 'HW250x250' },
  HW300X300: { shape: { kind: 'H', H: 300, B: 300, tw: 10, tf: 15 }, A: 11920, Iy: 2.04e8, Iz: 6.75e7, J: 4.23e6, standardSteelName: 'HW300x300' },
  HW350X350: { shape: { kind: 'H', H: 350, B: 350, tw: 12, tf: 19 }, A: 17390, Iy: 4.03e8, Iz: 1.36e8, J: 8.63e6, standardSteelName: 'HW350x350' },
  HW400X400: { shape: { kind: 'H', H: 400, B: 400, tw: 13, tf: 21 }, A: 19720, Iy: 6.67e8, Iz: 2.24e8, J: 1.01e7, standardSteelName: 'HW400x400' },
};

const DEFAULT_BEAM_SECTIONS: Record<string, string> = { small: 'HN350X175', medium: 'HN400X200', large: 'HN500X200' };
const DEFAULT_COLUMN_SECTIONS: Record<string, string> = { small: 'HW300X300', medium: 'HW350X350', large: 'HW400X400' };

export function isValidSteelGrade(grade: string): boolean {
  return grade.toUpperCase() in STEEL_GRADES;
}

export function isValidConcreteGrade(grade: string): boolean {
  return grade.toUpperCase() in CONCRETE_GRADES;
}

export function normalizeSteelGrade(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeConcreteGrade(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeSectionName(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '').replace(/[×x*]/g, 'X');
}

export function resolveSteelMaterial(grade: string | undefined): SteelGradeMaterial {
  const normalized = grade && isValidSteelGrade(grade) ? normalizeSteelGrade(grade) : DEFAULT_STEEL_GRADE;
  return STEEL_GRADES[normalized]!;
}

export function resolveConcreteMaterial(grade: string | undefined): ConcreteGradeMaterial {
  const normalized = grade && isValidConcreteGrade(grade) ? normalizeConcreteGrade(grade) : DEFAULT_CONCRETE_GRADE;
  return CONCRETE_GRADES[normalized]!;
}

export function getDefaultCompositeBeamSection(storyCount: number): string {
  if (storyCount > 10) return DEFAULT_BEAM_SECTIONS.large!;
  if (storyCount > 5) return DEFAULT_BEAM_SECTIONS.medium!;
  return DEFAULT_BEAM_SECTIONS.small!;
}

export function getDefaultCompositeColumnSection(storyCount: string | number | undefined): string {
  const count = typeof storyCount === 'number' ? storyCount : 0;
  if (count > 10) return DEFAULT_COLUMN_SECTIONS.large!;
  if (count > 5) return DEFAULT_COLUMN_SECTIONS.medium!;
  return DEFAULT_COLUMN_SECTIONS.small!;
}

function computeCustomHSection(shape: HShape): Pick<SteelSection, 'A' | 'Iy' | 'Iz' | 'J'> {
  const { H, B, tw, tf } = shape;
  const hw = H - 2 * tf;
  const A = tw * hw + 2 * B * tf;
  const Iy = (tw * hw ** 3) / 12 + (2 * B * tf ** 3) / 12 + 2 * B * tf * ((hw + tf) / 2) ** 2;
  const Iz = (2 * tf * B ** 3) / 12 + (hw * tw ** 3) / 12;
  const J = (2 * B * tf ** 3 + hw * tw ** 3) / 3;
  return { A, Iy, Iz, J };
}

/** Resolve a steel profile designation against the library, custom `H...` input, or the role default. */
export function resolveSteelSection(
  section: string | undefined,
  role: SectionRole,
  storyCount: number,
): SteelSection {
  const defaultSection = role === 'beam'
    ? getDefaultCompositeBeamSection(storyCount)
    : getDefaultCompositeColumnSection(storyCount);
  const normalized = section ? normalizeSectionName(section) : defaultSection;
  const libraryEntry = H_SECTION_LIBRARY[normalized];
  if (libraryEntry) {
    return { name: normalized, ...libraryEntry };
  }
  const customMatch = normalized.match(/^H(\d+)X(\d+)X([\d.]+)X([\d.]+)$/);
  if (customMatch) {
    const shape: HShape = {
      kind: 'H',
      H: Number.parseFloat(customMatch[1]!),
      B: Number.parseFloat(customMatch[2]!),
      tw: Number.parseFloat(customMatch[3]!),
      tf: Number.parseFloat(customMatch[4]!),
    };
    if ([shape.H, shape.B, shape.tw, shape.tf].every((value) => Number.isFinite(value) && value > 0)) {
      const computed = computeCustomHSection(shape);
      const name = `H${shape.H}X${shape.B}X${shape.tw}X${shape.tf}`;
      return { name, shape, ...computed, standardSteelName: name };
    }
  }
  const fallback = H_SECTION_LIBRARY[defaultSection]!;
  return {
    name: defaultSection,
    ...fallback,
    substituted: `${normalized} not in builtin library and not parseable, substituted with ${defaultSection}`,
  };
}

/**
 * Effective flange width — GB 50017-2017 chapter 14 practice:
 * `be = b0 + 2·min(L/6, 6·hc)`, capped by the provided slab width and rounded up to 50 mm.
 */
export function computeEffectiveSlabWidthMm(options: {
  spanM: number;
  steelTopWidthMm: number;
  slabThicknessMm: number;
  slabWidthM?: number;
}): { widthMm: number; source: 'provided' | 'derived' } {
  const { spanM, steelTopWidthMm, slabThicknessMm, slabWidthM } = options;
  const spanMm = spanM * 1000;
  const derived = steelTopWidthMm
    + 2 * Math.min(spanMm / EFFECTIVE_WIDTH_SPAN_FACTOR, EFFECTIVE_WIDTH_SLAB_FACTOR * slabThicknessMm);
  const capped = slabWidthM !== undefined
    ? Math.min(derived, slabWidthM * 1000)
    : derived;
  return {
    widthMm: Math.ceil(capped / EFFECTIVE_WIDTH_ROUND_MM) * EFFECTIVE_WIDTH_ROUND_MM,
    source: slabWidthM !== undefined ? 'provided' : 'derived',
  };
}

export interface TransformedSectionResult {
  modularRatio: number;
  transformedAreaMm2: number;
  transformedCentroidFromSlabTopMm: number;
  transformedInertiaMm4: number;
  lowerSectionModulusMm3: number;
}

/**
 * Elastic transformed section (modular-ratio method) for one composite beam:
 * the steel area is transformed into equivalent concrete (`As/n`).
 */
export function computeTransformedSection(options: {
  steel: SteelSection;
  slabThicknessMm: number;
  effectiveSlabWidthMm: number;
  steelGrade: string | undefined;
  concreteGrade: string | undefined;
}): TransformedSectionResult {
  const { steel, slabThicknessMm, effectiveSlabWidthMm, steelGrade, concreteGrade } = options;
  const steelMaterial = resolveSteelMaterial(steelGrade);
  const concreteMaterial = resolveConcreteMaterial(concreteGrade);
  const modularRatio = steelMaterial.Es / concreteMaterial.Ec;

  const slabArea = effectiveSlabWidthMm * slabThicknessMm;
  const steelTransformed = steel.A / modularRatio;
  const slabCentroid = slabThicknessMm / 2;
  const steelCentroid = slabThicknessMm + steel.shape.H / 2;
  const transformedArea = slabArea + steelTransformed;
  const centroid = (slabArea * slabCentroid + steelTransformed * steelCentroid) / transformedArea;

  const slabInertia = (effectiveSlabWidthMm * slabThicknessMm ** 3) / 12;
  const transformedInertia = slabInertia + slabArea * (centroid - slabCentroid) ** 2
    + steel.Iy / modularRatio + steelTransformed * (centroid - steelCentroid) ** 2;
  const lowerFiber = slabThicknessMm + steel.shape.H - centroid;

  return {
    modularRatio: Math.round(modularRatio * 100) / 100,
    transformedAreaMm2: transformedArea,
    transformedCentroidFromSlabTopMm: centroid,
    transformedInertiaMm4: transformedInertia,
    lowerSectionModulusMm3: transformedInertia / lowerFiber,
  };
}

/** Single-stud capacity `Nv = min(0.43·As·√(Ec·fc), 0.7·As·fu)` in kN. */
export function computeStudCapacityKN(options: {
  studDiameterMm: number;
  concreteGrade: string | undefined;
}): number {
  const { studDiameterMm, concreteGrade } = options;
  const concrete = resolveConcreteMaterial(concreteGrade);
  const shankAreaMm2 = (Math.PI * studDiameterMm ** 2) / 4;
  const concreteGovernedN = 0.43 * shankAreaMm2 * Math.sqrt(concrete.Ec * concrete.fc);
  const steelGovernedN = 0.7 * shankAreaMm2 * STUD_TENSILE_STRENGTH_NMM2;
  return Math.min(concreteGovernedN, steelGovernedN) / 1000;
}

/** Snap a stud pitch onto the 10 mm grid within the 3·d–600 mm constructible band. */
function clampPitch(pitchMm: number, studDiameterMm: number): number {
  const min = STUD_PITCH_MIN_DIAMETER_FACTOR * studDiameterMm;
  const clamped = Math.min(Math.max(pitchMm, min), STUD_PITCH_MAX_MM);
  // Flooring the grid can undercut the minimum, so re-apply it afterwards.
  return Math.max(Math.floor(clamped / STUD_PITCH_ROUND_MM) * STUD_PITCH_ROUND_MM, min);
}

/** Design one composite beam: effective flange, transformed section, plastic moment, and stud layout. */
export function designCompositeBeam(options: {
  id: string;
  spanM: number;
  steelSection?: string;
  slabThicknessMm: number;
  slabWidthM?: number;
  steelGrade?: string;
  concreteGrade?: string;
  studDiameterMm?: number;
  storyCount?: number;
}): CompositeBeamDesign {
  const {
    id,
    spanM,
    steelSection,
    slabThicknessMm,
    slabWidthM,
    steelGrade,
    concreteGrade,
    studDiameterMm = DEFAULT_STUD_DIAMETER_MM,
    storyCount = 1,
  } = options;
  const steel = resolveSteelSection(steelSection, 'beam', storyCount);
  const steelMaterial = resolveSteelMaterial(steelGrade);
  const concrete = resolveConcreteMaterial(concreteGrade);
  const { widthMm: effectiveSlabWidthMm } = computeEffectiveSlabWidthMm({
    spanM,
    steelTopWidthMm: steel.shape.B,
    slabThicknessMm,
    slabWidthM,
  });
  const transformed = computeTransformedSection({
    steel,
    slabThicknessMm,
    effectiveSlabWidthMm,
    steelGrade,
    concreteGrade,
  });

  // Full-shear-connection plastic axial force and plastic neutral axis position.
  const steelForceN = steel.A * steelMaterial.fy;
  const slabForceN = effectiveSlabWidthMm * slabThicknessMm * concrete.fc;
  const compressionForceN = Math.min(steelForceN, slabForceN);
  const pnaDepthMm = compressionForceN / (effectiveSlabWidthMm * concrete.fc);
  // When the steel force exceeds the flange capacity the PNA descends into the
  // steel; the lever arm then spans the steel centroid to the slab centroid.
  const pnaInSteel = steelForceN > slabForceN;
  const leverArmMm = pnaInSteel
    ? steel.shape.H / 2 + slabThicknessMm / 2
    : steel.shape.H / 2 + slabThicknessMm - pnaDepthMm / 2;
  const flexuralCapacityKNM = (compressionForceN * leverArmMm) / 1e6;

  // Stud layout: `n` studs per half span provide the full shear connection force.
  const studCapacityKN = computeStudCapacityKN({ studDiameterMm, concreteGrade });
  const studsPerHalfSpan = Math.ceil(compressionForceN / (studCapacityKN * 1000));
  const studsPerRow = Math.ceil(studsPerHalfSpan / DEFAULT_STUD_ROWS);
  const pitchMm = clampPitch((spanM * 1000) / 2 / studsPerRow, studDiameterMm);
  const studsProvidedPerRow = Math.floor((spanM * 1000) / 2 / pitchMm);
  const fullShearConnection = studsProvidedPerRow * DEFAULT_STUD_ROWS >= studsPerHalfSpan;

  return {
    id,
    spanM,
    steelSection: steel.name,
    slabThicknessMm,
    effectiveSlabWidthMm,
    modularRatio: transformed.modularRatio,
    transformedAreaMm2: transformed.transformedAreaMm2,
    transformedCentroidFromSlabTopMm: transformed.transformedCentroidFromSlabTopMm,
    transformedInertiaMm4: transformed.transformedInertiaMm4,
    lowerSectionModulusMm3: transformed.lowerSectionModulusMm3,
    compressionForceKN: Math.round(compressionForceN) / 1000,
    pnaDepthMm: Math.round(pnaDepthMm * 10) / 10,
    pnaInSteel,
    flexuralCapacityKNM: Math.round(flexuralCapacityKNM * 10) / 10,
    studDiameterMm,
    studCapacityKN: Math.round(studCapacityKN * 10) / 10,
    studsPerHalfSpan,
    studRows: DEFAULT_STUD_ROWS,
    studPitchMm: pitchMm,
    fullShearConnection,
  };
}

/** Build the composite design summary for the whole draft (one beam per bay, one column design per grid). */
export function buildCompositeDesignSummary(options: {
  bayWidthsM: number[];
  storyCount: number;
  slabThicknessMm: number;
  slabWidthM?: number;
  steelBeamSection?: string;
  steelColumnSection?: string;
  steelGrade?: string;
  concreteGrade?: string;
  studDiameterMm?: number;
}): CompositeDesignSummary {
  const {
    bayWidthsM,
    storyCount,
    slabThicknessMm,
    slabWidthM,
    steelBeamSection,
    steelColumnSection,
    steelGrade,
    concreteGrade,
    studDiameterMm,
  } = options;
  const beams = bayWidthsM.map((spanM, index) => designCompositeBeam({
    id: `CB-${index + 1}`,
    spanM,
    steelSection: steelBeamSection,
    slabThicknessMm,
    slabWidthM,
    steelGrade,
    concreteGrade,
    studDiameterMm,
    storyCount,
  }));
  const columnSteel = resolveSteelSection(steelColumnSection, 'column', storyCount);
  const columns: CompositeColumnDesign[] = [{
    id: 'CC-1',
    steelSection: columnSteel.name,
    storyCount,
  }];

  const firstBeam = beams[0];
  const governing = beams.find((beam) => !beam.pnaInSteel) ?? firstBeam;
  return {
    spanM: bayWidthsM.length ? Math.max(...bayWidthsM) : 0,
    slabThicknessMm,
    slabWidthSource: slabWidthM !== undefined ? 'provided' : 'derived',
    effectiveSlabWidthMm: firstBeam?.effectiveSlabWidthMm ?? 0,
    steelGrade: resolveSteelMaterial(steelGrade).grade,
    concreteGrade: resolveConcreteMaterial(concreteGrade).grade,
    beams,
    columns,
    verificationNote: {
      zh: '组合梁截面与栓钉布置按 GB 50017-2017 第14章组合梁条文估算，构件强度/稳定/挠度验算由 GB 50017 校核流程复核。'
        + (governing?.pnaInSteel ? '当前混凝土翼缘不足以覆盖钢梁全截面塑性抗力（中和轴位于钢梁内），建议加厚或加宽翼缘后复核。' : ''),
      en: 'Composite sections and stud layouts are estimated per the GB 50017-2017 chapter 14 composite beam provisions; member strength/stability/deflection verification is delegated to the GB 50017 code-check flow.'
        + (governing?.pnaInSteel ? ' The concrete flange cannot cover the full steel plastic axial force (the plastic neutral axis falls inside the steel); thicken or widen the flange and re-check.' : ''),
    },
  };
}
