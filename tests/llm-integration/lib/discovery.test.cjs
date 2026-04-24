const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { discoverLlmFixtureFiles, loadLlmFixtures } = require("./discovery.cjs");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("discoverLlmFixtureFiles returns colocated llm fixture docs", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-fixtures-"));

  const frameFixture = path.join(rootDir, "backend/src/agent-skills/structure-type/frame/__llm_tests__/frame.json");
  const planningFixture = path.join(rootDir, "backend/src/agent-skills/general/planning/__llm_tests__/planning.json");

  writeJson(frameFixture, {
    version: "2.0.0",
    family: "frame",
    scenarios: [],
  });
  writeJson(planningFixture, {
    version: "1.0.0",
    skillId: "planning",
    testCases: [],
  });

  assert.deepEqual(discoverLlmFixtureFiles(rootDir), [planningFixture, frameFixture]);
});

test("loadLlmFixtures normalizes spec-shaped v2 docs and preserves legacy v1 docs", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-fixtures-"));

  writeJson(
    path.join(rootDir, "backend/src/agent-skills/structure-type/frame/__llm_tests__/frame.json"),
    {
      version: "2.0.0",
      family: "frame",
      scenarios: [
        {
          scenarioId: "frame-static-basic",
          category: "pipeline",
          locale: "en",
          messages: ["3-story frame, 6m bays, 3.6m stories"],
          variants: {
            specific: {
              enabledSkillIds: ["frame"],
              fallbackPolicy: "forbid-generic",
              expect: { success: true, toolCalls: ["build_model", "run_analysis"] },
            },
            generic: {
              enabledSkillIds: ["frame", "generic"],
              fallbackPolicy: "require-generic",
              expect: { success: true, modelBuilt: true },
            },
          },
        },
      ],
    }
  );

  writeJson(
    path.join(rootDir, "backend/src/agent-skills/general/planning/__llm_tests__/planning.json"),
    {
      version: "1.0.0",
      skillId: "planning",
      testCases: [
        {
          id: "planning-legacy",
          category: "routing",
          locale: "en",
          messages: ["plan a structural model"],
          assertions: {
            inferredType: "planning",
          },
        },
      ],
    }
  );

  const cases = loadLlmFixtures(rootDir);

  assert.deepEqual(
    cases.map((entry) => entry.id).sort(),
    ["frame-static-basic#generic", "frame-static-basic#specific", "planning-legacy"]
  );
  assert.deepEqual(
    cases.find((entry) => entry.id === "frame-static-basic#specific"),
    {
      id: "frame-static-basic#specific",
      scenarioId: "frame-static-basic",
      category: "pipeline",
      locale: "en",
      messages: ["3-story frame, 6m bays, 3.6m stories"],
      family: "frame",
      skillId: "frame",
      variant: "specific",
      enabledSkillIds: ["frame"],
      fallbackPolicy: "forbid-generic",
      expect: { success: true, toolCalls: ["build_model", "run_analysis"] },
      sourceFile: path.join(rootDir, "backend/src/agent-skills/structure-type/frame/__llm_tests__/frame.json"),
    }
  );
  assert.equal(cases.find((entry) => entry.id === "planning-legacy").family, "planning");
  assert.deepEqual(cases.find((entry) => entry.id === "planning-legacy"), {
    id: "planning-legacy",
    category: "routing",
    locale: "en",
    messages: ["plan a structural model"],
    family: "planning",
    skillId: "planning",
    variant: "legacy",
    fallbackPolicy: "allow-generic",
    expect: { inferredType: "planning" },
    sourceFile: path.join(rootDir, "backend/src/agent-skills/general/planning/__llm_tests__/planning.json"),
  });
  const legacyCase = cases.find((entry) => entry.id === "planning-legacy");
  assert.equal(legacyCase.enabledSkillIds, undefined);
  assert.equal(
    Object.prototype.hasOwnProperty.call(legacyCase, "enabledSkillIds"),
    false
  );
});

test("loadLlmFixtures throws when it encounters invalid fixture documents", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-fixtures-"));

  writeJson(
    path.join(rootDir, "backend/src/agent-skills/structure-type/frame/__llm_tests__/broken.json"),
    {
      version: "2.0.0",
      family: "frame",
      scenarios: [{}],
    }
  );

  assert.throws(() => {
    loadLlmFixtures(rootDir);
  }, /invalid/i);
});

test("loadLlmFixtures preserves clarification fixtures that use turns instead of messages", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-fixtures-"));

  writeJson(
    path.join(rootDir, "backend/src/agent-skills/general/planning/__llm_tests__/clarification.json"),
    {
      version: "1.0.0",
      skillId: "planning",
      testCases: [
        {
          id: "planning-clarification",
          category: "clarification",
          locale: "en",
          turns: [
            {
              message: "Should we use a frame or a beam?",
              assertions: { criticalMissingIncludes: ["structuralTypeKey"] },
            },
          ],
        },
      ],
    }
  );

  writeJson(
    path.join(rootDir, "backend/src/agent-skills/structure-type/frame/__llm_tests__/clarification.json"),
    {
      version: "2.0.0",
      family: "frame",
      scenarios: [
        {
          scenarioId: "frame-clarification",
          category: "clarification",
          locale: "zh",
          turns: [
            {
              message: "是否是门式刚架？",
              assertions: { criticalMissingIncludes: ["bayCount"] },
            },
          ],
          variants: {
            specific: {
              fallbackPolicy: "forbid-generic",
              expect: { modelBuilt: false },
            },
          },
        },
      ],
    }
  );

  const cases = loadLlmFixtures(rootDir);
  const ids = cases.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ["frame-clarification#specific", "planning-clarification"]);
  const legacyCase = cases.find((entry) => entry.id === "planning-clarification");
  const v2Case = cases.find((entry) => entry.id === "frame-clarification#specific");

  assert.equal(legacyCase.messages, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyCase, "messages"), false);
  assert.equal(v2Case.messages, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(v2Case, "messages"), false);
  assert.equal(legacyCase.turns.length, 1);
  assert.equal(v2Case.turns.length, 1);
});

test("frame fixture expands specific and generic variants from v2 format", () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const cases = loadLlmFixtures(projectRoot);
  const frameCases = cases.filter((tc) => tc.family === "frame");
  const ids = frameCases.map((tc) => tc.id);

  assert.ok(ids.includes("frame-static-basic#specific"), `expected frame-static-basic#specific in ${ids.join(", ")}`);
  assert.ok(ids.includes("frame-static-basic#generic"), `expected frame-static-basic#generic in ${ids.join(", ")}`);
  assert.ok(ids.includes("frame-extraction-multi-story#specific"), `expected frame-extraction-multi-story#specific in ${ids.join(", ")}`);
  assert.ok(ids.includes("frame-extraction-multi-story#generic"), `expected frame-extraction-multi-story#generic in ${ids.join(", ")}`);
  assert.ok(ids.includes("frame-routing-zh#legacy"), `expected frame-routing-zh#legacy in ${ids.join(", ")}`);
  assert.ok(ids.includes("frame-clarify-en#legacy"), `expected frame-clarify-en#legacy in ${ids.join(", ")}`);

  const specificPipeline = frameCases.find((tc) => tc.id === "frame-static-basic#specific");
  assert.deepEqual(specificPipeline.enabledSkillIds, ["frame", "opensees-static", "code-check-gb50017"]);
  assert.equal(specificPipeline.fallbackPolicy, "forbid-generic");
});
