import { describe, expect, it } from 'vitest'
import { buildVisualizationSnapshot } from '@/components/visualization/adapter'

describe('visualization-adapter', () => {
  const coordinateSystem = (dimension: '2d' | '3d') => ({
    semantics: 'global-z-up',
    version: 1,
    dimension,
    plane: dimension === '2d' ? 'xz' : null,
    dof_order: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
  })

  const resultMeta = (dimension: '2d' | '3d') => ({
    coordinateSemantics: 'global-z-up',
    coordinateContractVersion: 1,
    dimension,
    plane: dimension === '2d' ? 'xz' : null,
    dofOrder: ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
    activeDofs: dimension === '2d' ? ['ux', 'uz', 'ry'] : ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'],
    nodalResultFrame: 'global',
    elementForceFrame: 'element-local',
  })

  function buildUnitSnapshot(unitSystem?: string) {
    return buildVisualizationSnapshot({
      title: 'Unit Model',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
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

  it('exposes original story floor loads as area load markers', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Floor Loads',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('3d'),
        metadata: {
          coordinateSemantics: 'global-z-up',
          coordinateContractVersion: 1,
          frameDimension: '3d',
        },
        stories: [
          {
            id: 'F1',
            height: 3,
            elevation: 0,
            floor_loads: [
              { type: 'dead', value: 3.2 },
              { type: 'live', value: 2 },
            ],
            dead_load: 1.1,
          },
        ],
        nodes: [
          { id: 'B1', x: 0, y: 0, z: 0 },
          { id: 'B2', x: 6, y: 0, z: 0 },
          { id: 'B3', x: 6, y: 4, z: 0 },
          { id: 'B4', x: 0, y: 4, z: 0 },
          { id: 'T1', x: 0, y: 0, z: 3, story: 'F1' },
          { id: 'T2', x: 6, y: 0, z: 3, story: 'F1' },
          { id: 'T3', x: 6, y: 4, z: 3, story: 'F1' },
          { id: 'T4', x: 0, y: 4, z: 3, story: 'F1' },
        ],
        elements: [
          { id: 'C1', type: 'column', nodes: ['B1', 'T1'], material: 'M1', section: 'S1' },
          { id: 'C2', type: 'column', nodes: ['B2', 'T2'], material: 'M1', section: 'S1' },
          { id: 'C3', type: 'column', nodes: ['B3', 'T3'], material: 'M1', section: 'S1' },
          { id: 'C4', type: 'column', nodes: ['B4', 'T4'], material: 'M1', section: 'S1' },
        ],
      },
    })

    const floorLoad = snapshot?.loads.find((load) => load.kind === 'area')

    expect(snapshot).not.toBeNull()
    expect(snapshot?.floorLoadUnit).toBe('kN/m^2')
    expect(floorLoad).toMatchObject({
      kind: 'area',
      storyId: 'F1',
      intensity: 5.2,
      area: 24,
      vector: { x: 0, y: 0, z: -5.2 },
      components: [
        { type: 'dead', value: 3.2 },
        { type: 'live', value: 2 },
      ],
    })
    expect(floorLoad?.polygon).toEqual([
      { x: 0, y: 0, z: 3 },
      { x: 6, y: 0, z: 3 },
      { x: 6, y: 4, z: 3 },
      { x: 0, y: 4, z: 3 },
    ])
  })

  it('maps a canonical 2d frame payload into an xz snapshot without axis swapping', () => {
    const snapshot = buildVisualizationSnapshot({
      title: '2D Frame',
      mode: 'analysis-result',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
        metadata: {
          coordinateSemantics: 'global-z-up',
          coordinateContractVersion: 1,
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
          meta: resultMeta('2d'),
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

  it('exposes the reactions view for a pure reaction moment', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Moment Reaction',
      mode: 'analysis-result',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 1, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
      },
      analysis: {
        data: {
          meta: resultMeta('2d'),
          reactions: { '1': { fx: 0, fy: 0, fz: 0, my: 8 } },
        },
      },
    })

    expect(snapshot?.availableViews).toContain('reactions')
    expect(snapshot?.cases[0]?.nodeResults['1']?.reaction).toMatchObject({ my: 8 })
  })

  it('uses the typed coordinate contract and transforms a sloped member-local load into global rendering coordinates', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Sloped 2D Member',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 3, y: 0, z: 4 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
        load_cases: [{ id: 'L1', loads: [{ element: 'E1', wx: 2, wy: 0, wz: -5, reference_frame: 'element-local' }] }],
      },
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot).toMatchObject({
      coordinateSemantics: 'global-z-up',
      coordinateContractVersion: 1,
      dimension: 2,
      plane: 'xz',
    })
    expect(snapshot?.elements[0]?.localAxes).toEqual({
      x: { x: 0.6, y: 0, z: 0.8 },
      y: { x: 0, y: 1, z: 0 },
      z: { x: -0.8, y: 0, z: 0.6 },
    })
    expect(snapshot?.loads[0]).toMatchObject({
      referenceFrame: 'element-local',
      sourceVector: { x: 2, y: 0, z: -5 },
    })
    expect(snapshot?.loads[0]?.vector.x).toBeCloseTo(5.2)
    expect(snapshot?.loads[0]?.vector.y).toBeCloseTo(0)
    expect(snapshot?.loads[0]?.vector.z).toBeCloseTo(-1.4)
  })

  it('uses the same right-handed local axes as the solver for a vertical 3d member', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Vertical 3D Member',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('3d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 0, y: 0, z: 3 },
        ],
        elements: [{ id: 'E1', type: 'column', nodes: ['1', '2'], material: 'M1', section: 'S1' }],
        load_cases: [{ id: 'L1', loads: [{ element: 'E1', wx: 0, wy: 0, wz: -5, reference_frame: 'element-local' }] }],
      },
    })

    expect(snapshot?.elements[0]?.localAxes).toEqual({
      x: { x: 0, y: 0, z: 1 },
      y: { x: 0, y: -1, z: 0 },
      z: { x: 1, y: 0, z: 0 },
    })
    expect(snapshot?.loads[0]?.vector).toEqual({ x: -5, y: 0, z: 0 })
  })

  it('rejects canonical 2d geometry outside the global xz plane', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Invalid 2D Model',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 4, y: 1, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
      },
    })

    expect(snapshot).toBeNull()
  })

  it('rejects blank coordinates instead of coercing them to the global origin', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Blank Coordinate',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: ' ', y: 0, z: 3 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
      },
    })

    expect(snapshot).toBeNull()
  })

  it('rejects analysis results whose coordinate metadata conflicts with the model', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Mismatched Results',
      mode: 'analysis-result',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 4, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
      },
      analysis: {
        data: {
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
          displacements: { '2': { ux: 0.01, uy: 0, uz: -0.02 } },
        },
      },
    })

    expect(snapshot).toBeNull()
  })

  it('rejects partial or conflicting result coordinate declarations', () => {
    const model = {
      schema_version: '2.0.0',
      coordinate_system: coordinateSystem('2d'),
      nodes: [
        { id: '1', x: 0, y: 0, z: 0 },
        { id: '2', x: 4, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
    }
    const partialMeta = { ...resultMeta('2d') } as Record<string, unknown>
    delete partialMeta.activeDofs

    expect(buildVisualizationSnapshot({
      title: 'Partial Result Contract',
      model,
      analysis: { data: { meta: partialMeta, displacements: { '2': { ux: 0.01 } } } },
    })).toBeNull()
    expect(buildVisualizationSnapshot({
      title: 'Conflicting Result Contracts',
      model,
      analysis: {
        meta: { ...resultMeta('2d'), dimension: '3d', plane: null },
        data: { meta: resultMeta('2d'), displacements: { '2': { ux: 0.01 } } },
      },
    })).toBeNull()
  })

  it('rejects nonzero out-of-plane displacement and reaction components in 2d results', () => {
    const model = {
      schema_version: '2.0.0',
      coordinate_system: coordinateSystem('2d'),
      nodes: [
        { id: '1', x: 0, y: 0, z: 0 },
        { id: '2', x: 4, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
    }

    expect(buildVisualizationSnapshot({
      title: 'Out-of-plane Displacement',
      model,
      analysis: { data: { meta: resultMeta('2d'), displacements: { '2': { ux: 0, uy: 0.01, uz: 0 } } } },
    })).toBeNull()
    expect(buildVisualizationSnapshot({
      title: 'Out-of-plane Reaction',
      model,
      analysis: { data: { meta: resultMeta('2d'), reactions: { '1': { fx: 0, fy: 2, fz: 0 } } } },
    })).toBeNull()
  })

  it('rejects malformed restraint arrays instead of shifting their dof indices', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Invalid Restraints',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, 'false', true, false, false, false] },
          { id: '2', x: 4, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
      },
    })

    expect(snapshot).toBeNull()
  })

  it('keeps canonical 3d load directions and displacements unchanged', () => {
    const snapshot = buildVisualizationSnapshot({
      title: '3D Space Frame',
      mode: 'analysis-result',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('3d'),
        metadata: {
          coordinateSemantics: 'global-z-up',
          coordinateContractVersion: 1,
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
          meta: resultMeta('3d'),
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

  it('rejects ambiguous metadata-free 2d geometry', () => {
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

    expect(snapshot).toBeNull()
  })

  it('rejects metadata-free geometry instead of guessing 3d coordinates', () => {
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

    expect(snapshot).toBeNull()
  })

  it('rejects metadata-only V2 models instead of reconstructing a typed coordinate contract', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Untyped V2',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        metadata: {
          coordinateSemantics: 'global-z-up',
          coordinateContractVersion: 1,
          frameDimension: '2d',
        },
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 5, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
      },
    })

    expect(snapshot).toBeNull()
  })

  it('rejects a partial 3d coordinate contract with an omitted plane', () => {
    const incomplete = coordinateSystem('3d') as Record<string, unknown>
    delete incomplete.plane
    const snapshot = buildVisualizationSnapshot({
      title: 'Incomplete 3D Contract',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: incomplete,
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 1, y: 1, z: 1 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
      },
    })

    expect(snapshot).toBeNull()
  })

  it('maps canonical six-component nodal load arrays without exchanging Y and Z', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Nodal Array',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('3d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 2, y: 1, z: 3 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
        load_cases: [{ id: 'L1', loads: [{ node: '2', forces: [1, -2, -3, 4, 5, 6] }] }],
      },
    })

    expect(snapshot?.loads[0]).toMatchObject({
      nodeId: '2',
      vector: { x: 1, y: -2, z: -3 },
      sourceVector: { x: 1, y: -2, z: -3 },
    })
    expect(snapshot?.loads[1]).toMatchObject({
      nodeId: '2',
      kind: 'moment',
      vector: { x: 4, y: 5, z: 6 },
      sourceVector: { x: 4, y: 5, z: 6 },
    })
  })

  it('keeps the active 2d nodal moment about global Y', () => {
    const snapshot = buildVisualizationSnapshot({
      title: '2D Nodal Moment',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 5, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
        load_cases: [{ id: 'L1', loads: [{ node: '2', my: 12 }] }],
      },
    })

    expect(snapshot?.loads).toEqual([
      expect.objectContaining({
        nodeId: '2',
        kind: 'moment',
        vector: { x: 0, y: 12, z: 0 },
      }),
    ])
  })

  it('rejects target-dependent nodal and member load aliases in typed V2 models', () => {
    const baseModel = {
      schema_version: '2.0.0',
      coordinate_system: coordinateSystem('2d'),
      nodes: [
        { id: '1', x: 0, y: 0, z: 0 },
        { id: '2', x: 5, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
    }
    expect(buildVisualizationSnapshot({
      title: 'Invalid nodal alias',
      model: { ...baseModel, load_cases: [{ id: 'L1', loads: [{ node: '2', wz: -5 }] }] },
    })).toBeNull()
    expect(buildVisualizationSnapshot({
      title: 'Invalid member alias',
      model: { ...baseModel, load_cases: [{ id: 'L1', loads: [{ element: 'E1', fz: -5 }] }] },
    })).toBeNull()
  })

  it('rejects custom local-axis reference vectors for canonical 2d models', () => {
    expect(buildVisualizationSnapshot({
      title: 'Invalid 2D axes',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('2d'),
        metadata: { elementReferenceVectors: { E1: [0, 0, 1] } },
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 5, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
      },
    })).toBeNull()
  })

  it('does not draw derived story nodal loads twice when the exact area load is shown', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Deduplicated Floor Load',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('3d'),
        stories: [{ id: 'F1', height: 3, elevation: 0, floor_loads: [{ type: 'dead', value: 5 }] }],
        nodes: [
          { id: '1', x: 0, y: 0, z: 3, story: 'F1' },
          { id: '2', x: 6, y: 0, z: 3, story: 'F1' },
          { id: '3', x: 6, y: 4, z: 3, story: 'F1' },
          { id: '4', x: 0, y: 4, z: 3, story: 'F1' },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
        load_cases: [{
          id: 'D',
          loads: [1, 2, 3, 4].map((node) => ({
            node: String(node),
            fz: -30,
            source: 'story_floor_loads',
            story: 'F1',
            load_kind: 'dead',
          })),
        }],
      },
    })

    expect(snapshot?.loads).toHaveLength(1)
    expect(snapshot?.loads[0]).toMatchObject({ kind: 'area', storyId: 'F1', area: 24 })
  })

  it('does not invent a rectangular area polygon for an incomplete floor grid', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Irregular Floor',
      mode: 'model-only',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('3d'),
        stories: [{ id: 'F1', height: 3, elevation: 0, floor_loads: [{ type: 'dead', value: 5 }] }],
        nodes: [
          { id: '1', x: 0, y: 0, z: 3, story: 'F1' },
          { id: '2', x: 6, y: 0, z: 3, story: 'F1' },
          { id: '3', x: 3, y: 4, z: 3, story: 'F1' },
          { id: '4', x: 0, y: 4, z: 3, story: 'F1' },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
        load_cases: [{ id: 'D', loads: [{ node: '3', fz: -10 }] }],
      },
    })

    expect(snapshot?.loads.some((load) => load.kind === 'area')).toBe(false)
    expect(snapshot?.loads).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'nodal', nodeId: '3', vector: { x: 0, y: 0, z: -10 } }),
    ]))
  })

  it('rejects duplicate elements and malformed element node arrays', () => {
    const baseModel = {
      schema_version: '2.0.0',
      coordinate_system: coordinateSystem('2d'),
      nodes: [
        { id: '1', x: 0, y: 0, z: 0 },
        { id: '2', x: 5, y: 0, z: 0 },
      ],
    }
    expect(buildVisualizationSnapshot({
      title: 'Duplicate Elements',
      model: {
        ...baseModel,
        elements: [
          { id: 'E1', type: 'beam', nodes: ['1', '2'] },
          { id: 'E1', type: 'beam', nodes: ['1', '2'] },
        ],
      },
    })).toBeNull()
    expect(buildVisualizationSnapshot({
      title: 'Malformed Connectivity',
      model: {
        ...baseModel,
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', null, '2'] }],
      },
    })).toBeNull()
  })

  it('rejects results that reference unknown model ids or malformed nested local forces', () => {
    const model = {
      schema_version: '2.0.0',
      coordinate_system: coordinateSystem('2d'),
      nodes: [
        { id: '1', x: 0, y: 0, z: 0 },
        { id: '2', x: 5, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
    }
    expect(buildVisualizationSnapshot({
      title: 'Unknown Result Node',
      model,
      analysis: { data: { meta: resultMeta('2d'), displacements: { missing: { ux: 1 } } } },
    })).toBeNull()
    expect(buildVisualizationSnapshot({
      title: 'Malformed Local Force',
      model,
      analysis: {
        data: {
          meta: resultMeta('2d'),
          forces: { E1: { referenceFrame: 'element-local', n1: { N: 'invalid' } } },
        },
      },
    })).toBeNull()
  })

  it('rejects result-local axes that conflict with the model member axes', () => {
    const snapshot = buildVisualizationSnapshot({
      title: 'Mismatched Local Axes',
      model: {
        schema_version: '2.0.0',
        coordinate_system: coordinateSystem('3d'),
        nodes: [
          { id: '1', x: 0, y: 0, z: 0 },
          { id: '2', x: 5, y: 0, z: 0 },
        ],
        elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
      },
      analysis: {
        data: {
          meta: resultMeta('3d'),
          forces: {
            E1: {
              referenceFrame: 'element-local',
              localAxes: { x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] },
              N: 1,
            },
          },
        },
      },
    })

    expect(snapshot).toBeNull()
  })

  it('rejects 2d buckling vectors outside X-Z and extension ids outside the model', () => {
    const model = {
      schema_version: '2.0.0',
      coordinate_system: coordinateSystem('2d'),
      nodes: [
        { id: '1', x: 0, y: 0, z: 0 },
        { id: '2', x: 5, y: 0, z: 0 },
      ],
      elements: [{ id: 'E1', type: 'beam', nodes: ['1', '2'] }],
    }
    expect(buildVisualizationSnapshot({
      title: 'Out-of-plane mode',
      model,
      bucklingModes: [{ lambda: 2, modeShape: { '2': [0, 1, 0] } }],
    })).toBeNull()
    expect(buildVisualizationSnapshot({
      title: 'Unknown utilization element',
      model,
      memberUtilizationMap: { missing: 0.8 },
    })).toBeNull()
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
