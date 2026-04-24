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
          { tool: "build_model", status: "success" },
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
      toolCalls: ["build_model", "run_analysis"],
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
  nodeAssert.equal(calls[0].context.autoCodeCheck, false);
});

test("runPipelineTest enables code check when the fixture expects run_code_check", async () => {
  const calls = [];
  const agentService = {
    async run(input) {
      calls.push(input);
      return {
        toolCalls: [
          { tool: "build_model", status: "success" },
          { tool: "run_analysis", status: "success" },
          { tool: "run_code_check", status: "success" },
        ],
      };
    },
  };

  await runPipelineTest(agentService, {
    id: "frame-static-basic#specific",
    locale: "en",
    messages: ["2-story single-bay steel frame"],
    enabledSkillIds: ["frame", "opensees-static"],
    expect: {
      toolCalls: ["build_model", "run_analysis", "run_code_check"],
    },
  });

  nodeAssert.equal(calls.length, 1);
  nodeAssert.equal(calls[0].context.autoCodeCheck, true);
});

test("runPipelineTest attaches pipeline results to assertion failures", async () => {
  const agentService = {
    async run() {
      return {
        toolCalls: [
          { tool: "build_model", status: "success" },
          { tool: "run_analysis", status: "success" },
        ],
      };
    },
  };

  let error;
  try {
    await runPipelineTest(agentService, {
      id: "frame-static-basic#specific",
      locale: "en",
      messages: ["2-story single-bay steel frame"],
      enabledSkillIds: ["frame", "opensees-static", "code-check-gb50017"],
      expect: {
        toolCalls: ["build_model", "run_analysis", "run_code_check"],
      },
    });
  } catch (err) {
    error = err;
  }

  nodeAssert.ok(error.pipelineResult);
  nodeAssert.deepEqual(
    error.pipelineResult.toolCalls.map((call) => call.tool),
    ["build_model", "run_analysis"],
  );
});

test("runPipelineTest asserts explicit pipeline success flags", async () => {
  const agentService = {
    async run() {
      return {
        success: false,
        toolCalls: [
          { tool: "build_model", status: "success" },
          { tool: "run_analysis", status: "success" },
        ],
      };
    },
  };

  await nodeAssert.rejects(
    () => runPipelineTest(agentService, {
      id: "truss-static-basic#specific",
      locale: "zh",
      messages: ["三角桁架，跨度12m，高3m，节点荷载20kN，做静力分析"],
      enabledSkillIds: ["truss", "opensees-static"],
      expect: {
        success: true,
        toolCalls: ["build_model", "run_analysis"],
      },
    }),
    /expected pipeline success=true, got false/,
  );
});

test("runPipelineTest requires run_analysis when analysisSuccess is true", async () => {
  const agentService = {
    async run() {
      return {
        success: true,
        toolCalls: [
          { tool: "build_model", status: "success" },
        ],
      };
    },
  };

  await nodeAssert.rejects(
    () => runPipelineTest(agentService, {
      id: "frame-pipeline-multi-bay-zh#legacy",
      locale: "zh",
      messages: ["3层2跨框架，层高3.3m，跨度5.4m和6m，每层楼面荷载15kN/m"],
      expect: {
        analysisSuccess: true,
      },
    }),
    /expected run_analysis to execute, but no run_analysis tool call was recorded/,
  );
});
