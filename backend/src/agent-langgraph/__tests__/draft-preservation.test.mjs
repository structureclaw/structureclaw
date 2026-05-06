import { describe, expect, test } from "@jest/globals";

const unknownFallbackMatch = {
  key: "unknown",
  mappedType: "unknown",
  skillId: "generic",
  supportLevel: "fallback",
};

describe("draft extraction preservation", () => {
  test("prefers explicit tool messages over the raw last user message", async () => {
    const { resolveToolInputMessage } = await import("../../../dist/agent-langgraph/tools.js");

    expect(resolveToolInputMessage(
      "荷载信息：楼面恒载4.5kN/m²，楼面活载2.0kN/m²",
      "你说？",
    )).toBe("荷载信息：楼面恒载4.5kN/m²，楼面活载2.0kN/m²");
    expect(resolveToolInputMessage("", "继续")).toBe("继续");
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
