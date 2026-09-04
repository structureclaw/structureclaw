import {
  withCanonicalCoordinateContract,
} from '../../../agent-runtime/coordinate-semantics.js';
import type { DraftFloorLoad, DraftState } from '../../../agent-runtime/types.js';
import {
  DEFAULT_CONCRETE_GRADE,
  DEFAULT_REBAR_GRADE,
  toPositiveNumber,
} from './constants.js';
import { buildShearWallDesignSummary, parseSeismicGrade, suggestSeismicGradeFromIntensity } from './design.js';
import type { ShearWallDesignSummary, WallStoryDesign } from './types.js';

interface ConcreteGradeMaterial {
  grade: string;
  fc: number;
  ft: number;
  Ec: number;
}

/** Concrete design values (N/mm²) — GB/T 50010 table 4.1.4 (subset for walls). */
const CONCRETE_GRADES: Record<string, ConcreteGradeMaterial> = {
  C20: { grade: 'C20', fc: 9.6, ft: 1.1, Ec: 25500 },
  C25: { grade: 'C25', fc: 11.9, ft: 1.27, Ec: 28000 },
  C30: { grade: 'C30', fc: 14.3, ft: 1.43, Ec: 30000 },
  C35: { grade: 'C35', fc: 16.7, ft: 1.57, Ec: 31500 },
  C40: { grade: 'C40', fc: 19.1, ft: 1.71, Ec: 32500 },
  C45: { grade: 'C45', fc: 21.1, ft: 1.8, Ec: 33500 },
  C50: { grade: 'C50', fc: 23.1, ft: 1.89, Ec: 34500 },
  C55: { grade: 'C55', fc: 25.3, ft: 1.96, Ec: 35500 },
  C60: { grade: 'C60', fc: 27.5, ft: 2.04, Ec: 36000 },
};

interface RebarGradeMaterial {
  grade: string;
  fy: number;
  Es: number;
}

/** Rebar design values (N/mm²) — GB/T 50010 table 4.2.3-1 (subset). */
const REBAR_GRADES: Record<string, RebarGradeMaterial> = {
  HPB300: { grade: 'HPB300', fy: 270, Es: 210000 },
  HRB400: { grade: 'HRB400', fy: 360, Es: 200000 },
  HRB500: { grade: 'HRB500', fy: 435, Es: 200000 },
};

export function isValidConcreteGrade(grade: string): boolean {
  return grade.toUpperCase() in CONCRETE_GRADES;
}

export function isValidRebarGrade(grade: string): boolean {
  return grade.toUpperCase() in REBAR_GRADES;
}

export function normalizeConcreteGrade(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeRebarGrade(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function resolveConcreteMaterial(grade: string | undefined): ConcreteGradeMaterial {
  const normalized = grade && isValidConcreteGrade(grade) ? normalizeConcreteGrade(grade) : DEFAULT_CONCRETE_GRADE;
  return CONCRETE_GRADES[normalized]!;
}

export function resolveRebarMaterial(grade: string | undefined): RebarGradeMaterial {
  const normalized = grade && isValidRebarGrade(grade) ? normalizeRebarGrade(grade) : DEFAULT_REBAR_GRADE;
  return REBAR_GRADES[normalized]!;
}

const SEISMIC_GRADE_KEYS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
};

export function resolveWallThicknessMm(state: DraftState, summary: ShearWallDesignSummary): number {
  const provided = toPositiveNumber(state.wallThicknessMm);
  return provided ?? Math.max(...summary.stories.map((story) => story.thicknessMm));
}

export function hasShearWallAnalysisLoadInput(state: DraftState): boolean {
  return Boolean(state.floorLoads?.some((load) => (
    [load.verticalKN, load.liveLoadKN, load.lateralXKN, load.lateralYKN]
      .some((value) => value !== undefined && Number.isFinite(value) && value !== 0)
  )));
}

function normalizeFloorLoadsByStory(floorLoads: DraftFloorLoad[], storyCount: number): DraftFloorLoad[] {
  const byStory = new Map<number, DraftFloorLoad>();
  for (const load of floorLoads) {
    if (load.story < 1 || load.story > storyCount) continue;
    const current = byStory.get(load.story);
    byStory.set(load.story, {
      story: load.story,
      verticalKN: load.verticalKN ?? current?.verticalKN,
      liveLoadKN: load.liveLoadKN ?? current?.liveLoadKN,
      lateralXKN: load.lateralXKN ?? current?.lateralXKN,
      lateralYKN: load.lateralYKN ?? current?.lateralYKN,
    });
  }
  return [...byStory.values()].sort((left, right) => left.story - right.story);
}

function wallSectionRecord(
  id: string,
  thicknessMm: number,
  pierLengthMm: number,
  concrete: ConcreteGradeMaterial,
): Record<string, unknown> {
  const t = thicknessMm;
  const L = pierLengthMm;
  const areaMm2 = t * L;
  const iyMm4 = (t * L ** 3) / 12; // in-plane bending of the wall pier
  const izMm4 = (L * t ** 3) / 12;
  return {
    id,
    name: `WALL${Math.round(t)}X${Math.round(L)}`,
    type: 'rectangular',
    purpose: 'wall',
    width: t,
    height: L,
    thickness: t,
    wallLength: L,
    shape: { kind: 'rectangular', B: t, H: L, T: t },
    properties: {
      A: areaMm2 / 1e6,
      Iy: iyMm4 / 1e12,
      Iz: izMm4 / 1e12,
      J: izMm4 / 1e12,
      G: concrete.Ec / (2 * (1 + 0.2)),
    },
  };
}

function couplingBeamSectionRecord(
  id: string,
  thicknessMm: number,
  heightMm: number,
  concrete: ConcreteGradeMaterial,
): Record<string, unknown> {
  const areaMm2 = thicknessMm * heightMm;
  const iyMm4 = (thicknessMm * heightMm ** 3) / 12;
  const izMm4 = (heightMm * thicknessMm ** 3) / 12;
  return {
    id,
    name: `CB${Math.round(thicknessMm)}X${Math.round(heightMm)}`,
    type: 'rectangular',
    purpose: 'beam',
    width: thicknessMm,
    height: heightMm,
    shape: { kind: 'rectangular', B: thicknessMm, H: heightMm },
    properties: {
      A: areaMm2 / 1e6,
      Iy: iyMm4 / 1e12,
      Iz: izMm4 / 1e12,
      J: izMm4 / 1e12,
      G: concrete.Ec / (2 * (1 + 0.2)),
    },
  };
}

/**
 * Build a 2D equivalent-frame shear wall elevation model.
 * Wall piers emit `type: "wall"` line elements and coupling beams emit
 * `type: "beam"` elements with `wallRole: "coupling-beam"`.
 */
export function buildShearWallModel(state: DraftState): Record<string, unknown> | undefined {
  const storyCount = state.storyCount;
  const storyHeightsM = state.storyHeightsM;
  const wallLengthM = toPositiveNumber(state.wallLengthM);
  if (storyCount === undefined || !storyHeightsM?.length || wallLengthM === undefined) {
    return undefined;
  }
  if (storyHeightsM.length !== storyCount || !hasShearWallAnalysisLoadInput(state)) {
    return undefined;
  }

  const concrete = resolveConcreteMaterial(state.wallConcreteGrade as string | undefined);
  const rebar = resolveRebarMaterial(state.wallRebarGrade as string | undefined);
  const rawOpenings = Array.isArray(state.wallOpenings) ? state.wallOpenings : [];
  const providedGrade = parseSeismicGrade(state.seismicGrade)
    ?? suggestSeismicGradeFromIntensity(state.siteSeismic?.intensity);

  const summary = buildShearWallDesignSummary({
    wallLengthM,
    storyHeightsM,
    openings: rawOpenings,
    seismicGrade: providedGrade,
    thicknessMm: toPositiveNumber(state.wallThicknessMm),
  });
  const thicknessMm = resolveWallThicknessMm(state, summary);
  const frameBaseSupportType = state.frameBaseSupportType === 'pinned' ? 'pinned' : 'fixed';
  const restraints = frameBaseSupportType === 'pinned'
    ? [true, true, true, false, false, false]
    : [true, true, true, true, true, true];

  // Elevation grid: story levels (z) and pier boundary x coordinates.
  const zLevels: number[] = [0];
  for (const height of storyHeightsM) {
    zLevels.push(zLevels[zLevels.length - 1]! + height);
  }
  const pierXs = [0];
  for (const opening of summary.openings) {
    pierXs.push(opening.xM);
    pierXs.push(opening.xM + opening.widthM);
  }
  pierXs.push(wallLengthM);

  const nodes: Array<Record<string, unknown>> = [];
  const elements: Array<Record<string, unknown>> = [];
  const deadLoads: Array<Record<string, unknown>> = [];
  const liveLoads: Array<Record<string, unknown>> = [];
  const lateralLoads: Array<Record<string, unknown>> = [];

  const wallSectionIds = new Map<string, string>();
  const couplingSectionIds = new Map<number, string>();
  let wallSectionId = 10;
  let couplingSectionId = 20;

  for (let level = 0; level <= storyCount; level += 1) {
    for (let xIndex = 0; xIndex < pierXs.length; xIndex += 1) {
      const node: Record<string, unknown> = {
        id: `N${level + 1}-${xIndex + 1}`,
        x: pierXs[xIndex],
        y: 0,
        z: zLevels[level],
        ...(level > 0 ? { story: `F${level}` } : {}),
      };
      if (level === 0) node.restraints = restraints;
      nodes.push(node);
    }
  }

  let elementId = 1;
  for (let story = 1; story <= storyCount; story += 1) {
    const storyDesign = summary.stories[story - 1] as WallStoryDesign;
    const storyThickness = toPositiveNumber(state.wallThicknessMm) ?? storyDesign.thicknessMm;

    // Vertical wall piers for solid segments; opening spans only receive the
    // horizontal coupling beam at the story top level.
    for (let pierIndex = 0; pierIndex < pierXs.length - 1; pierIndex += 1) {
      const x0 = pierXs[pierIndex]!;
      const lengthM = pierXs[pierIndex + 1]! - x0;
      if (lengthM <= 1e-6) continue;
      const isOpening = summary.openings.some((opening) => Math.abs(opening.xM - x0) < 1e-9);
      if (isOpening) continue;
      const lengthMm = Math.round(lengthM * 1000);
      const sectionKey = `${lengthMm}x${Math.round(storyThickness)}`;
      let sectionId = wallSectionIds.get(sectionKey);
      if (!sectionId) {
        sectionId = String(wallSectionId);
        wallSectionId += 1;
        wallSectionIds.set(sectionKey, sectionId);
      }
      const isBottomStrengthenedZone = storyDesign.isBottomStrengthenedZone;
      elements.push({
        id: `W${elementId}`,
        type: 'wall',
        nodes: [`N${story}-${pierIndex + 1}`, `N${story + 1}-${pierIndex + 1}`],
        material: '1',
        section: sectionId,
        story: `F${story}`,
        concrete_grade: concrete.grade,
        rebar_grade: rebar.grade,
        seismicGrade: summary.seismicGradeLabel,
        wallRole: 'wall-pier',
        shearWall: {
          thicknessMm: storyThickness,
          storyHeightMm: Math.round(storyDesign.storyHeightM * 1000),
          isBottomStrengthenedZone,
          hasEndColumn: false,
          lengthMm,
        },
      });
      elementId += 1;
    }

    // Coupling beams over openings at the story top level. Openings are
    // sorted, so each opening's left edge sits at grid index 2*i+1.
    for (let openingIndex = 0; openingIndex < summary.openings.length; openingIndex += 1) {
      const beam = summary.couplingBeams[openingIndex]!;
      const leftXIndex = 2 * openingIndex + 1;
      const heightMm = Math.round(beam.heightMm);
      let sectionId = couplingSectionIds.get(heightMm);
      if (!sectionId) {
        sectionId = String(couplingSectionId);
        couplingSectionId += 1;
        couplingSectionIds.set(heightMm, sectionId);
      }
      elements.push({
        id: `CB${elementId}`,
        type: 'beam',
        nodes: [`N${story + 1}-${leftXIndex + 1}`, `N${story + 1}-${leftXIndex + 2}`],
        material: '1',
        section: sectionId,
        story: `F${story}`,
        concrete_grade: concrete.grade,
        rebar_grade: rebar.grade,
        seismicGrade: summary.seismicGradeLabel,
        wallRole: 'coupling-beam',
        couplingBeam: {
          spanM: beam.spanM,
          heightMm,
          spanDepthRatio: beam.spanDepthRatio,
        },
      });
      elementId += 1;
    }
  }

  // Sections are collected after the element loop so only used sections ship.
  const sections: Array<Record<string, unknown>> = [];
  const wallSectionKeys = [...wallSectionIds.keys()];
  const wallSectionIdValues = [...wallSectionIds.values()];
  for (let index = 0; index < wallSectionIdValues.length; index += 1) {
    const [lengthMm, thickness] = (wallSectionKeys[index] as string).split('x').map(Number);
    sections.push(wallSectionRecord(wallSectionIdValues[index]!, thickness!, lengthMm!, concrete));
  }
  const couplingHeightMmValues = [...couplingSectionIds.keys()];
  const couplingSectionIdValues = [...couplingSectionIds.values()];
  for (let index = 0; index < couplingSectionIdValues.length; index += 1) {
    sections.push(couplingBeamSectionRecord(
      couplingSectionIdValues[index]!,
      thicknessMm,
      couplingHeightMmValues[index]!,
      concrete,
    ));
  }

  // Story loads → nodal loads along the wall line.
  const floorLoads = normalizeFloorLoadsByStory(state.floorLoads ?? [], storyCount);
  for (const load of floorLoads) {
    const storyId = `F${load.story}`;
    const nodeIds = pierXs.map((_x, xIndex) => `N${load.story + 1}-${xIndex + 1}`);
    const nodeCount = nodeIds.length;
    if (load.verticalKN !== undefined && load.verticalKN !== 0) {
      const perNode = -Math.abs(load.verticalKN) / nodeCount;
      for (const nodeId of nodeIds) {
        deadLoads.push({ type: 'nodal', node: nodeId, story: storyId, fz: perNode, source: 'story_gravity_loads' });
      }
    }
    if (load.liveLoadKN !== undefined && load.liveLoadKN !== 0) {
      const perNode = -Math.abs(load.liveLoadKN) / nodeCount;
      for (const nodeId of nodeIds) {
        liveLoads.push({ type: 'nodal', node: nodeId, story: storyId, fz: perNode, source: 'story_live_loads' });
      }
    }
    if (load.lateralXKN !== undefined && load.lateralXKN !== 0) {
      const perNode = load.lateralXKN / nodeCount;
      for (const nodeId of nodeIds) {
        lateralLoads.push({ type: 'nodal', node: nodeId, story: storyId, fx: perNode, source: 'story_lateral_loads' });
      }
    }
  }

  const loadCases: Array<Record<string, unknown>> = [];
  if (deadLoads.length) loadCases.push({ id: 'D', type: 'dead', loads: deadLoads });
  if (liveLoads.length) loadCases.push({ id: 'L', type: 'live', loads: liveLoads });
  if (lateralLoads.length) loadCases.push({ id: 'LAT', type: 'other', loads: lateralLoads });
  if (!loadCases.length) loadCases.push({ id: 'LC1', type: 'other', loads: [] });
  const factors = Object.fromEntries(loadCases.map((loadCase) => [String(loadCase.id), 1.0]));

  const stories = storyHeightsM.map((height, index) => {
    const fl = floorLoads.find((load) => load.story === index + 1);
    return {
      id: `F${index + 1}`,
      height,
      elevation: zLevels[index],
      standard_floor_group: 'SF1',
      dead_load: fl?.verticalKN !== undefined ? Math.abs(fl.verticalKN) / Math.max(wallLengthM, 1) : undefined,
      live_load: fl?.liveLoadKN !== undefined ? Math.abs(fl.liveLoadKN) / Math.max(wallLengthM, 1) : undefined,
    };
  });

  const model: Record<string, unknown> = {
    schema_version: '2.0.0',
    unit_system: 'SI',
    project: {
      code_standard: 'GB50011-2010',
      extra: { designCode: 'GB50011' },
    },
    structure_system: {
      type: 'shear-wall',
      seismic_grade: providedGrade !== undefined ? SEISMIC_GRADE_KEYS[providedGrade] : 'none',
      extra: { materialSystem: 'reinforced-concrete' },
    },
    materials: [
      {
        id: '1',
        name: concrete.grade,
        grade: concrete.grade,
        category: 'concrete',
        E: concrete.Ec,
        nu: 0.2,
        rho: 2500,
        fc: concrete.fc,
        ft: concrete.ft,
      },
      {
        id: '2',
        name: rebar.grade,
        grade: rebar.grade,
        category: 'rebar',
        E: rebar.Es,
        nu: 0.3,
        rho: 7850,
        fy: rebar.fy,
      },
    ],
    sections,
    nodes,
    elements,
    stories,
    load_cases: loadCases,
    load_combinations: [{ id: 'ULS', factors, combination_type: 'uls', code_reference: 'GB50011' }],
    metadata: {
      source: 'shear-wall-skill-draft',
      inferredType: 'frame',
      structuralTypeKey: 'shear-wall',
      materialSystem: 'reinforced-concrete',
      designCode: 'GB50011',
      baseSupport: frameBaseSupportType,
      concreteGrade: concrete.grade,
      rebarGrade: rebar.grade,
      wallLengthM,
      wallThicknessMm: thicknessMm,
      seismicGrade: summary.seismicGradeLabel,
      wallDesign: {
        bottomStrengthenedStoryCount: summary.bottomStrengthenedStoryCount,
        openingAreaRatio: summary.openingAreaRatio,
        distributedReinforcementRatio: summary.distributedReinforcementRatio,
        boundaryElementNote: summary.boundaryElementNote,
        piers: summary.piers,
        couplingBeams: summary.couplingBeams,
      },
    },
    extensions: {
      pkpm: { materialSystem: 'reinforced-concrete', designCode: 'GB50011' },
      yjk: { materialSystem: 'reinforced-concrete', designCode: 'GB50011' },
      wallDesign: {
        wallLengthM,
        wallThicknessMm: thicknessMm,
        seismicGrade: summary.seismicGradeLabel,
        stories: summary.stories,
        piers: summary.piers,
        couplingBeams: summary.couplingBeams,
        openings: summary.openings,
        distributedReinforcementRatio: summary.distributedReinforcementRatio,
      },
    },
  };
  // Drop empty semantic maps so payload mirrors the provided inputs.
  if (!rawOpenings.length) {
    const wallDesignExtensions = (model.extensions as Record<string, unknown>).wallDesign as Record<string, unknown>;
    delete wallDesignExtensions.openings;
  }

  return withCanonicalCoordinateContract(model, '2d');
}
