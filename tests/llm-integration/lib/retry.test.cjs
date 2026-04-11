const test = require("node:test");
const nodeAssert = require("node:assert/strict");

const { withRetry } = require("./retry.js");

test("withRetry does not retry deterministic assertion failures", async () => {
  let attempts = 0;

  await nodeAssert.rejects(async () => {
    await withRetry(async () => {
      attempts += 1;
      throw new Error('expected tool "run_code_check" in successful tool calls');
    }, "pipeline-case", 8);
  }, /run_code_check/);

  nodeAssert.equal(attempts, 1);
});

test("withRetry retries transient upstream failures", async () => {
  let attempts = 0;

  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error("429 rate limited");
    }
    return "ok";
  }, "upstream-case", 8);

  nodeAssert.equal(result, "ok");
  nodeAssert.equal(attempts, 3);
});

test("withRetry can retry deterministic failures when case-level retries are enabled", async () => {
  let attempts = 0;

  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error('did not expect "frameDimension" in criticalMissing, but it was present');
    }
    return "ok";
  }, "llm-case", 3, { retryOnAnyError: true });

  nodeAssert.equal(result, "ok");
  nodeAssert.equal(attempts, 3);
});
