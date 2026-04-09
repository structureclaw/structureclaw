import { describe, expect, it } from 'vitest'
import { normalizeVisualizationSnapshot } from '@/components/visualization/normalization'
import type { VisualizationSnapshot } from '@/components/visualization/types'

/**
 * Helper to build a minimal valid VisualizationSnapshot.
 * Only the provided overrides are applied; all other fields get sensible defaults.
 */
function makeSnapshot(overrides: Partial<VisualizationSnapshot> = {}): VisualizationSnapshot {
  return {
    version: 1,
    title: 'Test',
    source: 'result',
    dimension: 2,
    plane: 'xz',
    availableViews: ['model', 'deformed'],
    defaultCaseId: 'result',
    nodes: [],
    elements: [],
    loads: [],
    unsupportedElementTypes: [],
    cases: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 3D snapshots -- nothing should be normalised
// ---------------------------------------------------------------------------
describe('normalizeVisualizationSnapshot', () => {
  describe('3D snapshots (dimension !== 2)', () => {
    it('returns the original reference unchanged for a 3D snapshot', () => {
      const snapshot = makeSnapshot({
        dimension: 3,
        plane: 'yz',
        loads: [{ nodeId: '1', vector: { x: 0, y: 5, z: 0 } }],
        cases: [{
          id: 'c1',
          label: 'Case 1',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: 1, uz: 0 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result).toBe(snapshot)
    })
  })

  // -------------------------------------------------------------------------
  // YZ plane -- early return (covers line 118)
  // -------------------------------------------------------------------------
  describe('yz plane (no normalisation path)', () => {
    it('returns the original reference when plane is yz', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'yz',
        loads: [{ nodeId: '1', vector: { x: 1, y: 2, z: 3 } }],
        cases: [{
          id: 'c1',
          label: 'C',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0.1, uy: 0.2, uz: 0.3 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result).toBe(snapshot)
    })
  })

  // -------------------------------------------------------------------------
  // XZ plane -- displacement normalisation
  // -------------------------------------------------------------------------
  describe('XZ displacement normalisation', () => {
    it('swaps uy into uz when uy is significant and uz is not (line 42-46)', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: -0.02 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].displacement).toEqual({ ux: 0, uy: 0, uz: -0.02 })
    })

    it('swaps uy into uz and also swaps rz into ry when ry is not significant and rz is defined (line 48-50)', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: -0.02, rz: 0.005 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const d = result.cases[0].nodeResults['1'].displacement!
      expect(d.uy).toBe(0)
      expect(d.uz).toBe(-0.02)
      expect(d.ry).toBe(0.005)
      expect(d.rz).toBe(0)
    })

    it('does not swap rotation when ry is already significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: -0.02, ry: 0.01, rz: 0.005 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const d = result.cases[0].nodeResults['1'].displacement!
      expect(d.uy).toBe(0)
      expect(d.uz).toBe(-0.02)
      // ry stays as-is (it was significant), rz stays as-is
      expect(d.ry).toBe(0.01)
      expect(d.rz).toBe(0.005)
    })

    it('does not swap rotation when rz is undefined', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: -0.02 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const d = result.cases[0].nodeResults['1'].displacement!
      expect(d.uz).toBe(-0.02)
      expect(d.ry).toBeUndefined()
      expect(d.rz).toBeUndefined()
    })

    it('leaves displacement unchanged when uz is already significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0.01, uy: 0, uz: -0.05 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].displacement).toEqual({ ux: 0.01, uy: 0, uz: -0.05 })
    })

    it('leaves displacement unchanged when both uy and uz are not significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0.01, uy: 0, uz: 0 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].displacement).toEqual({ ux: 0.01, uy: 0, uz: 0 })
    })
  })

  // -------------------------------------------------------------------------
  // XZ plane -- reaction normalisation
  // -------------------------------------------------------------------------
  describe('XZ reaction normalisation', () => {
    it('swaps fy into fz when fy is significant and fz is not', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fy: 10 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].reaction).toEqual({ fy: 0, fz: 10 })
    })

    it('swaps fy into fz and also swaps mz into my when my is not significant and mz is defined', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fy: 10, mz: 5 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const r = result.cases[0].nodeResults['1'].reaction!
      expect(r.fy).toBe(0)
      expect(r.fz).toBe(10)
      expect(r.my).toBe(5)
      expect(r.mz).toBe(0)
    })

    it('does not swap reaction rotation when my is already significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fy: 10, my: 3, mz: 5 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const r = result.cases[0].nodeResults['1'].reaction!
      expect(r.fy).toBe(0)
      expect(r.fz).toBe(10)
      expect(r.my).toBe(3)
      expect(r.mz).toBe(5)
    })

    it('does not swap reaction rotation when mz is undefined', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fy: 10 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const r = result.cases[0].nodeResults['1'].reaction!
      expect(r.my).toBeUndefined()
      expect(r.mz).toBeUndefined()
    })

    it('leaves reaction unchanged when fz is already significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fx: 1, fy: 0, fz: 10 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].reaction).toEqual({ fx: 1, fy: 0, fz: 10 })
    })
  })

  // -------------------------------------------------------------------------
  // XY plane -- displacement normalisation (lines 76-91)
  // -------------------------------------------------------------------------
  describe('XY displacement normalisation', () => {
    it('swaps uz into uy when uz is significant and uy is not (line 80-84)', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uz: -0.03 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const d = result.cases[0].nodeResults['1'].displacement!
      expect(d.uy).toBe(-0.03)
      expect(d.uz).toBe(0)
    })

    it('swaps uz into uy and also swaps ry into rz when rz is not significant and ry is defined (line 86-88)', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uz: -0.03, ry: 0.004 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const d = result.cases[0].nodeResults['1'].displacement!
      expect(d.uy).toBe(-0.03)
      expect(d.uz).toBe(0)
      expect(d.rz).toBe(0.004)
      expect(d.ry).toBe(0)
    })

    it('does not swap XY displacement rotation when rz is already significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uz: -0.03, ry: 0.004, rz: 0.008 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const d = result.cases[0].nodeResults['1'].displacement!
      expect(d.uy).toBe(-0.03)
      expect(d.uz).toBe(0)
      expect(d.ry).toBe(0.004)
      expect(d.rz).toBe(0.008)
    })

    it('does not swap XY displacement rotation when ry is undefined', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uz: -0.03 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const d = result.cases[0].nodeResults['1'].displacement!
      expect(d.ry).toBeUndefined()
      expect(d.rz).toBeUndefined()
    })

    it('leaves XY displacement unchanged when uy is already significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0.01, uy: 0.05, uz: 0 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].displacement).toEqual({ ux: 0.01, uy: 0.05, uz: 0 })
    })

    it('leaves XY displacement unchanged when both uy and uz are not significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0.01, uy: 0, uz: 0 } },
          },
          elementResults: {},
        }],
      })

      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })
  })

  // -------------------------------------------------------------------------
  // XY plane -- reaction normalisation (lines 94-110)
  // -------------------------------------------------------------------------
  describe('XY reaction normalisation', () => {
    it('swaps fz into fy when fz is significant and fy is not (line 99-102)', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fz: 15 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const r = result.cases[0].nodeResults['1'].reaction!
      expect(r.fy).toBe(15)
      expect(r.fz).toBe(0)
    })

    it('swaps fz into fy and also swaps my into mz when mz is not significant and my is defined (line 105-107)', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fz: 15, my: 7 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const r = result.cases[0].nodeResults['1'].reaction!
      expect(r.fy).toBe(15)
      expect(r.fz).toBe(0)
      expect(r.mz).toBe(7)
      expect(r.my).toBe(0)
    })

    it('does not swap XY reaction rotation when mz is already significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fz: 15, my: 7, mz: 3 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const r = result.cases[0].nodeResults['1'].reaction!
      expect(r.my).toBe(7)
      expect(r.mz).toBe(3)
    })

    it('does not swap XY reaction rotation when my is undefined', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fz: 15 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const r = result.cases[0].nodeResults['1'].reaction!
      expect(r.my).toBeUndefined()
      expect(r.mz).toBeUndefined()
    })

    it('leaves XY reaction unchanged when fy is already significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fx: 1, fy: 10, fz: 0 } },
          },
          elementResults: {},
        }],
      })

      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })
  })

  // -------------------------------------------------------------------------
  // Load vector normalisation
  // -------------------------------------------------------------------------
  describe('load vector normalisation', () => {
    it('normalises an XZ load from y to z', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        loads: [{ nodeId: '1', vector: { x: 0, y: -10, z: 0 }, kind: 'nodal' }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.loads[0].vector).toEqual({ x: 0, y: 0, z: -10 })
    })

    it('normalises an XY load from z to y', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        loads: [{ nodeId: '1', vector: { x: 0, y: 0, z: -8 }, kind: 'nodal' }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.loads[0].vector).toEqual({ x: 0, y: -8, z: 0 })
    })

    it('returns original reference when load vector is already correct for the plane', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        loads: [{ nodeId: '1', vector: { x: 0, y: 0, z: -5 }, kind: 'nodal' }],
      })

      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })

    it('handles multiple loads with mixed normalisation needs', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        loads: [
          { nodeId: '1', vector: { x: 0, y: -10, z: 0 }, kind: 'nodal' },
          { nodeId: '2', vector: { x: 0, y: 0, z: -5 }, kind: 'nodal' },
        ],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.loads[0].vector).toEqual({ x: 0, y: 0, z: -10 })
      expect(result.loads[1].vector).toEqual({ x: 0, y: 0, z: -5 })
    })
  })

  // -------------------------------------------------------------------------
  // Multiple cases and multiple nodes
  // -------------------------------------------------------------------------
  describe('multi-case and multi-node scenarios', () => {
    it('normalises displacement and reaction across multiple nodes in one case', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: -0.02 }, reaction: { fy: 10 } },
            '2': { displacement: { ux: 0, uy: -0.04 }, reaction: { fy: 20 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      const nr = result.cases[0].nodeResults
      expect(nr['1'].displacement).toEqual({ ux: 0, uy: 0, uz: -0.02 })
      expect(nr['1'].reaction).toEqual({ fy: 0, fz: 10 })
      expect(nr['2'].displacement).toEqual({ ux: 0, uy: 0, uz: -0.04 })
      expect(nr['2'].reaction).toEqual({ fy: 0, fz: 20 })
    })

    it('normalises across multiple cases', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [
          {
            id: 'caseA',
            label: 'A',
            kind: 'case',
            nodeResults: { '1': { displacement: { ux: 0, uy: -0.01 } } },
            elementResults: {},
          },
          {
            id: 'caseB',
            label: 'B',
            kind: 'case',
            nodeResults: { '1': { displacement: { ux: 0, uy: -0.02 } } },
            elementResults: {},
          },
        ],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].displacement!.uz).toBe(-0.01)
      expect(result.cases[1].nodeResults['1'].displacement!.uz).toBe(-0.02)
    })
  })

  // -------------------------------------------------------------------------
  // Nodes with no displacement or reaction
  // -------------------------------------------------------------------------
  describe('nodes without displacement or reaction', () => {
    it('handles nodes with undefined displacement and reaction', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': {},
          },
          elementResults: {},
        }],
      })

      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })

    it('handles nodes with displacement but no reaction', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: -0.02 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].displacement!.uz).toBe(-0.02)
      expect(result.cases[0].nodeResults['1'].reaction).toBeUndefined()
    })

    it('handles nodes with reaction but no displacement', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fy: 10 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].reaction!.fz).toBe(10)
      expect(result.cases[0].nodeResults['1'].displacement).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Boundary values: zero, near-epsilon, negative
  // -------------------------------------------------------------------------
  describe('boundary values (epsilon sensitivity)', () => {
    it('treats values below epsilon as not significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: 1e-13, uz: 1e-13 } },
          },
          elementResults: {},
        }],
      })

      // Both uy and uz are below EPSILON (1e-12), so neither is significant.
      // The condition `!isSignificant(uz) && isSignificant(uy)` fails because uy is also not significant.
      // This means no change -- returns the original snapshot.
      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })

    it('treats values at exactly epsilon as not significant (boundary)', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: 1e-12, uz: 0 } },
          },
          elementResults: {},
        }],
      })

      // 1e-12 is NOT > EPSILON (1e-12), so uy is not significant => no swap
      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })

    it('treats values just above epsilon as significant', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: 1e-11, uz: 0 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].displacement!.uz).toBe(1e-11)
      expect(result.cases[0].nodeResults['1'].displacement!.uy).toBe(0)
    })

    it('handles negative values correctly (abs value matters)', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: -0.05 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.cases[0].nodeResults['1'].displacement!.uz).toBe(-0.05)
      expect(result.cases[0].nodeResults['1'].displacement!.uy).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Combined loads + cases normalisation
  // -------------------------------------------------------------------------
  describe('combined loads and cases', () => {
    it('normalises both loads and cases together and returns a new snapshot', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        loads: [{ nodeId: '1', vector: { x: 0, y: -10, z: 0 }, kind: 'nodal' }],
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0, uy: -0.02 } },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)
      expect(result.loads[0].vector).toEqual({ x: 0, y: 0, z: -10 })
      expect(result.cases[0].nodeResults['1'].displacement!.uz).toBe(-0.02)
    })

    it('returns original reference when nothing needs normalising', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        loads: [{ nodeId: '1', vector: { x: 1, y: 0, z: 5 }, kind: 'nodal' }],
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0.01, uy: 0, uz: -0.05 } },
          },
          elementResults: {},
        }],
      })

      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })
  })

  // -------------------------------------------------------------------------
  // Empty arrays
  // -------------------------------------------------------------------------
  describe('empty loads and cases arrays', () => {
    it('returns original reference when loads and cases are empty', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        loads: [],
        cases: [],
      })

      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })
  })

  // -------------------------------------------------------------------------
  // XY plane full integration
  // -------------------------------------------------------------------------
  describe('XY plane full integration', () => {
    it('normalises loads, displacements, and reactions for XY plane', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        loads: [{ nodeId: '1', vector: { x: 0, y: 0, z: -10 }, kind: 'nodal' }],
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': {
              displacement: { ux: 0, uz: -0.03, ry: 0.004 },
              reaction: { fz: 15, my: 7 },
            },
          },
          elementResults: {},
        }],
      })

      const result = normalizeVisualizationSnapshot(snapshot)

      // Load: z -> y
      expect(result.loads[0].vector).toEqual({ x: 0, y: -10, z: 0 })

      // Displacement: uz -> uy, ry -> rz
      const d = result.cases[0].nodeResults['1'].displacement!
      expect(d.uy).toBe(-0.03)
      expect(d.uz).toBe(0)
      expect(d.rz).toBe(0.004)
      expect(d.ry).toBe(0)

      // Reaction: fz -> fy, my -> mz
      const r = result.cases[0].nodeResults['1'].reaction!
      expect(r.fy).toBe(15)
      expect(r.fz).toBe(0)
      expect(r.mz).toBe(7)
      expect(r.my).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Preserving undefined displacement fields during swap
  // -------------------------------------------------------------------------
  describe('preserving undefined fields during normalisation', () => {
    it('XZ displacement: sets uy to undefined when original uy was undefined', () => {
      // When uy is undefined, `displacement.uy === undefined ? undefined : 0` should give undefined
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0 } },
          },
          elementResults: {},
        }],
      })

      // uy is undefined (not significant), uz is undefined (not significant) => no swap
      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })

    it('XZ reaction: sets fy to undefined when original fy was undefined', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xz',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fx: 5 } },
          },
          elementResults: {},
        }],
      })

      // fy is undefined (not significant), fz is undefined (not significant) => no swap
      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })

    it('XY displacement: preserves undefined uz during swap', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { displacement: { ux: 0 } },
          },
          elementResults: {},
        }],
      })

      // uy and uz are both undefined (not significant) => no swap
      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })

    it('XY reaction: preserves undefined fz during swap', () => {
      const snapshot = makeSnapshot({
        dimension: 2,
        plane: 'xy',
        cases: [{
          id: 'result',
          label: 'Result',
          kind: 'result',
          nodeResults: {
            '1': { reaction: { fx: 5 } },
          },
          elementResults: {},
        }],
      })

      // fy and fz are both undefined (not significant) => no swap
      expect(normalizeVisualizationSnapshot(snapshot)).toBe(snapshot)
    })
  })
})
