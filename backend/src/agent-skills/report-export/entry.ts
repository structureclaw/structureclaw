import {
  extractClauseTraceability,
  extractControllingCases,
  extractKeyMetrics,
} from '../result-postprocess/entry.js';
import { extractVisualizationHints } from '../visualization/entry.js';
import type { VisualizationHints } from '../../agent-runtime/types.js';

export function buildReportDomainArtifacts(options: {
  designBasis?: unknown;
  normalizedModel?: unknown;
  postprocessedResult?: unknown;
  codeCheckResult?: unknown;
}): {
  keyMetrics: Record<string, unknown>;
  clauseTraceability: Array<Record<string, unknown>>;
  controllingCases: Record<string, unknown>;
  visualizationHints: VisualizationHints;
} {
  return {
    keyMetrics: extractKeyMetrics(options.postprocessedResult, options.codeCheckResult),
    clauseTraceability: extractClauseTraceability(options.codeCheckResult),
    controllingCases: extractControllingCases(options.postprocessedResult),
    visualizationHints: extractVisualizationHints(options.postprocessedResult),
  };
}
