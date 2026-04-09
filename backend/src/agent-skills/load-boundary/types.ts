import type {
  LocalizedText,
  SkillStage,
  SkillCompatibility,
  AgentAnalysisType,
  MaterialFamily,
} from '../../agent-runtime/types.js';

// Local type definitions for load-boundary skills
// These types are specific to load-boundary module and should not
// depend on agent-runtime types that may be removed or changed
export type LoadBoundaryScenarioKey = 
  | 'beam'
  | 'truss'
  | 'portal-frame'
  | 'double-span-beam'
  | 'frame';

export type LoadBoundarySkillId =
  | 'dead-load'
  | 'live-load'
  | 'wind-load'
  | 'seismic-load'
  | 'snow-load'
  | 'temperature-load'
  | 'crane-load'
  | 'load-combination'
  | 'boundary-condition'
  | 'nodal-constraint';

export interface LoadBoundaryExecutionInput {
  skillId: LoadBoundarySkillId;
  action: string;
  params: Record<string, unknown>;
}

export interface LoadBoundaryExecutionOutput {
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
}

export interface LoadBoundarySkillManifest {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  triggers: string[];
  stages: SkillStage[];
  autoLoadByDefault: boolean;
  scenarioKeys: LoadBoundaryScenarioKey[];
  domain: 'load-boundary';
  version: string;
  requires: string[];
  conflicts: string[];
  capabilities: string[];
  supportedAnalysisTypes?: AgentAnalysisType[];
  materialFamilies?: MaterialFamily[];
  priority: number;
  compatibility: SkillCompatibility;
  supportedModelFamilies?: string[];
  loadTypes?: string[];
  boundaryTypes?: string[];
  combinationTypes?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}
