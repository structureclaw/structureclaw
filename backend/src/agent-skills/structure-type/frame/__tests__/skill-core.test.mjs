import { describe, expect, test } from '@jest/globals';
import { canonicalizeFramePatch } from '../../../../../dist/agent-skills/structure-type/frame/canonicalize.js';
import { normalizeFrameNaturalPatch } from '../../../../../dist/agent-skills/structure-type/frame/extract-natural.js';
import { buildFrameModel } from '../../../../../dist/agent-skills/structure-type/frame/model.js';
import {
  buildFrameDraftPatch,
  buildFramePatchFromLlm,
  coerceFrameDimension,
} from '../../../../../dist/agent-skills/structure-type/frame/extract-llm.js';

describe('frame canonicalize core contract', () => {
  test('promotes to 3d when y-direction evidence conflicts with llm 2d output', () => {
    const patch = canonicalizeFramePatch({
      message: '3D框架，x向2跨每跨6m，y向1跨每跨5m，x向和y向都是20kN',
      existingState: { inferredType: 'frame', updatedAt: 0 },
      naturalPatch: {
        inferredType: 'frame',
        bayCountX: 2,
        bayCountY: 1,
        bayWidthsXM: [6, 6],
        bayWidthsYM: [5],
        floorLoads: [{ story: 1, lateralXKN: 20, lateralYKN: 20 }],
      },
      llmPatch: { inferredType: 'frame', frameDimension: '2d' },
    });

    expect(patch.frameDimension).toBe('3d');
  });

  test('derives story and bay counts from canonical arrays', () => {
    const patch = canonicalizeFramePatch({
      message: '2层2跨框架，每层3m，每跨6m',
      existingState: { inferredType: 'frame', updatedAt: 0 },
      naturalPatch: {
        inferredType: 'frame',
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
    const patch = canonicalizeFramePatch({
      message: 'y向水平荷载12kN',
      existingState: {
        inferredType: 'frame',
        frameDimension: '3d',
        floorLoads: [
          { story: 1, verticalKN: 90, lateralXKN: 18 },
          { story: 2, verticalKN: 90, lateralXKN: 18 },
        ],
        updatedAt: 0,
      },
      naturalPatch: {
        inferredType: 'frame',
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

  test('extracts regular 3d frame geometry from natural chinese phrasing', () => {
    const patch = normalizeFrameNaturalPatch(
      '我想设计一个三层框架，x方向4跨，间隔3m，y方向3跨间隔也是3m，每层3m',
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

  test('extracts repeated english story heights from "4.2m each" phrasing', () => {
    const patch = buildFrameDraftPatch(
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
    const patch = normalizeFrameNaturalPatch(
      '二十二层框架，每层3m，2跨每跨6m',
      undefined,
    );

    expect(patch.storyCount).toBe(22);
  });

  test('infers 3d when x-direction bay count is present without explicit y-direction', () => {
    const patch = buildFrameDraftPatch(
      '三层框架，x方向4跨，间隔6m，每层3m，每层竖向荷载100kN',
      null,
      undefined,
    );

    expect(patch.frameDimension).toBe('3d');
    expect(patch.bayCountX).toBe(4);
    expect(patch.bayWidthsXM).toEqual([6, 6, 6, 6]);
  });

  test('normalizes llm scalar fields into canonical arrays', () => {
    const patch = buildFramePatchFromLlm({
      inferredType: 'frame',
      storyCount: 2,
      bayCount: 2,
      storyHeightM: 3,
      bayWidthM: 6,
      frameMaterial: 'q345',
      frameColumnSection: 'hw350x350',
      frameBeamSection: 'hn400x200',
    }, undefined);

    expect(patch.storyHeightsM).toEqual([3, 3]);
    expect(patch.bayWidthsM).toEqual([6, 6]);
    expect(patch.frameMaterial).toBe('Q345');
    expect(patch.frameColumnSection).toBe('HW350X350');
    expect(patch.frameBeamSection).toBe('HN400X200');
  });

  test('extracts concrete grade and rectangular sections from natural phrasing', () => {
    const patch = normalizeFrameNaturalPatch(
      '两层两跨框架，C30混凝土，柱截面400x400，梁截面250x600，每层3m，每跨6m，每层竖向荷载100kN',
      undefined,
    );

    expect(patch.frameMaterial).toBe('C30');
    expect(patch.frameColumnSection).toBe('400X400');
    expect(patch.frameBeamSection).toBe('250X600');
  });

  test('extracts only supported H-section formats', () => {
    const supported = normalizeFrameNaturalPatch(
      '两层框架，柱截面H400*200*10*16，梁截面HN400x200',
      undefined,
    );
    const unsupported = normalizeFrameNaturalPatch(
      '两层框架，柱截面H400x200',
      undefined,
    );

    expect(supported.frameColumnSection).toBe('H400X200X10X16');
    expect(supported.frameBeamSection).toBe('HN400X200');
    expect(unsupported.frameColumnSection).toBeUndefined();
  });

  test('builds rectangular concrete sections for YJK-compatible frame models', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
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
      frameMaterial: 'C30',
      frameColumnSection: '400X400',
      frameBeamSection: '250X600',
    });

    expect(model).toBeDefined();
    expect(model.materials[0]).toMatchObject({
      name: 'C30',
      grade: 'C30',
      category: 'concrete',
      E: 30000,
      nu: 0.2,
      rho: 2500,
      fc: 14.3,
    });
    expect(model.materials[0].fy).toBeUndefined();
    expect(model.sections[0]).toMatchObject({
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
      name: '250X600',
      type: 'rectangular',
      purpose: 'beam',
      width: 250,
      height: 600,
      shape: { kind: 'rectangular', B: 250, H: 600 },
    });
  });

  test('builds custom H sections with star separators', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 1,
      bayCount: 1,
      storyHeightsM: [3],
      bayWidthsM: [6],
      floorLoads: [{ story: 1, verticalKN: 100 }],
      frameMaterial: 'Q355',
      frameColumnSection: 'H400*200*10*16',
      frameBeamSection: 'H300*150*8*12',
    });

    expect(model).toBeDefined();
    expect(model.sections[0]).toMatchObject({
      name: 'H400X200X10X16',
      type: 'H',
      standard_steel_name: 'H400X200X10X16',
      shape: { kind: 'H', H: 400, B: 200, tw: 10, tf: 16 },
    });
    expect(model.sections[1]).toMatchObject({
      name: 'H300X150X8X12',
      type: 'H',
      standard_steel_name: 'H300X150X8X12',
      shape: { kind: 'H', H: 300, B: 150, tw: 8, tf: 12 },
    });
  });

  test('derives 2d per-floor total loads from floor area intensity when single-bay geometry is explicit', () => {
    const patch = buildFrameDraftPatch(
      '2-story single-bay steel frame, story height 3.6m, bay 6m, floor load 10kN/m2',
      {
        inferredType: 'frame',
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
    const patch = buildFrameDraftPatch(
      '两层3D钢框架，X向2跨每跨6m，Y向1跨6m，层高3.6m，每层总竖向荷载432kN',
      {
        inferredType: 'frame',
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
    const patch = buildFrameDraftPatch(
      '两层3D钢框架，X向2跨每跨6m，Y向1跨6m，层高3.6m，恒载4kN/㎡，活载2kN/㎡',
      {
        inferredType: 'frame',
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
    const patch = buildFrameDraftPatch(
      '两层3D钢框架，X向2跨每跨6m，Y向1跨6m，层高3.6m，活载2kN/㎡，4kN/㎡',
      {
        inferredType: 'frame',
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
    const patch = buildFrameDraftPatch(
      '3层2跨框架，层高3.3m，跨度5.4m和6m，每层楼面荷载15kN/m',
      {
        inferredType: 'frame',
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
    const patch = coerceFrameDimension({
      inferredType: 'frame',
      storyCount: 2,
      bayCount: 2,
      storyHeightsM: [3, 3],
      bayWidthsM: [6, 6],
      floorLoads: [
        { story: 1, verticalKN: 120, lateralXKN: 30 },
        { story: 2, verticalKN: 120, lateralXKN: 30 },
      ],
    }, undefined, '两层两跨框架，每层3m');

    expect(patch.frameDimension).toBeUndefined();
  });
});
