import { describe, expect, it } from 'vitest'
import { buildVisualizationSnapshot } from '@/components/visualization/adapter'

describe('visualization-adapter', () => {
  it('maps a 2D beam model and analysis payload into a visualization snapshot', () => {
    const snapshot = buildVisualizationSnapshot({
      title: '2D Beam',
      mode: 'analysis-result',
      model: {
        schema_version: '1.0.0',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
          { id: '2', x: 6, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
        load_cases: [{ id: 'D', loads: [{ node: '2', fy: -10 }] }],
      },
      analysis: {
        data: {
          displacements: {
            '2': { ux: 0.01, uz: -0.02, ry: 0.003 },
          },
          reactions: {
            '1': { fy: 10 },
          },
          forces: {
            E1: { axial: 2, n1: { M: 20, V: 10 }, n2: { M: 0, V: 10 } },
          },
          envelopeTables: {
            nodeDisplacement: {
              '2': { maxAbsDisplacement: 0.02, controlCase: 'D' },
            },
            elementForce: {
              E1: { maxAbsMoment: 20, controlCaseMoment: 'D' },
            },
          },
        },
      },
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot?.source).toBe('result')
    expect(snapshot?.dimension).toBe(2)
    expect(snapshot?.plane).toBe('xz')
    expect(snapshot?.elements[0]?.nodeIds).toEqual(['1', '2'])
    expect(snapshot?.cases.find((item) => item.id === 'result')?.elementResults.E1?.moment).toBe(20)
    expect(snapshot?.cases.find((item) => item.id === 'envelope')?.nodeResults['2']?.envelope?.maxAbsDisplacement).toBe(0.02)
  })

  it('detects a 3D truss/frame payload and keeps case results', () => {
    const snapshot = buildVisualizationSnapshot({
      title: '3D Space Frame',
      mode: 'analysis-result',
      model: {
        schema_version: '1.0.0',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 4, y: 0, z: 0 },
          { id: '3', x: 4, y: 3, z: 2 },
        ],
        elements: [
          { id: 'E1', type: 'beam', nodes: ['1', '3'], material: 'M1', section: 'S1' },
          { id: 'E2', type: 'truss', nodes: ['2', '3'], material: 'M1', section: 'S1' },
        ],
      },
      analysis: {
        data: {
          displacements: {
            '3': { ux: 0.005, uy: -0.004, uz: 0.006 },
          },
          caseResults: {
            W: {
              displacements: {
                '3': { ux: 0.007, uy: -0.005, uz: 0.008 },
              },
              reactions: {
                '1': { fx: -8, fy: 2, fz: 1 },
              },
              forces: {
                E1: { axial: 8 },
              },
            },
          },
        },
      },
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot?.dimension).toBe(3)
    expect(snapshot?.cases.map((item) => item.id)).toContain('W')
    expect(snapshot?.cases.find((item) => item.id === 'W')?.elementResults.E1?.axial).toBe(8)
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

  it('builds a model-only snapshot without analysis data', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Model Preview',
      mode: 'model-only',
      model: {
        schema_version: '1.0.0',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
          { id: '2', x: 6, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
        load_cases: [{ id: 'L1', loads: [{ node: '2', fy: -5 }] }],
      },
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot?.source).toBe('model')
    expect(snapshot?.availableViews).toEqual(['model'])
    expect(snapshot?.defaultCaseId).toBe('model')
    expect(snapshot?.plane).toBe('xy')
    expect(snapshot?.loads[0]?.vector.y).toBe(-5)
  })
})
