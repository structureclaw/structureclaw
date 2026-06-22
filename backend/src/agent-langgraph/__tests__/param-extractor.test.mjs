import { describe, expect, test } from "@jest/globals";

const beamPlugin = {
  id: "beam",
  name: { zh: "梁", en: "Beam" },
  description: { zh: "单跨梁参数提取", en: "Beam parameter extraction" },
  stages: ["draft"],
  structureType: "beam",
  markdownByStage: {
    draft: [
      "- 必填参数：`lengthM`, `supportType`, `loadKN`",
      "- \"跨度6m\" -> `lengthM: 6`",
      "- \"均布荷载20kN/m\" -> `loadKN: 20`, `loadType: distributed`",
    ].join("\n"),
  },
};

describe("param extractor", () => {
  test("builds one direct prompt with embedded skill guidance", async () => {
    const { buildParamExtractorPrompt } = await import("../../../dist/agent-langgraph/param-extractor.js");

    const prompt = buildParamExtractorPrompt(
      "zh",
      { inferredType: "beam", lengthM: 6 },
      beamPlugin,
      "简支梁，跨度20m，均布荷载10kN/m",
    );

    expect(prompt).toContain("当前结构技能参数说明");
    expect(prompt).toContain("\"skillId\": \"beam\"");
    expect(prompt).toContain("已有 draftState");
    expect(prompt).toContain("\"lengthM\": 6");
    expect(prompt).toContain("简支梁，跨度20m，均布荷载10kN/m");
    expect(prompt).not.toContain("get_skill_parameter_info");
  });

  test("omits serialized undefined checkpoint noise from existing draft state", async () => {
    const { buildParamExtractorPrompt } = await import("../../../dist/agent-langgraph/param-extractor.js");

    const prompt = buildParamExtractorPrompt(
      "zh",
      {
        inferredType: "beam",
        lengthM: 6,
        loadKN: { lc: 2, type: "undefined" },
        engineeringDraft: {
          structureType: "beam",
          geometry: {
            lengthM: 6,
            heightM: { lc: 2, type: "undefined" },
          },
          loads: { lc: 2, type: "undefined" },
        },
      },
      beamPlugin,
      "荷载10kN",
    );

    expect(prompt).toContain("\"lengthM\": 6");
    expect(prompt).not.toContain("\"lc\": 2");
    expect(prompt).not.toContain("\"type\": \"undefined\"");
    expect(prompt).not.toContain("\"loadKN\"");
  });

  test("omits previous diagnostics from existing draft state in clarification prompts", async () => {
    const { buildParamExtractorPrompt } = await import("../../../dist/agent-langgraph/param-extractor.js");

    const prompt = buildParamExtractorPrompt(
      "zh",
      {
        inferredType: "truss",
        lengthM: 15,
        skillState: {
          trussTopology: "warren",
          engineeringDraft: {
            structureType: "truss",
            geometry: { lengthM: 15 },
          },
          extractionSource: "engineering-draft",
          invalidDraftFields: ["loadKN"],
        },
        updatedAt: 123,
        skillId: "truss",
        structuralTypeKey: "truss",
        coordinateSemantics: "global-z-up",
        draftIssues: [{
          field: "loadKN",
          severity: "ambiguous",
          reason: "荷载缺失",
        }],
      },
      {
        ...beamPlugin,
        id: "truss",
        structureType: "truss",
        markdownByStage: {
          draft: "- `每个上弦节点荷载 10 kN` maps to `engineeringDraft.loads` and `loadKN: 10`.",
        },
      },
      "每个上弦节点10kN",
    );
    const stateSection = prompt.split("已有 draftState:\n")[1].split("\n\n用户消息:")[0];

    expect(stateSection).toContain("\"lengthM\": 15");
    expect(stateSection).toContain("\"trussTopology\": \"warren\"");
    expect(stateSection).not.toContain("invalidDraftFields");
    expect(stateSection).not.toContain("draftIssues");
    expect(stateSection).not.toContain("engineeringDraft");
    expect(stateSection).not.toContain("extractionSource");
    expect(stateSection).not.toContain("updatedAt");
    expect(stateSection).not.toContain("skillId");
    expect(stateSection).not.toContain("structuralTypeKey");
    expect(stateSection).not.toContain("coordinateSemantics");
    expect(prompt).toContain("如果当前用户消息是在回答追问或更正缺失/无效字段");
  });

  test("repeats draft-stage guidance near the user message", async () => {
    const { buildParamExtractorPrompt } = await import("../../../dist/agent-langgraph/param-extractor.js");

    const prompt = buildParamExtractorPrompt(
      "zh",
      { inferredType: "truss", lengthM: 15 },
      {
        ...beamPlugin,
        id: "truss",
        structureType: "truss",
        markdownByStage: {
          draft: "- top chord node load maps to `loadKN` and `loadPosition: top-nodes`.",
        },
      },
      "每个上弦节点10kN",
    );

    expect(prompt.indexOf("当前 draft 阶段重点说明")).toBeGreaterThan(prompt.indexOf("规则："));
    expect(prompt.indexOf("已有 draftState")).toBeGreaterThan(prompt.indexOf("top chord node load maps"));
  });

  test("builds a focused clarification prompt for missing fields", async () => {
    const { buildParamExtractorPrompt } = await import("../../../dist/agent-langgraph/param-extractor.js");

    const prompt = buildParamExtractorPrompt(
      "zh",
      { inferredType: "truss", lengthM: 15, heightM: 3 },
      {
        ...beamPlugin,
        id: "truss",
        structureType: "truss",
        markdownByStage: {
          draft: "- top chord node load maps to `loadKN` and `loadPosition: top-nodes`.",
        },
      },
      "每个上弦节点10kN",
      ["loadKN"],
    );

    expect(prompt).toContain("正在处理多轮澄清回答");
    expect(prompt).toContain("本轮重点字段：[\"loadKN\"]");
    expect(prompt).toContain("用户最新回答");
    expect(prompt).toContain("每个上弦节点10kN");
    expect(prompt).toContain("如果用户最新回答明确提供了本轮重点字段，必须输出");
  });

  test("parses direct parameter JSON and draftPatch-wrapped JSON", async () => {
    const { parseDraftPatchFromContent } = await import("../../../dist/agent-langgraph/param-extractor.js");

    expect(parseDraftPatchFromContent('{"lengthM":20,"loadKN":10}')).toEqual({
      lengthM: 20,
      loadKN: 10,
    });
    expect(parseDraftPatchFromContent('{"draftPatch":{"lengthM":20,"loadKN":10}}')).toEqual({
      lengthM: 20,
      loadKN: 10,
    });
    expect(parseDraftPatchFromContent(JSON.stringify({
      draftPatch: { lengthM: 20 },
      skillState: { invalidDraftFields: ["loadKN"] },
      draftIssues: [{
        field: "loadKN",
        severity: "ambiguous",
        reason: "Negative load sign may represent uplift.",
      }],
    }))).toEqual({
      lengthM: 20,
      skillState: { invalidDraftFields: ["loadKN"] },
      draftIssues: [{
        field: "loadKN",
        severity: "ambiguous",
        reason: "Negative load sign may represent uplift.",
      }],
    });
  });

  test("wraps top-level semantic engineering draft JSON", async () => {
    const { parseDraftPatchFromContent } = await import("../../../dist/agent-langgraph/param-extractor.js");

    const semanticJson = JSON.stringify({
      structureType: "column",
      geometry: { heightM: 4.2 },
      loads: [
        { kind: "nodal", magnitude: 600, unit: "kN", direction: "gravity" },
      ],
    });

    expect(parseDraftPatchFromContent(semanticJson)).toEqual({
      engineeringDraft: {
        structureType: "column",
        geometry: { heightM: 4.2 },
        loads: [
          { kind: "nodal", magnitude: 600, unit: "kN", direction: "gravity" },
        ],
      },
    });
  });
});
