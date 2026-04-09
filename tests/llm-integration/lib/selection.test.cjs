const test = require("node:test");
const nodeAssert = require("node:assert/strict");

const { parseLlmIntegrationOptions, filterLlmTestCases } = require("./selection.cjs");

test("parseLlmIntegrationOptions reads category and skill filters", () => {
  const options = parseLlmIntegrationOptions(["extraction", "--skill", "frame"]);

  nodeAssert.deepEqual(options, {
    category: "extraction",
    skillId: "frame",
  });
});

test("parseLlmIntegrationOptions defaults filters to undefined", () => {
  const options = parseLlmIntegrationOptions([]);

  nodeAssert.deepEqual(options, {
    category: undefined,
    skillId: undefined,
  });
});

test("filterLlmTestCases narrows by category and skillId", () => {
  const cases = [
    { id: "frame-extraction", category: "extraction", skillId: "frame" },
    { id: "frame-pipeline", category: "pipeline", skillId: "frame" },
    { id: "beam-extraction", category: "extraction", skillId: "beam" },
  ];

  const filtered = filterLlmTestCases(cases, {
    category: "extraction",
    skillId: "frame",
  });

  nodeAssert.deepEqual(filtered.map((item) => item.id), ["frame-extraction"]);
});
