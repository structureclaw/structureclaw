import { describe, expect, test } from '@jest/globals';
import { handler } from '../../../../../dist/agent-skills/structure-type/double-span-beam/handler.js';

describe('double-span-beam handler', () => {
  test('detects chinese double-span continuous beam requests deterministically', () => {
    const match = handler.detectStructuralType({
      message: '双跨连续梁，总长12m，两跨各6m',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('double-span-beam');
    expect(match?.mappedType).toBe('double-span-beam');
  });

  test('routes multi-span continuous beams away from plain beam handling', () => {
    const match = handler.detectStructuralType({
      message: '三跨连续梁，跨度4m、5m、4m，均布荷载15kN/m，做静力分析',
      locale: 'zh',
    });

    expect(match?.skillId).toBe('double-span-beam');
    expect(match?.mappedType).toBe('double-span-beam');
  });

  test('builds unequal continuous beam spans with structured distributed and point loads', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'double-span-beam',
          geometry: { spanLengthsM: [4, 7] },
          loads: [
            { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', target: 'beam' },
            { kind: 'point', magnitude: 30, unit: 'kN', direction: 'gravity', target: 'beam', location: { spanIndex: 2 } },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(state.skillState).toEqual(expect.objectContaining({
      spanLengthsM: [4, 7],
      distributedLoadKNM: 10,
      pointLoadKN: 30,
      pointLoadSpanIndex: 2,
    }));
    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(model.metadata.geometry.spanLengthsM).toEqual([4, 7]);
    expect(model.nodes.map((node) => node.x)).toEqual([0, 4, 7.5, 11]);
    expect(model.load_cases[0].loads).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'distributed', wz: -10 }),
      { node: '3', fz: -30, reference_frame: 'global' },
    ]));
  });

  test('accepts and builds an explicit three-span continuous beam', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'double-span-beam',
          geometry: { spanLengthsM: [4, 5, 4] },
          boundary: {
            supportPositionsM: [0, 4, 9, 13],
          },
          loads: [
            { kind: 'line', magnitude: 15, unit: 'kN/m', direction: 'gravity', target: 'beam' },
          ],
        },
      },
    });
    const state = handler.mergeState(undefined, patch);
    const model = handler.buildModel(state);

    expect(handler.computeMissing(state, 'execution').critical).toEqual([]);
    expect(model.metadata.spanCount).toBe(3);
    expect(model.metadata.geometry.spanLengthsM).toEqual([4, 5, 4]);
    expect(model.nodes.map((node) => node.x)).toEqual([0, 4, 9, 13]);
    expect(model.elements).toHaveLength(3);
    expect(model.load_cases[0].loads).toHaveLength(3);
  });

  test('preserves explicit beam support topology even if routing selects continuous beam', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [3, 3] },
          topology: {
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
              { id: 'N2', x: 3, y: 0, z: 0 },
              { id: 'N3', x: 6, y: 0, z: 0, restraints: [false, true, true, false, false, false] },
            ],
            members: [
              { id: 'E1', nodes: ['N1', 'N2'] },
              { id: 'E2', nodes: ['N2', 'N3'] },
            ],
          },
          boundary: {
            supportType: 'simply-supported',
            supportPositionsM: [0, 6],
          },
          loads: [
            { kind: 'line', magnitude: 10, unit: 'kN/m', direction: 'gravity', target: 'beam' },
            { kind: 'point', magnitude: 30, unit: 'kN', direction: 'gravity', target: 'N2' },
          ],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.nodes.map((node) => node.x)).toEqual([0, 3, 6]);
    expect(model.nodes[0].restraints).toEqual([true, true, true, false, false, false]);
    expect(model.nodes[1].restraints).toBeUndefined();
    expect(model.nodes[2].restraints).toEqual([false, true, true, false, false, false]);
    expect(model.load_cases[0].loads).toContainEqual({ node: '2', fz: -30, reference_frame: 'global' });
  });

  test('uses physical span boundaries for a fallback point-load coordinate with end supports only', () => {
    const patch = handler.extractDraft({
      message: '',
      llmDraftPatch: {
        engineeringDraft: {
          structureType: 'beam',
          geometry: { spanLengthsM: [4, 2, 6] },
          topology: {
            nodes: [
              { id: 'N1', x: 0, y: 0, z: 0, restraints: [true, true, true, false, false, false] },
              { id: 'N2', x: 4, y: 0, z: 0 },
              { id: 'N3', x: 6, y: 0, z: 0 },
              { id: 'N4', x: 12, y: 0, z: 0, restraints: [false, true, true, false, false, false] },
            ],
            members: [
              { id: 'E1', nodes: ['N1', 'N2'] },
              { id: 'E2', nodes: ['N2', 'N3'] },
              { id: 'E3', nodes: ['N3', 'N4'] },
            ],
          },
          boundary: {
            supportType: 'simply-supported',
            supportPositionsM: [0, 12],
          },
          loads: [
            { kind: 'line', magnitude: 15, unit: 'kN/m', direction: 'gravity', target: 'beam' },
            { kind: 'point', magnitude: 50, unit: 'kN', direction: 'gravity', target: 'middle-joint' },
          ],
        },
      },
    });
    const model = handler.buildModel(handler.mergeState(undefined, patch));

    expect(model.nodes.map((node) => node.x)).toEqual([0, 4, 6, 9, 12]);
    expect(model.nodes.every((node) => Number.isFinite(node.x))).toBe(true);
    expect(model.load_cases[0].loads).toContainEqual({ node: '4', fz: -50, reference_frame: 'global' });
  });
});
