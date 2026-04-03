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
import { normalizeVisualizationSnapshot } from './normalization'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asStringId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function getByPath(source: Record<string, unknown> | null, path: string): unknown {
  if (!source) {
    return null
  }
  const segments = path.split('.')
  let current: unknown = source
  for (const segment of segments) {
    const record = asRecord(current)
    if (!record) {
      return null
    }
    current = record[segment]
  }
  return current
}

function pickNumber(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return null
  for (const key of keys) {
    const value = asNumber(key.includes('.') ? getByPath(source, key) : source[key])
    if (value !== null) {
      return value
    }
  }
  return null
}

function pickNodeCoordinate(node: Record<string, unknown> | null, axis: 'x' | 'y' | 'z') {
  const upper = axis.toUpperCase()
  return pickNumber(node, [
    axis,
    upper,
    `position.${axis}`,
    `position.${upper}`,
    `coord.${axis}`,
    `coord.${upper}`,
    `coords.${axis}`,
    `coords.${upper}`,
  ])
}

function pickElementNodeIds(element: Record<string, unknown> | null): string[] {
  if (!element) {
    return []
  }
  const candidates = [element.nodes, element.nodeIds, element.node_ids]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue
    }
    const normalized = candidate
      .map((value) => asStringId(value))
      .filter((value): value is string => Boolean(value))
    if (normalized.length > 0) {
      return normalized
    }
  }
  return []
}

function vectorMagnitude(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (filtered.length === 0) {
    return 0
  }
  return Math.sqrt(filtered.reduce((sum, value) => sum + value ** 2, 0))
}

function hasSignificantComponent(entries: Array<Record<string, unknown> | null>, key: string, threshold = 1e-12) {
  return entries.some((entry) => {
    if (!entry) {
      return false
    }
    const value = asNumber(entry[key])
    return value !== null && Math.abs(value) > threshold
  })
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
      const nodeId = asStringId(load.node)
      if (nodeId) {
        loads.push({
          nodeId,
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
      const elementId = asStringId(load.element)
      if (elementId) {
        loads.push({
          nodeId: '',
          elementId,
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
  const hasUy = hasSignificantComponent(displacementEntries, 'uy')
  const hasUz = hasSignificantComponent(displacementEntries, 'uz')

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
  const hasUz = hasSignificantComponent(displacementEntries, 'uz')
  const hasRy = hasSignificantComponent(displacementEntries, 'ry')
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

function deriveUnits(model: Record<string, unknown> | null, analysis: Record<string, unknown> | null) {
  const analysisMeta = asRecord(analysis?.meta)
  const unitSystemRaw = asNonEmptyString(model?.unit_system)
    || asNonEmptyString(model?.unitSystem)
    || asNonEmptyString(model?.units)
    || asNonEmptyString(analysisMeta?.unitSystem)
    || asNonEmptyString(analysisMeta?.unit_system)
    || 'SI'
  const unitSystem = unitSystemRaw.toUpperCase()

  if (unitSystem.includes('MM') || unitSystem.includes('NMM') || unitSystem.includes('MM-N')) {
    return {
      unitSystem,
      lengthUnit: 'mm',
      displacementUnit: 'mm',
      displacementDisplayFactor: 1,
      forceUnit: 'N',
      momentUnit: 'N.mm',
      nodalLoadUnit: 'N',
      distributedLoadUnit: 'N/mm',
    }
  }

  if (unitSystem.includes('KN') && unitSystem.includes('M')) {
    return {
      unitSystem,
      lengthUnit: 'm',
      displacementUnit: 'mm',
      displacementDisplayFactor: 1000,
      forceUnit: 'kN',
      momentUnit: 'kN.m',
      nodalLoadUnit: 'kN',
      distributedLoadUnit: 'kN/m',
    }
  }

  return {
    unitSystem,
    lengthUnit: 'm',
    displacementUnit: 'mm',
    displacementDisplayFactor: 1000,
    forceUnit: 'N',
    momentUnit: 'N.m',
    nodalLoadUnit: 'N',
    distributedLoadUnit: 'N/m',
  }
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
  const units = deriveUnits(model, analysis)
  const nodesInput = Array.isArray(model.nodes) ? model.nodes : []
  const elementsInput = Array.isArray(model.elements) ? model.elements : []
  const debugEnabled = process.env.NODE_ENV !== 'production'
  if (!nodesInput.length || !elementsInput.length) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped: model is missing nodes or elements array data.', {
        source,
        nodesInputCount: nodesInput.length,
        elementsInputCount: elementsInput.length,
      })
    }
    return null
  }

  const nodes: VisualizationNode[] = nodesInput
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item && asStringId(item.id)))
    .map((node) => ({
      id: asStringId(node.id) as string,
      position: {
        x: pickNodeCoordinate(node, 'x') ?? 0,
        y: pickNodeCoordinate(node, 'y') ?? 0,
        z: pickNodeCoordinate(node, 'z') ?? 0,
      },
      restraints: Array.isArray(node.restraints) ? node.restraints.filter((value): value is boolean => typeof value === 'boolean') : undefined,
    }))

  const elements: VisualizationElement[] = elementsInput
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item && asStringId(item.id)))
    .map((element) => ({
      id: asStringId(element.id) as string,
      type: typeof element.type === 'string' ? element.type : 'beam',
      nodeIds: pickElementNodeIds(element),
      material: typeof element.material === 'string' ? element.material : undefined,
      section: typeof element.section === 'string' ? element.section : undefined,
    }))
    .filter((element) => element.nodeIds.length >= 2)

  const nodeIdSet = new Set(nodes.map((node) => node.id))
  const elementsWithInvalidNodeRefs = elements.filter(
    (element) => !nodeIdSet.has(element.nodeIds[0]) || !nodeIdSet.has(element.nodeIds[1])
  ).length

  if (debugEnabled) {
    console.info('[Visualization] Snapshot normalization summary:', {
      source,
      nodesInputCount: nodesInput.length,
      nodesNormalizedCount: nodes.length,
      elementsInputCount: elementsInput.length,
      elementsNormalizedCount: elements.length,
      elementsWithInvalidNodeRefs,
    })
  }

  if (!nodes.length || !elements.length) {
    if (debugEnabled) {
      console.warn('[Visualization] Snapshot skipped after normalization because no renderable nodes/elements remain.', {
        source,
        nodesNormalizedCount: nodes.length,
        elementsNormalizedCount: elements.length,
      })
    }
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
    : [buildCase('model', 'Model', 'case', null, null, null, null)]

  const unsupportedElementTypes = Array.from(
    new Set(elements.map((element) => element.type).filter((type) => !['beam', 'truss'].includes(type)))
  )
  const dimension = deriveDimension(nodes, baseDisplacements)
  const plane = derivePlane(nodes, baseDisplacements, loads)

  return normalizeVisualizationSnapshot({
    version: 1,
    title: params.title,
    source,
    dimension,
    plane,
    analysisType: typeof analysis?.analysis_type === 'string' ? analysis.analysis_type : undefined,
    availableViews: buildAvailableViews(cases, source),
    defaultCaseId: cases.find((item) => item.kind === 'result')?.id || cases[0]?.id || (source === 'model' ? 'model' : 'result'),
    unitSystem: units.unitSystem,
    lengthUnit: units.lengthUnit,
    displacementUnit: units.displacementUnit,
    displacementDisplayFactor: units.displacementDisplayFactor,
    nodeLabelUnit: units.lengthUnit,
    resultUnit: units.forceUnit,
    momentUnit: units.momentUnit,
    nodalLoadUnit: units.nodalLoadUnit,
    distributedLoadUnit: units.distributedLoadUnit,
    nodes,
    elements,
    loads,
    unsupportedElementTypes,
    cases,
    summary: asRecord(data?.summary) || undefined,
    statusMessage: params.statusMessage,
  })
}
