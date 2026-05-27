import { describe, expect, test } from '@jest/globals';
import { canonicalizeConcreteFramePatch } from '../../../../../dist/agent-skills/structure-type/concrete-frame/canonicalize.js';
import { normalizeConcreteFrameNaturalPatch, parseChineseNumber } from '../../../../../dist/agent-skills/structure-type/concrete-frame/extract-natural.js';
import { buildConcreteFrameModel } from '../../../../../dist/agent-skills/structure-type/concrete-frame/model.js';
import {
  buildConcreteFrameDraftPatch,
  buildConcreteFramePatchFromLlm,
  coerceConcreteFrameDimension,
} from '../../../../../dist/agent-skills/structure-type/concrete-frame/extract-llm.js';
import { detectConcreteFrameStructuralType } from '../../../../../dist/agent-skills/structure-type/concrete-frame/detect.js';
import { computeConcreteFrameMissing } from '../../../../../dist/agent-skills/structure-type/concrete-frame/interaction.js';

describe('concrete-frame canonicalize core contract', () => {
  test('promotes to 3d when y-direction evidence conflicts with llm 2d output', () => {
    const patch = canonicalizeConcreteFramePatch({
      message: '3D混凝土框架，x向2跨每跨6m，y向1跨每跨5m，x向和y向都是20kN',
      existingState: { inferredType: 'concrete-frame', updatedAt: 0 },
      naturalPatch: {
        inferredType: 'concrete-frame',
        bayCountX: 2,
        bayCountY: 1,
        bayWidthsXM: [6, 6],
        bayWidthsYM: [5],
        floorLoads: [{ story: 1, lateralXKN: 20, lateralYKN: 20 }],
      },
      llmPatch: { inferredType: 'concrete-frame', frameDimension: '2d' },
    });

    expect(patch.frameDimension).toBe('3d');
  });

  test('derives story and bay counts from canonical arrays', () => {
    const patch = canonicalizeConcreteFramePatch({
      message: '2层2跨混凝土框架，每层3m，每跨6m',
      existingState: { inferredType: 'concrete-frame', updatedAt: 0 },
      naturalPatch: {
        inferredType: 'concrete-frame',
        storyHeightsM: [3, 3],
        bayWidthsM: [6, 6],
      },
      llmPatch: null,
    });

    expect(patch.frameDimension).toBeUndefined();
    expect(patch.storyCount).toBe(2);
    expect(patch.bayCount).toBe(2);
  });

  test('merges floor loads by story without dropping earlier values', () => {
    const patch = canonicalizeConcreteFramePatch({
      message: 'y向水平荷载12kN',
      existingState: {
        inferredType: 'concrete-frame',
        frameDimension: '3d',
        floorLoads: [
          { story: 1, verticalKN: 90, lateralXKN: 18 },
          { story: 2, verticalKN: 90, lateralXKN: 18 },
        ],
        updatedAt: 0,
      },
      naturalPatch: {
        inferredType: 'concrete-frame',
        floorLoads: [
          { story: 1, lateralYKN: 12 },
          { story: 2, lateralYKN: 12 },
        ],
      },
      llmPatch: null,
    });

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 90, lateralXKN: 18, lateralYKN: 12 },
      { story: 2, verticalKN: 90, lateralXKN: 18, lateralYKN: 12 },
    ]);
  });

  test('extracts regular 3d concrete frame geometry from natural chinese phrasing', () => {
    const patch = normalizeConcreteFrameNaturalPatch(
      '我想设计一个三层混凝土框架，x方向4跨，间隔3m，y方向3跨间隔也是3m，每层3m',
      undefined,
    );

    expect(patch.frameDimension).toBe('3d');
    expect(patch.storyCount).toBe(3);
    expect(patch.storyHeightsM).toEqual([3, 3, 3]);
    expect(patch.bayCountX).toBe(4);
    expect(patch.bayCountY).toBe(3);
    expect(patch.bayWidthsXM).toEqual([3, 3, 3, 3]);
    expect(patch.bayWidthsYM).toEqual([3, 3, 3]);
  });

  test('extracts rc frame geometry when the second plan direction is written as z-direction', () => {
    const message = '我想设计一个两层钢筋混凝土框架，用YJK计算，X向2跨每跨6.0m，Z向1跨6.0m，层高3.6m×2层。柱截面600x600，梁截面500x250，柱脚刚接，梁柱刚接。具体配筋你来设计';
    const patch = buildConcreteFrameDraftPatch(message, null, undefined);

    expect(patch).toMatchObject({
      inferredType: 'frame',
      frameDimension: '3d',
      storyCount: 2,
      bayCountX: 2,
      bayCountY: 1,
      storyHeightsM: [3.6, 3.6],
      bayWidthsXM: [6, 6],
      bayWidthsYM: [6],
      frameColumnSection: '600X600',
      frameBeamSection: '500X250',
    });

    const model = buildConcreteFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'concrete-frame',
      skillId: 'concrete-frame',
      updatedAt: 0,
      ...patch,
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      floorLoads: [
        { story: 1, verticalKN: 300 },
        { story: 2, verticalKN: 300 },
      ],
    });

    expect(model).toBeDefined();
    expect(model.frameDimension).toBe('3d');
    expect(model.nodes).toHaveLength(18);
    expect(model.elements).toHaveLength(26);
    expect(model.sections[0]).toMatchObject({
      id: '1',
      type: 'rectangular',
      purpose: 'column',
      width: 600,
      height: 600,
      shape: { kind: 'rectangular', B: 600, H: 600 },
    });
    expect(model.sections[1]).toMatchObject({
      id: '2',
      type: 'rectangular',
      purpose: 'beam',
      width: 500,
      height: 250,
      shape: { kind: 'rectangular', B: 500, H: 250 },
    });
    expect(model.materials[0]).toMatchObject({
      id: '1',
      category: 'concrete',
      grade: 'C30',
    });
    expect(model.elements.find((element) => element.type === 'beam')).toMatchObject({
      material: '1',
      section: '2',
      concrete_grade: 'C30',
      rebar_grade: 'HRB400',
    });
  });

  test('infers 3d concrete frame when z-direction bay count uses chinese numerals', () => {
    const patch = normalizeConcreteFrameNaturalPatch(
      '两层混凝土框架，X向2跨每跨6m，Z向一跨每跨5m，层高3m',
      undefined,
    );

    expect(patch.frameDimension).toBe('3d');
    expect(patch.bayCountY).toBe(1);
    expect(patch.bayWidthsYM).toEqual([5]);
  });

  test('extracts repeated english story heights from "4.2m each" phrasing', () => {
    const patch = buildConcreteFrameDraftPatch(
      '3 stories, 4.2m each, single bay 8m, floor load 12kN/m2',
      null,
      undefined,
    );

    expect(patch.storyCount).toBe(3);
    expect(patch.storyHeightsM).toEqual([4.2, 4.2, 4.2]);
    expect(patch.bayCount).toBe(1);
    expect(patch.bayWidthsM).toEqual([8]);
  });

  test('parses structured chinese numerals between 21 and 99', () => {
    const patch = normalizeConcreteFrameNaturalPatch(
      '二十二层混凝土框架，每层3m，2跨每跨6m',
      undefined,
    );

    expect(patch.storyCount).toBe(22);
  });

  test('infers 3d when x-direction bay count is present without explicit y-direction', () => {
    const patch = buildConcreteFrameDraftPatch(
      '三层混凝土框架，x方向4跨，间隔6m，每层3m，每层竖向荷载100kN',
      null,
      undefined,
    );

    expect(patch.frameDimension).toBe('3d');
    expect(patch.bayCountX).toBe(4);
    expect(patch.bayWidthsXM).toEqual([6, 6, 6, 6]);
  });

  test('normalizes llm scalar fields into canonical arrays', () => {
    const patch = buildConcreteFramePatchFromLlm({
      inferredType: 'concrete-frame',
      storyCount: 2,
      bayCount: 2,
      storyHeightM: 3,
      bayWidthM: 6,
      frameConcreteGrade: 'C30',
      frameColumnSection: '500X500',
      frameBeamSection: '300X600',
    }, undefined);

    expect(patch.storyHeightsM).toEqual([3, 3]);
    expect(patch.bayWidthsM).toEqual([6, 6]);
    expect(patch.frameConcreteGrade).toBe('C30');
    expect(patch.frameColumnSection).toBe('500X500');
    expect(patch.frameBeamSection).toBe('300X600');
  });

  test('extracts concrete grade and rectangular sections from natural phrasing', () => {
    const patch = normalizeConcreteFrameNaturalPatch(
      '两层两跨混凝土框架，C30混凝土，柱截面400x400，梁截面250x600，每层3m，每跨6m，每层竖向荷载100kN',
      undefined,
    );

    expect(patch.frameConcreteGrade).toBe('C30');
    expect(patch.frameColumnSection).toBe('400X400');
    expect(patch.frameBeamSection).toBe('250X600');
  });

  test('builds rectangular concrete sections for YJK-compatible frame models', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'concrete-frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 1,
      storyHeightsM: [3, 3],
      bayWidthsM: [6],
      floorLoads: [
        { story: 1, verticalKN: 100 },
        { story: 2, verticalKN: 100 },
      ],
      frameBaseSupportType: 'fixed',
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '400X400',
      frameBeamSection: '250X600',
    });

    expect(model).toBeDefined();
    expect(model.schema_version).toBe('2.0.0');
    expect(model.unit_system).toBe('SI');
    expect(model.metadata).toMatchObject({
      inferredType: 'frame',
      structuralTypeKey: 'concrete-frame',
      materialSystem: 'reinforced-concrete',
      designCode: 'GB50010',
    });
    expect(model.project.extra.designCode).toBe('GB50010');
    expect(model.extensions.yjk).toMatchObject({
      materialSystem: 'reinforced-concrete',
      designCode: 'GB50010',
    });
    expect(model.materials[0]).toMatchObject({
      id: '1',
      name: 'C30',
      grade: 'C30',
      category: 'concrete',
      E: 30000,
      nu: 0.2,
      rho: 2500,
      fc: 14.3,
    });
    expect(model.materials[0].fy).toBeUndefined();
    expect(model.materials[1]).toMatchObject({
      id: '2',
      name: 'HRB400',
      grade: 'HRB400',
      category: 'rebar',
      fy: 360,
    });
    expect(model.sections[0]).toMatchObject({
      id: '1',
      name: '400X400',
      type: 'rectangular',
      purpose: 'column',
      width: 400,
      height: 400,
      shape: { kind: 'rectangular', B: 400, H: 400 },
    });
    expect(model.sections[0].properties.J).toBeCloseTo(0.003605333333, 8);
    expect(model.sections[0].properties.J).toBeLessThan(
      model.sections[0].properties.Iy + model.sections[0].properties.Iz,
    );
    expect(model.sections[0].standard_steel_name).toBeUndefined();
    expect(model.sections[1]).toMatchObject({
      id: '2',
      name: '250X600',
      type: 'rectangular',
      purpose: 'beam',
      width: 250,
      height: 600,
      shape: { kind: 'rectangular', B: 250, H: 600 },
    });
    expect(model.nodes).toHaveLength(6);
    expect(model.elements).toHaveLength(6);
    expect(model.elements.find((element) => element.id === 'C1')).toMatchObject({
      type: 'column',
      material: '1',
      section: '1',
      concrete_grade: 'C30',
      rebar_grade: 'HRB400',
    });
    expect(model.elements.find((element) => element.type === 'beam')).toMatchObject({
      material: '1',
      section: '2',
      concrete_grade: 'C30',
      rebar_grade: 'HRB400',
    });
    expect(model.stories).toEqual([
      expect.objectContaining({
        id: 'F1',
        floor_loads: [{ type: 'dead', value: 16.67 }],
        dead_load: 16.67,
      }),
      expect.objectContaining({
        id: 'F2',
        floor_loads: [{ type: 'dead', value: 16.67 }],
        dead_load: 16.67,
      }),
    ]);
    expect(model.load_cases.map((loadCase) => loadCase.id)).toEqual(['D']);
    expect(model.load_combinations[0]).toMatchObject({
      id: 'ULS',
      combination_type: 'uls',
      code_reference: 'GB50010',
      factors: { D: 1 },
    });
  });

  test('builds a 3d concrete frame model with y-direction beams for YJK conversion', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'concrete-frame',
      updatedAt: 0,
      frameDimension: '3d',
      storyCount: 2,
      bayCountX: 2,
      bayCountY: 1,
      storyHeightsM: [3.6, 3.6],
      bayWidthsXM: [6, 6],
      bayWidthsYM: [5],
      floorLoads: [
        { story: 1, verticalKN: 360, liveLoadKN: 120, lateralXKN: 30, lateralYKN: 12 },
        { story: 2, verticalKN: 360, liveLoadKN: 120, lateralXKN: 30, lateralYKN: 12 },
      ],
      frameBaseSupportType: 'fixed',
      frameConcreteGrade: 'C35',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '500X500',
      frameBeamSection: '300X600',
    });

    expect(model).toBeDefined();
    expect(model.frameDimension).toBe('3d');
    expect(model.nodes).toHaveLength(18);
    expect(model.elements.filter((element) => element.type === 'column')).toHaveLength(12);
    expect(model.elements.filter((element) => element.id.startsWith('BX'))).toHaveLength(8);
    expect(model.elements.filter((element) => element.id.startsWith('BY'))).toHaveLength(6);
    expect(model.metadata.elementReferenceVectors).toBeDefined();
    expect(model.stories[0]).toMatchObject({
      id: 'F1',
      dead_load: 6,
      live_load: 2,
    });
    expect(model.load_cases.map((loadCase) => loadCase.id)).toEqual(['D', 'L', 'LAT']);
  });

  test('returns undefined when critical geometry is missing (H2 fix)', () => {
    // Empty state - no geometry provided
    expect(buildConcreteFrameModel({ inferredType: 'frame', updatedAt: 0 })).toBeUndefined();

    // Only storyCount, missing bayCount
    expect(buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      storyCount: 3,
    })).toBeUndefined();

    // Only bayCount, missing storyCount
    expect(buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      bayCount: 2,
    })).toBeUndefined();

    // storyCount/bayCount present but arrays missing
    expect(buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      storyCount: 3,
      bayCount: 2,
    })).toBeUndefined();
  });

  test('returns undefined when geometry arrays have wrong length (H4 fix)', () => {
    // storyCount=5 but storyHeightsM only has 2 elements
    expect(buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 5,
      bayCount: 2,
      storyHeightsM: [3, 3],  // should be 5 elements
      bayWidthsM: [6, 6],
    })).toBeUndefined();

    // bayCount=3 but bayWidthsM only has 2 elements
    expect(buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 3,
      storyHeightsM: [3, 3],
      bayWidthsM: [6, 6],  // should be 3 elements
    })).toBeUndefined();
  });

  test('derives 2d per-floor total loads from floor area intensity when single-bay geometry is explicit', () => {
    const patch = buildConcreteFrameDraftPatch(
      '2-story single-bay concrete frame, story height 3.6m, bay 6m, floor load 10kN/m2',
      {
        inferredType: 'concrete-frame',
        frameDimension: '2d',
        storyCount: 2,
        bayCount: 1,
        storyHeightsM: [3.6, 3.6],
        bayWidthsM: [6],
      },
      undefined,
    );

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 360 },
      { story: 2, verticalKN: 360 },
    ]);
  });

  test('repairs llm floor loads that omit story numbers', () => {
    const patch = buildConcreteFrameDraftPatch(
      '两层3D混凝土框架，X向2跨每跨6m，Y向1跨6m，层高3.6m，每层总竖向荷载432kN',
      {
        inferredType: 'concrete-frame',
        frameDimension: '3d',
        storyCount: 2,
        bayCountX: 2,
        bayCountY: 1,
        storyHeightsM: [3.6, 3.6],
        bayWidthsXM: [6, 6],
        bayWidthsYM: [6],
        floorLoads: [
          { verticalKN: 432 },
          { verticalKN: 432 },
        ],
      },
      undefined,
    );

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 432 },
      { story: 2, verticalKN: 432 },
    ]);
  });

  test('derives 3d dead and live floor loads from chinese area-load units', () => {
    const patch = buildConcreteFrameDraftPatch(
      '两层3D混凝土框架，X向2跨每跨6m，Y向1跨6m，层高3.6m，恒载4kN/㎡，活载2kN/㎡',
      {
        inferredType: 'concrete-frame',
        frameDimension: '3d',
        storyCount: 2,
        bayCountX: 2,
        bayCountY: 1,
        storyHeightsM: [3.6, 3.6],
        bayWidthsXM: [6, 6],
        bayWidthsYM: [6],
      },
      undefined,
    );

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 288, liveLoadKN: 144 },
      { story: 2, verticalKN: 288, liveLoadKN: 144 },
    ]);
  });

  test('derives dead load when live load appears before an unlabeled area intensity', () => {
    const patch = buildConcreteFrameDraftPatch(
      '两层3D混凝土框架，X向2跨每跨6m，Y向1跨6m，层高3.6m，活载2kN/㎡，4kN/㎡',
      {
        inferredType: 'concrete-frame',
        frameDimension: '3d',
        storyCount: 2,
        bayCountX: 2,
        bayCountY: 1,
        storyHeightsM: [3.6, 3.6],
        bayWidthsXM: [6, 6],
        bayWidthsYM: [6],
      },
      undefined,
    );

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 288, liveLoadKN: 144 },
      { story: 2, verticalKN: 288, liveLoadKN: 144 },
    ]);
  });

  test('derives 2d per-floor total loads from line intensity and total span length', () => {
    const patch = buildConcreteFrameDraftPatch(
      '3层2跨混凝土框架，层高3.3m，跨度5.4m和6m，每层楼面荷载15kN/m',
      {
        inferredType: 'concrete-frame',
        frameDimension: '2d',
        storyCount: 3,
        bayCount: 2,
        storyHeightsM: [3.3, 3.3, 3.3],
        bayWidthsM: [5.4, 6],
      },
      undefined,
    );

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 171 },
      { story: 2, verticalKN: 171 },
      { story: 3, verticalKN: 171 },
    ]);
  });

  test('leaves frame dimension undefined when no directional evidence or existing state exists', () => {
    const patch = coerceConcreteFrameDimension({
      inferredType: 'concrete-frame',
      storyCount: 2,
      bayCount: 2,
      storyHeightsM: [3, 3],
      bayWidthsM: [6, 6],
      floorLoads: [
        { story: 1, verticalKN: 120, lateralXKN: 30 },
        { story: 2, verticalKN: 120, lateralXKN: 30 },
      ],
    }, undefined, '两层两跨混凝土框架，每层3m');

    expect(patch.frameDimension).toBeUndefined();
  });
});

// CRITICAL: parseChineseNumber unit tests (H1 fix verification)
describe('parseChineseNumber edge cases', () => {
  test('handles single digit characters', () => {
    expect(parseChineseNumber('零')).toBe(0);
    expect(parseChineseNumber('〇')).toBe(0);
    expect(parseChineseNumber('一')).toBe(1);
    expect(parseChineseNumber('二')).toBe(2);
    expect(parseChineseNumber('三')).toBe(3);
    expect(parseChineseNumber('四')).toBe(4);
    expect(parseChineseNumber('五')).toBe(5);
    expect(parseChineseNumber('六')).toBe(6);
    expect(parseChineseNumber('七')).toBe(7);
    expect(parseChineseNumber('八')).toBe(8);
    expect(parseChineseNumber('九')).toBe(9);
    expect(parseChineseNumber('十')).toBe(10);
  });

  test('handles compound numbers 11-99', () => {
    expect(parseChineseNumber('十一')).toBe(11);
    expect(parseChineseNumber('十九')).toBe(19);
    expect(parseChineseNumber('二十')).toBe(20);
    expect(parseChineseNumber('二十二')).toBe(22);
    expect(parseChineseNumber('九十九')).toBe(99);
    expect(parseChineseNumber('十')).toBe(10);
  });

  test('handles numbers with units (layer, floor)', () => {
    expect(parseChineseNumber('三层')).toBe(3);
    expect(parseChineseNumber('十层')).toBe(10);
    expect(parseChineseNumber('二十二层')).toBe(22);
  });

  test('handles empty string', () => {
    expect(parseChineseNumber('')).toBeUndefined();
    expect(parseChineseNumber('   ')).toBeUndefined();
  });

  test('does not incorrectly parse mixed Chinese text', () => {
    // H1 fix: "其中一层" should not return 1
    expect(parseChineseNumber('其中一层')).toBeUndefined();
    expect(parseChineseNumber('第一层')).toBeUndefined();
    expect(parseChineseNumber('某一层')).toBeUndefined();
  });
});

// CRITICAL: detect.ts all branches coverage
describe('detectConcreteFrameStructuralType branches', () => {
  test('detects unsupported irregular concrete frame', () => {
    const result = detectConcreteFrameStructuralType({
      message: '混凝土框架不规则，有退台',
      locale: 'zh',
    });
    expect(result?.supportLevel).toBe('unsupported');
    expect(result?.key).toBe('concrete-frame');
  });

  test('detects explicit concrete frame', () => {
    const result = detectConcreteFrameStructuralType({
      message: '混凝土框架',
      locale: 'zh',
    });
    expect(result?.supportLevel).toBe('supported');
    expect(result?.mappedType).toBe('frame');
  });

  test('detects concrete frame with concrete keyword', () => {
    const result = detectConcreteFrameStructuralType({
      message: 'concrete frame structure',
      locale: 'en',
    });
    expect(result?.supportLevel).toBe('supported');
  });

  test('detects concrete frame with rc keyword', () => {
    const result = detectConcreteFrameStructuralType({
      message: 'RC框架，三层两跨',
      locale: 'zh',
    });
    expect(result?.supportLevel).toBe('supported');
  });

  test('detects frame with building type context', () => {
    const result = detectConcreteFrameStructuralType({
      message: '办公楼，混凝土柱网，三层',
      locale: 'zh',
    });
    expect(result?.supportLevel).toBe('supported');
  });

  test('detects frame with concrete grade and context', () => {
    const result = detectConcreteFrameStructuralType({
      message: 'C30混凝土框架，两层',
      locale: 'zh',
    });
    expect(result?.supportLevel).toBe('supported');
  });

  test('detects from currentState when message does not match', () => {
    const result = detectConcreteFrameStructuralType({
      message: '请分析这个结构',
      locale: 'zh',
      currentState: { structuralTypeKey: 'concrete-frame', supportLevel: 'supported' },
    });
    expect(result?.supportLevel).toBe('supported');
  });

  test('returns null when no concrete frame evidence', () => {
    const result = detectConcreteFrameStructuralType({
      message: '这是一个普通文本',
      locale: 'zh',
    });
    expect(result).toBeNull();
  });
});

// CRITICAL: model.ts error paths and fallback behavior (H2/H3/H4 fix verification)
describe('buildConcreteFrameModel error paths', () => {
  test('falls back to C30 for invalid concrete grade', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 1,
      storyHeightsM: [3, 3],
      bayWidthsM: [6],
      frameConcreteGrade: 'INVALID_GRADE',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '400X400',
      frameBeamSection: '250X600',
    });
    expect(model?.frameConcreteGrade).toBe('C30');
    expect(model?.concreteProps.grade).toBe('C30');
  });

  test('falls back to HRB400 for invalid rebar grade', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 1,
      storyHeightsM: [3, 3],
      bayWidthsM: [6],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'INVALID_GRADE',
      frameColumnSection: '400X400',
      frameBeamSection: '250X600',
    });
    expect(model?.frameRebarGrade).toBe('HRB400');
    expect(model?.rebarProps.grade).toBe('HRB400');
  });

  test('uses default column section when not provided', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 1,
      storyHeightsM: [3, 3],
      bayWidthsM: [6],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      frameColumnSection: undefined,
      frameBeamSection: '250X600',
    });
    expect(model?.frameColumnSection).toBe('500X500');
  });

  test('uses default beam section when not provided', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 1,
      storyHeightsM: [3, 3],
      bayWidthsM: [6],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '400X400',
      frameBeamSection: undefined,
    });
    expect(model?.frameBeamSection).toBe('300X600');
  });
});

// IMPORTANT: extract-natural.ts adversarial input handling
describe('normalizeConcreteFrameNaturalPatch adversarial inputs', () => {
  test('handles empty message gracefully', () => {
    const patch = normalizeConcreteFrameNaturalPatch('', undefined);
    expect(patch.storyCount).toBeUndefined();
    expect(patch.frameConcreteGrade).toBeUndefined();
  });

  test('handles gibberish input gracefully', () => {
    const patch = normalizeConcreteFrameNaturalPatch('asdfghjkl qwerty', undefined);
    expect(patch.storyCount).toBeUndefined();
    expect(patch.frameDimension).toBeUndefined();
  });

  test('handles mixed Chinese/English with numbers', () => {
    const patch = normalizeConcreteFrameNaturalPatch(
      '3层混凝土框架，每层3m，concrete grade C30',
      undefined,
    );
    expect(patch.storyCount).toBe(3);
    expect(patch.frameConcreteGrade).toBe('C30');
  });

  test('extracts concrete grade when mixed with rebar grade', () => {
    const patch = normalizeConcreteFrameNaturalPatch(
      '混凝土框架，C30混凝土，HRB400钢筋',
      undefined,
    );
    expect(patch.frameConcreteGrade).toBe('C30');
    expect(patch.frameRebarGrade).toBe('HRB400');
  });
});

// IMPORTANT: computeMissing boundary cases
describe('computeConcreteFrameMissing boundary cases', () => {
  test('returns all keys missing for empty state', () => {
    const result = computeConcreteFrameMissing({
      inferredType: 'frame',
      updatedAt: 0,
    }, 'interactive');
    expect(result.critical.length).toBeGreaterThan(0);
    expect(result.optional.length).toBeGreaterThanOrEqual(0);
  });

  test('returns empty missing for complete state', () => {
    const result = computeConcreteFrameMissing({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 3,
      bayCount: 2,
      storyHeightsM: [3, 3, 3],
      bayWidthsM: [6, 6],
      floorLoads: [
        { story: 1, verticalKN: 100 },
        { story: 2, verticalKN: 100 },
        { story: 3, verticalKN: 100 },
      ],
      frameBaseSupportType: 'fixed',
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '500X500',
      frameBeamSection: '300X600',
    }, 'interactive');
    expect(result.critical.length).toBe(0);
    expect(result.optional.length).toBe(0);
  });

  test('returns partial missing for partially complete state', () => {
    const result = computeConcreteFrameMissing({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 3,
      bayCount: 2,
      storyHeightsM: [3, 3, 3],
      bayWidthsM: [6, 6],
    }, 'interactive');
    expect(result.critical.length).toBeGreaterThan(0);
    expect(result.critical).toContain('floorLoads');
    expect(result.critical).toContain('frameConcreteGrade');
  });
});
