const test = require("node:test");
const nodeAssert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("llm integration fixtures declare a skillId for every case", () => {
  const fixturePath = path.join(__dirname, "..", "fixtures", "test-cases.json");
  const parsed = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const missing = parsed.testCases
    .filter((testCase) => typeof testCase.skillId !== "string" || testCase.skillId.length === 0)
    .map((testCase) => testCase.id);

  nodeAssert.deepEqual(missing, []);
});
