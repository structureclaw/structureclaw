const {
  assert,
  assertToolCalls,
  applyCriticalMissingAssertions,
} = require("./assertions.js");

function resolveLocale(locale) {
  return locale === "zh" ? "zh" : "en";
}

function resolveCaseExpect(testCase = {}) {
  if (testCase.expect && typeof testCase.expect === "object") {
    return testCase.expect;
  }
  if (testCase.assertions && typeof testCase.assertions === "object") {
    return testCase.assertions;
  }
  return {};
}

function shouldEnableAutoCodeCheck(expected = {}) {
  if (typeof expected.autoCodeCheck === "boolean") {
    return expected.autoCodeCheck;
  }

  return Array.isArray(expected.toolCalls) && expected.toolCalls.includes("run_code_check");
}

function attachExecutionResult(error, key, result) {
  if (error && typeof error === "object" && !Object.prototype.hasOwnProperty.call(error, key)) {
    error[key] = result;
  }
  return error;
}

async function runRoutingTest(runtime, testCase) {
  const locale = resolveLocale(testCase.locale);
  const message = testCase.messages[0];
  const match = await runtime.detectStructuralType(message, locale, undefined, testCase.enabledSkillIds);
  const expected = resolveCaseExpect(testCase);

  if (expected.inferredType) {
    const actualKey = match.mappedType || match.key;
    assert(
      actualKey === expected.inferredType || match.skillId === expected.inferredType,
      `expected inferredType="${expected.inferredType}", got key="${match.key}" mappedType="${match.mappedType}" skillId="${match.skillId}"`
    );
  }
  if (expected.structuralTypeKey) {
    assert(
      match.key === expected.structuralTypeKey || match.mappedType === expected.structuralTypeKey,
      `expected structuralTypeKey="${expected.structuralTypeKey}", got key="${match.key}" mappedType="${match.mappedType}"`
    );
  }
}

async function runExtractionTest(runtime, llm, testCase) {
  const locale = resolveLocale(testCase.locale);
  const message = testCase.messages[0];
  const expected = resolveCaseExpect(testCase);

  const result = await runtime.textToModelDraft(llm, message, undefined, locale, testCase.enabledSkillIds);

  if (expected.inferredType) {
    assert(
      result.inferredType === expected.inferredType,
      `expected inferredType="${expected.inferredType}", got "${result.inferredType}"`
    );
  }

  if (
    expected.criticalMissing !== undefined
    || expected.criticalMissingIncludes
    || expected.criticalMissingNotIncludes
  ) {
    applyCriticalMissingAssertions(result.missingFields || [], expected);
  }

  if (expected.draftPatch) {
    try {
      assertDraftPatch(result.stateToPersist || {}, expected.draftPatch);
    } catch (error) {
      throw attachExecutionResult(error, "draftResult", result);
    }
  }

  return result;
}

function assertDraftPatch(state, expectedPatch) {
  for (const [key, expectedValue] of Object.entries(expectedPatch)) {
    const actualValue = state[key];
    if (expectedValue === null || expectedValue === undefined) continue;

    if (typeof expectedValue === "object" && expectedValue.value !== undefined) {
      const tolerance = expectedValue.tolerance || 0.05;
      const expected = expectedValue.value;

      if (Array.isArray(expected)) {
        assert(Array.isArray(actualValue), `expected ${key} to be an array, got ${typeof actualValue}: ${actualValue}`);
        assert(actualValue.length === expected.length, `expected ${key} length ${expected.length}, got ${actualValue.length}`);
        for (let i = 0; i < expected.length; i++) {
          const diff = Math.abs(actualValue[i] - expected[i]) / Math.abs(expected[i] || 1);
          assert(diff <= tolerance, `expected ${key}[${i}]=${expected[i]} (±${(tolerance * 100).toFixed(0)}%), got ${actualValue[i]}`);
        }
      } else {
        assert(typeof actualValue === "number", `expected ${key} to be a number, got ${typeof actualValue}: ${actualValue}`);
        const diff = Math.abs(actualValue - expected) / Math.abs(expected || 1);
        assert(diff <= tolerance, `expected ${key}=${expected} (±${(tolerance * 100).toFixed(0)}%), got ${actualValue}`);
      }
    } else {
      assert(
        actualValue === expectedValue,
        `expected ${key}="${expectedValue}", got "${actualValue}"`
      );
    }
  }
}

async function runPipelineTest(agentService, testCase) {
  const locale = resolveLocale(testCase.locale);
  const message = testCase.messages[0];
  const expected = resolveCaseExpect(testCase);

  const result = await agentService.run({
    message,
    conversationId: `llm-test-${testCase.id}-${Date.now()}`,
    traceId: `trace-${testCase.id}`,
    context: {
      locale,
      skillIds: testCase.enabledSkillIds,
      autoAnalyze: true,
      includeReport: expected.expectReport !== false,
      autoCodeCheck: shouldEnableAutoCodeCheck(expected),
    },
  });

  try {
    if (typeof expected.success === "boolean") {
      assert(
        Boolean(result.success) === expected.success,
        `expected pipeline success=${expected.success}, got ${Boolean(result.success)}`
      );
    }

    if (expected.toolCalls) {
      assertToolCalls(result.toolCalls || [], expected.toolCalls);
    }

    const analysisCall = result.toolCalls?.find((tc) => tc.tool === "run_analysis");
    if (expected.analysisSuccess === true) {
      assert(
        analysisCall,
        "expected run_analysis to execute, but no run_analysis tool call was recorded"
      );
    }

    if (expected.analysisSuccess !== false && result.toolCalls) {
      if (analysisCall) {
        assert(
          analysisCall.status === "success",
          `run_analysis should succeed, got status="${analysisCall.status}"${analysisCall.error ? `, error: ${analysisCall.error}` : ""}`
        );
      }
    }
  } catch (error) {
    throw attachExecutionResult(error, "pipelineResult", result);
  }

  return result;
}

async function runClarificationTest(runtime, llm, testCase) {
  const locale = resolveLocale(testCase.locale);
  let currentState = undefined;
  let lastResult = null;

  for (let i = 0; i < testCase.turns.length; i++) {
    const turn = testCase.turns[i];
    const result = await runtime.textToModelDraft(llm, turn.message, currentState, locale, testCase.enabledSkillIds);
    currentState = result.stateToPersist;
    lastResult = result;

    const expected = turn.assertions;

    if (
      expected.criticalMissing !== undefined
      || expected.criticalMissingIncludes
      || expected.criticalMissingNotIncludes
    ) {
      applyCriticalMissingAssertions(result.missingFields || [], expected);
    }
    if (expected.modelBuilt !== undefined) {
      if (expected.modelBuilt) {
        assert(result.model !== undefined, `expected model to be built on turn ${i + 1}, but it was undefined`);
      } else {
        assert(result.model === undefined, `expected model NOT to be built on turn ${i + 1}`);
      }
    }
    if (expected.draftPatch) {
      try {
        assertDraftPatch(result.stateToPersist || {}, expected.draftPatch);
      } catch (error) {
        throw attachExecutionResult(error, "draftResult", result);
      }
    }
  }

  return lastResult;
}

module.exports = {
  resolveCaseExpect,
  shouldEnableAutoCodeCheck,
  attachExecutionResult,
  runRoutingTest,
  runExtractionTest,
  runPipelineTest,
  runClarificationTest,
  assertDraftPatch,
};
