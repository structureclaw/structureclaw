const test = require("node:test");
const nodeAssert = require("node:assert/strict");

const { resolveObservedTrace } = require("./trace.cjs");

test("resolveObservedTrace normalizes draft observations", () => {
  const trace = resolveObservedTrace({
    testCase: { enabledSkillIds: ["frame", "opensees-static"], fallbackPolicy: "forbid-generic" },
    draftResult: { structuralTypeMatch: { skillId: "frame" }, inferredType: "frame", extractionMode: "llm" }
  });

  nodeAssert.equal(trace.structuralSkillId, "frame");
  nodeAssert.deepEqual(trace.enabledSkillIds, ["frame", "opensees-static"]);
  nodeAssert.deepEqual(trace.selectedSkillIds, ["frame", "opensees-static"]);
  nodeAssert.equal(trace.analysisSkillId, undefined);
  nodeAssert.deepEqual(trace.toolCalls, []);
});

test("resolveObservedTrace normalizes pipeline observations", () => {
  const trace = resolveObservedTrace({
    testCase: { enabledSkillIds: ["frame", "opensees-static"] },
    pipelineResult: {
      routing: {
        selectedSkillIds: ["frame", "opensees-static"],
        activatedSkillIds: ["frame", "opensees-static", "validation-structure-model"],
        structuralSkillId: "frame",
        analysisSkillId: "opensees-static"
      },
      toolCalls: [
        { tool: "build_model", status: "success", authorizedBySkillIds: ["frame"] },
        { tool: "run_analysis", status: "success", authorizedBySkillIds: ["opensees-static"] }
      ]
    }
  });

  nodeAssert.equal(trace.structuralSkillId, "frame");
  nodeAssert.equal(trace.analysisSkillId, "opensees-static");
  nodeAssert.deepEqual(trace.activatedSkillIds, ["frame", "opensees-static", "validation-structure-model"]);
  nodeAssert.equal(trace.toolCalls.length, 2);
});

test("resolveObservedTrace handles missing draft result", () => {
  const trace = resolveObservedTrace({
    testCase: { enabledSkillIds: undefined }
  });

  nodeAssert.equal(trace.structuralSkillId, undefined);
  nodeAssert.deepEqual(trace.enabledSkillIds, undefined);
  nodeAssert.deepEqual(trace.selectedSkillIds, []);
});
