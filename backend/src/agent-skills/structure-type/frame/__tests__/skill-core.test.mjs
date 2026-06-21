import { describe, expect, test } from '@jest/globals';
import { canonicalizeFramePatch } from '../../../../../dist/agent-skills/structure-type/frame/canonicalize.js';
import { buildFrameModel } from '../../../../../dist/agent-skills/structure-type/frame/model.js';
import {
  buildFrameDraftPatch,
  buildFramePatchFromLlm,
  coerceFrameDimension,
} from '../../../../../dist/agent-skills/structure-type/frame/extract-llm.js';
import { detectFrameStructuralType } from '../../../../../dist/agent-skills/structure-type/frame/detect.js';

describe('frame canonicalize core contract', () => {
  test('promotes to 3d when y-direction evidence conflicts with llm 2d output', () => {
    const patch = canonicalizeFramePatch({
      existingState: { inferredType: 'frame', updatedAt: 0 },
      supplementalPatch: {
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
      existingState: { inferredType: 'frame', updatedAt: 0 },
      supplementalPatch: {
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
      existingState: {
        inferredType: 'frame',
        frameDimension: '3d',
        floorLoads: [
          { story: 1, verticalKN: 90, lateralXKN: 18 },
          { story: 2, verticalKN: 90, lateralXKN: 18 },
        ],
        updatedAt: 0,
      },
      supplementalPatch: {
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

  test('does not claim explicit reinforced-concrete frame prompts', () => {
    const result = detectFrameStructuralType({
      message: '两层钢筋混凝土框架，X向2跨，Z向1跨',
      locale: 'zh',
    });

    expect(result).toBeNull();
  });

  test('normalizes repeated story and bay scalars into canonical arrays', () => {
    const patch = buildFrameDraftPatch(
      {
        inferredType: 'frame',
        storyCount: 3,
        storyHeightScalar: 4.2,
        bayCount: 1,
        bayWidthScalar: 8,
      },
      undefined,
    );

    expect(patch.storyCount).toBe(3);
    expect(patch.storyHeightsM).toEqual([4.2, 4.2, 4.2]);
    expect(patch.bayCount).toBe(1);
    expect(patch.bayWidthsM).toEqual([8]);
  });

  test('keeps x-direction geometry without inventing a 3d frame from one direction', () => {
    const patch = buildFrameDraftPatch(
      {
        inferredType: 'frame',
        storyCount: 3,
        storyHeightScalar: 3,
        bayCountX: 4,
        bayWidthXScalar: 6,
        verticalLoadKN: 100,
      },
      undefined,
    );

    expect(patch.frameDimension).toBeUndefined();
    expect(patch.bayCountX).toBe(4);
    expect(patch.bayWidthsXM).toEqual([6, 6, 6, 6]);
  });

  test('uses only structured engineeringDraft fields for extraction', () => {
    const patch = buildFrameDraftPatch(
      {
        engineeringDraft: {
          structureType: 'steel-frame',
          geometry: {
            storyHeightsM: [3.2, 3.2],
            bayWidthsM: [7],
          },
          loads: [
            { kind: 'nodal', magnitude: 80, unit: 'kN', direction: 'gravity', target: 'floor' },
          ],
        },
      },
      undefined,
    );

    expect(patch.engineeringDraft).toBeDefined();
    expect(patch.frameDimension).toBe('2d');
    expect(patch.storyCount).toBe(2);
    expect(patch.bayCount).toBe(1);
    expect(patch.storyHeightsM).toEqual([3.2, 3.2]);
    expect(patch.bayWidthsM).toEqual([7]);
    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 80 },
      { story: 2, verticalKN: 80 },
    ]);
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

  test('emits story tags and V2 floor_loads for OpenSees floor load expansion', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '3d',
      storyCount: 1,
      bayCountX: 1,
      bayCountY: 1,
      storyHeightsM: [3.6],
      bayWidthsXM: [6],
      bayWidthsYM: [6],
      floorLoads: [{ story: 1, verticalKN: 360, liveLoadKN: 72 }],
      frameBaseSupportType: 'fixed',
    });

    expect(model).toBeDefined();
    expect(model.nodes.find((node) => node.id === 'N1_0_0')).toMatchObject({ story: 'F1' });
    expect(model.nodes.find((node) => node.id === 'N0_0_0').story).toBeUndefined();
    expect(model.elements.filter((element) => element.type === 'beam').every((element) => element.story === 'F1')).toBe(true);
    expect(model.stories[0].floor_loads).toEqual([
      { type: 'dead', value: 10 },
      { type: 'live', value: 2 },
    ]);
    expect(model.stories[0]).toMatchObject({ dead_load: 10, live_load: 2 });
    expect(model.load_cases.map((loadCase) => loadCase.id)).toEqual(['D', 'L']);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads).toHaveLength(4);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-360);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads).toHaveLength(4);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-72);
    expect(model.load_combinations[0]).toMatchObject({ id: 'ULS', factors: { D: 1, L: 1 } });
  });

  test('normalizes duplicate same-story floor loads without dropping signed gravity loads', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 1,
      bayCount: 1,
      storyHeightsM: [3.6],
      bayWidthsM: [6],
      floorLoads: [
        { story: 1, verticalKN: -120 },
        { story: 1, verticalKN: -120, liveLoadKN: 30 },
      ],
      frameBaseSupportType: 'fixed',
    });

    expect(model).toBeDefined();
    expect(model.stories[0]).toMatchObject({ dead_load: 20, live_load: 5 });
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads).toHaveLength(2);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-120);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads).toHaveLength(2);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-30);
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
      {
        engineeringDraft: {
          structureType: 'steel-frame',
          geometry: {
            storyHeightsM: [3.6, 3.6],
            bayWidthsM: [6],
          },
          loads: [
            { kind: 'area', magnitude: 10, unit: 'kN/m2', direction: 'gravity' },
          ],
        },
      },
      undefined,
    );

    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 360 },
      { story: 2, verticalKN: 360 },
    ]);
  });

  test('projects basic wind pressure into lateral floor loads without dropping gravity loads', () => {
    const existingState = {
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '2d',
      storyCount: 2,
      storyHeightsM: [3.6, 3.6],
      bayCount: 1,
      bayWidthsM: [6],
      floorLoads: [
        { story: 1, verticalKN: 120 },
        { story: 2, verticalKN: 120 },
      ],
    };
    const patch = buildFrameDraftPatch(
      {
        wind: { basicPressureKNM2: 0.5 },
      },
      existingState,
    );

    expect(patch.wind).toEqual({ basicPressureKNM2: 0.5 });
    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 120, lateralXKN: 10.8 },
      { story: 2, verticalKN: 120, lateralXKN: 10.8 },
    ]);

    const model = buildFrameModel({
      ...existingState,
      ...patch,
    });

    expect(model.load_cases.map((loadCase) => loadCase.id)).toEqual(['D', 'LAT']);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'LAT').loads.reduce((sum, load) => sum + load.fx, 0)).toBeCloseTo(21.6);
  });

  test('repairs llm floor loads that omit story numbers', () => {
    const patch = buildFrameDraftPatch(
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

  test('derives 2d per-floor total loads from line intensity and total span length', () => {
    const patch = buildFrameDraftPatch(
      {
        engineeringDraft: {
          structureType: 'steel-frame',
          geometry: {
            storyHeightsM: [3.3, 3.3, 3.3],
            bayWidthsM: [5.4, 6],
          },
          loads: [
            { kind: 'line', magnitude: 15, unit: 'kN/m', direction: 'gravity' },
          ],
        },
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
    }, undefined);

    expect(patch.frameDimension).toBeUndefined();
  });
});
