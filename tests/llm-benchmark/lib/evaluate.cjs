/**
 * Evaluate a completed AgentState against a scenario's expectations.
 *
 * Returns a structured result with per-metric pass/fail and an overall score.
 */
function evaluateScenario(scenario, state, durationMs) {
  const metrics = [];
  const expect = scenario.expect || {};

  // Structural type detection
  if (expect.structuralType) {
    const actual = state.structuralTypeKey || null;
    metrics.push({
      metric: "structuralType",
      pass: actual === expect.structuralType,
      expected: expect.structuralType,
      actual: actual || "(none)",
    });
  }

  // Model building
  if (expect.hasModel) {
    const model = state.model;
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const elements = Array.isArray(model?.elements) ? model.elements : [];
    const minNodes = expect.minNodes ?? 2;
    const minElements = expect.minElements ?? 1;
    metrics.push({
      metric: "model",
      pass: !!model && nodes.length >= minNodes && elements.length >= minElements,
      expected: `>= ${minNodes} nodes, >= ${minElements} elements`,
      actual: model ? `${nodes.length} nodes, ${elements.length} elements` : "(none)",
    });
  }

  // Analysis completion
  if (expect.hasAnalysis) {
    const analysis = state.analysisResult;
    const hasDisplacements = analysis && (
      Array.isArray(analysis.displacements) || Array.isArray(analysis.nodeDisplacements)
    );
    metrics.push({
      metric: "analysis",
      pass: !!analysis && (hasDisplacements || Object.keys(analysis).length > 0),
      expected: "analysis results present",
      actual: analysis ? "present" : "(none)",
    });
  }

  // Report generation
  if (expect.hasReport) {
    const report = state.report;
    const mdLength = typeof report?.markdown === "string" ? report.markdown.length : 0;
    metrics.push({
      metric: "report",
      pass: mdLength > 100,
      expected: "markdown > 100 chars",
      actual: report ? `${mdLength} chars` : "(none)",
    });
  }

  // Tool call count (informational)
  let toolCallCount = 0;
  const messages = Array.isArray(state.messages) ? state.messages : [];
  for (const msg of messages) {
    if (msg && typeof msg === "object" && Array.isArray(msg.tool_calls)) {
      toolCallCount += msg.tool_calls.length;
    }
  }
  metrics.push({
    metric: "toolCalls",
    pass: toolCallCount <= 15,
    expected: "<= 15",
    actual: String(toolCallCount),
  });

  // Duration (informational, always pass)
  metrics.push({
    metric: "duration",
    pass: true,
    expected: "(info)",
    actual: `${(durationMs / 1000).toFixed(1)}s`,
  });

  return {
    scenarioId: scenario.id,
    description: scenario.description || "",
    passed: metrics.filter((m) => m.pass).length,
    total: metrics.length,
    allPassed: metrics.every((m) => m.pass),
    metrics,
    durationMs,
  };
}

module.exports = { evaluateScenario };
