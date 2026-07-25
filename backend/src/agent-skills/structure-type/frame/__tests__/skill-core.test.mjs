import { describe, expect, test } from '@jest/globals';
import { canonicalizeFramePatch } from '../../../../../dist/agent-skills/structure-type/frame/canonicalize.js';
import { buildFrameModel } from '../../../../../dist/agent-skills/structure-type/frame/model.js';
import {
  buildFrameDraftPatch,
  buildFramePatchFromLlm,
  coerceFrameDimension,
} from '../../../../../dist/agent-skills/structure-type/frame/extract-llm.js';
import { mergeFrameState } from '../../../../../dist/agent-skills/structure-type/frame/merge.js';
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

  test('preserves structured seismic workflow through draft patch and merge', () => {
    const seismicWorkflow = {
      methodPreference: 'response_spectrum',
      designBasis: {
        siteSeismic: { intensity: 7, designGroup: '1', siteCategory: 'II' },
      },
      responseSpectrum: { modalCombination: 'cqc' },
      directions: ['x'],
    };
    const patch = buildFrameDraftPatch(
      {
        inferredType: 'frame',
        storyCount: 2,
        bayCount: 1,
        skillState: { seismicWorkflow },
      },
      undefined,
    );
    const merged = mergeFrameState({
      inferredType: 'frame',
      updatedAt: 0,
      skillState: { existingFlag: true },
    }, patch);

    expect(patch.skillState?.seismicWorkflow).toEqual(seismicWorkflow);
    expect(merged.skillState).toMatchObject({
      existingFlag: true,
      seismicWorkflow,
    });
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
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads).toEqual([]);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads).toEqual([]);
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
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads).toEqual([]);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads).toEqual([]);
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

  test('keeps 2d frame line intensity as beam distributed loads', () => {
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

    expect(patch.floorLoads).toBeUndefined();
    const model = buildFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameBaseSupportType: 'fixed',
      ...patch,
    });

    const lineCase = model.load_cases.find((loadCase) => loadCase.id === 'LINE');
    expect(lineCase).toBeDefined();
    expect(lineCase.loads).toHaveLength(6);
    expect(lineCase.loads.every((load) => load.type === 'distributed')).toBe(true);
    expect(lineCase.loads.every((load) => load.wz === -15)).toBe(true);
    expect(lineCase.loads.map((load) => load.element)).toEqual(['B10', 'B11', 'B12', 'B13', 'B14', 'B15']);
  });

  test('preserves named line-load cases and explicit load combinations', () => {
    const patch = buildFrameDraftPatch(
      {
        engineeringDraft: {
          structureType: 'steel-frame',
          geometry: {
            storyHeightsM: [3.6, 3.6],
            bayWidthsM: [5.4, 6],
          },
          loads: [
            {
              kind: 'line',
              magnitude: 10,
              unit: 'kN/m',
              direction: 'gravity',
              caseId: 'D',
              caseType: 'dead',
            },
            {
              kind: 'line',
              magnitude: 8,
              unit: 'kN/m',
              direction: 'gravity',
              caseId: 'L',
              caseType: 'live',
            },
          ],
          analysis: {
            type: 'static',
            loadCombinations: [{ id: 'ULS', factors: { D: 1.2, L: 1.4 } }],
          },
        },
      },
      undefined,
    );
    const model = buildFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameBaseSupportType: 'fixed',
      ...patch,
    });

    expect(model.load_cases.map((loadCase) => loadCase.id)).toEqual(['D', 'L']);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D')).toMatchObject({
      type: 'dead',
      loads: [
        { element: 'B7', wz: -10 },
        { element: 'B8', wz: -10 },
        { element: 'B9', wz: -10 },
        { element: 'B10', wz: -10 },
      ],
    });
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L')).toMatchObject({
      type: 'live',
      loads: [
        { element: 'B7', wz: -8 },
        { element: 'B8', wz: -8 },
        { element: 'B9', wz: -8 },
        { element: 'B10', wz: -8 },
      ],
    });
    expect(model.load_combinations).toEqual([
      { id: 'ULS', factors: { D: 1.2, L: 1.4 } },
    ]);
  });

  test('targets Chinese top-story frame line loads to top story beams', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '2d',
      storyCount: 3,
      bayCount: 2,
      storyHeightsM: [3.3, 3.3, 3.3],
      bayWidthsM: [5.4, 6],
      engineeringDraft: {
        structureType: 'steel-frame',
        loads: [
          { kind: 'line', magnitude: 12, unit: 'kN/m', direction: 'gravity', target: '顶层梁' },
        ],
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    const lineCase = model.load_cases.find((loadCase) => loadCase.id === 'LINE');
    expect(lineCase).toBeDefined();
    expect(lineCase.loads).toHaveLength(2);
    expect(lineCase.loads.map((load) => load.story)).toEqual(['F3', 'F3']);
    expect(lineCase.loads.map((load) => load.element)).toEqual(['B14', 'B15']);
  });

  test('applies story-and-span line loads once to each requested 2d beam', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '2d',
      storyCount: 3,
      bayCount: 2,
      storyHeightsM: [3.6, 3.6, 3.6],
      bayWidthsM: [6, 6],
      engineeringDraft: {
        structureType: 'steel-frame',
        loads: [
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', location: { story: 1, spanIndex: 1 } },
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', location: { story: 1, spanIndex: 2 } },
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', location: { story: 2, spanIndex: 1 } },
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', location: { story: 2, spanIndex: 2 } },
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', location: { story: 3, spanIndex: 1 } },
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', location: { story: 3, spanIndex: 2 } },
        ],
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    const lineCase = model.load_cases.find((loadCase) => loadCase.id === 'LINE');
    expect(lineCase.loads).toHaveLength(6);
    expect(lineCase.loads.map((load) => load.element)).toEqual([
      'B10', 'B11', 'B12', 'B13', 'B14', 'B15',
    ]);
  });

  test('prefers structured story locations over textual load targets and array order', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '2d',
      storyCount: 3,
      bayCount: 1,
      storyHeightsM: [3.3, 3.3, 3.3],
      bayWidthsM: [6],
      engineeringDraft: {
        structureType: 'steel-frame',
        loads: [
          { kind: 'line', magnitude: 8, unit: 'kN/m', direction: 'gravity', target: 'top-story beam', location: { story: 1 } },
          { kind: 'line', magnitude: 12, unit: 'kN/m', direction: 'gravity', location: { story: 3 } },
        ],
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    const lineCase = model.load_cases.find((loadCase) => loadCase.id === 'LINE');
    expect(lineCase.loads).toEqual([
      expect.objectContaining({ element: 'B7', story: 'F1', wz: -8 }),
      expect.objectContaining({ element: 'B9', story: 'F3', wz: -12 }),
    ]);
  });

  test('preserves explicit 3d topology when derived bay widths conflict', () => {
    const topology = {
      nodes: [
        { id: 'N000', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: 'N010', x: 0, y: 5, z: 0, restraints: [true, true, true, true, true, true] },
        { id: 'N100', x: 6, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: 'N110', x: 6, y: 5, z: 0, restraints: [true, true, true, true, true, true] },
        { id: 'N001', x: 0, y: 0, z: 3.6 },
        { id: 'N011', x: 0, y: 5, z: 3.6 },
        { id: 'N101', x: 6, y: 0, z: 3.6 },
        { id: 'N111', x: 6, y: 5, z: 3.6 },
      ],
      members: [
        { id: 'C1', nodes: ['N000', 'N001'] },
        { id: 'C2', nodes: ['N010', 'N011'] },
        { id: 'C3', nodes: ['N100', 'N101'] },
        { id: 'C4', nodes: ['N110', 'N111'] },
        { id: 'BX1', nodes: ['N001', 'N101'] },
        { id: 'BX2', nodes: ['N011', 'N111'] },
        { id: 'BY1', nodes: ['N001', 'N011'] },
        { id: 'BY2', nodes: ['N101', 'N111'] },
      ],
    };
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '3d',
      storyCount: 1,
      bayCountX: 2,
      bayCountY: 1,
      storyHeightsM: [3.6],
      bayWidthsXM: [6, 6],
      bayWidthsYM: [5],
      floorLoads: [{ story: 1, verticalKN: 300 }],
      frameMaterial: 'Q345',
      frameColumnSection: 'HW300X300',
      frameBeamSection: 'HN400X200',
      frameBaseSupportType: 'fixed',
      engineeringDraft: {
        structureType: 'steel-frame',
        topology,
        loads: [
          { kind: 'area', magnitude: 10, unit: 'kN/m2', direction: 'gravity', location: { story: 1 } },
        ],
      },
      updatedAt: 0,
    });

    expect(model.nodes).toHaveLength(8);
    expect(model.elements).toHaveLength(8);
    expect(model.nodes.map((node) => node.id)).toEqual(topology.nodes.map((node) => node.id));
    expect(model.elements.map((element) => element.id)).toEqual(topology.members.map((member) => member.id));
    expect(model.stories).toEqual([
      expect.objectContaining({ id: 'F1', height: 3.6, elevation: 0, dead_load: 10 }),
    ]);
    expect(model.metadata).toEqual(expect.objectContaining({
      topologySource: 'engineering-draft',
      bayCountX: 1,
      bayCountY: 1,
      geometry: {
        storyHeightsM: [3.6],
        bayWidthsXM: [6],
        bayWidthsYM: [5],
      },
    }));
  });

  test('canonicalizes active-plane fixed restraints in explicit 2d frame topology', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '2d',
      storyCount: 1,
      bayCount: 1,
      storyHeightsM: [3.6],
      bayWidthsM: [6],
      frameBaseSupportType: 'fixed',
      engineeringDraft: {
        structureType: 'steel-frame',
        topology: {
          nodes: [
            { id: 'B0', x: 0, y: 0, z: 0, restraints: [true, false, true, false, true, false] },
            { id: 'B1', x: 6, y: 0, z: 0, restraints: [true, false, true, false, true, false] },
            { id: 'T0', x: 0, y: 0, z: 3.6, restraints: [false, false, false, false, false, false] },
            { id: 'T1', x: 6, y: 0, z: 3.6, restraints: [false, false, false, false, false, false] },
          ],
          members: [
            { id: 'C1', nodes: ['B0', 'T0'] },
            { id: 'C2', nodes: ['B1', 'T1'] },
            { id: 'B1', nodes: ['T0', 'T1'] },
          ],
        },
        loads: [
          { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', location: { story: 1 } },
        ],
      },
      updatedAt: 0,
    });

    expect(model.nodes.find((node) => node.id === 'B0').restraints).toEqual(
      [true, true, true, true, true, true],
    );
    expect(model.nodes.find((node) => node.id === 'B1').restraints).toEqual(
      [true, true, true, true, true, true],
    );
    expect(model.nodes.find((node) => node.id === 'T0').restraints).toEqual(
      [false, false, false, false, false, false],
    );
  });

  test('applies explicitly located 2d frame nodal loads only to their requested joints', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '2d',
      storyCount: 3,
      bayCount: 2,
      storyHeightsM: [3.6, 3.6, 3.6],
      bayWidthsM: [6, 6],
      engineeringDraft: {
        structureType: 'steel-frame',
        loads: [
          { kind: 'nodal', magnitude: 10, unit: 'kN', direction: 'globalX', location: { story: 1, nodeRole: 'right-side' } },
          { kind: 'nodal', magnitude: 15, unit: 'kN', direction: 'globalX', location: { story: 2, nodeRole: 'right-side' } },
          { kind: 'nodal', magnitude: 20, unit: 'kN', direction: 'globalX', location: { story: 3, nodeRole: 'right-side' } },
        ],
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    const lateralCase = model.load_cases.find((loadCase) => loadCase.id === 'LAT');
    expect(lateralCase).toBeDefined();
    expect(lateralCase.loads).toEqual([
      { type: 'nodal', node: 'N1_2', story: 'F1', fx: 10, source: 'engineering_draft_nodal_loads', reference_frame: 'global' },
      { type: 'nodal', node: 'N2_2', story: 'F2', fx: 15, source: 'engineering_draft_nodal_loads', reference_frame: 'global' },
      { type: 'nodal', node: 'N3_2', story: 'F3', fx: 20, source: 'engineering_draft_nodal_loads', reference_frame: 'global' },
    ]);
  });

  test('maps explicitly located point loads to the top-right frame joint', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '2d',
      storyCount: 1,
      bayCount: 1,
      storyHeightsM: [12],
      bayWidthsM: [24],
      engineeringDraft: {
        structureType: 'steel-frame',
        loads: [
          { kind: 'line', magnitude: 36, unit: 'kN/m', direction: 'gravity', target: 'roof-beam' },
          { kind: 'point', magnitude: 98, unit: 'kN', direction: 'gravity', location: { story: 1, nodeRole: 'right-side' } },
          { kind: 'point', magnitude: 10, unit: 'kN', direction: 'globalX', location: { story: 1, nodeRole: 'right-side' } },
        ],
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    const nodalCase = model.load_cases.find((loadCase) => loadCase.id === 'LAT');
    expect(nodalCase).toBeDefined();
    expect(nodalCase.loads).toEqual([
      { type: 'nodal', node: 'N1_1', story: 'F1', fz: -98, source: 'engineering_draft_nodal_loads', reference_frame: 'global' },
      { type: 'nodal', node: 'N1_1', story: 'F1', fx: 10, source: 'engineering_draft_nodal_loads', reference_frame: 'global' },
    ]);
  });

  test('preserves named load cases for explicitly located frame nodal loads', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '2d',
      storyCount: 1,
      bayCount: 1,
      storyHeightsM: [12],
      bayWidthsM: [24],
      engineeringDraft: {
        structureType: 'steel-frame',
        loads: [
          {
            kind: 'line',
            magnitude: 36,
            unit: 'kN/m',
            direction: 'gravity',
            target: 'roof-beam',
            caseId: 'D',
            caseType: 'dead',
          },
          {
            kind: 'point',
            magnitude: 98,
            unit: 'kN',
            direction: 'gravity',
            location: { story: 1, nodeRole: 'right-side' },
            caseId: 'D',
            caseType: 'dead',
          },
          {
            kind: 'point',
            magnitude: 10,
            unit: 'kN',
            direction: 'globalX',
            location: { story: 1, nodeRole: 'right-side' },
            caseId: 'D',
            caseType: 'dead',
          },
        ],
        analysis: {
          loadCombinations: [{ id: 'ULS', factors: { D: 1 } }],
        },
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    expect(model.load_cases.map((loadCase) => loadCase.id)).toEqual(['D']);
    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: 'B3', story: 'F1', wz: -36, source: 'engineering_draft_line_loads', reference_frame: 'global' },
      { type: 'nodal', node: 'N1_1', story: 'F1', fz: -98, source: 'engineering_draft_nodal_loads', reference_frame: 'global' },
      { type: 'nodal', node: 'N1_1', story: 'F1', fx: 10, source: 'engineering_draft_nodal_loads', reference_frame: 'global' },
    ]);
    expect(model.load_combinations).toEqual([{ id: 'ULS', factors: { D: 1 } }]);
  });

  test('does not treat member-end top wording as a top-story frame line target', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '2d',
      storyCount: 3,
      bayCount: 2,
      storyHeightsM: [3.3, 3.3, 3.3],
      bayWidthsM: [5.4, 6],
      engineeringDraft: {
        structureType: 'steel-frame',
        loads: [
          { kind: 'line', magnitude: 12, unit: 'kN/m', direction: 'gravity', target: '柱顶梁' },
        ],
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    const lineCase = model.load_cases.find((loadCase) => loadCase.id === 'LINE');
    expect(lineCase).toBeDefined();
    expect(lineCase.loads).toHaveLength(6);
    expect(lineCase.loads.map((load) => load.story)).toEqual(['F1', 'F1', 'F2', 'F2', 'F3', 'F3']);
  });

  test('targets explicit-topology line loads to their named beam elements', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '2d',
      storyCount: 2,
      bayCount: 1,
      storyHeightsM: [3.6, 3.6],
      bayWidthsM: [6],
      frameMaterial: 'Q345',
      frameColumnSection: 'HW350X350',
      frameBeamSection: 'HN500X200',
      engineeringDraft: {
        structureType: 'steel-frame',
        topology: {
          nodes: [
            { id: 'N1', x: 0, y: 0, z: 0 },
            { id: 'N2', x: 6, y: 0, z: 0 },
            { id: 'N3', x: 0, y: 0, z: 3.6 },
            { id: 'N4', x: 6, y: 0, z: 3.6 },
            { id: 'N5', x: 0, y: 0, z: 7.2 },
            { id: 'N6', x: 6, y: 0, z: 7.2 },
          ],
          members: [
            { id: 'N1-N3', nodes: ['N1', 'N3'] },
            { id: 'N2-N4', nodes: ['N2', 'N4'] },
            { id: 'N3-N5', nodes: ['N3', 'N5'] },
            { id: 'N4-N6', nodes: ['N4', 'N6'] },
            { id: 'N3-N4', nodes: ['N3', 'N4'] },
            { id: 'N5-N6', nodes: ['N5', 'N6'] },
          ],
        },
        loads: [
          { kind: 'line', magnitude: 60, unit: 'kN/m', direction: 'gravity', target: 'N3-N4', caseId: 'D', caseType: 'dead' },
          { kind: 'line', magnitude: 60, unit: 'kN/m', direction: 'gravity', target: 'N5-N6', caseId: 'D', caseType: 'dead' },
        ],
        analysis: {
          loadCombinations: [{ id: 'ULS', factors: { D: 1 } }],
        },
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    expect(model.load_cases[0].loads).toEqual([
      { type: 'distributed', element: 'N3-N4', story: 'F1', wz: -60, source: 'engineering_draft_line_loads', reference_frame: 'global' },
      { type: 'distributed', element: 'N5-N6', story: 'F2', wz: -60, source: 'engineering_draft_line_loads', reference_frame: 'global' },
    ]);
  });

  test('targets Chinese x-axis frame line loads to x-direction beams in 3d', () => {
    const model = buildFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'steel-frame',
      frameDimension: '3d',
      storyCount: 2,
      bayCountX: 1,
      bayCountY: 1,
      storyHeightsM: [3.3, 3.3],
      bayWidthsXM: [6],
      bayWidthsYM: [5],
      engineeringDraft: {
        structureType: 'steel-frame',
        loads: [
          { kind: 'line', magnitude: 8, unit: 'kN/m', direction: 'gravity', target: 'X轴梁' },
        ],
      },
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    const lineCase = model.load_cases.find((loadCase) => loadCase.id === 'LINE');
    expect(lineCase).toBeDefined();
    expect(lineCase.loads).toHaveLength(4);
    expect(lineCase.loads.map((load) => load.element)).toEqual(['BX9', 'BX10', 'BX11', 'BX12']);
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
