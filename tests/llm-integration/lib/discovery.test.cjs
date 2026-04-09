const test = require("node:test");
const nodeAssert = require("node:assert/strict");
const path = require("node:path");

const { discoverLlmFixtureFiles, loadLlmFixtures } = require("./discovery.cjs");

const rootDir = path.resolve(__dirname, "..", "..", "..");

test("discoverLlmFixtureFiles finds colocated skill llm fixture files", () => {
  const files = discoverLlmFixtureFiles(rootDir);
  const normalized = files.map((filePath) => path.relative(rootDir, filePath).replace(/\\/gu, "/"));

  nodeAssert.ok(
    normalized.includes("backend/src/agent-skills/structure-type/beam/__llm_tests__/cases.json"),
    "beam llm fixtures should be colocated under the beam skill"
  );
  nodeAssert.ok(
    normalized.includes("backend/src/agent-skills/structure-type/frame/__llm_tests__/cases.json"),
    "frame llm fixtures should be colocated under the frame skill"
  );
  nodeAssert.ok(
    normalized.includes("backend/src/agent-skills/structure-type/portal-frame/__llm_tests__/cases.json"),
    "portal-frame llm fixtures should be colocated under the portal-frame skill"
  );
});

test("loadLlmFixtures aggregates colocated skill cases", () => {
  const cases = loadLlmFixtures(rootDir);

  nodeAssert.ok(cases.some((testCase) => testCase.id === "frame-params-zh"), "frame case should be loaded");
  nodeAssert.ok(cases.some((testCase) => testCase.id === "beam-params-zh"), "beam case should be loaded");
  nodeAssert.ok(cases.some((testCase) => testCase.id === "portal-frame-params-zh"), "portal-frame case should be loaded");
});
