import { describe, expect, test } from '@jest/globals';
import { buildElementReferenceVectors } from '../dist/agent-runtime/reference-vectors.js';

describe('buildElementReferenceVectors', () => {
  test('assigns columns x-axis references and beams z-axis references', () => {
    const nodes = [
      { id: 'N1', x: 0, y: 0, z: 0 },
      { id: 'N2', x: 0, y: 0, z: 3 },
      { id: 'N3', x: 4, y: 0, z: 3 },
      { id: 'N4', x: 4, y: 2, z: 3 },
    ];
    const elements = [
      { id: 'C1', nodes: ['N1', 'N2'] },
      { id: 'B1', nodes: ['N2', 'N3'] },
      { id: 'B2', nodes: ['N3', 'N4'] },
    ];

    expect(buildElementReferenceVectors(elements, nodes)).toEqual({
      C1: [1, 0, 0],
      B1: [0, 0, 1],
      B2: [0, 0, 1],
    });
  });

  test('skips malformed elements and coerces numeric string coordinates', () => {
    const nodes = [
      { id: 'N1', x: '0', y: '0', z: '0' },
      { id: 'N2', x: '0', y: '0', z: '3' },
      { id: 'N3', x: 4, y: 0, z: 3 },
      { id: 'N4', x: 'bad', y: 2, z: 3 },
    ];
    const elements = [
      { id: 'C1', nodes: ['N1', 'N2'] },
      { id: 'MISSING', nodes: ['N1', 'NX'] },
      { id: 'BAD-NUM', nodes: ['N3', 'N4'] },
      { id: 'BAD-SHAPE', nodes: ['N1'] },
      { nodes: ['N1', 'N2'] },
    ];

    expect(buildElementReferenceVectors(elements, nodes)).toEqual({
      C1: [1, 0, 0],
    });
  });
});
