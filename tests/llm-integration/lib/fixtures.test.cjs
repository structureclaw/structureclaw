const test = require("node:test");
const nodeAssert = require("node:assert/strict");
const path = require("node:path");

const { loadLlmFixtures } = require("./discovery.cjs");

test("llm integration fixtures declare a skillId for every case", () => {
  const rootDir = path.resolve(__dirname, "..", "..", "..");
  const missing = loadLlmFixtures(rootDir)
    .filter((testCase) => typeof testCase.skillId !== "string" || testCase.skillId.length === 0)
    .map((testCase) => testCase.id);

  nodeAssert.deepEqual(missing, []);
});
