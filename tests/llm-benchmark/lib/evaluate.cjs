/**
 * Evaluate a completed AgentState against a scenario's expectations.
 *
 * Supports v2 assertions (type-dispatched) with automatic v1 backward compatibility.
 * Returns a structured result with per-metric pass/fail and an overall score.
 *
 * evaluateScenario is async because natural_language assertions use LLM-as-Judge.
 */

const { extractSkillTrace } = require("./skill-trace.cjs");
const { evaluateNaturalLanguage } = require("./judge.cjs");

const ANALYSIS_RESULT_KEYS = [
  "displacements", "nodeDisplacements", "reactions",
  "nodeReactions", "memberForces", "forces",
];

// ---------------------------------------------------------------------------
// v1 → v2 auto-upgrade
// ---------------------------------------------------------------------------

/**
 * Upgrade a v1 scenario expect object to the v2 assertions array format.
 * v2 format is used when `expect.assertions` is already present.
 *
 * @param {object} expect - scenario.expect
 * @returns {{ assertions: object[] }}
 */
function upgradeExpect(expect) {
  if (Array.isArray(expect.assertions)) {
    return { assertions: expect.assertions };
  }

  // v1 → v2 conversion
  const assertions = [];

  if (expect.structuralType) {
    assertions.push({ type: "structural_type", expected: expect.structuralType });
  }
  if (expect.hasModel) {
    assertions.push({
      type: "has_model",
      minNodes: expect.minNodes ?? 2,
      minElements: expect.minElements ?? 1,
    });
  }
  if (expect.hasAnalysis) {
    assertions.push({ type: "has_analysis" });
  }
  if (expect.hasReport) {
    assertions.push({ type: "has_report" });
  }

  return { assertions };
}

// ---------------------------------------------------------------------------
// Typed assertion evaluators
// ---------------------------------------------------------------------------

function evalStructuralType(assertion, state) {
  const actual = state.structuralTypeKey || null;
  return {
    metric: "structural_type",
    pass: actual === assertion.expected,
    expected: assertion.expected,
    actual: actual || "(none)",
  };
}

function evalHasModel(assertion, state) {
  const model = state.model;
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const elements = Array.isArray(model?.elements) ? model.elements : [];
  const minNodes = assertion.minNodes ?? 2;
  const minElements = assertion.minElements ?? 1;
  return {
    metric: "has_model",
    pass: !!model && nodes.length >= minNodes && elements.length >= minElements,
    expected: `>= ${minNodes} nodes, >= ${minElements} elements`,
    actual: model ? `${nodes.length} nodes, ${elements.length} elements` : "(none)",
  };
}

function hasResultField(obj, names) {
  if (!obj || typeof obj !== "object") return false;
  for (const name of names) {
    const val = obj[name];
    if (!val) continue;
    if (Array.isArray(val) && val.length > 0) return true;
    if (typeof val === "object" && Object.keys(val).length > 0) return true;
  }
  return false;
}

function evalHasAnalysis(_assertion, state) {
  const analysis = state.analysisResult;
  if (!analysis) {
    return {
      metric: "has_analysis",
      pass: false,
      expected: "analysis results present",
      actual: "(none)",
    };
  }
  const pass = hasResultField(analysis, ANALYSIS_RESULT_KEYS) || hasResultField(analysis.data, ANALYSIS_RESULT_KEYS);
  return {
    metric: "has_analysis",
    pass,
    expected: "analysis results with displacements, reactions, or forces",
    actual: pass ? "present" : `keys: ${Object.keys(analysis).join(", ") || "(empty)"}`,
  };
}

function evalHasReport(_assertion, state) {
  const report = state.report;
  const mdLength = typeof report?.markdown === "string" ? report.markdown.length : 0;
  return {
    metric: "has_report",
    pass: mdLength > 100,
    expected: "markdown > 100 chars",
    actual: report ? `${mdLength} chars` : "(none)",
  };
}

function evalSkillMatch(assertion, state) {
  const trace = extractSkillTrace(Array.isArray(state.messages) ? state.messages : []);
  const actual = trace?.skillId || null;
  const primary = assertion.primary;
  const mayAlsoMatch = Array.isArray(assertion.mayAlsoMatch) ? assertion.mayAlsoMatch : [];
  const allowed = primary ? [primary, ...mayAlsoMatch] : mayAlsoMatch;

  // If no allowed skills specified, match any non-null skill
  if (allowed.length === 0) {
    return {
      metric: "skill_match",
      pass: actual !== null,
      expected: "(any skill)",
      actual: actual || "(none)",
    };
  }

  const pass = actual !== null && allowed.includes(actual);
  return {
    metric: "skill_match",
    pass,
    expected: primary ? `${primary}${mayAlsoMatch.length ? ` (or: ${mayAlsoMatch.join(", ")})` : ""}` : "(any)",
    actual: actual || "(none)",
  };
}

function evalHasInteractionQuestions(_assertion, state) {
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const hasQuestions = messages.some((msg) => {
    if (msg.type !== "ai" && msg.role !== "assistant") return false;
    if (Array.isArray(msg.tool_calls)) {
      return msg.tool_calls.some(
        (tc) => tc.name === "ask_user_clarification",
      );
    }
    return false;
  });
  return {
    metric: "has_interaction_questions",
    pass: hasQuestions,
    expected: "agent asks user for missing parameters",
    actual: hasQuestions ? "questions found" : "no questions asked",
  };
}

async function evalNaturalLanguage(assertion, state) {
  const result = await evaluateNaturalLanguage(assertion.description, state);
  const suffix = result.reason ? ` — ${result.reason}` : "";
  return {
    metric: "natural_language",
    pass: result.pass,
    expected: assertion.description,
    actual: result.pass ? "satisfied" : `not satisfied${suffix}`,
  };
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

/**
 * Dispatch a single assertion to its typed evaluator.
 *
 * @param {object} assertion - v2 assertion object
 * @param {object} state - AgentState
 * @returns {Promise<{ metric: string, pass: boolean, expected: string, actual: string }>}
 */
async function dispatchAssertion(assertion, state) {
  switch (assertion.type) {
    case "structural_type":
      return evalStructuralType(assertion, state);
    case "has_model":
      return evalHasModel(assertion, state);
    case "has_analysis":
      return evalHasAnalysis(assertion, state);
    case "has_report":
      return evalHasReport(assertion, state);
    case "skill_match":
      return evalSkillMatch(assertion, state);
    case "has_interaction_questions":
      return evalHasInteractionQuestions(assertion, state);
    case "natural_language":
      return evalNaturalLanguage(assertion, state);
    default:
      return {
        metric: `unknown:${assertion.type || "undefined"}`,
        pass: false,
        expected: "valid assertion type (structural_type, has_model, has_analysis, has_report, skill_match, has_interaction_questions, natural_language)",
        actual: `unsupported type: ${assertion.type || "(undefined)"}`,
      };
  }
}

/**
 * Evaluate a completed AgentState against a scenario's expectations.
 *
 * @param {object} scenario - benchmark scenario (v1 or v2 format)
 * @param {object} state - AgentState returned by service.runFull
 * @param {number} durationMs - elapsed time in milliseconds
 * @returns {Promise<object>} evaluation result
 */
async function evaluateScenario(scenario, state, durationMs) {
  const metrics = [];
  const { assertions } = upgradeExpect(scenario.expect || {});

  for (const assertion of assertions) {
    try {
      metrics.push(await dispatchAssertion(assertion, state));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      metrics.push({
        metric: assertion.type || "unknown",
        pass: false,
        expected: "(assertion ran without error)",
        actual: `error: ${msg}`,
      });
    }
  }

  // Tool call count (informational — always measured)
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
