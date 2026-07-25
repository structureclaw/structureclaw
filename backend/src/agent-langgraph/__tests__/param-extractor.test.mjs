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
  test("benchmark LLM-only mode rejects provider failures instead of using deterministic extraction", async () => {
    const { invokeParamExtractor } = await import("../../../dist/agent-langgraph/param-extractor.js");

    await expect(invokeParamExtractor({
      message: "A two-story frame uses Q355 steel.",
      existingState: undefined,
      locale: "en",
      plugin: beamPlugin,
      requireLlmResult: true,
      llm: {
        invoke: async () => {
          throw new Error("terminated");
        },
      },
    })).rejects.toThrow("LLM_PARAM_EXTRACTOR_INFRASTRUCTURE_ERROR");
  });

  test("benchmark LLM-only mode counts unusable extraction output as a model failure", async () => {
    const { invokeParamExtractor } = await import("../../../dist/agent-langgraph/param-extractor.js");

    await expect(invokeParamExtractor({
      message: "A simply supported beam spans 6 m.",
      existingState: undefined,
      locale: "en",
      plugin: beamPlugin,
      requireLlmResult: true,
      llm: {
        invoke: async () => ({ content: "I cannot provide JSON." }),
      },
    })).rejects.toThrow("LLM_PARAM_EXTRACTOR_INVALID_OUTPUT");
  });

  test("reports provider finish reason and response length for unusable output", async () => {
    const { invokeParamExtractor } = await import("../../../dist/agent-langgraph/param-extractor.js");

    await expect(invokeParamExtractor({
      message: "A three-dimensional frame has several stories and bays.",
      existingState: undefined,
      locale: "en",
      plugin: beamPlugin,
      requireLlmResult: true,
      llm: {
        invoke: async () => ({
          content: '{"draftPatch":{"storyCount":3',
          response_metadata: { finish_reason: "length" },
          additional_kwargs: { reasoning_content: "reasoning only" },
        }),
      },
    })).rejects.toThrow(
      "finishReason=length; contentLength=29; reasoningContentLength=14",
    );
  });

  test("passes the enclosing abort signal to the extraction LLM", async () => {
    const { invokeParamExtractor } = await import("../../../dist/agent-langgraph/param-extractor.js");
    const controller = new AbortController();
    let receivedSignal;

    await invokeParamExtractor({
      message: "A simply supported beam spans 6 m.",
      existingState: undefined,
      locale: "en",
      plugin: beamPlugin,
      signal: controller.signal,
      llm: {
        invoke: async (_prompt, options) => {
          receivedSignal = options?.signal;
          return { content: '{"lengthM":6}' };
        },
      },
    });

    expect(receivedSignal).toBe(controller.signal);
  });

  test("reports provider token usage from the nested extraction call", async () => {
    const { invokeParamExtractor } = await import("../../../dist/agent-langgraph/param-extractor.js");
    const usages = [];

    await invokeParamExtractor({
      message: "A simply supported beam spans 6 m.",
      existingState: undefined,
      locale: "en",
      plugin: beamPlugin,
      onUsage: (usage) => usages.push(usage),
      llm: {
        invoke: async () => ({
          content: '{"lengthM":6}',
          usage_metadata: {
            input_tokens: 90,
            output_tokens: 10,
            total_tokens: 100,
          },
        }),
      },
    });

    expect(usages).toEqual([{
      inputTokens: 90,
      outputTokens: 10,
      totalTokens: 100,
    }]);
  });

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
    expect(prompt).toContain("restraints 顺序严格为 [ux,uy,uz,rx,ry,rz]");
    expect(prompt).toContain("沿全局 X 向可滑动的滚动支座为 [false,true,true,false,false,false]");
    expect(prompt).toContain("不得补写用户未提供的荷载单位或荷载种类");
    expect(prompt).toContain("无法区分总力、线荷载或面荷载");
    expect(prompt).toContain("源面荷载及其按受荷宽度折算得到的线荷载不是两个独立荷载");
    expect(prompt).toContain('"factors": { "<loadCaseId>": number }');
    expect(prompt).not.toContain("get_skill_parameter_info");
  });

  test("defines the canonical support restraints in the English extraction prompt", async () => {
    const { buildParamExtractorPrompt } = await import("../../../dist/agent-langgraph/param-extractor.js");

    const prompt = buildParamExtractorPrompt(
      "en",
      { inferredType: "double-span-beam" },
      beamPlugin,
      "The left support is pinned and the others are rollers free in global X.",
    );

    expect(prompt).toContain("restraints are exactly [ux,uy,uz,rx,ry,rz]");
    expect(prompt).toContain("a pin is [true,true,true,false,false,false]");
    expect(prompt).toContain("a roller free in global X is [false,true,true,false,false,false]");
    expect(prompt).toContain("Never supply a load unit or load kind that the user did not provide");
    expect(prompt).toContain("does not distinguish total force, line load, or area load");
    expect(prompt).toContain("A source area load and the line load derived from it by tributary width are not independent loads");
    expect(prompt).toContain('"factors": { "<loadCaseId>": number }');
  });

  test("includes structured semantic seismic workflow contract in extraction prompt", async () => {
    const { buildParamExtractorPrompt } = await import("../../../dist/agent-langgraph/param-extractor.js");

    const prompt = buildParamExtractorPrompt(
      "zh",
      { inferredType: "frame", storyCount: 3 },
      {
        ...beamPlugin,
        id: "concrete-frame",
        structureType: "frame",
        markdownByStage: {
          draft: "中国抗震设计意图输出 skillState.seismicWorkflow，不能用关键词或正则决定方法。",
        },
      },
      "三层混凝土框架，按中国抗震做反应谱和时程分析，8度，第三组，III类场地",
    );

    expect(prompt).toContain('"seismicWorkflow"');
    expect(prompt).toContain('"methodPreference": "auto|response_spectrum|time_history|pushover|elastic_plastic_time_history"');
    expect(prompt).toContain('"groundMotionZonation"');
    expect(prompt).toContain('"localCatalog"');
    expect(prompt).toContain('"seismicMemberEvidence"');
    expect(prompt).toContain('"strongShearWeakBending"');
    expect(prompt).toContain('"steelSeismicDetailing"');
    expect(prompt).toContain("基于整句语义输出 skillState.seismicWorkflow");
    expect(prompt).toContain("不要用关键词或正则匹配决定 response_spectrum/time_history/pushover/elastic_plastic_time_history");
    expect(prompt).toContain("不要根据城市名或自然语言自行编造烈度");
    expect(prompt).toContain("不要由 LLM 判断条文通过或失败");
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

  test("preserves semantic seismic workflow from parsed skillState", async () => {
    const { parseDraftPatchFromContent } = await import("../../../dist/agent-langgraph/param-extractor.js");
    const seismicWorkflow = {
      methodPreference: "time_history",
      designBasis: {
        siteSeismic: { intensity: 8, designGroup: "3", siteCategory: "III" },
      },
      groundMotionSet: { requiredCount: 3 },
      directions: ["x", "y"],
    };

    expect(parseDraftPatchFromContent(JSON.stringify({
      draftPatch: { storyCount: 3 },
      skillState: { seismicWorkflow },
    }))).toEqual({
      storyCount: 3,
      skillState: { seismicWorkflow },
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
