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
