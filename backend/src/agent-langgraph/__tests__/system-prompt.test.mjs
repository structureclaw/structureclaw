import { describe, expect, test } from "@jest/globals";

const baseState = {
  locale: "zh",
  draftState: undefined,
  artifacts: {},
  policy: {},
  selectedSkillIds: [],
};

describe("agent system prompt", () => {
  test("uses semantic extraction and structured workflow for China seismic analysis", async () => {
    const { buildSystemMessages } = await import("../../../dist/agent-langgraph/system-prompt.js");
    const [message] = buildSystemMessages({
      state: baseState,
      skillManifests: [],
    });
    const content = String(message.content);

    expect(content).toContain("基于 LLM 语义理解提取尺寸、荷载、材料等参数");
    expect(content).toContain("seismicWorkflow");
    expect(content).toContain("opensees-seismic");
    expect(content).toContain("不要用关键词或正则匹配决定 response_spectrum、time_history、pushover 或 elastic_plastic_time_history");
    expect(content).toContain("必须已经有非空结构化 seismicWorkflow");
    expect(content).toContain("groundMotionZonation.records");
    expect(content).toContain("不要根据城市名自行编造烈度");
    expect(content).toContain("localCatalog.records");
    expect(content).toContain("不要把内置人工波描述为真实强震记录");
    expect(content).toContain("不要把 relPath 当作分析 runtime 的文件路径传入");
    expect(content).toContain("seismicWorkflow.memberEvidence");
    expect(content).toContain("不要由 LLM 判断条文通过或失败");
    expect(content).toContain("先调用 run_code_check");
    expect(content).toContain("SEISMIC_CODE_CHECK_REQUIRED");
    expect(content).toContain("先调用 detect_structure_type");
    expect(content).toContain("等待其返回后");
    expect(content).not.toContain("同时调用 detect_structure_type 和 extract_draft_params");
    expect(content).not.toContain("用正则或直接让 LLM");
  });

  test("keeps the English prompt aligned with semantic seismic workflow rules", async () => {
    const { buildSystemMessages } = await import("../../../dist/agent-langgraph/system-prompt.js");
    const [message] = buildSystemMessages({
      state: { ...baseState, locale: "en" },
      skillManifests: [],
    });
    const content = String(message.content);

    expect(content).toContain("LLM semantic understanding");
    expect(content).toContain("seismicWorkflow");
    expect(content).toContain("opensees-seismic");
    expect(content).toContain("do not choose response_spectrum, time_history, pushover, or elastic_plastic_time_history by keyword or regex matching");
    expect(content).toContain("a non-empty structured seismicWorkflow must already exist");
    expect(content).toContain("groundMotionZonation.records");
    expect(content).toContain("do not invent intensity");
    expect(content).toContain("localCatalog.records");
    expect(content).toContain("do not describe built-in artificial waves as real recorded motions");
    expect(content).toContain("do not pass relPath as an analysis-runtime file path");
    expect(content).toContain("seismicWorkflow.memberEvidence");
    expect(content).toContain("do not let the LLM decide clause pass/fail status");
    expect(content).toContain("call run_code_check");
    expect(content).toContain("SEISMIC_CODE_CHECK_REQUIRED");
    expect(content).toContain("Call detect_structure_type first");
    expect(content).toContain("After it returns");
    expect(content).not.toContain("detect_structure_type AND extract_draft_params together");
  });
});
