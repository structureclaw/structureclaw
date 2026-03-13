import type { AppLocale } from '../locale.js';

export type DraftLoadType = 'point' | 'distributed';
export type DraftLoadPosition = 'end' | 'midspan' | 'full-span' | 'top-nodes' | 'middle-joint' | 'free-joint';
export type DraftSupportType = 'cantilever' | 'simply-supported' | 'fixed-fixed' | 'fixed-pinned';
export type FrameDimension = '2d' | '3d';
export type FrameBaseSupportType = 'fixed' | 'pinned';

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
  supportLevel: ScenarioSupportLevel;
  supportNote?: string;
}

export interface DraftState {
  inferredType: InferredModelType;
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
  updatedAt: number;
}

export interface DraftExtraction {
  inferredType?: InferredModelType;
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
}

export interface DraftResult {
  inferredType: InferredModelType;
  missingFields: string[];
  model?: Record<string, unknown>;
  extractionMode: 'llm' | 'rule-based';
  stateToPersist?: DraftState;
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
  enabledSkills: AgentSkillBundle[];
}
