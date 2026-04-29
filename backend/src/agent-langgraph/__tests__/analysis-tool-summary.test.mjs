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
});
