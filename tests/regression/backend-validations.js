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
  process.env.OPENAI_API_KEY = "";
  process.env.ZAI_API_KEY = "";
  process.env.LLM_PROVIDER = "openai";
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

  const withDefaultSkills = (svc) => {
    const defaultSkillIds = svc.listSkills().map((skill) => skill.id);

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
    const svc = withDefaultSkills(new AgentService());
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
    const svc = withDefaultSkills(new AgentService());
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
    const svc = withDefaultSkills(new AgentService());
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
    assert(result.toolCalls.some((call) => call.tool === "run_analysis" && call.source === "external"), "run_analysis should expose external source");
    assert(result.toolCalls.some((call) => call.tool === "run_analysis" && Array.isArray(call.authorizedBySkillIds) && call.authorizedBySkillIds.length > 0), "run_analysis should expose authorized skill ids");
    assert(result.report && result.report.summary, "report payload should exist");
    assert(result.metrics?.toolCount >= 2, "tool metrics should be present");
    assert(typeof result.startedAt === "string" && typeof result.completedAt === "string", "run timestamps should be present");
    assert(result.metrics?.totalToolDurationMs >= 0, "total tool duration metrics should be present");
    assert(typeof result.metrics?.toolDurationMsByName === "object", "toolDurationMsByName should be present");
    console.log("[ok] agent success orchestration");
  }

  {
    const svc = withDefaultSkills(new AgentService());
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
    const svc = withDefaultSkills(new AgentService());
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
    const svc = withDefaultSkills(new AgentService());
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
    const svc = withDefaultSkills(new AgentService());

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
    const svc = withDefaultSkills(new AgentService());
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
    const svc = withDefaultSkills(new AgentService());

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
    const svc = withDefaultSkills(new AgentService());
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
    const svc = withDefaultSkills(new AgentService());
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
        skillIds: [...svc.listSkills().map((skill) => skill.id), "code-check-gb50017"],
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
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  process.env.ZAI_API_KEY = process.env.ZAI_API_KEY || "";

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
  const defaultSkillIds = svc.listSkills().map((skill) => skill.id);

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
        enabledTools: ["draft_model", "update_model", "validate_model", "run_analysis", "generate_report"],
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
        enabledTools: ["draft_model", "update_model", "validate_model", "run_analysis", "generate_report"],
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
  assert(!Object.prototype.hasOwnProperty.call(draftTool || {}, "runtimeName"), "capability matrix should not expose runtimeName");
  assert(!Object.prototype.hasOwnProperty.call(draftTool || {}, "compatibilityRuntimeName"), "capability matrix should not expose compatibility runtime aliases");
  assert(Array.isArray(analysisTool?.requiresTools), "run_analysis should expose requiresTools");
  assert(analysisTool?.requiresTools.includes("validate_model"), "run_analysis should depend on validate_model");
  assert(Array.isArray(payload.enabledToolIdsBySkill.beam), "beam should expose enabled tools array");
  assert(payload.enabledToolIdsBySkill.beam.includes("draft_model"), "beam should enable draft_model");
  assert(payload.enabledToolIdsBySkill.beam.includes("update_model"), "beam should enable update_model");
  assert(payload.enabledToolIdsBySkill.beam.includes("run_analysis"), "beam should enable run_analysis");
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
  assert(domainSummaryById["structure-type"]?.runtimeStatus === "active", "structure-type domain should be active");
  assert(domainSummaryById["analysis"]?.runtimeStatus === "active", "analysis domain should be active");
  assert(domainSummaryById["validation"]?.runtimeStatus === "partial", "validation domain should be partial");
  assert(domainSummaryById["report-export"]?.runtimeStatus === "partial", "report-export domain should be partial");
  assert(domainSummaryById["design"]?.runtimeStatus === "discoverable", "design domain should be discoverable");
  assert(Array.isArray(domainSummaryById["design"]?.skillIds), "design domain summary should exist even without runtime skills");

    const responseDynamic = await app.inject({ method: "GET", url: "/api/v1/agent/capability-matrix?analysisType=dynamic" });
    assert(responseDynamic.statusCode === 200, "analysisType-specific capability matrix route should return 200");
    const dynamicPayload = responseDynamic.json();
    assert(dynamicPayload.appliedAnalysisType === "dynamic", "payload should echo applied analysis type");
    assert(dynamicPayload.filteredEngineReasonsBySkill.truss["engine-truss-a"].includes("analysis_type_mismatch"), "dynamic matrix should mark analysis type mismatch for static-only truss engine");

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
        load_cases: [{ id: "LC1", type: "dead", loads: [{ type: "nodal", node: "2", fy: -10 }] }],
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
  const linuxNodeInstallerPath = path.join(context.rootDir, "scripts", "install-node-linux.sh");
  const windowsNodeInstallerPath = path.join(context.rootDir, "scripts", "install-node-windows.ps1");
  const readmePath = path.join(context.rootDir, "README.md");
  const readmeCnPath = path.join(context.rootDir, "README_CN.md");
  const [
    linuxNodeInstallerContent,
    windowsNodeInstallerContent,
    readmeContent,
    readmeCnContent,
  ] = await Promise.all([
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

const BACKEND_VALIDATIONS = {
  "validate-agent-orchestration": validateAgentOrchestration,
  "validate-agent-base-chat-fallback": validateAgentBaseChatFallback,
  "validate-agent-capability-modes": validateAgentCapabilityModes,
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
