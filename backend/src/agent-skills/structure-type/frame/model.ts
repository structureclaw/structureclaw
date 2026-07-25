import { computeMissingCriticalKeys } from '../../../agent-runtime/draft-guidance.js';
import {
  STRUCTURAL_COORDINATE_SEMANTICS,
  withCanonicalCoordinateContract,
} from '../../../agent-runtime/coordinate-semantics.js';
import { isLocalizedFramePointLoad } from '../../../agent-runtime/engineering-draft.js';
import { buildElementReferenceVectors } from '../../../agent-runtime/reference-vectors.js';
import type {
  DraftFloorLoad,
  DraftState,
  EngineeringDraftLoad,
  EngineeringDraftLoadCaseType,
  EngineeringDraftLoadCombination,
} from '../../../agent-runtime/types.js';
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

function buildStoryFloorLoadFields(deadLoad: number | undefined, liveLoad: number | undefined): Record<string, unknown> {
  const exactDeadLoad = deadLoad && Number.isFinite(deadLoad) ? deadLoad : undefined;
  const exactLiveLoad = liveLoad && Number.isFinite(liveLoad) ? liveLoad : undefined;
  const floorLoads = [
    ...(exactDeadLoad ? [{ type: 'dead', value: exactDeadLoad }] : []),
    ...(exactLiveLoad ? [{ type: 'live', value: exactLiveLoad }] : []),
  ];

  return {
    ...(floorLoads.length ? { floor_loads: floorLoads } : {}),
    ...(exactDeadLoad ? { dead_load: exactDeadLoad } : {}),
    ...(exactLiveLoad ? { live_load: exactLiveLoad } : {}),
  };
}

function hasFloorLoadValue(floorLoads: DraftFloorLoad[] | undefined, loadKey?: 'verticalKN' | 'liveLoadKN'): boolean {
  return Boolean(floorLoads?.some((load) => {
    if (loadKey) {
      const value = load[loadKey];
      return typeof value === 'number' && Number.isFinite(value) && value !== 0;
    }
    return (
      (typeof load.verticalKN === 'number' && Number.isFinite(load.verticalKN) && load.verticalKN !== 0)
      || (typeof load.liveLoadKN === 'number' && Number.isFinite(load.liveLoadKN) && load.liveLoadKN !== 0)
      || (typeof load.lateralXKN === 'number' && Number.isFinite(load.lateralXKN) && load.lateralXKN !== 0)
      || (typeof load.lateralYKN === 'number' && Number.isFinite(load.lateralYKN) && load.lateralYKN !== 0)
    );
  }));
}

function isLineEngineeringLoad(load: EngineeringDraftLoad): boolean {
  return load.kind === 'line' || load.kind === 'distributed' || load.unit === 'kN/m';
}

function isGravityLineLoad(load: EngineeringDraftLoad): boolean {
  return isLineEngineeringLoad(load)
    && load.magnitude > 0
    && (load.direction === undefined || load.direction === 'gravity' || load.direction === 'globalZ');
}

function isExplicit2dNodalLoad(load: EngineeringDraftLoad): boolean {
  return (load.kind === 'nodal' || load.kind === 'point')
    && load.magnitude > 0
    && Number.isFinite(load.magnitude)
    && isLocalizedFramePointLoad(load)
    && (load.direction === undefined || load.direction === 'globalX' || load.direction === 'gravity' || load.direction === 'globalZ');
}

export function hasFrameAnalysisLoadInput(state: Pick<DraftState, 'floorLoads' | 'engineeringDraft' | 'wind' | 'frameDimension'>): boolean {
  if (hasFloorLoadValue(state.floorLoads)) return true;
  if (typeof state.wind?.basicPressureKNM2 === 'number' && Number.isFinite(state.wind.basicPressureKNM2) && state.wind.basicPressureKNM2 > 0) {
    return true;
  }
  return Boolean(state.engineeringDraft?.loads?.some((load) => (
    load.magnitude > 0
    && Number.isFinite(load.magnitude)
    && (isGravityLineLoad(load) || (state.frameDimension !== '3d' && isExplicit2dNodalLoad(load)))
  )));
}

function isTopStoryLineLoadTarget(target: string): boolean {
  const trimmed = target.trim();
  const text = trimmed.toLowerCase();
  return text.includes('roof')
    || /屋面|屋顶|楼顶|顶层|顶楼/u.test(trimmed)
    || trimmed === '顶';
}

function parseLineLoadStory(target: string | undefined, storyCount: number): number | undefined {
  if (!target) return undefined;
  const text = target.toLowerCase();
  if (isTopStoryLineLoadTarget(target)) return storyCount;
  const numericMatch = text.match(/(?:floor|story|level)\s*([0-9]+)/i)
    ?? target.match(/第?\s*([0-9]+)\s*层/u);
  if (numericMatch?.[1]) {
    const parsed = Number.parseInt(numericMatch[1], 10);
    return parsed >= 1 && parsed <= storyCount ? parsed : undefined;
  }
  const chineseMatch = target.match(/第?\s*([一二两三四五六七八九十廿]+)\s*层/u);
  if (!chineseMatch?.[1]) return undefined;
  const table: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    廿: 20,
  };
  const raw = chineseMatch[1];
  let parsed: number | undefined;
  if (raw === '十' || raw === '廿') {
    parsed = table[raw];
  } else if (raw.startsWith('十')) {
    parsed = 10 + (table[raw[1]] ?? 0);
  } else if (raw.startsWith('廿')) {
    parsed = 20 + (table[raw[1]] ?? 0);
  } else if (raw.endsWith('十')) {
    parsed = (table[raw[0]] ?? 1) * 10;
  } else if (raw.includes('十')) {
    const [tens, ones] = raw.split('十');
    parsed = (table[tens] ?? 1) * 10 + (table[ones] ?? 0);
  } else {
    parsed = table[raw];
  }
  return parsed !== undefined && parsed >= 1 && parsed <= storyCount ? parsed : undefined;
}

function normalizeFloorLoadsByStory(floorLoads: DraftFloorLoad[]): DraftFloorLoad[] {
  const merged = new Map<number, DraftFloorLoad>();
  for (const load of floorLoads) {
    if (typeof load.story !== 'number' || !Number.isFinite(load.story)) continue;
    const current = merged.get(load.story);
    merged.set(load.story, {
      story: load.story,
      verticalKN: load.verticalKN ?? current?.verticalKN,
      liveLoadKN: load.liveLoadKN ?? current?.liveLoadKN,
      lateralXKN: load.lateralXKN ?? current?.lateralXKN,
      lateralYKN: load.lateralYKN ?? current?.lateralYKN,
    });
  }
  return Array.from(merged.values()).sort((left, right) => left.story - right.story);
}

type FrameNamedLoad = {
  record: Record<string, unknown>;
  caseId?: string;
  caseType?: EngineeringDraftLoadCaseType;
};

type FrameLoadCase = {
  id: string;
  type: EngineeringDraftLoadCaseType;
  loads: Array<Record<string, unknown>>;
  description?: string;
};

function buildFrameLoadCaseBundle(
  state: DraftState,
  hasDeadFloorLoads: boolean,
  hasLiveFloorLoads: boolean,
  lineLoads: FrameNamedLoad[],
  nodalLoads: FrameNamedLoad[],
): { load_cases: FrameLoadCase[]; load_combinations: EngineeringDraftLoadCombination[] } {
  const loadCases = new Map<string, FrameLoadCase>();
  const addLoadCase = (
    id: string,
    type: EngineeringDraftLoadCaseType,
    loads: Array<Record<string, unknown>>,
    description?: string,
  ): void => {
    const existing = loadCases.get(id);
    if (existing) {
      existing.loads.push(...loads);
      if (existing.type === 'other' && type !== 'other') existing.type = type;
      return;
    }
    loadCases.set(id, { id, type, loads: [...loads], ...(description ? { description } : {}) });
  };

  if (hasDeadFloorLoads) {
    addLoadCase('D', 'dead', [], 'Dead floor loads from stories.floor_loads');
  }
  if (hasLiveFloorLoads) {
    addLoadCase('L', 'live', [], 'Live floor loads from stories.floor_loads');
  }
  for (const lineLoad of lineLoads) {
    addLoadCase(
      lineLoad.caseId ?? 'LINE',
      lineLoad.caseType ?? 'other',
      [lineLoad.record],
      'Frame beam line loads',
    );
  }
  for (const nodalLoad of nodalLoads) {
    addLoadCase(
      nodalLoad.caseId ?? 'LAT',
      nodalLoad.caseType ?? 'other',
      [nodalLoad.record],
      'Frame nodal loads',
    );
  }
  if (!loadCases.size) {
    addLoadCase('LC1', 'other', []);
  }

  const explicitCombinations = state.engineeringDraft?.analysis?.loadCombinations;
  const loadCombinations = explicitCombinations?.length
    ? explicitCombinations.map((combination) => ({
        id: combination.id,
        factors: { ...combination.factors },
      }))
    : [{
        id: 'ULS',
        factors: Object.fromEntries(Array.from(loadCases.keys()).map((id) => [id, 1.0])),
      }];
  return {
    load_cases: Array.from(loadCases.values()),
    load_combinations: loadCombinations,
  };
}

type ResolvedFrameLineLoad = {
  load: EngineeringDraftLoad;
  story: number;
  elementId?: string;
};

function resolveFrameLineLoadsByStory(
  state: DraftState,
  storyCount: number,
  elements: Array<Record<string, unknown>>,
): ResolvedFrameLineLoad[] {
  const lineLoads = state.engineeringDraft?.loads?.filter(isGravityLineLoad) ?? [];
  if (!lineLoads.length || storyCount <= 0) return [];

  const resolved: ResolvedFrameLineLoad[] = [];
  for (const load of lineLoads) {
    const normalizedTarget = load.target?.trim().toLowerCase();
    const targetElement = normalizedTarget
      ? elements.find((element) => (
          element.type === 'beam'
          && String(element.id ?? '').trim().toLowerCase() === normalizedTarget
        ))
      : undefined;
    const targetStoryMatch = String(targetElement?.story ?? '').match(/^F(\d+)$/iu);
    const targetStory = targetStoryMatch ? Number.parseInt(targetStoryMatch[1]!, 10) : undefined;
    if (targetElement && targetStory !== undefined && targetStory >= 1 && targetStory <= storyCount) {
      resolved.push({ load, story: targetStory, elementId: String(targetElement.id) });
      continue;
    }

    const locationStory = load.location?.story;
    const explicitStory = typeof locationStory === 'number'
      && Number.isInteger(locationStory)
      && locationStory >= 1
      && locationStory <= storyCount
      ? locationStory
      : parseLineLoadStory(load.target, storyCount);
    if (explicitStory !== undefined) {
      resolved.push({ load, story: explicitStory });
      continue;
    }
    for (let story = 1; story <= storyCount; story += 1) {
      resolved.push({ load, story });
    }
  }
  return resolved;
}

function build2dBeamLineLoads(
  state: DraftState,
  storyCount: number,
  elements: Array<Record<string, unknown>>,
): FrameNamedLoad[] {
  const resolved = resolveFrameLineLoadsByStory(state, storyCount, elements);
  if (!resolved.length) return [];

  const loads: FrameNamedLoad[] = [];
  for (const item of resolved) {
    const storyId = `F${item.story}`;
    const storyBeams = elements.filter(
      (element) => element.type === 'beam' && element.story === storyId,
    );
    const spanIndex = item.load.location?.spanIndex;
    const targetBeams = item.elementId
      ? storyBeams.filter((element) => String(element.id) === item.elementId)
      : spanIndex === undefined
      ? storyBeams
      : Number.isInteger(spanIndex) && spanIndex >= 1 && spanIndex <= storyBeams.length
        ? [storyBeams[spanIndex - 1]]
        : [];
    for (const element of targetBeams) {
      loads.push({
        record: {
          type: 'distributed',
          element: element.id,
          wz: -Math.abs(item.load.magnitude),
          story: storyId,
          source: 'engineering_draft_line_loads',
        },
        caseId: item.load.caseId,
        caseType: item.load.caseType,
      });
    }
  }
  return loads;
}

function lineLoadTargetAxis(target: string | undefined): 'x' | 'y' | undefined {
  if (!target) return undefined;
  const text = target.toLowerCase();
  if (/(?:x\s*(?:direction|axis)|x[-\s]?[向轴]|沿\s*x)/iu.test(text)) return 'x';
  if (/(?:y\s*(?:direction|axis)|y[-\s]?[向轴]|沿\s*y)/iu.test(text)) return 'y';
  return undefined;
}

function build3dBeamLineLoads(
  state: DraftState,
  storyCount: number,
  elements: Array<Record<string, unknown>>,
): FrameNamedLoad[] {
  const resolved = resolveFrameLineLoadsByStory(state, storyCount, elements);
  if (!resolved.length) return [];

  const loads: FrameNamedLoad[] = [];
  for (const item of resolved) {
    const storyId = `F${item.story}`;
    const axis = lineLoadTargetAxis(item.load.target);
    for (const element of elements) {
      if (element.type !== 'beam' || element.story !== storyId) continue;
      if (item.elementId && String(element.id) !== item.elementId) continue;
      const id = String(element.id ?? '');
      if (axis === 'x' && !id.startsWith('BX')) continue;
      if (axis === 'y' && !id.startsWith('BY')) continue;
      loads.push({
        record: {
          type: 'distributed',
          element: element.id,
          wz: -Math.abs(item.load.magnitude),
          story: storyId,
          source: 'engineering_draft_line_loads',
        },
        caseId: item.load.caseId,
        caseType: item.load.caseType,
      });
    }
  }
  return loads;
}

function frame2dNodeIndex(nodeRole: string, nodeCount: number): number | undefined {
  const role = nodeRole.trim().toLowerCase();
  if (role.includes('right') || role.includes('end') || /右侧|右端/u.test(role)) return nodeCount - 1;
  if (role.includes('left') || role.includes('start') || /左侧|左端/u.test(role)) return 0;
  if (role.includes('middle') || role.includes('center') || role.includes('centre') || /中间|中央/u.test(role)) {
    return Math.floor((nodeCount - 1) / 2);
  }
  return undefined;
}

function build2dEngineeringNodalLoads(
  state: DraftState,
  storyCount: number,
  levelNodeCount: number,
): FrameNamedLoad[] {
  const loads: FrameNamedLoad[] = [];
  for (const load of state.engineeringDraft?.loads ?? []) {
    if (!isExplicit2dNodalLoad(load)) continue;
    const story = load.location!.story!;
    if (story > storyCount) continue;
    const nodeIndex = frame2dNodeIndex(load.location!.nodeRole!, levelNodeCount);
    if (nodeIndex === undefined) continue;

    const nodeLoad: Record<string, unknown> = {
      type: 'nodal',
      node: n2dId(story, nodeIndex),
      story: `F${story}`,
      source: 'engineering_draft_nodal_loads',
    };
    if (load.direction === 'globalX') {
      nodeLoad.fx = load.magnitude;
    } else {
      nodeLoad.fz = -Math.abs(load.magnitude);
    }
    loads.push({
      record: nodeLoad,
      caseId: load.caseId,
      caseType: load.caseType,
    });
  }
  return loads;
}

function uniqueSortedCoordinates(values: number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]!) > 1e-9);
}

function coordinateIntervals(values: number[]): number[] {
  return values.slice(1).map((value, index) => value - values[index]!);
}

function explicitFrameRestraints(
  restraints: boolean[] | undefined,
  dimension: '2d' | '3d',
): boolean[] | undefined {
  if (!restraints) return undefined;
  if (dimension === '3d' || !restraints.some(Boolean)) return [...restraints];
  const [ux, , uz, , ry] = restraints;
  if (ux && uz && ry) return [true, true, true, true, true, true];
  return [Boolean(ux), true, Boolean(uz), false, Boolean(ry), false];
}

function buildExplicitFrameTopologyModel(
  state: DraftState,
  matProps: ResolvedFrameMaterialProps,
  colProps: SectionProps,
  beamProps: SectionProps,
  metadata: Record<string, unknown>,
): Record<string, unknown> | null {
  const topology = state.engineeringDraft?.topology;
  if (!topology?.nodes?.length || !topology.members?.length) return null;

  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));
  if (nodeById.size !== topology.nodes.length
    || topology.members.some((member) => !nodeById.has(member.nodes[0]) || !nodeById.has(member.nodes[1]))) {
    return null;
  }

  const zCoords = uniqueSortedCoordinates(topology.nodes.map((node) => node.z));
  if (zCoords.length < 2) return null;
  const xCoords = uniqueSortedCoordinates(topology.nodes.map((node) => node.x));
  const yCoords = uniqueSortedCoordinates(topology.nodes.map((node) => node.y));
  const minZ = zCoords[0]!;
  const storyIndexAt = (z: number): number => zCoords.findIndex((value) => Math.abs(value - z) <= 1e-9);
  const baseSupport = (state.frameBaseSupportType as string | undefined) ?? 'fixed';
  const dimension = state.frameDimension === '3d' ? '3d' : '2d';

  const nodes: Array<Record<string, unknown>> = topology.nodes.map((node) => {
    const storyIndex = storyIndexAt(node.z);
    const restraints = explicitFrameRestraints(node.restraints, dimension);
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      z: node.z,
      ...(storyIndex > 0 ? { story: `F${storyIndex}` } : {}),
      ...(restraints
        ? { restraints }
        : Math.abs(node.z - minZ) <= 1e-9
          ? { restraints: buildBaseRestraint(baseSupport) }
          : {}),
    };
  });

  const elements: Array<Record<string, unknown>> = topology.members.map((member, index) => {
    const start = nodeById.get(member.nodes[0])!;
    const end = nodeById.get(member.nodes[1])!;
    const isColumn = Math.abs(start.x - end.x) <= 1e-9
      && Math.abs(start.y - end.y) <= 1e-9
      && Math.abs(start.z - end.z) > 1e-9;
    const storyIndex = storyIndexAt(Math.max(start.z, end.z));
    return {
      id: member.id ?? `E${index + 1}`,
      type: isColumn ? 'column' : 'beam',
      nodes: [...member.nodes],
      material: '1',
      section: isColumn ? '1' : '2',
      ...(storyIndex > 0 ? { story: `F${storyIndex}` } : {}),
    };
  });

  const floorLoads = normalizeFloorLoadsByStory(state.floorLoads ?? []);
  const areaLoads = (state.engineeringDraft?.loads ?? []).filter((load) => (
    load.kind === 'area'
    && load.unit === 'kN/m2'
    && load.magnitude > 0
    && Number.isFinite(load.magnitude)
  ));
  const floorAreaM2 = state.frameDimension === '3d'
    ? Math.max((xCoords.at(-1)! - xCoords[0]!) * (yCoords.at(-1)! - yCoords[0]!), 1)
    : Math.max(xCoords.at(-1)! - xCoords[0]!, 1);
  const stories = coordinateIntervals(zCoords).map((height, index) => {
    const story = index + 1;
    const floorLoad = floorLoads.find((load) => load.story === story);
    const explicitAreaLoads = areaLoads.filter((load) => (
      load.location?.story === story
      || (load.location?.story === undefined && areaLoads.length === 1)
    ));
    const deadAreaLoad = explicitAreaLoads.find((load) => load.caseType !== 'live' && load.caseId !== 'L');
    const liveAreaLoad = explicitAreaLoads.find((load) => load.caseType === 'live' || load.caseId === 'L');
    const deadLoad = deadAreaLoad?.magnitude
      ?? (floorLoad?.verticalKN ? Math.abs(floorLoad.verticalKN) / floorAreaM2 : undefined);
    const liveLoad = liveAreaLoad?.magnitude
      ?? (floorLoad?.liveLoadKN ? Math.abs(floorLoad.liveLoadKN) / floorAreaM2 : undefined);
    return {
      id: `F${story}`,
      height,
      elevation: zCoords[index],
      standard_floor_group: 'SF1',
      ...buildStoryFloorLoadFields(deadLoad, liveLoad),
    };
  });

  const lateralLoads: FrameNamedLoad[] = [];
  for (const floorLoad of floorLoads) {
    const storyNodes = topology.nodes.filter((node) => storyIndexAt(node.z) === floorLoad.story);
    if (!storyNodes.length) continue;
    for (const node of storyNodes) {
      const record: Record<string, unknown> = {
        type: 'nodal',
        node: node.id,
        story: `F${floorLoad.story}`,
        source: 'story_lateral_loads',
      };
      if (floorLoad.lateralXKN !== undefined) record.fx = floorLoad.lateralXKN / storyNodes.length;
      if (floorLoad.lateralYKN !== undefined) record.fy = floorLoad.lateralYKN / storyNodes.length;
      if (record.fx !== undefined || record.fy !== undefined) lateralLoads.push({ record });
    }
  }

  const lineLoads = state.frameDimension === '3d'
    ? build3dBeamLineLoads(state, stories.length, elements)
    : build2dBeamLineLoads(state, stories.length, elements);
  const loadCaseBundle = buildFrameLoadCaseBundle(
    state,
    stories.some((story) => 'dead_load' in story),
    stories.some((story) => 'live_load' in story),
    lineLoads,
    lateralLoads,
  );
  const elementReferenceVectors = state.frameDimension === '3d'
    ? buildElementReferenceVectors(elements, nodes)
    : undefined;

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
    stories,
    ...loadCaseBundle,
    metadata: {
      ...metadata,
      coordinateSemantics: STRUCTURAL_COORDINATE_SEMANTICS,
      topologySource: 'engineering-draft',
      ...(elementReferenceVectors ? { elementReferenceVectors } : {}),
      baseSupport,
      material: matProps.resolvedGrade,
      columnSection: colProps.name,
      beamSection: beamProps.name,
      storyCount: stories.length,
      ...(state.frameDimension === '3d'
        ? {
            bayCountX: Math.max(0, xCoords.length - 1),
            bayCountY: Math.max(0, yCoords.length - 1),
            geometry: {
              storyHeightsM: coordinateIntervals(zCoords),
              bayWidthsXM: coordinateIntervals(xCoords),
              bayWidthsYM: coordinateIntervals(yCoords),
            },
          }
        : {
            bayCount: Math.max(0, xCoords.length - 1),
            geometry: {
              storyHeightsM: coordinateIntervals(zCoords),
              bayWidthsM: coordinateIntervals(xCoords),
            },
          }),
      ...(colProps.substituted || beamProps.substituted ? {
        sectionSubstitutions: [colProps.substituted, beamProps.substituted].filter(Boolean),
      } : {}),
    },
  };
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
  const floorLoads = normalizeFloorLoadsByStory(state.floorLoads ?? []);
  const baseSupport = (state.frameBaseSupportType as string | undefined) ?? 'fixed';
  const xCoords = accumulateCoords(bayWidths);
  const zCoords = accumulateCoords(storyHeights);
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const lateralLoads: FrameNamedLoad[] = [];
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
      if (storyIdx === 0) node.restraints = buildBaseRestraint(baseSupport);
      nodes.push(node);
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let bayIdx = 0; bayIdx < xCoords.length; bayIdx++) {
      elements.push({ id: `C${elementId}`, type: 'column', nodes: [n2dId(storyIdx - 1, bayIdx), n2dId(storyIdx, bayIdx)], material: '1', section: '1', story: `F${storyIdx}` });
      elementId += 1;
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let bayIdx = 0; bayIdx < bayWidths.length; bayIdx++) {
      elements.push({ id: `B${elementId}`, type: 'beam', nodes: [n2dId(storyIdx, bayIdx), n2dId(storyIdx, bayIdx + 1)], material: '1', section: '2', story: `F${storyIdx}` });
      elementId += 1;
    }
  }

  const levelNodeCount = xCoords.length;
  for (const load of floorLoads) {
    const storyIdx = load.story;
    if (storyIdx <= 0 || storyIdx >= zCoords.length) continue;
    const storyId = `F${storyIdx}`;
    const lPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    for (let bayIdx = 0; bayIdx < xCoords.length; bayIdx++) {
      const nodeLoad: Record<string, unknown> = {
        type: 'nodal',
        node: n2dId(storyIdx, bayIdx),
        story: storyId,
        source: 'story_lateral_loads',
      };
      if (lPerNode !== undefined) nodeLoad.fx = lPerNode;
      if (nodeLoad.fx !== undefined) lateralLoads.push({ record: nodeLoad });
    }
  }
  lateralLoads.push(...build2dEngineeringNodalLoads(state, storyHeights.length, levelNodeCount));

  const stories = storyHeights.map((h, i) => {
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
      ...buildStoryFloorLoadFields(deadLoad, liveLoad),
    };
  });
  const lineLoads = build2dBeamLineLoads(state, storyHeights.length, elements);
  const loadCaseBundle = buildFrameLoadCaseBundle(
    state,
    hasFloorLoadValue(floorLoads, 'verticalKN'),
    hasFloorLoadValue(floorLoads, 'liveLoadKN'),
    lineLoads,
    lateralLoads,
  );

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
    stories,
    ...loadCaseBundle,
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
  const floorLoads = normalizeFloorLoadsByStory(state.floorLoads ?? []);
  const baseSupport = (state.frameBaseSupportType as string | undefined) ?? 'fixed';
  const xCoords = accumulateCoords(bayWidthsX);
  const yCoords = accumulateCoords(bayWidthsY);
  const zCoords = accumulateCoords(storyHeights);
  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const lateralLoads: FrameNamedLoad[] = [];
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
        if (storyIdx === 0) node.restraints = buildBaseRestraint(baseSupport);
        nodes.push(node);
      }
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        elements.push({ id: `C${elementId}`, type: 'column', nodes: [n3dId(storyIdx - 1, xIdx, yIdx), n3dId(storyIdx, xIdx, yIdx)], material: '1', section: '1', story: `F${storyIdx}` });
        elementId += 1;
      }
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < bayWidthsX.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        elements.push({ id: `BX${elementId}`, type: 'beam', nodes: [n3dId(storyIdx, xIdx, yIdx), n3dId(storyIdx, xIdx + 1, yIdx)], material: '1', section: '2', story: `F${storyIdx}` });
        elementId += 1;
      }
    }
  }

  for (let storyIdx = 1; storyIdx < zCoords.length; storyIdx++) {
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < bayWidthsY.length; yIdx++) {
        elements.push({ id: `BY${elementId}`, type: 'beam', nodes: [n3dId(storyIdx, xIdx, yIdx), n3dId(storyIdx, xIdx, yIdx + 1)], material: '1', section: '2', story: `F${storyIdx}` });
        elementId += 1;
      }
    }
  }

  const levelNodeCount = xCoords.length * yCoords.length;
  for (const load of floorLoads) {
    const storyIdx = load.story;
    if (storyIdx <= 0 || storyIdx >= zCoords.length) continue;
    const storyId = `F${storyIdx}`;
    const lxPerNode = load.lateralXKN !== undefined ? load.lateralXKN / levelNodeCount : undefined;
    const lyPerNode = load.lateralYKN !== undefined ? load.lateralYKN / levelNodeCount : undefined;
    for (let xIdx = 0; xIdx < xCoords.length; xIdx++) {
      for (let yIdx = 0; yIdx < yCoords.length; yIdx++) {
        const nodeLoad: Record<string, unknown> = {
          type: 'nodal',
          node: n3dId(storyIdx, xIdx, yIdx),
          story: storyId,
          source: 'story_lateral_loads',
        };
        if (lxPerNode !== undefined) nodeLoad.fx = lxPerNode;
        if (lyPerNode !== undefined) nodeLoad.fy = lyPerNode;
        if (nodeLoad.fx !== undefined || nodeLoad.fy !== undefined) lateralLoads.push({ record: nodeLoad });
      }
    }
  }

  const elementReferenceVectors = buildElementReferenceVectors(elements, nodes);
  const stories = storyHeights.map((h, i) => {
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
      ...buildStoryFloorLoadFields(deadLoad, liveLoad),
    };
  });
  const lineLoads = build3dBeamLineLoads(state, storyHeights.length, elements);
  const loadCaseBundle = buildFrameLoadCaseBundle(
    state,
    hasFloorLoadValue(floorLoads, 'verticalKN'),
    hasFloorLoadValue(floorLoads, 'liveLoadKN'),
    lineLoads,
    lateralLoads,
  );

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
    stories,
    ...loadCaseBundle,
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
  const explicitTopologyModel = buildExplicitFrameTopologyModel(state, matProps, colProps, beamProps, metadata);
  if (explicitTopologyModel) return explicitTopologyModel;
  if (state.frameDimension === '3d') {
    return buildFrame3dLocalModel(state, matProps, colProps, beamProps, metadata);
  }
  return buildFrame2dLocalModel(state, matProps, colProps, beamProps, metadata);
}

export function buildFrameModel(state: DraftState): Record<string, unknown> | undefined {
  const critical = computeMissingCriticalKeys(state).filter((key) => (
    (REQUIRED_KEYS as readonly string[]).includes(key)
    && !(key === 'floorLoads' && hasFrameAnalysisLoadInput(state))
  ));
  if (critical.length > 0) return undefined;
  return withCanonicalCoordinateContract(
    buildFrameLocalModel(state),
    state.frameDimension === '3d' ? '3d' : '2d',
  );
}
