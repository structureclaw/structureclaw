const test = require("node:test");
const nodeAssert = require("node:assert/strict");

const { parseLlmIntegrationOptions, filterLlmTestCases } = require("./selection.cjs");

test("parseLlmIntegrationOptions reads category and skill filters", () => {
  const options = parseLlmIntegrationOptions(["extraction", "--skill", "frame"]);

  nodeAssert.deepEqual(options, {
    category: "extraction",
    family: "frame",
    skillId: "frame",
    variant: undefined,
    scenarioId: undefined,
    outputPath: undefined,
  });
});

test("parseLlmIntegrationOptions defaults filters to undefined", () => {
  const options = parseLlmIntegrationOptions([]);

  nodeAssert.deepEqual(options, {
    category: undefined,
    family: undefined,
    skillId: undefined,
    variant: undefined,
    scenarioId: undefined,
    outputPath: undefined,
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

test("parseLlmIntegrationOptions reads family, variant, scenario and output filters", () => {
  const options = parseLlmIntegrationOptions([
    "pipeline",
    "--family", "frame",
    "--variant", "specific",
    "--scenario", "frame-static-basic",
    "--output", "tests/.artifacts/frame.json"
  ]);

  nodeAssert.deepEqual(options, {
    category: "pipeline",
    family: "frame",
    skillId: "frame",
    variant: "specific",
    scenarioId: "frame-static-basic",
    outputPath: "tests/.artifacts/frame.json"
  });
});

test("filterLlmTestCases narrows by family, variant and scenarioId", () => {
  const cases = [
    { id: "frame-static-basic#specific", family: "frame", variant: "specific", scenarioId: "frame-static-basic", category: "pipeline" },
    { id: "frame-static-basic#generic", family: "frame", variant: "generic", scenarioId: "frame-static-basic", category: "pipeline" },
    { id: "beam-basic#specific", family: "beam", variant: "specific", scenarioId: "beam-basic", category: "pipeline" }
  ];

  const filtered = filterLlmTestCases(cases, {
    category: "pipeline",
    family: "frame",
    variant: "generic",
    scenarioId: "frame-static-basic"
  });

  nodeAssert.deepEqual(filtered.map((item) => item.id), ["frame-static-basic#generic"]);
});

test("parseLlmIntegrationOptions handles --key=value form", () => {
  const options = parseLlmIntegrationOptions(["--family=beam", "--variant=specific"]);

  nodeAssert.equal(options.family, "beam");
  nodeAssert.equal(options.skillId, "beam");
  nodeAssert.equal(options.variant, "specific");
});

test("parseLlmIntegrationOptions treats --variant auto as no filter", () => {
  const options = parseLlmIntegrationOptions(["--variant", "auto"]);

  nodeAssert.equal(options.variant, undefined);
});

test("parseLlmIntegrationOptions treats --variant=auto as no filter", () => {
  const options = parseLlmIntegrationOptions(["--variant=auto"]);

  nodeAssert.equal(options.variant, undefined);
});
