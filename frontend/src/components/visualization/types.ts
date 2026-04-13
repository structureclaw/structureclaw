export type VisualizationBaseViewMode = 'model' | 'deformed' | 'forces' | 'reactions'
export type VisualizationExtensionViewMode = 'utilization' | 'buckling' | `extension:${string}`
export type VisualizationViewMode = VisualizationBaseViewMode | VisualizationExtensionViewMode

export type VisualizationExtensionId = 'builtin.utilization' | 'builtin.buckling' | `builtin.${string}` | `skillhub.${string}`

export type BucklingMode = {
  /** Buckling load factor (λ) */
  lambda: number
  /** Node id → [dx, dy, dz] normalized mode shape displacement */
  modeShape: Record<string, [number, number, number]>
}
export type VisualizationExtensionEntry<TData = unknown> = {
  id: VisualizationExtensionId
  available: boolean
  sourceSkillId?: string
  data: TData
}

export type VisualizationExtensionMap = Partial<Record<VisualizationExtensionId, VisualizationExtensionEntry>>

export type VisualizationSource = 'model' | 'result'
export type VisualizationPlane = 'xy' | 'xz' | 'yz'

export type VisualizationVector3 = {
  x: number
  y: number
  z: number
}

export type VisualizationNodeResults = {
  displacement?: Partial<Record<'ux' | 'uy' | 'uz' | 'rx' | 'ry' | 'rz', number>>
  reaction?: Partial<Record<'fx' | 'fy' | 'fz' | 'mx' | 'my' | 'mz', number>>
  envelope?: Partial<Record<'maxAbsDisplacement' | 'maxAbsReaction' | 'controlCase' | 'controlCaseReaction', number | string>>
}

export type VisualizationElementResults = {
  axial?: number
  shear?: number
  moment?: number
  torsion?: number
  endForces?: Record<string, number>
  envelope?: Partial<Record<'maxAbsAxialForce' | 'maxAbsShearForce' | 'maxAbsMoment', number | string>>
  controlCases?: Partial<Record<'axial' | 'shear' | 'moment', string>>
  /** Steel member utilization ratio (0 = 0%, 1.0 = 100%, >1 = overstressed). */
  utilization?: number
}

export type VisualizationNode = {
  id: string
  position: VisualizationVector3
  restraints?: boolean[]
}

export type VisualizationElement = {
  id: string
  type: string
  nodeIds: string[]
  material?: string
  section?: string
}

export type VisualizationLoad = {
  nodeId: string
  vector: VisualizationVector3
  caseId?: string
  elementId?: string
  kind?: 'nodal' | 'distributed'
}

export type VisualizationCase = {
  id: string
  label: string
  kind: 'result' | 'case' | 'envelope'
  nodeResults: Record<string, VisualizationNodeResults>
  elementResults: Record<string, VisualizationElementResults>
}

export type VisualizationSnapshot = {
  version: 1
  title: string
  source: VisualizationSource
  dimension: 2 | 3
  plane: VisualizationPlane
  coordinateSemantics?: string
  analysisType?: string
  availableViews: VisualizationViewMode[]
  defaultCaseId: string
  unitSystem?: string
  lengthUnit?: string
  displacementUnit?: string
  displacementDisplayFactor?: number
  nodeLabelUnit?: string
  resultUnit?: string
  momentUnit?: string
  nodalLoadUnit?: string
  distributedLoadUnit?: string
  nodes: VisualizationNode[]
  elements: VisualizationElement[]
  loads: VisualizationLoad[]
  unsupportedElementTypes: string[]
  cases: VisualizationCase[]
  summary?: Record<string, unknown>
  statusMessage?: string
  extensions?: VisualizationExtensionMap
  /** Buckling modes from linear buckling analysis, sorted by λ ascending. */
  bucklingModes?: BucklingMode[]
}
