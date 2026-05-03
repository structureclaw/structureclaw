import { describe, expect, test } from "@jest/globals";

describe("analysis tool summary", () => {
  test("surfaces failed analysis artifact feedback to the model", async () => {
    const { buildAnalysisToolSummary } = await import("../../../dist/agent-langgraph/tools.js");

    const summary = buildAnalysisToolSummary({
      skillId: "yjk-static",
      result: {
        success: false,
        error_code: "ANALYSIS_EXECUTION_FAILED",
        message: [
          "YJK analysis failed (phase=analysis, command=yjkdesign_dsncalculating_all): calculation failed",
          "",
          "Artifact feedback:",
          "- workDir: C:\\Users\\demo\\.structureclaw\\analysis\\yjk\\sc_lg-1",
          "",
          "driver stderr tail:",
          "YJK generated error log content",
        ].join("\n"),
        meta: {
          engineId: "builtin-yjk",
          analysisSkillId: "yjk-static",
          analysisAdapterKey: "builtin-yjk",
          workDir: "C:\\Users\\demo\\.structureclaw\\analysis\\yjk\\sc_lg-1",
          stderrPath: "C:\\Users\\demo\\.structureclaw\\analysis\\yjk\\sc_lg-1\\driver.stderr.txt",
          stderrTail: "YJK generated error log content",
        },
      },
    });

    expect(summary.success).toBe(false);
    expect(summary.errorCode).toBe("ANALYSIS_EXECUTION_FAILED");
    expect(summary.message).toContain("YJK generated error log content");
    expect(summary.diagnostics).toMatchObject({
      engineId: "builtin-yjk",
      analysisSkillId: "yjk-static",
      analysisAdapterKey: "builtin-yjk",
      stderrTail: "YJK generated error log content",
    });
  });

  test("keeps recent log tails when compacting large failed analysis messages", async () => {
    const { buildAnalysisToolSummary } = await import("../../../dist/agent-langgraph/tools.js");
    const tailMarker = "YJK_LATEST_STDERR_MARKER";
    const longPrefix = Array.from({ length: 900 }, (_, index) => `older diagnostic ${index}`).join("\n");
    const longTail = `${Array.from({ length: 250 }, () => "intermediate stderr").join("\n")}\n${tailMarker}`;

    const summary = buildAnalysisToolSummary({
      skillId: "yjk-static",
      result: {
        success: false,
        error_code: { unexpected: "object" },
        message: `${longPrefix}\n\ndriver stderr tail:\n${longTail}`,
        meta: {
          stderrTail: longTail,
        },
      },
    });

    expect(summary.errorCode).toBe("ANALYSIS_EXECUTION_FAILED");
    expect(summary.message).toContain(tailMarker);
    expect(summary.message).toContain("[truncated");
    expect(summary.diagnostics.stderrTail).toContain(tailMarker);
  });

  test("summarizes successful analysis artifacts for model follow-up reasoning", async () => {
    const { buildAnalysisToolSummary } = await import("../../../dist/agent-langgraph/tools.js");

    const summary = buildAnalysisToolSummary({
      skillId: "opensees-static",
      result: {
        success: true,
        data: {
          analysisMode: "opensees_2d_frame",
          displacements: {
            "1": { ux: 0, uy: 0, uz: 0 },
            "2": { ux: 0.001, uy: 0, uz: -0.02 },
          },
          forces: {
            E1: { axial: 10, n1: { V: 4, M: 8 } },
          },
          reactions: {
            "1": { fx: -3, fz: 10 },
          },
          caseResults: {
            D: {},
            L: {},
          },
          envelope: {
            maxAbsDisplacement: 0.02,
            maxAbsAxialForce: 10,
            maxAbsShearForce: 4,
            maxAbsMoment: 8,
            maxAbsReaction: 10,
            controlNodeDisplacement: "2",
            controlElementAxialForce: "E1",
            controlElementShearForce: "E1",
            controlElementMoment: "E1",
            controlNodeReaction: "1",
          },
          warnings: ["small warning"],
        },
      },
    });

    expect(summary).toMatchObject({
      success: true,
      skillId: "opensees-static",
      analysisMode: "opensees_2d_frame",
      counts: {
        nodeCount: 2,
        elementCount: 1,
        reactionNodeCount: 1,
        loadCaseCount: 2,
      },
      keyMetrics: {
        maxAbsDisplacement: 0.02,
        maxAbsAxialForce: 10,
        maxAbsShearForce: 4,
        maxAbsMoment: 8,
        maxAbsReaction: 10,
      },
      controlling: {
        controlNodeDisplacement: "2",
        controlElementAxialForce: "E1",
        controlElementShearForce: "E1",
        controlElementMoment: "E1",
        controlNodeReaction: "1",
      },
      warnings: ["small warning"],
    });
    expect(JSON.stringify(summary)).not.toContain("displacements");
    expect(JSON.stringify(summary)).not.toContain("forces");
  });

  test("summarizes successful analysis artifacts returned at the top level", async () => {
    const { buildAnalysisToolSummary } = await import("../../../dist/agent-langgraph/tools.js");

    const summary = buildAnalysisToolSummary({
      skillId: "opensees-static",
      result: {
        success: true,
        analysisMode: "opensees_2d_frame",
        summary: {
          nodeCount: 3,
          elementCount: 2,
          reactionNodeCount: 2,
        },
        envelope: {
          maxAbsDisplacement: 0.01,
          maxAbsMoment: 5,
          controlNodeDisplacement: "N2",
          controlElementMoment: "E1",
        },
        caseResults: {
          LC1: {},
        },
        warnings: ["top-level warning"],
      },
    });

    expect(summary).toMatchObject({
      success: true,
      skillId: "opensees-static",
      analysisMode: "opensees_2d_frame",
      counts: {
        nodeCount: 3,
        elementCount: 2,
        reactionNodeCount: 2,
        loadCaseCount: 1,
      },
      keyMetrics: {
        maxAbsDisplacement: 0.01,
        maxAbsMoment: 5,
      },
      controlling: {
        controlNodeDisplacement: "N2",
        controlElementMoment: "E1",
      },
      warnings: ["top-level warning"],
    });
  });
});

describe("build model tool summary", () => {
  test("rejects empty models instead of reporting success", async () => {
    const { buildModelToolSummary } = await import("../../../dist/agent-langgraph/tools.js");

    const summary = buildModelToolSummary({
      schema_version: "1.0.0",
      nodes: [],
      elements: [],
    }, "zh");

    expect(summary).toEqual(expect.objectContaining({
      success: false,
      errorCode: "EMPTY_MODEL",
      nodeCount: 0,
      elementCount: 0,
    }));
    expect(summary.message).toContain("模型构建结果为空");
  });

  test("clears stale model and downstream artifacts when a rebuild returns an empty model", async () => {
    const { buildModelToolStateUpdate } = await import("../../../dist/agent-langgraph/tools.js");

    const update = buildModelToolStateUpdate(
      { schema_version: "1.0.0", nodes: [], elements: [] },
      { success: false, errorCode: "EMPTY_MODEL" },
    );

    expect(update).toEqual({
      model: null,
      analysisResult: null,
      codeCheckResult: null,
      report: null,
    });
  });
});
