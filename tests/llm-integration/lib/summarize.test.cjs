const test = require("node:test");
const nodeAssert = require("node:assert/strict");

const { summarizeArtifacts } = require("../summarize.cjs");

test("summarizeArtifacts groups pass rate by family and variant", () => {
  const summary = summarizeArtifacts([
    { family: "frame", variant: "specific", status: "PASS" },
    { family: "frame", variant: "specific", status: "FAIL" },
    { family: "frame", variant: "generic", status: "PASS" }
  ]);

  nodeAssert.deepEqual(summary.frame.specific, { passed: 1, failed: 1, total: 2 });
  nodeAssert.deepEqual(summary.frame.generic, { passed: 1, failed: 0, total: 1 });
});

test("summarizeArtifacts handles missing family/variant", () => {
  const summary = summarizeArtifacts([
    { status: "PASS" }
  ]);

  nodeAssert.ok(summary.unknown);
  nodeAssert.deepEqual(summary.unknown.unknown, { passed: 1, failed: 0, total: 1 });
});

test("summarizeArtifacts handles empty records", () => {
  const summary = summarizeArtifacts([]);
  nodeAssert.deepEqual(summary, {});
});
