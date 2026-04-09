const NUMERIC_TOLERANCE = 0.05; // ±5%

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

module.exports = {
  assert,
  assertMatch,
  assertToolCalls,
  assertCriticalMissing,
  assertNotCriticalMissing,
};
