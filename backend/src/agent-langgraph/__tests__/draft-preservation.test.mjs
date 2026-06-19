import { describe, expect, test } from "@jest/globals";

const unknownFallbackMatch = {
  key: "unknown",
  mappedType: "unknown",
  skillId: "generic",
  supportLevel: "fallback",
};

describe("draft extraction preservation", () => {
  test("prefers the graph user message over generated tool arguments", async () => {
    const { resolveToolInputMessage } = await import("../../../dist/agent-langgraph/tools.js");

    expect(resolveToolInputMessage(
      "请分析这个混凝土框架",
      "请分析这个钢框架",
    )).toBe("请分析这个钢框架");
    expect(resolveToolInputMessage(
      "请分析这个混凝土框架",
      "",
      [{ role: "user", content: "请分析这个钢框架" }],
    )).toBe("请分析这个钢框架");
    expect(resolveToolInputMessage("直接工具调用消息", "")).toBe("直接工具调用消息");
  });

  test("strips benchmark retry feedback before structural extraction", async () => {
    const { resolveRetryTaskMessage } = await import("../../../dist/agent-langgraph/tools.js");

    expect(resolveRetryTaskMessage([
      "上次尝试失败：structural_type 检查失败：期望 frame，实际得到 concrete-frame。",
      "",
      "2层单跨钢框架，层高3.6m，跨度6m，楼面荷载10kN/m，请进行静力分析。",
    ].join("\n"))).toBe("2层单跨钢框架，层高3.6m，跨度6m，楼面荷载10kN/m，请进行静力分析。");

    expect(resolveRetryTaskMessage([
      "Previous attempt failed: structural_type check failed: expected frame, got concrete-frame.",
      "",
      "Analyze a two-story single-bay steel frame.",
    ].join("\n"))).toBe("Analyze a two-story single-bay steel frame.");

    expect(resolveRetryTaskMessage("请把这个结构改成混凝土框架")).toBe("请把这个结构改成混凝土框架");
  });

  test("detects when an unknown fallback should preserve an existing draft", async () => {
    const { shouldPreserveExistingDraftState } = await import("../../../dist/agent-langgraph/tools.js");

    expect(shouldPreserveExistingDraftState({
      inferredType: "beam",
      skillId: "beam",
      structuralTypeKey: "beam",
      lengthM: 10,
      updatedAt: 0,
    }, unknownFallbackMatch)).toBe(true);

    expect(shouldPreserveExistingDraftState({
      inferredType: "unknown",
      skillId: "generic",
      structuralTypeKey: "unknown",
      updatedAt: 0,
    }, unknownFallbackMatch)).toBe(false);

    expect(shouldPreserveExistingDraftState({
      inferredType: "beam",
      skillId: "beam",
      structuralTypeKey: "beam",
      updatedAt: 0,
    }, {
      key: "frame",
      mappedType: "frame",
      skillId: "frame",
      supportLevel: "supported",
    })).toBe(false);
  });

  test("preserves a stable draft when benchmark retry feedback contains a conflicting frame type", async () => {
    const { shouldPreserveExistingDraftState } = await import("../../../dist/agent-langgraph/tools.js");
    const existingState = {
      inferredType: "frame",
      skillId: "frame",
      structuralTypeKey: "frame",
      storyCount: 2,
      updatedAt: 0,
    };
    const conflictingMatch = {
      key: "concrete-frame",
      mappedType: "frame",
      skillId: "concrete-frame",
      supportLevel: "supported",
    };

    expect(shouldPreserveExistingDraftState(
      existingState,
      conflictingMatch,
      "上次尝试失败：structural_type 检查失败：期望 frame，实际得到 steel-frame",
    )).toBe(true);

    expect(shouldPreserveExistingDraftState(
      existingState,
      conflictingMatch,
      "请把这个结构改成混凝土框架",
    )).toBe(false);

    expect(shouldPreserveExistingDraftState(
      {
        inferredType: "beam",
        skillId: "beam",
        structuralTypeKey: "beam",
        lengthM: 6,
        updatedAt: 0,
      },
      {
        key: "frame",
        mappedType: "frame",
        skillId: "frame",
        supportLevel: "supported",
      },
      "上次尝试失败：模型类型应为 frame，请重新提取",
    )).toBe(false);
  });

  test("preserves the previous stable draft but stays conservative without a plugin", async () => {
    const { buildPreservedDraftExtractionResult } = await import("../../../dist/agent-langgraph/tools.js");
    const before = Date.now();
    const existingState = {
      inferredType: "beam",
      skillId: "beam",
      structuralTypeKey: "beam",
      lengthM: 10,
      supportType: "simply-supported",
      loadKN: 1,
      loadType: "point",
      loadPosition: "midspan",
      updatedAt: 0,
    };

    const result = buildPreservedDraftExtractionResult({
      existingState,
      structuralTypeMatch: unknownFallbackMatch,
      locale: "zh",
    });

    expect(result.responseJson).toEqual(expect.objectContaining({
      nextState: expect.objectContaining({
        inferredType: "beam",
        skillId: "beam",
        structuralTypeKey: "beam",
        lengthM: 10,
      }),
      criticalMissing: [],
      extractionMode: "preserved",
      structuralTypeMatch: expect.objectContaining({
        key: "beam",
        mappedType: "beam",
        skillId: "beam",
      }),
      rejectedStructuralTypeMatch: unknownFallbackMatch,
      criticalMissing: ["skillPlugin"],
      canProceed: false,
      nextAction: "ask_user_clarification",
    }));
    expect(result.responseJson.criticalMissing).not.toContain("inferredType");
    expect(result.responseJson.nextState.updatedAt).toBeGreaterThanOrEqual(before);
    expect(result.stateUpdate).toEqual(expect.objectContaining({
      draftState: expect.objectContaining({ inferredType: "beam" }),
      structuralTypeKey: "beam",
    }));
  });

  test("uses the existing draft plugin to keep real missing fields without downgrading inferredType", async () => {
    const { buildPreservedDraftExtractionResult } = await import("../../../dist/agent-langgraph/tools.js");
    const before = Date.now();
    const existingState = {
      inferredType: "beam",
      skillId: "beam",
      structuralTypeKey: "beam",
      lengthM: 10,
      updatedAt: 0,
    };
    const plugin = {
      id: "beam",
      handler: {
        mergeState(existing, patch) {
          return { ...existing, ...patch, updatedAt: 1 };
        },
        computeMissing() {
          return { critical: ["loadKN"], optional: [] };
        },
      },
    };

    const result = buildPreservedDraftExtractionResult({
      existingState,
      structuralTypeMatch: unknownFallbackMatch,
      plugin,
      locale: "en",
    });

    expect(result.responseJson).toEqual(expect.objectContaining({
      criticalMissing: ["loadKN"],
      canProceed: false,
      nextAction: "ask_user_clarification",
      structuralTypeMatch: expect.objectContaining({
        key: "beam",
        mappedType: "beam",
        skillId: "beam",
      }),
    }));
    expect(result.responseJson.criticalMissing).not.toContain("inferredType");
    expect(result.responseJson.nextState.updatedAt).toBeGreaterThanOrEqual(before);
  });
});
