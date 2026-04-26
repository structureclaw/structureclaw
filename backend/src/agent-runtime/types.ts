import type { AppLocale } from '../services/locale.js';

// 导出荷载与边界条件专用类型
export * from './load-boundary-types.js';

export type DraftLoadType = 'point' | 'distributed';
export type DraftLoadPosition = 'end' | 'midspan' | 'full-span' | 'top-nodes' | 'middle-joint' | 'free-joint';
export type DraftSupportType = 'cantilever' | 'simply-supported' | 'fixed-fixed' | 'fixed-pinned';
export type FrameDimension = '2d' | '3d';
export type FrameBaseSupportType = 'fixed' | 'pinned';
export type AgentAnalysisType = 'static' | 'dynamic' | 'seismic' | 'nonlinear';
export type MaterialFamily = 'steel' | 'concrete' | 'composite' | 'timber' | 'masonry' | 'generic';

export interface DraftFloorLoad {
  story: number;
  verticalKN?: number;
  liveLoadKN?: number;
  lateralXKN?: number;
  lateralYKN?: number;
}

export type InferredModelType = 'beam' | 'truss' | 'portal-frame' | 'double-span-beam' | 'frame' | 'unknown';
export type StructuralTypeKey =
  | 'beam'
  | 'truss'
  | 'portal-frame'
  | 'double-span-beam'
  | 'frame'
  | 'steel-frame'
  | 'portal'
  | 'girder'
  | 'space-frame'
  | 'plate-slab'
  | 'shell'
  | 'tower'
  | 'bridge'
  | 'unknown';
export type StructuralTypeSupportLevel = 'supported' | 'fallback' | 'unsupported';
export type SkillStage = 'intent' | 'draft' | 'analysis' | 'design';

export interface StructuralTypeMatch {
  key: StructuralTypeKey;
  mappedType: InferredModelType;
  skillId?: string;
  supportLevel: StructuralTypeSupportLevel;
  supportNote?: string;
}

export interface DraftState {
  inferredType: InferredModelType;
  skillId?: string;
  structuralTypeKey?: StructuralTypeKey;
  supportLevel?: StructuralTypeSupportLevel;
  supportNote?: string;
  coordinateSemantics?: string;
  skillState?: Record<string, unknown>;
  lengthM?: number;
  spanLengthM?: number;
  heightM?: number;
  supportType?: DraftSupportType;
  frameDimension?: FrameDimension;
  storyCount?: number;
  bayCount?: number;
  bayCountX?: number;
  bayCountY?: number;
  storyHeightsM?: number[];
  bayWidthsM?: number[];
  bayWidthsXM?: number[];
  bayWidthsYM?: number[];
  floorLoads?: DraftFloorLoad[];
  frameBaseSupportType?: FrameBaseSupportType;
  loadKN?: number;
  loadType?: DraftLoadType;
  loadPosition?: DraftLoadPosition;
  loadPositionM?: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface DraftExtraction {
  inferredType?: InferredModelType;
  skillId?: string;
  structuralTypeKey?: StructuralTypeKey;
  supportLevel?: StructuralTypeSupportLevel;
  supportNote?: string;
  coordinateSemantics?: string;
  skillState?: Record<string, unknown>;
  lengthM?: number;
  spanLengthM?: number;
  heightM?: number;
  supportType?: DraftSupportType;
  frameDimension?: FrameDimension;
  storyCount?: number;
  bayCount?: number;
  bayCountX?: number;
  bayCountY?: number;
  storyHeightsM?: number[];
  bayWidthsM?: number[];
  bayWidthsXM?: number[];
  bayWidthsYM?: number[];
  floorLoads?: DraftFloorLoad[];
  frameBaseSupportType?: FrameBaseSupportType;
  loadKN?: number;
  loadType?: DraftLoadType;
  loadPosition?: DraftLoadPosition;
  loadPositionM?: number;
  [key: string]: unknown;
}

export interface DraftResult {
  inferredType: InferredModelType;
  missingFields: string[];
  model?: Record<string, unknown>;
  extractionMode: 'llm' | 'deterministic';
  stateToPersist?: DraftState;
  structuralTypeMatch?: StructuralTypeMatch;
}

export interface DraftParameterExtractionResult {
  nextState: DraftState;
  missing: { critical: string[]; optional: string[] };
  structuralTypeMatch: StructuralTypeMatch;
  plugin: AgentSkillPlugin | undefined;
  extractionMode: 'llm' | 'deterministic';
}

export interface InteractionQuestion {
  paramKey: string;
  label: string;
  question: string;
  unit?: string;
  required: boolean;
  critical: boolean;
  suggestedValue?: unknown;
}

export interface LocalizedText {
  zh: string;
  en: string;
}

export interface AgentSkillMetadata {
  id: string;
  structureType: InferredModelType;
  name: LocalizedText;
  description: LocalizedText;
  triggers: string[];
  stages: SkillStage[];
  domain?: SkillDomain;
}

export interface AgentSkillFile extends AgentSkillMetadata {
  stage: SkillStage;
  markdown: string;
}

export interface AgentSkillBundle extends AgentSkillMetadata {
  markdownByStage: Partial<Record<SkillStage, string>>;
}

export type SkillDomain =
  | 'structure-type'
  | 'analysis'
  | 'code-check'
  | 'data-input'
  | 'design'
  | 'drawing'
  | 'general'
  | 'load-boundary'
  | 'material'
  | 'result-postprocess'
  | 'report-export'
  | 'section'
  | 'validation'
  | 'visualization';

export type SkillRuntimeStatus = 'active' | 'partial' | 'discoverable' | 'reserved';

export const ALL_SKILL_DOMAINS: SkillDomain[] = [
  'structure-type',
  'analysis',
  'code-check',
  'data-input',
  'design',
  'drawing',
  'general',
  'load-boundary',
  'material',
  'report-export',
  'result-postprocess',
  'section',
  'validation',
  'visualization',
];

export interface SkillCompatibility {
  minRuntimeVersion: string;
  skillApiVersion: string;
}

export interface SkillManifest extends AgentSkillMetadata {
  structuralTypeKeys: StructuralTypeKey[];
  domain: SkillDomain;
  requires: string[];
  conflicts: string[];
  capabilities: string[];
  supportedAnalysisTypes?: AgentAnalysisType[];
  supportedModelFamilies?: string[];
  materialFamilies?: MaterialFamily[];
  priority: number;
  compatibility: SkillCompatibility;
  runtimeContract?: SkillRuntimeContract;
}

export interface SkillDetectionInput {
  message: string;
  locale: AppLocale;
  currentState?: DraftState;
}

export interface SkillDraftContext {
  message: string;
  locale: AppLocale;
  currentState?: DraftState;
  llmDraftPatch?: Record<string, unknown> | null;
  structuralTypeMatch: StructuralTypeMatch;
}

export interface SkillMissingResult {
  critical: string[];
  optional: string[];
}

export interface SkillDefaultProposal {
  paramKey: string;
  value: unknown;
  reason: string;
}

export interface SkillReportNarrativeInput {
  message: string;
  analysisType: AgentAnalysisType;
  analysisSuccess: boolean;
  codeCheckText: string;
  summary: string;
  keyMetrics: Record<string, unknown>;
  clauseTraceability: Array<Record<string, unknown>>;
  controllingCases: Record<string, unknown>;
  visualizationHints: VisualizationHints;
  locale: AppLocale;
}

export interface SkillHandler {
  detectStructuralType(input: SkillDetectionInput): StructuralTypeMatch | null;
  parseProvidedValues(values: Record<string, unknown>): DraftExtraction;
  extractDraft(input: SkillDraftContext): DraftExtraction;
  mergeState(existing: DraftState | undefined, patch: DraftExtraction): DraftState;
  computeMissing(state: DraftState, phase: 'interactive' | 'execution'): SkillMissingResult;
  mapLabels(keys: string[], locale: AppLocale): string[];
  buildQuestions(keys: string[], criticalMissing: string[], state: DraftState, locale: AppLocale): InteractionQuestion[];
  buildDefaultProposals?(keys: string[], state: DraftState, locale: AppLocale): SkillDefaultProposal[];
  buildReportNarrative?(input: SkillReportNarrativeInput): string;
  buildModel(state: DraftState): Record<string, unknown> | undefined;
  resolveStage?(missingKeys: string[], state: DraftState): 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';
}

export interface AgentSkillPlugin extends AgentSkillBundle {
  manifest: SkillManifest;
  handler: SkillHandler;
}

export interface AgentSkillExecutorInput {
  message: string;
  locale: AppLocale;
  existingState?: DraftState;
  selectedSkill: AgentSkillPlugin;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Visualization hint types (used by extractVisualizationHints in entry.ts)
// ---------------------------------------------------------------------------

/** 6-DOF force/moment vector at a connection node. */
export interface ForceVector6 {
  Fx: number;
  Fy: number;
  Fz: number;
  Mx: number;
  My: number;
  Mz: number;
}

/** A single linear buckling mode (eigenvalue + normalised mode shape). */
export interface BucklingMode {
  /** Buckling factor λ (critical load multiplier). */
  lambda: number;
  /** Normalised displacement vector per node: nodeId → [dx, dy, dz]. */
  modeShape: Record<string, [number, number, number]>;
}

/**
 * Structured visualization hints extracted from analysis results.
 * Consumed by the frontend Three.js renderer and Plotly chart component.
 */
export interface VisualizationHints {
  // ── existing envelope fields ─────────────────────────────────────────────
  /** Name of the governing load case (envelope). */
  controlCase?: string | null;
  /** Maximum nodal displacement in the governing case (mm). */
  controlNodeDisplacement?: number | null;
  /** Maximum element moment in the governing case (kN·m). */
  controlElementMoment?: number | null;
  /** Whether envelope data is present in the analysis result. */
  hasEnvelope?: boolean;

  // ── steel member stress / utilization ────────────────────────────────────
  /**
   * Per-member utilization ratio map.
   * Key: member/element ID (string).
   * Value: utilization ratio (0 = 0%, 1.0 = 100%, >1 = overstressed).
   */
  memberUtilizationMap?: Record<string, number> | null;

  // ── steel connection detail ───────────────────────────────────────────────
  /**
   * Per-node connection force demand map.
   * Key: node ID (string).
   * Value: 6-DOF force vector (kN / kN·m).
   */
  connectionForceMap?: Record<string, ForceVector6> | null;

  // ── buckling modes ────────────────────────────────────────────────────────
  /**
   * Linear buckling (eigenvalue) mode shapes, ordered by λ ascending.
   * Only present when the analysis solver outputs buckling eigenvalues.
   */
  bucklingModes?: BucklingMode[] | null;

  // ── plotly chart spec ─────────────────────────────────────────────────────
  /**
   * Plotly Figure JSON configuration.
   * Populated by the agent when interactive chart output is requested.
   * Schema: https://plotly.com/javascript/reference/
   */
  plotlyChartSpec?: unknown | null;
}

// ---------------------------------------------------------------------------
// Scheduler runtime contract types
// ---------------------------------------------------------------------------

// --- Artifact kinds ---

export type ArtifactKind =
  | 'draftState'
  | 'designBasis'
  | 'normalizedModel'
  | 'analysisModel'
  | 'analysisRaw'
  | 'postprocessedResult'
  | 'codeCheckResult'
  | 'drawingArtifact'
  | 'reportArtifact';

export type ProjectArtifactKind = Exclude<ArtifactKind, 'draftState'>;

// --- Artifact references and envelope ---

export interface ArtifactRef {
  kind: ArtifactKind;
  artifactId: string;
  revision: number;
}

export type ArtifactScope = 'session' | 'project' | 'deliverable';
export type ArtifactStatus = 'draft' | 'ready' | 'stale' | 'blocked' | 'failed';

export interface ArtifactProvenance {
  toolId?: string;
  toolVersion?: string;
  skillContractVersion?: string;
  warnings?: string[];
}

export interface ArtifactEnvelope<T = unknown> {
  artifactId: string;
  kind: ArtifactKind;
  scope: ArtifactScope;
  status: ArtifactStatus;
  revision: number;
  producerSkillId?: string;
  providerSkillId?: string;
  runId?: string;
  createdAt: number;
  updatedAt: number;
  basedOn: ArtifactRef[];
  dependencyFingerprint: string;
  schemaVersion: string;
  provenance: ArtifactProvenance;
  payload: T;
}

// --- Patch record (type only; reducer logic is follow-up) ---

export type PatchKind = 'modelPatch' | 'designPatch';
export type PatchStatus = 'proposed' | 'accepted' | 'rejected' | 'conflicted';
export type PatchMergeStrategy = 'merge' | 'replace' | 'append';

export interface ModelPatchRecord {
  patchId: string;
  patchKind: PatchKind;
  producerSkillId: string;
  baseModelRevision: number;
  basedOn: ArtifactRef[];
  status: PatchStatus;
  acceptedBy?: 'user' | 'policy' | 'system';
  priority: number;
  mergeStrategy?: PatchMergeStrategy;
  conflicts?: Array<{ path: string; withPatchId: string }>;
  createdAt: number;
  reason: string;
  payload: Record<string, unknown>;
}

// --- Project execution policy ---

export interface AutoDesignIterationPolicy {
  enabled: boolean;
  maxIterations: number;
  acceptanceCriteria: string[];
  allowedDomains: string[];
}

export interface AgentExecutionPolicy {
  analysisType?: AgentAnalysisType;
  designCode?: string;
  analysisProviderPreference?: string;
  codeCheckProviderPreference?: string;
  allowAsync?: boolean;
  autoDesignIterationPolicy?: AutoDesignIterationPolicy;
  requireApprovalBeforeExecution?: boolean;
  deliverableProfiles?: {
    drawing?: string;
    report?: string;
  };
}

export interface RequestExecutionOverrides {
  forceRecompute?: boolean;
  analysisType?: AgentAnalysisType;
  designCode?: string;
  allowAsync?: boolean;
  autoDesignIterationEnabled?: boolean;
  deliverableProfiles?: {
    drawing?: string;
    report?: string;
  };
}

// --- Provider binding ---

export interface ProviderBindingState {
  analysisProviderSkillId?: string;
  codeCheckProviderSkillId?: string;
  validationSkillId?: string;
  postprocessSkillId?: string;
  reportSkillId?: string;
  drawingSkillId?: string;
}

// --- Runtime contract (all role variants) ---

export interface ProviderRuntimeContract {
  role: 'provider';
  providerSlot: 'analysisProvider' | 'codeCheckProvider';
  selectionPolicy?: 'optional' | 'explicit_required';
  cardinality?: 'singleton';
  consumes?: ArtifactKind[];
  provides?: ArtifactKind[];
  runtimeAdapter?: string;
  supportedAnalysisTypes?: string[];
  supportedModelFamilies?: string[];
}

export interface DesignerRuntimeContract {
  role: 'designer';
  selectionPolicy?: 'optional' | 'explicit_required';
  consumes?: ArtifactKind[];
  providesPatches?: string[];
  requiresUserAcceptance?: boolean;
  autoIteration?: {
    supported: boolean;
    defaultEnabled: boolean;
  };
}

export interface ConsumerRuntimeContract {
  role: 'consumer';
  targetArtifact?: ArtifactKind;
  deliverableProfileKey?: string;
  /** Specific artifacts that must be present before the consumer can execute. */
  requiredConsumes?: ArtifactKind[];
  /** Artifacts that improve output quality but are not strictly required. */
  optionalConsumes?: ArtifactKind[];
  /**
   * Derived: union of requiredConsumes + optionalConsumes.
   * Do not set independently — this is computed from the above two fields.
   */
  consumes?: ArtifactKind[];
  provides?: ArtifactKind[];
}

export interface TransformerRuntimeContract {
  role: 'transformer';
  consumes?: ArtifactKind[];
  provides?: ArtifactKind[];
}

export interface BaseRuntimeContract {
  role: 'entry' | 'enricher' | 'validator' | 'assistant';
  selectionPolicy?: 'optional' | 'explicit_required';
  consumes?: ArtifactKind[];
  provides?: ArtifactKind[];
}

export type SkillRuntimeContract =
  | ProviderRuntimeContract
  | DesignerRuntimeContract
  | ConsumerRuntimeContract
  | TransformerRuntimeContract
  | BaseRuntimeContract;

// --- Pipeline state ---

export interface AgentArtifactState {
  designBasis?: ArtifactEnvelope;
  normalizedModel?: ArtifactEnvelope;
  analysisModel?: ArtifactEnvelope;
  analysisRaw?: ArtifactEnvelope;
  postprocessedResult?: ArtifactEnvelope;
  codeCheckResult?: ArtifactEnvelope;
  drawingArtifact?: ArtifactEnvelope;
  reportArtifact?: ArtifactEnvelope;
}

export interface ConversationPipelineState {
  policy: AgentExecutionPolicy;
  bindings: ProviderBindingState;
  artifacts: AgentArtifactState;
  patches?: ModelPatchRecord[];
  updatedAt: number;
}
