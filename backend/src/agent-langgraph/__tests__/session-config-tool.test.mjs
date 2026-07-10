import { describe, expect, test } from "@jest/globals";

describe("session config tool", () => {
  test("can switch the current session to the OpenSees seismic workflow", async () => {
    const { createSetSessionConfigTool } = await import("../../../dist/agent-langgraph/tools.js");
    const setSessionConfig = createSetSessionConfigTool();

    const command = await setSessionConfig.invoke({
      analysisType: "seismic",
      designCode: "GB/T 50011-2010-2024",
      skillIdsJson: JSON.stringify([
        "concrete-frame",
        "opensees-seismic",
        "validation-structure-model",
        "report-export-builtin",
      ]),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        agentState: {
          policy: { analysisType: "static" },
          selectedSkillIds: ["concrete-frame", "opensees-static"],
        },
      },
    });

    expect(command.update.policy).toMatchObject({
      analysisType: "seismic",
      designCode: "GB/T 50011-2010-2024",
    });
    expect(command.update.selectedSkillIds).toEqual([
      "generic",
      "frame",
      "concrete-frame",
      "opensees-seismic",
      "code-check-gb50011",
      "validation-structure-model",
      "report-export-builtin",
    ]);
    expect(JSON.parse(command.update.messages[0].content)).toMatchObject({
      success: true,
      updatedKeys: ["analysisType", "designCode", "selectedSkillIds"],
    });
  });

  test("auto-completes China seismic skill scope when only the seismic provider is supplied", async () => {
    const { createSetSessionConfigTool } = await import("../../../dist/agent-langgraph/tools.js");
    const setSessionConfig = createSetSessionConfigTool();

    const command = await setSessionConfig.invoke({
      analysisType: "seismic",
      designCode: "GB/T 50011-2010-2024",
      skillIdsJson: JSON.stringify(["opensees-seismic"]),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        agentState: {
          policy: {},
          selectedSkillIds: [],
        },
      },
    });

    expect(command.update.selectedSkillIds).toEqual([
      "generic",
      "frame",
      "concrete-frame",
      "opensees-seismic",
      "code-check-gb50011",
      "validation-structure-model",
      "report-export-builtin",
    ]);
  });

  test("auto-completes China seismic skill scope even when skillIdsJson is omitted", async () => {
    const { createSetSessionConfigTool } = await import("../../../dist/agent-langgraph/tools.js");
    const setSessionConfig = createSetSessionConfigTool();

    const command = await setSessionConfig.invoke({
      analysisType: "seismic",
      designCode: "GB/T 50011-2010-2024",
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        agentState: {
          policy: {},
          selectedSkillIds: ["generic"],
        },
      },
    });

    expect(command.update.selectedSkillIds).toEqual([
      "generic",
      "frame",
      "concrete-frame",
      "opensees-seismic",
      "code-check-gb50011",
      "validation-structure-model",
      "report-export-builtin",
    ]);
    expect(JSON.parse(command.update.messages[0].content).updatedKeys).toEqual([
      "analysisType",
      "designCode",
      "selectedSkillIds",
    ]);
  });

  test("does not auto-complete non-seismic skill scope", async () => {
    const { createSetSessionConfigTool } = await import("../../../dist/agent-langgraph/tools.js");
    const setSessionConfig = createSetSessionConfigTool();

    const command = await setSessionConfig.invoke({
      analysisType: "static",
      skillIdsJson: JSON.stringify(["opensees-static"]),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        agentState: {
          policy: {},
          selectedSkillIds: [],
        },
      },
    });

    expect(command.update.selectedSkillIds).toEqual(["opensees-static"]);
  });
});
