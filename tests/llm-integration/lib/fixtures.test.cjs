const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeFixtureDocument } = require("./fixtures.cjs");

test("normalizeFixtureDocument expands v2 scenarios into runnable variant cases", () => {
  const parsed = {
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
            expect: { success: true, toolCalls: ["draft_model", "run_analysis"] },
          },
          generic: {
            fallbackPolicy: "require-generic",
            expect: { success: true, modelBuilt: true },
          },
        },
      },
    ],
  };

  const cases = normalizeFixtureDocument(parsed, "/tmp/frame.json");

  assert.equal(cases.length, 2);
  assert.deepEqual(cases.map((entry) => entry.id), ["frame-static-basic#specific", "frame-static-basic#generic"]);
  assert.deepEqual(cases.map((entry) => entry.scenarioId), ["frame-static-basic", "frame-static-basic"]);
  assert.deepEqual(cases.map((entry) => entry.family), ["frame", "frame"]);
  assert.deepEqual(cases.map((entry) => entry.variant), ["specific", "generic"]);
  assert.deepEqual(cases.map((entry) => entry.enabledSkillIds), [["frame"], undefined]);
  assert.deepEqual(cases.map((entry) => entry.fallbackPolicy), ["forbid-generic", "require-generic"]);
  assert.deepEqual(cases.map((entry) => entry.expect), [
    { success: true, toolCalls: ["draft_model", "run_analysis"] },
    { success: true, modelBuilt: true },
  ]);
  assert.deepEqual(cases.map((entry) => entry.sourceFile), ["/tmp/frame.json", "/tmp/frame.json"]);
});

test("normalizeFixtureDocument preserves legacy v1 fixtures as runnable cases", () => {
  const parsed = {
    version: "1.0.0",
    skillId: "beam",
    testCases: [
      {
        id: "beam-params-en",
        category: "extraction",
        locale: "en",
        messages: ["cantilever beam, 4m long, point load 15kN at tip"],
        assertions: {
          inferredType: "beam",
          criticalMissing: [],
        },
      },
    ],
  };

  const cases = normalizeFixtureDocument(parsed, "/tmp/beam.json");

  assert.equal(cases.length, 1);
  assert.deepEqual(cases[0], {
    id: "beam-params-en",
    category: "extraction",
    locale: "en",
    messages: ["cantilever beam, 4m long, point load 15kN at tip"],
    family: "beam",
    skillId: "beam",
    variant: "legacy",
    fallbackPolicy: "allow-generic",
    expect: {
      inferredType: "beam",
      criticalMissing: [],
    },
    sourceFile: "/tmp/beam.json",
  });
  assert.equal(cases[0].enabledSkillIds, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(cases[0], "enabledSkillIds"), false);
});

test("normalizeFixtureDocument preserves legacy v1 clarification fixtures with turns", () => {
  const parsed = {
    version: "1.0.0",
    skillId: "frame",
    testCases: [
      {
        id: "frame-clarification",
        category: "clarification",
        locale: "en",
        turns: [
          {
            message: "3-story frame with missing bay widths",
            assertions: { criticalMissingIncludes: ["bayWidthsM"] },
          },
        ],
      },
    ],
  };

  const cases = normalizeFixtureDocument(parsed, "/tmp/clarification-v1.json");

  assert.equal(cases.length, 1);
  assert.equal(cases[0].messages, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(cases[0], "messages"), false);
  assert.deepEqual(cases[0], {
    id: "frame-clarification",
    category: "clarification",
    locale: "en",
    turns: [
      {
        message: "3-story frame with missing bay widths",
        assertions: { criticalMissingIncludes: ["bayWidthsM"] },
      },
    ],
    family: "frame",
    skillId: "frame",
    variant: "legacy",
    fallbackPolicy: "allow-generic",
    expect: {},
    sourceFile: "/tmp/clarification-v1.json",
  });
});

test("normalizeFixtureDocument throws for invalid fixture documents", () => {
  assert.throws(() => {
    normalizeFixtureDocument({ version: "2.0.0", family: "frame", scenarios: [{}] }, "/tmp/invalid.json");
  }, /invalid/i);

  assert.throws(() => {
    normalizeFixtureDocument({ version: "2.0.0", family: "frame", scenarios: [{ scenarioId: "broken", category: "pipeline", locale: "en", variants: [] }] }, "/tmp/invalid-v2-variants.json");
  }, /invalid/i);

  assert.throws(() => {
    normalizeFixtureDocument(
      {
        version: "2.0.0",
        family: "frame",
        scenarios: [
          {
            scenarioId: "frame-routing",
            category: "pipeline",
            locale: "en",
            messages: ["3-story frame"],
            variants: [
              {
                enabledSkillIds: ["frame"],
                fallbackPolicy: "forbid-generic",
                expect: { success: true },
              },
            ],
          },
        ],
      },
      "/tmp/array-shaped-variants.json"
    );
  }, /invalid/i);

  assert.throws(() => {
    normalizeFixtureDocument({ version: "1.0.0", skillId: "beam" }, "/tmp/invalid-legacy.json");
  }, /invalid/i);
});

test("normalizeFixtureDocument rejects messages-only clarification fixtures", () => {
  assert.throws(() => {
    normalizeFixtureDocument(
      {
        version: "1.0.0",
        skillId: "frame",
        testCases: [
          {
            id: "frame-clarification",
            category: "clarification",
            locale: "en",
            messages: ["should we use a frame or beam?"],
          },
        ],
      },
      "/tmp/messages-only-clarification-v1.json"
    );
  }, /invalid/i);

  assert.throws(() => {
    normalizeFixtureDocument(
      {
        version: "2.0.0",
        family: "frame",
        scenarios: [
          {
            scenarioId: "frame-clarification",
            category: "clarification",
            locale: "en",
            messages: ["should we use a frame or beam?"],
            variants: {
              specific: {
                fallbackPolicy: "forbid-generic",
                expect: { modelBuilt: false },
              },
            },
          },
        ],
      },
      "/tmp/messages-only-clarification-v2.json"
    );
  }, /invalid/i);
});

test("normalizeFixtureDocument rejects turns-only message-based fixtures", () => {
  assert.throws(() => {
    normalizeFixtureDocument(
      {
        version: "1.0.0",
        skillId: "beam",
        testCases: [
          {
            id: "beam-routing",
            category: "routing",
            locale: "en",
            turns: [
              {
                message: "beam, 6m span",
                assertions: { inferredType: "beam" },
              },
            ],
          },
        ],
      },
      "/tmp/turns-only-v1-routing.json"
    );
  }, /invalid/i);

  assert.throws(() => {
    normalizeFixtureDocument(
      {
        version: "2.0.0",
        family: "frame",
        scenarios: [
          {
            scenarioId: "frame-routing",
            category: "pipeline",
            locale: "en",
            turns: [
              {
                message: "3-story frame",
                assertions: { success: true },
              },
            ],
            variants: {
              specific: {
                fallbackPolicy: "forbid-generic",
                expect: { success: true },
              },
            },
          },
        ],
      },
      "/tmp/turns-only-v2-pipeline.json"
    );
  }, /invalid/i);
});

test("normalizeFixtureDocument rejects empty or malformed messages arrays", () => {
  assert.throws(() => {
    normalizeFixtureDocument(
      {
        version: "1.0.0",
        skillId: "beam",
        testCases: [
          {
            id: "beam-routing",
            category: "routing",
            locale: "en",
            messages: [],
          },
        ],
      },
      "/tmp/empty-messages-v1.json"
    );
  }, /invalid/i);

  assert.throws(() => {
    normalizeFixtureDocument(
      {
        version: "2.0.0",
        family: "frame",
        scenarios: [
          {
            scenarioId: "frame-routing",
            category: "routing",
            locale: "en",
            messages: ["", 123],
            variants: {
              specific: {
                fallbackPolicy: "forbid-generic",
                expect: { success: true },
              },
            },
          },
        ],
      },
      "/tmp/malformed-messages-v2.json"
    );
  }, /invalid/i);
});

test("normalizeFixtureDocument preserves v2 clarification fixtures with turns", () => {
  const parsed = {
    version: "2.0.0",
    family: "frame",
    scenarios: [
      {
        scenarioId: "frame-clarification",
        category: "clarification",
        locale: "zh",
        turns: [
          {
            message: "3层框架缺少跨数信息",
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
  };

  const cases = normalizeFixtureDocument(parsed, "/tmp/clarification-v2.json");

  assert.equal(cases.length, 1);
  assert.equal(cases[0].messages, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(cases[0], "messages"), false);
  assert.deepEqual(cases[0], {
    id: "frame-clarification#specific",
    scenarioId: "frame-clarification",
    category: "clarification",
    locale: "zh",
    turns: [
      {
        message: "3层框架缺少跨数信息",
        assertions: { criticalMissingIncludes: ["bayCount"] },
      },
    ],
    family: "frame",
    skillId: "frame",
    variant: "specific",
    fallbackPolicy: "forbid-generic",
    expect: { modelBuilt: false },
    sourceFile: "/tmp/clarification-v2.json",
  });
});

test("normalizeFixtureDocument throws for clarification turns without valid entries", () => {
  assert.throws(() => {
    normalizeFixtureDocument(
      {
        version: "1.0.0",
        skillId: "frame",
        testCases: [
          {
            id: "frame-clarification",
            category: "clarification",
            locale: "en",
            turns: [{}],
          },
        ],
      },
      "/tmp/bad-clarification-v1.json"
    );
  }, /invalid/i);

  assert.throws(() => {
    normalizeFixtureDocument(
      {
        version: "2.0.0",
        family: "frame",
        scenarios: [
          {
            scenarioId: "frame-clarification",
            category: "clarification",
            locale: "en",
            turns: [{}],
            variants: {
              specific: {
                fallbackPolicy: "forbid-generic",
                expect: {},
              },
            },
          },
        ],
      },
      "/tmp/bad-clarification-v2.json"
    );
  }, /invalid/i);
});
