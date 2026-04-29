import { computeMissingCriticalKeys } from '../../../agent-runtime/draft-guidance.js';
import {
  STRUCTURAL_COORDINATE_SEMANTICS,
} from '../../../agent-runtime/coordinate-semantics.js';
import { buildElementReferenceVectors } from '../../../agent-runtime/reference-vectors.js';
import type { DraftState } from '../../../agent-runtime/types.js';
import { REQUIRED_KEYS } from './constants.js';

type FrameMaterialCategory = 'steel' | 'concrete';
type FrameMaterialProps = { E: number; G: number; nu: number; rho: number; category: FrameMaterialCategory; fy?: number; fc?: number };

const STEEL_GRADE_PROPERTIES: Record<string, FrameMaterialProps & { category: 'steel'; fy: number }> = {
  Q235: { E: 206000, G: 79000, nu: 0.3, rho: 7850, category: 'steel', fy: 235 },
  Q345: { E: 206000, G: 79000, nu: 0.3, rho: 7850, category: 'steel', fy: 345 },
  Q355: { E: 206000, G: 79000, nu: 0.3, rho: 7850, category: 'steel', fy: 355 },
  Q390: { E: 206000, G: 79000, nu: 0.3, rho: 7850, category: 'steel', fy: 390 },
  Q420: { E: 206000, G: 79000, nu: 0.3, rho: 7850, category: 'steel', fy: 420 },
  S235: { E: 210000, G: 81000, nu: 0.3, rho: 7850, category: 'steel', fy: 235 },
  S275: { E: 210000, G: 81000, nu: 0.3, rho: 7850, category: 'steel', fy: 275 },
  S355: { E: 210000, G: 81000, nu: 0.3, rho: 7850, category: 'steel', fy: 355 },
  A36: { E: 200000, G: 77000, nu: 0.3, rho: 7850, category: 'steel', fy: 248 },
};

const CONCRETE_GRADE_PROPERTIES: Record<string, FrameMaterialProps & { category: 'concrete'; fc: number }> = {
  C20: { E: 25500, G: 10625, nu: 0.2, rho: 2500, category: 'concrete', fc: 9.6 },
  C25: { E: 28000, G: 11667, nu: 0.2, rho: 2500, category: 'concrete', fc: 11.9 },
  C30: { E: 30000, G: 12500, nu: 0.2, rho: 2500, category: 'concrete', fc: 14.3 },
  C35: { E: 31500, G: 13125, nu: 0.2, rho: 2500, category: 'concrete', fc: 16.7 },
  C40: { E: 32500, G: 13542, nu: 0.2, rho: 2500, category: 'concrete', fc: 19.1 },
  C45: { E: 33500, G: 13958, nu: 0.2, rho: 2500, category: 'concrete', fc: 21.1 },
  C50: { E: 34500, G: 14375, nu: 0.2, rho: 2500, category: 'concrete', fc: 23.1 },
  C55: { E: 35500, G: 14792, nu: 0.2, rho: 2500, category: 'concrete', fc: 25.3 },
  C60: { E: 36000, G: 15000, nu: 0.2, rho: 2500, category: 'concrete', fc: 27.5 },
};

type HSectionShape = { kind: 'H'; H: number; B: number; tw: number; tf: number };
type RectangularSectionShape = { kind: 'rectangular'; H: number; B: number };
type HSectionEntry = { A: number; Iy: number; Iz: number; J: number; shape: HSectionShape; standardSteelName: string };

const H_SECTION_PROPERTIES: Record<string, HSectionEntry> = {
  'HW200X200': { A: 0.00640, Iy: 4.72e-5, Iz: 1.60e-5, J: 1.70e-6, shape: { kind: 'H', H: 200, B: 200, tw: 8, tf: 12 }, standardSteelName: 'HW200x200' },
  'HW250X250': { A: 0.00920, Iy: 1.07e-4, Iz: 3.65e-5, J: 2.90e-6, shape: { kind: 'H', H: 250, B: 250, tw: 9, tf: 14 }, standardSteelName: 'HW250x250' },
  'HW300X300': { A: 0.01192, Iy: 2.04e-4, Iz: 6.75e-5, J: 4.23e-6, shape: { kind: 'H', H: 300, B: 300, tw: 10, tf: 15 }, standardSteelName: 'HW300x300' },
  'HW350X350': { A: 0.01739, Iy: 4.03e-4, Iz: 1.36e-4, J: 8.63e-6, shape: { kind: 'H', H: 350, B: 350, tw: 12, tf: 19 }, standardSteelName: 'HW350x350' },
  'HW400X400': { A: 0.01972, Iy: 6.67e-4, Iz: 2.24e-4, J: 1.01e-5, shape: { kind: 'H', H: 400, B: 400, tw: 13, tf: 21 }, standardSteelName: 'HW400x400' },
  'HW450X300': { A: 0.01870, Iy: 7.93e-4, Iz: 2.03e-4, J: 9.86e-6, shape: { kind: 'H', H: 450, B: 300, tw: 11, tf: 18 }, standardSteelName: 'HW450x300' },
  'HN300X150': { A: 0.00487, Iy: 7.21e-5, Iz: 5.08e-6, J: 5.18e-7, shape: { kind: 'H', H: 300, B: 150, tw: 6.5, tf: 9 }, standardSteelName: 'HN300x150' },
  'HN350X175': { A: 0.00629, Iy: 1.36e-4, Iz: 9.84e-6, J: 6.32e-7, shape: { kind: 'H', H: 350, B: 175, tw: 7, tf: 11 }, standardSteelName: 'HN350x175' },
  'HN400X200': { A: 0.00842, Iy: 2.37e-4, Iz: 1.74e-5, J: 8.44e-7, shape: { kind: 'H', H: 400, B: 200, tw: 8, tf: 13 }, standardSteelName: 'HN400x200' },
  'HN450X200': { A: 0.00961, Iy: 3.32e-4, Iz: 1.87e-5, J: 9.68e-7, shape: { kind: 'H', H: 450, B: 200, tw: 9, tf: 14 }, standardSteelName: 'HN450x200' },
  'HN500X200': { A: 0.01143, Iy: 5.02e-4, Iz: 2.14e-5, J: 1.24e-6, shape: { kind: 'H', H: 500, B: 200, tw: 10, tf: 16 }, standardSteelName: 'HN500x200' },
  'HN600X200': { A: 0.01341, Iy: 9.06e-4, Iz: 2.27e-5, J: 1.48e-6, shape: { kind: 'H', H: 600, B: 200, tw: 11, tf: 17 }, standardSteelName: 'HN600x200' },
};

type ResolvedFrameMaterialProps = FrameMaterialProps & { resolvedGrade: string };
type SectionProps = {
  name: string;
  type: 'H' | 'rectangular';
  A: number;
  Iy: number;
  Iz: number;
  J: number;
  G: number;
  shape: HSectionShape | RectangularSectionShape;
  standardSteelName?: string;
  width?: number;
  height?: number;
  substituted?: string;
};

export function getDefaultColumnSection(storyCount: number): string {
  if (storyCount > 10) return 'HW400X400';
  if (storyCount > 5) return 'HW350X350';
  return 'HW300X300';
}

export function getDefaultBeamSection(storyCount: number): string {
  if (storyCount > 10) return 'HN500X200';
  if (storyCount > 5) return 'HN400X200';
  return 'HN300X150';
}

export function normalizeSteelGrade(raw: string): string {
  const upper = raw.toUpperCase().replace(/\s+/g, '');
  return Object.keys({ ...STEEL_GRADE_PROPERTIES, ...CONCRETE_GRADE_PROPERTIES }).find((grade) => grade === upper) ?? upper;
}

export function normalizeSectionName(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '').replace(/[×x*]/gi, 'X');
}

function resolveFrameMaterialProps(grade: string | undefined): ResolvedFrameMaterialProps {
  const normalized = normalizeSteelGrade(grade ?? 'Q355');
  if (STEEL_GRADE_PROPERTIES[normalized]) {
    return { ...STEEL_GRADE_PROPERTIES[normalized]!, resolvedGrade: normalized };
  }
  if (CONCRETE_GRADE_PROPERTIES[normalized]) {
    return { ...CONCRETE_GRADE_PROPERTIES[normalized]!, resolvedGrade: normalized };
  }
  return { ...STEEL_GRADE_PROPERTIES.Q355, resolvedGrade: 'Q355' };
}

function parseCustomHSection(raw: string): { H: number; B: number; tw: number; tf: number } | null {
  const normalized = raw.toUpperCase().replace(/[×X*]/g, 'x').replace(/\s+/g, '');
  const match = normalized.match(/^H(\d+)x(\d+)x([\d.]+)x([\d.]+)$/);
  if (!match) return null;
  const H = parseFloat(match[1]!);
  const B = parseFloat(match[2]!);
  const tw = parseFloat(match[3]!);
  const tf = parseFloat(match[4]!);
  if (H > 0 && B > 0 && tw > 0 && tf > 0) return { H, B, tw, tf };
  return null;
}

function computeHSectionProps(H: number, B: number, tw: number, tf: number, G: number) {
  const hw = H - 2 * tf;
  const A = tw * hw + 2 * B * tf;
  const Iy = (tw * hw ** 3) / 12 + (2 * B * tf ** 3) / 12 + 2 * B * tf * ((hw + tf) / 2) ** 2;
  const Iz = (2 * tf * B ** 3) / 12 + (hw * tw ** 3) / 12;
  const J = (2 * B * tf ** 3 + hw * tw ** 3) / 3;
  return { A: A / 1e6, Iy: Iy / 1e12, Iz: Iz / 1e12, J: J / 1e12, G };
}

function parseRectangularSection(raw: string): { B: number; H: number } | null {
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

function computeSolidRectangularTorsionConstant(B: number, H: number) {
  const a = Math.max(B, H);
  const b = Math.min(B, H);
  const aspect = b / a;
  return a * b ** 3 * ((1 / 3) - 0.21 * aspect * (1 - (b ** 4) / (12 * a ** 4)));
}

function computeRectangularSectionProps(B: number, H: number, G: number) {
  const A = B * H;
  const Iy = (B * H ** 3) / 12;
  const Iz = (H * B ** 3) / 12;
  const J = computeSolidRectangularTorsionConstant(B, H);
  return { A: A / 1e6, Iy: Iy / 1e12, Iz: Iz / 1e12, J: J / 1e12, G };
}

function resolveSectionProps(
  section: string | undefined,
  role: 'column' | 'beam',
  storyCount: number,
  matG: number,
): SectionProps {
  const defaultSection = role === 'column'
    ? getDefaultColumnSection(storyCount)
    : getDefaultBeamSection(storyCount);
  const normalized = section ? normalizeSectionName(section) : defaultSection;
  const found = Boolean(H_SECTION_PROPERTIES[normalized]);
  if (found) {
    const entry = H_SECTION_PROPERTIES[normalized]!;
    return { name: normalized, type: 'H', A: entry.A, Iy: entry.Iy, Iz: entry.Iz, J: entry.J, G: matG, shape: entry.shape, standardSteelName: entry.standardSteelName };
  }
  const custom = section ? parseCustomHSection(section) : null;
  if (custom) {
    const props = computeHSectionProps(custom.H, custom.B, custom.tw, custom.tf, matG);
    const name = `H${custom.H}X${custom.B}X${custom.tw}X${custom.tf}`;
    return {
      name,
      type: 'H',
      ...props,
      shape: { kind: 'H', H: custom.H, B: custom.B, tw: custom.tw, tf: custom.tf },
      standardSteelName: name,
    };
  }
  const rectangular = section ? parseRectangularSection(section) : null;
  if (rectangular) {
    const props = computeRectangularSectionProps(rectangular.B, rectangular.H, matG);
    const name = `${rectangular.B}X${rectangular.H}`;
    return {
      name,
      type: 'rectangular',
      ...props,
      shape: { kind: 'rectangular', B: rectangular.B, H: rectangular.H },
      width: rectangular.B,
      height: rectangular.H,
    };
  }
  const entry = H_SECTION_PROPERTIES[defaultSection]!;
  return { name: defaultSection, type: 'H', A: entry.A, Iy: entry.Iy, Iz: entry.Iz, J: entry.J, G: matG, shape: entry.shape, standardSteelName: entry.standardSteelName, substituted: `${normalized} not in builtin library and not parseable, substituted with ${defaultSection}` };
}

function buildMaterialRecord(matProps: ResolvedFrameMaterialProps): Record<string, unknown> {
  return {
    id: '1',
    name: matProps.resolvedGrade,
    grade: matProps.resolvedGrade,
    category: matProps.category,
    E: matProps.E,
    nu: matProps.nu,
    rho: matProps.rho,
    ...(matProps.fy !== undefined ? { fy: matProps.fy } : {}),
    ...(matProps.fc !== undefined ? { fc: matProps.fc } : {}),
  };
}

function buildSectionRecord(id: string, purpose: 'column' | 'beam', props: SectionProps): Record<string, unknown> {
  return {
    id,
    name: props.name,
    type: props.type,
    purpose,
    ...(props.standardSteelName !== undefined ? { standard_steel_name: props.standardSteelName } : {}),
    shape: props.shape,
    ...(props.width !== undefined ? { width: props.width } : {}),
    ...(props.height !== undefined ? { height: props.height } : {}),
    properties: { A: props.A, Iy: props.Iy, Iz: props.Iz, J: props.J, G: props.G },
  };
}

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

function buildFrame2dLocalModel(
  state: DraftState,
  matProps: ResolvedFrameMaterialProps,
  colProps: SectionProps,
  beamProps: SectionProps,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const bayWidths = state.bayWidthsM!;
  const storyHeights = state.storyHeightsM!;
  const floorLoads = state.floorLoads!;
  const baseSupport = (state.frameBaseSupportType as string | undefined) ?? 'fixed';
  const xCoords = accumulateCoords(bayWidths);
  const zCoords = accumulateCoords(storyHeights);
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const loads: Array<Record<string, unknown>> = [];
  let elementId = 1;

  for (let storyIdx = 0; storyIdx < zCoords.length; storyIdx++) {
    for (let bayIdx = 0; bayIdx < xCoords.length; bayIdx++) {
      const node: Record<string, unknown> = { id: n2dId(storyIdx, bayIdx), x: xCoords[bayIdx], y: 0, z: zCoords[storyIdx] };
      if (storyIdx === 0) node.restraints = buildBaseRestraint(baseSupport);
      nodes.push(node);
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let bayIdx = 0; bayIdx < xCoords.length; bayIdx++) {
      elements.push({ id: `C${elementId}`, type: 'column', nodes: [n2dId(storyIdx - 1, bayIdx), n2dId(storyIdx, bayIdx)], material: '1', section: '1' });
      elementId += 1;
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let bayIdx = 0; bayIdx < bayWidths.length; bayIdx++) {
      elements.push({ id: `B${elementId}`, type: 'beam', nodes: [n2dId(storyIdx, bayIdx), n2dId(storyIdx, bayIdx + 1)], material: '1', section: '2' });
      elementId += 1;
    }
  }

  const levelNodeCount = xCoords.length;
  for (const load of floorLoads) {
    const storyIdx = load.story;
    if (storyIdx <= 0 || storyIdx >= zCoords.length) continue;
    const vPerNode = load.verticalKN !== undefined ? -load.verticalKN / levelNodeCount : undefined;
    const lPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    for (let bayIdx = 0; bayIdx < xCoords.length; bayIdx++) {
      const nodeLoad: Record<string, unknown> = { node: n2dId(storyIdx, bayIdx) };
      if (vPerNode !== undefined) nodeLoad.fz = vPerNode;
      if (lPerNode !== undefined) nodeLoad.fx = lPerNode;
      if (Object.keys(nodeLoad).length > 1) loads.push(nodeLoad);
    }
  }

  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [buildMaterialRecord(matProps)],
    sections: [
      buildSectionRecord('1', 'column', colProps),
      buildSectionRecord('2', 'beam', beamProps),
    ],
    stories: storyHeights.map((h, i) => {
      const storyIdx = i + 1;
      const fl = floorLoads.find((l) => l.story === storyIdx);
      const floorAreaM2 = Math.max(xCoords[xCoords.length - 1], 1);
      const deadLoad = fl?.verticalKN ? Math.abs(fl.verticalKN) / floorAreaM2 : undefined;
      const liveLoad = fl?.liveLoadKN ? Math.abs(fl.liveLoadKN) / floorAreaM2 : undefined;
      return {
        id: `F${storyIdx}`,
        height: h,
        elevation: zCoords[i],
        standard_floor_group: 'SF1',
        ...(deadLoad ? { dead_load: Math.round(deadLoad * 100) / 100 } : {}),
        ...(liveLoad ? { live_load: Math.round(liveLoad * 100) / 100 } : {}),
      };
    }),
    load_cases: [{ id: 'LC1', type: 'other', loads }],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
      baseSupport,
      material: matProps.resolvedGrade,
      columnSection: colProps.name,
      beamSection: beamProps.name,
      storyCount: storyHeights.length,
      bayCount: bayWidths.length,
      geometry: { storyHeightsM: storyHeights, bayWidthsM: bayWidths },
      ...(colProps.substituted || beamProps.substituted ? {
        sectionSubstitutions: [colProps.substituted, beamProps.substituted].filter(Boolean),
      } : {}),
    },
  };
}

function buildFrame3dLocalModel(
  state: DraftState,
  matProps: ResolvedFrameMaterialProps,
  colProps: SectionProps,
  beamProps: SectionProps,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const bayWidthsX = state.bayWidthsXM!;
  const bayWidthsY = state.bayWidthsYM!;
  const storyHeights = state.storyHeightsM!;
  const floorLoads = state.floorLoads!;
  const baseSupport = (state.frameBaseSupportType as string | undefined) ?? 'fixed';
  const xCoords = accumulateCoords(bayWidthsX);
  const yCoords = accumulateCoords(bayWidthsY);
  const zCoords = accumulateCoords(storyHeights);
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const loads: Array<Record<string, unknown>> = [];
  let elementId = 1;

  for (let storyIdx = 0; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        const node: Record<string, unknown> = { id: n3dId(storyIdx, xIdx, yIdx), x: xCoords[xIdx], y: yCoords[yIdx], z: zCoords[storyIdx] };
        if (storyIdx === 0) node.restraints = buildBaseRestraint(baseSupport);
        nodes.push(node);
      }
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        elements.push({ id: `C${elementId}`, type: 'column', nodes: [n3dId(storyIdx - 1, xIdx, yIdx), n3dId(storyIdx, xIdx, yIdx)], material: '1', section: '1' });
        elementId += 1;
      }
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < bayWidthsX.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        elements.push({ id: `BX${elementId}`, type: 'beam', nodes: [n3dId(storyIdx, xIdx, yIdx), n3dId(storyIdx, xIdx + 1, yIdx)], material: '1', section: '2' });
        elementId += 1;
      }
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < bayWidthsY.length; yIdx++) {
        elements.push({ id: `BY${elementId}`, type: 'beam', nodes: [n3dId(storyIdx, xIdx, yIdx), n3dId(storyIdx, xIdx, yIdx + 1)], material: '1', section: '2' });
        elementId += 1;
      }
    }
  }

  const levelNodeCount = xCoords.length * yCoords.length;
  for (const load of floorLoads) {
    const storyIdx = load.story;
    if (storyIdx <= 0 || storyIdx >= zCoords.length) continue;
    const vPerNode = load.verticalKN !== undefined ? -load.verticalKN / levelNodeCount : undefined;
    const lxPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    const lyPerNode = load.lateralYKN !== undefined ? load.lateralYKN / levelNodeCount : undefined;
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        const nodeLoad: Record<string, unknown> = { node: n3dId(storyIdx, xIdx, yIdx) };
        if (vPerNode !== undefined) nodeLoad.fz = vPerNode;
        if (lxPerNode !== undefined) nodeLoad.fx = lxPerNode;
        if (lyPerNode !== undefined) nodeLoad.fy = lyPerNode;
        if (Object.keys(nodeLoad).length > 1) loads.push(nodeLoad);
      }
    }
  }

  const elementReferenceVectors = buildElementReferenceVectors(elements, nodes);

  return {
    schema_version: '2.0.0',
    unit_system: 'SI',
    nodes,
    elements,
    materials: [buildMaterialRecord(matProps)],
    sections: [
      buildSectionRecord('1', 'column', colProps),
      buildSectionRecord('2', 'beam', beamProps),
    ],
    stories: storyHeights.map((h, i) => {
      const storyIdx = i + 1;
      const fl = floorLoads.find((l) => l.story === storyIdx);
      const floorAreaM2 = Math.max(xCoords[xCoords.length - 1], 1) * Math.max(yCoords[yCoords.length - 1], 1);
      const deadLoad = fl?.verticalKN ? Math.abs(fl.verticalKN) / floorAreaM2 : undefined;
      const liveLoad = fl?.liveLoadKN ? Math.abs(fl.liveLoadKN) / floorAreaM2 : undefined;
      return {
        id: `F${storyIdx}`,
        height: h,
        elevation: zCoords[i],
        standard_floor_group: 'SF1',
        ...(deadLoad ? { dead_load: Math.round(deadLoad * 100) / 100 } : {}),
        ...(liveLoad ? { live_load: Math.round(liveLoad * 100) / 100 } : {}),
      };
    }),
    load_cases: [{ id: 'LC1', type: 'other', loads }],
    load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
    metadata: {
      ...metadata,
      coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
      elementReferenceVectors,
      baseSupport,
      material: matProps.resolvedGrade,
      columnSection: colProps.name,
      beamSection: beamProps.name,
      storyCount: storyHeights.length,
      bayCountX: bayWidthsX.length,
      bayCountY: bayWidthsY.length,
      geometry: { storyHeightsM: storyHeights, bayWidthsXM: bayWidthsX, bayWidthsYM: bayWidthsY },
      ...(colProps.substituted || beamProps.substituted ? {
        sectionSubstitutions: [colProps.substituted, beamProps.substituted].filter(Boolean),
      } : {}),
    },
  };
}

function buildFrameLocalModel(state: DraftState): Record<string, unknown> {
  const matGrade = state.frameMaterial as string | undefined;
  const colSection = state.frameColumnSection as string | undefined;
  const beamSection = state.frameBeamSection as string | undefined;
  const storyCount = state.storyHeightsM?.length ?? (state.storyCount as number | undefined) ?? 0;
  const matProps = resolveFrameMaterialProps(matGrade);
  const colProps = resolveSectionProps(colSection, 'column', storyCount, matProps.G);
  const beamProps = resolveSectionProps(beamSection, 'beam', storyCount, matProps.G);
  const metadata: Record<string, unknown> = { source: 'markdown-skill-draft', inferredType: 'frame', frameDimension: state.frameDimension === '3d' ? '3d' : '2d' };
  if (state.frameDimension === '3d') {
    return buildFrame3dLocalModel(state, matProps, colProps, beamProps, metadata);
  }
  return buildFrame2dLocalModel(state, matProps, colProps, beamProps, metadata);
}

export function buildFrameModel(state: DraftState): Record<string, unknown> | undefined {
  const critical = computeMissingCriticalKeys(state).filter((key) => (REQUIRED_KEYS as readonly string[]).includes(key));
  if (critical.length > 0) return undefined;
  return buildFrameLocalModel(state);
}
