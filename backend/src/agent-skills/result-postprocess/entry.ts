export function extractKeyMetrics(analysis: unknown, codeCheck: unknown): Record<string, unknown> {
  const analysisPayload = analysis && typeof analysis === 'object' ? analysis as Record<string, unknown> : {};
  const analysisData = analysisPayload['data'];
  const analysisDataObject = analysisData && typeof analysisData === 'object' ? analysisData as Record<string, unknown> : {};
  const envelope = analysisDataObject['envelope'];
  const envelopeObject = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {};

  const codeCheckPayload = codeCheck && typeof codeCheck === 'object' ? codeCheck as Record<string, unknown> : {};
  const codeCheckSummary = codeCheckPayload['summary'];
  const codeCheckSummaryObject = codeCheckSummary && typeof codeCheckSummary === 'object'
    ? codeCheckSummary as Record<string, unknown>
    : {};
  const total = Number(codeCheckSummaryObject['total'] ?? 0);
  const passed = Number(codeCheckSummaryObject['passed'] ?? 0);

  return {
    maxAbsDisplacement: envelopeObject['maxAbsDisplacement'] ?? null,
    maxAbsAxialForce: envelopeObject['maxAbsAxialForce'] ?? null,
    maxAbsShearForce: envelopeObject['maxAbsShearForce'] ?? null,
    maxAbsMoment: envelopeObject['maxAbsMoment'] ?? null,
    maxAbsReaction: envelopeObject['maxAbsReaction'] ?? null,
    codeCheckPassRate: total > 0 ? Number((passed / total).toFixed(4)) : null,
  };
}

export function extractClauseTraceability(codeCheck: unknown): Array<Record<string, unknown>> {
  const codeCheckPayload = codeCheck && typeof codeCheck === 'object' ? codeCheck as Record<string, unknown> : {};
  const details = codeCheckPayload['details'];
  if (!Array.isArray(details)) {
    return [];
  }

  const traceRows: Array<Record<string, unknown>> = [];
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') {
      continue;
    }
    const detailObject = detail as Record<string, unknown>;
    const elementId = detailObject['elementId'];
    const checks = detailObject['checks'];
    if (!Array.isArray(checks)) {
      continue;
    }
    for (const check of checks) {
      if (!check || typeof check !== 'object') {
        continue;
      }
      const checkObject = check as Record<string, unknown>;
      const checkName = checkObject['name'];
      const items = checkObject['items'];
      if (!Array.isArray(items)) {
        continue;
      }
      for (const item of items) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const itemObject = item as Record<string, unknown>;
        traceRows.push({
          elementId: typeof elementId === 'string' ? elementId : 'unknown',
          check: typeof checkName === 'string' ? checkName : 'unknown',
          item: typeof itemObject['item'] === 'string' ? itemObject['item'] : 'unknown',
          clause: typeof itemObject['clause'] === 'string' ? itemObject['clause'] : '',
          formula: typeof itemObject['formula'] === 'string' ? itemObject['formula'] : '',
          utilization: itemObject['utilization'] ?? null,
          status: typeof itemObject['status'] === 'string' ? itemObject['status'] : 'unknown',
        });
      }
    }
  }

  return traceRows.slice(0, 20);
}

export function extractControllingCases(analysis: unknown): Record<string, unknown> {
  const analysisPayload = analysis && typeof analysis === 'object' ? analysis as Record<string, unknown> : {};
  const analysisData = analysisPayload['data'];
  const analysisDataObject = analysisData && typeof analysisData === 'object' ? analysisData as Record<string, unknown> : {};
  const envelope = analysisDataObject['envelope'];
  const envelopeObject = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {};

  const controlCase = envelopeObject['controlCase'];
  const batchControlCase = controlCase && typeof controlCase === 'object' ? controlCase as Record<string, unknown> : {};

  return {
    batchControlCase,
    controlNodeDisplacement: envelopeObject['controlNodeDisplacement'] ?? null,
    controlElementAxialForce: envelopeObject['controlElementAxialForce'] ?? null,
    controlElementShearForce: envelopeObject['controlElementShearForce'] ?? null,
    controlElementMoment: envelopeObject['controlElementMoment'] ?? null,
    controlNodeReaction: envelopeObject['controlNodeReaction'] ?? null,
  };
}
