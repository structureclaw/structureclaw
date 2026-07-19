import { describe, expect, test } from '@jest/globals';
import {
  extractUtilizationByElementFromAnalysis,
  extractUnitSystem,
  extractCoordinateSystem,
  buildPostprocessedResultArtifact,
} from '../../../../dist/agent-skills/result-postprocess/entry.js';

describe('result-postprocess entry', () => {
  test('extractUtilizationByElementFromAnalysis extracts from data.utilizationByElement', () => {
    const analysis = { data: { utilizationByElement: { E1: 0.92, E2: 0.85 } } };
    expect(extractUtilizationByElementFromAnalysis(analysis)).toEqual({ E1: 0.92, E2: 0.85 });
  });

  test('extractUtilizationByElementFromAnalysis returns {} for missing data', () => {
    expect(extractUtilizationByElementFromAnalysis(null)).toEqual({});
    expect(extractUtilizationByElementFromAnalysis({})).toEqual({});
  });

  test('extractUnitSystem returns unit system from metadata', () => {
    expect(extractUnitSystem({ metadata: { unitSystem: 'SI' } })).toBe('SI');
    expect(extractUnitSystem({})).toBe('SI');
  });

  test('extractCoordinateSystem requires the complete canonical result contract', () => {
    const meta = {
      coordinateSemantics: 'global-z-up',
      coordinateContractVersion: 1,
      dimension: '2d',
      plane: 'xz',
      dofOrder: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
      activeDofs: ['ux', 'uz', 'ry'],
      nodalResultFrame: 'global',
      elementForceFrame: 'element-local',
    };
    expect(extractCoordinateSystem({ meta, data: { meta } })).toBe('global-z-up');
    expect(extractCoordinateSystem({ metadata: { coordinateSystem: 'global-y-up' } })).toBeUndefined();
    expect(extractCoordinateSystem({})).toBeUndefined();
    expect(extractCoordinateSystem({ meta, data: { meta: { ...meta, plane: 'xy' } } })).toBeUndefined();
  });

  test('buildPostprocessedResultArtifact produces complete artifact', () => {
    const analysis = {
      data: { utilizationByElement: { E1: 0.9 }, envelope: { maxAbsDisplacement: 12.5 } },
      metadata: { unitSystem: 'SI' },
      meta: {
        coordinateSemantics: 'global-z-up',
        coordinateContractVersion: 1,
        dimension: '3d',
        plane: null,
        dofOrder: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
        activeDofs: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
        nodalResultFrame: 'global',
        elementForceFrame: 'element-local',
      },
    };
    const ref = { artifactId: 'ar-1', revision: 1 };
    const artifact = buildPostprocessedResultArtifact(analysis, ref);

    expect(artifact.utilizationByElement).toEqual({ E1: 0.9 });
    expect(artifact.unitSystem).toBe('SI');
    expect(artifact.coordinateSystem).toBe('global-z-up');
    expect(artifact.analysisRawRef).toEqual(ref);
    expect(artifact.clauseTraceability).toEqual([]);
  });
});
