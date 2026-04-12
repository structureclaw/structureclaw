const path = require("node:path");

const { createRequire } = require("node:module");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const { COMMAND_NAMES } = require("../../scripts/cli/command-manifest");
const runtime = require("../../scripts/cli/runtime");
const { runBackendBuildOnce } = require("./shared");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function backendRequire(rootDir) {
  return createRequire(path.join(rootDir, "backend", "package.json"));
}

function clearProviderEnv() {
  process.env.LLM_API_KEY = "";
}

/** Load AgentService from dist using the same module URL as backend/dist/api/agent.js (bare file URL). */
async function importBackendAgentService(rootDir) {
  const filePath = path.join(rootDir, "backend", "dist", "services", "agent.js");
  const mod = await import(pathToFileURL(filePath).href);
  return mod.AgentService;
}

/** Bust ESM cache after tsc rewrote dist; do not use when patching AgentService.prototype before registering routes. */
async function importBackendAgentServiceFresh(rootDir) {
  const filePath = path.join(rootDir, "backend", "dist", "services", "agent.js");
  const url = `${pathToFileURL(filePath).href}?regression=${Date.now()}`;
  const mod = await import(url);
  return mod.AgentService;
}

async function validateAgentOrchestration(context) {
  await runBackendBuildOnce(context);
  clearProviderEnv();

  const AgentService = await importBackendAgentService(context.rootDir);
  const fsModule = await import("node:fs");

  const withDefaultSkills = async (svc) => {
    const defaultSkillIds = (await svc.listSkills()).map((skill) => skill.id);

    const applyDefaultSkills = (params) => {
      const currentContext = params?.context || {};
      if (currentContext.skillIds !== undefined) {
        return params;
      }
      return {
        ...params,
        context: {
          ...currentContext,
          skillIds: defaultSkillIds,
        },
      };
    };

    const originalRun = svc.run.bind(svc);
    svc.run = async (params) => originalRun(applyDefaultSkills(params));

    const runWithStrategy = svc.runWithStrategy.bind(svc);
    svc.runChatOnly = async (params) => runWithStrategy(
      applyDefaultSkills(params),
      { planningDirective: "auto", allowToolCall: false },
    );
    svc.runForcedExecution = async (params) => runWithStrategy(
      applyDefaultSkills(params),
      { planningDirective: "force_tool", allowToolCall: true },
    );

    const originalRunStream = svc.runStream.bind(svc);
    svc.runStream = (params) => originalRunStream(applyDefaultSkills(params));

    const runStreamWithStrategy = svc.runStreamWithStrategy.bind(svc);
    svc.runChatOnlyStream = (params) => runStreamWithStrategy(
      applyDefaultSkills(params),
      { planningDirective: "auto", allowToolCall: false },
    );
    svc.runForcedExecutionStream = (params) => runStreamWithStrategy(
      applyDefaultSkills(params),
      { planningDirective: "force_tool", allowToolCall: true },
    );

    return svc;
  };

  const stubExecutionClients = (svc, handlers = {}) => {
    svc.structureProtocolClient = {
      post: async (targetPath, payload) => {
        if (targetPath === "/validate") {
          if (handlers.validate) {
            return handlers.validate(targetPath, payload);
          }
          return { data: { valid: true, schemaVersion: "1.0.0" } };
        }
        if (targetPath === "/convert") {
          if (handlers.convert) {
            return handlers.convert(targetPath, payload);
          }
          return { data: { model: payload?.model ?? {} } };
        }
        throw new Error(`unexpected structure protocol path ${targetPath}`);
      },
    };

    svc.engineClient.post = async (targetPath, payload) => {
      if (targetPath === "/analyze") {
        if (handlers.analyze) {
          return handlers.analyze(targetPath, payload);
        }
        return {
          data: {
            schema_version: "1.0.0",
            analysis_type: payload.type,
            success: true,
            error_code: null,
            message: "ok",
            data: {},
            meta: {},
          },
        };
      }
      throw new Error(`unexpected analysis path ${targetPath}`);
    };

    svc.codeCheckClient = {
      post: async (targetPath, payload) => {
        if (targetPath === "/code-check") {
          if (handlers.codeCheck) {
            return handlers.codeCheck(targetPath, payload);
          }
          return {
            data: {
              code: payload.code,
              status: "success",
              summary: {
                total: payload.elements.length,
                passed: payload.elements.length,
                failed: 0,
                warnings: 0,
              },
              traceability: { analysisSummary: payload.context?.analysisSummary || {} },
              details: [],
            },
          };
        }
        throw new Error(`unexpected code-check path ${targetPath}`);
      },
    };
  };

  {
    const protocol = AgentService.getProtocol();
    assert(protocol.version === "2.0.0", "protocol version should be 2.0.0");
    assert(Array.isArray(protocol.tools) && protocol.tools.length >= 3, "protocol tools should be present");
    assert(protocol.runRequestSchema?.type === "object", "runRequestSchema should be json schema object");
    assert(protocol.runResultSchema?.type === "object", "runResultSchema should be json schema object");
    assert(Array.isArray(protocol.streamEventSchema?.oneOf), "streamEventSchema should include oneOf");
    assert(protocol.tools.some((tool) => tool.name === "run_analysis"), "run_analysis tool spec should exist");
    assert(protocol.tools.every((tool) => tool.outputSchema && typeof tool.outputSchema === "object"), "tool outputSchema should exist");
    assert(protocol.tools.every((tool) => Array.isArray(tool.errorCodes)), "tool errorCodes should be array");
    console.log("[ok] agent protocol metadata");
  }

  {
    const svc = await withDefaultSkills(new AgentService());
    svc.llm = {
      invoke: async () => ({
        content: JSON.stringify({
          kind: "ask",
          replyMode: null,
          reason: "missing structural details",
        }),
      }),
    };
    const result = await svc.run({ message: "帮我算一下门式刚架" });
    assert(result.success === true, "auto routing should follow the llm planner into clarification when model details are missing");
    assert(result.interaction?.state === "confirming", "auto routing should return clarification interaction when the planner selects ask");
    assert(result.needsModelInput === true, "auto routing should still require model input");

    const toolResult = await svc.runForcedExecution({ message: "帮我算一下门式刚架" });
    assert(toolResult.success === false, "forced execution should block when model details are missing");
    assert(toolResult.needsModelInput === true, "forced execution should require model input");
    console.log("[ok] agent missing-model clarification");
  }

  {
    const svc = await withDefaultSkills(new AgentService());
    stubExecutionClients(svc, {
      validate: async () => {
        const error = new Error("validation failed");
        error.response = { data: { errorCode: "INVALID_STRUCTURE_MODEL" } };
        throw error;
      },
    });

    const result = await svc.runForcedExecution({
      message: "做静力分析",
      context: {
        model: { schema_version: "1.0.0" },
      },
    });
    assert(result.success === false, "validate failure should fail");
    assert(result.response.includes("模型校验失败"), "validate failure response should be surfaced");
    assert(result.toolCalls.some((call) => call.tool === "validate_model" && call.error), "validate trace should exist");
    console.log("[ok] agent validate-failure trace");
  }

  {
    const svc = await withDefaultSkills(new AgentService());
    stubExecutionClients(svc);

    const result = await svc.runForcedExecution({
      message: "静力分析这个模型",
      context: {
        model: {
          schema_version: "1.0.0",
          nodes: [],
          elements: [],
          materials: [],
          sections: [],
        },
        autoAnalyze: true,
      },
    });

    assert(result.success === true, "successful orchestration should succeed");
    assert(result.toolCalls.some((call) => call.tool === "validate_model"), "validate_model should be called");
    assert(result.toolCalls.some((call) => call.tool === "run_analysis"), "run_analysis should be called");
    assert(result.toolCalls.some((call) => call.tool === "generate_report"), "generate_report should be generated");
    assert(result.toolCalls.some((call) => call.tool === "run_analysis" && call.source === "builtin"), "run_analysis should expose builtin source");
    assert(result.toolCalls.some((call) => call.tool === "run_analysis" && Array.isArray(call.authorizedBySkillIds) && call.authorizedBySkillIds.length > 0), "run_analysis should expose authorized skill ids");
    assert(result.report && result.report.summary, "report payload should exist");
    assert(result.metrics?.toolCount >= 2, "tool metrics should be present");
    assert(typeof result.startedAt === "string" && typeof result.completedAt === "string", "run timestamps should be present");
    assert(result.metrics?.totalToolDurationMs >= 0, "total tool duration metrics should be present");
    assert(typeof result.metrics?.toolDurationMsByName === "object", "toolDurationMsByName should be present");
    console.log("[ok] agent success orchestration");
  }

  {
    const svc = await withDefaultSkills(new AgentService());
    stubExecutionClients(svc);

    const events = [];
    let streamTraceId;
    let resultTraceId;
    for await (const chunk of svc.runForcedExecutionStream({
      message: "stream test",
      context: { model: { schema_version: "1.0.0" } },
    })) {
      events.push(chunk.type);
      if (chunk.type === "start") {
        streamTraceId = chunk.content.traceId;
        assert(typeof chunk.content.startedAt === "string", "stream start should include startedAt");
      }
      if (chunk.type === "result") {
        resultTraceId = chunk.content.traceId;
      }
    }

    assert(events[0] === "start", "stream first event should be start");
    assert(events.includes("result"), "stream should include result event");
    assert(events[events.length - 1] === "done", "stream last event should be done");
    assert(streamTraceId && resultTraceId && streamTraceId === resultTraceId, "stream/result traceId should match");
    console.log("[ok] agent stream events");
  }

  {
    const svc = await withDefaultSkills(new AgentService());
    stubExecutionClients(svc);

    const result = await svc.runForcedExecution({
      message: "按3m悬臂梁端部10kN点荷载做静力分析",
      context: {
        userDecision: "allow_auto_decide",
        autoCodeCheck: false,
        includeReport: false,
        providedValues: {
          skillId: "beam",
          lengthM: 3,
          supportType: "cantilever",
          loadKN: 10,
          loadType: "point",
          loadPosition: "end",
        },
      },
    });

    assert(result.success === true, "text draft orchestration should succeed");
    assert(result.toolCalls.some((call) => call.tool === "draft_model"), "draft_model should be called");
    assert(result.toolCalls.some((call) => call.tool === "validate_model"), "validate_model should be called after draft");
    assert(result.toolCalls.some((call) => call.tool === "run_analysis"), "run_analysis should be called after draft");
    assert(result.toolCalls.some((call) => call.tool === "draft_model" && Array.isArray(call.authorizedBySkillIds) && call.authorizedBySkillIds.length > 0), "draft_model should expose authorized skill ids");
    console.log("[ok] agent text-to-model draft orchestration");
  }

  {
    const svc = await withDefaultSkills(new AgentService());
    stubExecutionClients(svc);

    const first = await svc.runForcedExecution({
      conversationId: "conv-clarify-1",
      message: "请帮我算一个门式刚架",
    });
    assert(first.success === false, "first turn should request clarification");
    assert(first.needsModelInput === true, "first turn should require model input");

    const second = await svc.runForcedExecution({
      conversationId: "conv-clarify-1",
      message: "跨度6m，柱高4m，竖向荷载20kN，做静力分析",
      context: {
        userDecision: "allow_auto_decide",
        autoCodeCheck: false,
        includeReport: false,
        providedValues: {
          skillId: "portal-frame",
          lengthM: 6,
          heightM: 4,
          loadKN: 20,
          loadType: "point",
        },
      },
    });
    assert(second.success === true, "second turn should complete using persisted draft state");
    assert(second.toolCalls.some((call) => call.tool === "draft_model"), "second turn should still draft model");
    console.log("[ok] conversation-level clarification carry-over");
  }

  {
    const svc = await withDefaultSkills(new AgentService());

    const collecting = await svc.runChatOnly({
      conversationId: "conv-conversation-complete-model",
      message: "3m悬臂梁，端部10kN点荷载",
      context: {
        locale: "zh",
        providedValues: {
          skillId: "beam",
          lengthM: 3,
          supportType: "cantilever",
          loadKN: 10,
          loadType: "point",
          loadPosition: "end",
        },
      },
    });
    assert(collecting.success === true, "conversation complete-model turn should succeed");
    assert(collecting.interaction?.state === "ready", `expected ready state, got ${collecting.interaction?.state}`);
    assert(collecting.model && Array.isArray(collecting.model.nodes), "conversation complete-model turn should return synchronized model");

    const incomplete = await svc.runChatOnly({
      conversationId: "conv-conversation-incomplete-model",
      message: "帮我设计一个梁",
      context: {
        locale: "zh",
      },
    });
    assert(incomplete.success === true, "incomplete conversation turn should succeed");
    assert(incomplete.interaction?.state !== "ready", "incomplete conversation turn should not be ready");
    assert(incomplete.model === undefined, "incomplete conversation turn should not return synchronized model");
    console.log("[ok] conversation complete-model sync contract");
  }

  {
    const svc = await withDefaultSkills(new AgentService());
    const first = await svc.runChatOnly({
      conversationId: "conv-conversation-followup-1",
      message: "先聊需求，我要做一个门式刚架",
    });
    assert(
      first.interaction?.missingCritical?.includes("门式刚架或双跨每跨跨度（m）"),
      "first conversation turn should ask for portal-frame span",
    );

    const second = await svc.runChatOnly({
      conversationId: "conv-conversation-followup-1",
      message: "跨度10m",
      context: {
        providedValues: {
          lengthM: 10,
        },
      },
    });
    assert(second.success === true, "second conversation turn should still succeed");
    assert(
      !second.interaction?.missingCritical?.includes("门式刚架或双跨每跨跨度（m）"),
      "second conversation turn should not ask for span again",
    );
    assert(
      second.interaction?.missingCritical?.includes("门式刚架柱高（m）"),
      "second conversation turn should continue with height",
    );
    console.log("[ok] conversation clarification follow-up shrinkage");
  }

  {
    const svc = await withDefaultSkills(new AgentService());

    const first = await svc.runChatOnly({
      conversationId: "conv-conversation-followup-beam-1",
      message: "我想设计一个梁",
    });
    assert(first.interaction?.missingCritical?.includes("跨度/长度（m）"), "first beam conversation turn should ask for span");

    const second = await svc.runChatOnly({
      conversationId: "conv-conversation-followup-beam-1",
      message: "跨度10m",
      context: {
        providedValues: {
          lengthM: 10,
        },
      },
    });
    assert(second.success === true, "second beam conversation turn should still succeed");
    assert(
      !second.interaction?.missingCritical?.includes("跨度/长度（m）"),
      "second beam conversation turn should not ask for span again",
    );
    assert(
      second.interaction?.missingCritical?.includes("荷载大小（kN）"),
      "second beam conversation turn should continue with load",
    );
    assert(
      second.interaction?.missingCritical?.includes("支座/边界条件（悬臂/简支/两端固结/固铰）"),
      "second beam conversation turn should require support type before load details",
    );
    assert(
      !second.interaction?.missingCritical?.includes("荷载形式（点荷载/均布荷载）"),
      "second beam conversation turn should not require load type before support type is known",
    );
    assert(
      !second.interaction?.missingCritical?.includes("荷载位置（按当前结构模板）"),
      "second beam conversation turn should not require load position before support type is known",
    );

    const third = await svc.runChatOnly({
      conversationId: "conv-conversation-followup-beam-1",
      message: "简支",
      context: {
        providedValues: {
          supportType: "simply-supported",
        },
      },
    });
    assert(third.success === true, "third beam conversation turn should still succeed");
    assert(
      !third.interaction?.missingCritical?.includes("支座/边界条件（悬臂/简支/两端固结/固铰）"),
      "third beam conversation turn should not ask for support type again",
    );
    assert(
      third.interaction?.missingCritical?.includes("荷载大小（kN）"),
      "third beam conversation turn should still require load magnitude",
    );
    assert(
      third.interaction?.missingCritical?.includes("荷载形式（点荷载/均布荷载）"),
      "third beam conversation turn should require load type after support type is known",
    );
    assert(
      third.interaction?.missingCritical?.includes("荷载位置（按当前结构模板）"),
      "third beam conversation turn should require load position after support type is known",
    );
    console.log("[ok] beam conversation clarification follow-up shrinkage");
  }

  {
    const svc = await withDefaultSkills(new AgentService());
    stubExecutionClients(svc);

    const beam = await svc.runChatOnly({
      message: "按双跨梁建模，每跨4m，中跨节点施加12kN竖向荷载做静力分析",
      context: {
        userDecision: "allow_auto_decide",
        autoCodeCheck: false,
        includeReport: false,
        providedValues: {
          skillId: "double-span-beam",
          spanLengthM: 4,
          loadKN: 12,
          loadType: "point",
          loadPosition: "middle-joint",
        },
      },
    });
    assert(beam.success === true, "double-span beam draft should succeed");
    assert(Array.isArray(beam.model?.elements) && beam.model.elements.length === 2, "double-span beam should have 2 elements");

    const truss = await svc.runForcedExecution({
      message: "建立一个平面桁架，长度5m，10kN轴向荷载并计算",
      context: {
        userDecision: "allow_auto_decide",
        autoCodeCheck: false,
        includeReport: false,
        providedValues: {
          skillId: "truss",
          lengthM: 5,
          loadKN: 10,
          loadType: "point",
          loadPosition: "middle-joint",
        },
      },
    });
    assert(truss.success === true, "planar truss draft should succeed");
    assert(Array.isArray(truss.model?.elements) && truss.model.elements[0]?.type === "truss", "truss draft should produce truss element");
    console.log("[ok] draft type coverage");
  }

  {
    const svc = await withDefaultSkills(new AgentService());
    const defaultSkillIds = (await svc.listSkills()).map((skill) => skill.id);
    let capturedCodeCheckPayload;
    stubExecutionClients(svc, {
      codeCheck: async (_targetPath, payload) => {
        capturedCodeCheckPayload = payload;
        return {
          data: {
            code: payload.code,
            status: "success",
            summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
            traceability: { analysisSummary: payload.context?.analysisSummary || {} },
            details: [
              {
                elementId: payload.elements[0],
                status: "pass",
                checks: [
                  {
                    name: "强度验算",
                    items: [
                      {
                        item: "正应力",
                        clause: "GB50017-2017 7.1.1",
                        formula: "σ = N/A <= f",
                        inputs: { demand: 0.7, capacity: 1.0, limit: 1.0 },
                        utilization: 0.7,
                        status: "pass",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
      },
    });

    const result = await svc.runForcedExecution({
      message: "请对该模型做静力分析并按GB50017做规范校核并出报告",
      context: {
        skillIds: [...defaultSkillIds, "code-check-gb50017"],
        model: {
          schema_version: "1.0.0",
          nodes: [
            { id: "1", x: 0, y: 0, z: 0 },
            { id: "2", x: 3, y: 0, z: 0 },
          ],
          elements: [{ id: "E1", type: "beam", nodes: ["1", "2"], material: "1", section: "1" }],
          materials: [{ id: "1", name: "steel", E: 205000, nu: 0.3, rho: 7850 }],
          sections: [{ id: "1", name: "B1", type: "beam", properties: { A: 0.01, Iy: 0.0001 } }],
          load_cases: [],
          load_combinations: [],
        },
        autoAnalyze: true,
        autoCodeCheck: true,
        designCode: "GB50017",
        parameters: {
          utilizationByElement: {
            E1: {
              正应力: 0.72,
            },
          },
        },
        includeReport: true,
        reportFormat: "both",
        reportOutput: "file",
      },
    });

    assert(result.success === true, "closed loop should succeed");
    assert(result.toolCalls.some((call) => call.tool === "run_code_check"), "run_code_check should be called");
    assert(result.toolCalls.some((call) => call.tool === "generate_report"), "generate_report should be called");
    assert(result.codeCheck?.code === "GB50017", "code-check output should exist");
    assert(capturedCodeCheckPayload?.context?.analysisSummary?.analysisType === "static", "analysis summary should be forwarded");
    assert(capturedCodeCheckPayload?.context?.utilizationByElement?.E1?.正应力 === 0.72, "utilization context should be forwarded");
    assert(result.codeCheck?.details?.[0]?.checks?.[0]?.items?.[0]?.clause, "code-check should include traceable clause");
    assert(typeof result.report?.markdown === "string", "markdown report should be generated");
    assert(Array.isArray(result.artifacts) && result.artifacts.length >= 1, "report artifacts should be generated");
    assert(result.artifacts.every((artifact) => fsModule.existsSync(artifact.path)), "report artifact files should exist");
    for (const artifact of result.artifacts) {
      fsModule.unlinkSync(artifact.path);
    }
    console.log("[ok] analyze code-check report closed loop");
  }
}

async function validateAgentBaseChatFallback(context) {
  await runBackendBuildOnce(context);

  const hasDeterministicOutcome = (result) => {
    if (!result || typeof result !== "object") {
      return false;
    }
    if (result.success === true || result.needsModelInput === true) {
      return true;
    }
    if (result.interaction && typeof result.interaction === "object") {
      return true;
    }
    return typeof result.response === "string" && result.response.trim().length > 0;
  };

  process.env.LLM_API_KEY = process.env.LLM_API_KEY || "";

  const AgentService = await importBackendAgentService(context.rootDir);
  const svc = new AgentService();
  const runForcedExecution = (params) => svc.runWithStrategy(params, { planningDirective: "force_tool", allowToolCall: true });

  const chatResult = await runForcedExecution({
    conversationId: "conv-empty-skill-chat",
    message: "先聊需求，我要算一个门式刚架",
    context: {
      skillIds: [],
      locale: "zh",
    },
  });
  assert(hasDeterministicOutcome(chatResult), "conversation mode with empty skillIds should return deterministic outcome");
  assert(Array.isArray(chatResult.toolCalls) && chatResult.toolCalls.length === 0, "empty-skill chat should not invoke tools");

  const toolResult = await runForcedExecution({
    conversationId: "conv-empty-skill-exec",
    message: "按3m悬臂梁端部10kN点荷载做静力分析",
    context: {
      skillIds: [],
      autoCodeCheck: false,
      includeReport: false,
      userDecision: "allow_auto_decide",
      locale: "zh",
    },
  });
  assert(hasDeterministicOutcome(toolResult), "forced execution with empty skillIds should return deterministic outcome");
  assert(toolResult.success === false, "forced execution with empty skillIds should now be blocked");
  assert(toolResult.blockedReasonCode === "NO_EXECUTABLE_TOOL", "empty-skill forced execution should report blocked reason");
  assert(Array.isArray(toolResult.toolCalls) && toolResult.toolCalls.length === 0, "empty-skill forced execution should not invoke tools");

  const autoResult = await svc.run({
    conversationId: "conv-empty-skill-auto",
    message: "帮我做一个规则框架静力分析",
    context: {
      skillIds: [],
      locale: "zh",
    },
  });
  assert(hasDeterministicOutcome(autoResult), "auto routing with empty skillIds should return deterministic outcome");
  assert(autoResult.success === true, "auto routing with empty skillIds should stay on base chat");
  assert(Array.isArray(autoResult.toolCalls) && autoResult.toolCalls.length === 0, "empty-skill auto routing should not invoke tools");

  console.log("[ok] base-chat fallback contract");
}

async function validateAgentCapabilityModes(context) {
  await runBackendBuildOnce(context);
  clearProviderEnv();

  const AgentService = await importBackendAgentService(context.rootDir);
  const svc = new AgentService();
  const defaultSkillIds = (await svc.listSkills()).map((skill) => skill.id);

  svc.structureProtocolClient = {
    post: async (targetPath, payload) => {
      if (targetPath === "/validate") {
        return { data: { valid: true, schemaVersion: "1.0.0" } };
      }
      if (targetPath === "/convert") {
        return { data: { model: payload?.model ?? {} } };
      }
      throw new Error(`unexpected structure protocol path ${targetPath}`);
    },
  };
  svc.engineClient.post = async (targetPath, payload) => {
    if (targetPath === "/analyze") {
      return {
        data: {
          schema_version: "1.0.0",
          analysis_type: payload.type,
          success: true,
          error_code: null,
          message: "ok",
          data: {},
          meta: {},
        },
      };
    }
    throw new Error(`unexpected analysis path ${targetPath}`);
  };
  svc.codeCheckClient = {
    post: async (targetPath, payload) => {
      if (targetPath === "/code-check") {
        return {
          data: {
            code: payload.code,
            status: "success",
            summary: { total: payload.elements.length, passed: payload.elements.length, failed: 0, warnings: 0 },
            details: [],
          },
        };
      }
      throw new Error(`unexpected code-check path ${targetPath}`);
    },
  };

  const baseChat = await svc.runChatOnly({
    conversationId: "conv-capability-base-chat",
    message: "先聊一下需求",
    context: {
      locale: "zh",
      skillIds: [],
      disabledToolIds: ["draft_model", "run_analysis", "validate_model", "convert_model", "run_code_check", "generate_report"],
    },
  });
  assert(baseChat.success === true, "base chat should succeed");
  assert(!baseChat.interaction, "base chat should not return engineering interaction payload");
  assert(Array.isArray(baseChat.toolCalls) && baseChat.toolCalls.length === 0, "base chat should not invoke tools");

  const skilledChat = await svc.runChatOnly({
    conversationId: "conv-capability-skilled-chat",
    message: "我想设计一个门式刚架",
    context: {
      locale: "zh",
      skillIds: defaultSkillIds,
      disabledToolIds: ["run_analysis", "validate_model", "convert_model", "run_code_check", "generate_report"],
    },
  });
  assert(skilledChat.success === true, "skilled chat should succeed");
  assert(skilledChat.interaction?.stage === "model", "skilled chat should keep structural interaction guidance");
  assert(!skilledChat.toolCalls.some((call) => call.tool === "run_analysis"), "skilled chat should not execute run_analysis");
  assert(!skilledChat.toolCalls.some((call) => call.tool === "run_code_check"), "skilled chat should not execute run_code_check");
  assert(!skilledChat.toolCalls.some((call) => call.tool === "generate_report"), "skilled chat should not execute generate_report");

  const fullAgent = await svc.runForcedExecution({
    conversationId: "conv-capability-full-agent",
    message: "请按3m悬臂梁端部10kN点荷载做静力分析",
    context: {
      locale: "zh",
      skillIds: defaultSkillIds,
      userDecision: "allow_auto_decide",
      autoCodeCheck: false,
      includeReport: false,
    },
  });
  assert(fullAgent.success === true, "full agent should succeed");
  assert(fullAgent.toolCalls.some((call) => call.tool === "run_analysis"), "full agent should execute run_analysis");
  assert(fullAgent.model && typeof fullAgent.model === "object", "full agent should return model artifact");

  console.log("[ok] capability-mode contract");
}

async function validateAgentManifestBinding(context) {
  await runBackendBuildOnce(context);
  clearProviderEnv();

  const { AgentCapabilityService } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "services", "agent-capability.js")).href);
  const { CONVERT_MODEL_TOOL_MANIFEST } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-tools", "builtin", "convert-model.js")).href);

  const makeLocalizedText = (zh, en) => ({ zh, en });
  const compatibility = { minRuntimeVersion: "0.1.0", skillApiVersion: "v1" };
  const categoryByToolId = {
    draft_model: "modeling",
    update_model: "modeling",
    run_analysis: "analysis",
    validate_model: "utility",
    run_code_check: "code-check",
    generate_report: "report",
  };

  const makeGrantTool = (toolId, skillId, requiresTools = []) => ({
    id: toolId,
    source: "external",
    enabledByDefault: false,
    category: categoryByToolId[toolId],
    providedBySkillId: skillId,
    requiresSkills: [skillId],
    requiresTools,
    tags: [`${toolId}`, "external-provided"],
    displayName: makeLocalizedText(toolId, toolId),
    description: makeLocalizedText(
      `${skillId} skill 提供的 ${toolId} 工具。`,
      `The ${skillId} skill provides the ${toolId} tool.`,
    ),
  });

  const makeManifest = (id, domain, options = {}) => ({
    id,
    domain,
    name: options.name ?? makeLocalizedText(`${id} 技能`, `${id} skill`),
    description: options.description ?? makeLocalizedText(`${id} 技能描述`, `${id} skill description`),
    stages: options.stages ?? ["analysis"],
    triggers: options.triggers ?? [id],
    autoLoadByDefault: options.autoLoadByDefault ?? false,
    structureType: options.structureType ?? "unknown",
    requires: options.requires ?? [],
    conflicts: options.conflicts ?? [],
    capabilities: options.capabilities ?? [],
    enabledTools: options.enabledTools,
    providedTools: options.providedTools,
    supportedAnalysisTypes: options.supportedAnalysisTypes ?? [],
    supportedModelFamilies: options.supportedModelFamilies ?? ["generic"],
    materialFamilies: options.materialFamilies ?? [],
    priority: options.priority ?? 0,
    compatibility,
  });

  const validSkillSpecs = [
    {
      id: "beam",
      domain: "structure-type",
      structureType: "beam",
      name: makeLocalizedText("梁", "Beam"),
      description: makeLocalizedText("梁类结构技能", "Beam structure skill"),
      stages: ["intent", "draft", "analysis"],
      triggers: ["beam"],
      autoLoadByDefault: true,
      capabilities: ["model-drafting"],
      providedTools: ["draft_model", "update_model"],
      supportedAnalysisTypes: [],
      supportedModelFamilies: ["frame", "generic"],
      priority: 100,
    },
    {
      id: "analysis-primary",
      domain: "analysis",
      structureType: "unknown",
      name: makeLocalizedText("主分析技能", "Primary analysis skill"),
      description: makeLocalizedText("为 run_analysis 提供显式授权", "Provides explicit authorization for run_analysis"),
      stages: ["analysis"],
      triggers: ["analysis"],
      autoLoadByDefault: false,
      capabilities: ["analysis-execution"],
      providedTools: ["run_analysis"],
      supportedAnalysisTypes: ["static"],
      supportedModelFamilies: ["generic"],
      priority: 90,
    },
    {
      id: "analysis-secondary",
      domain: "analysis",
      structureType: "unknown",
      name: makeLocalizedText("备选分析技能", "Secondary analysis skill"),
      description: makeLocalizedText("与主技能共享 run_analysis 授权", "Shares run_analysis authorization with the primary skill"),
      stages: ["analysis"],
      triggers: ["analysis-secondary"],
      autoLoadByDefault: false,
      capabilities: ["analysis-execution"],
      providedTools: ["run_analysis"],
      supportedAnalysisTypes: ["static"],
      supportedModelFamilies: ["generic"],
      priority: 80,
    },
    {
      id: "validator",
      domain: "validation",
      structureType: "unknown",
      name: makeLocalizedText("校验技能", "Validation skill"),
      description: makeLocalizedText("为 validate_model 提供授权", "Provides authorization for validate_model"),
      stages: ["analysis"],
      triggers: ["validate"],
      autoLoadByDefault: false,
      capabilities: ["model-validation"],
      providedTools: ["validate_model"],
      supportedAnalysisTypes: [],
      supportedModelFamilies: ["generic"],
      priority: 70,
    },
    {
      id: "checker",
      domain: "code-check",
      structureType: "unknown",
      name: makeLocalizedText("校核技能", "Code-check skill"),
      description: makeLocalizedText("为 run_code_check 提供授权", "Provides authorization for run_code_check"),
      stages: ["design"],
      triggers: ["code-check"],
      autoLoadByDefault: false,
      capabilities: ["code-check-execution"],
      providedTools: ["run_code_check"],
      supportedAnalysisTypes: [],
      supportedModelFamilies: ["generic"],
      priority: 60,
    },
    {
      id: "reporter",
      domain: "report-export",
      structureType: "unknown",
      name: makeLocalizedText("报告技能", "Report skill"),
      description: makeLocalizedText("为 generate_report 提供授权", "Provides authorization for generate_report"),
      stages: ["design"],
      triggers: ["report"],
      autoLoadByDefault: false,
      capabilities: ["report-export"],
      providedTools: ["generate_report"],
      supportedAnalysisTypes: [],
      supportedModelFamilies: ["generic"],
      priority: 50,
    },
  ];

  const validManifestById = new Map(
    validSkillSpecs.map((spec) => [spec.id, makeManifest(spec.id, spec.domain, spec)]),
  );
  const validCatalogEntries = validSkillSpecs.map((spec) => ({
    id: spec.id,
    canonicalId: spec.id,
    aliases: [],
    domain: spec.domain,
    name: spec.name,
    description: spec.description,
    stages: spec.stages,
    triggers: spec.triggers,
    autoLoadByDefault: spec.autoLoadByDefault,
    structureType: spec.structureType,
    capabilities: spec.capabilities,
    enabledTools: [],
    providedTools: spec.providedTools,
    supportedAnalysisTypes: spec.supportedAnalysisTypes,
    supportedModelFamilies: spec.supportedModelFamilies,
    materialFamilies: [],
    priority: spec.priority,
    compatibility,
    manifestPath: `/virtual/skills/${spec.id}/skill.yaml`,
  }));
  const validGrantTools = [
    makeGrantTool("draft_model", "beam"),
    makeGrantTool("update_model", "beam"),
    makeGrantTool("run_analysis", "analysis-primary", ["validate_model"]),
    makeGrantTool("validate_model", "validator"),
    makeGrantTool("run_code_check", "checker", ["run_analysis"]),
    makeGrantTool("generate_report", "reporter", ["run_analysis"]),
  ];

  const strictManifestSpec = {
    id: "malformed-binding",
    domain: "analysis",
    structureType: "unknown",
    stages: ["analysis"],
    triggers: ["malformed-binding"],
    autoLoadByDefault: false,
    capabilities: ["analysis-execution"],
    providedTools: ["run_analysis"],
    supportedAnalysisTypes: ["static"],
    supportedModelFamilies: ["generic"],
    priority: 10,
  };
  const strictManifest = makeManifest(strictManifestSpec.id, strictManifestSpec.domain, {
    ...strictManifestSpec,
    name: {},
    description: {},
    enabledTools: undefined,
    providedTools: undefined,
    supportedModelFamilies: undefined,
  });
  const strictCatalogEntry = {
    id: strictManifestSpec.id,
    canonicalId: strictManifestSpec.id,
    aliases: [],
    domain: strictManifestSpec.domain,
    name: {},
    description: {},
    stages: strictManifestSpec.stages,
    triggers: strictManifestSpec.triggers,
    autoLoadByDefault: strictManifestSpec.autoLoadByDefault,
    structureType: strictManifestSpec.structureType,
    capabilities: strictManifestSpec.capabilities,
    enabledTools: [],
    providedTools: strictManifestSpec.providedTools,
    supportedAnalysisTypes: strictManifestSpec.supportedAnalysisTypes,
    supportedModelFamilies: strictManifestSpec.supportedModelFamilies,
    materialFamilies: [],
    priority: strictManifestSpec.priority,
    compatibility,
    manifestPath: `/virtual/skills/${strictManifestSpec.id}/skill.yaml`,
  };

  const buildResolvedTooling = (manifests) => {
    const enabledToolIdsBySkill = {};
    const providedToolIdsBySkill = {};
    const skillIdsByToolId = {};
    const toolsById = new Map();

    for (const manifest of manifests) {
      const providedToolIds = Array.isArray(manifest.providedTools) ? [...manifest.providedTools] : [];
      const enabledToolIds = Array.isArray(manifest.enabledTools) ? [...manifest.enabledTools] : [];
      enabledToolIdsBySkill[manifest.id] = enabledToolIds;
      providedToolIdsBySkill[manifest.id] = providedToolIds;

      for (const toolId of [...enabledToolIds, ...providedToolIds]) {
        if (!skillIdsByToolId[toolId]) {
          skillIdsByToolId[toolId] = [];
        }
        if (!skillIdsByToolId[toolId].includes(manifest.id)) {
          skillIdsByToolId[toolId].push(manifest.id);
        }
      }
    }

    for (const tool of validGrantTools) {
      toolsById.set(tool.id, tool);
    }

    return {
      tools: [...toolsById.values()],
      enabledToolIdsBySkill,
      providedToolIdsBySkill,
      skillIdsByToolId,
    };
  };

  const makeEngine = (id, overrides = {}) => ({
    id,
    name: id,
    enabled: true,
    available: true,
    status: "available",
    supportedModelFamilies: ["generic"],
    supportedAnalysisTypes: ["static"],
    ...overrides,
  });

  const strictCapabilityService = new AgentCapabilityService(
    {
      listSkillManifests: async () => [strictManifest],
      resolveSkillTooling: async () => buildResolvedTooling([strictManifest]),
      listBuiltinToolManifests: () => [CONVERT_MODEL_TOOL_MANIFEST],
    },
    {
      listBuiltinSkills: async () => [strictCatalogEntry],
      resolveCanonicalSkillId: (id) => id,
    },
    {
      listBuiltinTools: async () => [CONVERT_MODEL_TOOL_MANIFEST],
    },
    {
      listEngines: async () => ({ engines: [makeEngine("engine-strict")] }),
    },
  );

  let rejectedMalformedManifest = false;
  try {
    await strictCapabilityService.getCapabilityMatrix({ analysisType: "static" });
  } catch (_error) {
    rejectedMalformedManifest = true;
  }
  assert(rejectedMalformedManifest, "malformed manifest-backed capability metadata must be rejected instead of silently accepted");

  const capabilityService = new AgentCapabilityService(
    {
      listSkillManifests: async () => validSkillSpecs.map((spec) => validManifestById.get(spec.id)),
      resolveSkillTooling: async (skillIds) => buildResolvedTooling(validSkillSpecs.filter((spec) => skillIds === undefined || skillIds.includes(spec.id)).map((spec) => validManifestById.get(spec.id))),
      listBuiltinToolManifests: () => [CONVERT_MODEL_TOOL_MANIFEST],
    },
    {
      listBuiltinSkills: async () => validCatalogEntries,
      resolveCanonicalSkillId: (id) => id,
    },
    {
      listBuiltinTools: async () => [CONVERT_MODEL_TOOL_MANIFEST],
    },
    {
      listEngines: async () => ({
        engines: [
          makeEngine("engine-frame", {
            supportedModelFamilies: ["frame", "generic"],
            supportedAnalysisTypes: ["static"],
          }),
          makeEngine("engine-generic", {
            supportedModelFamilies: ["generic"],
            supportedAnalysisTypes: ["static"],
          }),
          makeEngine("engine-offline", {
            available: false,
            status: "unavailable",
            supportedModelFamilies: ["frame", "generic"],
            supportedAnalysisTypes: ["static"],
          }),
        ],
      }),
    },
  );

  const matrix = await capabilityService.getCapabilityMatrix({ analysisType: "static" });
  assert(matrix.foundationToolIds.includes("convert_model"), "convert_model should remain a foundation tool");
  assert(matrix.tools.some((tool) => tool.id === "convert_model"), "convert_model should remain available in the tool catalog");
  assert(!matrix.foundationToolIds.includes("run_analysis"), "run_analysis should not be a foundation tool");
  assert(!matrix.foundationToolIds.includes("generate_report"), "generate_report should not be a foundation tool");
  assert(matrix.tools.every((tool) => tool.id === "convert_model" || (Array.isArray(tool.requiresSkills) && tool.requiresSkills.length > 0)), "non-foundation tools should require explicit grants");
  assert(matrix.tools.find((tool) => tool.id === "run_analysis")?.requiresTools.includes("validate_model"), "run_analysis should preserve its validate_model dependency");
  assert(matrix.tools.find((tool) => tool.id === "generate_report")?.requiresTools.includes("run_analysis"), "generate_report should preserve its run_analysis dependency");
  assert(Array.isArray(matrix.skillIdsByToolId.run_analysis) && matrix.skillIdsByToolId.run_analysis.includes("analysis-primary") && matrix.skillIdsByToolId.run_analysis.includes("analysis-secondary"), "multiple skills should be able to grant the same tool");
  assert(matrix.skillIdsByToolId.generate_report?.includes("reporter"), "generate_report should be attributed to its granting skill");
  assert(matrix.validEngineIdsBySkill.beam.includes("engine-frame"), "beam should stay compatible with the frame engine");
  assert(!matrix.validEngineIdsBySkill.beam.includes("engine-offline"), "beam should not treat unavailable engines as valid");
  assert(matrix.filteredEngineReasonsBySkill.beam["engine-offline"].includes("engine_unavailable"), "beam should record unavailable engine reasons");
  assert(matrix.skillDomainById.beam === "structure-type", "skill identity should remain separate from engine availability");
  assert(matrix.validSkillIdsByEngine["engine-offline"].includes("beam"), "unavailable engines should still preserve skill compatibility metadata");
  assert(matrix.skills.some((skill) => skill.id === "analysis-primary" && skill.runtimeStatus === "active"), "analysis skill identity should remain present in the catalog");
  console.log("[ok] agent manifest binding contract");
}

async function validateAgentManifestLoader(context) {
  await runBackendBuildOnce(context);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "sclaw-manifest-loader-"));
  const validSkillRoot = path.join(tempRoot, "skills-valid");
  const invalidSkillRoot = path.join(tempRoot, "skills-invalid");
  const validToolRoot = path.join(tempRoot, "tools-valid");
  const invalidToolRoot = path.join(tempRoot, "tools-invalid");

  const write = async (filePath, content) => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, "utf8");
  };
  const STAGE_FILE_NAMES = ["intent.md", "draft.md", "analysis.md", "design.md"];

  const assertDeclaredStagesCoverMarkdownAssets = async (skills, domainRoot, messagePrefix) => {
    for (const skill of skills) {
      const skillDir = path.dirname(skill.manifestPath);
      const relativeSkillDir = path.relative(domainRoot, skillDir) || skill.id;
      const entries = await fsp.readdir(skillDir);
      const stageAssets = STAGE_FILE_NAMES
        .filter((fileName) => entries.includes(fileName))
        .map((fileName) => fileName.replace(/\.md$/, ""))
        .sort();
      const declaredStages = Array.isArray(skill.stages) ? [...skill.stages].sort() : [];
      for (const stage of stageAssets) {
        assert(
          declaredStages.includes(stage),
          `${messagePrefix} ${relativeSkillDir} should declare stage '${stage}' in skill.yaml when ${stage}.md exists`,
        );
      }
    }
  };

  const assertBuiltinCompatibilityMatchesRuntimeDefaults = (skills, messagePrefix) => {
    for (const skill of skills) {
      assert(
        skill.compatibility?.minRuntimeVersion === "0.1.0",
        `${messagePrefix} ${skill.id} should target builtin runtime minRuntimeVersion 0.1.0`,
      );
      assert(
        skill.compatibility?.skillApiVersion === "v1",
        `${messagePrefix} ${skill.id} should target builtin skillApiVersion v1`,
      );
    }
  };

  try {
    await write(
      path.join(validSkillRoot, "analysis", "analysis-static", "skill.yaml"),
      [
        "id: analysis-static",
        "domain: analysis",
        "source: builtin",
        "name:",
        "  zh: 静力分析技能",
        "  en: Static Analysis Skill",
        "description:",
        "  zh: 负责静力分析授权。",
        "  en: Grants static analysis execution.",
        "triggers:",
        "  - static",
        "stages:",
        "  - analysis",
        "structureType: unknown",
        "structuralTypeKeys: []",
        "capabilities:",
        "  - analysis-execution",
        "grants:",
        "  - run_analysis",
        "requires: []",
        "conflicts: []",
        "autoLoadByDefault: false",
        "priority: 10",
        "compatibility:",
        "  minRuntimeVersion: 0.1.0",
        "  skillApiVersion: v1",
        "software: simplified",
        "analysisType: static",
        "engineId: builtin-simplified",
        "adapterKey: builtin-simplified",
        "runtimeRelativePath: runtime.py",
        "supportedAnalysisTypes:",
        "  - static",
        "supportedModelFamilies:",
        "  - generic",
        "materialFamilies: []",
        "",
      ].join("\n"),
    );
    await write(
      path.join(validSkillRoot, "analysis", "analysis-static", "intent.md"),
      "# Static analysis prompt",
    );
    await write(
      path.join(validSkillRoot, "analysis", "legacy-only", "intent.md"),
      "# legacy skill without manifest should be ignored",
    );
    await write(
      path.join(invalidSkillRoot, "analysis", "invalid-analysis", "skill.yaml"),
      [
        "id: invalid-analysis",
        "domain: analysis",
        "source: builtin",
        "name:",
        "  zh: 缺失英文名称",
        "description:",
        "  zh: 描述存在",
        "  en: Description exists",
        "triggers: []",
        "stages:",
        "  - analysis",
        "structureType: unknown",
        "structuralTypeKeys: []",
        "capabilities: []",
        "grants: []",
        "requires: []",
        "conflicts: []",
        "autoLoadByDefault: false",
        "priority: 0",
        "compatibility:",
        "  minRuntimeVersion: 0.1.0",
        "  skillApiVersion: v1",
        "supportedAnalysisTypes: []",
        "supportedModelFamilies:",
        "  - generic",
        "materialFamilies: []",
        "",
      ].join("\n"),
    );

    await write(
      path.join(validToolRoot, "run-analysis", "tool.yaml"),
      [
        "id: run_analysis",
        "source: builtin",
        "tier: domain",
        "category: analysis",
        "enabledByDefault: false",
        "displayName:",
        "  zh: 执行结构分析",
        "  en: Run Structural Analysis",
        "description:",
        "  zh: 执行分析求解。",
        "  en: Execute structural analysis.",
        "requiresSkills:",
        "  - analysis-static",
        "requiresTools:",
        "  - validate_model",
        "tags:",
        "  - builtin",
        "inputSchema: {}",
        "outputSchema: {}",
        "errorCodes:",
        "  - ENGINE_UNAVAILABLE",
        "",
      ].join("\n"),
    );
    await write(
      path.join(validToolRoot, "legacy-helper", "handler.ts"),
      "export const legacy = true;\n",
    );
    await write(
      path.join(invalidToolRoot, "invalid-tool", "tool.yaml"),
      [
        "id: invalid_tool",
        "source: builtin",
        "tier: domain",
        "category: analysis",
        "enabledByDefault: false",
        "displayName:",
        "  zh: 缺失英文名",
        "description:",
        "  zh: 描述存在",
        "  en: Description exists",
        "requiresSkills: []",
        "requiresTools: []",
        "tags: []",
        "inputSchema: {}",
        "outputSchema: {}",
        "errorCodes: []",
        "",
      ].join("\n"),
    );

    const { loadSkillManifestsFromDirectory } = await import(
      pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-runtime", "skill-manifest-loader.js")).href
    );
    const { loadToolManifestsFromDirectory } = await import(
      pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-runtime", "tool-manifest-loader.js")).href
    );
    const { resolveToolingForSkillManifests } = await import(
      pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-runtime", "tool-registry.js")).href
    );

    const skills = await loadSkillManifestsFromDirectory(validSkillRoot);
    assert(Array.isArray(skills), "skill manifest loader should return an array");
    assert(skills.length === 1, "skill manifest loader should only load directories with skill.yaml");
    assert(skills[0].id === "analysis-static", "skill manifest loader should preserve manifest id");
    assert(Array.isArray(skills[0].grants) && skills[0].grants.includes("run_analysis"), "skill manifest loader should parse explicit grants");
    assert(skills[0].name?.zh === "静力分析技能" && skills[0].name?.en === "Static Analysis Skill", "skill manifest loader should preserve bilingual localized text");
    assert(skills[0].software === "simplified", "skill manifest loader should preserve optional analysis software metadata");
    assert(skills[0].analysisType === "static", "skill manifest loader should preserve optional analysisType metadata");
    assert(skills[0].engineId === "builtin-simplified", "skill manifest loader should preserve optional engineId metadata");
    assert(skills[0].adapterKey === "builtin-simplified", "skill manifest loader should preserve optional adapterKey metadata");
    assert(skills[0].runtimeRelativePath === "runtime.py", "skill manifest loader should preserve optional runtimeRelativePath metadata");

    let rejectedInvalidSkill = false;
    try {
      await loadSkillManifestsFromDirectory(invalidSkillRoot);
    } catch (_error) {
      rejectedInvalidSkill = true;
    }
    assert(rejectedInvalidSkill, "skill manifest loader should reject malformed skill.yaml files");

    const tools = await loadToolManifestsFromDirectory(validToolRoot);
    assert(Array.isArray(tools), "tool manifest loader should return an array");
    assert(tools.length === 1, "tool manifest loader should only load directories with tool.yaml");
    assert(tools[0].id === "run_analysis", "tool manifest loader should preserve manifest id");
    assert(tools[0].tier === "domain", "tool manifest loader should preserve tool tier");
    assert(Array.isArray(tools[0].requiresTools) && tools[0].requiresTools.includes("validate_model"), "tool manifest loader should preserve tool dependencies");

    let rejectedInvalidTool = false;
    try {
      await loadToolManifestsFromDirectory(invalidToolRoot);
    } catch (_error) {
      rejectedInvalidTool = true;
    }
    assert(rejectedInvalidTool, "tool manifest loader should reject malformed tool.yaml files");

    let rejectedUnknownGrantedTool = false;
    try {
      resolveToolingForSkillManifests([
        {
          id: "analysis-unknown-tool",
          domain: "analysis",
          name: { zh: "未知工具分析", en: "Unknown Tool Analysis" },
          description: { zh: "错误授权未知工具。", en: "Incorrectly grants an unknown tool." },
          triggers: [],
          stages: ["analysis"],
          autoLoadByDefault: false,
          structureType: "unknown",
          structuralTypeKeys: [],
          requires: [],
          conflicts: [],
          capabilities: ["analysis-execution"],
          enabledTools: ["nonexistent_tool"],
          providedTools: [],
          supportedAnalysisTypes: ["static"],
          supportedModelFamilies: ["generic"],
          materialFamilies: [],
          priority: 0,
          compatibility: { minRuntimeVersion: "0.1.0", skillApiVersion: "v1" },
        },
      ], ["analysis-unknown-tool"]);
    } catch (_error) {
      rejectedUnknownGrantedTool = true;
    }
    assert(rejectedUnknownGrantedTool, "tool registry should reject skill manifests that grant unknown tools instead of synthesizing placeholder tools");

    const builtinStructureTypeRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "structure-type");
    const builtinStructureTypeSkills = await loadSkillManifestsFromDirectory(builtinStructureTypeRoot);
    const builtinStructureTypeIds = builtinStructureTypeSkills.map((skill) => skill.id).sort();
    assert(
      JSON.stringify(builtinStructureTypeIds) === JSON.stringify([
        "beam",
        "double-span-beam",
        "frame",
        "generic",
        "portal-frame",
        "truss",
      ]),
      "skill manifest loader should discover builtin structure-type skills from real skill.yaml files",
    );
    assert(
      builtinStructureTypeSkills.every((skill) => Array.isArray(skill.grants) && skill.grants.length > 0),
      "builtin structure-type skill manifests should declare explicit tool grants",
    );
    await assertDeclaredStagesCoverMarkdownAssets(
      builtinStructureTypeSkills,
      builtinStructureTypeRoot,
      "builtin structure-type skill manifest",
    );
    assertBuiltinCompatibilityMatchesRuntimeDefaults(
      builtinStructureTypeSkills,
      "builtin structure-type skill manifest",
    );
    const builtinAnalysisRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "analysis");
    const builtinAnalysisSkills = await loadSkillManifestsFromDirectory(builtinAnalysisRoot);
    const builtinAnalysisIds = builtinAnalysisSkills.map((skill) => skill.id).sort();
    assert(
      JSON.stringify(builtinAnalysisIds) === JSON.stringify([
        "opensees-dynamic",
        "opensees-nonlinear",
        "opensees-seismic",
        "opensees-static",
        "simplified-dynamic",
        "simplified-seismic",
        "simplified-static",
      ]),
      "skill manifest loader should discover builtin analysis skills from real skill.yaml files",
    );
    assert(
      builtinAnalysisSkills.every((skill) => skill.software && skill.analysisType && skill.engineId && skill.adapterKey),
      "builtin analysis skill manifests should declare explicit execution metadata",
    );
    assert(
      builtinAnalysisSkills.every((skill) => Array.isArray(skill.grants) && skill.grants.includes("run_analysis")),
      "builtin analysis skill manifests should declare explicit run_analysis grants",
    );
    await assertDeclaredStagesCoverMarkdownAssets(
      builtinAnalysisSkills,
      builtinAnalysisRoot,
      "builtin analysis skill manifest",
    );
    assertBuiltinCompatibilityMatchesRuntimeDefaults(
      builtinAnalysisSkills,
      "builtin analysis skill manifest",
    );
    const builtinCodeCheckRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "code-check");
    const builtinCodeCheckSkills = await loadSkillManifestsFromDirectory(builtinCodeCheckRoot);
    const builtinCodeCheckIds = builtinCodeCheckSkills.map((skill) => skill.id).sort();
    assert(
      JSON.stringify(builtinCodeCheckIds) === JSON.stringify([
        "code-check-gb50010",
        "code-check-gb50011",
        "code-check-gb50017",
        "code-check-jgj3",
      ]),
      "skill manifest loader should discover builtin code-check skills from real skill.yaml files",
    );
    assert(
      builtinCodeCheckSkills.every((skill) => typeof skill.designCode === "string" && skill.designCode.length > 0),
      "builtin code-check skill manifests should declare explicit designCode metadata",
    );
    assert(
      builtinCodeCheckSkills.every((skill) => Array.isArray(skill.grants) && skill.grants.includes("run_code_check")),
      "builtin code-check skill manifests should declare explicit run_code_check grants",
    );
    await assertDeclaredStagesCoverMarkdownAssets(
      builtinCodeCheckSkills,
      builtinCodeCheckRoot,
      "builtin code-check skill manifest",
    );
    assertBuiltinCompatibilityMatchesRuntimeDefaults(
      builtinCodeCheckSkills,
      "builtin code-check skill manifest",
    );
    const builtinLoadBoundaryRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "load-boundary");
    const builtinLoadBoundarySkills = await loadSkillManifestsFromDirectory(builtinLoadBoundaryRoot);
    const builtinLoadBoundaryIds = builtinLoadBoundarySkills.map((skill) => skill.id).sort();
    assert(
      JSON.stringify(builtinLoadBoundaryIds) === JSON.stringify([
        "boundary-condition",
        "crane-load",
        "dead-load",
        "live-load",
        "load-combination",
        "nodal-constraint",
        "seismic-load",
        "snow-load",
        "temperature-load",
        "wind-load",
      ]),
      "skill manifest loader should discover builtin load-boundary skills from real skill.yaml files",
    );
    const deadLoadSkill = builtinLoadBoundarySkills.find((skill) => skill.id === "dead-load");
    assert(deadLoadSkill?.version === "1.0.0", "dead-load manifest should preserve version metadata");
    assert(Array.isArray(deadLoadSkill?.scenarioKeys) && deadLoadSkill.scenarioKeys.includes("frame"), "dead-load manifest should preserve scenarioKeys metadata");
    assert(Array.isArray(deadLoadSkill?.loadTypes) && deadLoadSkill.loadTypes.includes("self-weight"), "dead-load manifest should preserve loadTypes metadata");
    const boundarySkill = builtinLoadBoundarySkills.find((skill) => skill.id === "boundary-condition");
    assert(Array.isArray(boundarySkill?.boundaryTypes) && boundarySkill.boundaryTypes.includes("fixed"), "boundary-condition manifest should preserve boundaryTypes metadata");
    const combinationSkill = builtinLoadBoundarySkills.find((skill) => skill.id === "load-combination");
    assert(Array.isArray(combinationSkill?.combinationTypes) && combinationSkill.combinationTypes.includes("ULS"), "load-combination manifest should preserve combinationTypes metadata");
    await assertDeclaredStagesCoverMarkdownAssets(
      builtinLoadBoundarySkills,
      builtinLoadBoundaryRoot,
      "builtin load-boundary skill manifest",
    );
    assertBuiltinCompatibilityMatchesRuntimeDefaults(
      builtinLoadBoundarySkills,
      "builtin load-boundary skill manifest",
    );
    const loadBoundaryRegistry = await import(
      pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-skills", "load-boundary", "registry.js")).href
    );
    const registryIds = loadBoundaryRegistry.listBuiltinLoadBoundarySkills().map((skill) => skill.id).sort();
    assert(
      JSON.stringify(registryIds) === JSON.stringify(builtinLoadBoundaryIds),
      "load-boundary registry should derive its skill inventory from skill.yaml without drift",
    );
    assert(
      loadBoundaryRegistry.getBuiltinLoadBoundarySkill("snow-load")?.version === "1.0.0",
      "load-boundary registry should preserve manifest metadata for snow-load",
    );
    const builtinSectionRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "section");
    const builtinSectionSkills = await loadSkillManifestsFromDirectory(builtinSectionRoot);
    const builtinSectionIds = builtinSectionSkills.map((skill) => skill.id).sort();
    assert(
      JSON.stringify(builtinSectionIds) === JSON.stringify([
        "section-bridge",
        "section-common",
        "section-irregular",
      ]),
      "skill manifest loader should discover builtin section skills from real skill.yaml files",
    );
    await assertDeclaredStagesCoverMarkdownAssets(
      builtinSectionSkills,
      builtinSectionRoot,
      "builtin section skill manifest",
    );
    assertBuiltinCompatibilityMatchesRuntimeDefaults(
      builtinSectionSkills,
      "builtin section skill manifest",
    );
    const builtinValidationRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "validation");
    const builtinValidationSkills = await loadSkillManifestsFromDirectory(builtinValidationRoot);
    await assertDeclaredStagesCoverMarkdownAssets(
      builtinValidationSkills,
      builtinValidationRoot,
      "builtin validation skill manifest",
    );
    assertBuiltinCompatibilityMatchesRuntimeDefaults(
      builtinValidationSkills,
      "builtin validation skill manifest",
    );
    const builtinReportExportRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "report-export");
    const builtinReportExportSkills = await loadSkillManifestsFromDirectory(builtinReportExportRoot);
    await assertDeclaredStagesCoverMarkdownAssets(
      builtinReportExportSkills,
      builtinReportExportRoot,
      "builtin report-export skill manifest",
    );
    assertBuiltinCompatibilityMatchesRuntimeDefaults(
      builtinReportExportSkills,
      "builtin report-export skill manifest",
    );
    const builtinVisualizationRoot = path.join(context.rootDir, "backend", "src", "agent-skills", "visualization");
    const builtinVisualizationSkills = await loadSkillManifestsFromDirectory(builtinVisualizationRoot);
    const builtinVisualizationIds = builtinVisualizationSkills.map((skill) => skill.id).sort();
    assert(
      JSON.stringify(builtinVisualizationIds) === JSON.stringify([
        "visualization-3d-scene",
        "visualization-frame-summary",
        "visualization-png-export",
      ]),
      "skill manifest loader should discover builtin visualization skills from real skill.yaml files",
    );
    await assertDeclaredStagesCoverMarkdownAssets(
      builtinVisualizationSkills,
      builtinVisualizationRoot,
      "builtin visualization skill manifest",
    );
    assertBuiltinCompatibilityMatchesRuntimeDefaults(
      builtinVisualizationSkills,
      "builtin visualization skill manifest",
    );

    console.log("[ok] agent manifest loader contract");
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

async function validateAgentToolCatalog(context) {
  await runBackendBuildOnce(context);

  const { AgentToolCatalogService } = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "services", "agent-tool-catalog.js")).href
  );

  const service = new AgentToolCatalogService();
  const tools = await service.listBuiltinTools();
  assert(Array.isArray(tools), "tool catalog should return an array");

  const toolIds = tools.map((tool) => tool.id).sort();
  assert(
    JSON.stringify(toolIds) === JSON.stringify([
      "convert_model",
      "draft_model",
      "generate_report",
      "run_analysis",
      "run_code_check",
      "update_model",
      "validate_model",
    ]),
    "tool catalog should expose the canonical builtin tool set from tool.yaml manifests",
  );

  assert(tools.every((tool) => typeof tool.manifestPath === "string" && tool.manifestPath.endsWith("tool.yaml")), "tool catalog should retain manifest paths");
  assert(tools.every((tool) => tool.source === "builtin"), "builtin tool catalog should normalize source to builtin");
  assert(tools.find((tool) => tool.id === "convert_model")?.tier === "foundation", "convert_model should be the foundation tool");
  assert(tools.filter((tool) => tool.id !== "convert_model").every((tool) => tool.tier === "domain"), "non-foundation builtin tools should be domain tools");
  assert(tools.find((tool) => tool.id === "run_analysis")?.requiresTools.includes("validate_model"), "run_analysis should depend on validate_model");
  assert(tools.find((tool) => tool.id === "run_code_check")?.requiresTools.includes("run_analysis"), "run_code_check should depend on run_analysis");
  assert(tools.find((tool) => tool.id === "generate_report")?.requiresTools.includes("run_analysis"), "generate_report should depend on run_analysis");
  assert(tools.find((tool) => tool.id === "draft_model")?.displayName?.en === "Draft Structural Model", "draft_model should preserve bilingual text");

  console.log("[ok] agent tool catalog contract");
}

async function validateAgentSkillCatalogManifests(context) {
  await runBackendBuildOnce(context);

  const { AgentSkillCatalogService } = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "services", "agent-skill-catalog.js")).href
  );

  const service = new AgentSkillCatalogService();
  const skills = await service.listBuiltinSkills();
  const structureTypeSkills = skills.filter((skill) => skill.domain === "structure-type");
  const byId = new Map(structureTypeSkills.map((skill) => [skill.canonicalId, skill]));

  for (const skillId of ["generic", "beam", "truss", "frame", "portal-frame", "double-span-beam"]) {
    assert(byId.has(skillId), `skill catalog should include structure-type skill ${skillId}`);
    const skill = byId.get(skillId);
    assert(typeof skill.manifestPath === "string" && skill.manifestPath.endsWith("skill.yaml"), `${skillId} should retain its skill.yaml path`);
    assert(Array.isArray(skill.enabledTools) && skill.enabledTools.includes("draft_model"), `${skillId} should expose draft_model grant from skill.yaml`);
    assert(Array.isArray(skill.enabledTools) && skill.enabledTools.includes("update_model"), `${skillId} should expose update_model grant from skill.yaml`);
  }

  assert(byId.get("generic")?.triggers.includes("load"), "generic structure-type skill should preserve the manifest-level load trigger");
  const validationSkill = skills.find((skill) => skill.canonicalId === "validation-structure-model");
  assert(validationSkill, "skill catalog should include validation-structure-model");
  assert(typeof validationSkill.manifestPath === "string" && validationSkill.manifestPath.endsWith("skill.yaml"), "validation-structure-model should retain its skill.yaml path");
  assert(validationSkill.enabledTools.includes("validate_model"), "validation-structure-model should expose validate_model grant from skill.yaml");
  assert(validationSkill.aliases.includes("structure-json-validation"), "validation-structure-model should preserve legacy alias");

  const reportSkill = skills.find((skill) => skill.canonicalId === "report-export-builtin");
  assert(reportSkill, "skill catalog should include report-export-builtin");
  assert(typeof reportSkill.manifestPath === "string" && reportSkill.manifestPath.endsWith("skill.yaml"), "report-export-builtin should retain its skill.yaml path");
  assert(reportSkill.enabledTools.includes("generate_report"), "report-export-builtin should expose generate_report grant from skill.yaml");
  assert(reportSkill.triggers.includes("report"), "report-export-builtin should preserve report trigger");

  const analysisIds = [
    "opensees-dynamic",
    "opensees-nonlinear",
    "opensees-seismic",
    "opensees-static",
    "simplified-dynamic",
    "simplified-seismic",
    "simplified-static",
  ];
  for (const skillId of analysisIds) {
    const skill = skills.find((entry) => entry.canonicalId === skillId);
    assert(skill, `skill catalog should include analysis skill ${skillId}`);
    assert(typeof skill.manifestPath === "string" && skill.manifestPath.endsWith("skill.yaml"), `${skillId} should retain its skill.yaml path`);
    assert(skill.enabledTools.includes("run_analysis"), `${skillId} should expose run_analysis grant from skill.yaml`);
  }
  const codeCheckIds = [
    "code-check-gb50010",
    "code-check-gb50011",
    "code-check-gb50017",
    "code-check-jgj3",
  ];
  for (const skillId of codeCheckIds) {
    const skill = skills.find((entry) => entry.canonicalId === skillId);
    assert(skill, `skill catalog should include code-check skill ${skillId}`);
    assert(typeof skill.manifestPath === "string" && skill.manifestPath.endsWith("skill.yaml"), `${skillId} should retain its skill.yaml path`);
    assert(skill.enabledTools.includes("run_code_check"), `${skillId} should expose run_code_check grant from skill.yaml`);
  }
  const loadBoundaryIds = [
    "boundary-condition",
    "crane-load",
    "dead-load",
    "live-load",
    "load-combination",
    "nodal-constraint",
    "snow-load",
    "seismic-load",
    "temperature-load",
    "wind-load",
  ];
  for (const skillId of loadBoundaryIds) {
    const skill = skills.find((entry) => entry.canonicalId === skillId);
    assert(skill, `skill catalog should include load-boundary skill ${skillId}`);
    assert(typeof skill.manifestPath === "string" && skill.manifestPath.endsWith("skill.yaml"), `${skillId} should retain its skill.yaml path`);
  }
  assert(skills.find((entry) => entry.canonicalId === "dead-load")?.triggers.includes("恒载"), "dead-load should preserve load-boundary trigger metadata");
  const sectionIds = [
    "section-bridge",
    "section-common",
    "section-irregular",
  ];
  for (const skillId of sectionIds) {
    const skill = skills.find((entry) => entry.canonicalId === skillId);
    assert(skill, `skill catalog should include section skill ${skillId}`);
    assert(typeof skill.manifestPath === "string" && skill.manifestPath.endsWith("skill.yaml"), `${skillId} should retain its skill.yaml path`);
  }
  const visualizationIds = [
    "visualization-3d-scene",
    "visualization-frame-summary",
    "visualization-png-export",
  ];
  for (const skillId of visualizationIds) {
    const skill = skills.find((entry) => entry.canonicalId === skillId);
    assert(skill, `skill catalog should include visualization skill ${skillId}`);
    assert(typeof skill.manifestPath === "string" && skill.manifestPath.endsWith("skill.yaml"), `${skillId} should retain its skill.yaml path`);
  }
  console.log("[ok] agent skill catalog manifest contract");
}

async function validateAgentRuntimeLoader(context) {
  await runBackendBuildOnce(context);

  const { AgentSkillRuntime } = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-runtime", "index.js")).href
  );
  const analysisEntry = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-skills", "analysis", "entry.js")).href
  );
  const analysisRegistry = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-skills", "analysis", "registry.js")).href
  );
  const pythonAnalysisRegistrySource = await fsp.readFile(
    path.join(context.rootDir, "backend", "src", "agent-skills", "analysis", "runtime", "registry.py"),
    "utf8",
  );
  const sourceSkillRoot = path.join(context.rootDir, "backend", "src", "agent-skills");

  const collectStageMarkdownFiles = async (rootDir) => {
    const collected = [];
    const visit = async (currentDir) => {
      const entries = await fsp.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (["intent.md", "draft.md", "analysis.md", "design.md"].includes(entry.name)) {
          collected.push(entryPath);
        }
      }
    };
    await visit(rootDir);
    return collected.sort();
  };
  const collectFilesByBasename = async (rootDir, fileName) => {
    const collected = [];
    const visit = async (currentDir) => {
      const entries = await fsp.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }
        if (entry.isFile() && entry.name === fileName) {
          collected.push(entryPath);
        }
      }
    };
    await visit(rootDir);
    return collected.sort();
  };

  const runtime = new AgentSkillRuntime();
  const skills = runtime.listSkills();
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const runtimeManifests = await runtime.listSkillManifests();
  const runtimeManifestById = new Map(runtimeManifests.map((manifest) => [manifest.id, manifest]));

  assert(byId.has("beam"), "runtime loader should include manifest-backed beam skill");
  assert(byId.get("beam")?.domain === "structure-type", "beam should take domain from skill.yaml");
  assert(byId.has("opensees-static"), "runtime loader should include manifest-backed analysis skill");
  assert(byId.get("opensees-static")?.domain === "analysis", "analysis skills should take domain from skill.yaml");
  assert(byId.has("code-check-gb50010"), "runtime loader should include manifest-backed code-check skill");
  assert(byId.get("code-check-gb50010")?.domain === "code-check", "code-check skills should take domain from skill.yaml");
  assert(byId.has("dead-load"), "runtime loader should include manifest-backed load-boundary skill");
  assert(byId.get("dead-load")?.domain === "load-boundary", "load-boundary skills should take domain from skill.yaml");
  assert(byId.has("snow-load"), "runtime loader should include manifest-backed snow-load skill");
  assert(byId.get("snow-load")?.domain === "load-boundary", "snow-load should take domain from skill.yaml");
  assert(byId.has("visualization-frame-summary"), "runtime loader should include manifest-backed visualization skill");
  assert(byId.get("visualization-frame-summary")?.domain === "visualization", "visualization skills should take domain from skill.yaml");
  assert(byId.has("section-common"), "runtime loader should include manifest-backed section-common skill");
  assert(byId.get("section-common")?.domain === "section", "section-common should take domain from skill.yaml");
  assert(byId.has("section-bridge"), "runtime loader should include manifest-backed section-bridge skill");
  assert(byId.get("section-bridge")?.domain === "section", "section-bridge should take domain from skill.yaml");
  assert(byId.has("section-irregular"), "runtime loader should include manifest-backed section-irregular skill");
  assert(byId.get("section-irregular")?.domain === "section", "section-irregular should take domain from skill.yaml");
  assert(byId.has("validation-structure-model"), "runtime loader should use canonical validation skill id from skill.yaml");
  assert(!byId.has("structure-json-validation"), "runtime loader should not keep legacy validation frontmatter id once manifest-first loader is active");
  assert(Array.isArray(runtimeManifestById.get("beam")?.supportedModelFamilies), "structure-type runtime manifests should come from skill.yaml rather than plugin-only manifests");
  assert(Array.isArray(runtimeManifestById.get("beam")?.providedTools), "runtime manifests should normalize optional tool arrays from skill.yaml");
  assert(Array.isArray(runtimeManifestById.get("beam")?.materialFamilies), "runtime manifests should preserve manifest schema defaults for structure-type skills");

  const stageMarkdownFiles = await collectStageMarkdownFiles(sourceSkillRoot);
  assert(stageMarkdownFiles.length > 0, "runtime loader validation should inspect builtin stage markdown files");
  for (const markdownPath of stageMarkdownFiles) {
    const source = await fsp.readFile(markdownPath, "utf8");
    assert(!source.trimStart().startsWith("---\n"), `${path.relative(context.rootDir, markdownPath)} should not keep legacy YAML frontmatter`);
  }
  const structureTypeManifestFiles = await collectFilesByBasename(
    path.join(sourceSkillRoot, "structure-type"),
    "manifest.ts",
  );
  assert(structureTypeManifestFiles.length === 0, "structure-type skills should no longer keep manifest.ts once runtime loading is manifest-first");

  const builtinTools = runtime.listBuiltinToolManifests();
  const builtinToolsById = new Map(builtinTools.map((tool) => [tool.id, tool]));
  assert(builtinToolsById.get("convert_model")?.tier === "foundation", "runtime builtin tools should take tier metadata from tool.yaml");
  assert(builtinToolsById.get("run_analysis")?.tier === "domain", "runtime builtin tools should preserve domain-tier metadata from tool.yaml");
  assert(Array.isArray(builtinToolsById.get("run_analysis")?.requiresTools) && builtinToolsById.get("run_analysis").requiresTools.includes("validate_model"), "runtime builtin tools should preserve requiresTools metadata from tool.yaml");

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "structureclaw-runtime-selection-"));
  try {
    const manifestOnlySkillRoot = path.join(tempRoot, "agent-skills");
    await fsp.mkdir(path.join(manifestOnlySkillRoot, "analysis", "custom-static"), { recursive: true });
    await fsp.mkdir(path.join(manifestOnlySkillRoot, "code-check", "custom-gb50018"), { recursive: true });

    await fsp.writeFile(
      path.join(manifestOnlySkillRoot, "analysis", "custom-static", "skill.yaml"),
      [
        "id: custom-static",
        "domain: analysis",
        "source: builtin",
        "name:",
        "  zh: 自定义静力分析",
        "  en: Custom Static Analysis",
        "description:",
        "  zh: 仅通过 skill.yaml 声明的静力分析技能。",
        "  en: Static analysis skill declared only via skill.yaml.",
        "triggers: []",
        "stages:",
        "  - analysis",
        "structureType: frame",
        "structuralTypeKeys: []",
        "capabilities:",
        "  - analysis-policy",
        "  - analysis-execution",
        "grants:",
        "  - run_analysis",
        "providesTools: []",
        "requires: []",
        "conflicts: []",
        "autoLoadByDefault: false",
        "priority: 999",
        "compatibility:",
        "  minRuntimeVersion: 0.1.0",
        "  skillApiVersion: v1",
        "software: simplified",
        "analysisType: static",
        "engineId: builtin-custom",
        "adapterKey: builtin-custom",
        "runtimeRelativePath: runtime.py",
        "supportedAnalysisTypes:",
        "  - static",
        "supportedModelFamilies:",
        "  - frame",
        "  - generic",
        "materialFamilies: []",
        "",
      ].join("\n"),
    );

    await fsp.writeFile(
      path.join(manifestOnlySkillRoot, "code-check", "custom-gb50018", "skill.yaml"),
      [
        "id: code-check-gb50018",
        "domain: code-check",
        "source: builtin",
        "name:",
        "  zh: GB50018 规范校核",
        "  en: GB50018 Code Check",
        "description:",
        "  zh: 仅通过 skill.yaml 声明的规范校核技能。",
        "  en: Code-check skill declared only via skill.yaml.",
        "triggers:",
        "  - GB50018",
        "stages:",
        "  - design",
        "structureType: unknown",
        "structuralTypeKeys: []",
        "capabilities:",
        "  - code-check-policy",
        "  - code-check-execution",
        "grants:",
        "  - run_code_check",
        "providesTools: []",
        "requires: []",
        "conflicts: []",
        "autoLoadByDefault: false",
        "priority: 999",
        "compatibility:",
        "  minRuntimeVersion: 0.1.0",
        "  skillApiVersion: v1",
        "designCode: GB50018",
        "supportedAnalysisTypes: []",
        "supportedModelFamilies:",
        "  - generic",
        "materialFamilies: []",
        "",
      ].join("\n"),
    );

    const manifestOnlyRuntime = new AgentSkillRuntime({ builtinSkillManifestRoot: manifestOnlySkillRoot });
    assert(manifestOnlyRuntime.listAnalysisSkillIds().includes("custom-static"), "analysis skill ids should be resolved from skill.yaml without registry/frontmatter metadata");
    assert(manifestOnlyRuntime.isAnalysisSkillId("custom-static"), "isAnalysisSkillId should recognize manifest-only analysis skills");
    assert(
      manifestOnlyRuntime.resolvePreferredAnalysisSkill({
        analysisType: "static",
        engineId: "builtin-custom",
        supportedModelFamilies: ["frame"],
      })?.id === "custom-static",
      "preferred analysis skill resolution should use manifest-only analysis metadata",
    );
    assert(
      manifestOnlyRuntime.resolveCodeCheckDesignCodeFromSkillIds(["code-check-gb50018"]) === "GB50018",
      "code-check design-code resolution should use manifest-only skill metadata",
    );
    assert(
      manifestOnlyRuntime.resolveCodeCheckSkillId("GB50018") === "code-check-gb50018",
      "code-check skill lookup should use manifest-only skill metadata",
    );
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
  assert(typeof analysisEntry.listBuiltinAnalysisSkills === "undefined", "analysis entry should not re-export static metadata helpers once manifest-first runtime is active");
  assert(typeof analysisEntry.getBuiltinAnalysisSkill === "undefined", "analysis entry should not expose builtin analysis metadata lookup");
  assert(typeof analysisEntry.resolvePreferredBuiltinAnalysisSkill === "undefined", "analysis entry should not expose manifest selection logic directly");
  assert(typeof analysisRegistry.listBuiltinAnalysisSkills === "undefined", "analysis registry should not export static metadata helpers once manifest-first runtime is active");
  assert(typeof analysisRegistry.getBuiltinAnalysisSkill === "undefined", "analysis registry should not expose builtin analysis metadata lookup");
  assert(typeof analysisRegistry.resolvePreferredBuiltinAnalysisSkill === "undefined", "analysis registry should not expose manifest selection logic directly");
  assert(
    pythonAnalysisRegistrySource.includes("skill.yaml"),
    "python analysis runtime registry should discover builtin skills from skill.yaml",
  );
  assert(
    !pythonAnalysisRegistrySource.includes("intent.md"),
    "python analysis runtime registry should not depend on intent.md frontmatter metadata",
  );
  console.log("[ok] agent runtime loader contract");
}

async function validateAgentRuntimeBinder(context) {
  await runBackendBuildOnce(context);

  const agentSource = await fsp.readFile(
    path.join(context.rootDir, "backend", "src", "services", "agent.ts"),
    "utf8",
  );
  const { AgentRuntimeBinder } = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "services", "agent-runtime-binder.js")).href
  );

  const makeLocalizedText = (zh, en) => ({ zh, en });
  const compatibility = { minRuntimeVersion: "0.1.0", skillApiVersion: "v1" };
  const makeManifest = (id, domain, options = {}) => ({
    id,
    domain,
    name: options.name ?? makeLocalizedText(`${id} 技能`, `${id} skill`),
    description: options.description ?? makeLocalizedText(`${id} 描述`, `${id} description`),
    triggers: options.triggers ?? [id],
    stages: options.stages ?? ["analysis"],
    autoLoadByDefault: options.autoLoadByDefault ?? false,
    structureType: options.structureType ?? "unknown",
    structuralTypeKeys: options.structuralTypeKeys ?? [],
    requires: options.requires ?? [],
    conflicts: options.conflicts ?? [],
    capabilities: options.capabilities ?? [],
    enabledTools: options.enabledTools ?? [],
    providedTools: options.providedTools ?? [],
    supportedAnalysisTypes: options.supportedAnalysisTypes ?? [],
    supportedModelFamilies: options.supportedModelFamilies ?? ["generic"],
    materialFamilies: options.materialFamilies ?? [],
    priority: options.priority ?? 0,
    compatibility,
  });
  const makeTool = (id, options = {}) => ({
    id,
    source: options.source ?? "builtin",
    enabledByDefault: options.enabledByDefault ?? false,
    tier: options.tier ?? "domain",
    category: options.category ?? "utility",
    displayName: options.displayName ?? makeLocalizedText(id, id),
    description: options.description ?? makeLocalizedText(`${id} 工具`, `${id} tool`),
    requiresSkills: options.requiresSkills ?? [],
    requiresTools: options.requiresTools ?? [],
    tags: options.tags ?? [],
    errorCodes: options.errorCodes ?? [],
  });

  const manifests = [
    makeManifest("beam", "structure-type", {
      stages: ["intent", "draft", "analysis"],
      structureType: "beam",
      autoLoadByDefault: true,
      providedTools: ["draft_model", "update_model"],
      supportedModelFamilies: ["frame", "generic"],
    }),
    makeManifest("validation-structure-model", "validation", {
      stages: ["draft", "analysis"],
      autoLoadByDefault: true,
      providedTools: ["validate_model"],
    }),
    makeManifest("analysis-static", "analysis", {
      autoLoadByDefault: false,
      providedTools: ["run_analysis"],
      supportedAnalysisTypes: ["static"],
      supportedModelFamilies: ["frame", "generic"],
    }),
    makeManifest("code-check-gb50010", "code-check", {
      stages: ["design"],
      autoLoadByDefault: false,
      providedTools: ["run_code_check"],
    }),
    makeManifest("report-export-builtin", "report-export", {
      stages: ["design"],
      autoLoadByDefault: false,
      providedTools: ["generate_report"],
    }),
  ];

  const builtinTools = [
    makeTool("convert_model", { tier: "foundation", enabledByDefault: true }),
    makeTool("draft_model", { category: "modeling", requiresSkills: ["beam"] }),
    makeTool("update_model", { category: "modeling", requiresSkills: ["beam"] }),
    makeTool("validate_model", { category: "utility", requiresSkills: ["validation-structure-model"] }),
    makeTool("run_analysis", {
      category: "analysis",
      requiresSkills: ["analysis-static"],
      requiresTools: ["validate_model"],
    }),
    makeTool("run_code_check", {
      category: "code-check",
      requiresSkills: ["code-check-gb50010"],
      requiresTools: ["run_analysis"],
    }),
    makeTool("generate_report", {
      category: "report",
      requiresSkills: ["report-export-builtin"],
      requiresTools: ["run_analysis"],
    }),
  ];

  const buildResolvedTooling = (skillIds) => {
    const selectedManifests = skillIds === undefined
      ? manifests.filter((manifest) => manifest.autoLoadByDefault)
      : manifests.filter((manifest) => skillIds.includes(manifest.id));
    const toolsById = new Map();
    const skillIdsByToolId = {};
    const enabledToolIdsBySkill = {};
    const providedToolIdsBySkill = {};

    for (const manifest of selectedManifests) {
      const enabledToolIds = Array.isArray(manifest.enabledTools) ? [...manifest.enabledTools] : [];
      const providedToolIds = Array.isArray(manifest.providedTools) ? [...manifest.providedTools] : [];
      enabledToolIdsBySkill[manifest.id] = enabledToolIds;
      providedToolIdsBySkill[manifest.id] = providedToolIds;
      for (const toolId of [...enabledToolIds, ...providedToolIds]) {
        if (!skillIdsByToolId[toolId]) {
          skillIdsByToolId[toolId] = [];
        }
        if (!skillIdsByToolId[toolId].includes(manifest.id)) {
          skillIdsByToolId[toolId].push(manifest.id);
        }
        const builtin = builtinTools.find((tool) => tool.id === toolId);
        if (builtin) {
          toolsById.set(toolId, builtin);
        }
      }
    }

    return {
      tools: [...toolsById.values()],
      enabledToolIdsBySkill,
      providedToolIdsBySkill,
      skillIdsByToolId,
    };
  };

  const fakeSkillRuntime = {
    listSkillManifests: async () => manifests,
    resolvePreferredAnalysisSkill: () => ({ id: "analysis-static" }),
    resolveCodeCheckDesignCodeFromSkillIds: () => undefined,
    resolveCodeCheckSkillId: (designCode) => designCode === "GB50010" ? "code-check-gb50010" : undefined,
    resolveSkillTooling: async (skillIds) => buildResolvedTooling(skillIds),
    listBuiltinToolManifests: () => builtinTools,
  };
  const fakePolicy = {
    inferExecutionIntent: (message) => /分析|analysis/i.test(message),
    inferProceedIntent: () => false,
  };

  const binder = new AgentRuntimeBinder(fakeSkillRuntime, fakePolicy);
  const activeSkillIds = await binder.resolveActiveDomainSkillIds({
    selectedSkillIds: ["beam"],
    workingSession: {
      updatedAt: Date.now(),
      resolved: {
        analysisType: "static",
        designCode: "GB50010",
        autoCodeCheck: true,
        includeReport: true,
      },
    },
    modelInput: {
      elements: [{ type: "beam" }],
    },
    message: "请分析这个模型并给出报告",
    context: {
      autoAnalyze: true,
      designCode: "GB50010",
      includeReport: true,
    },
  });
  assert(Array.isArray(activeSkillIds), "runtime binder should resolve active skill ids");
  assert(activeSkillIds.includes("beam"), "runtime binder should preserve explicitly selected skills");
  assert(activeSkillIds.includes("validation-structure-model"), "runtime binder should auto-activate validation skill");
  assert(activeSkillIds.includes("analysis-static"), "runtime binder should auto-activate preferred analysis skill");
  assert(activeSkillIds.includes("code-check-gb50010"), "runtime binder should auto-activate code-check skill when design code is available");
  assert(activeSkillIds.includes("report-export-builtin"), "runtime binder should auto-activate report skill when report output is requested");

  const availableTooling = await binder.resolveAvailableTooling(["beam"], activeSkillIds);
  assert(availableTooling.tools.some((tool) => tool.id === "draft_model"), "runtime binder should expose selected-skill tools");
  assert(availableTooling.tools.some((tool) => tool.id === "run_analysis"), "runtime binder should expose active-skill tools");
  assert(Array.isArray(availableTooling.skillIdsByToolId.run_analysis) && availableTooling.skillIdsByToolId.run_analysis.includes("analysis-static"), "runtime binder should attribute tools to their activating skills");

  const activeToolIds = await binder.resolveActiveToolIds(["beam"], activeSkillIds, {
    disabledToolIds: ["generate_report"],
  });
  assert(activeToolIds.has("convert_model"), "runtime binder should always retain foundation tools");
  assert(activeToolIds.has("run_analysis"), "runtime binder should activate granted tools");
  assert(!activeToolIds.has("generate_report"), "runtime binder should honor disabled tool overrides");

  assert(agentSource.includes("AgentRuntimeBinder"), "AgentService should delegate runtime binding to AgentRuntimeBinder");
  assert(!agentSource.includes("private async resolveActiveDomainSkillIds("), "AgentService should not keep active-skill binding logic inline");
  assert(!agentSource.includes("private async resolveAvailableTooling("), "AgentService should not keep available-tooling binding logic inline");
  assert(!agentSource.includes("private async resolveActiveToolIds("), "AgentService should not keep active-tool binding logic inline");
  console.log("[ok] agent runtime binder contract");
}

async function validateAgentToolsContract(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);
  const app = Fastify();
  await app.register(agentRoutes, { prefix: "/api/v1/agent" });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/agent/tools",
  });
  assert(response.statusCode === 200, "agent/tools should return 200");

  const payload = response.json();
  assert(payload.version === "2.0.0", "protocol version should be 2.0.0");
  assert(Array.isArray(payload.tools), "tools should be array");
  assert(payload.tools.every((tool) => typeof tool.id === "string" && tool.id.length > 0), "tool specs should expose canonical ids");

  const toolNames = payload.tools.map((tool) => tool.name);
  for (const requiredTool of ["draft_model", "update_model", "convert_model", "validate_model", "run_analysis", "run_code_check", "generate_report"]) {
    assert(toolNames.includes(requiredTool), `missing required tool: ${requiredTool}`);
  }

  const requestContext = payload.runRequestSchema?.properties?.context?.properties || {};
  assert(payload.runRequestSchema?.properties?.traceId?.type === "string", "runRequestSchema should include traceId");
  assert(requestContext.enabledToolIds?.type === "array", "runRequestSchema should include enabledToolIds");
  assert(requestContext.disabledToolIds?.type === "array", "runRequestSchema should include disabledToolIds");
  assert(requestContext.reportOutput?.enum?.includes("file"), "runRequestSchema should include reportOutput=file");
  assert(requestContext.reportFormat?.enum?.includes("both"), "runRequestSchema should include reportFormat=both");

  const reportTool = payload.tools.find((tool) => tool.name === "generate_report");
  assert(reportTool, "report tool spec should exist");
  assert(reportTool.inputSchema?.required?.includes("analysis"), "report tool input should require analysis");
  assert(reportTool.outputSchema?.properties?.json?.type === "object", "report output should include json object");

  const runResult = payload.runResultSchema?.properties || {};
  assert(runResult.startedAt?.type === "string", "runResultSchema should include startedAt");
  assert(runResult.completedAt?.type === "string", "runResultSchema should include completedAt");
  assert(runResult.artifacts?.type === "array", "runResultSchema should include artifacts array");
  assert(runResult.metrics?.type === "object", "runResultSchema should include metrics object");
  assert(runResult.metrics?.properties?.totalToolDurationMs?.type === "number", "metrics should include totalToolDurationMs");
  assert(runResult.metrics?.properties?.toolDurationMsByName?.type === "object", "metrics should include toolDurationMsByName");

  await app.close();
  console.log("[ok] agent tools protocol contract");
}

async function validateAgentApiContract(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const AgentService = await importBackendAgentService(context.rootDir);
  const captured = [];
  const originalRun = AgentService.prototype.run;
  const mockRun = async function mockRun(params) {
    captured.push(params);
    return {
      traceId: "trace-api-contract",
      startedAt: "2026-03-09T00:00:00.000Z",
      completedAt: "2026-03-09T00:00:00.012Z",
      durationMs: 12,
      success: true,
      orchestrationMode: "llm-planned",
      needsModelInput: false,
      plan: ["validate_model", "run_analysis", "generate_report"],
      toolCalls: [
        { tool: "validate_model", input: {}, status: "success", startedAt: new Date().toISOString() },
        { tool: "run_analysis", input: {}, status: "success", startedAt: new Date().toISOString() },
        { tool: "generate_report", input: {}, status: "success", startedAt: new Date().toISOString() },
      ],
      response: "ok",
      report: {
        summary: "ok",
        json: { k: "v" },
      },
      artifacts: [{ type: "report", format: "json", path: "/tmp/report.json" }],
      metrics: {
        toolCount: 3,
        failedToolCount: 0,
        totalToolDurationMs: 10,
        averageToolDurationMs: 3.3,
        maxToolDurationMs: 5,
        toolDurationMsByName: { validate_model: 2, run_analysis: 3, generate_report: 5 },
      },
    };
  };
  AgentService.prototype.run = mockRun;

  let app;
  try {
    const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);
    const { chatRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "chat.js")).href);

    app = Fastify();
    await app.register(agentRoutes, { prefix: "/api/v1/agent" });
    await app.register(chatRoutes, { prefix: "/api/v1/chat" });

    const requestBody = {
      message: "请分析并导出报告",
      conversationId: "conv-api-1",
      traceId: "trace-request-001",
      context: {
        autoAnalyze: true,
        autoCodeCheck: true,
        includeReport: true,
        reportFormat: "both",
        reportOutput: "file",
      },
    };

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agent/run",
      payload: requestBody,
    });
    assert(runResponse.statusCode === 200, "agent/run should return 200");
    const runPayload = runResponse.json();
    assert(runPayload.traceId === "trace-api-contract", "agent/run should return traceId");
    assert(typeof runPayload.startedAt === "string", "agent/run should return startedAt");
    assert(typeof runPayload.completedAt === "string", "agent/run should return completedAt");
    assert(Array.isArray(runPayload.toolCalls), "agent/run should include toolCalls");
    assert(runPayload.metrics?.toolCount === 3, "agent/run should include metrics");
    assert(runPayload.metrics?.maxToolDurationMs === 5, "agent/run should include expanded metrics");

    const chatMessageResponse = await app.inject({
      method: "POST",
      url: "/api/v1/chat/message",
      payload: requestBody,
    });
    assert(chatMessageResponse.statusCode === 200, "chat/message should return 200");
    const chatMessagePayload = chatMessageResponse.json();
    assert(chatMessagePayload.result?.traceId === "trace-api-contract", "chat/message should proxy agent result");
    assert(chatMessagePayload.result?.artifacts?.[0]?.path === "/tmp/report.json", "chat/message should return artifacts");

    const legacyToolCallResponse = await app.inject({
      method: "POST",
      url: "/api/v1/chat/tool-call",
      payload: requestBody,
    });
    assert(legacyToolCallResponse.statusCode === 404, "chat/tool-call should no longer be exposed");

    assert(captured.length >= 2, "agent run should be called for both endpoints");
    assert(captured[0]?.traceId === "trace-request-001", "agent/run should pass traceId");
    assert(captured[1]?.traceId === "trace-request-001", "chat/message should pass traceId");
    assert(captured[0]?.context?.reportOutput === "file", "agent/run should pass reportOutput context");
    assert(captured[1]?.context?.reportFormat === "both", "chat/message should pass reportFormat context");

    console.log("[ok] agent api contract regression");
  } finally {
    AgentService.prototype.run = originalRun;
    if (app) {
      await app.close();
    }
  }
}

async function validateAgentCapabilityMatrix(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");

  const { AnalysisEngineCatalogService } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "services", "analysis-engine.js")).href);
  const { AgentSkillRuntime } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-runtime", "index.js")).href);
  const originalListSkillManifests = AgentSkillRuntime.prototype.listSkillManifests;
  const originalListEngines = AnalysisEngineCatalogService.prototype.listEngines;

  AgentSkillRuntime.prototype.listSkillManifests = async function mockListSkillManifests() {
    return [
      {
        id: "beam",
        structureType: "beam",
        domain: "structure-type",
        name: { zh: "梁", en: "Beam" },
        description: { zh: "beam", en: "beam" },
        triggers: ["beam"],
        stages: ["intent", "draft", "analysis", "design"],
        autoLoadByDefault: true,
        structuralTypeKeys: ["beam"],
        requires: [],
        conflicts: [],
        capabilities: ["intent-detection"],
        enabledTools: ["draft_model", "update_model"],
        priority: 10,
        compatibility: {
          minRuntimeVersion: "0.1.0",
          skillApiVersion: "v1",
        },
      },
      {
        id: "truss",
        structureType: "truss",
        domain: "structure-type",
        name: { zh: "桁架", en: "Truss" },
        description: { zh: "truss", en: "truss" },
        triggers: ["truss"],
        stages: ["intent", "draft", "analysis", "design"],
        autoLoadByDefault: true,
        structuralTypeKeys: ["truss"],
        requires: [],
        conflicts: [],
        capabilities: ["intent-detection"],
        enabledTools: ["draft_model", "update_model"],
        priority: 20,
        compatibility: {
          minRuntimeVersion: "0.1.0",
          skillApiVersion: "v1",
        },
      },
      {
        id: "analysis-baseline",
        structureType: "beam",
        domain: "analysis",
        name: { zh: "分析基线", en: "Analysis Baseline" },
        description: { zh: "analysis", en: "analysis" },
        triggers: ["analysis"],
        stages: ["analysis"],
        autoLoadByDefault: true,
        structuralTypeKeys: ["beam"],
        requires: [],
        conflicts: [],
        capabilities: ["analysis-policy"],
        enabledTools: ["run_analysis"],
        supportedAnalysisTypes: ["static", "dynamic"],
        priority: 5,
        compatibility: {
          minRuntimeVersion: "0.1.0",
          skillApiVersion: "v1",
        },
      },
    ];
  };

  AnalysisEngineCatalogService.prototype.listEngines = async function mockListEngines() {
    return {
      engines: [
        {
          id: "engine-frame-a",
          name: "Frame Engine A",
          enabled: true,
          available: true,
          status: "available",
          supportedModelFamilies: ["frame"],
          supportedAnalysisTypes: ["static", "dynamic"],
        },
        {
          id: "engine-truss-a",
          name: "Truss Engine A",
          enabled: true,
          available: true,
          status: "available",
          supportedModelFamilies: ["truss"],
          supportedAnalysisTypes: ["static"],
        },
        {
          id: "engine-generic",
          name: "Generic Engine",
          enabled: true,
          available: true,
          status: "available",
          supportedModelFamilies: ["generic"],
          supportedAnalysisTypes: ["static", "dynamic", "seismic", "nonlinear"],
        },
        {
          id: "engine-disabled",
          name: "Disabled Engine",
          enabled: false,
          available: true,
          status: "disabled",
          supportedModelFamilies: ["frame", "truss", "generic"],
          supportedAnalysisTypes: ["static"],
        },
      ],
    };
  };

  let app;
  try {
    const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);
    app = Fastify();
    await app.register(agentRoutes, { prefix: "/api/v1/agent" });

    const response = await app.inject({ method: "GET", url: "/api/v1/agent/capability-matrix" });
    assert(response.statusCode === 200, "capability matrix route should return 200");
    const payload = response.json();
    assert(typeof payload.generatedAt === "string", "payload.generatedAt should be present");
    assert(Array.isArray(payload.skills), "payload.skills should be an array");
    assert(Array.isArray(payload.tools), "payload.tools should be an array");
    assert(Array.isArray(payload.engines), "payload.engines should be an array");
    assert(Array.isArray(payload.domainSummaries), "payload.domainSummaries should be an array");
    assert(payload.validEngineIdsBySkill && typeof payload.validEngineIdsBySkill === "object", "validEngineIdsBySkill should be an object");
    assert(payload.filteredEngineReasonsBySkill && typeof payload.filteredEngineReasonsBySkill === "object", "filteredEngineReasonsBySkill should be an object");
    assert(payload.validSkillIdsByEngine && typeof payload.validSkillIdsByEngine === "object", "validSkillIdsByEngine should be an object");
    assert(payload.skillDomainById && typeof payload.skillDomainById === "object", "skillDomainById should be an object");
    assert(Array.isArray(payload.foundationToolIds), "foundationToolIds should be an array");
    assert(payload.enabledToolIdsBySkill && typeof payload.enabledToolIdsBySkill === "object", "enabledToolIdsBySkill should be an object");
    assert(payload.providedToolIdsBySkill && typeof payload.providedToolIdsBySkill === "object", "providedToolIdsBySkill should be an object");
    assert(payload.skillIdsByToolId && typeof payload.skillIdsByToolId === "object", "skillIdsByToolId should be an object");
    assert(payload.analysisCompatibility && typeof payload.analysisCompatibility === "object", "analysisCompatibility should be an object");

    const engineIds = new Set(payload.engines.map((engine) => engine.id));
    const skillIds = new Set(payload.skills.map((skill) => skill.id));
    const toolIds = new Set(payload.tools.map((tool) => tool.id));
    const domainSummaryById = Object.fromEntries(payload.domainSummaries.map((summary) => [summary.domain, summary]));

    assert(payload.skills.every((skill) => typeof skill.runtimeStatus === "string"), "skills should expose runtimeStatus");
    assert(payload.domainSummaries.every((summary) => typeof summary.runtimeStatus === "string"), "domain summaries should expose runtimeStatus");
    assert(payload.domainSummaries.length >= 14, "domain summaries should cover the full domain taxonomy");

  for (const skillId of skillIds) {
    assert(Array.isArray(payload.validEngineIdsBySkill[skillId]), `validEngineIdsBySkill should include array for ${skillId}`);
    for (const engineId of payload.validEngineIdsBySkill[skillId]) {
      assert(engineIds.has(engineId), `mapped engine ${engineId} should exist in engines list`);
      assert(Array.isArray(payload.validSkillIdsByEngine[engineId]), `reverse map should include engine ${engineId}`);
      assert(payload.validSkillIdsByEngine[engineId].includes(skillId), `reverse map for ${engineId} should include ${skillId}`);
    }
  }

  const beamEngines = payload.validEngineIdsBySkill.beam || [];
  const trussEngines = payload.validEngineIdsBySkill.truss || [];
  assert(payload.skillDomainById.beam === "structure-type", "beam should have structure-type domain mapping");
  assert(payload.skillDomainById.truss === "structure-type", "truss should have structure-type domain mapping");
  assert(toolIds.has("draft_model"), "capability matrix should expose draft_model tool");
  assert(toolIds.has("update_model"), "capability matrix should expose update_model tool");
  assert(toolIds.has("convert_model"), "capability matrix should expose convert_model tool");
  assert(toolIds.has("run_analysis"), "capability matrix should expose run_analysis tool");
  assert(payload.foundationToolIds.includes("convert_model"), "foundation tool list should include convert_model");
  const draftTool = payload.tools.find((tool) => tool.id === "draft_model");
  const analysisTool = payload.tools.find((tool) => tool.id === "run_analysis");
  assert(draftTool?.source === "builtin", "draft_model should project builtin source from tool catalog");
  assert(analysisTool?.source === "builtin", "run_analysis should project builtin source from tool catalog");
  assert(!Object.prototype.hasOwnProperty.call(draftTool || {}, "runtimeName"), "capability matrix should not expose runtimeName");
  assert(!Object.prototype.hasOwnProperty.call(draftTool || {}, "compatibilityRuntimeName"), "capability matrix should not expose compatibility runtime aliases");
  assert(Array.isArray(analysisTool?.requiresTools), "run_analysis should expose requiresTools");
  assert(analysisTool?.requiresTools.includes("validate_model"), "run_analysis should depend on validate_model");
  assert(Array.isArray(payload.enabledToolIdsBySkill.beam), "beam should expose enabled tools array");
  assert(payload.enabledToolIdsBySkill.beam.includes("draft_model"), "beam should enable draft_model");
  assert(payload.enabledToolIdsBySkill.beam.includes("update_model"), "beam should enable update_model");
  assert(!payload.enabledToolIdsBySkill.beam.includes("run_analysis"), "beam should not enable run_analysis directly");
  assert(payload.enabledToolIdsBySkill["analysis-baseline"].includes("run_analysis"), "analysis skills should enable run_analysis");
  assert(beamEngines.includes("engine-frame-a"), "beam should include frame-compatible engine");
  assert(beamEngines.includes("engine-generic"), "beam should include generic engine");
  assert(!beamEngines.includes("engine-disabled"), "beam should not include disabled engine");
  assert(trussEngines.includes("engine-truss-a"), "truss should include truss-compatible engine");
  assert(trussEngines.includes("engine-generic"), "truss should include generic engine");
  assert(payload.filteredEngineReasonsBySkill.beam["engine-truss-a"].includes("model_family_mismatch"), "beam should mark truss engine as family mismatch");
  assert(payload.filteredEngineReasonsBySkill.beam["engine-disabled"].includes("engine_disabled"), "beam should mark disabled engine reason");
  assert(payload.filteredEngineReasonsBySkill.truss["engine-frame-a"].includes("model_family_mismatch"), "truss should mark frame engine as family mismatch");
  assert(Array.isArray(payload.analysisCompatibility.static.skillIds), "static analysis skill IDs should be an array");
  assert(payload.analysisCompatibility.static.skillIds.includes("analysis-baseline"), "static analysis compatibility should include baseline analysis skill");
  assert(payload.analysisCompatibility.dynamic.skillIds.includes("analysis-baseline"), "dynamic analysis compatibility should include baseline analysis skill");
  assert(!payload.analysisCompatibility.seismic.skillIds.includes("analysis-baseline"), "seismic analysis compatibility should exclude unsupported analysis skill");
  assert(payload.analysisCompatibility.static.baselinePolicyAvailable === true, "baseline policy should be available for static");
  assert(payload.skills.find((skill) => skill.id === "beam")?.runtimeStatus === "active", "beam should be marked active");
  assert(payload.skills.find((skill) => skill.id === "analysis-baseline")?.runtimeStatus === "active", "analysis skill should be marked active");
  assert(payload.skillDomainById["dead-load"] === "load-boundary", "discoverable load-boundary skills should be exposed in skillDomainById");
  assert(payload.skillDomainById["section-common"] === "section", "discoverable section skills should be exposed in skillDomainById");
  assert(payload.skillDomainById["visualization-frame-summary"] === "visualization", "discoverable visualization skills should be exposed in skillDomainById");
  assert(payload.skills.find((skill) => skill.id === "dead-load")?.runtimeStatus === "discoverable", "dead-load should be marked discoverable");
  assert(payload.skills.find((skill) => skill.id === "section-common")?.runtimeStatus === "discoverable", "section-common should be marked discoverable");
  assert(payload.skills.find((skill) => skill.id === "visualization-frame-summary")?.runtimeStatus === "discoverable", "visualization-frame-summary should be marked discoverable");
  assert(domainSummaryById["structure-type"]?.runtimeStatus === "active", "structure-type domain should be active");
  assert(domainSummaryById["analysis"]?.runtimeStatus === "active", "analysis domain should be active");
  assert(domainSummaryById["validation"]?.runtimeStatus === "partial", "validation domain should be partial");
  assert(domainSummaryById["report-export"]?.runtimeStatus === "partial", "report-export domain should be partial");
  assert(domainSummaryById["section"]?.runtimeStatus === "discoverable", "section domain should remain discoverable while builtin skills exist");
  assert(domainSummaryById["load-boundary"]?.runtimeStatus === "discoverable", "load-boundary domain should remain discoverable while builtin skills exist");
  assert(domainSummaryById["visualization"]?.runtimeStatus === "discoverable", "visualization domain should remain discoverable while builtin skills exist");
  assert(domainSummaryById["design"]?.runtimeStatus === "reserved", "design domain should be reserved when it has no runtime skill presence");
  assert(domainSummaryById["data-input"]?.runtimeStatus === "reserved", "data-input domain should be reserved when it has no runtime skill presence");
  assert(domainSummaryById["drawing"]?.runtimeStatus === "reserved", "drawing domain should be reserved when it has no runtime skill presence");
  assert(domainSummaryById["general"]?.runtimeStatus === "reserved", "general domain should be reserved when it has no runtime skill presence");
  assert(domainSummaryById["material"]?.runtimeStatus === "reserved", "material domain should be reserved when it has no runtime skill presence");
  assert(domainSummaryById["result-postprocess"]?.runtimeStatus === "reserved", "result-postprocess domain should be reserved when it has no runtime skill presence");
  assert(domainSummaryById["load-boundary"]?.skillIds.includes("dead-load"), "load-boundary summary should include discoverable builtin skills");
  assert(domainSummaryById["section"]?.skillIds.includes("section-common"), "section summary should include discoverable builtin skills");
  assert(domainSummaryById["visualization"]?.skillIds.includes("visualization-frame-summary"), "visualization summary should include discoverable builtin skills");
  assert(Array.isArray(domainSummaryById["design"]?.skillIds), "design domain summary should exist even without runtime skills");

    const responseDynamic = await app.inject({ method: "GET", url: "/api/v1/agent/capability-matrix?analysisType=dynamic" });
    assert(responseDynamic.statusCode === 200, "analysisType-specific capability matrix route should return 200");
    const dynamicPayload = responseDynamic.json();
    assert(dynamicPayload.appliedAnalysisType === "dynamic", "payload should echo applied analysis type");
    assert(dynamicPayload.filteredEngineReasonsBySkill.truss["engine-truss-a"].includes("analysis_type_mismatch"), "dynamic matrix should mark analysis type mismatch for static-only truss engine");

    AnalysisEngineCatalogService.prototype.listEngines = async function mockListEnginesFailure() {
      throw new Error("simulated engine catalog failure");
    };

    const degradedResponse = await app.inject({ method: "GET", url: "/api/v1/agent/capability-matrix" });
    assert(degradedResponse.statusCode === 200, "capability matrix route should degrade instead of failing when engine discovery errors");
    const degradedPayload = degradedResponse.json();
    assert(Array.isArray(degradedPayload.engines) && degradedPayload.engines.length === 0, "degraded capability matrix should surface an empty engine list");
    assert(Array.isArray(degradedPayload.tools) && degradedPayload.tools.some((tool) => tool.id === "draft_model"), "degraded capability matrix should still expose builtin tools");
    assert(Array.isArray(degradedPayload.skills) && degradedPayload.skills.some((skill) => skill.id === "beam"), "degraded capability matrix should still expose skills");
    assert(Array.isArray(degradedPayload.validEngineIdsBySkill.beam) && degradedPayload.validEngineIdsBySkill.beam.length === 0, "degraded capability matrix should zero out compatible engine lists");

    console.log("[ok] agent capability matrix contract");
  } finally {
    AgentSkillRuntime.prototype.listSkillManifests = originalListSkillManifests;
    AnalysisEngineCatalogService.prototype.listEngines = originalListEngines;
    if (app) {
      await app.close();
    }
  }
}

async function validateAgentSkillhubContract(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const stateDir = path.join(context.rootDir, ".runtime", "skillhub");
  const cacheFile = path.join(stateDir, "cache.json");

  await fsp.rm(stateDir, { recursive: true, force: true });

  const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);
  const app = Fastify();
  await app.register(agentRoutes, { prefix: "/api/v1/agent" });

  const searchResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/search?q=seismic" });
  assert(searchResp.statusCode === 200, "search should return 200");
  const searchPayload = searchResp.json();
  assert(Array.isArray(searchPayload.items), "search should return items array");
  assert(searchPayload.items.length >= 1, "search should return matching items");
  const targetSkillId = searchPayload.items[0].id;
  assert(typeof targetSkillId === "string" && targetSkillId.length > 0, "search item should include id");

  const installResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: targetSkillId },
  });
  assert(installResp.statusCode === 200, "install should return 200");
  assert(installResp.json().installed === true, "install response should indicate installed");

  const listResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/installed" });
  assert(listResp.statusCode === 200, "installed list should return 200");
  const listPayload = listResp.json();
  assert(Array.isArray(listPayload.items), "installed list should include items array");
  assert(listPayload.items.some((item) => item.id === targetSkillId), "installed list should include installed skill");

  const disableResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/disable",
    payload: { skillId: targetSkillId },
  });
  assert(disableResp.statusCode === 200, "disable should return 200");
  assert(disableResp.json().enabled === false, "disable should set enabled=false");

  const enableResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/enable",
    payload: { skillId: targetSkillId },
  });
  assert(enableResp.statusCode === 200, "enable should return 200");
  assert(enableResp.json().enabled === true, "enable should set enabled=true");

  const uninstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/uninstall",
    payload: { skillId: targetSkillId },
  });
  assert(uninstallResp.statusCode === 200, "uninstall should return 200");
  assert(uninstallResp.json().uninstalled === true, "uninstall should remove installed skill");

  const listAfterResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/installed" });
  const listAfter = listAfterResp.json();
  assert(!listAfter.items.some((item) => item.id === targetSkillId), "uninstalled skill should not appear in installed list");

  const incompatibleSearchResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/search?q=future-runtime-only" });
  assert(incompatibleSearchResp.statusCode === 200, "incompatible search should return 200");
  const incompatibleSearchPayload = incompatibleSearchResp.json();
  const incompatibleSkill = incompatibleSearchPayload.items.find((item) => item.id === "skillhub.future-runtime-only");
  assert(Boolean(incompatibleSkill), "future-runtime-only skill should exist in catalog");
  assert(incompatibleSkill.compatibility.compatible === false, "future-runtime-only should be incompatible");
  assert(incompatibleSkill.compatibility.reasonCodes.includes("runtime_version_incompatible"), "future-runtime-only should report runtime version incompatibility");
  assert(incompatibleSkill.compatibility.reasonCodes.includes("skill_api_version_incompatible"), "future-runtime-only should report skill api incompatibility");

  const incompatibleInstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: "skillhub.future-runtime-only" },
  });
  assert(incompatibleInstallResp.statusCode === 200, "incompatible install should return 200");
  const incompatibleInstallPayload = incompatibleInstallResp.json();
  assert(incompatibleInstallPayload.installed === true, "incompatible skill should still install");
  assert(incompatibleInstallPayload.enabled === false, "incompatible skill should auto-disable after install");
  assert(incompatibleInstallPayload.fallbackBehavior === "baseline_only", "incompatible skill should declare baseline fallback");
  assert(incompatibleInstallPayload.compatibilityStatus === "incompatible", "incompatible install should return incompatible status");

  const incompatibleEnableResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/enable",
    payload: { skillId: "skillhub.future-runtime-only" },
  });
  assert(incompatibleEnableResp.statusCode === 200, "incompatible enable should return 200");
  const incompatibleEnablePayload = incompatibleEnableResp.json();
  assert(incompatibleEnablePayload.enabled === false, "incompatible enable should remain disabled");
  assert(incompatibleEnablePayload.fallbackBehavior === "baseline_only", "incompatible enable should keep baseline fallback");

  const badSignatureInstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: "skillhub.bad-signature-pack" },
  });
  assert(badSignatureInstallResp.statusCode === 200, "bad signature install should return 200");
  const badSignaturePayload = badSignatureInstallResp.json();
  assert(badSignaturePayload.installed === false, "bad signature skill should not install");
  assert(badSignaturePayload.integrityStatus === "rejected", "bad signature should be rejected");
  assert(badSignaturePayload.integrityReasonCodes.includes("signature_invalid"), "bad signature should report signature_invalid");

  const badChecksumInstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: "skillhub.bad-checksum-pack" },
  });
  assert(badChecksumInstallResp.statusCode === 200, "bad checksum install should return 200");
  const badChecksumPayload = badChecksumInstallResp.json();
  assert(badChecksumPayload.installed === false, "bad checksum skill should not install");
  assert(badChecksumPayload.integrityStatus === "rejected", "bad checksum should be rejected");
  assert(badChecksumPayload.integrityReasonCodes.includes("checksum_mismatch"), "bad checksum should report checksum_mismatch");

  await fsp.mkdir(stateDir, { recursive: true });
  await fsp.writeFile(
    cacheFile,
    JSON.stringify(
      {
        skills: {
          "skillhub.cached-only-pack": {
            id: "skillhub.cached-only-pack",
            version: "1.0.0",
            domain: "report-export",
            compatibility: {
              minRuntimeVersion: "0.1.0",
              skillApiVersion: "v1",
            },
            integrity: {
              checksum: "4f9beaa82c00cb7d4c679020ac6f5021536b9b5b13b7be2ad55e872fe414d2f4",
              signature: "sig:skillhub.cached-only-pack:1.0.0",
            },
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  process.env.SCLAW_SKILLHUB_OFFLINE = "true";
  const offlineInstallResp = await app.inject({
    method: "POST",
    url: "/api/v1/agent/skillhub/install",
    payload: { skillId: "skillhub.cached-only-pack" },
  });
  assert(offlineInstallResp.statusCode === 200, "offline cache install should return 200");
  const offlineInstallPayload = offlineInstallResp.json();
  assert(offlineInstallPayload.installed === true, "offline cache install should succeed");
  assert(offlineInstallPayload.reusedFromCache === true, "offline cache install should indicate cache reuse");
  process.env.SCLAW_SKILLHUB_OFFLINE = "false";

  await app.close();
  await fsp.rm(stateDir, { recursive: true, force: true });
  console.log("[ok] agent skillhub contract");
}

async function validateAgentSkillhubCli(context) {
  await runBackendBuildOnce(context);

  const runCli = (args, envExtra = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(context.rootDir, "sclaw"), "skill", ...args],
        {
          cwd: context.rootDir,
          encoding: "utf8",
          env: {
            ...process.env,
            ...envExtra,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`CLI failed for ${args.join(" ")}: ${stderr || error.message}`));
            return;
          }
          resolve((stdout || "").trim());
        },
      );
    });

  const parseCliJson = (raw, label) => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      throw new Error(`CLI output is empty for ${label}`);
    }
    const firstJsonCharIndex = text.search(/[\[{]/u);
    if (firstJsonCharIndex === -1) {
      throw new Error(`CLI output is not JSON for ${label}: ${text}`);
    }
    return JSON.parse(text.slice(firstJsonCharIndex));
  };

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "sclaw-skillhub-cli-"));
  const state = { installed: false, enabled: false };
  const server = require("node:http").createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (!request.url) {
      response.end("{}");
      return;
    }

    if (request.url.startsWith("/api/v1/agent/skillhub/search")) {
      const items = state.installed
        ? [{ id: "skillhub.seismic-simplified-policy", installed: true, enabled: state.enabled }]
        : [{ id: "skillhub.seismic-simplified-policy", installed: false, enabled: false }];
      response.end(JSON.stringify({ items, total: 1 }));
      return;
    }
    if (request.url.startsWith("/api/v1/agent/skillhub/installed")) {
      response.end(JSON.stringify({ items: state.installed ? [{ id: "skillhub.seismic-simplified-policy", enabled: state.enabled }] : [] }));
      return;
    }

    if (request.method === "POST") {
      if (request.url.includes("/install")) {
        state.installed = true;
        state.enabled = true;
        response.end(JSON.stringify({ skillId: "skillhub.seismic-simplified-policy", installed: true, enabled: true }));
        return;
      }
      if (request.url.includes("/disable")) {
        state.enabled = false;
        response.end(JSON.stringify({ skillId: "skillhub.seismic-simplified-policy", enabled: false }));
        return;
      }
      if (request.url.includes("/enable")) {
        state.enabled = true;
        response.end(JSON.stringify({ skillId: "skillhub.seismic-simplified-policy", enabled: true }));
        return;
      }
      if (request.url.includes("/uninstall")) {
        state.installed = false;
        state.enabled = false;
        response.end(JSON.stringify({ skillId: "skillhub.seismic-simplified-policy", uninstalled: true }));
        return;
      }
    }

    response.end("{}");
  });

  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address.port);
    });
  });

  const env = {
    SCLAW_API_BASE: `http://127.0.0.1:${port}`,
  };

  const search = parseCliJson(await runCli(["search", "seismic"], env), "skill search");
  assert(Array.isArray(search.items) && search.items.length > 0, "search should return at least one item");
  const skillId = search.items[0].id;
  assert(typeof skillId === "string" && skillId.length > 0, "search result should provide skill id");

  const install = parseCliJson(await runCli(["install", skillId], env), "skill install");
  assert(install.installed === true, "install should mark installed true");
  const listAfterInstall = parseCliJson(await runCli(["list"], env), "skill list after install");
  assert(Array.isArray(listAfterInstall.items), "list should return items array");
  assert(listAfterInstall.items.some((item) => item.id === skillId), "list should include installed skill");

  const disable = parseCliJson(await runCli(["disable", skillId], env), "skill disable");
  assert(disable.enabled === false, "disable should set enabled=false");
  const enable = parseCliJson(await runCli(["enable", skillId], env), "skill enable");
  assert(enable.enabled === true, "enable should set enabled=true");
  const uninstall = parseCliJson(await runCli(["uninstall", skillId], env), "skill uninstall");
  assert(uninstall.uninstalled === true, "uninstall should remove skill");
  const listAfterUninstall = parseCliJson(await runCli(["list"], env), "skill list after uninstall");
  assert(!listAfterUninstall.items.some((item) => item.id === skillId), "uninstalled skill should not remain in list");

  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(tempRoot, { recursive: true, force: true });
  console.log("[ok] agent skillhub cli contract");
}

async function validateAgentSkillhubRepositoryDown(context) {
  await runBackendBuildOnce(context);
  process.env.SCLAW_SKILLHUB_FORCE_DOWN = "true";
  const Fastify = backendRequire(context.rootDir)("fastify");
  const { agentRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "agent.js")).href);
  const AgentService = await importBackendAgentService(context.rootDir);

  const app = Fastify();
  await app.register(agentRoutes, { prefix: "/api/v1/agent" });
  const searchResp = await app.inject({ method: "GET", url: "/api/v1/agent/skillhub/search?q=beam" });
  assert(searchResp.statusCode >= 500, "skillhub search should fail when repository is forced down");

  const svc = new AgentService();
  svc.structureProtocolClient = {
    post: async (targetPath) => {
      if (targetPath === "/validate") {
        return { data: { valid: true, schemaVersion: "1.0.0" } };
      }
      throw new Error(`unexpected structure protocol path ${targetPath}`);
    },
  };
  svc.engineClient.post = async (targetPath, payload) => {
    if (targetPath === "/analyze") {
      return {
        data: {
          schema_version: "1.0.0",
          analysis_type: payload.type,
          success: true,
          error_code: null,
          message: "ok",
          data: {},
          meta: {},
        },
      };
    }
    throw new Error(`unexpected analysis path ${targetPath}`);
  };

  const result = await svc.runForcedExecution({
    message: "按3m悬臂梁端部10kN点荷载做静力分析",
    context: {
      skillIds: ["beam"],
      model: {
        schema_version: "1.0.0",
        unit_system: "SI",
        nodes: [
          { id: "1", x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
          { id: "2", x: 3, y: 0, z: 0 },
        ],
        elements: [{ id: "1", type: "beam", node_i: "1", node_j: "2", material: "mat1", section: "sec1" }],
        materials: [{ id: "mat1", type: "steel", E: 2.06e11, nu: 0.3, density: 7850 }],
        sections: [{ id: "sec1", type: "rectangular", width: 0.3, height: 0.6 }],
        load_cases: [{ id: "LC1", type: "dead", loads: [{ type: "nodal", node: "2", fz: -10 }] }],
        load_combinations: [{ id: "ULS1", factors: [{ case: "LC1", factor: 1.0 }] }],
      },
      userDecision: "allow_auto_decide",
      autoCodeCheck: false,
      includeReport: false,
      locale: "zh",
    },
  });

  assert(result.success === true, "built-in skill execution should still succeed when repository is down");
  assert(result.toolCalls.some((item) => item.tool === "run_analysis" && item.status === "success"), "run_analysis should still run when a built-in skill authorizes it");

  await app.close();
  process.env.SCLAW_SKILLHUB_FORCE_DOWN = "false";
  console.log("[ok] skillhub repository-down fallback contract");
}

async function validateChatStreamContract(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const AgentService = await importBackendAgentService(context.rootDir);

  let capturedTraceId;
  const originalRunStream = AgentService.prototype.runStream;
  const originalRunForcedExecutionStream = AgentService.prototype.runForcedExecutionStream;
  const mockRunStream = async function* mockRunStream(params) {
    const request = params;
    capturedTraceId = request.traceId;
    const traceId = "stream-trace-001";
    yield { type: "start", content: { traceId, conversationId: "conv-stream-001", startedAt: "2026-03-09T00:00:00.000Z" } };
    yield {
      type: "result",
      content: {
        traceId,
        conversationId: "conv-stream-001",
        startedAt: "2026-03-09T00:00:00.000Z",
        completedAt: "2026-03-09T00:00:00.008Z",
        durationMs: 8,
        success: true,
        orchestrationMode: "llm-planned",
        needsModelInput: false,
        plan: ["validate_model", "run_analysis", "generate_report"],
        toolCalls: [],
        response: "ok",
      },
    };
    yield { type: "done" };
  };
  AgentService.prototype.runStream = mockRunStream;
  AgentService.prototype.runForcedExecutionStream = mockRunStream;

  const parseSseEvents = (raw) =>
    raw
      .split("\n\n")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => chunk.slice("data: ".length));

  let app;
  try {
    const { chatRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "chat.js")).href);
    app = Fastify();
    await app.register(chatRoutes, { prefix: "/api/v1/chat" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/chat/stream",
      headers: { origin: "http://localhost:30000" },
      payload: {
        message: "analyze this model",
        traceId: "trace-stream-request-1",
        context: { model: { schema_version: "1.0.0" } },
      },
    });

    assert(response.statusCode === 200, "chat/stream should return 200");
    assert(response.headers["access-control-allow-origin"] === "http://localhost:30000", "chat/stream should include access-control-allow-origin for allowed origin");
    assert(response.headers["access-control-allow-credentials"] === "true", "chat/stream should include access-control-allow-credentials for allowed origin");
    assert(String(response.headers.vary || "").includes("Origin"), "chat/stream should include Vary: Origin for allowed origin");
    const events = parseSseEvents(response.body);
    assert(events.length >= 4, "stream should include events and done marker");
    assert(events[events.length - 1] === "[DONE]", "stream should end with [DONE]");

    const chunks = events
      .filter((item) => item !== "[DONE]")
      .map((item) => JSON.parse(item));
    assert(chunks[0].type === "start", "first chunk should be start");
    assert(chunks.some((chunk) => chunk.type === "result"), "stream should contain result chunk");
    assert(chunks[chunks.length - 1].type === "done", "last chunk before [DONE] should be done");
    assert(capturedTraceId === "trace-stream-request-1", "chat/stream should pass traceId to agent stream");

    const startTrace = chunks.find((chunk) => chunk.type === "start")?.content?.traceId;
    const resultTrace = chunks.find((chunk) => chunk.type === "result")?.content?.traceId;
    assert(startTrace && resultTrace && startTrace === resultTrace, "traceId should match between start and result");
    assert(typeof chunks.find((chunk) => chunk.type === "start")?.content?.startedAt === "string", "start event should include startedAt");

    const disallowedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/chat/stream",
      headers: { origin: "http://evil.example.com" },
      payload: {
        message: "analyze this model",
        traceId: "trace-stream-request-2",
        context: { model: { schema_version: "1.0.0" } },
      },
    });
    assert(disallowedResponse.headers["access-control-allow-origin"] === undefined, "chat/stream should omit access-control-allow-origin for disallowed origin");

    console.log("[ok] chat stream contract regression");
  } finally {
    AgentService.prototype.runStream = originalRunStream;
    AgentService.prototype.runForcedExecutionStream = originalRunForcedExecutionStream;
    if (app) {
      await app.close();
    }
  }
}

async function validateChatMessageRouting(context) {
  await runBackendBuildOnce(context);
  const Fastify = backendRequire(context.rootDir)("fastify");
  const AgentService = await importBackendAgentService(context.rootDir);

  let agentRunCount = 0;
  const capturedRunTraceIds = [];
  const capturedRunMessages = [];
  const originalRun = AgentService.prototype.run;

  const mockAgentRun = async function mockAgentRun(params) {
    const request = params;
    agentRunCount += 1;
    capturedRunTraceIds.push(request.traceId);
    capturedRunMessages.push(request.message);
    return {
      traceId: "trace-route-001",
      conversationId: "conv-route-001",
      startedAt: "2026-03-09T00:00:00.000Z",
      completedAt: "2026-03-09T00:00:00.006Z",
      durationMs: 6,
      success: true,
      orchestrationMode: "llm-planned",
      needsModelInput: false,
      plan: ["validate_model", "run_analysis"],
      toolCalls: [],
      response: "tool-ok",
    };
  };
  AgentService.prototype.run = mockAgentRun;

  let app;
  try {
    const { chatRoutes } = await import(pathToFileURL(path.join(context.rootDir, "backend", "dist", "api", "chat.js")).href);
    app = Fastify();
    await app.register(chatRoutes, { prefix: "/api/v1/chat" });

    const autoChatResp = await app.inject({
      method: "POST",
      url: "/api/v1/chat/message",
      payload: {
        message: "auto without model",
        context: {
          skillIds: ["beam"],
        },
      },
    });
    assert(autoChatResp.statusCode === 200, "auto conversation response should be 200");
    const autoChatPayload = autoChatResp.json();
    assert(autoChatPayload.result?.response === "tool-ok", "agent-first conversation result should be returned");
    assert(autoChatPayload.result?.conversationId === "conv-route-001", "message response should include created conversationId");

  const autoConversationWithModelResp = await app.inject({
    method: "POST",
    url: "/api/v1/chat/message",
    payload: {
      message: "auto with model but no execution intent",
      traceId: "trace-route-auto-1",
      context: { model: { schema_version: "1.0.0" } },
    },
  });
  assert(autoConversationWithModelResp.statusCode === 200, "auto conversation-with-model response should be 200");
  const autoConversationWithModelPayload = autoConversationWithModelResp.json();
  assert(autoConversationWithModelPayload.result?.response === "tool-ok", "conversation with model should still route through agent");

  const autoToolResp = await app.inject({
    method: "POST",
    url: "/api/v1/chat/message",
    payload: {
      message: "analyze this model",
      traceId: "trace-route-auto-tool-1",
      context: { model: { schema_version: "1.0.0" } },
    },
  });
  assert(autoToolResp.statusCode === 200, "auto tool response should be 200");
  const autoToolPayload = autoToolResp.json();
  assert(autoToolPayload.result?.traceId === "trace-route-001", "tool result should be returned");

  const autoIntentExecResp = await app.inject({
    method: "POST",
    url: "/api/v1/chat/message",
    payload: {
      message: "请帮我做结构设计验算",
      traceId: "trace-route-auto-intent-1",
    },
  });
  assert(autoIntentExecResp.statusCode === 200, "auto intent tool response should be 200");
  assert(agentRunCount === 4, "agent run should be called for auto /chat/message requests");
  assert(capturedRunTraceIds.includes("trace-route-auto-1"), "agent-first message route should pass traceId for non-execution message");
  assert(capturedRunTraceIds.includes("trace-route-auto-tool-1"), "auto tool invocation should pass traceId");
  assert(capturedRunTraceIds.includes("trace-route-auto-intent-1"), "auto intent invocation should pass traceId");
  assert(capturedRunMessages.includes("auto without model"), "plain chat-like requests should now route through agent");

    const legacyToolCallResp = await app.inject({
      method: "POST",
      url: "/api/v1/chat/tool-call",
      payload: {
        message: "legacy force tool",
        traceId: "trace-route-tool-legacy-1",
      },
    });
    assert(legacyToolCallResp.statusCode === 404, "legacy /chat/tool-call endpoint should not be available");

    console.log("[ok] chat message routing contract");
  } finally {
    AgentService.prototype.run = originalRun;
    if (app) {
      await app.close();
    }
  }
}

async function validateReportNarrativeContract(context) {
  context.backendBuildReady = false;
  await runBackendBuildOnce(context);
  clearProviderEnv();
  const AgentService = await importBackendAgentServiceFresh(context.rootDir);

  const svc = new AgentService();
  svc.structureProtocolClient = {
    post: async (targetPath) => {
      if (targetPath === "/validate") {
        return { data: { valid: true, schemaVersion: "1.0.0" } };
      }
      throw new Error(`unexpected structure protocol path ${targetPath}`);
    },
  };
  svc.engineClient.post = async (targetPath, payload) => {
    if (targetPath === "/analyze") {
      return {
        data: {
          schema_version: "1.0.0",
          analysis_type: payload.type,
          success: true,
          error_code: null,
          message: "ok",
          data: {
            envelope: {
              maxAbsDisplacement: 0.0123,
              maxAbsAxialForce: 123.4,
              maxAbsShearForce: 45.6,
              maxAbsMoment: 78.9,
              maxAbsReaction: 22.1,
              controlCase: {
                displacement: "SLS",
                axialForce: "ULS",
                shearForce: "ULS",
                moment: "ULS",
                reaction: "SLS",
              },
              controlNodeDisplacement: "N2",
              controlElementAxialForce: "E1",
              controlElementShearForce: "E1",
              controlElementMoment: "E1",
              controlNodeReaction: "N1",
            },
          },
          meta: {},
        },
      };
    }
    throw new Error(`unexpected analysis path ${targetPath}`);
  };
  svc.codeCheckClient = {
    post: async (targetPath, payload) => {
      if (targetPath === "/code-check") {
        return {
          data: {
            code: payload.code,
            status: "success",
            summary: { total: 1, passed: 1, failed: 0, warnings: 0 },
            details: [
              {
                elementId: "E1",
                status: "pass",
                checks: [
                  {
                    name: "强度验算",
                    items: [
                      {
                        item: "正应力",
                        clause: "GB50017-2017 7.1.1",
                        formula: "σ = N/A <= f",
                        utilization: 0.72,
                        status: "pass",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
      }
      throw new Error(`unexpected code-check path ${targetPath}`);
    },
  };

  const result = await svc.runWithStrategy({
    message: "请分析并按规范校核后出报告",
    context: {
      model: {
        schema_version: "1.0.0",
        nodes: [
          { id: "1", x: 0, y: 0, z: 0 },
          { id: "2", x: 3, y: 0, z: 0 },
        ],
        elements: [{ id: "E1", type: "beam", nodes: ["1", "2"], material: "1", section: "1" }],
        materials: [{ id: "1", name: "steel", E: 205000, nu: 0.3, rho: 7850 }],
        sections: [{ id: "1", name: "B1", type: "beam", properties: { A: 0.01, Iy: 0.0001 } }],
        load_cases: [],
        load_combinations: [],
      },
      autoAnalyze: true,
      autoCodeCheck: true,
      designCode: "GB50017",
      includeReport: true,
      reportFormat: "both",
      reportOutput: "inline",
    },
  }, {
    planningDirective: "force_tool",
    orchestrationMode: "directed",
    allowToolCall: true,
  });

  assert(result.success === true, "run should succeed");
  assert(result.report?.json?.reportSchemaVersion === "1.0.0", "report json should include schema version");
  assert(typeof result.report?.summary === "string", "report summary should exist");
  assert(result.report?.json?.keyMetrics?.maxAbsDisplacement === 0.0123, "report key metrics should include displacement");
  assert(Array.isArray(result.report?.json?.clauseTraceability), "report clause traceability should be array");
  assert(result.report?.json?.clauseTraceability?.[0]?.clause === "GB50017-2017 7.1.1", "report should include clause traceability row");
  assert(result.report?.json?.controllingCases?.batchControlCase?.axialForce === "ULS", "report should include controlling cases");
  assert(typeof result.report?.markdown === "string", "report markdown should exist");
  assert(result.report.markdown.includes("## 目录"), "report markdown should include toc");
  assert(result.report.markdown.includes("## 关键指标"), "report markdown should include key metrics section");
  assert(result.report.markdown.includes("## 条文追溯"), "report markdown should include traceability section");
  assert(result.report.markdown.includes("## 控制工况"), "report markdown should include controlling cases section");
  console.log("[ok] report narrative contract");
}

async function validateDevStartupGuards(context) {
  const cliMainPath = path.join(context.rootDir, "scripts", "cli", "main.js");
  const cliMainContent = await fsp.readFile(cliMainPath, "utf8");
  const cliRuntimePath = path.join(context.rootDir, "scripts", "cli", "runtime.js");
  const linuxNodeInstallerPath = path.join(context.rootDir, "scripts", "install-node-linux.sh");
  const windowsNodeInstallerPath = path.join(context.rootDir, "scripts", "install-node-windows.ps1");
  const readmePath = path.join(context.rootDir, "README.md");
  const readmeCnPath = path.join(context.rootDir, "README_CN.md");
  const [
    cliRuntimeContent,
    linuxNodeInstallerContent,
    windowsNodeInstallerContent,
    readmeContent,
    readmeCnContent,
  ] = await Promise.all([
    fsp.readFile(cliRuntimePath, "utf8"),
    fsp.readFile(linuxNodeInstallerPath, "utf8"),
    fsp.readFile(windowsNodeInstallerPath, "utf8"),
    fsp.readFile(readmePath, "utf8"),
    fsp.readFile(readmeCnPath, "utf8"),
  ]);
  const runtimePaths = runtime.resolvePaths(context.rootDir);

  console.log("Validating unified startup and docker command guards...");
  assert(COMMAND_NAMES.has("doctor"), "missing doctor command");
  assert(COMMAND_NAMES.has("start"), "missing start command");
  assert(COMMAND_NAMES.has("docker-install"), "missing docker-install command");
  assert(COMMAND_NAMES.has("docker-start"), "missing docker-start command");
  assert(COMMAND_NAMES.has("docker-stop"), "missing docker-stop command");
  assert(COMMAND_NAMES.has("docker-status"), "missing docker-status command");
  assert(COMMAND_NAMES.has("docker-logs"), "missing docker-logs command");
  assert(
    cliMainContent.includes("installedPackagesMatchLock"),
    "missing npm dependency drift detection in unified CLI",
  );
  assert(
    cliMainContent.includes("ensureAnalysisPython"),
    "missing analysis Python guard in unified CLI",
  );
  assert(
    !cliMainContent.includes("runtime.requireCommand(\"python\""),
    "doctor path should not hard-require system python before uv provisioning",
  );
  assert(
    cliMainContent.includes("appendSessionHeader"),
    "missing log session isolation hook in unified CLI",
  );
  assert(
    cliMainContent.includes("getPortCleanupOptions"),
    "missing scoped port cleanup options in unified CLI",
  );
  assert(
    cliMainContent.includes("SCLAW_FORCE_PORT_CLEANUP"),
    "missing opt-in untracked port cleanup guard in unified CLI",
  );
  assert(
    cliRuntimeContent.includes("normalizePortNumber"),
    "missing port sanitization in CLI runtime cleanup",
  );
  assert(
    cliRuntimeContent.includes("isProjectOwnedPortProcess"),
    "missing project ownership guard in CLI runtime cleanup",
  );
  assert(
    cliMainContent.includes("persistDockerEnv"),
    "missing docker env persistence in unified CLI",
  );
  assert(
    cliMainContent.includes("waitForDockerServices"),
    "missing docker readiness check in unified CLI",
  );
  assert(
    runtimePaths.analysisRequirementsFile.endsWith(
      path.join("backend", "src", "agent-skills", "analysis", "runtime", "requirements.txt"),
    ),
    "analysis requirements path is not aligned with the current runtime layout",
  );
  assert(
    linuxNodeInstallerContent.includes("nvm install"),
    "missing nvm-based Node auto installer for Linux",
  );
  assert(
    windowsNodeInstallerContent.includes("CoreyButler.NVMforWindows"),
    "missing nvm-windows installer hook for Windows",
  );
  assert(
    readmeContent.includes("./scripts/install-node-linux.sh")
      && readmeContent.includes("./scripts/install-node-windows.ps1"),
    "README should document Linux and Windows Node installer scripts",
  );
  assert(
    readmeCnContent.includes("./scripts/install-node-linux.sh")
      && readmeCnContent.includes("./scripts/install-node-windows.ps1"),
    "README_CN should document Linux and Windows Node installer scripts",
  );
  console.log("[ok] unified startup and docker command guards are present");
}

async function validateDockerBackendRuntimeAssets(context) {
  const dockerfilePath = path.join(context.rootDir, "backend", "Dockerfile");
  const dockerfileContent = await fsp.readFile(dockerfilePath, "utf8");

  assert(
    dockerfileContent.includes("COPY --from=builder /app/src/agent-skills ./src/agent-skills"),
    "backend Dockerfile should copy src/agent-skills into the runner image",
  );
  assert(
    dockerfileContent.includes("COPY --from=builder /app/src/agent-tools ./src/agent-tools"),
    "backend Dockerfile should copy src/agent-tools into the runner image for tool.yaml discovery",
  );

  console.log("[ok] docker backend runtime assets are present");
}

async function validateStructureJsonSkill(context) {
  await runBackendBuildOnce(context);

  // Test 1: Verify validation skill metadata comes from skill.yaml, not registry exports
  const { AgentSkillCatalogService } = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "services", "agent-skill-catalog.js")).href
  );
  const entryModule = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-skills", "validation", "entry.js")).href
  );
  const registryModule = await import(
    pathToFileURL(path.join(context.rootDir, "backend", "dist", "agent-skills", "validation", "registry.js")).href
  );

  const skillCatalog = new AgentSkillCatalogService();
  const skill = await skillCatalog.getBuiltinSkillById("validation-structure-model");
  assert(skill !== undefined, "validation-structure-model should be discoverable from the manifest-backed skill catalog");
  assert(skill.canonicalId === "validation-structure-model", "validation skill should use the canonical manifest id");
  assert(skill.aliases.includes("structure-json-validation"), "validation skill should preserve the legacy alias from skill.yaml");
  assert(skill.domain === "validation", "validation skill should keep validation domain");
  assert(skill.triggers.includes("validate"), "validation skill should keep validate trigger");
  assert(skill.triggers.includes("验证"), "validation skill should keep Chinese validate trigger");
  assert(skill.autoLoadByDefault === true, "validation skill should auto-load by default");
  assert(skill.priority === 100, "validation skill priority should stay 100");
  assert(typeof entryModule.listBuiltinValidationSkills === "undefined", "validation entry should not re-export static registry metadata helpers");
  assert(typeof entryModule.getBuiltinValidationSkill === "undefined", "validation entry should not expose builtin metadata lookup");
  assert(typeof registryModule.listBuiltinValidationSkills === "undefined", "validation registry should not export static metadata helpers once manifest-first runtime is active");
  assert(typeof registryModule.getBuiltinValidationSkill === "undefined", "validation registry should not expose builtin metadata lookup");
  assert(typeof registryModule.findValidationSkillsByTrigger === "undefined", "validation registry should not expose trigger-based metadata lookup");
  assert(typeof registryModule.getValidationSkillCapabilities === "undefined", "validation registry should not expose capability lookup from frontmatter metadata");
  console.log("[ok] manifest-backed validation skill metadata");

  // Test 2: Test Python runtime directly via CLI
  const runtimePath = path.join(
    context.rootDir,
    "backend",
    "src",
    "agent-skills",
    "validation",
    "structure-json",
    "runtime.py"
  );

  // Helper to run Python validation
  const runPythonValidation = (jsonData, args = []) =>
    new Promise((resolve, reject) => {
      const proc = execFile(
        "python",
        [runtimePath, "--schema-version", "2.0.0", ...args, "-"],
        { encoding: "utf8" },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            reject(new Error(`Python execution failed: ${stderr || error.message}`));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(new Error(`Failed to parse Python output: ${e.message}\nOutput: ${stdout}`));
          }
        }
      );
      proc.stdin.write(typeof jsonData === "string" ? jsonData : JSON.stringify(jsonData));
      proc.stdin.end();
    });

  // Check if Python and schema validation are available
  let pythonAvailable = false;
  let schemaValidationAvailable = false;
  try {
    const checkResult = await runPythonValidation('{"test": true}', ["--no-semantic"]);
    pythonAvailable = true;
    schemaValidationAvailable = !checkResult.issues.some(i => i.code === "SCHEMA_VALIDATION_ERROR" && i.message.includes("not available"));
  } catch (e) {
    console.log(`[warn] Python runtime not available: ${e.message}`);
  }

  if (!pythonAvailable) {
    console.log("[skip] Python runtime tests (python not available)");
  } else if (!schemaValidationAvailable) {
    console.log("[skip] Schema validation tests (StructureModelV2 not available, install structure_protocol)");
  }

  if (!pythonAvailable || !schemaValidationAvailable) {
    console.log("[ok] validation skill tests completed with limitations");
    return;
  }

  // Test 2a: Valid minimal structure JSON
  const validModel = {
    schema_version: "2.0.0",
    nodes: [
      { id: "1", x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
      { id: "2", x: 3, y: 0, z: 0 },
    ],
    elements: [{ id: "E1", type: "beam", nodes: ["1", "2"], material: "M1", section: "S1" }],
    materials: [{ id: "M1", name: "Steel", type: "steel", E: 205000, nu: 0.3, rho: 7850 }],
    sections: [{ id: "S1", name: "Rectangular 0.3x0.6", type: "rectangular", width: 0.3, height: 0.6 }],
    load_cases: [],
    load_combinations: [],
  };

  const validResult = await runPythonValidation(validModel);
  assert(validResult.valid === true, "valid model should pass validation");
  assert(validResult.summary.error_count === 0, "valid model should have no errors");
  assert(validResult.validated_model !== undefined, "valid model should return validated_model");
  console.log("[ok] python runtime validates correct model");

  // Test 2b: Invalid JSON syntax
  const invalidJsonResult = await runPythonValidation('{"invalid json');
  assert(invalidJsonResult.valid === false, "invalid JSON should fail");
  assert(invalidJsonResult.summary.error_count > 0, "invalid JSON should have errors");
  assert(invalidJsonResult.issues.some((i) => i.code === "JSON_SYNTAX_ERROR"), "should report JSON_SYNTAX_ERROR");
  console.log("[ok] python runtime detects syntax errors");

  // Test 2c: Schema validation errors (missing required fields)
  const incompleteModel = {
    schema_version: "2.0.0",
    nodes: [{ id: "1", x: 0, y: 0 }], // Missing z coordinate
  };
  const incompleteResult = await runPythonValidation(incompleteModel);
  assert(incompleteResult.valid === false, "incomplete model should fail validation");
  assert(incompleteResult.issues.length > 0, "incomplete model should have issues");
  console.log("[ok] python runtime detects schema errors");

  // Test 2d: Semantic validation errors (invalid references)
  const badRefModel = {
    schema_version: "2.0.0",
    nodes: [
      { id: "1", x: 0, y: 0, z: 0 },
      { id: "2", x: 3, y: 0, z: 0 },
    ],
    elements: [{ id: "E1", type: "beam", nodes: ["1", "999"], material: "M1", section: "S1" }], // Node 999 doesn't exist
    materials: [{ id: "M1", name: "Steel", type: "steel", E: 205000, nu: 0.3, rho: 7850 }],
    sections: [{ id: "S1", name: "Rectangular 0.3x0.6", type: "rectangular", width: 0.3, height: 0.6 }],
    load_cases: [],
    load_combinations: [],
  };
  const badRefResult = await runPythonValidation(badRefModel);
  assert(badRefResult.valid === false, "model with bad references should fail");
  assert(
    badRefResult.issues.some((i) => i.code === "SEMANTIC_INVALID_REFERENCE"),
    "should report SEMANTIC_INVALID_REFERENCE"
  );
  console.log("[ok] python runtime detects semantic errors");

  // Test 2e: Duplicate ID detection
  const dupIdModel = {
    schema_version: "2.0.0",
    nodes: [
      { id: "1", x: 0, y: 0, z: 0 },
      { id: "1", x: 3, y: 0, z: 0 }, // Duplicate ID
    ],
  };
  const dupIdResult = await runPythonValidation(dupIdModel);
  assert(dupIdResult.issues.some((i) => i.code === "SEMANTIC_DUPLICATE_ID"), "should report SEMANTIC_DUPLICATE_ID");
  console.log("[ok] python runtime detects duplicate IDs");

  // Test 2f: Material property validation
  const badMaterialModel = {
    schema_version: "2.0.0",
    nodes: [
      { id: "1", x: 0, y: 0, z: 0 },
      { id: "2", x: 3, y: 0, z: 0 },
    ],
    elements: [{ id: "E1", type: "beam", nodes: ["1", "2"], material: "M1", section: "S1" }],
    materials: [{ id: "M1", type: "steel", E: -1000, nu: 0.3, rho: 7850 }], // Negative E
    sections: [{ id: "S1", type: "rectangular", width: 0.3, height: 0.6 }],
    load_cases: [],
    load_combinations: [],
  };
  const badMatResult = await runPythonValidation(badMaterialModel);
  assert(
    badMatResult.issues.some((i) => i.code === "SEMANTIC_INVALID_VALUE" && i.path.includes("materials")),
    "should report invalid material value"
  );
  console.log("[ok] python runtime validates material properties");

  // Test 2g: Options - skip semantic validation
  const skipSemanticResult = await runPythonValidation(dupIdModel, ["--no-semantic"]);
  assert(skipSemanticResult.valid === true, "model with semantic-only issues should pass when semantic is skipped");
  console.log("[ok] python runtime respects --no-semantic flag");

  // Test 2h: Options - stop on first error
  const stopOnFirstResult = await runPythonValidation(incompleteModel, ["--stop-on-first-error"]);
  assert(stopOnFirstResult.issues.length <= 2, "should stop after first error");
  console.log("[ok] python runtime respects --stop-on-first-error flag");

  // Test 3: Verify runtime-facing validation exports still exist
  assert(typeof entryModule.VALIDATION_GET_ACTION_BY_PATH === "object", "validation entry should keep runtime action mapping exports");
  assert(typeof entryModule.VALIDATION_POST_ACTION_BY_PATH === "object", "validation entry should keep runtime action mapping exports");
  console.log("[ok] validation module runtime exports");
}

const BACKEND_VALIDATIONS = {
  "validate-agent-orchestration": validateAgentOrchestration,
  "validate-agent-base-chat-fallback": validateAgentBaseChatFallback,
  "validate-agent-capability-modes": validateAgentCapabilityModes,
  "validate-agent-manifest-binding": validateAgentManifestBinding,
  "validate-agent-manifest-loader": validateAgentManifestLoader,
  "validate-agent-runtime-loader": validateAgentRuntimeLoader,
  "validate-agent-runtime-binder": validateAgentRuntimeBinder,
  "validate-agent-tool-catalog": validateAgentToolCatalog,
  "validate-agent-skill-catalog-manifests": validateAgentSkillCatalogManifests,
  "validate-agent-tools-contract": validateAgentToolsContract,
  "validate-agent-api-contract": validateAgentApiContract,
  "validate-agent-capability-matrix": validateAgentCapabilityMatrix,
  "validate-agent-skillhub-contract": validateAgentSkillhubContract,
  "validate-agent-skillhub-cli": validateAgentSkillhubCli,
  "validate-agent-skillhub-repository-down": validateAgentSkillhubRepositoryDown,
  "validate-chat-stream-contract": validateChatStreamContract,
  "validate-chat-message-routing": validateChatMessageRouting,
  "validate-report-narrative-contract": validateReportNarrativeContract,
  "validate-dev-startup-guards": validateDevStartupGuards,
  "validate-docker-backend-runtime-assets": validateDockerBackendRuntimeAssets,
  "validate-structure-json-skill": validateStructureJsonSkill,
};

async function runBackendValidation(name, context) {
  const task = BACKEND_VALIDATIONS[name];
  if (!task) {
    throw new Error(`Unknown backend validation: ${name}`);
  }
  await task(context);
}

module.exports = {
  BACKEND_VALIDATIONS,
  runBackendValidation,
};
