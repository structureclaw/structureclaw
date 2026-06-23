import { describe, expect, test } from '@jest/globals';
import { canonicalizeConcreteFramePatch } from '../../../../../dist/agent-skills/structure-type/concrete-frame/canonicalize.js';
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
      existingState: { inferredType: 'concrete-frame', updatedAt: 0 },
      supplementalPatch: {
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
      existingState: { inferredType: 'concrete-frame', updatedAt: 0 },
      supplementalPatch: {
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
      existingState: {
        inferredType: 'concrete-frame',
        frameDimension: '3d',
        floorLoads: [
          { story: 1, verticalKN: 90, lateralXKN: 18 },
          { story: 2, verticalKN: 90, lateralXKN: 18 },
        ],
        updatedAt: 0,
      },
      supplementalPatch: {
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

  test('normalizes structured 3d concrete-frame geometry', () => {
    const patch = buildConcreteFrameDraftPatch({
      inferredType: 'concrete-frame',
      frameDimension: '3d',
      storyCount: 2,
      storyHeightsM: [3.6, 3.6],
      bayCountX: 2,
      bayWidthsXM: [6, 6],
      bayCountY: 1,
      bayWidthsYM: [6],
      frameColumnSection: '600x600',
      frameBeamSection: '500x250',
    }, undefined);

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

  test('normalizes repeated story and bay scalars into canonical arrays', () => {
    const patch = buildConcreteFrameDraftPatch(
      {
        inferredType: 'concrete-frame',
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
    const patch = buildConcreteFrameDraftPatch(
      {
        inferredType: 'concrete-frame',
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
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads).toHaveLength(4);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-200);
    expect(model.load_combinations[0]).toMatchObject({
      id: 'ULS',
      combination_type: 'uls',
      code_reference: 'GB50010',
      factors: { D: 1 },
    });
  });

  test('normalizes duplicate concrete same-story floor loads without dropping signed gravity loads', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'concrete-frame',
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
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '400X400',
      frameBeamSection: '250X600',
    });

    expect(model).toBeDefined();
    expect(model.floorLoads).toEqual([
      { story: 1, verticalKN: -120, liveLoadKN: 30 },
    ]);
    expect(model.stories[0]).toMatchObject({ dead_load: 20, live_load: 5 });
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads).toHaveLength(2);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-120);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads).toHaveLength(2);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-30);
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
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads).toHaveLength(12);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'D').loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-720);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads).toHaveLength(12);
    expect(model.load_cases.find((loadCase) => loadCase.id === 'L').loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(-240);
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
      {
        engineeringDraft: {
          structureType: 'concrete-frame',
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

  test('repairs llm floor loads that omit story numbers', () => {
    const patch = buildConcreteFrameDraftPatch(
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

  test('extracts PKPM-oriented RC frame design conditions from detailed chinese request', () => {
    const patch = buildConcreteFrameDraftPatch({
      inferredType: 'concrete-frame',
      frameDimension: '3d',
      storyCount: 2,
      storyHeightsM: [4.5, 3.8],
      bayCountX: 5,
      bayWidthsXM: [8, 8, 8, 8, 8],
      bayCountY: 3,
      bayWidthsYM: [6, 3, 6],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      floorLoads: [
        { story: 1, verticalKN: 1080, liveLoadKN: 2100 },
        { story: 2, verticalKN: 2100, liveLoadKN: 300 },
      ],
      siteSeismic: {
        intensity: 7,
        accelerationG: 0.1,
        designGroup: '第三组',
        siteCategory: '3类',
      },
      wind: {
        basicPressureKNM2: 0.4,
        terrainRoughness: 'B类',
      },
      analysisControl: {
        pDelta: false,
        rigidFloor: true,
        considerationTorsion: true,
      },
    }, undefined);

    expect(patch).toMatchObject({
      inferredType: 'frame',
      frameDimension: '3d',
      storyCount: 2,
      storyHeightsM: [4.5, 3.8],
      bayCountX: 5,
      bayWidthsXM: [8, 8, 8, 8, 8],
      bayCountY: 3,
      bayWidthsYM: [6, 3, 6],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      siteSeismic: {
        intensity: 7,
        accelerationG: 0.1,
        designGroup: '第三组',
        siteCategory: 'III',
      },
      wind: {
        basicPressureKNM2: 0.4,
        terrainRoughness: 'B',
      },
    });
    expect(patch.floorLoads).toEqual([
      { story: 1, verticalKN: 1080, liveLoadKN: 2100 },
      { story: 2, verticalKN: 2100, liveLoadKN: 300 },
    ]);

    const model = buildConcreteFrameModel({
      inferredType: 'frame',
      structuralTypeKey: 'concrete-frame',
      skillId: 'concrete-frame',
      updatedAt: 0,
      ...patch,
    });

    expect(model).toBeDefined();
    expect(model.site_seismic).toMatchObject({
      intensity: 7,
      design_group: '第三组',
      site_category: 'III',
      characteristic_period: 0.65,
      max_influence_coefficient: 0.08,
      damping_ratio: 0.05,
      extra: { acceleration_g: 0.1 },
    });
    expect(model.wind).toMatchObject({
      basic_pressure: 0.4,
      terrain_roughness: 'B',
    });
    expect(model.analysis_control).toMatchObject({
      p_delta: false,
      rigid_floor: true,
      consideration_torsion: true,
    });
    expect(model.stories).toEqual([
      expect.objectContaining({
        id: 'F1',
        dead_load: 1.8,
        live_load: 3.5,
      }),
      expect.objectContaining({
        id: 'F2',
        dead_load: 3.5,
        live_load: 0.5,
      }),
    ]);
    expect(model.load_cases.map((loadCase) => loadCase.id)).toEqual(['D', 'L', 'WX', 'WY', 'EX', 'EY']);
    expect(model.extensions.pkpm).toMatchObject({
      materialSystem: 'reinforced-concrete',
      site_seismic: expect.objectContaining({ site_category: 'III' }),
      wind: expect.objectContaining({ terrain_roughness: 'B' }),
    });
  });

  test('keeps 2d concrete frame line intensity as beam distributed loads', () => {
    const patch = buildConcreteFrameDraftPatch(
      {
        engineeringDraft: {
          structureType: 'concrete-frame',
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

    const model = buildConcreteFrameModel({
      inferredType: 'concrete-frame',
      structuralTypeKey: 'concrete-frame',
      frameDimension: '2d',
      storyCount: 3,
      bayCount: 2,
      storyHeightsM: [3.3, 3.3, 3.3],
      bayWidthsM: [5.4, 6],
      engineeringDraft: {
        structureType: 'concrete-frame',
        loads: [
          { kind: 'line', magnitude: 15, unit: 'kN/m', direction: 'gravity' },
        ],
      },
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
      frameColumnSection: '500X500',
      frameBeamSection: '300X600',
      frameBaseSupportType: 'fixed',
      updatedAt: 0,
    });

    expect(model).toBeDefined();
    const lineCase = model.load_cases.find((loadCase) => loadCase.id === 'LINE');
    expect(lineCase).toBeDefined();
    expect(lineCase.loads).toHaveLength(6);
    expect(lineCase.loads.every((load) => load.type === 'distributed')).toBe(true);
    expect(lineCase.loads.every((load) => load.wz === -15)).toBe(true);
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
    }, undefined);

    expect(patch.frameDimension).toBeUndefined();
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

  test('does not treat architectural arch text as rc concrete evidence', () => {
    const result = detectConcreteFrameStructuralType({
      message: 'Use this architectural DXF of a steel frame building from arch-frame-simple-1s1b.dxf.',
      locale: 'en',
    });
    expect(result).toBeNull();
  });

  test('does not route explicit steel frame descriptions to concrete-frame', () => {
    const result = detectConcreteFrameStructuralType({
      message: '请根据建筑平面图DXF建立单层单跨钢框架结构计算模型并进行分析',
      locale: 'zh',
    });
    expect(result).toBeNull();
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
// Model returns mesh model with metadata; code-check fields in metadata
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
    expect(model?.metadata.concreteGrade).toBe('C30');
    expect(model?.metadata.rebarGrade).toBe('HRB400');
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
    expect(model?.metadata.concreteGrade).toBe('C30');
    expect(model?.metadata.rebarGrade).toBe('HRB400');
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
    expect(model?.metadata.columnSection).toBe('500X500');
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
    expect(model?.metadata.beamSection).toBe('300X600');
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

// ============================================================================
// design-conditions.ts 单元测试
// ============================================================================
import {
  seismicDesignGroupIndex,
  normalizeSeismicDesignGroup,
  normalizeSeismicSiteCategory,
  normalizeWindTerrainRoughness,
} from '../../../../../dist/agent-skills/structure-type/concrete-frame/design-conditions.js';

describe('design-conditions edge cases', () => {
  describe('seismicDesignGroupIndex', () => {
    test('returns 1 for first group (Arabic + Chinese)', () => {
      expect(seismicDesignGroupIndex('1')).toBe(1);
      expect(seismicDesignGroupIndex('一')).toBe(1);
      expect(seismicDesignGroupIndex('第一组')).toBe(1);
    });
    test('returns 2 for second group', () => {
      expect(seismicDesignGroupIndex('2')).toBe(2);
      expect(seismicDesignGroupIndex('二')).toBe(2);
      expect(seismicDesignGroupIndex('两')).toBe(2);
    });
    test('returns 3 for third group', () => {
      expect(seismicDesignGroupIndex('3')).toBe(3);
      expect(seismicDesignGroupIndex('三')).toBe(3);
    });
    test('returns undefined for invalid input', () => {
      expect(seismicDesignGroupIndex(undefined)).toBeUndefined();
      expect(seismicDesignGroupIndex(null)).toBeUndefined();
      expect(seismicDesignGroupIndex('')).toBeUndefined();
      expect(seismicDesignGroupIndex(5)).toBeUndefined();
    });
  });

  describe('normalizeSeismicDesignGroup', () => {
    test('normalizes to Chinese group names', () => {
      expect(normalizeSeismicDesignGroup('1')).toBe('第一组');
      expect(normalizeSeismicDesignGroup('一')).toBe('第一组');
      expect(normalizeSeismicDesignGroup('第二组')).toBe('第二组');
    });
    test('returns undefined for invalid', () => {
      expect(normalizeSeismicDesignGroup('四')).toBeUndefined();
      expect(normalizeSeismicDesignGroup(undefined)).toBeUndefined();
    });
  });

  describe('normalizeSeismicSiteCategory', () => {
    test('normalizes Arabic + Chinese to Roman numerals', () => {
      expect(normalizeSeismicSiteCategory('1')).toBe('I');
      expect(normalizeSeismicSiteCategory('2')).toBe('II');
      expect(normalizeSeismicSiteCategory('3')).toBe('III');
      expect(normalizeSeismicSiteCategory('4')).toBe('IV');
      expect(normalizeSeismicSiteCategory('一')).toBe('I');
      expect(normalizeSeismicSiteCategory('二')).toBe('II');
      expect(normalizeSeismicSiteCategory('三')).toBe('III');
      expect(normalizeSeismicSiteCategory('四')).toBe('IV');
      expect(normalizeSeismicSiteCategory('3类')).toBe('III');
      expect(normalizeSeismicSiteCategory('II')).toBe('II');
    });
    test('returns undefined for invalid', () => {
      expect(normalizeSeismicSiteCategory('5')).toBeUndefined();
      expect(normalizeSeismicSiteCategory('五')).toBeUndefined();
      expect(normalizeSeismicSiteCategory(undefined)).toBeUndefined();
    });
  });

  describe('normalizeWindTerrainRoughness', () => {
    test('normalizes A/B/C/D classes', () => {
      expect(normalizeWindTerrainRoughness('A')).toBe('A');
      expect(normalizeWindTerrainRoughness('B')).toBe('B');
      expect(normalizeWindTerrainRoughness('b')).toBe('B');
      expect(normalizeWindTerrainRoughness('c')).toBe('C');
      expect(normalizeWindTerrainRoughness('A类')).toBe('A');
      expect(normalizeWindTerrainRoughness('B类')).toBe('B');
    });
    test('returns undefined for invalid', () => {
      expect(normalizeWindTerrainRoughness('E')).toBeUndefined();
      expect(normalizeWindTerrainRoughness(undefined)).toBeUndefined();
      expect(normalizeWindTerrainRoughness(123)).toBeUndefined();
    });
  });
});

// ============================================================================
// buildConcreteFrameModel 3D 错误路径测试
// ============================================================================
describe('buildConcreteFrameModel 3D error paths', () => {
  test('returns undefined for 3D model with mismatched bayWidthsXM array length', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '3d',
      storyCount: 2,
      bayCountX: 3,
      bayCountY: 2,
      storyHeightsM: [3.6, 3.6],
      bayWidthsXM: [6, 6],  // length=2 ≠ bayCountX=3
      bayWidthsYM: [5, 5],
      floorLoads: [{ story: 1, verticalKN: 100 }, { story: 2, verticalKN: 100 }],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
    });
    expect(model).toBeUndefined();
  });

  test('returns undefined for 3D model with missing Y-direction geometry', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '3d',
      storyCount: 2,
      bayCountX: 2,
      // bayCountY missing
      storyHeightsM: [3.6, 3.6],
      bayWidthsXM: [6, 6],
      // bayWidthsYM missing
      floorLoads: [{ story: 1, verticalKN: 100 }, { story: 2, verticalKN: 100 }],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
    });
    expect(model).toBeUndefined();
  });

  test('returns undefined for 3D model with mismatched bayWidthsYM', () => {
    const model = buildConcreteFrameModel({
      inferredType: 'frame',
      updatedAt: 0,
      frameDimension: '3d',
      storyCount: 2,
      bayCountX: 2,
      bayCountY: 2,
      storyHeightsM: [3.6, 3.6],
      bayWidthsXM: [6, 6],
      bayWidthsYM: [5],  // length=1 ≠ bayCountY=2
      floorLoads: [{ story: 1, verticalKN: 100 }, { story: 2, verticalKN: 100 }],
      frameConcreteGrade: 'C30',
      frameRebarGrade: 'HRB400',
    });
    expect(model).toBeUndefined();
  });
});
