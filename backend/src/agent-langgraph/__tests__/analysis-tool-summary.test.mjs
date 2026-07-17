import { describe, expect, test } from "@jest/globals";

describe("analysis tool summary", () => {
  test("uses structured analysis skill selection within the selected skill scope", async () => {
    const {
      resolveRequestedAnalysisEngineId,
      resolveRequestedAnalysisSkillId,
    } = await import("../../../dist/agent-langgraph/tools.js");

    expect(resolveRequestedAnalysisSkillId("两层钢筋混凝土框架，用 OpenSees 计算", ["concrete-frame", "pkpm-static"], "static", "pkpm-static"))
      .toBe("pkpm-static");
    expect(resolveRequestedAnalysisEngineId("两层钢筋混凝土框架，用 SATWE 计算", ["concrete-frame", "pkpm-static"], "static", "pkpm-static"))
      .toBe("builtin-pkpm");
    expect(resolveRequestedAnalysisSkillId("三层框架，用 PKPM 复核", ["concrete-frame", "yjk-static"], "static", "yjk-static"))
      .toBe("yjk-static");
  });

  test("does not infer analysis providers from message text", async () => {
    const {
      resolveRequestedAnalysisEngineId,
      resolveRequestedAnalysisSkillId,
      resolveUnselectedRequestedAnalysisSkillId,
    } = await import("../../../dist/agent-langgraph/tools.js");

    expect(resolveRequestedAnalysisSkillId("这次试一下 PKPM", ["concrete-frame", "yjk-static"], "static"))
      .toBe("yjk-static");
    expect(resolveUnselectedRequestedAnalysisSkillId("这次试一下 PKPM", ["concrete-frame", "yjk-static"], "static"))
      .toBeUndefined();
    expect(resolveRequestedAnalysisEngineId("用 SATWE 复核", ["concrete-frame"], "static"))
      .toBeUndefined();
    expect(resolveUnselectedRequestedAnalysisSkillId("用 SATWE 复核", ["concrete-frame"], "static"))
      .toBeUndefined();
    expect(resolveRequestedAnalysisSkillId("做一次静力分析", ["concrete-frame", "opensees-static"], "static"))
      .toBe("opensees-static");
    expect(resolveUnselectedRequestedAnalysisSkillId("做一次静力分析", ["concrete-frame", "opensees-static"], "static"))
      .toBeUndefined();
    expect(resolveRequestedAnalysisSkillId("忽略文字，结构化指定 PKPM", ["concrete-frame", "yjk-static"], "static", "pkpm-static"))
      .toBeUndefined();
    expect(resolveUnselectedRequestedAnalysisSkillId("忽略文字，结构化指定 PKPM", ["concrete-frame", "yjk-static"], "static", "pkpm-static"))
      .toBe("pkpm-static");
  });

  test("ignores provider keyword routing for seismic analysis", async () => {
    const {
      resolveRequestedAnalysisEngineId,
      resolveRequestedAnalysisSkillId,
      resolveUnselectedRequestedAnalysisSkillId,
    } = await import("../../../dist/agent-langgraph/tools.js");

    expect(resolveRequestedAnalysisSkillId(
      "Use OpenSees for this China seismic workflow",
      ["concrete-frame", "opensees-seismic"],
      "seismic",
    )).toBe("opensees-seismic");
    expect(resolveRequestedAnalysisEngineId(
      "Use OpenSees for this China seismic workflow",
      ["concrete-frame", "opensees-seismic"],
      "seismic",
    )).toBe("builtin-opensees");
    expect(resolveRequestedAnalysisSkillId(
      "这次想用 PKPM 做中国抗震流程",
      ["concrete-frame", "opensees-seismic"],
      "seismic",
    )).toBe("opensees-seismic");
    expect(resolveUnselectedRequestedAnalysisSkillId(
      "这次想用 PKPM 做中国抗震流程",
      ["concrete-frame", "opensees-seismic"],
      "seismic",
    )).toBeUndefined();
    expect(resolveUnselectedRequestedAnalysisSkillId(
      "这次想用 PKPM 做中国抗震流程",
      ["concrete-frame", "opensees-seismic"],
      "seismic",
      "pkpm-static",
    )).toBe("pkpm-static");
  });

  test("validate_model resolves the analysis engine from session analysis type", async () => {
    const { createValidateModelTool } = await import("../../../dist/agent-langgraph/tools.js");
    let capturedOptions;
    const validateModel = createValidateModelTool({
      async executeValidationSkill(options) {
        capturedOptions = options;
        return {
          input: { model: options.model },
          valid: true,
          engineId: options.engineId,
        };
      },
    });

    const result = await validateModel.invoke({}, {
      configurable: {
        skillScope: ["opensees-seismic", "pkpm-static"],
        agentState: {
          policy: { analysisType: "static" },
          lastUserMessage: "validate this static model",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });

    expect(capturedOptions.engineId).toBe("builtin-pkpm");
    expect(JSON.parse(result)).toMatchObject({
      input: { model: "(model stored in state)" },
      valid: true,
      engineId: "builtin-pkpm",
    });
  });

  test("blocks run_analysis from substituting another engine for an unselected explicit provider", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called");
      },
    });

    const command = await runAnalysis.invoke({ analysisType: "static", analysisSkillId: "pkpm-static" }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-static"],
        agentState: {
          lastUserMessage: "请用 PKPM 计算这个框架",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
        engineClient: {
          post() {
            throw new Error("engine should not be called");
          },
        },
      },
    });
    const message = command.update.messages[0];
    const payload = JSON.parse(message.content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "ANALYSIS_PROVIDER_NOT_SELECTED",
      requestedAnalysisSkillId: "pkpm-static",
    });
  });

  test("passes structured seismic workflow JSON through run_analysis parameters", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    let capturedOptions;
    const runAnalysis = createRunAnalysisTool({
      async executeAnalysisSkill(options) {
        capturedOptions = options;
        return {
          skillId: "opensees-seismic",
          result: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "structured_seismic_workflow",
              summary: { modalCount: 3 },
              envelope: {
                maxBaseShear: 123.4,
                maxStoryDriftRatio: 0.0012,
                modalMassParticipationRatio: 0.91,
              },
              elasticStoryDriftFinalCompliance: {
                status: "pass",
                utilization: 0.66,
                driftRatio: 0.0012,
                limitDriftRatio: 0.00181818,
                source: "envelope.maxStoryDriftRatio",
              },
              capabilityAssessment: {
                finalComplianceSupported: false,
                implementedCapabilities: [
                  "responseSpectrum",
                  "gb50011.frequentEarthquakeElasticDriftFinalCompliance",
                ],
                missingCapabilities: [
                  "gb50011.rareEarthquakeElasticPlasticDeformation",
                ],
              },
              specialSystemReview: {
                reviewRequired: true,
                status: "partial",
                systems: ["isolation"],
                missingInputs: ["isolationSystem.equivalentDampingRatio"],
                capabilityBoundaries: ["gb50011.isolationSystemSpecialSeismicAnalysis"],
                deviceCounts: { isolation: 2 },
                checks: [
                  { item: "隔震层位移验收", status: "pass", utilization: 0.8 },
                ],
                failedCheckCount: 0,
                isolationEquivalentLinearEstimate: {
                  status: "estimated",
                  periodSec: 2.4,
                  alpha: 0.04,
                  baseShearKN: 120,
                  displacementDemandM: 0.08,
                  displacementCapacityM: 0.12,
                  displacementUtilization: 0.666667,
                  finalCompliance: {
                    status: "pass",
                    utilization: 0.666667,
                    source: "isolationEquivalentLinearEstimate.displacementDemandM",
                    scope: "restricted equivalent-linear isolation displacement check",
                  },
                },
                energyDissipationEquivalentEstimate: {
                  status: "estimated",
                  periodSec: 1.2,
                  baseDampingRatio: 0.05,
                  additionalDampingRatio: 0.08,
                  equivalentDampingRatio: 0.13,
                  demandReductionRatio: 0.7,
                  adjustedDisplacementDemandM: 0.028,
                  deformationCapacityM: 0.06,
                  deformationUtilization: 0.466667,
                  finalCompliance: {
                    status: "pass",
                    utilization: 0.466667,
                    source: "energyDissipationEquivalentEstimate.adjustedDisplacementDemandM",
                    scope: "restricted equivalent-damping energy-dissipation deformation check",
                  },
                },
              },
            },
          },
        };
      },
    });
    const workflow = {
      methodPreference: "auto",
      designBasis: {
        codes: ["GB 55002-2021", "GB/T 50011-2010-2024"],
        siteSeismic: { intensity: 8, designGroup: "2", siteCategory: "III" },
      },
      designRequirements: { irregularity: "regular" },
    };

    const command = await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify(workflow),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-seismic"],
        agentState: {
          lastUserMessage: "做中国抗震分析",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });

    expect(capturedOptions.analysisType).toBe("seismic");
    expect(capturedOptions.parameters.seismicWorkflow).toEqual(workflow);
    const payload = JSON.parse(command.update.messages[0].content);
    expect(payload).toMatchObject({
      success: true,
      skillId: "opensees-seismic",
      workflowInputMode: "structured_seismic_workflow",
      keyMetrics: {
        maxBaseShear: 123.4,
        maxStoryDriftRatio: 0.0012,
        modalMassParticipationRatio: 0.91,
      },
      compliance: {
        elasticStoryDrift: {
          status: "pass",
          utilization: 0.66,
          driftRatio: 0.0012,
          limitDriftRatio: 0.00181818,
          source: "envelope.maxStoryDriftRatio",
        },
      },
      capabilityAssessment: {
        finalComplianceSupported: false,
        implementedCapabilityCount: 2,
        missingCapabilityCount: 1,
        missingCapabilities: [
          "gb50011.rareEarthquakeElasticPlasticDeformation",
        ],
      },
      specialSystemReview: {
        reviewRequired: true,
        status: "partial",
        systems: ["isolation"],
        missingInputs: ["isolationSystem.equivalentDampingRatio"],
        capabilityBoundaries: ["gb50011.isolationSystemSpecialSeismicAnalysis"],
        deviceCounts: { isolation: 2 },
        checkCount: 1,
        failedCheckCount: 0,
        isolationEquivalentLinearEstimate: {
          status: "estimated",
          periodSec: 2.4,
          alpha: 0.04,
          baseShearKN: 120,
          displacementDemandM: 0.08,
          displacementCapacityM: 0.12,
          displacementUtilization: 0.666667,
          finalCompliance: {
            status: "pass",
            utilization: 0.666667,
            source: "isolationEquivalentLinearEstimate.displacementDemandM",
            scope: "restricted equivalent-linear isolation displacement check",
          },
        },
        energyDissipationEquivalentEstimate: {
          status: "estimated",
          periodSec: 1.2,
          baseDampingRatio: 0.05,
          additionalDampingRatio: 0.08,
          equivalentDampingRatio: 0.13,
          demandReductionRatio: 0.7,
          adjustedDisplacementDemandM: 0.028,
          deformationCapacityM: 0.06,
          deformationUtilization: 0.466667,
          finalCompliance: {
            status: "pass",
            utilization: 0.466667,
            source: "energyDissipationEquivalentEstimate.adjustedDisplacementDemandM",
            scope: "restricted equivalent-damping energy-dissipation deformation check",
          },
        },
      },
    });
  });

  test("passes structured over-limit review traces through run_analysis parameters", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    let capturedParameters;
    const runAnalysis = createRunAnalysisTool({
      async executeAnalysisSkill(options) {
        capturedParameters = options.parameters;
        return {
          skillId: "opensees-seismic",
          result: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "structured_seismic_workflow",
              envelope: { maxBaseShear: 1 },
            },
          },
        };
      },
    });
    const workflow = {
      methodPreference: "auto",
      overLimitReview: {
        reviewRequired: true,
        status: "approved",
        approvalId: "SZ-REVIEW-2026-001",
        reviewReasons: ["structured irregularity assessment"],
        approved: true,
      },
      specialReview: {
        required: false,
        status: "not_required",
      },
      designBasis: {
        siteSeismic: { intensity: 8, designGroup: "2", siteCategory: "III" },
        specialReview: {
          required: false,
          status: "not_required",
        },
      },
      methodDecision: {
        overLimitReview: {
          reviewRequired: false,
          status: "not_required",
        },
      },
      regularityAssessment: {
        overLimitReviewRequired: false,
        specialReviewRequired: false,
        reviewReasons: ["explicit structured assessment"],
      },
    };

    await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify(workflow),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "执行中国抗震结构化 workflow",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });

    expect(capturedParameters.seismicWorkflow).toEqual(workflow);
  });

  test("uses draftState skillState seismic workflow when run_analysis input omits it", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    let capturedParameters;
    const runAnalysis = createRunAnalysisTool({
      async executeAnalysisSkill(options) {
        capturedParameters = options.parameters;
        return {
          skillId: "opensees-seismic",
          result: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              envelope: { maxBaseShear: 1 },
            },
          },
        };
      },
    });
    const workflow = { methodPreference: "response_spectrum" };

    await runAnalysis.invoke({ analysisType: "seismic" }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "执行抗震计算",
          draftState: { skillState: { seismicWorkflow: workflow } },
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });

    expect(capturedParameters.seismicWorkflow).toEqual(workflow);
  });

  test("merges frontend seismic workflow context into draft seismic workflow", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    let capturedParameters;
    const runAnalysis = createRunAnalysisTool({
      async executeAnalysisSkill(options) {
        capturedParameters = options.parameters;
        return {
          skillId: "opensees-seismic",
          result: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              envelope: { maxBaseShear: 1 },
            },
          },
        };
      },
    });
    const draftWorkflow = {
      methodPreference: "auto",
      designBasis: {
        siteSeismic: { intensity: 8, designGroup: "2", siteCategory: "III" },
      },
      responseSpectrum: { modalCombination: "cqc" },
      groundMotionSet: {
        requiredCount: 7,
        scaleFactorLimit: 2.5,
      },
    };
    const contextWorkflow = {
      methodPreference: "time_history",
      groundMotionSet: {
        source: "builtin_artificial",
        requiredCount: 3,
        catalogIds: ["SCGM-A1", "SCGM-A2", "SCGM-A3"],
      },
    };

    await runAnalysis.invoke({ analysisType: "seismic" }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "执行抗震计算",
          draftState: { skillState: { seismicWorkflow: draftWorkflow } },
          contextSeismicWorkflow: contextWorkflow,
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });

    expect(capturedParameters.seismicWorkflow).toEqual({
      methodPreference: "time_history",
      designBasis: {
        siteSeismic: { intensity: 8, designGroup: "2", siteCategory: "III" },
      },
      responseSpectrum: { modalCombination: "cqc" },
      groundMotionSet: {
        requiredCount: 3,
        scaleFactorLimit: 2.5,
        source: "builtin_artificial",
        catalogIds: ["SCGM-A1", "SCGM-A2", "SCGM-A3"],
      },
    });
  });

  test("merges uploaded attachment ground-motion records into parsed seismic workflow", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    let capturedParameters;
    const runAnalysis = createRunAnalysisTool({
      async executeAnalysisSkill(options) {
        capturedParameters = options.parameters;
        return {
          skillId: "opensees-seismic",
          result: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              summary: {},
              envelope: { maxBaseShear: 1 },
            },
          },
        };
      },
    });
    const semanticWorkflow = {
      methodPreference: "time_history",
      designBasis: {
        intensity: 7,
        designBasicAccelerationG: 0.1,
        designGroup: "2",
        siteCategory: "II",
      },
      designRequirements: {
        fortificationCategory: "standard",
        seismicGrade: 4,
      },
      groundMotionSet: {
        source: "uploaded",
        requiredCount: 3,
      },
    };
    const fullRows = Array.from({ length: 1560 }, (_, index) => [
      (index * 0.02).toFixed(2),
      index % 2 === 0 ? "0.01" : "-0.01",
    ]);
    const contextWorkflow = {
      groundMotionSet: {
        source: "uploaded",
        uploadedAttachments: [{ fileId: "file-gm-1", originalName: "el-centro.csv" }],
        records: [{
          id: "file-gm-1",
          name: "el-centro.csv",
          source: "uploaded_attachment",
          headers: ["time", "acceleration"],
          rows: fullRows,
        }],
      },
    };

    await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify(semanticWorkflow),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "用上传的 El Centro 波做时程分析",
          contextSeismicWorkflow: contextWorkflow,
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });

    expect(capturedParameters.seismicWorkflow.groundMotionSet).toMatchObject({
      source: "uploaded",
      requiredCount: 3,
      uploadedAttachments: [{ fileId: "file-gm-1", originalName: "el-centro.csv" }],
    });
    expect(capturedParameters.seismicWorkflow.groundMotionSet.records[0].rows).toHaveLength(1560);
  });

  test("requires structured seismic workflow before chat-triggered seismic analysis", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called without seismicWorkflow");
      },
    });

    const command = await runAnalysis.invoke({ analysisType: "seismic" }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "按中国抗震规范做反应谱分析，也做时程、Pushover 和弹塑性时程",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });
    const payload = JSON.parse(command.update.messages[0].content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "SEISMIC_WORKFLOW_REQUIRED",
      nextAction: "Call extract_draft_params or pass seismicWorkflowJson, then retry run_analysis.",
    });
  });

  test("rejects invalid structured seismic workflow fields before execution", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called for invalid seismicWorkflow");
      },
    });

    const command = await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify({
        methodPreference: "by_keywords",
        earthquakeLevel: "keyword_matched_level",
        directions: "xy",
        responseSpectrum: { modalCombination: "absolute_sum" },
        isolationSystem: "LRB by prose",
        energyDissipationSystem: "viscous dampers by prose",
        groundMotionSet: {
          records: {},
          requiredCount: 0,
          catalogIds: [""],
          localCatalog: { records: [{}] },
          scaleFactorLimit: -1,
        },
      }),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "按中国抗震规范做反应谱分析",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });
    const payload = JSON.parse(command.update.messages[0].content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "INVALID_SEISMIC_WORKFLOW",
    });
    expect(payload.errors).toEqual(expect.arrayContaining([
      "methodPreference must be one of auto, response_spectrum, time_history, pushover, or elastic_plastic_time_history.",
      "earthquakeLevel must be frequent, fortification, or rare when provided.",
      "directions must be an array containing only x and/or y.",
      "responseSpectrum.modalCombination must be cqc or srss.",
      "isolationSystem must be an object when provided.",
      "energyDissipationSystem must be an object when provided.",
      "groundMotionSet.records must be an array when provided.",
      "groundMotionSet.requiredCount must be a positive integer when provided.",
      "groundMotionSet.catalogIds must be an array of non-empty strings when provided.",
      "groundMotionSet.localCatalog.records[0] must include values, rows, text/content, or parsed file data.",
      "groundMotionSet.scaleFactorLimit must be a positive number when provided.",
    ]));
  });

  test("rejects invalid structured over-limit review traces before execution", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called for invalid review traces");
      },
    });

    const command = await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify({
        methodPreference: "auto",
        overLimitReview: "required by prose",
        specialReview: {
          reviewRequired: "maybe",
          approvalId: "",
          reasons: ["soft story", 12],
        },
        specialSeismicReview: {
          approved: "maybe",
        },
        designBasis: {
          overLimitReview: { status: 0 },
          specialReview: { reviewDate: "" },
        },
        methodDecision: {
          specialReview: { reviewStatus: [] },
        },
        regularityAssessment: {
          overLimitReviewRequired: "sometimes",
          specialReviewReasons: [""],
        },
      }),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "执行中国抗震结构化 workflow",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });
    const payload = JSON.parse(command.update.messages[0].content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "INVALID_SEISMIC_WORKFLOW",
    });
    expect(payload.errors).toEqual(expect.arrayContaining([
      "overLimitReview must be an object when provided.",
      "specialReview.reviewRequired must be a boolean when provided.",
      "specialReview.approvalId must be a non-empty string when provided.",
      "specialReview.reasons must contain only non-empty strings when provided.",
      "specialSeismicReview.approved must be a boolean when provided.",
      "regularityAssessment.overLimitReviewRequired must be a boolean when provided.",
      "regularityAssessment.specialReviewReasons must contain only non-empty strings when provided.",
      "designBasis.overLimitReview.status must be a non-empty string when provided.",
      "designBasis.specialReview.reviewDate must be a non-empty string when provided.",
      "methodDecision.specialReview.reviewStatus must be a non-empty string when provided.",
    ]));
  });

  test("rejects invalid structured seismic design basis fields before execution", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called for invalid seismic design basis");
      },
    });

    const command = await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify({
        methodPreference: "auto",
        dampingRatio: -0.05,
        fortificationCategory: "ordinary",
        seismicGrade: "grade 5",
        irregularity: "keyword_guess",
        seismicSafetyEvaluation: "top-level prose approval",
        siteSeismic: {
          intensity: 10,
          designBasicAccelerationG: 0,
          designGroup: "4",
          siteCategory: "V",
          dampingRatio: 1,
        },
        analysisControl: { dampingRatio: 2 },
        designBasis: {
          intensity: 5,
          accelerationG: -0.1,
          designGroup: "group 4",
          siteCategory: "V",
          dampingRatio: 1.5,
          fortificationCategory: "ordinary",
          seismicGrade: 5,
          heightM: 0,
          storyCount: 2.5,
          seismicSafetyEvaluation: "approved by prose",
          siteSeismic: {
            intensity: 10,
            designBasicAccelerationG: 0,
            designGroup: "4",
            siteCategory: "V",
          },
        },
        designRequirements: {
          fortificationCategory: "ordinary",
          seismicGrade: 0,
          irregularity: "keyword_guess",
          seismicSafetyEvaluation: "requirements prose approval",
        },
        structure: {
          heightM: -1,
          storyCount: 0,
          regularity: "keyword_guess",
        },
      }),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "执行中国抗震结构化 workflow",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });
    const payload = JSON.parse(command.update.messages[0].content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "INVALID_SEISMIC_WORKFLOW",
    });
    expect(payload.errors).toEqual(expect.arrayContaining([
      "dampingRatio must be greater than 0 and less than 1 when provided.",
      "fortificationCategory must be special, key, standard, or moderate when provided.",
      "seismicGrade must be an integer from 1 to 4 when provided.",
      "irregularity must be regular, irregular, or particularly_irregular when provided.",
      "seismicSafetyEvaluation must be an object when provided.",
      "siteSeismic.intensity must be an integer from 6 to 9 when provided.",
      "siteSeismic.designBasicAccelerationG must be a positive number when provided.",
      "siteSeismic.designGroup must be one of 1, 2, or 3 when provided.",
      "siteSeismic.siteCategory must be one of I0, I1, I, II, III, or IV when provided.",
      "siteSeismic.dampingRatio must be greater than 0 and less than 1 when provided.",
      "analysisControl.dampingRatio must be greater than 0 and less than 1 when provided.",
      "designBasis.intensity must be an integer from 6 to 9 when provided.",
      "designBasis.accelerationG must be a positive number when provided.",
      "designBasis.designGroup must be one of 1, 2, or 3 when provided.",
      "designBasis.siteCategory must be one of I0, I1, I, II, III, or IV when provided.",
      "designBasis.dampingRatio must be greater than 0 and less than 1 when provided.",
      "designBasis.fortificationCategory must be special, key, standard, or moderate when provided.",
      "designBasis.seismicGrade must be an integer from 1 to 4 when provided.",
      "designBasis.heightM must be a positive number when provided.",
      "designBasis.storyCount must be a positive integer when provided.",
      "designBasis.seismicSafetyEvaluation must be an object when provided.",
      "designBasis.siteSeismic.intensity must be an integer from 6 to 9 when provided.",
      "designBasis.siteSeismic.designBasicAccelerationG must be a positive number when provided.",
      "designBasis.siteSeismic.designGroup must be one of 1, 2, or 3 when provided.",
      "designBasis.siteSeismic.siteCategory must be one of I0, I1, I, II, III, or IV when provided.",
      "designRequirements.fortificationCategory must be special, key, standard, or moderate when provided.",
      "designRequirements.seismicGrade must be an integer from 1 to 4 when provided.",
      "designRequirements.irregularity must be regular, irregular, or particularly_irregular when provided.",
      "designRequirements.seismicSafetyEvaluation must be an object when provided.",
      "structure.heightM must be a positive number when provided.",
      "structure.storyCount must be a positive integer when provided.",
      "structure.regularity must be regular, irregular, or particularly_irregular when provided.",
    ]));
  });

  test("passes structured GB18306 zonation table through seismic workflow", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    let capturedParameters;
    const runAnalysis = createRunAnalysisTool({
      async executeAnalysisSkill(options) {
        capturedParameters = options.parameters;
        return {
          skillId: "opensees-seismic",
          result: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              envelope: { maxBaseShear: 1 },
            },
          },
        };
      },
    });
    const workflow = {
      methodPreference: "auto",
      designBasis: {
        regionCode: "EX-001",
        siteSeismic: { siteCategory: "II" },
        groundMotionZonation: {
          records: [
            {
              region: "示例市",
              regionCode: "EX-001",
              accelerationG: 0.2,
              intensity: 8,
              designGroup: "2",
              characteristicPeriod: 0.55,
            },
          ],
        },
      },
      designRequirements: { fortificationCategory: "standard" },
    };

    await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify(workflow),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "按结构化 GB18306 区划表执行抗震 workflow",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });

    expect(capturedParameters.seismicWorkflow).toEqual(workflow);
  });

  test("passes structured performance objective and nonlinear controls through seismic workflow", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    let capturedParameters;
    const runAnalysis = createRunAnalysisTool({
      async executeAnalysisSkill(options) {
        capturedParameters = options.parameters;
        return {
          skillId: "opensees-seismic",
          result: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              envelope: { maxBaseShear: 1 },
            },
          },
        };
      },
    });
    const workflow = {
      methodPreference: "auto",
      requiresTimeHistory: true,
      requiresVerticalSeismic: true,
      requiresElasticPlasticDeformation: true,
      requiresPerformanceBasedCheck: true,
      structure: {
        hasLargeSpan: true,
        hasLongCantilever: true,
        hasIsolation: true,
      },
      designRequirements: {
        supplementaryTimeHistory: true,
        requiresVerticalSeismic: true,
        requiresElasticPlasticDeformation: true,
        requiresPerformanceBasedCheck: true,
      },
      performanceObjective: {
        name: "collapse_prevention",
        acceptanceDriftRatio: 0.012,
      },
      pushover: {
        targetDisplacement: 0.02,
        performanceObjective: {
          name: "collapse_prevention",
          acceptanceDriftRatio: 0.012,
        },
      },
      elasticPlasticTimeHistory: {
        performanceObjective: {
          name: "collapse_prevention",
          acceptanceDriftRatio: 0.012,
        },
      },
      nonlinearModel: {
        memberPlasticHinges: [
          { elementId: "E1", end: "i", yieldMomentKNm: 120, yieldRotation: 0.003 },
        ],
      },
    };

    await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify(workflow),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "按结构化性能目标自动选择抗震分析方法",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });

    expect(capturedParameters.seismicWorkflow).toEqual(workflow);
  });

  test("rejects invalid structured nonlinear performance controls before execution", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called for invalid nonlinear performance controls");
      },
    });

    const command = await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify({
        methodPreference: "auto",
        requiresTimeHistory: "maybe",
        requiresVerticalSeismic: "maybe",
        performanceObjective: { acceptanceDriftRatio: 1 },
        analysisControl: {
          targetDisplacement: 0,
          performanceObjective: { targetDisplacement: -0.1 },
        },
        designRequirements: {
          supplementaryTimeHistory: "maybe",
          requiresElasticPlasticDeformation: "maybe",
          requiresPerformanceBasedCheck: "maybe",
        },
        structure: {
          hasLargeSpan: "maybe",
          hasLongCantilever: "maybe",
          hasIsolation: "maybe",
        },
        pushover: {
          targetDisplacement: -0.02,
          acceptanceDriftRatio: 2,
          steps: 0,
          performanceObjective: { limitDriftRatio: 0 },
        },
        elasticPlasticTimeHistory: {
          acceptanceDriftRatio: 0,
          performanceObjective: { acceptanceDriftRatio: 2 },
        },
        nonlinearTimeHistory: [],
        nonlinearModel: {
          memberPlasticHinges: {},
        },
      }),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "执行无效的结构化性能目标 workflow",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });
    const payload = JSON.parse(command.update.messages[0].content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "INVALID_SEISMIC_WORKFLOW",
    });
    expect(payload.errors).toEqual(expect.arrayContaining([
      "requiresTimeHistory must be a boolean when provided.",
      "requiresVerticalSeismic must be a boolean when provided.",
      "performanceObjective.acceptanceDriftRatio must be greater than 0 and less than 1 when provided.",
      "analysisControl.targetDisplacement must be a positive number when provided.",
      "analysisControl.performanceObjective.targetDisplacement must be a positive number when provided.",
      "designRequirements.supplementaryTimeHistory must be a boolean when provided.",
      "designRequirements.requiresElasticPlasticDeformation must be a boolean when provided.",
      "designRequirements.requiresPerformanceBasedCheck must be a boolean when provided.",
      "structure.hasLargeSpan must be a boolean when provided.",
      "structure.hasLongCantilever must be a boolean when provided.",
      "structure.hasIsolation must be a boolean when provided.",
      "pushover.targetDisplacement must be a positive number when provided.",
      "pushover.acceptanceDriftRatio must be greater than 0 and less than 1 when provided.",
      "pushover.steps must be a positive integer when provided.",
      "pushover.performanceObjective.limitDriftRatio must be greater than 0 and less than 1 when provided.",
      "elasticPlasticTimeHistory.acceptanceDriftRatio must be greater than 0 and less than 1 when provided.",
      "elasticPlasticTimeHistory.performanceObjective.acceptanceDriftRatio must be greater than 0 and less than 1 when provided.",
      "nonlinearModel.memberPlasticHinges must be an array when provided.",
      "nonlinearTimeHistory must be an object when provided.",
    ]));
  });

  test("rejects invalid structured GB18306 zonation records before execution", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called for invalid GB18306 zonation table");
      },
    });

    const command = await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify({
        methodPreference: "auto",
        groundMotionZonation: { records: [{}] },
        zonation: { headers: ["region"], rows: [["示例市"]] },
        designBasis: {
          groundMotionZonation: {
            records: [
              {
                regionCode: "BAD-001",
                intensity: 10,
                accelerationG: 0,
                designGroup: "4",
                characteristicPeriod: -0.1,
              },
            ],
          },
        },
      }),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "执行中国抗震结构化 workflow",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });
    const payload = JSON.parse(command.update.messages[0].content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "INVALID_SEISMIC_WORKFLOW",
    });
    expect(payload.errors).toEqual(expect.arrayContaining([
      "groundMotionZonation.records[0] must include acceleration, intensity, design group, characteristic period, or alphaMax.",
      "zonation.headers must include acceleration, intensity, design group, characteristic period, or alphaMax.",
      "designBasis.groundMotionZonation.records[0].intensity must be an integer from 6 to 9 when provided.",
      "designBasis.groundMotionZonation.records[0].accelerationG must be a positive number when provided.",
      "designBasis.groundMotionZonation.records[0].designGroup must be one of 1, 2, or 3 when provided.",
      "designBasis.groundMotionZonation.records[0].characteristicPeriod must be a positive number when provided.",
    ]));
  });

  test("rejects local catalog source without local catalog records", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called for incomplete local catalog workflow");
      },
    });

    const command = await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify({
        methodPreference: "time_history",
        groundMotionSet: {
          source: "local_catalog",
          requiredCount: 3,
        },
      }),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "按本地地震波目录做时程分析",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });
    const payload = JSON.parse(command.update.messages[0].content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "INVALID_SEISMIC_WORKFLOW",
    });
    expect(payload.errors).toContain("groundMotionSet.localCatalog.records or groundMotionSet.records is required when source is local_catalog, licensed_catalog, or project_catalog.");
  });

  test("rejects uploaded ground-motion source without parsed records", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called for incomplete uploaded ground-motion workflow");
      },
    });

    const command = await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify({
        methodPreference: "time_history",
        groundMotionSet: {
          source: "uploaded",
          requiredCount: 3,
          uploadedAttachments: [{ fileId: "file-gm-1", originalName: "gm.at2", relPath: ".uploads/run/gm.at2" }],
        },
      }),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "按上传地震波做时程分析",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });
    const payload = JSON.parse(command.update.messages[0].content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "INVALID_SEISMIC_WORKFLOW",
    });
    expect(payload.errors).toContain("groundMotionSet.records is required when source is uploaded; analyze uploaded files and preserve CSV rows or AT2/TXT content in records before running analysis.");
  });

  test("rejects selected local catalog ids that are not in local catalog records", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const runAnalysis = createRunAnalysisTool({
      executeAnalysisSkill() {
        throw new Error("executeAnalysisSkill should not be called for missing local catalog ids");
      },
    });

    const command = await runAnalysis.invoke({
      analysisType: "seismic",
      seismicWorkflowJson: JSON.stringify({
        methodPreference: "time_history",
        groundMotionSet: {
          source: "local_catalog",
          requiredCount: 3,
          catalogIds: ["GM-1", "GM-404"],
          localCatalog: {
            records: [
              { id: "GM-1", dt: 0.02, unit: "g", values: [0, 0.01, -0.01] },
            ],
          },
        },
      }),
    }, {
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-seismic"],
        agentState: {
          lastUserMessage: "按本地地震波目录做时程分析",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
      },
    });
    const payload = JSON.parse(command.update.messages[0].content);

    expect(payload).toMatchObject({
      success: false,
      error_code: "INVALID_SEISMIC_WORKFLOW",
    });
    expect(payload.errors).toContain("groundMotionSet.catalogIds not found in localCatalog.records: GM-404.");
  });

  test("requires a GB50011 code check before generating a seismic report", async () => {
    const { createGenerateReportTool } = await import("../../../dist/agent-langgraph/tools.js");
    let reportCalls = 0;
    const generateReport = createGenerateReportTool({
      async executeReportSkill() {
        reportCalls += 1;
        return { report: { summary: "should not be used" } };
      },
    });

    const command = await generateReport.invoke({
      message: "生成中国抗震计算书",
      analysisType: "seismic",
      locale: "zh",
    }, {
      toolCall: { id: "call-report" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-seismic"],
        agentState: {
          locale: "zh",
          analysisResult: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "structured_seismic_workflow",
              envelope: { maxBaseShear: 12.3 },
            },
          },
        },
      },
    });

    const payload = JSON.parse(command.update.messages[0].content);
    expect(payload).toMatchObject({
      success: false,
      error_code: "SEISMIC_CODE_CHECK_REQUIRED",
    });
    expect(reportCalls).toBe(0);
  });

  test("uses seismic analysis result type before report tool input type", async () => {
    const { createGenerateReportTool } = await import("../../../dist/agent-langgraph/tools.js");
    let reportCalls = 0;
    const generateReport = createGenerateReportTool({
      async executeReportSkill() {
        reportCalls += 1;
        return { report: { summary: "should not be used" } };
      },
    });

    const command = await generateReport.invoke({
      message: "生成中国抗震计算书",
      analysisType: "static",
      locale: "zh",
    }, {
      toolCall: { id: "call-report-stale-type" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-seismic"],
        agentState: {
          locale: "zh",
          policy: { analysisType: "static" },
          analysisResult: {
            success: true,
            meta: { analysisType: "seismic" },
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "structured_seismic_workflow",
              envelope: { maxBaseShear: 12.3 },
            },
          },
        },
      },
    });

    const payload = JSON.parse(command.update.messages[0].content);
    expect(payload).toMatchObject({
      success: false,
      error_code: "SEISMIC_CODE_CHECK_REQUIRED",
    });
    expect(reportCalls).toBe(0);
  });

  test("rejects legacy compatibility seismic analysis before generating a seismic report", async () => {
    const { createGenerateReportTool } = await import("../../../dist/agent-langgraph/tools.js");
    let reportCalls = 0;
    const generateReport = createGenerateReportTool({
      async executeReportSkill() {
        reportCalls += 1;
        return { report: { summary: "should not be used" } };
      },
    });

    const command = await generateReport.invoke({
      message: "生成中国抗震计算书",
      analysisType: "seismic",
      locale: "zh",
    }, {
      toolCall: { id: "call-report" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-seismic"],
        agentState: {
          locale: "zh",
          analysisResult: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "legacy_compatibility_parameters",
              envelope: { maxBaseShear: 12.3 },
            },
          },
          codeCheckResult: {
            status: "success",
            summary: { passed: 1, total: 1 },
            meta: { codeCheckSkillId: "code-check-gb50011" },
          },
        },
      },
    });

    const payload = JSON.parse(command.update.messages[0].content);
    expect(payload).toMatchObject({
      success: false,
      error_code: "SEISMIC_WORKFLOW_REQUIRED",
      workflowInputMode: "legacy_compatibility_parameters",
    });
    expect(payload.nextAction).toContain("seismicWorkflowJson");
    expect(reportCalls).toBe(0);
  });

  test("rejects seismic report generation when workflow input mode is missing", async () => {
    const { createGenerateReportTool } = await import("../../../dist/agent-langgraph/tools.js");
    let reportCalls = 0;
    const generateReport = createGenerateReportTool({
      async executeReportSkill() {
        reportCalls += 1;
        return { report: { summary: "should not be used" } };
      },
    });

    const command = await generateReport.invoke({
      message: "生成中国抗震计算书",
      analysisType: "seismic",
      locale: "zh",
    }, {
      toolCall: { id: "call-report" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-seismic"],
        agentState: {
          locale: "zh",
          analysisResult: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              envelope: { maxBaseShear: 12.3 },
            },
          },
          codeCheckResult: {
            status: "success",
            summary: { passed: 1, total: 1 },
            details: [{
              elementId: "__global_seismic__",
              elementType: "global-seismic",
              checks: [{ name: "结构化抗震流程输入", items: [{ item: "结构化抗震流程输入", status: "pass" }] }],
            }],
            meta: { codeCheckSkillId: "code-check-gb50011" },
          },
        },
      },
    });

    const payload = JSON.parse(command.update.messages[0].content);
    expect(payload).toMatchObject({
      success: false,
      error_code: "SEISMIC_WORKFLOW_REQUIRED",
      workflowInputMode: null,
    });
    expect(reportCalls).toBe(0);
  });

  test("rejects non-GB50011 code checks before generating a seismic report", async () => {
    const { createGenerateReportTool } = await import("../../../dist/agent-langgraph/tools.js");
    let reportCalls = 0;
    const generateReport = createGenerateReportTool({
      async executeReportSkill() {
        reportCalls += 1;
        return { report: { summary: "should not be used" } };
      },
    });

    const command = await generateReport.invoke({
      message: "生成中国抗震计算书",
      analysisType: "seismic",
      locale: "zh",
    }, {
      toolCall: { id: "call-report" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-seismic"],
        agentState: {
          locale: "zh",
          analysisResult: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "structured_seismic_workflow",
              envelope: { maxBaseShear: 12.3 },
            },
          },
          codeCheckResult: {
            status: "success",
            summary: { passed: 1, total: 1 },
            meta: { codeCheckSkillId: "code-check-gb50017" },
          },
        },
      },
    });

    const payload = JSON.parse(command.update.messages[0].content);
    expect(payload).toMatchObject({
      success: false,
      error_code: "SEISMIC_CODE_CHECK_REQUIRED",
      requiredCodeCheckSkillId: "code-check-gb50011",
      actualCodeCheckSkillId: "code-check-gb50017",
    });
    expect(reportCalls).toBe(0);
  });

  test("rejects skipped code checks before generating a seismic report", async () => {
    const { createGenerateReportTool } = await import("../../../dist/agent-langgraph/tools.js");
    let reportCalls = 0;
    const generateReport = createGenerateReportTool({
      async executeReportSkill() {
        reportCalls += 1;
        return { report: { summary: "should not be used" } };
      },
    });

    const command = await generateReport.invoke({
      message: "生成中国抗震计算书",
      analysisType: "seismic",
      locale: "zh",
    }, {
      toolCall: { id: "call-report" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-seismic"],
        agentState: {
          locale: "zh",
          analysisResult: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "structured_seismic_workflow",
              envelope: { maxBaseShear: 12.3 },
            },
          },
          codeCheckResult: {
            skipped: true,
            reason: "No code-check design code is selected or provided.",
          },
        },
      },
    });

    const payload = JSON.parse(command.update.messages[0].content);
    expect(payload).toMatchObject({
      success: false,
      error_code: "SEISMIC_CODE_CHECK_REQUIRED",
      requiredCodeCheckSkillId: "code-check-gb50011",
    });
    expect(payload.actualCodeCheckSkillId).toBeUndefined();
    expect(reportCalls).toBe(0);
  });

  test("rejects GB50011 code checks without global seismic detail before generating a seismic report", async () => {
    const { createGenerateReportTool } = await import("../../../dist/agent-langgraph/tools.js");
    let reportCalls = 0;
    const generateReport = createGenerateReportTool({
      async executeReportSkill() {
        reportCalls += 1;
        return { report: { summary: "should not be used" } };
      },
    });

    const command = await generateReport.invoke({
      message: "生成中国抗震计算书",
      analysisType: "seismic",
      locale: "zh",
    }, {
      toolCall: { id: "call-report" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-seismic"],
        agentState: {
          locale: "zh",
          analysisResult: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "structured_seismic_workflow",
              envelope: { maxBaseShear: 12.3 },
            },
          },
          codeCheckResult: {
            status: "success",
            summary: { passed: 1, total: 1 },
            details: [{
              elementId: "E1",
              elementType: "frame-column",
              checks: [{ name: "构件抗震构造", items: [{ item: "轴压比", status: "pass" }] }],
            }],
            meta: { codeCheckSkillId: "code-check-gb50011" },
          },
        },
      },
    });

    const payload = JSON.parse(command.update.messages[0].content);
    expect(payload).toMatchObject({
      success: false,
      error_code: "SEISMIC_CODE_CHECK_REQUIRED",
      requiredCodeCheckSkillId: "code-check-gb50011",
      actualCodeCheckSkillId: "code-check-gb50011",
    });
    expect(reportCalls).toBe(0);
  });

  test("rejects stale GB50011 global seismic code checks from a different analysis trace", async () => {
    const { createGenerateReportTool } = await import("../../../dist/agent-langgraph/tools.js");
    let reportCalls = 0;
    const generateReport = createGenerateReportTool({
      async executeReportSkill() {
        reportCalls += 1;
        return { report: { summary: "should not be used" } };
      },
    });

    const command = await generateReport.invoke({
      message: "生成中国抗震计算书",
      analysisType: "seismic",
      locale: "zh",
    }, {
      toolCall: { id: "call-report" },
      configurable: {
        skillScope: ["concrete-frame", "opensees-seismic"],
        agentState: {
          locale: "zh",
          analysisResult: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "structured_seismic_workflow",
              envelope: { maxBaseShear: 12.3 },
            },
            meta: { traceId: "analysis-new" },
          },
          codeCheckResult: {
            status: "success",
            summary: { passed: 1, total: 1 },
            details: [{
              elementId: "__global_seismic__",
              elementType: "global-seismic",
              checks: [{ name: "结构化抗震流程输入", items: [{ item: "结构化抗震流程输入", status: "pass" }] }],
            }],
            meta: {
              codeCheckSkillId: "code-check-gb50011",
              analysisTraceId: "analysis-old",
            },
          },
        },
      },
    });

    const payload = JSON.parse(command.update.messages[0].content);
    expect(payload).toMatchObject({
      success: false,
      error_code: "SEISMIC_CODE_CHECK_REQUIRED",
      requiredCodeCheckSkillId: "code-check-gb50011",
      actualCodeCheckSkillId: "code-check-gb50011",
    });
    expect(reportCalls).toBe(0);
  });

  test("runs the seismic analysis, GB50011 code-check, and report tool sequence", async () => {
    const {
      createGenerateReportTool,
      createRunAnalysisTool,
      createRunCodeCheckTool,
    } = await import("../../../dist/agent-langgraph/tools.js");

    const model = {
      schemaVersion: "2.0.0",
      nodes: [],
      elements: [],
      materials: [],
      sections: [],
      loadCases: [],
      loadCombinations: [],
    };
    const workflow = {
      methodPreference: "response_spectrum",
      designBasis: {
        codes: ["GB 55002-2021", "GB/T 50011-2010-2024"],
        siteSeismic: { intensity: 8, designGroup: "2", siteCategory: "III" },
      },
      responseSpectrum: { modalCombination: "cqc" },
      directions: ["x"],
    };
    const state = {
      locale: "zh",
      lastUserMessage: "执行中国抗震分析并生成报告",
      model,
      policy: { designCode: "GB/T 50011-2010-2024" },
      draftState: { skillState: { seismicWorkflow: workflow } },
    };
    let codeCheckOptions;
    let reportOptions;
    const skillRuntime = {
      async executeAnalysisSkill(options) {
        expect(options.analysisType).toBe("seismic");
        expect(options.parameters.seismicWorkflow).toEqual(workflow);
        return {
          skillId: "opensees-seismic",
          result: {
            success: true,
            data: {
              analysisMode: "opensees_china_seismic_workflow",
              workflowInputMode: "structured_seismic_workflow",
              summary: { directions: ["x"], modalCount: 3 },
              envelope: {
                maxBaseShear: 123.4,
                maxStoryDriftRatio: 0.0012,
                modalMassParticipationRatio: 0.91,
              },
            },
          },
        };
      },
      resolveCodeCheckDesignCodeFromSkillIds(skillIds) {
        return skillIds.includes("code-check-gb50011") ? "GB50011" : undefined;
      },
      resolveCodeCheckSkillId(designCode) {
        return String(designCode).includes("50011") ? "code-check-gb50011" : undefined;
      },
      async executeCodeCheckSkill(options) {
        codeCheckOptions = options;
        return {
          skillId: "code-check-gb50011",
          result: {
            status: "success",
            summary: { passed: 1, total: 1 },
            details: [{
              elementId: "__global_seismic__",
              checks: [],
            }],
          },
        };
      },
      async executeReportSkill(options) {
        reportOptions = options;
        return {
          skillId: "report-export-builtin",
          report: {
            summary: "分析类型 seismic，分析成功，校核通过 1 / 1。",
            json: { codeCheck: options.codeCheck },
            markdown: "## 抗震专项",
          },
        };
      },
    };
    const skillScope = ["concrete-frame", "opensees-seismic", "code-check-gb50011"];
    const runAnalysis = createRunAnalysisTool(skillRuntime);
    const runCodeCheck = createRunCodeCheckTool(skillRuntime);
    const generateReport = createGenerateReportTool(skillRuntime);

    const analysisCommand = await runAnalysis.invoke({ analysisType: "seismic" }, {
      toolCall: { id: "call-analysis" },
      configurable: { skillScope, agentState: state },
    });
    Object.assign(state, analysisCommand.update);
    expect(state.analysisResult.meta.traceId).toMatch(/^lg-/);

    const codeCheckCommand = await runCodeCheck.invoke({ designCode: "GB/T 50011-2010-2024" }, {
      toolCall: { id: "call-code-check" },
      configurable: { skillScope, agentState: state },
    });
    Object.assign(state, codeCheckCommand.update);

    expect(state.codeCheckResult.meta).toMatchObject({
      codeCheckSkillId: "code-check-gb50011",
      analysisTraceId: state.analysisResult.meta.traceId,
    });

    const reportCommand = await generateReport.invoke({
      message: "执行中国抗震分析并生成报告",
      analysisType: "seismic",
      locale: "zh",
    }, {
      toolCall: { id: "call-report" },
      configurable: { skillScope, agentState: state },
    });
    const reportPayload = JSON.parse(reportCommand.update.messages[0].content);

    expect(codeCheckOptions.designCode).toBe("GB/T 50011-2010-2024");
    expect(codeCheckOptions.analysis.data.analysisMode).toBe("opensees_china_seismic_workflow");
    expect(reportOptions.analysisType).toBe("seismic");
    expect(reportOptions.codeCheck.summary).toEqual({ passed: 1, total: 1 });
    expect(reportOptions.codeCheck.meta).toMatchObject({
      codeCheckSkillId: "code-check-gb50011",
      analysisTraceId: state.analysisResult.meta.traceId,
    });
    expect(reportPayload).toMatchObject({ success: true });
  });

  test("does not retry analysis engine requests after abort", async () => {
    const { createRunAnalysisTool } = await import("../../../dist/agent-langgraph/tools.js");
    const abortController = new AbortController();
    const abortError = new Error("analysis aborted");
    abortError.name = "AbortError";
    let postCalls = 0;
    const runAnalysis = createRunAnalysisTool({
      async executeAnalysisSkill({ postToEngineWithRetry, signal }) {
        return postToEngineWithRetry("/analyze", {}, {
          retries: 2,
          traceId: "test-trace",
          tool: "run_analysis",
          signal,
        });
      },
    });

    await expect(runAnalysis.invoke({ analysisType: "static" }, {
      signal: abortController.signal,
      toolCall: { id: "call-test" },
      configurable: {
        skillScope: ["opensees-static"],
        agentState: {
          lastUserMessage: "Run static analysis",
          model: {
            schemaVersion: "2.0.0",
            nodes: [],
            elements: [],
            materials: [],
            sections: [],
            loadCases: [],
            loadCombinations: [],
          },
        },
        engineClient: {
          post() {
            postCalls += 1;
            abortController.abort(abortError);
            throw abortError;
          },
        },
      },
    })).rejects.toThrow("analysis aborted");

    expect(postCalls).toBe(1);
  });

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

  test("summarizes successful analysis artifacts for model follow-up reasoning", async () => {
    const { buildAnalysisToolSummary } = await import("../../../dist/agent-langgraph/tools.js");

    const summary = buildAnalysisToolSummary({
      skillId: "opensees-static",
      result: {
        success: true,
        data: {
          analysisMode: "opensees_2d_frame",
          displacements: {
            "1": { ux: 0, uy: 0, uz: 0 },
            "2": { ux: 0.001, uy: 0, uz: -0.02 },
          },
          forces: {
            E1: { axial: 10, n1: { V: 4, M: 8 } },
          },
          reactions: {
            "1": { fx: -3, fz: 10 },
          },
          caseResults: {
            D: {},
            L: {},
          },
          envelope: {
            maxAbsDisplacement: 0.02,
            maxAbsAxialForce: 10,
            maxAbsShearForce: 4,
            maxAbsMoment: 8,
            maxAbsReaction: 10,
            controlNodeDisplacement: "2",
            controlElementAxialForce: "E1",
            controlElementShearForce: "E1",
            controlElementMoment: "E1",
            controlNodeReaction: "1",
          },
          floorLoadTransfer: {
            requestedMode: "auto_code_cn",
            effectiveMode: "two_way_slab",
            method: "Two-way slab load transfer with equivalent uniform beam loads",
            methodZh: "双向板传至支承梁并折算为等效均布梁荷载",
            designCode: "GB 50010-2010(2015) 9.1.1",
            items: [
              {
                story: "F1",
                panelId: "F1:1:1",
                effectiveMode: "two_way_slab",
                method: "Two-way slab load transfer with equivalent uniform beam loads",
                methodZh: "双向板传至支承梁并折算为等效均布梁荷载",
                designCodeRule: "GB 50010 9.1.1: four-side supported slab with long/short span ratio <= 2.0 is calculated as two-way slab.",
                designCodeRuleZh: "GB 50010 9.1.1：四边支承板长短边比不大于 2.0 时，按双向板计算。",
                generatedLoadType: "distributed",
                generatedLoadCount: 4,
                loadIntensityKNPerM2: 6,
                totalLoadKN: 216,
              },
            ],
          },
          warnings: ["small warning"],
        },
      },
    });

    expect(summary).toMatchObject({
      success: true,
      skillId: "opensees-static",
      analysisMode: "opensees_2d_frame",
      counts: {
        nodeCount: 2,
        elementCount: 1,
        reactionNodeCount: 1,
        loadCaseCount: 2,
      },
      keyMetrics: {
        maxAbsDisplacement: 0.02,
        maxAbsAxialForce: 10,
        maxAbsShearForce: 4,
        maxAbsMoment: 8,
        maxAbsReaction: 10,
      },
      controlling: {
        controlNodeDisplacement: "2",
        controlElementAxialForce: "E1",
        controlElementShearForce: "E1",
        controlElementMoment: "E1",
        controlNodeReaction: "1",
      },
      floorLoadTransfer: {
        effectiveMode: "two_way_slab",
        method: "Two-way slab load transfer with equivalent uniform beam loads",
        methodZh: "双向板传至支承梁并折算为等效均布梁荷载",
        designCode: "GB 50010-2010(2015) 9.1.1",
        itemCount: 1,
        items: [
          {
            story: "F1",
            panelId: "F1:1:1",
            effectiveMode: "two_way_slab",
            generatedLoadType: "distributed",
            methodZh: "双向板传至支承梁并折算为等效均布梁荷载",
            designCodeRuleZh: "GB 50010 9.1.1：四边支承板长短边比不大于 2.0 时，按双向板计算。",
            generatedLoadCount: 4,
            loadIntensityKNPerM2: 6,
            totalLoadKN: 216,
          },
        ],
      },
      warnings: ["small warning"],
    });
    expect(JSON.stringify(summary)).not.toContain("displacements");
    expect(JSON.stringify(summary)).not.toContain("forces");
  });

  test("summarizes successful analysis artifacts returned at the top level", async () => {
    const { buildAnalysisToolSummary } = await import("../../../dist/agent-langgraph/tools.js");

    const summary = buildAnalysisToolSummary({
      skillId: "opensees-static",
      result: {
        success: true,
        analysisMode: "opensees_2d_frame",
        summary: {
          nodeCount: 3,
          elementCount: 2,
          reactionNodeCount: 2,
        },
        envelope: {
          maxAbsDisplacement: 0.01,
          maxAbsMoment: 5,
          controlNodeDisplacement: "N2",
          controlElementMoment: "E1",
        },
        caseResults: {
          LC1: {},
        },
        warnings: ["top-level warning"],
      },
    });

    expect(summary).toMatchObject({
      success: true,
      skillId: "opensees-static",
      analysisMode: "opensees_2d_frame",
      counts: {
        nodeCount: 3,
        elementCount: 2,
        reactionNodeCount: 2,
        loadCaseCount: 1,
      },
      keyMetrics: {
        maxAbsDisplacement: 0.01,
        maxAbsMoment: 5,
      },
      controlling: {
        controlNodeDisplacement: "N2",
        controlElementMoment: "E1",
      },
      warnings: ["top-level warning"],
    });
  });
});

describe("build model tool summary", () => {
  test("rejects empty models instead of reporting success", async () => {
    const { buildModelToolSummary } = await import("../../../dist/agent-langgraph/tools.js");

    const summary = buildModelToolSummary({
      schema_version: "1.0.0",
      nodes: [],
      elements: [],
    }, "zh");

    expect(summary).toEqual(expect.objectContaining({
      success: false,
      errorCode: "EMPTY_MODEL",
      nodeCount: 0,
      elementCount: 0,
    }));
    expect(summary.message).toContain("模型构建结果为空");
  });

  test("clears stale model and downstream artifacts when a rebuild returns an empty model", async () => {
    const { buildModelToolStateUpdate } = await import("../../../dist/agent-langgraph/tools.js");

    const update = buildModelToolStateUpdate(
      { schema_version: "1.0.0", nodes: [], elements: [] },
      { success: false, errorCode: "EMPTY_MODEL" },
    );

    expect(update).toEqual({
      model: null,
      analysisResult: null,
      codeCheckResult: null,
      report: null,
    });
  });
});
