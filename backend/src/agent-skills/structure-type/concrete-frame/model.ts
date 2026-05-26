import {
  STRUCTURAL_COORDINATE_SEMANTICS,
} from '../../../agent-runtime/coordinate-semantics.js';
import { buildElementReferenceVectors } from '../../../agent-runtime/reference-vectors.js';
import type { DraftState } from '../../../agent-runtime/types.js';

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
  schema_version: '2.0.0';
  unit_system: 'SI';
  project: Record<string, unknown>;
  structure_system: Record<string, unknown>;
  nodes: Array<Record<string, unknown>>;
  elements: Array<Record<string, unknown>>;
  stories: Array<Record<string, unknown>>;
  load_cases: Array<Record<string, unknown>>;
  load_combinations: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  extensions: Record<string, unknown>;
  storyCount: number;
  bayCount?: number;
  bayCountX?: number;
  bayCountY?: number;
  storyHeightsM: number[];
  bayWidthsM?: number[];
  bayWidthsXM?: number[];
  bayWidthsYM?: number[];
  frameDimension: '2d' | '3d';
  frameConcreteGrade: string;
  frameRebarGrade: string;
  frameColumnSection: string;
  frameBeamSection: string;
  concreteProps: ConcreteMaterialProps;
  rebarProps: RebarMaterialProps;
  columnProps: SectionProps;
  beamProps: SectionProps;
  floorLoads?: Array<{ story: number; verticalKN?: number; liveLoadKN?: number; lateralXKN?: number; lateralYKN?: number }>;
  frameBaseSupportType?: string;
  materials?: Array<{
    id: string;
    name: string;
    grade: string;
    category: 'concrete' | 'rebar';
    E: number;
    G?: number;
    nu: number;
    rho: number;
    fc?: number;
    fy?: number;
  }>;
  sections?: Array<{
    id: string;
    name: string;
    type: 'rectangular';
    purpose: 'column' | 'beam';
    width: number;
    height: number;
    shape: { kind: 'rectangular'; B: number; H: number };
    properties: {
      A: number;
      Iy: number;
      Iz: number;
      J: number;
      G: number;
    };
  }>;
};

function accumulateCoords(lengths: number[]): number[] {
  const coords = [0];
  for (const value of lengths) {
    coords.push(coords[coords.length - 1] + value);
  }
  return coords;
}

function buildBaseRestraint(baseSupport: string): boolean[] {
  return baseSupport === 'pinned'
    ? [true, true, true, false, false, false]
    : [true, true, true, true, true, true];
}

function n2dId(storyIdx: number, bayNodeIdx: number): string {
  return `N${storyIdx}_${bayNodeIdx}`;
}

function n3dId(storyIdx: number, xIdx: number, yIdx: number): string {
  return `N${storyIdx}_${xIdx}_${yIdx}`;
}

function buildStoryFloorLoadFields(deadLoad: number | undefined, liveLoad: number | undefined): Record<string, unknown> {
  const roundedDeadLoad = deadLoad ? Math.round(deadLoad * 100) / 100 : undefined;
  const roundedLiveLoad = liveLoad ? Math.round(liveLoad * 100) / 100 : undefined;
  const floorLoads = [
    ...(roundedDeadLoad ? [{ type: 'dead', value: roundedDeadLoad }] : []),
    ...(roundedLiveLoad ? [{ type: 'live', value: roundedLiveLoad }] : []),
  ];

  return {
    ...(floorLoads.length ? { floor_loads: floorLoads } : {}),
    ...(roundedDeadLoad ? { dead_load: roundedDeadLoad } : {}),
    ...(roundedLiveLoad ? { live_load: roundedLiveLoad } : {}),
  };
}

function storyHasFloorLoad(story: Record<string, unknown>, loadType: 'dead' | 'live'): boolean {
  const field = loadType === 'dead' ? story.dead_load : story.live_load;
  if (typeof field === 'number' && field > 0) return true;

  const floorLoads = Array.isArray(story.floor_loads) ? story.floor_loads : [];
  return floorLoads.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as Record<string, unknown>;
    return record.type === loadType && typeof record.value === 'number' && record.value > 0;
  });
}

function buildConcreteLoadCaseBundle(
  stories: Array<Record<string, unknown>>,
  lateralLoads: Array<Record<string, unknown>>,
): { load_cases: Array<Record<string, unknown>>; load_combinations: Array<Record<string, unknown>> } {
  const loadCases: Array<Record<string, unknown>> = [];

  if (stories.some((story) => storyHasFloorLoad(story, 'dead'))) {
    loadCases.push({ id: 'D', type: 'dead', loads: [], description: 'Dead floor loads from stories.floor_loads' });
  }
  if (stories.some((story) => storyHasFloorLoad(story, 'live'))) {
    loadCases.push({ id: 'L', type: 'live', loads: [], description: 'Live floor loads from stories.floor_loads' });
  }
  if (lateralLoads.length) {
    loadCases.push({ id: 'LAT', type: 'other', loads: lateralLoads, description: 'Lateral story loads' });
  }
  if (!loadCases.length) {
    loadCases.push({ id: 'LC1', type: 'other', loads: [] });
  }

  const factors = Object.fromEntries(loadCases.map((loadCase) => [String(loadCase.id), 1.0]));
  return {
    load_cases: loadCases,
    load_combinations: [{ id: 'ULS', factors, combination_type: 'uls', code_reference: 'GB50010' }],
  };
}

function buildConcreteMaterialRecord(concreteProps: ConcreteMaterialProps): Record<string, unknown> {
  return {
    id: '1',
    name: concreteProps.grade,
    grade: concreteProps.grade,
    category: 'concrete',
    E: concreteProps.E,
    G: concreteProps.G,
    nu: concreteProps.nu,
    rho: concreteProps.rho,
    fc: concreteProps.fc,
  };
}

function buildRebarMaterialRecord(rebarProps: RebarMaterialProps): Record<string, unknown> {
  return {
    id: '2',
    name: rebarProps.grade,
    grade: rebarProps.grade,
    category: 'rebar',
    E: rebarProps.Es,
    nu: 0.3,
    rho: 7850,
    fy: rebarProps.fy,
    extra: {
      fyk: rebarProps.fyk,
      fstk: rebarProps.fstk,
      fy_compression: rebarProps.fy_compression,
      fyv: rebarProps.fyv,
    },
  };
}

function buildConcreteSectionRecord(id: string, purpose: 'column' | 'beam', props: SectionProps): Record<string, unknown> {
  return {
    id,
    name: props.name,
    type: props.type,
    purpose,
    width: props.width ?? 0,
    height: props.height ?? 0,
    shape: props.shape,
    properties: { A: props.A, Iy: props.Iy, Iz: props.Iz, J: props.J, G: props.G },
  };
}

function buildCommonModelFields(options: {
  frameConcreteGrade: string;
  frameRebarGrade: string;
  frameColumnSection: string;
  frameBeamSection: string;
  frameBaseSupportType: string;
  storyCount: number;
  concreteProps: ConcreteMaterialProps;
  rebarProps: RebarMaterialProps;
  columnProps: SectionProps;
  beamProps: SectionProps;
  metadata: Record<string, unknown>;
}): Pick<ConcreteFrameModel, 'schema_version' | 'unit_system' | 'project' | 'structure_system' | 'materials' | 'sections' | 'metadata' | 'extensions'> {
  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    project: {
      code_standard: 'GB50010-2010',
      extra: {
        designCode: 'GB50010',
      },
    },
    structure_system: {
      type: 'frame',
      seismic_grade: 'none',
      extra: {
        materialSystem: 'reinforced-concrete',
      },
    },
    materials: [
      buildConcreteMaterialRecord(options.concreteProps),
      buildRebarMaterialRecord(options.rebarProps),
    ] as ConcreteFrameModel['materials'],
    sections: [
      buildConcreteSectionRecord('1', 'column', options.columnProps),
      buildConcreteSectionRecord('2', 'beam', options.beamProps),
    ] as ConcreteFrameModel['sections'],
    metadata: {
      ...options.metadata,
      coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
      source: 'concrete-frame-skill-draft',
      inferredType: 'frame',
      structuralTypeKey: 'concrete-frame',
      materialSystem: 'reinforced-concrete',
      designCode: 'GB50010',
      baseSupport: options.frameBaseSupportType,
      concreteGrade: options.frameConcreteGrade,
      rebarGrade: options.frameRebarGrade,
      columnSection: options.frameColumnSection,
      beamSection: options.frameBeamSection,
      storyCount: options.storyCount,
    },
    extensions: {
      yjk: {
        materialSystem: 'reinforced-concrete',
        designCode: 'GB50010',
      },
      concreteDesign: {
        concreteGrade: options.frameConcreteGrade,
        rebarGrade: options.frameRebarGrade,
      },
    },
  };
}

function buildConcreteFrame2dLocalModel(options: {
  storyCount: number;
  bayCount: number;
  storyHeightsM: number[];
  bayWidthsM: number[];
  floorLoads: NonNullable<ConcreteFrameModel['floorLoads']>;
  frameBaseSupportType: string;
  frameConcreteGrade: string;
  frameRebarGrade: string;
  frameColumnSection: string;
  frameBeamSection: string;
  concreteProps: ConcreteMaterialProps;
  rebarProps: RebarMaterialProps;
  columnProps: SectionProps;
  beamProps: SectionProps;
}): ConcreteFrameModel {
  const xCoords = accumulateCoords(options.bayWidthsM);
  const zCoords = accumulateCoords(options.storyHeightsM);
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const lateralLoads: Array<Record<string, unknown>> = [];
  let elementId = 1;

  for (let storyIdx = 0; storyIdx < zCoords.length; storyIdx++) {
    for (let bayIdx = 0; bayIdx < xCoords.length; bayIdx++) {
      const node: Record<string, unknown> = {
        id: n2dId(storyIdx, bayIdx),
        x: xCoords[bayIdx],
        y: 0,
        z: zCoords[storyIdx],
        ...(storyIdx > 0 ? { story: `F${storyIdx}` } : {}),
      };
      if (storyIdx === 0) node.restraints = buildBaseRestraint(options.frameBaseSupportType);
      nodes.push(node);
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let bayIdx = 0; bayIdx < xCoords.length; bayIdx++) {
      elements.push({
        id: `C${elementId}`,
        type: 'column',
        nodes: [n2dId(storyIdx - 1, bayIdx), n2dId(storyIdx, bayIdx)],
        material: '1',
        section: '1',
        story: `F${storyIdx}`,
        concrete_grade: options.frameConcreteGrade,
        rebar_grade: options.frameRebarGrade,
      });
      elementId += 1;
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let bayIdx = 0; bayIdx < options.bayWidthsM.length; bayIdx++) {
      elements.push({
        id: `B${elementId}`,
        type: 'beam',
        nodes: [n2dId(storyIdx, bayIdx), n2dId(storyIdx, bayIdx + 1)],
        material: '1',
        section: '2',
        story: `F${storyIdx}`,
        concrete_grade: options.frameConcreteGrade,
        rebar_grade: options.frameRebarGrade,
      });
      elementId += 1;
    }
  }

  const levelNodeCount = xCoords.length;
  for (const load of options.floorLoads) {
    const storyIdx = load.story;
    if (storyIdx <= 0 || storyIdx >= zCoords.length) continue;
    const lPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    for (let bayIdx = 0; bayIdx < xCoords.length; bayIdx++) {
      const nodeLoad: Record<string, unknown> = { node: n2dId(storyIdx, bayIdx) };
      if (lPerNode !== undefined) nodeLoad.fx = lPerNode;
      if (Object.keys(nodeLoad).length > 1) lateralLoads.push(nodeLoad);
    }
  }

  const stories = options.storyHeightsM.map((height, index) => {
    const storyIdx = index + 1;
    const fl = options.floorLoads.find((load) => load.story === storyIdx);
    const floorAreaM2 = Math.max(xCoords[xCoords.length - 1], 1);
    const deadLoad = fl?.verticalKN ? Math.abs(fl.verticalKN) / floorAreaM2 : undefined;
    const liveLoad = fl?.liveLoadKN ? Math.abs(fl.liveLoadKN) / floorAreaM2 : undefined;
    return {
      id: `F${storyIdx}`,
      height,
      elevation: zCoords[index],
      standard_floor_group: 'SF1',
      ...buildStoryFloorLoadFields(deadLoad, liveLoad),
    };
  });
  const loadCaseBundle = buildConcreteLoadCaseBundle(stories, lateralLoads);
  const common = buildCommonModelFields({
    ...options,
    metadata: {
      frameDimension: '2d',
      bayCount: options.bayCount,
      geometry: { storyHeightsM: options.storyHeightsM, bayWidthsM: options.bayWidthsM },
    },
  });

  return {
    ...common,
    nodes,
    elements,
    stories,
    ...loadCaseBundle,
    storyCount: options.storyCount,
    bayCount: options.bayCount,
    storyHeightsM: options.storyHeightsM,
    bayWidthsM: options.bayWidthsM,
    frameDimension: '2d',
    frameConcreteGrade: options.frameConcreteGrade,
    frameRebarGrade: options.frameRebarGrade,
    frameColumnSection: options.frameColumnSection,
    frameBeamSection: options.frameBeamSection,
    concreteProps: options.concreteProps,
    rebarProps: options.rebarProps,
    columnProps: options.columnProps,
    beamProps: options.beamProps,
    floorLoads: options.floorLoads,
    frameBaseSupportType: options.frameBaseSupportType,
  };
}

function buildConcreteFrame3dLocalModel(options: {
  storyCount: number;
  bayCountX: number;
  bayCountY: number;
  storyHeightsM: number[];
  bayWidthsXM: number[];
  bayWidthsYM: number[];
  floorLoads: NonNullable<ConcreteFrameModel['floorLoads']>;
  frameBaseSupportType: string;
  frameConcreteGrade: string;
  frameRebarGrade: string;
  frameColumnSection: string;
  frameBeamSection: string;
  concreteProps: ConcreteMaterialProps;
  rebarProps: RebarMaterialProps;
  columnProps: SectionProps;
  beamProps: SectionProps;
}): ConcreteFrameModel {
  const xCoords = accumulateCoords(options.bayWidthsXM);
  const yCoords = accumulateCoords(options.bayWidthsYM);
  const zCoords = accumulateCoords(options.storyHeightsM);
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const lateralLoads: Array<Record<string, unknown>> = [];
  let elementId = 1;

  for (let storyIdx = 0; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        const node: Record<string, unknown> = {
          id: n3dId(storyIdx, xIdx, yIdx),
          x: xCoords[xIdx],
          y: yCoords[yIdx],
          z: zCoords[storyIdx],
          ...(storyIdx > 0 ? { story: `F${storyIdx}` } : {}),
        };
        if (storyIdx === 0) node.restraints = buildBaseRestraint(options.frameBaseSupportType);
        nodes.push(node);
      }
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        elements.push({
          id: `C${elementId}`,
          type: 'column',
          nodes: [n3dId(storyIdx - 1, xIdx, yIdx), n3dId(storyIdx, xIdx, yIdx)],
          material: '1',
          section: '1',
          story: `F${storyIdx}`,
          concrete_grade: options.frameConcreteGrade,
          rebar_grade: options.frameRebarGrade,
        });
        elementId += 1;
      }
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < options.bayWidthsXM.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        elements.push({
          id: `BX${elementId}`,
          type: 'beam',
          nodes: [n3dId(storyIdx, xIdx, yIdx), n3dId(storyIdx, xIdx + 1, yIdx)],
          material: '1',
          section: '2',
          story: `F${storyIdx}`,
          concrete_grade: options.frameConcreteGrade,
          rebar_grade: options.frameRebarGrade,
        });
        elementId += 1;
      }
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < options.bayWidthsYM.length; yIdx++) {
        elements.push({
          id: `BY${elementId}`,
          type: 'beam',
          nodes: [n3dId(storyIdx, xIdx, yIdx), n3dId(storyIdx, xIdx, yIdx + 1)],
          material: '1',
          section: '2',
          story: `F${storyIdx}`,
          concrete_grade: options.frameConcreteGrade,
          rebar_grade: options.frameRebarGrade,
        });
        elementId += 1;
      }
    }
  }

  const levelNodeCount = xCoords.length * yCoords.length;
  for (const load of options.floorLoads) {
    const storyIdx = load.story;
    if (storyIdx <= 0 || storyIdx >= zCoords.length) continue;
    const lxPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    const lyPerNode = load.lateralYKN !== undefined ? load.lateralYKN / levelNodeCount : undefined;
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        const nodeLoad: Record<string, unknown> = { node: n3dId(storyIdx, xIdx, yIdx) };
        if (lxPerNode !== undefined) nodeLoad.fx = lxPerNode;
        if (lyPerNode !== undefined) nodeLoad.fy = lyPerNode;
        if (Object.keys(nodeLoad).length > 1) lateralLoads.push(nodeLoad);
      }
    }
  }

  const elementReferenceVectors = buildElementReferenceVectors(elements, nodes);
  const stories = options.storyHeightsM.map((height, index) => {
    const storyIdx = index + 1;
    const fl = options.floorLoads.find((load) => load.story === storyIdx);
    const floorAreaM2 = Math.max(xCoords[xCoords.length - 1], 1) * Math.max(yCoords[yCoords.length - 1], 1);
    const deadLoad = fl?.verticalKN ? Math.abs(fl.verticalKN) / floorAreaM2 : undefined;
    const liveLoad = fl?.liveLoadKN ? Math.abs(fl.liveLoadKN) / floorAreaM2 : undefined;
    return {
      id: `F${storyIdx}`,
      height,
      elevation: zCoords[index],
      standard_floor_group: 'SF1',
      ...buildStoryFloorLoadFields(deadLoad, liveLoad),
    };
  });
  const loadCaseBundle = buildConcreteLoadCaseBundle(stories, lateralLoads);
  const common = buildCommonModelFields({
    ...options,
    metadata: {
      frameDimension: '3d',
      elementReferenceVectors,
      bayCountX: options.bayCountX,
      bayCountY: options.bayCountY,
      geometry: {
        storyHeightsM: options.storyHeightsM,
        bayWidthsXM: options.bayWidthsXM,
        bayWidthsYM: options.bayWidthsYM,
      },
    },
  });

  return {
    ...common,
    nodes,
    elements,
    stories,
    ...loadCaseBundle,
    storyCount: options.storyCount,
    bayCountX: options.bayCountX,
    bayCountY: options.bayCountY,
    storyHeightsM: options.storyHeightsM,
    bayWidthsXM: options.bayWidthsXM,
    bayWidthsYM: options.bayWidthsYM,
    frameDimension: '3d',
    frameConcreteGrade: options.frameConcreteGrade,
    frameRebarGrade: options.frameRebarGrade,
    frameColumnSection: options.frameColumnSection,
    frameBeamSection: options.frameBeamSection,
    concreteProps: options.concreteProps,
    rebarProps: options.rebarProps,
    columnProps: options.columnProps,
    beamProps: options.beamProps,
    floorLoads: options.floorLoads,
    frameBaseSupportType: options.frameBaseSupportType,
  };
}

/**
 * Build a concrete frame model from draft state.
 * @param state Draft state with concrete frame parameters
 * @returns ConcreteFrameModel ready for analysis, or undefined if critical geometry is missing
 */
export function buildConcreteFrameModel(state: DraftState): ConcreteFrameModel | undefined {
  const storyCount = state.storyCount;
  const storyHeightsM = state.storyHeightsM;

  if (storyCount === undefined || !storyHeightsM?.length) {
    return undefined;
  }
  if (storyHeightsM.length !== storyCount) {
    return undefined;
  }

  const frameDimension = state.frameDimension || '2d';
  const floorLoads = state.floorLoads ?? [];

  // M1: Separate concrete and rebar grade handling
  const rawFrameConcreteGrade = (state.frameConcreteGrade as string | undefined);
  const rawFrameRebarGrade = (state.frameRebarGrade as string | undefined);

  const frameConcreteGrade = rawFrameConcreteGrade && isValidConcreteGrade(rawFrameConcreteGrade)
    ? normalizeConcreteGrade(rawFrameConcreteGrade)
    : 'C30';
  const frameRebarGrade = rawFrameRebarGrade && isValidRebarGrade(rawFrameRebarGrade)
    ? rawFrameRebarGrade.toUpperCase().replace(/\s+/g, '')
    : 'HRB400';

  const frameColumnSection = (state.frameColumnSection as string | undefined) || getDefaultColumnSection(storyCount);
  const frameBeamSection = (state.frameBeamSection as string | undefined) || getDefaultBeamSection(storyCount);
  const frameBaseSupportType = (state.frameBaseSupportType as string | undefined) || 'fixed';

  const concreteProps = resolveConcreteMaterialProps(frameConcreteGrade);
  const rebarProps = resolveRebarMaterialProps(frameRebarGrade);
  const columnProps = resolveSectionProps(frameColumnSection, concreteProps.G);
  const beamProps = resolveSectionProps(frameBeamSection, concreteProps.G);

  if (frameDimension === '3d') {
    const bayWidthsXM = state.bayWidthsXM?.length ? state.bayWidthsXM : state.bayWidthsM;
    const bayWidthsYM = state.bayWidthsYM?.length ? state.bayWidthsYM : state.bayWidthsM;
    const bayCountX = state.bayCountX ?? bayWidthsXM?.length;
    const bayCountY = state.bayCountY ?? bayWidthsYM?.length;

    if (bayCountX === undefined || bayCountY === undefined || !bayWidthsXM?.length || !bayWidthsYM?.length) {
      return undefined;
    }
    if (bayWidthsXM.length !== bayCountX || bayWidthsYM.length !== bayCountY) {
      return undefined;
    }

    return buildConcreteFrame3dLocalModel({
      storyCount,
      bayCountX,
      bayCountY,
      storyHeightsM,
      bayWidthsXM,
      bayWidthsYM,
      floorLoads,
      frameBaseSupportType,
      frameConcreteGrade,
      frameRebarGrade,
      frameColumnSection,
      frameBeamSection,
      concreteProps,
      rebarProps,
      columnProps,
      beamProps,
    });
  }

  const bayCount = state.bayCount;
  const bayWidthsM = state.bayWidthsM;

  if (bayCount === undefined || !bayWidthsM?.length) {
    return undefined;
  }
  if (bayWidthsM.length !== bayCount) {
    return undefined;
  }

  return buildConcreteFrame2dLocalModel({
    storyCount,
    bayCount,
    storyHeightsM,
    bayWidthsM,
    floorLoads,
    frameBaseSupportType,
    frameConcreteGrade,
    frameRebarGrade,
    frameColumnSection,
    frameBeamSection,
    concreteProps,
    rebarProps,
    columnProps,
    beamProps,
  });
}
