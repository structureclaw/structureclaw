const NUMERIC_TOLERANCE = 0.05; // ±5%

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStringSetMatch(actual, expected, path) {
  const actualValues = Array.isArray(actual) ? [...actual].sort() : [];
  const expectedValues = Array.isArray(expected) ? [...expected].sort() : [];
  assertMatch(actualValues, expectedValues, path);
}

/**
 * Compare actual against expected with binary pass/fail tolerance.
 * - Numbers: within ±5%
 * - Strings/enums: exact match
 * - Arrays: same length, elements compared recursively
 */
function assertMatch(actual, expected, path = "") {
  if (expected === null || expected === undefined) {
    return; // no assertion for optional fields
  }

  const pathLabel = path || "root";

  if (typeof expected === "number") {
    assert(typeof actual === "number", `${pathLabel}: expected number, got ${typeof actual}`);
    const tolerance = Math.abs(expected) * NUMERIC_TOLERANCE;
    const minTolerance = Math.max(tolerance, 0.01); // at least ±0.01 for small values
    const diff = Math.abs(actual - expected);
    assert(
      diff <= minTolerance,
      `${pathLabel}: expected ${expected}, got ${actual} (diff ${diff.toFixed(4)} > tolerance ${minTolerance.toFixed(4)})`
    );
    return;
  }

  if (typeof expected === "string") {
    assert(actual === expected, `${pathLabel}: expected "${expected}", got "${actual}"`);
    return;
  }

  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), `${pathLabel}: expected array, got ${typeof actual}`);
    assert(
      actual.length === expected.length,
      `${pathLabel}: expected array length ${expected.length}, got ${actual.length}`
    );
    for (let i = 0; i < expected.length; i++) {
      assertMatch(actual[i], expected[i], `${pathLabel}[${i}]`);
    }
    return;
  }

  if (typeof expected === "object") {
    assert(actual != null && typeof actual === "object", `${pathLabel}: expected object, got ${actual}`);
    for (const key of Object.keys(expected)) {
      assertMatch(actual[key], expected[key], path ? `${path}.${key}` : key);
    }
    return;
  }

  assert(actual === expected, `${pathLabel}: expected ${expected}, got ${actual}`);
}

/**
 * Assert tool call ordering and status in pipeline tests.
 */
function assertToolCalls(toolCalls, expectedTools) {
  assert(Array.isArray(toolCalls), "toolCalls should be an array");

  const actualSequence = toolCalls
    .filter((tc) => tc.status === "success")
    .map((tc) => tc.tool);

  for (let i = 0; i < expectedTools.length; i++) {
    assert(
      actualSequence.includes(expectedTools[i]),
      `expected tool "${expectedTools[i]}" in successful tool calls, got [${actualSequence.join(", ")}]`
    );
  }

  // Verify ordering: each expected tool should appear after the previous one
  let lastIndex = -1;
  for (const tool of expectedTools) {
    const idx = actualSequence.indexOf(tool);
    assert(idx > lastIndex, `tool "${tool}" should appear after previous expected tool`);
    lastIndex = idx;
  }
}

/**
 * Assert that critical missing fields contain the expected ones.
 */
function assertCriticalMissing(actualMissing, expectedMissing) {
  const actual = Array.isArray(actualMissing) ? actualMissing : [];
  for (const field of expectedMissing) {
    assert(
      actual.includes(field),
      `expected "${field}" in criticalMissing, got [${actual.join(", ")}]`
    );
  }
}

/**
 * Assert that critical missing fields do NOT contain the listed ones.
 */
function assertNotCriticalMissing(actualMissing, unexpectedFields) {
  const actual = Array.isArray(actualMissing) ? actualMissing : [];
  for (const field of unexpectedFields) {
    assert(
      !actual.includes(field),
      `did not expect "${field}" in criticalMissing, but it was present`
    );
  }
}

/**
 * Apply criticalMissing assertions from a fixture assertion block.
 * Supports:
 * - criticalMissing: [] for exact-empty
 * - criticalMissing: ["field"] for subset inclusion
 * - criticalMissingIncludes: ["field"] for explicit subset inclusion
 * - criticalMissingNotIncludes: ["field"] for exclusion / invariant checks
 */
function applyCriticalMissingAssertions(actualMissing, expected) {
  const actual = Array.isArray(actualMissing) ? actualMissing : [];
  const assertions = expected || {};

  if (assertions.criticalMissingIncludes) {
    assertCriticalMissing(actual, assertions.criticalMissingIncludes);
  }

  if (assertions.criticalMissingNotIncludes) {
    assertNotCriticalMissing(actual, assertions.criticalMissingNotIncludes);
  }

  if (assertions.criticalMissing) {
    if (assertions.criticalMissing.length === 0) {
      assert(
        actual.length === 0,
        `expected no criticalMissing, got [${actual.join(", ")}]`
      );
      return;
    }
    assertCriticalMissing(actual, assertions.criticalMissing);
  }
}

/**
 * Assert routing trace matches expectations.
 * @param {object} actual - The observed routing trace
 * @param {object} expected - Expected values
 */
function assertRoutingTrace(actual = {}, expected = {}) {
  if (expected.selectedSkillIds) {
    assertStringSetMatch(actual.selectedSkillIds || [], expected.selectedSkillIds, "routing.selectedSkillIds");
  }
  if (expected.activatedSkillIdsIncludes) {
    for (const skillId of expected.activatedSkillIdsIncludes) {
      assert(
        (actual.activatedSkillIds || []).includes(skillId),
        `expected activated skill "${skillId}" in [${(actual.activatedSkillIds || []).join(", ")}]`
      );
    }
  }
  if (expected.structuralSkillId) {
    assert(
      actual.structuralSkillId === expected.structuralSkillId,
      `expected structuralSkillId="${expected.structuralSkillId}", got "${actual.structuralSkillId}"`
    );
  }
  if (expected.analysisSkillId) {
    assert(
      actual.analysisSkillId === expected.analysisSkillId,
      `expected analysisSkillId="${expected.analysisSkillId}", got "${actual.analysisSkillId}"`
    );
  }
}

/**
 * Assert tool authorizers match expectations.
 * @param {Array} toolCalls - Observed tool calls
 * @param {object} expectedAuthorizers - Expected authorizers per tool
 */
function assertToolAuthorizers(toolCalls, expectedAuthorizers = {}) {
  for (const [toolId, expectedSkills] of Object.entries(expectedAuthorizers)) {
    const call = toolCalls.find((item) => item.tool === toolId);
    assert(call, `expected tool call "${toolId}" to exist`);
    assertStringSetMatch(call.authorizedBySkillIds || [], expectedSkills, `toolAuthorizers.${toolId}`);
  }
}

module.exports = {
  assert,
  assertMatch,
  assertToolCalls,
  assertCriticalMissing,
  assertNotCriticalMissing,
  applyCriticalMissingAssertions,
  assertRoutingTrace,
  assertToolAuthorizers,
};
