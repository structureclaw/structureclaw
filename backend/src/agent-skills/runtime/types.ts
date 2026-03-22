import type { AppLocale } from '../../services/locale.js';

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
  lateralXKN?: number;
  lateralYKN?: number;
}

export type InferredModelType = 'beam' | 'truss' | 'portal-frame' | 'double-span-beam' | 'frame' | 'unknown';
export type ScenarioTemplateKey =
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
export type ScenarioSupportLevel = 'supported' | 'fallback' | 'unsupported';
export type SkillStage = 'intent' | 'draft' | 'analysis' | 'design';

export interface ScenarioMatch {
  key: ScenarioTemplateKey;
  mappedType: InferredModelType;
  skillId?: string;
  supportLevel: ScenarioSupportLevel;
  supportNote?: string;
}

export interface DraftState {
  inferredType: InferredModelType;
  skillId?: string;
  scenarioKey?: ScenarioTemplateKey;
  supportLevel?: ScenarioSupportLevel;
  supportNote?: string;
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
  scenarioKey?: ScenarioTemplateKey;
  supportLevel?: ScenarioSupportLevel;
  supportNote?: string;
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
  extractionMode: 'llm' | 'rule-based';
  stateToPersist?: DraftState;
  scenario?: ScenarioMatch;
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
  structureType: Exclude<InferredModelType, 'unknown'>;
  name: LocalizedText;
  description: LocalizedText;
  triggers: string[];
  stages: SkillStage[];
  autoLoadByDefault: boolean;
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
  | 'material-constitutive'
  | 'geometry-input'
  | 'load-boundary'
  | 'analysis-strategy'
  | 'code-check'
  | 'result-postprocess'
  | 'visualization'
  | 'report-export'
  | 'generic-fallback';

export interface SkillCompatibility {
  minRuntimeVersion: string;
  skillApiVersion: string;
}

export interface SkillManifest extends AgentSkillMetadata {
  scenarioKeys: ScenarioTemplateKey[];
  domain: SkillDomain;
  requires: string[];
  conflicts: string[];
  capabilities: string[];
  supportedAnalysisTypes?: AgentAnalysisType[];
  materialFamilies?: MaterialFamily[];
  priority: number;
  compatibility: SkillCompatibility;
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
  scenario: ScenarioMatch;
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
  visualizationHints: Record<string, unknown>;
  locale: AppLocale;
}

export interface SkillHandler {
  detectScenario(input: SkillDetectionInput): ScenarioMatch | null;
  parseProvidedValues(values: Record<string, unknown>): DraftExtraction;
  extractDraft(input: SkillDraftContext): DraftExtraction;
  mergeState(existing: DraftState | undefined, patch: DraftExtraction): DraftState;
  computeMissing(state: DraftState, mode: 'chat' | 'execute'): SkillMissingResult;
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

export interface SkillExecutionResult {
  detectedScenario?: ScenarioTemplateKey;
  inferredType?: InferredModelType;
  draftPatch?: DraftExtraction;
  missingCritical?: string[];
  missingOptional?: string[];
  questions?: InteractionQuestion[];
  defaultProposals?: Array<{ paramKey: string; value: unknown; reason: string }>;
  stage?: 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';
  supportLevel?: ScenarioSupportLevel;
  supportNote?: string;
}

export interface AgentSkillExecutorInput {
  message: string;
  locale: AppLocale;
  existingState?: DraftState;
  selectedSkill: AgentSkillPlugin;
}
