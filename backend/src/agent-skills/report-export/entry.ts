import {
  extractClauseTraceability,
  extractControllingCases,
  extractKeyMetrics,
  type PostprocessedResultArtifact,
} from '../result-postprocess/entry.js';
import { extractVisualizationHints } from '../visualization/entry.js';
import type { VisualizationHints } from '../../agent-runtime/types.js';

function isPostprocessedResultArtifact(value: unknown): value is PostprocessedResultArtifact {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['keyMetrics'] === 'object' && record['keyMetrics'] !== null
    && typeof record['controllingCases'] === 'object' && record['controllingCases'] !== null;
}

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
  const pp = options.postprocessedResult;
  if (isPostprocessedResultArtifact(pp)) {
    return {
      keyMetrics: pp.keyMetrics,
      clauseTraceability: pp.clauseTraceability,
      controllingCases: pp.controllingCases,
      visualizationHints: { hasEnvelope: false },
    };
  }
  return {
    keyMetrics: extractKeyMetrics(pp, options.codeCheckResult),
    clauseTraceability: extractClauseTraceability(options.codeCheckResult),
    controllingCases: extractControllingCases(pp),
    visualizationHints: extractVisualizationHints(pp),
  };
}
