import { describe, expect, test } from '@jest/globals';
import { buildReportDomainArtifacts } from '../../../../dist/agent-skills/report-export/entry.js';

describe('buildReportDomainArtifacts', () => {
  test('accepts options-object with postprocessedResult and codeCheckResult', () => {
    const result = buildReportDomainArtifacts({
      designBasis: { unitSystem: 'SI' },
      normalizedModel: { elements: [] },
      postprocessedResult: { data: { envelope: { maxAbsDisplacement: 12.5 } } },
      codeCheckResult: { summary: { total: 10, passed: 8 } },
    });

    expect(result.keyMetrics).toBeDefined();
    expect(result.clauseTraceability).toBeDefined();
    expect(result.controllingCases).toBeDefined();
    expect(result.visualizationHints).toBeDefined();
  });
});
