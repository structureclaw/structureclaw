import { withCanonicalCoordinateContract } from '../../../agent-runtime/coordinate-semantics.js';
import type { DraftFloorLoad, DraftState } from '../../../agent-runtime/types.js';
import {
  DEFAULT_CONCRETE_GRADE,
  DEFAULT_STEEL_GRADE,
  DEFAULT_STUD_DIAMETER_MM,
  toPositiveNumberFromUnknown,
} from './constants.js';
import { buildCompositeDesignSummary, resolveConcreteMaterial, resolveSteelMaterial, resolveSteelSection } from './design.js';
import type { CompositeDesignSummary, CompositeDraftState } from './types.js';

interface SteelGradeMaterial {
  grade: string;
  fy: number;
  Es: number;
}

function toPositiveNumber(value: unknown): number | undefined {
  return toPositiveNumberFromUnknown(value);
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

export function hasCompositeAnalysisLoadInput(state: DraftState): boolean {
  return Boolean(state.floorLoads?.some((load) => (
    [load.verticalKN, load.liveLoadKN, load.lateralXKN, load.lateralYKN]
      .some((value) => value !== undefined && Number.isFinite(value) && value !== 0)
  )));
}

function steelSectionRecord(
  id: string,
  purpose: 'beam' | 'column',
  steelSection: ReturnType<typeof resolveSteelSection>,
  steel: SteelGradeMaterial,
): Record<string, unknown> {
  const siFactor = 1e-6;
  const inertiaFactor = 1e-12;
  return {
    id,
    name: steelSection.name,
    type: 'H',
    purpose,
    standard_steel_name: steelSection.standardSteelName,
    shape: steelSection.shape,
    properties: {
      A: steelSection.A * siFactor,
      Iy: steelSection.Iy * inertiaFactor,
      Iz: steelSection.Iz * inertiaFactor,
      J: steelSection.J * inertiaFactor,
      G: steel.Es / (2 * (1 + 0.3)),
    },
  };
}

/**
 * Build a 2D composite frame elevation model.
 * Columns are steel H-sections; beams are steel H-sections carrying the
 * concrete flange and shear stud design data in `compositeBeam` element data.
 */
export function buildCompositeModel(state: DraftState): Record<string, unknown> | undefined {
  const storyCount = state.storyCount;
  const storyHeightsM = state.storyHeightsM;
  const bayWidthsM = state.bayWidthsM;
  if (
    storyCount === undefined
    || !storyHeightsM?.length
    || !bayWidthsM?.length
    || storyHeightsM.length !== storyCount
    || !hasCompositeAnalysisLoadInput(state)
  ) {
    return undefined;
  }
  const bayCount = bayWidthsM.length;

  const draft = state as CompositeDraftState;
  const steelMaterial = resolveSteelMaterial(draft.compositeSteelGrade ?? DEFAULT_STEEL_GRADE);
  const concreteMaterial = resolveConcreteMaterial(draft.compositeConcreteGrade ?? DEFAULT_CONCRETE_GRADE);
  const studDiameterMm = toPositiveNumber(draft.compositeStudDiameterMm) ?? DEFAULT_STUD_DIAMETER_MM;
  const slabThicknessMm = toPositiveNumber(draft.compositeSlabThicknessMm);
  if (slabThicknessMm === undefined) {
    return undefined;
  }

  const summary: CompositeDesignSummary = buildCompositeDesignSummary({
    bayWidthsM,
    storyCount,
    slabThicknessMm,
    slabWidthM: toPositiveNumber(draft.compositeSlabWidthM),
    steelBeamSection: draft.compositeSteelBeamSection,
    steelColumnSection: draft.compositeSteelColumnSection,
    steelGrade: draft.compositeSteelGrade,
    concreteGrade: draft.compositeConcreteGrade,
    studDiameterMm,
  });

  const frameBaseSupportType = state.frameBaseSupportType === 'pinned' ? 'pinned' : 'fixed';
  const restraints = frameBaseSupportType === 'pinned'
    ? [true, true, true, false, false, false]
    : [true, true, true, true, true, true];

  // Elevation grid: story levels (z) and bay boundary x coordinates.
  const zLevels: number[] = [0];
  for (const height of storyHeightsM) {
    zLevels.push(zLevels[zLevels.length - 1]! + height);
  }
  const xLevels: number[] = [0];
  for (const width of bayWidthsM) {
    xLevels.push(xLevels[xLevels.length - 1]! + width);
  }

  const nodes: Array<Record<string, unknown>> = [];
  for (let level = 0; level <= storyCount; level += 1) {
    for (let xIndex = 0; xIndex <= bayCount; xIndex += 1) {
      const node: Record<string, unknown> = {
        id: `N${level + 1}-${xIndex + 1}`,
        x: xLevels[xIndex],
        y: 0,
        z: zLevels[level],
        ...(level > 0 ? { story: `F${level}` } : {}),
      };
      if (level === 0) node.restraints = restraints;
      nodes.push(node);
    }
  }

  const beamSteel = resolveSteelSection(draft.compositeSteelBeamSection, 'beam', storyCount);
  const columnSteel = resolveSteelSection(draft.compositeSteelColumnSection, 'column', storyCount);
  const beamDesignBySpan = new Map(summary.beams.map((beam) => [beam.spanM, beam]));

  const elements: Array<Record<string, unknown>> = [];
  let columnCount = 0;
  let beamCount = 0;
  for (let story = 1; story <= storyCount; story += 1) {
    for (let xIndex = 0; xIndex <= bayCount; xIndex += 1) {
      columnCount += 1;
      elements.push({
        id: `C${columnCount}`,
        type: 'column',
        nodes: [`N${story}-${xIndex + 1}`, `N${story + 1}-${xIndex + 1}`],
        material: '1',
        section: '2',
        story: `F${story}`,
        steel_grade: steelMaterial.grade,
        compositeRole: 'steel-column',
      });
    }
    for (let bayIndex = 0; bayIndex < bayCount; bayIndex += 1) {
      beamCount += 1;
      const beamDesign = beamDesignBySpan.get(bayWidthsM[bayIndex]!) ?? summary.beams[0]!;
      elements.push({
        id: `B${beamCount}`,
        type: 'beam',
        nodes: [`N${story + 1}-${bayIndex + 1}`, `N${story + 1}-${bayIndex + 2}`],
        material: '1',
        section: '1',
        story: `F${story}`,
        steel_grade: steelMaterial.grade,
        concrete_grade: concreteMaterial.grade,
        compositeRole: 'composite-beam',
        compositeBeam: {
          slabThicknessMm: beamDesign.slabThicknessMm,
          effectiveSlabWidthMm: beamDesign.effectiveSlabWidthMm,
          studDiameterMm: beamDesign.studDiameterMm,
          studLayout: {
            studsPerHalfSpan: beamDesign.studsPerHalfSpan,
            studRows: beamDesign.studRows,
            studPitchMm: beamDesign.studPitchMm,
            fullShearConnection: beamDesign.fullShearConnection,
          },
          flexuralCapacityKNM: beamDesign.flexuralCapacityKNM,
          pnaInSteel: beamDesign.pnaInSteel,
        },
      });
    }
  }

  // Story loads → nodal loads along the floor nodes.
  const sections = [
    steelSectionRecord('1', 'beam', beamSteel, steelMaterial),
    steelSectionRecord('2', 'column', columnSteel, steelMaterial),
  ];

  const floorLoads = normalizeFloorLoadsByStory(state.floorLoads ?? [], storyCount);
  const deadLoads: Array<Record<string, unknown>> = [];
  const liveLoads: Array<Record<string, unknown>> = [];
  const lateralLoads: Array<Record<string, unknown>> = [];
  for (const load of floorLoads) {
    const storyId = `F${load.story}`;
    const nodeIds = Array.from({ length: bayCount + 1 }, (_value, xIndex) => `N${load.story + 1}-${xIndex + 1}`);
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

  const totalWidthM = bayWidthsM.reduce((sum, width) => sum + width, 0);
  const stories = storyHeightsM.map((height, index) => {
    const fl = floorLoads.find((load) => load.story === index + 1);
    return {
      id: `F${index + 1}`,
      height,
      elevation: zLevels[index],
      standard_floor_group: 'SF1',
      dead_load: fl?.verticalKN !== undefined ? Math.abs(fl.verticalKN) / Math.max(totalWidthM, 1) : undefined,
      live_load: fl?.liveLoadKN !== undefined ? Math.abs(fl.liveLoadKN) / Math.max(totalWidthM, 1) : undefined,
    };
  });

  const compositeDesignMetadata = {
    slabThicknessMm: summary.slabThicknessMm,
    slabWidthSource: summary.slabWidthSource,
    effectiveSlabWidthMm: summary.effectiveSlabWidthMm,
    steelGrade: summary.steelGrade,
    concreteGrade: summary.concreteGrade,
    studDiameterMm,
    beams: summary.beams,
    columns: summary.columns,
    verificationNote: summary.verificationNote,
  };

  const model: Record<string, unknown> = {
    schema_version: '2.0.0',
    unit_system: 'SI',
    project: {
      code_standard: 'GB50017-2017',
      extra: { designCode: 'GB50017' },
    },
    structure_system: {
      type: 'composite',
      extra: { materialSystem: 'steel-concrete-composite' },
    },
    materials: [
      {
        id: '1',
        name: steelMaterial.grade,
        grade: steelMaterial.grade,
        category: 'steel',
        E: steelMaterial.Es,
        nu: 0.3,
        rho: 7850,
        fy: steelMaterial.fy,
      },
      {
        id: '2',
        name: concreteMaterial.grade,
        grade: concreteMaterial.grade,
        category: 'concrete',
        E: concreteMaterial.Ec,
        nu: 0.2,
        rho: 2500,
        fc: concreteMaterial.fc,
      },
    ],
    sections,
    nodes,
    elements,
    stories,
    load_cases: loadCases,
    load_combinations: [{ id: 'ULS', factors, combination_type: 'uls', code_reference: 'GB50017' }],
    metadata: {
      source: 'composite-skill-draft',
      inferredType: 'frame',
      structuralTypeKey: 'composite',
      materialSystem: 'steel-concrete-composite',
      designCode: 'GB50017',
      baseSupport: frameBaseSupportType,
      steelGrade: steelMaterial.grade,
      concreteGrade: concreteMaterial.grade,
      slabThicknessMm: summary.slabThicknessMm,
      beamSection: beamSteel.name,
      columnSection: columnSteel.name,
      compositeDesign: compositeDesignMetadata,
    },
    extensions: {
      pkpm: { materialSystem: 'steel-concrete-composite', designCode: 'GB50017' },
      yjk: { materialSystem: 'steel-concrete-composite', designCode: 'GB50017' },
      compositeDesign: compositeDesignMetadata,
    },
  };

  return withCanonicalCoordinateContract(model, '2d');
}
