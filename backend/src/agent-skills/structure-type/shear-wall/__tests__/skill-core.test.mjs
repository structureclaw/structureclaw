import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/shear-wall/handler.js';
import { detectShearWallStructuralType } from '../../../../../dist/agent-skills/structure-type/shear-wall/detect.js';
import {
  buildShearWallPatchFromLlm,
  parseShearWallProvidedValues,
} from '../../../../../dist/agent-skills/structure-type/shear-wall/extract-llm.js';
import { mergeShearWallState } from '../../../../../dist/agent-skills/structure-type/shear-wall/merge.js';
import {
  buildShearWallDefaultProposals,
  buildShearWallQuestions,
  buildShearWallReportNarrative,
  computeShearWallMissing,
  mapShearWallLabels,
  resolveShearWallStage,
} from '../../../../../dist/agent-skills/structure-type/shear-wall/interaction.js';
import {
  buildShearWallDesignSummary,
  computeBottomStrengthenedStoryCount,
  designCouplingBeam,
  distributedReinforcementRatio,
  estimateWallThicknessMm,
  parseSeismicGrade,
  splitWallIntoPiers,
  suggestSeismicGradeFromIntensity,
} from '../../../../../dist/agent-skills/structure-type/shear-wall/design.js';
import { buildShearWallModel } from '../../../../../dist/agent-skills/structure-type/shear-wall/model.js';

function buildCompleteState(overrides = {}) {
  return {
    inferredType: 'frame',
    structuralTypeKey: 'shear-wall',
    skillId: 'shear-wall',
    storyCount: 2,
    storyHeightsM: [3, 3],
    floorLoads: [
      { story: 1, verticalKN: 200, liveLoadKN: 50, lateralXKN: 40 },
      { story: 2, verticalKN: 200, liveLoadKN: 50, lateralXKN: 40 },
    ],
    wallLengthM: 6,
    wallThicknessMm: 200,
    wallConcreteGrade: 'C30',
    wallRebarGrade: 'HRB400',
    seismicGrade: '二级',
    wallOpenings: [{ xM: 2.25, widthM: 1.5, heightM: 2.1, sillM: 0 }],
    frameBaseSupportType: 'fixed',
    updatedAt: 0,
    ...overrides,
  };
}

describe('shear-wall detection and trigger routing', () => {
  test('detects chinese shear wall keywords', () => {
    const result = detectShearWallStructuralType({ message: '12层剪力墙结构，墙厚200mm', locale: 'zh' });
    expect(result?.key).toBe('shear-wall');
    expect(result?.skillId).toBe('shear-wall');
    expect(result?.mappedType).toBe('frame');
    expect(result?.supportLevel).toBe('supported');
  });

  test('detects english shear wall keywords', () => {
    const result = detectShearWallStructuralType({ message: 'A 10-story shear wall with 200 mm thickness', locale: 'en' });
    expect(result?.key).toBe('shear-wall');
    expect(result?.supportLevel).toBe('supported');
  });

  test('detects frame-shear wall dual system wording', () => {
    const result = detectShearWallStructuralType({ message: '框架剪力墙结构，8度设防', locale: 'zh' });
    expect(result?.key).toBe('shear-wall');
    expect(result?.skillId).toBe('shear-wall');
  });

  test('detects core tube wording', () => {
    const result = detectShearWallStructuralType({ message: '核心筒办公楼', locale: 'zh' });
    expect(result?.key).toBe('shear-wall');
  });

  test('returns null for concrete frame and composite messages', () => {
    expect(detectShearWallStructuralType({ message: '三层两跨混凝土框架', locale: 'zh' })).toBeNull();
    expect(detectShearWallStructuralType({ message: '组合梁设计', locale: 'zh' })).toBeNull();
    expect(detectShearWallStructuralType({ message: 'please analyze this structure', locale: 'en' })).toBeNull();
  });

  test('owns wall wording ahead of the generic concrete-frame route', () => {
    // No residential/frame-shear-wall skill exists yet, so every wall wording
    // lands on this skill regardless of the surrounding building context.
    for (const message of ['剪力墙住宅', '框剪办公楼', '框架-剪力墙结构', 'C30剪力墙，柱网8m']) {
      const result = detectShearWallStructuralType({ message, locale: 'zh' });
      expect(result?.key).toBe('shear-wall');
      expect(result?.skillId).toBe('shear-wall');
    }
  });
});

describe('shear-wall draft extraction', () => {
  test('expands scalar story heights and loads from a chinese style patch', () => {
    const patch = buildShearWallPatchFromLlm({
      storyCount: 3,
      storyHeightScalar: 3,
      verticalLoadKN: 500,
      lateralXKN: 60,
    }, undefined);

    expect(patch.inferredType).toBe('frame');
    expect(patch.storyHeightsM).toEqual([3, 3, 3]);
    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 500, liveLoadKN: undefined, lateralXKN: 60 },
      { story: 2, verticalKN: 500, liveLoadKN: undefined, lateralXKN: 60 },
      { story: 3, verticalKN: 500, liveLoadKN: undefined, lateralXKN: 60 },
    ]);
  });

  test('normalizes wall material grades and rejects invalid ones', () => {
    const patch = buildShearWallPatchFromLlm({
      wallConcreteGrade: 'c40',
      wallRebarGrade: 'hrb500',
    }, undefined);
    expect(patch.wallConcreteGrade).toBe('C40');
    expect(patch.wallRebarGrade).toBe('HRB500');

    const invalid = buildShearWallPatchFromLlm({
      wallConcreteGrade: 'CONCRETE-X',
      wallRebarGrade: 'STEEL-1',
    }, undefined);
    expect(invalid.wallConcreteGrade).toBeUndefined();
    expect(invalid.wallRebarGrade).toBeUndefined();
  });

  test('normalizes seismic grades from chinese, numeric, and english inputs', () => {
    expect(buildShearWallPatchFromLlm({ seismicGrade: '二级' }, undefined).seismicGrade).toBe('二级');
    expect(buildShearWallPatchFromLlm({ seismicGrade: 1 }, undefined).seismicGrade).toBe('一级');
    expect(buildShearWallPatchFromLlm({ seismicGrade: 'third' }, undefined).seismicGrade).toBe('三级');
    expect(buildShearWallPatchFromLlm({ seismicGrade: 'grade nine' }, undefined).seismicGrade).toBeUndefined();
  });

  test('normalizes wall openings and drops entries without positive width and height', () => {
    const patch = buildShearWallPatchFromLlm({
      wallOpenings: [
        { width: 1.5, height: 2.1, sill: 0 },
        { widthM: 0, heightM: 2 },
        { widthM: 1, heightM: -1 },
        'not-an-opening',
      ],
    }, undefined);
    expect(patch.wallOpenings).toEqual([{ widthM: 1.5, heightM: 2.1, sillM: 0 }]);

    expect(buildShearWallPatchFromLlm({ wallOpenings: [] }, undefined).wallOpenings).toBeUndefined();
  });

  test('parseProvidedValues normalizes explicit form input the same way', () => {
    const patch = parseShearWallProvidedValues({
      wallThicknessMm: '250',
      wallLengthM: 6,
      wallConcreteGrade: 'c35',
    });
    expect(patch.wallThicknessMm).toBe(250);
    expect(patch.wallLengthM).toBe(6);
    expect(patch.wallConcreteGrade).toBe('C35');
    expect(patch.floorLoads).toBeUndefined();
  });

  test('extractDraft routes through the handler pipeline', () => {
    const patch = handler.extractDraft({
      message: '剪力墙',
      locale: 'zh',
      llmDraftPatch: { storyCount: 2, storyHeightScalar: 3.6, wallLengthM: 7.2, wallThicknessMm: 250, seismicGrade: 1 },
    });
    const state = handler.mergeState(undefined, patch);

    expect(state.storyHeightsM).toEqual([3.6, 3.6]);
    expect(state.wallLengthM).toBe(7.2);
    expect(state.wallThicknessMm).toBe(250);
    expect(state.seismicGrade).toBe('一级');
    expect(state.structuralTypeKey).toBe('shear-wall');
  });
});

describe('shear-wall mergeState immutability', () => {
  test('does not mutate the existing state when merging', () => {
    const existing = buildCompleteState({ updatedAt: 0 });
    const snapshot = JSON.stringify(existing);

    mergeShearWallState(existing, { wallThicknessMm: 250, wallConcreteGrade: 'C35' });

    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  test('patch values win over existing values', () => {
    const existing = buildCompleteState({ updatedAt: 0 });
    const merged = mergeShearWallState(existing, {
      wallThicknessMm: 250,
      wallConcreteGrade: 'C35',
      seismicGrade: '一级',
    });

    expect(merged.wallThicknessMm).toBe(250);
    expect(merged.wallConcreteGrade).toBe('C35');
    expect(merged.seismicGrade).toBe('一级');
    expect(merged.wallLengthM).toBe(6);
    expect(merged.skillId).toBe('shear-wall');
  });

  test('keeps existing wall values when the patch omits or invalidates them', () => {
    const existing = buildCompleteState({ updatedAt: 0 });
    const merged = mergeShearWallState(existing, {
      wallThicknessMm: 0,
      wallConcreteGrade: 'NOT-A-GRADE',
    });

    expect(merged.wallThicknessMm).toBe(200);
    expect(merged.wallConcreteGrade).toBe('C30');
  });

  test('merges openings from the patch over the existing state', () => {
    const existing = buildCompleteState({ updatedAt: 0 });
    const merged = mergeShearWallState(existing, {
      wallOpenings: [{ xM: 0.5, widthM: 1.2, heightM: 1.8 }],
    });
    expect(merged.wallOpenings).toEqual([{ xM: 0.5, widthM: 1.2, heightM: 1.8 }]);

    const kept = mergeShearWallState(existing, { wallLengthM: 8 });
    expect(kept.wallOpenings).toEqual([{ xM: 2.25, widthM: 1.5, heightM: 2.1, sillM: 0 }]);
  });
});

describe('shear-wall computeMissing and labels', () => {
  test('returns all wall keys missing for an empty state in the interactive phase', () => {
    const missing = computeShearWallMissing({ inferredType: 'frame', updatedAt: 0 }, 'interactive');
    expect(missing.critical).toEqual([
      'storyCount',
      'storyHeightsM',
      'floorLoads',
      'wallLengthM',
      'wallThicknessMm',
      'wallConcreteGrade',
      'wallRebarGrade',
    ]);
  });

  test('material keys are not critical at execution phase', () => {
    const missing = computeShearWallMissing({ inferredType: 'frame', updatedAt: 0 }, 'execution');
    expect(missing.critical).toEqual(['storyCount', 'storyHeightsM', 'floorLoads', 'wallLengthM']);
    expect(missing.critical).not.toContain('wallThicknessMm');
  });

  test('returns no missing keys for a complete state', () => {
    const missing = computeShearWallMissing(buildCompleteState(), 'interactive');
    expect(missing.critical).toEqual([]);
  });

  test('maps wall labels bilingually and falls back to legacy labels', () => {
    const keys = ['wallLengthM', 'wallThicknessMm', 'wallConcreteGrade', 'wallRebarGrade', 'wallOpenings', 'seismicGrade', 'storyCount'];
    expect(mapShearWallLabels(keys, 'zh')).toEqual([
      '剪力墙墙肢总长（m）',
      '墙厚（mm）',
      '墙身混凝土等级',
      '墙身钢筋等级',
      '墙上洞口（宽×高，m）',
      '抗震等级（一级~四级）',
      '层数',
    ]);
    expect(mapShearWallLabels(keys, 'en')).toEqual([
      'Wall line total length (m)',
      'Wall thickness (mm)',
      'Wall concrete grade',
      'Wall rebar grade',
      'Wall openings (width × height, m)',
      'Seismic grade (1st–4th)',
      'Story count',
    ]);
  });
});

describe('shear-wall questions and default proposals', () => {
  test('asks bilingually for the wall length', () => {
    const [zh] = buildShearWallQuestions(['wallLengthM'], ['wallLengthM'], { inferredType: 'frame', updatedAt: 0 }, 'zh');
    expect(zh.label).toBe('墙肢总长');
    expect(zh.critical).toBe(true);
    expect(zh.question).toContain('墙肢总长');

    const [en] = buildShearWallQuestions(['wallLengthM'], ['wallLengthM'], { inferredType: 'frame', updatedAt: 0 }, 'en');
    expect(en.label).toBe('Wall line length');
    expect(en.question).toContain('wall line total length');
  });

  test('suggests the GB/T 50011 thickness estimate in the thickness question', () => {
    const state = { inferredType: 'frame', storyHeightsM: [3, 3], updatedAt: 0 };
    const [zh] = buildShearWallQuestions(['wallThicknessMm'], [], state, 'zh');
    expect(zh.suggestedValue).toBe(150);
    expect(zh.question).toContain('GB/T 50011 6.4.1');

    const [en] = buildShearWallQuestions(['wallThicknessMm'], [], state, 'en');
    expect(en.question).toContain('Suggested 150mm per GB/T 50011 6.4.1.');
  });

  test('proposes concrete, rebar, and seismic grade defaults bilingually', () => {
    const state = { inferredType: 'frame', storyHeightsM: [3, 3], siteSeismic: { intensity: 8 }, updatedAt: 0 };
    const proposals = buildShearWallDefaultProposals(
      ['wallThicknessMm', 'wallConcreteGrade', 'wallRebarGrade', 'seismicGrade'],
      state,
      'zh',
    );
    const byKey = Object.fromEntries(proposals.map((proposal) => [proposal.paramKey, proposal]));
    expect(byKey.wallConcreteGrade.value).toBe('C30');
    expect(byKey.wallRebarGrade.value).toBe('HRB400');
    expect(byKey.seismicGrade.value).toBe('二级');
    expect(byKey.seismicGrade.reason).toContain('GB/T 50011');
    expect(byKey.wallThicknessMm.value).toBe(250);

    const enProposals = buildShearWallDefaultProposals(['wallConcreteGrade'], state, 'en');
    expect(enProposals[0].value).toBe('C30');
    expect(enProposals[0].reason).toBe('Default to C30 concrete.');
  });
});

describe('shear-wall GB/T 50011 design helpers', () => {
  test('parses seismic grades from all accepted spellings', () => {
    expect(parseSeismicGrade('一级')).toBe(1);
    expect(parseSeismicGrade(2)).toBe(2);
    expect(parseSeismicGrade('third')).toBe(3);
    expect(parseSeismicGrade('4')).toBe(4);
    expect(parseSeismicGrade('九级')).toBeUndefined();
    expect(parseSeismicGrade(undefined)).toBeUndefined();
  });

  test('maps fortification intensity to seismic grade for the common height band', () => {
    expect(suggestSeismicGradeFromIntensity(6)).toBe(4);
    expect(suggestSeismicGradeFromIntensity(7)).toBe(3);
    expect(suggestSeismicGradeFromIntensity(8)).toBe(2);
    expect(suggestSeismicGradeFromIntensity(9)).toBe(1);
    expect(suggestSeismicGradeFromIntensity(undefined)).toBeUndefined();
  });

  test('estimates wall thickness per GB/T 50011 6.4.1 including the bottom strengthened zone', () => {
    expect(estimateWallThicknessMm({ storyHeightM: 3, seismicGrade: 4 })).toBe(150);
    expect(estimateWallThicknessMm({ storyHeightM: 3, seismicGrade: 2, isBottomStrengthenedZone: false })).toBe(200);
    expect(estimateWallThicknessMm({ storyHeightM: 3, seismicGrade: 2, isBottomStrengthenedZone: true })).toBe(250);
    expect(estimateWallThicknessMm({ storyHeightM: 4.5 })).toBe(200);
  });

  test('computes the bottom strengthened story count as max(bottom two stories, height/10)', () => {
    expect(computeBottomStrengthenedStoryCount(Array(10).fill(3))).toBe(2);
    expect(computeBottomStrengthenedStoryCount(Array(4).fill(4.2))).toBe(2);
    // The bottom-two-story floor applies even to single-story walls.
    expect(computeBottomStrengthenedStoryCount([3])).toBe(2);
  });

  test('splits a wall line into piers and lays out openings without offsets evenly', () => {
    const { piers, openings } = splitWallIntoPiers(6, [
      { widthM: 1.5, heightM: 2.1 },
      { widthM: 1.2, heightM: 2.1 },
    ]);
    expect(openings.map((opening) => Math.round(opening.xM * 1000) / 1000)).toEqual([1.1, 3.7]);
    expect(piers).toHaveLength(3);
    expect(piers.reduce((sum, pier) => sum + pier.lengthM, 0)).toBeCloseTo(3.3, 6);
  });

  test('drops openings outside the wall and keeps a solid single pier', () => {
    const { piers, openings } = splitWallIntoPiers(6, [{ xM: 5.5, widthM: 1.5, heightM: 2 }]);
    expect(openings).toEqual([]);
    expect(piers).toEqual([{ xM: 0, lengthM: 6 }]);
  });

  test('designs coupling beams inside the 2–5 span-to-depth band', () => {
    const beam = designCouplingBeam({ id: 'CB-1', spanM: 1.5 });
    expect(beam.heightMm).toBe(400);
    expect(beam.spanDepthRatio).toBe(3.8);
    expect(beam.meetsRequirement).toBe(true);

    const squat = designCouplingBeam({ id: 'CB-2', spanM: 0.5 });
    expect(squat.meetsRequirement).toBe(false);
  });

  test('returns the distributed reinforcement minimums per grade', () => {
    expect(distributedReinforcementRatio(1)).toBe(0.0025);
    expect(distributedReinforcementRatio(3)).toBe(0.0025);
    expect(distributedReinforcementRatio(4)).toBe(0.002);
    expect(distributedReinforcementRatio(undefined)).toBe(0.002);
  });

  test('builds a design summary with seismic grade and boundary element note', () => {
    const summary = buildShearWallDesignSummary({
      wallLengthM: 6,
      storyHeightsM: [3, 3],
      openings: [{ xM: 2.25, widthM: 1.5, heightM: 2.1 }],
      seismicGrade: 1,
    });
    expect(summary.seismicGrade).toBe(1);
    expect(summary.seismicGradeLabel).toBe('一级');
    expect(summary.bottomStrengthenedStoryCount).toBe(2);
    expect(summary.openingAreaRatio).toBe(0.088);
    expect(summary.distributedReinforcementRatio).toBe(0.0025);
    expect(summary.stories.map((story) => story.isBottomStrengthenedZone)).toEqual([true, true]);
    expect(summary.boundaryElementNote.zh).toContain('约束边缘构件');
    expect(summary.boundaryElementNote.en).toContain('Constrained boundary elements');
  });
});

describe('shear-wall buildModel', () => {
  test('builds an equivalent-frame wall elevation with piers and coupling beams', () => {
    const model = buildShearWallModel(buildCompleteState());
    expect(model).toBeDefined();

    const wallPiers = model.elements.filter((element) => element.wallRole === 'wall-pier');
    const couplingBeams = model.elements.filter((element) => element.wallRole === 'coupling-beam');
    expect(model.nodes).toHaveLength(12);
    expect(wallPiers).toHaveLength(4);
    expect(couplingBeams).toHaveLength(2);
    expect(wallPiers.every((element) => element.type === 'wall')).toBe(true);
    expect(couplingBeams.every((element) => element.type === 'beam')).toBe(true);
    // The opening span (x 2.25–3.75) carries no wall pier.
    expect(wallPiers.every((element) => element.shearWall.lengthMm === 2250)).toBe(true);
    expect(couplingBeams[0].couplingBeam).toMatchObject({ spanM: 1.5, heightMm: 400, spanDepthRatio: 3.8 });

    expect(model.sections.map((section) => section.id)).toEqual(['10', '20']);
    expect(model.sections[0]).toMatchObject({ purpose: 'wall', name: 'WALL200X2250', thickness: 200, wallLength: 2250 });
    expect(model.sections[1]).toMatchObject({ purpose: 'beam', name: 'CB200X400' });
    expect(model.materials).toEqual([
      expect.objectContaining({ id: '1', category: 'concrete', grade: 'C30', fc: 14.3 }),
      expect.objectContaining({ id: '2', category: 'rebar', grade: 'HRB400', fy: 360 }),
    ]);
  });

  test('stamps GB 50011 seismic and ductility design data on the model', () => {
    const model = buildShearWallModel(buildCompleteState());

    expect(model.structure_system).toMatchObject({
      type: 'shear-wall',
      seismic_grade: 'second',
      extra: { materialSystem: 'reinforced-concrete' },
    });
    expect(model.project).toMatchObject({ code_standard: 'GB50011-2010', extra: { designCode: 'GB50011' } });
    expect(model.metadata).toMatchObject({
      structuralTypeKey: 'shear-wall',
      designCode: 'GB50011',
      concreteGrade: 'C30',
      rebarGrade: 'HRB400',
      wallLengthM: 6,
      wallThicknessMm: 200,
      seismicGrade: '二级',
    });
    expect(model.metadata.wallDesign).toMatchObject({
      bottomStrengthenedStoryCount: 2,
      openingAreaRatio: 0.088,
      distributedReinforcementRatio: 0.0025,
      piers: [
        { id: 'WP-1', lengthM: 2.25, thicknessMm: 200 },
        { id: 'WP-2', lengthM: 2.25, thicknessMm: 200 },
      ],
      couplingBeams: [{ id: 'CB-1', spanM: 1.5, heightMm: 400, meetsRequirement: true }],
    });
    expect(model.metadata.wallDesign.boundaryElementNote).toEqual({
      zh: '底部加强部位及相邻上一层应设置约束边缘构件，其余部位设置构造边缘构件。',
      en: 'Constrained boundary elements are required in the bottom strengthened zone and the story above; other positions use constructive boundary elements.',
    });
    expect(model.extensions.wallDesign).toMatchObject({
      wallLengthM: 6,
      wallThicknessMm: 200,
      seismicGrade: '二级',
      distributedReinforcementRatio: 0.0025,
    });
    expect(model.extensions.wallDesign.openings).toEqual([{ xM: 2.25, widthM: 1.5, heightM: 2.1, sillM: 0 }]);
    expect(model.coordinate_system).toMatchObject({ semantics: 'global-z-up', dimension: '2d' });
  });

  test('distributes story loads to wall nodes and derives story intensities', () => {
    const model = buildShearWallModel(buildCompleteState());
    expect(model.load_cases.map((loadCase) => loadCase.id)).toEqual(['D', 'L', 'LAT']);
    const dead = model.load_cases.find((loadCase) => loadCase.id === 'D');
    expect(dead.loads).toHaveLength(8);
    expect(dead.loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-400);
    const lateral = model.load_cases.find((loadCase) => loadCase.id === 'LAT');
    expect(lateral.loads.reduce((sum, load) => sum + load.fx, 0)).toBeCloseTo(80);
    expect(model.stories[0]).toMatchObject({ id: 'F1', height: 3, dead_load: 200 / 6, live_load: 50 / 6 });
  });

  test('estimates the wall thickness when not provided', () => {
    const model = buildShearWallModel(buildCompleteState({
      wallThicknessMm: undefined,
      wallConcreteGrade: undefined,
      wallRebarGrade: undefined,
    }));

    expect(model).toBeDefined();
    // grade 2 bottom strengthened zone: max(160, 3000/16, 3000/12) → 250 mm.
    expect(model.metadata.wallThicknessMm).toBe(250);
    // Invalid/absent grades fall back to C30 / HRB400 defaults.
    expect(model.metadata.concreteGrade).toBe('C30');
    expect(model.metadata.rebarGrade).toBe('HRB400');
  });

  test('returns undefined when critical inputs are missing', () => {
    expect(buildShearWallModel({ inferredType: 'frame', updatedAt: 0 })).toBeUndefined();
    expect(buildShearWallModel({
      inferredType: 'frame', storyCount: 2, storyHeightsM: [3, 3], wallLengthM: 6, updatedAt: 0,
    })).toBeUndefined();
    expect(buildShearWallModel({
      inferredType: 'frame', storyCount: 3, storyHeightsM: [3, 3], wallLengthM: 6,
      floorLoads: [{ story: 1, verticalKN: 100 }], updatedAt: 0,
    })).toBeUndefined();
    expect(buildShearWallModel({
      inferredType: 'frame', storyCount: 1, storyHeightsM: [3], wallLengthM: 6,
      floorLoads: [{ story: 1, verticalKN: 0 }], updatedAt: 0,
    })).toBeUndefined();
    expect(buildShearWallModel(buildCompleteState({ wallLengthM: undefined }))).toBeUndefined();
  });

  test('handler.buildModel mirrors the module and refuses incomplete states', () => {
    expect(handler.buildModel(buildCompleteState())).toBeDefined();
    expect(handler.buildModel({ inferredType: 'frame', updatedAt: 0 })).toBeUndefined();
    expect(handler.buildModel(buildCompleteState({ storyHeightsM: [3, 3, 3] }))).toBeUndefined();
  });
});

describe('shear-wall stage resolution and report narrative', () => {
  test('resolves the pipeline stage from missing keys', () => {
    expect(resolveShearWallStage(['storyCount', 'wallLengthM'])).toBe('model');
    expect(resolveShearWallStage(['floorLoads'])).toBe('loads');
  });

  test('appends a bilingual shear-wall section to the report narrative', () => {
    const baseInput = {
      message: 'shear wall',
      analysisType: 'static',
      analysisSuccess: true,
      codeCheckText: '',
      summary: '',
      keyMetrics: {},
      clauseTraceability: [],
      controllingCases: {},
      visualizationHints: {},
    };
    const en = buildShearWallReportNarrative({ ...baseInput, locale: 'en' });
    expect(en).toContain('## Shear Wall-Specific Notes');
    expect(en).toContain('GB/T 50011');

    const zh = buildShearWallReportNarrative({ ...baseInput, locale: 'zh' });
    expect(zh).toContain('## 剪力墙专项说明');
    expect(zh).toContain('等效框架');
  });
});
