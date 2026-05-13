// Concrete frame material and section definitions
// This module provides material properties for concrete and rebar grades,
// rectangular cross-section parsing, and helper functions for concrete frame analysis.

interface ConcreteMaterial {
  grade: string;   // 如 "C30"
  fck: number;     // 抗压强度标准值 N/mm²
  ftk: number;     // 抗拉强度标准值 N/mm²
  fc: number;      // 抗压强度设计值 N/mm²
  ft: number;      // 抗拉强度设计值 N/mm²
  Ec: number;      // 弹性模量 N/mm²
  ecu: number;     // 极限压应变
  alpha1: number;  // 等效矩形应力图系数
  beta1: number;   // 等效矩形应力图系数
}

interface RebarMaterial {
  grade: string;   // "HRB400"
  fyk: number;     // 屈服强度标准值(N/mm²)
  fstk: number;    // 极限强度标准值(N/mm²)
  fy: number;      // 抗拉强度设计值(N/mm²)
  fy_compression: number; // 抗压强度设计值(N/mm²)
  fyv: number;     // 抗剪强度设计值(N/mm²)
  Es: number;      // 弹性模量(N/mm²)
}

type RectangularSectionShape = { kind: 'rectangular'; B: number; H: number };

// Concrete grades data - strictly according to provided table
const CONCRETE_GRADES: Record<string, ConcreteMaterial> = {
  C20: { grade: 'C20', fck: 13.4, ftk: 1.54, fc: 9.6, ft: 1.10, Ec: 25500, ecu: 0.0033, alpha1: 1.00, beta1: 0.80 },
  C25: { grade: 'C25', fck: 16.7, ftk: 1.78, fc: 11.9, ft: 1.27, Ec: 28000, ecu: 0.0033, alpha1: 1.00, beta1: 0.80 },
  C30: { grade: 'C30', fck: 20.1, ftk: 2.01, fc: 14.3, ft: 1.43, Ec: 30000, ecu: 0.0033, alpha1: 1.00, beta1: 0.80 },
  C35: { grade: 'C35', fck: 23.4, ftk: 2.20, fc: 16.7, ft: 1.57, Ec: 31500, ecu: 0.0033, alpha1: 1.00, beta1: 0.80 },
  C40: { grade: 'C40', fck: 26.8, ftk: 2.39, fc: 19.1, ft: 1.71, Ec: 32500, ecu: 0.0033, alpha1: 1.00, beta1: 0.80 },
  C45: { grade: 'C45', fck: 29.6, ftk: 2.51, fc: 21.1, ft: 1.80, Ec: 33500, ecu: 0.0033, alpha1: 1.00, beta1: 0.80 },
  C50: { grade: 'C50', fck: 32.4, ftk: 2.64, fc: 23.1, ft: 1.89, Ec: 34500, ecu: 0.0033, alpha1: 1.00, beta1: 0.80 },
  C55: { grade: 'C55', fck: 35.5, ftk: 2.74, fc: 25.3, ft: 1.96, Ec: 35500, ecu: 0.0033, alpha1: 0.99, beta1: 0.79 },
  C60: { grade: 'C60', fck: 38.5, ftk: 2.85, fc: 27.5, ft: 2.04, Ec: 36000, ecu: 0.0033, alpha1: 0.98, beta1: 0.78 },
  C65: { grade: 'C65', fck: 41.5, ftk: 2.93, fc: 29.7, ft: 2.09, Ec: 36500, ecu: 0.0033, alpha1: 0.97, beta1: 0.77 },
  C70: { grade: 'C70', fck: 44.5, ftk: 2.99, fc: 31.8, ft: 2.14, Ec: 37000, ecu: 0.0033, alpha1: 0.96, beta1: 0.76 },
  C75: { grade: 'C75', fck: 47.4, ftk: 3.05, fc: 33.8, ft: 2.18, Ec: 37500, ecu: 0.0033, alpha1: 0.95, beta1: 0.75 },
  C80: { grade: 'C80', fck: 50.2, ftk: 3.11, fc: 35.9, ft: 2.22, Ec: 38000, ecu: 0.0033, alpha1: 0.94, beta1: 0.74 },
};

// Rebar grades data - strictly according to provided table
const REBAR_GRADES: Record<string, RebarMaterial> = {
  HPB300: { grade: 'HPB300', fyk: 300, fstk: 420, fy: 270, fy_compression: 270, fyv: 270, Es: 210000 },
  HRB400: { grade: 'HRB400', fyk: 400, fstk: 540, fy: 360, fy_compression: 360, fyv: 360, Es: 200000 },
  HRBF400: { grade: 'HRBF400', fyk: 400, fstk: 540, fy: 360, fy_compression: 360, fyv: 360, Es: 200000 },
  RRB400: { grade: 'RRB400', fyk: 400, fstk: 540, fy: 360, fy_compression: 360, fyv: 360, Es: 200000 },
  HRB500: { grade: 'HRB500', fyk: 500, fstk: 630, fy: 435, fy_compression: 400, fyv: 360, Es: 200000 },
  HRBF500: { grade: 'HRBF500', fyk: 500, fstk: 630, fy: 435, fy_compression: 400, fyv: 360, Es: 200000 },
};

// Rebar diameters
const REBAR_DIAMETERS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32];

/**
 * Get concrete material properties by grade.
 * @param grade Concrete grade string (e.g., "C30")
 * @returns ConcreteMaterial object
 * @throws Error if grade is invalid
 */
export function getConcreteMaterial(grade: string): ConcreteMaterial {
  const normalized = grade.toUpperCase();
  const material = CONCRETE_GRADES[normalized];
  if (!material) {
    throw new Error(`Invalid concrete grade: ${grade}. Valid grades are: ${Object.keys(CONCRETE_GRADES).join(', ')}`);
  }
  return material;
}

/**
 * Get rebar material properties by grade.
 * @param grade Rebar grade string (e.g., "HRB400")
 * @returns RebarMaterial object
 * @throws Error if grade is invalid
 */
export function getRebarMaterial(grade: string): RebarMaterial {
  const normalized = grade.toUpperCase();
  const material = REBAR_GRADES[normalized];
  if (!material) {
    throw new Error(`Invalid rebar grade: ${grade}. Valid grades are: ${Object.keys(REBAR_GRADES).join(', ')}`);
  }
  return material;
}

/**
 * Get rebar compressive strength based on loading condition.
 * According to GB/T 50010-2010 (2024):
 * - For HRB500 grade, the compressive strength is limited to 400 N/mm² for axial compression
 * - For all other grades, use the standard compressive strength
 * 
 * @param grade Rebar grade string (e.g., "HRB500")
 * @param loadingType Loading condition type
 * @returns Compressive strength design value (N/mm²)
 */
export function getRebarCompressiveStrength(
  grade: string, 
  loadingType: 'axial-compression' | 'bending' | 'general'
): number {
  const material = getRebarMaterial(grade);
  
  // HRB500 and HRBF500 have special limitation for axial compression
  if ((grade.toUpperCase() === 'HRB500' || grade.toUpperCase() === 'HRBF500') && 
      loadingType === 'axial-compression') {
    return 400; // Special limitation for HRB500 in axial compression
  }
  
  // For all other cases, return the standard compressive strength
  return material.fy_compression;
}

/**
 * Check if a concrete grade is valid.
 * @param grade Concrete grade string
 * @returns true if grade exists in CONCRETE_GRADES
 */
export function isValidConcreteGrade(grade: string): boolean {
  return grade.toUpperCase() in CONCRETE_GRADES;
}

/**
 * Check if a rebar grade is valid.
 * @param grade Rebar grade string
 * @returns true if grade exists in REBAR_GRADES
 */
export function isValidRebarGrade(grade: string): boolean {
  return grade.toUpperCase() in REBAR_GRADES;
}

/**
 * Get available rebar diameters.
 * @returns Array of rebar diameters in mm
 */
export function getRebarDiameters(): number[] {
  return [...REBAR_DIAMETERS];
}

/**
 * Calculate alpha1 coefficient based on fck.
 * @param fck Characteristic compressive strength (N/mm²)
 * @returns alpha1 coefficient
 */
export function getAlpha1(fck: number): number {
  // For fck ≤ 50 (C50 and below), alpha1 = 1.0
  if (fck <= 32.4) { // C50 fck = 32.4
    return 1.0;
  }
  // For fck ≥ 50.2 (C80), alpha1 = 0.94
  if (fck >= 50.2) { // C80 fck = 50.2
    return 0.94;
  }
  // Linear interpolation between C50 (fck=32.4, alpha1=1.0) and C80 (fck=50.2, alpha1=0.94)
  // TODO: Verify interpolation formula with concrete design code
  const alpha1 = 1.0 - (fck - 32.4) * (0.06) / (50.2 - 32.4);
  return Number.parseFloat(alpha1.toFixed(2));
}

/**
 * Calculate beta1 coefficient based on fck.
 * @param fck Characteristic compressive strength (N/mm²)
 * @returns beta1 coefficient
 */
export function getBeta1(fck: number): number {
  // For fck ≤ 50 (C50 and below), beta1 = 0.8
  if (fck <= 32.4) { // C50 fck = 32.4
    return 0.8;
  }
  // For fck ≥ 50.2 (C80), beta1 = 0.74
  if (fck >= 50.2) { // C80 fck = 50.2
    return 0.74;
  }
  // Linear interpolation between C50 (fck=32.4, beta1=0.8) and C80 (fck=50.2, beta1=0.74)
  // TODO: Verify interpolation formula with concrete design code
  const beta1 = 0.8 - (fck - 32.4) * (0.06) / (50.2 - 32.4);
  return Number.parseFloat(beta1.toFixed(2));
}

/**
 * Normalize a concrete grade string.
 * @param raw Raw grade input (e.g., "c30", "C30")
 * @returns Normalized uppercase grade
 */
export function normalizeConcreteGrade(raw: string): string {
  const upper = raw.toUpperCase().replace(/\s+/g, '');
  return Object.keys(CONCRETE_GRADES).find((grade) => grade === upper) ?? upper;
}

/**
 * Normalize a section name string (same as steel frame).
 * @param raw Raw section input (e.g., "400x500", "B400H600")
 * @returns Normalized uppercase section name
 */
export function normalizeSectionName(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '').replace(/[×x*]/gi, 'X');
}

/**
 * Get default column section based on story count.
 * @param storyCount Number of stories
 * @returns Default rectangular column section string (e.g., "500X500")
 */
export function getDefaultColumnSection(storyCount: number): string {
  if (storyCount > 10) return '700X700';
  if (storyCount > 5) return '600X600';
  return '500X500';
}

/**
 * Get default beam section based on story count.
 * @param storyCount Number of stories
 * @returns Default rectangular beam section string (e.g., "300X600")
 */
export function getDefaultBeamSection(storyCount: number): string {
  if (storyCount > 10) return '400X800';
  if (storyCount > 5) return '350X700';
  return '300X600';
}

/**
 * Parse a rectangular section string.
 * @param raw Raw section string (e.g., "400X500", "B400H600", "RECT400X500")
 * @returns Object with B (width) and H (height) in mm, or null if parsing fails
 */
export function parseRectangularSection(raw: string): { B: number; H: number } | null {
  const normalized = normalizeSectionName(raw);
  const plain = normalized.match(/^(?:RECT|R)?(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)$/);
  const bh = normalized.match(/^B(\d+(?:\.\d+)?)H(\d+(?:\.\d+)?)$/);
  const match = plain ?? bh;
  if (!match) return null;
  const B = Number.parseFloat(match[1]!);
  const H = Number.parseFloat(match[2]!);
  if (B > 0 && H > 0) return { B, H };
  return null;
}

/**
 * Compute torsion constant for solid rectangular section.
 * @param B Width (mm)
 * @param H Height (mm)
 * @returns Torsion constant J (mm⁴)
 */
function computeSolidRectangularTorsionConstant(B: number, H: number): number {
  const a = Math.max(B, H);
  const b = Math.min(B, H);
  const aspect = b / a;
  return a * b ** 3 * ((1 / 3) - 0.21 * aspect * (1 - (b ** 4) / (12 * a ** 4)));
}

/**
 * Compute rectangular section properties.
 * @param B Width (mm)
 * @param H Height (mm)
 * @param G Shear modulus (N/mm²)
 * @returns Object with A (m²), Iy, Iz, J (m⁴) and G
 */
function computeRectangularSectionProps(B: number, H: number, G: number): {
  A: number;
  Iy: number;
  Iz: number;
  J: number;
  G: number;
} {
  const A = B * H;                               // mm²
  const Iy = (B * H ** 3) / 12;                  // mm⁴
  const Iz = (H * B ** 3) / 12;                  // mm⁴
  const J = computeSolidRectangularTorsionConstant(B, H); // mm⁴
  return {
    A: A / 1e6,   // m²
    Iy: Iy / 1e12, // m⁴
    Iz: Iz / 1e12, // m⁴
    J: J / 1e12,   // m⁴
    G,
  };
}

type ConcreteMaterialProps = ConcreteMaterial & { E: number; G: number; nu: number; rho: number; category: 'concrete' };
type RebarMaterialProps = RebarMaterial & { category: 'rebar' };

/**
 * Resolve concrete material properties with derived elastic constants.
 * @param grade Concrete grade (e.g., "C30")
 * @returns ConcreteMaterialProps with E, G, nu, rho
 */
export function resolveConcreteMaterialProps(grade: string): ConcreteMaterialProps {
  const concrete = getConcreteMaterial(grade);
  const E = concrete.Ec; // Elastic modulus from table (N/mm²)
  const nu = 0.2; // Poisson's ratio for concrete
  const G = E / (2 * (1 + nu)); // Shear modulus (N/mm²)
  const rho = 2500; // Density (kg/m³)
  return {
    ...concrete,
    E,
    G,
    nu,
    rho,
    category: 'concrete' as const,
  };
}

/**
 * Resolve rebar material properties.
 * @param grade Rebar grade (e.g., "HRB400")
 * @returns RebarMaterialProps with category 'rebar'
 */
export function resolveRebarMaterialProps(grade: string): RebarMaterialProps {
  const rebar = getRebarMaterial(grade);
  return {
    ...rebar,
    category: 'rebar' as const,
  };
}

type SectionProps = {
  name: string;
  type: 'rectangular';
  A: number;
  Iy: number;
  Iz: number;
  J: number;
  G: number;
  shape: RectangularSectionShape;
  width?: number;
  height?: number;
  substituted?: string;
};

/**
 * Resolve rectangular section properties.
 * @param rawSection Section string (e.g., "500X500")
 * @param G Shear modulus (N/mm²)
 * @returns SectionProps object
 */
export function resolveSectionProps(rawSection: string, G: number): SectionProps {
  const parsed = parseRectangularSection(rawSection);
  if (!parsed) {
    throw new Error(`Invalid rectangular section: ${rawSection}. Expected format like "500X500" or "B500H500".`);
  }
  const { B, H } = parsed;
  const props = computeRectangularSectionProps(B, H, G);
  return {
    name: rawSection,
    type: 'rectangular',
    ...props,
    shape: { kind: 'rectangular', B, H },
    width: B,
    height: H,
  };
}

type ConcreteFrameModel = {
  storyCount: number;
  bayCount: number;
  storyHeightsM: number[];
  bayWidthsM: number[];
  frameDimension: '2d' | '3d';
  frameMaterial: string;
  frameColumnSection: string;
  frameBeamSection: string;
  concreteProps: ConcreteMaterialProps;
  rebarProps: RebarMaterialProps;
  columnProps: SectionProps;
  beamProps: SectionProps;
  floorLoads?: Array<{ story: number; verticalKN?: number; liveLoadKN?: number; lateralXKN?: number; lateralYKN?: number }>;
  frameBaseSupportType?: string;
};

/**
 * Build a concrete frame model from draft state.
 * @param state Draft state with concrete frame parameters
 * @returns ConcreteFrameModel ready for analysis
 */
export function buildConcreteFrameModel(state: any): ConcreteFrameModel {
  const storyCount = state.storyCount || 1;
  const bayCount = state.bayCount || 1;
  const storyHeightsM = state.storyHeightsM || Array(storyCount).fill(3.0);
  const bayWidthsM = state.bayWidthsM || Array(bayCount).fill(6.0);
  const frameDimension = state.frameDimension || '2d';
  const frameMaterial = state.frameMaterial || 'C30';
  const frameColumnSection = state.frameColumnSection || getDefaultColumnSection(storyCount);
  const frameBeamSection = state.frameBeamSection || getDefaultBeamSection(storyCount);
  const frameBaseSupportType = state.frameBaseSupportType || 'fixed';

  const concreteProps = resolveConcreteMaterialProps(frameMaterial);
  const rebarProps = resolveRebarMaterialProps('HRB400'); // TODO: make rebar grade configurable
  const columnProps = resolveSectionProps(frameColumnSection, concreteProps.G);
  const beamProps = resolveSectionProps(frameBeamSection, concreteProps.G);

  return {
    storyCount,
    bayCount,
    storyHeightsM,
    bayWidthsM,
    frameDimension,
    frameMaterial,
    frameColumnSection,
    frameBeamSection,
    concreteProps,
    rebarProps,
    columnProps,
    beamProps,
    floorLoads: state.floorLoads,
    frameBaseSupportType,
  };
}