const test = require("node:test");
const nodeAssert = require("node:assert/strict");

const {
  resolveCaseExpect,
  runRoutingTest,
  runExtractionTest,
  runPipelineTest,
} = require("./executors.cjs");

test("resolveCaseExpect prefers v2 expect blocks", () => {
  const expected = resolveCaseExpect({
    expect: { inferredType: "frame" },
    assertions: { inferredType: "beam" },
  });

  nodeAssert.deepEqual(expected, { inferredType: "frame" });
});

test("runRoutingTest forwards enabledSkillIds and uses normalized expect", async () => {
  const calls = [];
  const runtime = {
    async detectStructuralType(message, locale, currentState, skillIds) {
      calls.push({ message, locale, currentState, skillIds });
      return { key: "frame", mappedType: "frame", skillId: "frame" };
    },
  };

  await runRoutingTest(runtime, {
    locale: "en",
    messages: ["3-story steel frame"],
    enabledSkillIds: ["frame"],
    expect: {
      inferredType: "frame",
      structuralTypeKey: "frame",
    },
    assertions: {
      inferredType: "beam",
    },
  });

  nodeAssert.deepEqual(calls, [
    {
      message: "3-story steel frame",
      locale: "en",
      currentState: undefined,
      skillIds: ["frame"],
    },
  ]);
});

test("runExtractionTest uses normalized expect blocks", async () => {
  const runtime = {
    async textToModelDraft(_llm, message, currentState, locale, skillIds) {
      nodeAssert.equal(message, "3-story steel frame");
      nodeAssert.equal(currentState, undefined);
      nodeAssert.equal(locale, "en");
      nodeAssert.deepEqual(skillIds, ["frame"]);
      return {
        inferredType: "frame",
        missingFields: [],
        stateToPersist: { storyCount: 3 },
      };
    },
  };

  const result = await runExtractionTest(runtime, {}, {
    locale: "en",
    messages: ["3-story steel frame"],
    enabledSkillIds: ["frame"],
    expect: {
      inferredType: "frame",
      criticalMissing: [],
      draftPatch: { storyCount: 3 },
    },
    assertions: {
      inferredType: "beam",
    },
  });

  nodeAssert.equal(result.inferredType, "frame");
});

test("runPipelineTest derives context from normalized expect blocks", async () => {
  const calls = [];
  const agentService = {
    async run(input) {
      calls.push(input);
      return {
        toolCalls: [
          { tool: "draft_model", status: "success" },
          { tool: "run_analysis", status: "success" },
        ],
      };
    },
  };

  const result = await runPipelineTest(agentService, {
    id: "frame-static-basic#specific",
    locale: "en",
    messages: ["3-story steel frame"],
    enabledSkillIds: ["frame", "opensees-static"],
    expect: {
      toolCalls: ["draft_model", "run_analysis"],
      expectReport: false,
    },
    assertions: {
      expectReport: true,
    },
  });

  nodeAssert.equal(result.toolCalls.length, 2);
  nodeAssert.equal(calls.length, 1);
  nodeAssert.equal(calls[0].context.includeReport, false);
  nodeAssert.deepEqual(calls[0].context.skillIds, ["frame", "opensees-static"]);
});
