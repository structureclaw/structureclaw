import { describe, expect, test } from '@jest/globals';
import {
  FIXED_RESTRAINT,
  PINNED_RESTRAINT,
  ROLLER_X_RESTRAINT,
  withCanonicalCoordinateContract,
} from '../dist/agent-runtime/coordinate-semantics.js';

describe('canonical coordinate semantics', () => {
  test('defines physically consistent global support restraints', () => {
    expect(FIXED_RESTRAINT).toEqual([true, true, true, true, true, true]);
    expect(PINNED_RESTRAINT).toEqual([true, true, true, false, false, false]);
    expect(ROLLER_X_RESTRAINT).toEqual([false, true, true, false, false, false]);
  });

  test('stamps an explicit 2D X-Z contract and global load frames immutably', () => {
    const source = {
      metadata: { source: 'test' },
      nodes: [{ id: 'N1', x: 0, y: 0, z: 0 }],
      load_cases: [{ id: 'LC1', loads: [{ node: 'N1', fz: -10 }] }],
    };
    const result = withCanonicalCoordinateContract(source, '2d');

    expect(result.coordinate_system).toEqual({
      semantics: 'global-z-up',
      version: 1,
      dimension: '2d',
      plane: 'xz',
      dof_order: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
    });
    expect(result.load_cases[0].loads[0]).toMatchObject({ reference_frame: 'global' });
    expect(result.metadata).toMatchObject({
      coordinateSemantics: 'global-z-up',
      coordinateContractVersion: 1,
      frameDimension: '2d',
    });
    expect(source).toEqual({
      metadata: { source: 'test' },
      nodes: [{ id: 'N1', x: 0, y: 0, z: 0 }],
      load_cases: [{ id: 'LC1', loads: [{ node: 'N1', fz: -10 }] }],
    });
  });

  test('preserves explicitly local member loads', () => {
    const result = withCanonicalCoordinateContract({
      nodes: [
        { id: 'N1', x: 0, y: 0, z: 0 },
        { id: 'N2', x: 1, y: 1, z: 1 },
      ],
      elements: [{ id: 'E1', nodes: ['N1', 'N2'] }],
      load_cases: [{
        id: 'LC1',
        loads: [{ type: 'distributed', element: 'E1', wy: -5, reference_frame: 'element-local' }],
      }],
    }, '3d');
    expect(result.coordinate_system.plane).toBeNull();
    expect(result.load_cases[0].loads[0].reference_frame).toBe('element-local');
  });

  test('rejects target-dependent nodal and member component aliases in V2', () => {
    const base = {
      nodes: [
        { id: 'N1', x: 0, y: 0, z: 0 },
        { id: 'N2', x: 5, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['N1', 'N2'] }],
    };
    expect(() => withCanonicalCoordinateContract({
      ...base,
      load_cases: [{ id: 'L1', loads: [{ node: 'N2', wz: -5 }] }],
    }, '2d')).toThrow('Nodal loads must use');
    expect(() => withCanonicalCoordinateContract({
      ...base,
      load_cases: [{ id: 'L1', loads: [{ element: 'E1', fz: -5 }] }],
    }, '2d')).toThrow('Member loads must use');
  });

  test('requires exactly one unambiguous load target', () => {
    const base = {
      nodes: [
        { id: 'N1', x: 0, y: 0, z: 0 },
        { id: 'N2', x: 5, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['N1', 'N2'] }],
    };
    expect(() => withCanonicalCoordinateContract({
      ...base,
      load_cases: [{ id: 'L1', loads: [{ fz: -5 }] }],
    }, '2d')).toThrow('exactly one node or element');
    expect(() => withCanonicalCoordinateContract({
      ...base,
      load_cases: [{ id: 'L1', loads: [{ node: 'N2', element: 'E1', fz: -5 }] }],
    }, '2d')).toThrow('exactly one node or element');
    expect(() => withCanonicalCoordinateContract({
      ...base,
      load_cases: [{ id: 'L1', loads: [{ node: 'N1', nodeId: 'N2', fz: -5 }] }],
    }, '2d')).toThrow('conflicting aliases');
  });

  test('rejects non-numeric load components instead of coercing them to zero', () => {
    expect(() => withCanonicalCoordinateContract({
      nodes: [{ id: 'N1', x: 0, y: 0, z: 0 }],
      load_cases: [{ id: 'L1', loads: [{ node: 'N1', fz: '   ' }] }],
    }, '2d')).toThrow("Load component 'fz' must be a finite number");
  });

  test('rejects custom local-axis reference vectors for canonical 2D models', () => {
    expect(() => withCanonicalCoordinateContract({
      metadata: { elementReferenceVectors: { E1: [0, 0, 1] } },
      nodes: [
        { id: 'N1', x: 0, y: 0, z: 0 },
        { id: 'N2', x: 5, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['N1', 'N2'] }],
    }, '2d')).toThrow('Canonical 2-D local axes are fixed');
  });
});
