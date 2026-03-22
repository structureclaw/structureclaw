export type AnalysisExecutionAction =
  | 'list_engines'
  | 'get_engine'
  | 'check_engine'
  | 'structure_model_schema'
  | 'converter_schema'
  | 'validate'
  | 'convert'
  | 'analyze'
  | 'code_check';

export interface AnalysisExecutionInput {
  action: AnalysisExecutionAction;
  engineId?: string;
  input?: Record<string, unknown>;
}

export interface AnalysisExecutionSuccess<T = unknown> {
  ok: true;
  data: T;
}

export interface AnalysisExecutionFailure {
  ok: false;
  errorCode: string;
  message: string;
  statusCode?: number;
  detail?: unknown;
}

export type AnalysisExecutionResponse<T = unknown> = AnalysisExecutionSuccess<T> | AnalysisExecutionFailure;

export interface LocalAnalysisEngineClient {
  post<T = any>(path: string, payload?: Record<string, unknown>): Promise<{ data: T }>;
  get<T = any>(path: string): Promise<{ data: T }>;
}
