import { describe, expect, it } from 'vitest'
import { buildVisualizationSnapshot } from '@/components/visualization/adapter'

describe('visualization-adapter', () => {
  function buildUnitSnapshot(unitSystem?: string) {
    return buildVisualizationSnapshot({
      title: 'Unit Model',
      mode: 'model-only',
      model: {
        schema_version: '1.0.0',
        ...(unitSystem ? { unit_system: unitSystem } : {}),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 6, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
      },
    })
  }

  it('uses StructureClaw SI units for visualization defaults', () => {
    const snapshot = buildUnitSnapshot()

    expect(snapshot).not.toBeNull()
    expect(snapshot).toMatchObject({
      unitSystem: 'SI',
      lengthUnit: 'm',
      nodeLabelUnit: 'm',
      displacementUnit: 'mm',
      displacementDisplayFactor: 1000,
      resultUnit: 'kN',
      momentUnit: 'kN.m',
      nodalLoadUnit: 'kN',
      distributedLoadUnit: 'kN/m',
    })
  })

  it.each([
    ['N-mm', { lengthUnit: 'mm', displacementDisplayFactor: 1, resultUnit: 'N', momentUnit: 'N.mm', distributedLoadUnit: 'N/mm' }],
    ['kN-mm', { lengthUnit: 'mm', displacementDisplayFactor: 1, resultUnit: 'kN', momentUnit: 'kN.mm', distributedLoadUnit: 'kN/mm' }],
    ['N-m', { lengthUnit: 'm', displacementDisplayFactor: 1000, resultUnit: 'N', momentUnit: 'N.m', distributedLoadUnit: 'N/m' }],
  ])('honors explicit %s visualization unit systems', (unitSystem, expected) => {
    const snapshot = buildUnitSnapshot(unitSystem)

    expect(snapshot).not.toBeNull()
    expect(snapshot).toMatchObject(expected)
  })

  it('maps a canonical 2d frame payload into an xz snapshot without axis swapping', () => {
    const snapshot = buildVisualizationSnapshot({
      title: '2D Frame',
      mode: 'analysis-result',
      model: {
        schema_version: '1.0.0',
        metadata: {
          coordinateSemantics: 'global-z-up',
          frameDimension: '2d',
        },
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
          { id: '2', x: 6, y: 0, z: 4 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
        load_cases: [{ id: 'D', loads: [{ node: '2', fx: 3, fz: -10 }] }],
      },
      analysis: {
        data: {
          displacements: {
            '2': { ux: 0.01, uy: 0, uz: -0.02, ry: 0.003 },
          },
          reactions: {
            '1': { fx: -3, fy: 0, fz: 10, my: 12 },
          },
        },
      },
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot?.coordinateSemantics).toBe('global-z-up')
    expect(snapshot?.dimension).toBe(2)
    expect(snapshot?.plane).toBe('xz')
    expect(snapshot?.loads[0]?.vector).toEqual({ x: 3, y: 0, z: -10 })
    expect(snapshot?.cases[0]?.nodeResults['2']?.displacement).toMatchObject({ ux: 0.01, uy: 0, uz: -0.02, ry: 0.003 })
    expect(snapshot?.cases[0]?.nodeResults['1']?.reaction).toMatchObject({ fx: -3, fy: 0, fz: 10, my: 12 })
  })

  it('keeps canonical 3d load directions and displacements unchanged', () => {
    const snapshot = buildVisualizationSnapshot({
      title: '3D Space Frame',
      mode: 'analysis-result',
      model: {
        schema_version: '1.0.0',
        metadata: {
          coordinateSemantics: 'global-z-up',
          frameDimension: '3d',
        },
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 4, y: 2, z: 3 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
        load_cases: [{ id: 'L1', loads: [{ node: '2', fx: 1, fy: -5, fz: -3 }] }],
      },
      analysis: {
        data: {
          displacements: {
            '2': { ux: 0.001, uy: -0.002, uz: -0.003 },
          },
          reactions: {
            '1': { fx: -1, fy: 5, fz: 3 },
          },
          caseResults: {
            L1: {
              displacements: {
                '2': { ux: 0.001, uy: -0.002, uz: -0.003 },
              },
            },
          },
        },
      },
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot?.coordinateSemantics).toBe('global-z-up')
    expect(snapshot?.dimension).toBe(3)
    expect(snapshot?.plane).toBe('xy')
    expect(snapshot?.loads[0]?.vector).toEqual({ x: 1, y: -5, z: -3 })
    expect(snapshot?.cases.find((item) => item.id === 'result')?.nodeResults['2']?.displacement).toMatchObject({ ux: 0.001, uy: -0.002, uz: -0.003 })
  })

  it('falls back to xz plane for ambiguous metadata-free 2d geometry', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Metadata-free Beam',
      mode: 'model-only',
      model: {
        schema_version: '1.0.0',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
          { id: '2', x: 6, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
      },
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot?.coordinateSemantics).toBeUndefined()
    expect(snapshot?.dimension).toBe(2)
    expect(snapshot?.plane).toBe('xz')
  })

  it('detects 3d geometry from node coordinates when metadata is absent', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Geometry 3D',
      mode: 'model-only',
      model: {
        schema_version: '1.0.0',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 4, y: 2, z: 0 },
          { id: '3', x: 4, y: 2, z: 3 },
        ],
        elements: [
          { id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' },
          { id: 'E2', type: 'beam', nodes: ['2', '3'], material: 'M1', section: 'S1' },
        ],
      },
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot?.dimension).toBe(3)
    expect(snapshot?.plane).toBe('xy')
  })

  it('returns null when required model geometry is missing', () => {
    expect(
      buildVisualizationSnapshot({
        title: 'invalid',
        model: { schema_version: '1.0.0', nodes: [], elements: [] },
        analysis: { data: {} },
      })
    ).toBeNull()
  })
})
