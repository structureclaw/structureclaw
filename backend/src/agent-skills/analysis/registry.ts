import type { AnalysisExecutionAction } from './types.js';

export const BUILTIN_ANALYSIS_ENGINE_IDS = ['builtin-opensees', 'builtin-simplified'] as const;

export const LOCAL_GET_ACTION_BY_PATH: Record<string, AnalysisExecutionAction> = {
  '/engines': 'list_engines',
};

export const LOCAL_POST_ACTION_BY_PATH: Record<string, AnalysisExecutionAction> = {
  '/analyze': 'analyze',
};
