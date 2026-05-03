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
  });
});
