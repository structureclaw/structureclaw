import {
  extractClauseTraceability,
  extractControllingCases,
  extractKeyMetrics,
} from '../result-postprocess/entry.js';
import { extractVisualizationHints } from '../visualization/entry.js';

export function buildReportDomainArtifacts(analysis: unknown, codeCheck?: unknown): {
  keyMetrics: Record<string, unknown>;
  clauseTraceability: Array<Record<string, unknown>>;
  controllingCases: Record<string, unknown>;
  visualizationHints: Record<string, unknown>;
} {
  return {
    keyMetrics: extractKeyMetrics(analysis, codeCheck),
    clauseTraceability: extractClauseTraceability(codeCheck),
    controllingCases: extractControllingCases(analysis),
    visualizationHints: extractVisualizationHints(analysis),
  };
}
