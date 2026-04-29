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
});
