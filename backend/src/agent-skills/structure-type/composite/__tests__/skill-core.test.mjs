import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/composite/handler.js';
import { detectUnsupportedStructuralTypeByRules } from '../../../../../dist/agent-runtime/fallback.js';
import { detectCompositeStructuralType } from '../../../../../dist/agent-skills/structure-type/composite/detect.js';
import {
  buildCompositePatchFromLlm,
  parseCompositeProvidedValues,
} from '../../../../../dist/agent-skills/structure-type/composite/extract-llm.js';
import { mergeCompositeState } from '../../../../../dist/agent-skills/structure-type/composite/merge.js';
import {
  buildCompositeDefaultProposals,
  buildCompositeQuestions,
  buildCompositeReportNarrative,
  computeCompositeMissing,
  mapCompositeLabels,
  resolveCompositeStage,
} from '../../../../../dist/agent-skills/structure-type/composite/interaction.js';
import {
  buildCompositeDesignSummary,
  computeEffectiveSlabWidthMm,
  computeStudCapacityKN,
  computeTransformedSection,
  designCompositeBeam,
  getDefaultCompositeBeamSection,
  getDefaultCompositeColumnSection,
  resolveSteelMaterial,
  resolveSteelSection,
} from '../../../../../dist/agent-skills/structure-type/composite/design.js';
import { buildCompositeModel } from '../../../../../dist/agent-skills/structure-type/composite/model.js';

function buildCompleteState(overrides = {}) {
  return {
    inferredType: 'frame',
    structuralTypeKey: 'composite',
    skillId: 'composite',
    frameDimension: '2d',
    storyCount: 2,
    storyHeightsM: [3.6, 3.6],
    bayCount: 1,
    bayWidthsM: [6],
    floorLoads: [
      { story: 1, verticalKN: 200, liveLoadKN: 50, lateralXKN: 30 },
      { story: 2, verticalKN: 200, liveLoadKN: 50, lateralXKN: 30 },
    ],
    compositeSlabThicknessMm: 150,
    compositeSteelBeamSection: 'HN400X200',
    compositeSteelColumnSection: 'HW300X300',
    compositeSteelGrade: 'Q355',
    compositeConcreteGrade: 'C30',
    compositeStudDiameterMm: 19,
    frameBaseSupportType: 'fixed',
    updatedAt: 0,
    ...overrides,
  };
}

describe('composite detection and trigger routing', () => {
  test('detects chinese composite keywords', () => {
    for (const message of ['组合结构设计', '组合梁，跨度6m', '组合柱截面验算', '组合楼盖', '型钢混凝土柱', '钢骨混凝土', '钢管混凝土柱']) {
      const result = detectCompositeStructuralType({ message, locale: 'zh' });
      expect(result?.key).toBe('composite');
      expect(result?.skillId).toBe('composite');
      expect(result?.mappedType).toBe('frame');
      expect(result?.supportLevel).toBe('supported');
    }
  });

  test('detects english composite keywords', () => {
    for (const message of ['composite beam with a 150 mm slab', 'steel-concrete composite frame', 'composite column design', 'a composite section check']) {
      const result = detectCompositeStructuralType({ message, locale: 'en' });
      expect(result?.key).toBe('composite');
    }
  });

  test('returns null for concrete frame, shear wall, and plain messages', () => {
    expect(detectCompositeStructuralType({ message: '三层两跨混凝土框架', locale: 'zh' })).toBeNull();
    expect(detectCompositeStructuralType({ message: '12层剪力墙结构', locale: 'zh' })).toBeNull();
    expect(detectCompositeStructuralType({ message: 'please analyze this structure', locale: 'en' })).toBeNull();
  });

  test('owns composite wording ahead of the beam and concrete-frame routes', () => {
    for (const message of ['组合梁，跨度6m，板厚150mm', 'C30组合结构框架', 'a composite beam with steel grade Q355']) {
      const result = detectCompositeStructuralType({ message, locale: 'zh' });
      expect(result?.key).toBe('composite');
      expect(result?.skillId).toBe('composite');
    }
  });

  test('escapes the generic unsupported slab heuristic when a composite keyword is explicit', () => {
    expect(detectUnsupportedStructuralTypeByRules('组合楼板厚度150mm，跨度6m', 'zh')).toBeNull();
    expect(detectUnsupportedStructuralTypeByRules('composite beam with a 150 mm slab', 'en')).toBeNull();
    // Messages without an explicit structural keyword keep the plate/slab guidance.
    expect(detectUnsupportedStructuralTypeByRules('无梁楼板', 'zh')?.key).toBe('plate-slab');
  });
});

describe('composite draft extraction', () => {
  test('expands scalar story heights, spans, and loads from a chinese style patch', () => {
    const patch = buildCompositePatchFromLlm({
      storyCount: 2,
      storyHeightM: 3.6,
      bayCount: 2,
      compositeSpanM: 6,
      verticalLoadKN: 200,
      liveLoadKN: 50,
    }, undefined);

    expect(patch.inferredType).toBe('frame');
    expect(patch.storyHeightsM).toEqual([3.6, 3.6]);
    expect(patch.bayWidthsM).toEqual([6, 6]);
    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 200, liveLoadKN: 50, lateralXKN: undefined },
      { story: 2, verticalKN: 200, liveLoadKN: 50, lateralXKN: undefined },
    ]);
  });

  test('a bare span scalar describes a single-bay composite frame', () => {
    const patch = buildCompositePatchFromLlm({ storyCount: 1, spanM: 6 }, undefined);
    expect(patch.bayCount).toBe(1);
    expect(patch.bayWidthsM).toEqual([6]);
  });

  test('pins the 2d frame dimension for the composite elevation', () => {
    const patch = buildCompositePatchFromLlm({ storyCount: 2, bayWidthM: 6 }, undefined);
    expect(patch.frameDimension).toBe('2d');
  });

  test('normalizes sections and grades and rejects invalid grades', () => {
    const patch = buildCompositePatchFromLlm({
      steelBeamSection: 'hn400x200',
      compositeSteelColumnSection: 'hw300x300',
      compositeSteelGrade: 'q355',
      compositeConcreteGrade: 'c40',
      slabThicknessMm: 150,
      studDiameterMm: 19,
    }, undefined);
    expect(patch.compositeSteelBeamSection).toBe('HN400X200');
    expect(patch.compositeSteelColumnSection).toBe('HW300X300');
    expect(patch.compositeSteelGrade).toBe('Q355');
    expect(patch.compositeConcreteGrade).toBe('C40');
    expect(patch.compositeSlabThicknessMm).toBe(150);
    expect(patch.compositeStudDiameterMm).toBe(19);

    const invalid = buildCompositePatchFromLlm({
      compositeSteelGrade: 'Q999',
      compositeConcreteGrade: 'C90',
    }, undefined);
    expect(invalid.compositeSteelGrade).toBeUndefined();
    expect(invalid.compositeConcreteGrade).toBeUndefined();
  });

  test('parseProvidedValues normalizes explicit form input the same way', () => {
    const patch = parseCompositeProvidedValues({
      compositeSlabThicknessMm: '120',
      compositeSteelGrade: 'Q235',
      compositeSteelBeamSection: 'h400x200x8x13',
    });
    expect(patch.compositeSlabThicknessMm).toBe(120);
    expect(patch.compositeSteelGrade).toBe('Q235');
    expect(patch.compositeSteelBeamSection).toBe('H400X200X8X13');
    expect(patch.floorLoads).toBeUndefined();
  });

  test('extractDraft routes through the handler pipeline', () => {
    const patch = handler.extractDraft({
      message: '组合梁',
      locale: 'zh',
      llmDraftPatch: { storyCount: 1, storyHeightScalar: 3.6, compositeSpanM: 6, verticalLoadKN: 100, slabThicknessMm: 150 },
    });
    const state = handler.mergeState(undefined, patch);

    expect(state.frameDimension).toBe('2d');
    expect(state.bayCount).toBe(1);
    expect(state.bayWidthsM).toEqual([6]);
    expect(state.compositeSlabThicknessMm).toBe(150);
    expect(state.structuralTypeKey).toBe('composite');
  });
});

describe('composite mergeState immutability', () => {
  test('does not mutate the existing state when merging', () => {
    const existing = buildCompleteState({ updatedAt: 0 });
    const snapshot = JSON.stringify(existing);

    mergeCompositeState(existing, { compositeSlabThicknessMm: 200, compositeSteelGrade: 'Q390' });

    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  test('patch values win over existing values', () => {
    const existing = buildCompleteState({ updatedAt: 0 });
    const merged = mergeCompositeState(existing, {
      compositeSlabThicknessMm: 200,
      compositeSteelBeamSection: 'hn500x200',
      compositeSteelGrade: 'Q390',
      compositeConcreteGrade: 'C45',
    });

    expect(merged.compositeSlabThicknessMm).toBe(200);
    expect(merged.compositeSteelBeamSection).toBe('HN500X200');
    expect(merged.compositeSteelGrade).toBe('Q390');
    expect(merged.compositeConcreteGrade).toBe('C45');
    expect(merged.skillId).toBe('composite');
  });

  test('keeps existing composite values when the patch omits or invalidates them', () => {
    const existing = buildCompleteState({ updatedAt: 0 });
    const merged = mergeCompositeState(existing, {
      compositeSlabThicknessMm: -5,
      compositeSteelGrade: 'NOT-A-GRADE',
      compositeConcreteGrade: 12,
    });

    expect(merged.compositeSlabThicknessMm).toBe(150);
    expect(merged.compositeSteelGrade).toBe('Q355');
    expect(merged.compositeConcreteGrade).toBe('C30');
  });

  test('keeps bay widths when merging raw patches without a frame dimension', () => {
    const merged = mergeCompositeState(undefined, {
      storyCount: 2,
      storyHeightsM: [3.6, 3.6],
      bayCount: 1,
      bayWidthsM: [6],
      floorLoads: [{ story: 1, verticalKN: 200 }, { story: 2, verticalKN: 200 }],
      compositeSlabThicknessMm: 150,
      compositeSteelBeamSection: 'HN400X200',
      compositeSteelGrade: 'Q355',
      compositeConcreteGrade: 'C30',
    });

    expect(merged.frameDimension).toBe('2d');
    expect(merged.bayWidthsM).toEqual([6]);
    expect(computeCompositeMissing(merged, 'interactive').critical).toEqual([]);
    expect(merged.bayWidthsM).toEqual([6]);
  });
});

describe('composite computeMissing and labels', () => {
  test('returns all geometry and composite keys missing for an empty state interactively', () => {
    const missing = computeCompositeMissing({ inferredType: 'frame', updatedAt: 0 }, 'interactive');
    expect(missing.critical).toEqual([
      'storyCount',
      'storyHeightsM',
      'bayCount',
      'bayWidthsM',
      'floorLoads',
      'compositeSlabThicknessMm',
      'compositeSteelBeamSection',
      'compositeSteelGrade',
      'compositeConcreteGrade',
    ]);
  });

  test('composite material and section keys are not critical at execution phase', () => {
    const missing = computeCompositeMissing({ inferredType: 'frame', updatedAt: 0 }, 'execution');
    expect(missing.critical).toEqual(['storyCount', 'storyHeightsM', 'bayCount', 'bayWidthsM', 'floorLoads']);
    expect(missing.critical).not.toContain('compositeSlabThicknessMm');
  });

  test('returns no missing keys for a complete state', () => {
    expect(computeCompositeMissing(buildCompleteState(), 'interactive').critical).toEqual([]);
    expect(computeCompositeMissing(buildCompleteState(), 'execution').critical).toEqual([]);
  });

  test('maps composite labels bilingually and falls back to legacy labels', () => {
    const keys = [
      'compositeSlabThicknessMm',
      'compositeSlabWidthM',
      'compositeSteelBeamSection',
      'compositeSteelColumnSection',
      'compositeSteelGrade',
      'compositeConcreteGrade',
      'compositeStudDiameterMm',
      'bayCount',
    ];
    expect(mapCompositeLabels(keys, 'zh')).toEqual([
      '混凝土板厚（mm）',
      '翼缘有效宽度（m）',
      '组合梁钢梁截面',
      '钢柱截面',
      '钢材牌号',
      '翼缘混凝土等级',
      '栓钉直径（mm）',
      '跨数/节间数',
    ]);
    expect(mapCompositeLabels(keys, 'en')).toEqual([
      'Concrete slab thickness (mm)',
      'Effective flange width (m)',
      'Composite beam steel section',
      'Steel column section',
      'Steel grade',
      'Flange concrete grade',
      'Shear stud diameter (mm)',
      'Bay / panel count',
    ]);
  });
});

describe('composite questions and default proposals', () => {
  test('asks bilingually for the slab thickness with a suggested default', () => {
    const [zh] = buildCompositeQuestions(['compositeSlabThicknessMm'], ['compositeSlabThicknessMm'], buildCompleteState(), 'zh');
    expect(zh.label).toBe('混凝土板厚');
    expect(zh.critical).toBe(true);
    expect(zh.suggestedValue).toBe(150);
    expect(zh.question).toContain('组合梁混凝土翼缘板厚');

    const [en] = buildCompositeQuestions(['compositeSlabThicknessMm'], ['compositeSlabThicknessMm'], buildCompleteState(), 'en');
    expect(en.label).toBe('Concrete slab thickness');
    expect(en.suggestedValue).toBe(150);
    expect(en.question).toContain('composite slab thickness');
  });

  test('suggests story-count based steel sections in the section questions', () => {
    const state = buildCompleteState();
    const [zh] = buildCompositeQuestions(['compositeSteelBeamSection'], [], state, 'zh');
    expect(zh.suggestedValue).toBe('HN350X175');
    expect(zh.question).toContain('HN400X200');

    const [en] = buildCompositeQuestions(['compositeSteelColumnSection'], [], state, 'en');
    expect(en.suggestedValue).toBe('HW300X300');
  });

  test('proposes defaults bilingually for all composite keys', () => {
    const state = buildCompleteState();
    const proposals = buildCompositeDefaultProposals(
      [
        'compositeSlabThicknessMm',
        'compositeSteelBeamSection',
        'compositeSteelColumnSection',
        'compositeSteelGrade',
        'compositeConcreteGrade',
        'compositeStudDiameterMm',
      ],
      state,
      'zh',
    );
    const byKey = Object.fromEntries(proposals.map((proposal) => [proposal.paramKey, proposal]));
    expect(byKey.compositeSlabThicknessMm.value).toBe(150);
    expect(byKey.compositeSteelBeamSection.value).toBe('HN350X175');
    expect(byKey.compositeSteelColumnSection.value).toBe('HW300X300');
    expect(byKey.compositeSteelGrade.value).toBe('Q355');
    expect(byKey.compositeConcreteGrade.value).toBe('C30');
    expect(byKey.compositeStudDiameterMm.value).toBe(19);
    expect(byKey.compositeSteelBeamSection.reason).toContain('2 层');

    const enProposals = buildCompositeDefaultProposals(['compositeStudDiameterMm'], state, 'en');
    expect(enProposals[0].value).toBe(19);
    expect(enProposals[0].reason).toBe('Default to 19 mm headed shear studs.');
  });
});

describe('composite GB 50017 design helpers', () => {
  test('resolves library, custom, and default steel sections', () => {
    const beam = resolveSteelSection('HN400X200', 'beam', 2);
    expect(beam).toMatchObject({ name: 'HN400X200', A: 8420, standardSteelName: 'HN400x200' });
    expect(beam.shape).toEqual({ kind: 'H', H: 400, B: 200, tw: 8, tf: 13 });

    const custom = resolveSteelSection('H400X200X8X13', 'beam', 2);
    expect(custom.name).toBe('H400X200X8X13');
    expect(custom.A).toBe(8192);
    expect(custom.substituted).toBeUndefined();

    const substituted = resolveSteelSection('UNKNOWN-SECTION', 'beam', 2);
    expect(substituted.name).toBe('HN350X175');
    expect(substituted.substituted).toContain('substituted with HN350X175');

    expect(getDefaultCompositeBeamSection(2)).toBe('HN350X175');
    expect(getDefaultCompositeBeamSection(8)).toBe('HN400X200');
    expect(getDefaultCompositeBeamSection(12)).toBe('HN500X200');
    expect(getDefaultCompositeColumnSection(2)).toBe('HW300X300');
    expect(getDefaultCompositeColumnSection(8)).toBe('HW350X350');
    expect(getDefaultCompositeColumnSection(12)).toBe('HW400X400');
  });

  test('resolves steel and concrete materials with defaults', () => {
    expect(resolveSteelMaterial('q355').grade).toBe('Q355');
    expect(resolveSteelMaterial(undefined).grade).toBe('Q355');
    expect(resolveSteelMaterial('Q999').grade).toBe('Q355');
    expect(resolveSteelMaterial('Q235').fy).toBe(235);
  });

  test('derives the effective flange width and caps it with a provided width', () => {
    expect(computeEffectiveSlabWidthMm({ spanM: 6, steelTopWidthMm: 200, slabThicknessMm: 150 })).toEqual({
      widthMm: 2000,
      source: 'derived',
    });
    expect(computeEffectiveSlabWidthMm({ spanM: 6, steelTopWidthMm: 200, slabThicknessMm: 150, slabWidthM: 1.5 })).toEqual({
      widthMm: 1500,
      source: 'provided',
    });
  });

  test('computes the transformed section with the modular-ratio method', () => {
    const transformed = computeTransformedSection({
      steel: resolveSteelSection('HN400X200', 'beam', 2),
      slabThicknessMm: 150,
      effectiveSlabWidthMm: 2000,
      steelGrade: 'Q355',
      concreteGrade: 'C30',
    });
    expect(transformed.modularRatio).toBe(6.87);
    expect(transformed.transformedAreaMm2).toBeCloseTo(301226.2, 0);
    expect(transformed.transformedCentroidFromSlabTopMm).toBeCloseTo(76.12, 1);
    expect(transformed.transformedInertiaMm4).toBeCloseTo(689369476.5, 0);
    expect(transformed.lowerSectionModulusMm3).toBeCloseTo(1454732.6, 0);
  });

  test('computes the stud capacity governed by steel or concrete', () => {
    // d19 + C30: 0.7·As·fu (79.4 kN) governs over 0.43·As·√(Ec·fc) (79.9 kN).
    expect(computeStudCapacityKN({ studDiameterMm: 19, concreteGrade: 'C30' })).toBeCloseTo(79.4, 1);
    expect(computeStudCapacityKN({ studDiameterMm: 22, concreteGrade: 'C30' })).toBeGreaterThan(
      computeStudCapacityKN({ studDiameterMm: 16, concreteGrade: 'C30' }),
    );
  });

  test('designs a composite beam with full shear connection', () => {
    const beam = designCompositeBeam({
      id: 'CB-1',
      spanM: 6,
      steelSection: 'HN400X200',
      slabThicknessMm: 150,
      steelGrade: 'Q355',
      concreteGrade: 'C30',
      studDiameterMm: 19,
    });
    expect(beam).toMatchObject({
      id: 'CB-1',
      steelSection: 'HN400X200',
      effectiveSlabWidthMm: 2000,
      compressionForceKN: 2989.1,
      pnaDepthMm: 104.5,
      pnaInSteel: false,
      flexuralCapacityKNM: 890,
      studCapacityKN: 79.4,
      studsPerHalfSpan: 38,
      studRows: 2,
      studPitchMm: 150,
      fullShearConnection: true,
    });
    // The provided layout must actually cover the required stud count.
    const providedPerHalf = Math.floor((beam.spanM * 1000) / 2 / beam.studPitchMm) * beam.studRows;
    expect(providedPerHalf).toBeGreaterThanOrEqual(beam.studsPerHalfSpan);
  });

  test('flags the plastic neutral axis inside the steel when the flange cannot cover it', () => {
    const beam = designCompositeBeam({
      id: 'CB-1',
      spanM: 6,
      steelSection: 'HN600X200',
      slabThicknessMm: 150,
      slabWidthM: 1,
      steelGrade: 'Q420',
      concreteGrade: 'C30',
    });
    expect(beam.pnaInSteel).toBe(true);
    expect(beam.pnaDepthMm).toBe(150);
    // Conservative interface lever arm: steel centroid to slab centroid.
    expect(beam.flexuralCapacityKNM).toBe(804.4);
  });

  test('builds a design summary with a bilingual verification note', () => {
    const summary = buildCompositeDesignSummary({
      bayWidthsM: [6, 6],
      storyCount: 2,
      slabThicknessMm: 150,
      steelBeamSection: 'HN400X200',
      steelGrade: 'Q355',
      concreteGrade: 'C30',
      studDiameterMm: 19,
    });
    expect(summary.slabWidthSource).toBe('derived');
    expect(summary.effectiveSlabWidthMm).toBe(2000);
    expect(summary.steelGrade).toBe('Q355');
    expect(summary.concreteGrade).toBe('C30');
    expect(summary.beams).toHaveLength(2);
    expect(summary.beams[0].fullShearConnection).toBe(true);
    expect(summary.columns).toEqual([{ id: 'CC-1', steelSection: 'HW300X300', storyCount: 2 }]);
    expect(summary.verificationNote.zh).toContain('GB 50017-2017');
    expect(summary.verificationNote.en).toContain('GB 50017-2017');
    expect(summary.verificationNote.zh).not.toContain('中和轴');

    const flagged = buildCompositeDesignSummary({
      bayWidthsM: [6],
      storyCount: 2,
      slabThicknessMm: 150,
      slabWidthM: 1,
      steelBeamSection: 'HN600X200',
      steelGrade: 'Q420',
      concreteGrade: 'C30',
    });
    expect(flagged.verificationNote.zh).toContain('中和轴位于钢梁内');
    expect(flagged.verificationNote.en).toContain('plastic neutral axis falls inside the steel');
  });
});

describe('composite buildModel', () => {
  test('builds a 2d composite frame with steel sections and composite beam data', () => {
    const model = buildCompositeModel(buildCompleteState());
    expect(model).toBeDefined();

    expect(model.nodes).toHaveLength(6);
    const columns = model.elements.filter((element) => element.type === 'column');
    const beams = model.elements.filter((element) => element.type === 'beam');
    expect(columns).toHaveLength(4);
    expect(beams).toHaveLength(2);
    expect(columns.every((element) => element.compositeRole === 'steel-column')).toBe(true);
    expect(beams.every((element) => element.compositeRole === 'composite-beam')).toBe(true);
    expect(model.sections).toEqual([
      expect.objectContaining({ id: '1', name: 'HN400X200', type: 'H', purpose: 'beam', standard_steel_name: 'HN400x200' }),
      expect.objectContaining({ id: '2', name: 'HW300X300', type: 'H', purpose: 'column', standard_steel_name: 'HW300x300' }),
    ]);
    expect(model.sections[0].properties.A).toBeCloseTo(0.00842, 8);
    expect(model.materials).toEqual([
      expect.objectContaining({ id: '1', category: 'steel', grade: 'Q355', fy: 355 }),
      expect.objectContaining({ id: '2', category: 'concrete', grade: 'C30', fc: 14.3 }),
    ]);
    expect(model.nodes[0].restraints).toEqual([true, true, true, true, true, true]);
  });

  test('attaches slab and shear stud design data plus GB 50017 metadata', () => {
    const model = buildCompositeModel(buildCompleteState());

    expect(model.structure_system).toMatchObject({
      type: 'composite',
      extra: { materialSystem: 'steel-concrete-composite' },
    });
    expect(model.project).toMatchObject({ code_standard: 'GB50017-2017', extra: { designCode: 'GB50017' } });
    const beam = model.elements.find((element) => element.compositeRole === 'composite-beam');
    expect(beam.compositeBeam).toMatchObject({
      slabThicknessMm: 150,
      effectiveSlabWidthMm: 2000,
      studDiameterMm: 19,
    });
    expect(beam.compositeBeam.studLayout).toMatchObject({
      studsPerHalfSpan: 38,
      studRows: 2,
      studPitchMm: 150,
      fullShearConnection: true,
    });
    expect(beam.compositeBeam.flexuralCapacityKNM).toBeDefined();
    expect(model.metadata).toMatchObject({
      structuralTypeKey: 'composite',
      designCode: 'GB50017',
      steelGrade: 'Q355',
      concreteGrade: 'C30',
      slabThicknessMm: 150,
      beamSection: 'HN400X200',
      columnSection: 'HW300X300',
    });
    expect(model.metadata.compositeDesign.effectiveSlabWidthMm).toBe(2000);
    expect(model.extensions.compositeDesign.verificationNote.zh).toContain('GB 50017-2017');
    expect(model.extensions.pkpm).toMatchObject({ materialSystem: 'steel-concrete-composite', designCode: 'GB50017' });
    expect(model.coordinate_system).toMatchObject({ semantics: 'global-z-up', dimension: '2d' });
  });

  test('distributes story loads to floor nodes and derives story intensities', () => {
    const model = buildCompositeModel(buildCompleteState());
    expect(model.load_cases.map((loadCase) => loadCase.id)).toEqual(['D', 'L', 'LAT']);
    const dead = model.load_cases.find((loadCase) => loadCase.id === 'D');
    expect(dead.loads).toHaveLength(4);
    expect(dead.loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-400);
    const lateral = model.load_cases.find((loadCase) => loadCase.id === 'LAT');
    expect(lateral.loads.reduce((sum, load) => sum + load.fx, 0)).toBeCloseTo(60);
    expect(model.stories[0]).toMatchObject({ id: 'F1', height: 3.6, dead_load: 200 / 6, live_load: 50 / 6 });
  });

  test('substitutes unknown section designations and keeps the model buildable', () => {
    const model = buildCompositeModel(buildCompleteState({
      compositeSteelBeamSection: 'MYSTERY-BEAM',
      compositeSteelColumnSection: undefined,
    }));

    expect(model).toBeDefined();
    expect(model.metadata.beamSection).toBe('HN350X175');
    expect(model.metadata.columnSection).toBe('HW300X300');
  });

  test('returns undefined when critical inputs are missing', () => {
    expect(buildCompositeModel({ inferredType: 'frame', updatedAt: 0 })).toBeUndefined();
    expect(buildCompositeModel(buildCompleteState({ storyHeightsM: [3.6] }))).toBeUndefined();
    expect(buildCompositeModel(buildCompleteState({ bayWidthsM: undefined }))).toBeUndefined();
    expect(buildCompositeModel(buildCompleteState({
      floorLoads: [{ story: 1, verticalKN: 0 }, { story: 2 }],
    }))).toBeUndefined();
    expect(buildCompositeModel(buildCompleteState({ compositeSlabThicknessMm: undefined }))).toBeUndefined();
  });

  test('handler.buildModel mirrors the module and refuses incomplete states', () => {
    expect(handler.buildModel(buildCompleteState())).toBeDefined();
    expect(handler.buildModel({ inferredType: 'frame', updatedAt: 0 })).toBeUndefined();
  });
});

describe('composite stage resolution and report narrative', () => {
  test('resolves the pipeline stage from missing keys', () => {
    expect(resolveCompositeStage(['storyCount', 'bayWidthsM'])).toBe('model');
    expect(resolveCompositeStage(['floorLoads'])).toBe('loads');
  });

  test('appends a bilingual composite section to the report narrative', () => {
    const baseInput = {
      message: 'composite frame',
      analysisType: 'static',
      analysisSuccess: true,
      codeCheckText: '',
      summary: '',
      keyMetrics: {},
      clauseTraceability: [],
      controllingCases: {},
      visualizationHints: {},
    };
    const en = buildCompositeReportNarrative({ ...baseInput, locale: 'en' });
    expect(en).toContain('## Composite-Specific Notes');
    expect(en).toContain('GB 50017-2017');
    expect(en).toContain('pnaInSteel');

    const zh = buildCompositeReportNarrative({ ...baseInput, locale: 'zh' });
    expect(zh).toContain('## 组合结构专项说明');
    expect(zh).toContain('组合框架');
  });
});
