import type {
  VisualizationCase,
  VisualizationElement,
  VisualizationElementResults,
  VisualizationLoad,
  VisualizationNode,
  VisualizationNodeResults,
  VisualizationSource,
  VisualizationSnapshot,
  VisualizationViewMode,
} from './types'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pickNumber(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return null
  for (const key of keys) {
    const value = asNumber(source[key])
    if (value !== null) {
      return value
    }
  }
  return null
}

function vectorMagnitude(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (filtered.length === 0) {
    return 0
  }
  return Math.sqrt(filtered.reduce((sum, value) => sum + value ** 2, 0))
}

function compactNumberRecord<T extends string>(entries: Array<[T, number | null]>) {
  return Object.fromEntries(entries.filter(([, value]) => value !== null)) as Partial<Record<T, number>>
}

function flattenEndForces(source: Record<string, unknown> | null) {
  if (!source) {
    return {}
  }
  const flattened: Record<string, number> = {}
  Object.entries(source).forEach(([key, value]) => {
    const direct = asNumber(value)
    if (direct !== null) {
      flattened[key] = direct
      return
    }
    const nested = asRecord(value)
    if (!nested) {
      return
    }
    Object.entries(nested).forEach(([nestedKey, nestedValue]) => {
      const numeric = asNumber(nestedValue)
      if (numeric !== null) {
        flattened[`${key}.${nestedKey}`] = numeric
      }
    })
  })
  return flattened
}

function extractElementMetrics(entry: Record<string, unknown> | null): VisualizationElementResults {
  const flat = flattenEndForces(entry)
  const flatValues = Object.values(flat)
  const shearCandidates = [
    flat.V,
    flat.Vy,
    flat.Vz,
    flat['n1.V'],
    flat['n2.V'],
    flat['n1.Vy'],
    flat['n2.Vy'],
    flat['n1.Vz'],
    flat['n2.Vz'],
    flat['n1.Fy'],
    flat['n2.Fy'],
    flat['n1.Fz'],
    flat['n2.Fz'],
  ].filter((value): value is number => typeof value === 'number')
  const momentCandidates = [
    flat.M,
    flat.My,
    flat.Mz,
    flat['n1.M'],
    flat['n2.M'],
    flat['n1.My'],
    flat['n2.My'],
    flat['n1.Mz'],
    flat['n2.Mz'],
  ].filter((value): value is number => typeof value === 'number')

  return {
    axial: pickNumber(entry, ['axial', 'N']) ?? undefined,
    shear: shearCandidates.length ? Math.max(...shearCandidates.map((value) => Math.abs(value))) : undefined,
    moment: momentCandidates.length ? Math.max(...momentCandidates.map((value) => Math.abs(value))) : undefined,
    torsion: pickNumber(entry, ['torsion', 'T', 'Mx']) ?? undefined,
    endForces: flatValues.length ? flat : undefined,
  }
}

function extractNodeResults(entry: Record<string, unknown> | null): VisualizationNodeResults {
  return {
    displacement: entry
      ? compactNumberRecord([
          ['ux', pickNumber(entry, ['ux'])],
          ['uy', pickNumber(entry, ['uy'])],
          ['uz', pickNumber(entry, ['uz'])],
          ['rx', pickNumber(entry, ['rx'])],
          ['ry', pickNumber(entry, ['ry'])],
          ['rz', pickNumber(entry, ['rz'])],
        ])
      : undefined,
    reaction: entry
      ? compactNumberRecord([
          ['fx', pickNumber(entry, ['fx'])],
          ['fy', pickNumber(entry, ['fy'])],
          ['fz', pickNumber(entry, ['fz'])],
          ['mx', pickNumber(entry, ['mx'])],
          ['my', pickNumber(entry, ['my'])],
          ['mz', pickNumber(entry, ['mz'])],
        ])
      : undefined,
  }
}

function buildCase(
  id: string,
  label: string,
  kind: VisualizationCase['kind'],
  displacementsInput: Record<string, unknown> | null,
  reactionsInput: Record<string, unknown> | null,
  forcesInput: Record<string, unknown> | null,
  envelopeInput?: Record<string, unknown> | null
): VisualizationCase {
  const nodeResults: Record<string, VisualizationNodeResults> = {}
  const elementResults: Record<string, VisualizationElementResults> = {}

  Object.entries(displacementsInput || {}).forEach(([nodeId, value]) => {
    nodeResults[nodeId] = {
      ...(nodeResults[nodeId] || {}),
      ...extractNodeResults(asRecord(value)),
    }
  })

  Object.entries(reactionsInput || {}).forEach(([nodeId, value]) => {
    nodeResults[nodeId] = {
      ...(nodeResults[nodeId] || {}),
      reaction: extractNodeResults(asRecord(value)).reaction,
    }
  })

  Object.entries(forcesInput || {}).forEach(([elementId, value]) => {
    elementResults[elementId] = {
      ...(elementResults[elementId] || {}),
      ...extractElementMetrics(asRecord(value)),
    }
  })

  const envelope = asRecord(envelopeInput)
  if (envelope) {
    Object.entries(nodeResults).forEach(([nodeId, entry]) => {
      const maxAbsDisplacement = asNumber(envelope[`node:${nodeId}:maxAbsDisplacement`])
      const maxAbsReaction = asNumber(envelope[`node:${nodeId}:maxAbsReaction`])
      if (maxAbsDisplacement !== null || maxAbsReaction !== null) {
        entry.envelope = {
          ...(entry.envelope || {}),
          ...(maxAbsDisplacement !== null ? { maxAbsDisplacement } : {}),
          ...(maxAbsReaction !== null ? { maxAbsReaction } : {}),
        }
      }
    })
  }

  return { id, label, kind, nodeResults, elementResults }
}

function applyEnvelopeTables(target: VisualizationCase, envelopeTables: Record<string, unknown> | null) {
  if (!envelopeTables) {
    return
  }

  const nodeDisplacement = asRecord(envelopeTables.nodeDisplacement)
  Object.entries(nodeDisplacement || {}).forEach(([nodeId, value]) => {
    const entry = asRecord(value)
    if (!entry) {
      return
    }
    target.nodeResults[nodeId] = {
      ...(target.nodeResults[nodeId] || {}),
      envelope: {
        ...(target.nodeResults[nodeId]?.envelope || {}),
        ...(pickNumber(entry, ['maxAbsDisplacement']) !== null ? { maxAbsDisplacement: pickNumber(entry, ['maxAbsDisplacement']) as number } : {}),
        ...(typeof entry.controlCase === 'string' ? { controlCase: entry.controlCase } : {}),
      },
    }
  })

  const nodeReaction = asRecord(envelopeTables.nodeReaction)
  Object.entries(nodeReaction || {}).forEach(([nodeId, value]) => {
    const entry = asRecord(value)
    if (!entry) {
      return
    }
    target.nodeResults[nodeId] = {
      ...(target.nodeResults[nodeId] || {}),
      envelope: {
        ...(target.nodeResults[nodeId]?.envelope || {}),
        ...(pickNumber(entry, ['maxAbsReaction']) !== null ? { maxAbsReaction: pickNumber(entry, ['maxAbsReaction']) as number } : {}),
        ...(typeof entry.controlCase === 'string' ? { controlCaseReaction: entry.controlCase } : {}),
      },
    }
  })

  const elementForce = asRecord(envelopeTables.elementForce)
  Object.entries(elementForce || {}).forEach(([elementId, value]) => {
    const entry = asRecord(value)
    if (!entry) {
      return
    }
    target.elementResults[elementId] = {
      ...(target.elementResults[elementId] || {}),
      envelope: {
        ...(target.elementResults[elementId]?.envelope || {}),
        ...(pickNumber(entry, ['maxAbsAxialForce']) !== null ? { maxAbsAxialForce: pickNumber(entry, ['maxAbsAxialForce']) as number } : {}),
        ...(pickNumber(entry, ['maxAbsShearForce']) !== null ? { maxAbsShearForce: pickNumber(entry, ['maxAbsShearForce']) as number } : {}),
        ...(pickNumber(entry, ['maxAbsMoment']) !== null ? { maxAbsMoment: pickNumber(entry, ['maxAbsMoment']) as number } : {}),
      },
      controlCases: {
        ...(target.elementResults[elementId]?.controlCases || {}),
        ...(typeof entry.controlCaseAxial === 'string' ? { axial: entry.controlCaseAxial } : {}),
        ...(typeof entry.controlCaseShear === 'string' ? { shear: entry.controlCaseShear } : {}),
        ...(typeof entry.controlCaseMoment === 'string' ? { moment: entry.controlCaseMoment } : {}),
      },
    }
  })
}

function getLoads(model: Record<string, unknown> | null): VisualizationLoad[] {
  const loadCases = Array.isArray(model?.load_cases) ? model?.load_cases : []
  const loads: VisualizationLoad[] = []

  loadCases.forEach((loadCase) => {
    const loadCaseRecord = asRecord(loadCase)
    const caseId = typeof loadCaseRecord?.id === 'string' ? loadCaseRecord.id : undefined
    const caseLoads = Array.isArray(loadCaseRecord?.loads) ? loadCaseRecord.loads : []
    caseLoads.forEach((entry) => {
      const load = asRecord(entry)
      if (!load) {
        return
      }
      if (typeof load.node === 'string') {
        loads.push({
          nodeId: load.node,
          caseId,
          kind: 'nodal',
          vector: {
            x: pickNumber(load, ['fx']) ?? 0,
            y: pickNumber(load, ['fy']) ?? 0,
            z: pickNumber(load, ['fz']) ?? 0,
          },
        })
        return
      }
      if (typeof load.element === 'string') {
        loads.push({
          nodeId: '',
          elementId: load.element,
          caseId,
          kind: 'distributed',
          vector: {
            x: 0,
            y: pickNumber(load, ['wy']) ?? 0,
            z: pickNumber(load, ['wz']) ?? 0,
          },
        })
      }
    })
  })

  return loads
}

function deriveDimension(nodes: VisualizationNode[], displacements: Record<string, unknown> | null) {
  const ySpread = new Set(nodes.map((node) => node.position.y.toFixed(6))).size
  const zSpread = new Set(nodes.map((node) => node.position.z.toFixed(6))).size
  const displacementEntries = Object.values(displacements || {}).map((value) => asRecord(value))
  const hasUy = displacementEntries.some((entry) => entry && asNumber(entry.uy) !== null)
  const hasUz = displacementEntries.some((entry) => entry && asNumber(entry.uz) !== null)

  if ((ySpread > 1 && zSpread > 1) || (hasUy && hasUz)) {
    return 3 as const
  }
  return 2 as const
}

function derivePlane(
  nodes: VisualizationNode[],
  displacements: Record<string, unknown> | null,
  loads: VisualizationLoad[]
) {
  const zSpread = new Set(nodes.map((node) => node.position.z.toFixed(6))).size
  const ySpread = new Set(nodes.map((node) => node.position.y.toFixed(6))).size
  const displacementEntries = Object.values(displacements || {}).map((value) => asRecord(value))
  const hasUz = displacementEntries.some((entry) => entry && asNumber(entry.uz) !== null)
  const hasRy = displacementEntries.some((entry) => entry && asNumber(entry.ry) !== null)
  const hasUyLoad = loads.some((load) => Math.abs(load.vector.y) > 1e-12)
  const hasUzLoad = loads.some((load) => Math.abs(load.vector.z) > 1e-12)

  if (zSpread > 1 || hasUz || hasRy || hasUzLoad) {
    return 'xz' as const
  }
  if (ySpread > 1 || hasUyLoad) {
    return 'xy' as const
  }
  return 'xy' as const
}

function buildAvailableViews(cases: VisualizationCase[], source: VisualizationSource): VisualizationViewMode[] {
  if (source === 'model') {
    return ['model']
  }
  const hasDisplacements = cases.some((item) =>
    Object.values(item.nodeResults).some((result) => vectorMagnitude([result.displacement?.ux, result.displacement?.uy, result.displacement?.uz]) > 0)
  )
  const hasForces = cases.some((item) =>
    Object.values(item.elementResults).some((result) =>
      [result.axial, result.shear, result.moment, result.torsion].some((value) => typeof value === 'number')
    )
  )
  const hasReactions = cases.some((item) =>
    Object.values(item.nodeResults).some((result) => vectorMagnitude([result.reaction?.fx, result.reaction?.fy, result.reaction?.fz]) > 0)
  )

  return [
    'model',
    ...(hasDisplacements ? (['deformed'] as const) : []),
    ...(hasForces ? (['forces'] as const) : []),
    ...(hasReactions ? (['reactions'] as const) : []),
  ]
}

export function buildVisualizationSnapshot(params: {
  title: string
  model: Record<string, unknown> | null
  analysis?: Record<string, unknown> | null
  mode?: 'model-only' | 'analysis-result'
  statusMessage?: string
}): VisualizationSnapshot | null {
  const model = params.model
  if (!model) {
    return null
  }

  const source: VisualizationSource = params.mode === 'model-only' || !params.analysis ? 'model' : 'result'
  const analysis = asRecord(params.analysis)
  const data = asRecord(analysis?.data) || analysis
  const nodesInput = Array.isArray(model.nodes) ? model.nodes : []
  const elementsInput = Array.isArray(model.elements) ? model.elements : []
  if (!nodesInput.length || !elementsInput.length) {
    return null
  }

  const nodes: VisualizationNode[] = nodesInput
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item.id === 'string'))
    .map((node) => ({
      id: String(node.id),
      position: {
        x: pickNumber(node, ['x']) ?? 0,
        y: pickNumber(node, ['y']) ?? 0,
        z: pickNumber(node, ['z']) ?? 0,
      },
      restraints: Array.isArray(node.restraints) ? node.restraints.filter((value): value is boolean => typeof value === 'boolean') : undefined,
    }))

  const elements: VisualizationElement[] = elementsInput
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item.id === 'string'))
    .map((element) => ({
      id: String(element.id),
      type: typeof element.type === 'string' ? element.type : 'beam',
      nodeIds: Array.isArray(element.nodes) ? element.nodes.filter((value): value is string => typeof value === 'string') : [],
      material: typeof element.material === 'string' ? element.material : undefined,
      section: typeof element.section === 'string' ? element.section : undefined,
    }))
    .filter((element) => element.nodeIds.length >= 2)

  if (!nodes.length || !elements.length) {
    return null
  }

  const baseDisplacements = asRecord(data?.displacements)
  const loads = getLoads(model)
  const cases: VisualizationCase[] = source === 'result'
    ? (() => {
        const baseReactions = asRecord(data?.reactions)
        const baseForces = asRecord(data?.forces)
        const baseEnvelope = asRecord(data?.envelope)
        const baseCase = buildCase('result', 'Result', 'result', baseDisplacements, baseReactions, baseForces, baseEnvelope)
        const nextCases: VisualizationCase[] = [baseCase]

        const caseResults = asRecord(data?.caseResults)
        Object.entries(caseResults || {}).forEach(([caseId, value]) => {
          const entry = asRecord(value)
          if (!entry) {
            return
          }
          nextCases.push(
            buildCase(
              caseId,
              caseId,
              'case',
              asRecord(entry.displacements),
              asRecord(entry.reactions),
              asRecord(entry.forces),
              asRecord(entry.envelope)
            )
          )
        })

        const envelopeTables = asRecord(data?.envelopeTables)
        if (envelopeTables) {
          const envelopeCase = buildCase('envelope', 'Envelope', 'envelope', null, null, null, null)
          applyEnvelopeTables(envelopeCase, envelopeTables)
          nextCases.push(envelopeCase)
        }

        return nextCases
      })()
    : [buildCase('model', 'Model', 'result', null, null, null, null)]

  const unsupportedElementTypes = Array.from(
    new Set(elements.map((element) => element.type).filter((type) => !['beam', 'truss'].includes(type)))
  )
  const dimension = deriveDimension(nodes, baseDisplacements)
  const plane = derivePlane(nodes, baseDisplacements, loads)

  return {
    version: 1,
    title: params.title,
    source,
    dimension,
    plane,
    analysisType: typeof analysis?.analysis_type === 'string' ? analysis.analysis_type : undefined,
    availableViews: buildAvailableViews(cases, source),
    defaultCaseId: cases.find((item) => item.kind === 'result')?.id || cases[0]?.id || (source === 'model' ? 'model' : 'result'),
    nodes,
    elements,
    loads,
    unsupportedElementTypes,
    cases,
    summary: asRecord(data?.summary) || undefined,
    statusMessage: params.statusMessage,
  }
}
