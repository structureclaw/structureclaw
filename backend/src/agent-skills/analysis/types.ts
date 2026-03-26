import type { AgentAnalysisType, LocalizedText } from '../../agent-runtime/types.js';

export type AnalysisExecutionAction =
  | 'list_engines'
  | 'get_engine'
  | 'check_engine'
  | 'analyze';

export interface AnalysisExecutionInput {
  action: AnalysisExecutionAction;
  engineId?: string;
  input?: Record<string, unknown>;
}

export interface LocalAnalysisEngineClient {
  post<T = any>(path: string, payload?: Record<string, unknown>): Promise<{ data: T }>;
  get<T = any>(path: string): Promise<{ data: T }>;
}

export type BuiltInAnalysisEngineId = 'builtin-opensees' | 'builtin-simplified';
export type AnalysisRuntimeAdapterKey = BuiltInAnalysisEngineId;
export type AnalysisSoftware = 'opensees' | 'simplified';
export type AnalysisModelFamily = 'frame' | 'truss' | 'generic';

export interface AnalysisSkillManifest {
  id: string;
  domain: 'analysis-strategy';
  name: LocalizedText;
  description: LocalizedText;
  software: AnalysisSoftware;
  analysisType: AgentAnalysisType;
  engineId: BuiltInAnalysisEngineId;
  adapterKey: AnalysisRuntimeAdapterKey;
  triggers: string[];
  stages: ['analysis'];
  capabilities: string[];
  supportedModelFamilies: AnalysisModelFamily[];
  priority: number;
  autoLoadByDefault: boolean;
  runtimeRelativePath: string;
}

export interface AnalysisEngineDefinition {
  id: BuiltInAnalysisEngineId;
  name: string;
  adapterKey: AnalysisRuntimeAdapterKey;
  capabilities: string[];
  supportedAnalysisTypes: AgentAnalysisType[];
  supportedModelFamilies: AnalysisModelFamily[];
  priority: number;
  routingHints: string[];
  constraints: Record<string, unknown>;
  skillIds: string[];
}
