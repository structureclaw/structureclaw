import { describe, it, expect } from 'vitest'
import { normalizeVisualizationSnapshot } from '@/components/visualization/normalization'
import type {
  VisualizationSnapshot,
  VisualizationCase,
  VisualizationLoad,
} from '@/components/visualization/types'

// ---------------------------------------------------------------------------
// Helpers to build minimal valid snapshots
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<VisualizationSnapshot> = {}): VisualizationSnapshot {
  return {
    version: 1,
    title: 'test',
    source: 'model',
    dimension: 2,
    plane: 'xz',
    availableViews: ['model'],
    defaultCaseId: 'case-1',
    nodes: [],
    elements: [],
    loads: [],
    unsupportedElementTypes: [],
    cases: [],
    ...overrides,
  }
}

function makeCase(
  nodeResults: Record<string, any> = {},
  overrides: Partial<VisualizationCase> = {},
): VisualizationCase {
  return {
    id: 'case-1',
    label: 'Case 1',
    kind: 'case',
    nodeResults,
    elementResults: {},
    ...overrides,
  }
}

function makeLoad(vector: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 }): VisualizationLoad {
  return {
    nodeId: 'n1',
    vector,
  }
}

// ---------------------------------------------------------------------------
// 3D snapshots — early return
// ---------------------------------------------------------------------------

describe('normalizeVisualizationSnapshot', () => {
  describe('3D snapshots (dimension !== 2)', () => {
    it('returns the same snapshot reference unchanged', () => {
      const snap = makeSnapshot({ dimension: 3 })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // 2D xz plane
  // -------------------------------------------------------------------------
  describe('2D xz plane — load vector normalization', () => {
    it('swaps y->z when vector is in xz plane (y significant, z ~0)', () => {
      const load = makeLoad({ x: 10, y: 5, z: 0 })
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [load],
        cases: [makeCase()],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).not.toBe(snap)
      expect(result.loads[0].vector).toEqual({ x: 10, y: 0, z: 5 })
    })

    it('does not change vector when z is already significant', () => {
      const load = makeLoad({ x: 10, y: 0, z: 5 })
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [load],
        cases: [makeCase()],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })

    it('does not change vector when y is also near zero', () => {
      const load = makeLoad({ x: 10, y: 0, z: 0 })
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [load],
        cases: [makeCase()],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // 2D xy plane
  // -------------------------------------------------------------------------
  describe('2D xy plane — load vector normalization', () => {
    it('swaps z->y when vector is in xy plane (z significant, y ~0)', () => {
      const load = makeLoad({ x: 10, y: 0, z: 5 })
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [load],
        cases: [makeCase()],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).not.toBe(snap)
      expect(result.loads[0].vector).toEqual({ x: 10, y: 5, z: 0 })
    })

    it('does not change vector when y is already significant', () => {
      const load = makeLoad({ x: 10, y: 5, z: 0 })
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [load],
        cases: [makeCase()],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // yz plane — no transformation
  // -------------------------------------------------------------------------
  describe('2D yz plane', () => {
    it('returns snapshot unchanged (yz is not normalized)', () => {
      const load = makeLoad({ x: 0, y: 5, z: 10 })
      const snap = makeSnapshot({
        plane: 'yz',
        loads: [load],
        cases: [makeCase()],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // Displacement normalization — xz plane
  // -------------------------------------------------------------------------
  describe('2D xz — displacement normalization', () => {
    it('swaps uy->uz when uz is ~0 and uy is significant', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 5, uz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.uz).toBe(5)
      expect(d.uy).toBe(0)
    })

    it('swaps ry<-rz when ry is ~0 and rz is defined', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 5, uz: 0, ry: 0, rz: 3 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.ry).toBe(3)
      expect(d.rz).toBe(0)
    })

    it('does not modify ry/rz when ry is significant', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 5, uz: 0, ry: 2, rz: 3 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      // ry is significant so rotation swap should NOT happen
      expect(d.ry).toBe(2)
      expect(d.rz).toBe(3)
    })

    it('does not swap rotation when rz is undefined', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 5, uz: 0, ry: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      // rz is undefined — rotation swap skipped
      expect(d.ry).toBe(0)
      expect(d.rz).toBeUndefined()
    })

    it('returns unchanged when uz is already significant', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 0, uz: 5 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })

    it('returns unchanged when both uy and uz are near zero', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 0, uz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // Reaction normalization — xz plane
  // -------------------------------------------------------------------------
  describe('2D xz — reaction normalization', () => {
    it('swaps fy->fz when fz is ~0 and fy is significant', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 5, fz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.fz).toBe(5)
      expect(r.fy).toBe(0)
    })

    it('swaps my<-mz when my is ~0 and mz is defined', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 5, fz: 0, my: 0, mz: 3 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.my).toBe(3)
      expect(r.mz).toBe(0)
    })

    it('does not swap moments when my is significant', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 5, fz: 0, my: 2, mz: 3 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.my).toBe(2)
      expect(r.mz).toBe(3)
    })

    it('does not swap moments when mz is undefined', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 5, fz: 0, my: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.my).toBe(0)
      expect(r.mz).toBeUndefined()
    })

    it('returns unchanged when fz is already significant', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 0, fz: 5 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // Displacement normalization — xy plane
  // -------------------------------------------------------------------------
  describe('2D xy — displacement normalization', () => {
    it('swaps uz->uy when uy is ~0 and uz is significant', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 0, uz: 5 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.uy).toBe(5)
      expect(d.uz).toBe(0)
    })

    it('swaps rz<-ry when rz is ~0 and ry is defined', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 0, uz: 5, ry: 3, rz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.rz).toBe(3)
      expect(d.ry).toBe(0)
    })

    it('does not swap rotations when rz is significant', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 0, uz: 5, ry: 2, rz: 4 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.ry).toBe(2)
      expect(d.rz).toBe(4)
    })

    it('does not swap rotations when ry is undefined', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 0, uz: 5, rz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.ry).toBeUndefined()
      expect(d.rz).toBe(0)
    })

    it('returns unchanged when uy is already significant', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 5, uz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // Reaction normalization — xy plane
  // -------------------------------------------------------------------------
  describe('2D xy — reaction normalization', () => {
    it('swaps fz->fy when fy is ~0 and fz is significant', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 0, fz: 5 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.fy).toBe(5)
      expect(r.fz).toBe(0)
    })

    it('swaps mz<-my when mz is ~0 and my is defined', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 0, fz: 5, my: 3, mz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.mz).toBe(3)
      expect(r.my).toBe(0)
    })

    it('does not swap moments when mz is significant', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 0, fz: 5, my: 2, mz: 4 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.my).toBe(2)
      expect(r.mz).toBe(4)
    })

    it('does not swap moments when my is undefined', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 0, fz: 5, mz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.my).toBeUndefined()
      expect(r.mz).toBe(0)
    })

    it('returns unchanged when fy is already significant', () => {
      const nodeResults = {
        n1: {
          reaction: { fx: 1, fy: 5, fz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // Node results with no displacement / no reaction
  // -------------------------------------------------------------------------
  describe('node results without displacement or reaction', () => {
    it('handles undefined displacement gracefully', () => {
      // For xz reaction normalization, the condition is:
      //   isSignificant(fz) || !isSignificant(fy)
      // fy=5 is significant, fz=0 is not — so !isSignificant(fy) = false, and the swap happens
      const nodeResults = {
        n1: {
          // displacement is undefined
          reaction: { fx: 1, fy: 5, fz: 0 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).not.toBe(snap)
      // Reaction should be normalized (fy->fz swap for xz)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.fz).toBe(5)
      expect(r.fy).toBe(0)
    })

    it('handles undefined reaction gracefully', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 5, uz: 0 },
          // reaction is undefined
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).not.toBe(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.uz).toBe(5)
      expect(d.uy).toBe(0)
    })

    it('handles both undefined displacement and reaction', () => {
      const nodeResults = {
        n1: {},
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // Multiple nodes in a case
  // -------------------------------------------------------------------------
  describe('multiple nodes and multiple cases', () => {
    it('normalizes all nodes in a case', () => {
      const nodeResults = {
        n1: { displacement: { ux: 1, uy: 5, uz: 0 } },
        n2: { displacement: { ux: 2, uy: 3, uz: 0 } },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result.cases[0].nodeResults['n1'].displacement!.uz).toBe(5)
      expect(result.cases[0].nodeResults['n2'].displacement!.uz).toBe(3)
    })

    it('normalizes all cases in the snapshot', () => {
      const case1 = makeCase(
        { n1: { displacement: { ux: 1, uy: 5, uz: 0 } } },
        { id: 'case-1' },
      )
      const case2 = makeCase(
        { n2: { displacement: { ux: 2, uy: 3, uz: 0 } } },
        { id: 'case-2' },
      )
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [case1, case2],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result.cases[0].nodeResults['n1'].displacement!.uz).toBe(5)
      expect(result.cases[1].nodeResults['n2'].displacement!.uz).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  // Epsilon threshold
  // -------------------------------------------------------------------------
  describe('epsilon threshold for near-zero values', () => {
    it('treats values below 1e-12 as insignificant', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 5, uz: 1e-13 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      // uz is below epsilon so it should be treated as 0 and swapped
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.uz).toBe(5)
      expect(d.uy).toBe(0)
    })

    it('treats values at exactly 1e-12 as insignificant', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 5, uz: 1e-12 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      // uz exactly at epsilon boundary (Math.abs(1e-12) > 1e-12 is false)
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.uz).toBe(5)
    })

    it('treats values just above 1e-12 as significant', () => {
      const nodeResults = {
        n1: {
          displacement: { ux: 1, uy: 5, uz: 1.1e-12 },
        },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      // uz just above epsilon — should NOT swap because uz is significant
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // Combined loads + cases
  // -------------------------------------------------------------------------
  describe('combined loads and cases normalization', () => {
    it('normalizes both loads and cases together', () => {
      const load = makeLoad({ x: 10, y: 5, z: 0 })
      const nodeResults = { n1: { displacement: { ux: 1, uy: 5, uz: 0 } } }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [load],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)

      expect(result.loads[0].vector).toEqual({ x: 10, y: 0, z: 5 })
      expect(result.cases[0].nodeResults['n1'].displacement!.uz).toBe(5)
    })

    it('returns same reference when nothing changes', () => {
      const load = makeLoad({ x: 10, y: 0, z: 5 })
      const nodeResults = { n1: { displacement: { ux: 1, uy: 0, uz: 5 } } }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [load],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // Immutability — original snapshot not mutated
  // -------------------------------------------------------------------------
  describe('immutability', () => {
    it('does not mutate the original snapshot loads', () => {
      const load = makeLoad({ x: 10, y: 5, z: 0 })
      const originalVector = { ...load.vector }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [load],
        cases: [makeCase()],
      })
      normalizeVisualizationSnapshot(snap)
      expect(load.vector).toEqual(originalVector)
    })

    it('does not mutate the original snapshot cases', () => {
      const nodeResults = { n1: { displacement: { ux: 1, uy: 5, uz: 0 } } }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const originalDisplacement = { ...snap.cases[0].nodeResults['n1'].displacement! }
      normalizeVisualizationSnapshot(snap)
      expect(snap.cases[0].nodeResults['n1'].displacement).toEqual(originalDisplacement)
    })
  })

  // -------------------------------------------------------------------------
  // Negative values
  // -------------------------------------------------------------------------
  describe('negative values', () => {
    it('handles negative displacement uy for xz swap', () => {
      const nodeResults = {
        n1: { displacement: { ux: 1, uy: -5, uz: 0 } },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const d = result.cases[0].nodeResults['n1'].displacement!
      expect(d.uz).toBe(-5)
      expect(d.uy).toBe(0)
    })

    it('handles negative reaction fy for xz swap', () => {
      const nodeResults = {
        n1: { reaction: { fx: 1, fy: -5, fz: 0 } },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      const result = normalizeVisualizationSnapshot(snap)
      const r = result.cases[0].nodeResults['n1'].reaction!
      expect(r.fz).toBe(-5)
      expect(r.fy).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Empty loads and cases
  // -------------------------------------------------------------------------
  describe('empty loads and cases', () => {
    it('handles snapshot with empty loads and cases arrays', () => {
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [],
      })
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // xz displacement with uy undefined (branch coverage)
  // -------------------------------------------------------------------------
  describe('xz displacement with uy undefined', () => {
    it('returns unchanged snapshot when uy is undefined and uz is insignificant', () => {
      const nodeResults = {
        n1: { displacement: { ux: 1, uz: 0 } as any },
      }
      const snap = makeSnapshot({
        plane: 'xz',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      // uy is undefined, uz is 0 (not significant) — but uy is also not
      // significant (it's not a number). So isSignificant(uy) is false
      // and isSignificant(uz) is false. The condition:
      //   isSignificant(uz) || !isSignificant(uy)  =>  false || true  =>  true
      // So it returns unchanged.
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })

  // -------------------------------------------------------------------------
  // xy displacement with uz undefined (branch coverage)
  // -------------------------------------------------------------------------
  describe('xy displacement with uz undefined', () => {
    it('returns unchanged snapshot when uz is undefined and uy is insignificant', () => {
      const nodeResults = {
        n1: { displacement: { ux: 1, uy: 0 } as any },
      }
      const snap = makeSnapshot({
        plane: 'xy',
        loads: [],
        cases: [makeCase(nodeResults)],
      })
      // uy is 0 (not significant), uz is undefined (not significant)
      // Condition: isSignificant(uy) || !isSignificant(uz) => false || true => true
      // Returns unchanged because the early return condition matches.
      const result = normalizeVisualizationSnapshot(snap)
      expect(result).toBe(snap)
    })
  })
})
