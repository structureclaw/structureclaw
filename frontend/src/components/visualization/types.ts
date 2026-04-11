export type VisualizationViewMode = 'model' | 'deformed' | 'forces' | 'reactions'
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
}
