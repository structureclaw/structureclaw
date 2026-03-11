import axios, { AxiosInstance } from 'axios';
import { ChatOpenAI } from '@langchain/openai';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { createChatModel } from '../utils/llm.js';
import { logger } from '../utils/logger.js';
import { redis } from '../utils/redis.js';

export type AgentToolName = 'text-to-model-draft' | 'convert' | 'validate' | 'analyze' | 'code-check' | 'report';
export type AgentRunMode = 'chat' | 'execute' | 'auto';
export type AgentReportFormat = 'json' | 'markdown' | 'both';
export type AgentReportOutput = 'inline' | 'file';
export type AgentUserDecision = 'provide_values' | 'confirm_all' | 'allow_auto_decide' | 'revise';
export type AgentInteractionState = 'collecting' | 'confirming' | 'ready' | 'executing' | 'completed' | 'blocked';
export type AgentInteractionStage = 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';

type InferredModelType = 'beam' | 'truss' | 'portal-frame' | 'double-span-beam' | 'unknown';

interface DraftState {
  inferredType: InferredModelType;
  lengthM?: number;
  spanLengthM?: number;
  heightM?: number;
  loadKN?: number;
  updatedAt: number;
}

interface DraftExtraction {
  inferredType?: InferredModelType;
  lengthM?: number;
  spanLengthM?: number;
  heightM?: number;
  loadKN?: number;
}

interface DraftResult {
  inferredType: InferredModelType;
  missingFields: string[];
  model?: Record<string, unknown>;
  extractionMode: 'llm' | 'rule-based';
  stateToPersist?: DraftState;
}

interface InteractionSession {
  draft: DraftState;
  userApprovedAutoDecide?: boolean;
  resolved?: {
    analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    designCode?: string;
    autoCodeCheck?: boolean;
    includeReport?: boolean;
    reportFormat?: AgentReportFormat;
    reportOutput?: AgentReportOutput;
  };
  updatedAt: number;
}

interface InteractionQuestion {
  paramKey: string;
  label: string;
  question: string;
  unit?: string;
  required: boolean;
  critical: boolean;
  suggestedValue?: unknown;
}

interface InteractionPending {
  criticalMissing: string[];
  nonCriticalMissing: string[];
}

interface InteractionDefaultProposal {
  paramKey: string;
  value: unknown;
  reason: string;
}

export interface AgentInteraction {
  state: AgentInteractionState;
  stage: AgentInteractionStage;
  turnId: string;
  questions?: InteractionQuestion[];
  pending?: InteractionPending;
  proposedDefaults?: InteractionDefaultProposal[];
  nextActions?: AgentUserDecision[];
}

export interface AgentRunParams {
  message: string;
  mode?: AgentRunMode;
  conversationId?: string;
  traceId?: string;
  context?: {
    model?: Record<string, unknown>;
    modelFormat?: string;
    analysisType?: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    parameters?: Record<string, unknown>;
    autoAnalyze?: boolean;
    autoCodeCheck?: boolean;
    designCode?: string;
    codeCheckElements?: string[];
    includeReport?: boolean;
    reportFormat?: AgentReportFormat;
    reportOutput?: AgentReportOutput;
    userDecision?: AgentUserDecision;
    providedValues?: Record<string, unknown>;
  };
}

export interface AgentToolSpec {
  name: AgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  errorCodes: string[];
}

export interface AgentProtocol {
  version: string;
  runRequestSchema: Record<string, unknown>;
  runResultSchema: Record<string, unknown>;
  streamEventSchema: Record<string, unknown>;
  tools: AgentToolSpec[];
  errorCodes: string[];
}

export interface AgentToolCall {
  tool: AgentToolName;
  input: Record<string, unknown>;
  status: 'success' | 'error';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  output?: unknown;
  error?: string;
  errorCode?: string;
}

export interface AgentRunResult {
  traceId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  mode: 'rule-based' | 'llm-assisted';
  needsModelInput: boolean;
  plan: string[];
  toolCalls: AgentToolCall[];
  model?: Record<string, unknown>;
  analysis?: unknown;
  codeCheck?: unknown;
  report?: {
    summary: string;
    json: Record<string, unknown>;
    markdown?: string;
  };
  artifacts?: Array<{
    type: 'report';
    format: 'json' | 'markdown';
    path: string;
  }>;
  metrics?: {
    toolCount: number;
    failedToolCount: number;
    totalToolDurationMs: number;
    averageToolDurationMs: number;
    maxToolDurationMs: number;
    toolDurationMsByName: Record<string, number>;
  };
  interaction?: AgentInteraction;
  clarification?: {
    missingFields: string[];
    question: string;
  };
  response: string;
}

export interface AgentStreamChunk {
  type: 'start' | 'interaction_update' | 'result' | 'done' | 'error';
  content?: unknown;
  error?: string;
}

export class AgentService {
  private readonly engineClient: AxiosInstance;
  private readonly llm: ChatOpenAI | null;
  private static readonly draftStateTtlSeconds = 30 * 60;

  constructor() {
    this.engineClient = axios.create({
      baseURL: config.analysisEngineUrl,
      timeout: 300000,
    });

    this.llm = createChatModel(0.1);
  }

  shouldRouteToExecute(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('分析')
      || text.includes('验算')
      || text.includes('校核')
      || text.includes('设计')
      || text.includes('建模')
      || text.includes('seismic')
      || text.includes('dynamic')
      || text.includes('nonlinear')
      || text.includes('code-check');
  }

  static getProtocol(): AgentProtocol {
    const commonErrorCodes = [
      'UNSUPPORTED_SOURCE_FORMAT',
      'UNSUPPORTED_TARGET_FORMAT',
      'INVALID_STRUCTURE_MODEL',
      'INVALID_ANALYSIS_TYPE',
      'ANALYSIS_EXECUTION_FAILED',
      'AGENT_MISSING_MODEL_INPUT',
    ];

    return {
      version: '2.0.0',
      runRequestSchema: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          mode: { enum: ['chat', 'execute', 'auto'] },
          conversationId: { type: 'string' },
          traceId: { type: 'string' },
          context: {
            type: 'object',
            properties: {
              model: { type: 'object' },
              modelFormat: { type: 'string' },
              analysisType: { enum: ['static', 'dynamic', 'seismic', 'nonlinear'] },
              parameters: { type: 'object' },
              autoAnalyze: { type: 'boolean' },
              autoCodeCheck: { type: 'boolean' },
              designCode: { type: 'string' },
              codeCheckElements: { type: 'array', items: { type: 'string' } },
              includeReport: { type: 'boolean' },
              reportFormat: { enum: ['json', 'markdown', 'both'] },
              reportOutput: { enum: ['inline', 'file'] },
              userDecision: { enum: ['provide_values', 'confirm_all', 'allow_auto_decide', 'revise'] },
              providedValues: { type: 'object' },
            },
          },
        },
      },
      runResultSchema: {
        type: 'object',
        required: ['traceId', 'startedAt', 'completedAt', 'durationMs', 'success', 'mode', 'needsModelInput', 'plan', 'toolCalls', 'response'],
        properties: {
          success: { type: 'boolean' },
          traceId: { type: 'string' },
          startedAt: { type: 'string' },
          completedAt: { type: 'string' },
          durationMs: { type: 'number' },
          mode: { enum: ['rule-based', 'llm-assisted'] },
          needsModelInput: { type: 'boolean' },
          plan: { type: 'array', items: { type: 'string' } },
          toolCalls: { type: 'array', items: { type: 'object' } },
          model: { type: 'object' },
          analysis: { type: 'object' },
          codeCheck: { type: 'object' },
          report: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              json: { type: 'object' },
              markdown: { type: 'string' },
            },
          },
          artifacts: { type: 'array', items: { type: 'object' } },
          metrics: {
            type: 'object',
            properties: {
              toolCount: { type: 'number' },
              failedToolCount: { type: 'number' },
              totalToolDurationMs: { type: 'number' },
              averageToolDurationMs: { type: 'number' },
              maxToolDurationMs: { type: 'number' },
              toolDurationMsByName: {
                type: 'object',
                additionalProperties: { type: 'number' },
              },
            },
          },
          interaction: {
            type: 'object',
            properties: {
              state: { enum: ['collecting', 'confirming', 'ready', 'executing', 'completed', 'blocked'] },
              stage: { enum: ['intent', 'model', 'loads', 'analysis', 'code_check', 'report'] },
              turnId: { type: 'string' },
              questions: { type: 'array', items: { type: 'object' } },
              pending: { type: 'object' },
              proposedDefaults: { type: 'array', items: { type: 'object' } },
              nextActions: { type: 'array', items: { type: 'string' } },
            },
          },
          response: { type: 'string' },
        },
      },
      streamEventSchema: {
        oneOf: [
          {
            type: 'object',
            properties: {
              type: { const: 'start' },
              content: {
                type: 'object',
                properties: {
                  traceId: { type: 'string' },
                  mode: { enum: ['chat', 'execute', 'auto'] },
                  conversationId: { type: 'string' },
                  startedAt: { type: 'string' },
                },
              },
            },
            required: ['type'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'interaction_update' },
              content: { type: 'object' },
            },
            required: ['type', 'content'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'result' },
              content: { type: 'object' },
            },
            required: ['type', 'content'],
          },
          {
            type: 'object',
            properties: { type: { const: 'done' } },
            required: ['type'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'error' },
              error: { type: 'string' },
            },
            required: ['type', 'error'],
          },
        ],
      },
      tools: [
        {
          name: 'text-to-model-draft',
          description: '从自然语言生成最小可计算 StructureModel v1 草案（LLM+规则混合）',
          inputSchema: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string' },
            },
          },
          outputSchema: {
            type: 'object',
            properties: {
              inferredType: { type: 'string' },
              missingFields: { type: 'array', items: { type: 'string' } },
              extractionMode: { enum: ['llm', 'rule-based'] },
              model: { type: 'object' },
            },
          },
          errorCodes: ['AGENT_MISSING_MODEL_INPUT'],
        },
        {
          name: 'convert',
          description: '模型格式转换，统一转为 structuremodel-v1 或导出到目标格式',
          inputSchema: {
            type: 'object',
            required: ['model'],
            properties: {
              model: { type: 'object' },
              source_format: { type: 'string' },
              target_format: { type: 'string' },
              target_schema_version: { type: 'string' },
            },
          },
          outputSchema: {
            type: 'object',
            properties: {
              sourceFormat: { type: 'string' },
              targetFormat: { type: 'string' },
              sourceSchemaVersion: { type: 'string' },
              targetSchemaVersion: { type: 'string' },
              model: { type: 'object' },
            },
          },
          errorCodes: ['UNSUPPORTED_SOURCE_FORMAT', 'UNSUPPORTED_TARGET_FORMAT', 'INVALID_STRUCTURE_MODEL'],
        },
        {
          name: 'validate',
          description: '校验结构模型字段合法性与引用完整性',
          inputSchema: {
            type: 'object',
            required: ['model'],
            properties: {
              model: { type: 'object' },
            },
          },
          outputSchema: {
            type: 'object',
            properties: {
              valid: { type: 'boolean' },
              schemaVersion: { type: 'string' },
              stats: { type: 'object' },
            },
          },
          errorCodes: ['INVALID_STRUCTURE_MODEL'],
        },
        {
          name: 'analyze',
          description: '执行结构分析（static/dynamic/seismic/nonlinear）',
          inputSchema: {
            type: 'object',
            required: ['type', 'model', 'parameters'],
            properties: {
              type: { enum: ['static', 'dynamic', 'seismic', 'nonlinear'] },
              model: { type: 'object' },
              parameters: { type: 'object' },
            },
          },
          outputSchema: {
            type: 'object',
            properties: {
              schema_version: { type: 'string' },
              analysis_type: { type: 'string' },
              success: { type: 'boolean' },
              error_code: { type: ['string', 'null'] },
              message: { type: 'string' },
              data: { type: 'object' },
              meta: { type: 'object' },
            },
          },
          errorCodes: ['INVALID_ANALYSIS_TYPE', 'ANALYSIS_EXECUTION_FAILED'],
        },
        {
          name: 'code-check',
          description: '结构规范校核（最小规则集）',
          inputSchema: {
            type: 'object',
            required: ['code', 'elements'],
            properties: {
              modelId: { type: 'string' },
              code: { type: 'string' },
              elements: { type: 'array', items: { type: 'string' } },
            },
          },
          outputSchema: {
            type: 'object',
          },
          errorCodes: [],
        },
        {
          name: 'report',
          description: '将模型、分析与校核结果汇总为可读报告',
          inputSchema: {
            type: 'object',
            required: ['message', 'analysis'],
            properties: {
              message: { type: 'string' },
              analysis: { type: 'object' },
              codeCheck: { type: 'object' },
              format: { enum: ['json', 'markdown', 'both'] },
            },
          },
          outputSchema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              json: { type: 'object' },
              markdown: { type: 'string' },
            },
          },
          errorCodes: [],
        },
      ],
      errorCodes: commonErrorCodes,
    };
  }

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const traceId = params.traceId || randomUUID();
    return this.runInternal(params, traceId);
  }

  async *runStream(params: AgentRunParams): AsyncGenerator<AgentStreamChunk> {
    const traceId = randomUUID();
    const startedAt = new Date().toISOString();
    try {
      yield {
        type: 'start',
        content: {
          traceId,
          mode: params.mode || 'auto',
          conversationId: params.conversationId,
          startedAt,
        },
      };

      const result = await this.runInternal({ ...params, traceId }, traceId);
      if (result.interaction && result.interaction.state !== 'completed') {
        yield {
          type: 'interaction_update',
          content: result.interaction,
        };
      }
      yield {
        type: 'result',
        content: result,
      };
      yield { type: 'done' };
    } catch (error: any) {
      yield {
        type: 'error',
        error: this.stringifyError(error),
      };
    }
  }

  private async runInternal(params: AgentRunParams, traceId: string): Promise<AgentRunResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();

    const runMode: AgentRunMode = params.mode || 'auto';
    if (runMode === 'chat') {
      const response = await this.renderSummary(params.message, '已收到你的问题。当前为纯聊天模式，未触发结构工具调用。');
      return {
        traceId,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        success: true,
        mode: this.llm ? 'llm-assisted' : 'rule-based',
        needsModelInput: false,
        plan: ['纯聊天模式：不调用结构工具'],
        toolCalls: [],
        metrics: this.buildMetrics([]),
        response,
      };
    }

    const modelInput = params.context?.model;
    const sourceFormat = params.context?.modelFormat || 'structuremodel-v1';
    const autoAnalyze = params.context?.autoAnalyze ?? true;
    const analysisParameters = params.context?.parameters || {};
    const userDecision = params.context?.userDecision;
    const providedValues = params.context?.providedValues || {};

    const plan: string[] = [];
    const toolCalls: AgentToolCall[] = [];
    const mode: 'rule-based' | 'llm-assisted' = this.llm ? 'llm-assisted' : 'rule-based';

    const sessionKey = params.conversationId?.trim();
    const session = await this.getInteractionSession(sessionKey);
    const existingState = session?.draft;
    let workingSession: InteractionSession = session || {
      draft: { inferredType: 'unknown', updatedAt: Date.now() },
      updatedAt: Date.now(),
      resolved: {},
    };

    this.applyResolvedConfigFromContext(workingSession, params.context);
    this.applyProvidedValuesToSession(workingSession, providedValues);
    if (userDecision === 'allow_auto_decide' || userDecision === 'confirm_all') {
      workingSession.userApprovedAutoDecide = true;
    } else if (userDecision === 'revise') {
      workingSession.userApprovedAutoDecide = false;
    }

    let normalizedModel = modelInput;
    if (!normalizedModel) {
      plan.push('从自然语言生成结构模型草案（支持会话级补数）');
      const draftCall = this.startToolCall('text-to-model-draft', { message: params.message, conversationId: sessionKey });
      toolCalls.push(draftCall);

      const draft = await this.textToModelDraft(params.message, existingState);
      if (draft.stateToPersist) {
        workingSession.draft = draft.stateToPersist;
      }
      workingSession.updatedAt = Date.now();
      this.applyInferredNonCriticalFromMessage(workingSession, params.message);

      this.completeToolCallSuccess(draftCall, {
        inferredType: draft.inferredType,
        missingFields: draft.missingFields,
        extractionMode: draft.extractionMode,
        modelGenerated: Boolean(draft.model),
      });

      if (workingSession.userApprovedAutoDecide) {
        for (let i = 0; i < 3; i += 1) {
          const assessment = this.assessInteractionNeeds(workingSession);
          if (assessment.nonCriticalMissing.length === 0) {
            break;
          }
          this.applyNonCriticalDefaults(workingSession, assessment.defaultProposals);
        }
      }

      const finalAssessment = this.assessInteractionNeeds(workingSession);
      if (finalAssessment.criticalMissing.length > 0 || finalAssessment.nonCriticalMissing.length > 0 || !draft.model) {
        if (sessionKey) {
          await this.setInteractionSession(sessionKey, workingSession);
        }

        const interaction = this.buildInteractionPayload(
          finalAssessment,
          workingSession,
          finalAssessment.criticalMissing.length > 0 ? 'confirming' : 'collecting',
        );
        const missingFields = this.mapMissingFieldLabels(finalAssessment.criticalMissing);
        const question = this.buildInteractionQuestion(interaction);
        const result: AgentRunResult = {
          traceId,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
          success: false,
          mode,
          needsModelInput: finalAssessment.criticalMissing.length > 0,
          plan,
          toolCalls,
          metrics: this.buildMetrics(toolCalls),
          interaction,
          clarification: {
            missingFields,
            question,
          },
          response: question,
        };

        this.logRunResult(traceId, sessionKey, result);
        return result;
      }

      normalizedModel = draft.model;
    }

    const resolvedAnalysisType = workingSession.resolved?.analysisType || params.context?.analysisType || this.inferAnalysisType(params.message);
    const resolvedDesignCode = workingSession.resolved?.designCode || params.context?.designCode || 'GB50017';
    const resolvedAutoCodeCheck = workingSession.resolved?.autoCodeCheck ?? params.context?.autoCodeCheck ?? this.inferCodeCheckIntent(params.message);
    const resolvedIncludeReport = workingSession.resolved?.includeReport ?? params.context?.includeReport ?? true;
    const resolvedReportFormat = workingSession.resolved?.reportFormat || params.context?.reportFormat || 'both';
    const resolvedReportOutput = workingSession.resolved?.reportOutput || params.context?.reportOutput || 'inline';

    if (sourceFormat !== 'structuremodel-v1') {
      plan.push(`将输入模型从 ${sourceFormat} 转为 structuremodel-v1`);
      const convertInput = {
        model: modelInput,
        source_format: sourceFormat,
        target_format: 'structuremodel-v1',
        target_schema_version: '1.0.0',
      };
      const convertCall = this.startToolCall('convert', convertInput);
      toolCalls.push(convertCall);

      try {
        const converted = await this.engineClient.post('/convert', convertInput);
        this.completeToolCallSuccess(convertCall, converted.data);
        normalizedModel = (converted.data?.model ?? {}) as Record<string, unknown>;
      } catch (error: any) {
        this.completeToolCallError(convertCall, error);
        const result: AgentRunResult = {
          traceId,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
          success: false,
          mode,
          needsModelInput: false,
          plan,
          toolCalls,
          metrics: this.buildMetrics(toolCalls),
            interaction: this.buildExecutionInteraction('blocked'),
            response: `模型格式转换失败：${convertCall.error}`,
          };
        this.logRunResult(traceId, sessionKey, result);
        return result;
      }
    }

    plan.push('校验模型字段与引用完整性');
    const validateInput = { model: normalizedModel };
    const validateCall = this.startToolCall('validate', validateInput);
    toolCalls.push(validateCall);

    try {
      const validated = await this.engineClient.post('/validate', validateInput);
      this.completeToolCallSuccess(validateCall, validated.data);
      if (validated.data?.valid === false) {
        validateCall.status = 'error';
        validateCall.errorCode = validated.data?.errorCode || 'INVALID_STRUCTURE_MODEL';
        validateCall.error = validated.data?.message || '模型校验失败';
        const result: AgentRunResult = {
          traceId,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
          success: false,
          mode,
          needsModelInput: false,
          plan,
          toolCalls,
          model: normalizedModel,
          metrics: this.buildMetrics(toolCalls),
          interaction: this.buildExecutionInteraction('blocked'),
          response: `模型校验失败：${validateCall.error}`,
        };
        this.logRunResult(traceId, sessionKey, result);
        return result;
      }
    } catch (error: any) {
      this.completeToolCallError(validateCall, error);
      const result: AgentRunResult = {
        traceId,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        success: false,
        mode,
        needsModelInput: false,
        plan,
        toolCalls,
        model: normalizedModel,
        metrics: this.buildMetrics(toolCalls),
        interaction: this.buildExecutionInteraction('blocked'),
        response: `模型校验失败：${validateCall.error}`,
      };
      this.logRunResult(traceId, sessionKey, result);
      return result;
    }

    if (!autoAnalyze) {
      const response = await this.renderSummary(
        params.message,
        '模型已通过校验。根据配置未自动执行 analyze。',
      );
      const result: AgentRunResult = {
        traceId,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        success: true,
        mode,
        needsModelInput: false,
        plan,
        toolCalls,
        model: normalizedModel,
        metrics: this.buildMetrics(toolCalls),
        interaction: this.buildExecutionInteraction('completed'),
        response,
      };
      if (sessionKey) {
        await this.clearInteractionSession(sessionKey);
      }
      this.logRunResult(traceId, sessionKey, result);
      return result;
    }

    plan.push(`执行 ${resolvedAnalysisType} 分析并返回摘要`);
    const analyzeInput = {
      type: resolvedAnalysisType,
      model: normalizedModel,
      parameters: analysisParameters,
    };
    const analyzeCall = this.startToolCall('analyze', analyzeInput);
    toolCalls.push(analyzeCall);

    try {
      const analyzed = await this.engineClient.post('/analyze', analyzeInput);
      this.completeToolCallSuccess(analyzeCall, analyzed.data);
      const analysisSuccess = Boolean(analyzed.data?.success);
      let codeCheckResult: unknown;

      if (analysisSuccess && resolvedAutoCodeCheck) {
        plan.push(`执行 ${resolvedDesignCode} 规范校核`);
        const codeCheckElements = params.context?.codeCheckElements?.length
          ? params.context?.codeCheckElements
          : this.extractElementIds(normalizedModel);
        const codeCheckInput = {
          modelId: traceId,
          code: resolvedDesignCode,
          elements: codeCheckElements,
          context: {
            analysisSummary: this.extractAnalysisSummary(analyzed.data),
            utilizationByElement: this.extractUtilizationByElement(analysisParameters),
          },
        };
        const codeCheckCall = this.startToolCall('code-check', codeCheckInput);
        toolCalls.push(codeCheckCall);

        try {
          const codeChecked = await this.engineClient.post('/code-check', {
            model_id: codeCheckInput.modelId,
            code: codeCheckInput.code,
            elements: codeCheckInput.elements,
            context: codeCheckInput.context,
          });
          this.completeToolCallSuccess(codeCheckCall, codeChecked.data);
          codeCheckResult = codeChecked.data;
        } catch (error: any) {
          this.completeToolCallError(codeCheckCall, error);
          const result: AgentRunResult = {
            traceId,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAtMs,
            success: false,
            mode,
            needsModelInput: false,
            plan,
            toolCalls,
            model: normalizedModel,
            analysis: analyzed.data,
            metrics: this.buildMetrics(toolCalls),
            interaction: this.buildExecutionInteraction('blocked'),
            response: `规范校核失败：${codeCheckCall.error}`,
          };
          this.logRunResult(traceId, sessionKey, result);
          return result;
        }
      }

      let report: AgentRunResult['report'];
      let artifacts: AgentRunResult['artifacts'];
      if (analysisSuccess && resolvedIncludeReport) {
        plan.push('生成可读计算与校核报告');
        const reportCall = this.startToolCall('report', {
          message: params.message,
          analysis: analyzed.data,
          codeCheck: codeCheckResult,
          format: resolvedReportFormat,
        });
        toolCalls.push(reportCall);
        report = this.generateReport({
          message: params.message,
          analysisType: resolvedAnalysisType,
          analysis: analyzed.data,
          codeCheck: codeCheckResult,
          format: resolvedReportFormat,
        });
        if (report && resolvedReportOutput === 'file') {
          artifacts = await this.persistReportArtifacts(traceId, report, resolvedReportFormat);
        }
        this.completeToolCallSuccess(reportCall, report);
      }

      const response = await this.renderSummary(
        params.message,
        `分析完成。analysis_type=${resolvedAnalysisType}, success=${String(analyzed.data?.success ?? false)}`
          + (resolvedAutoCodeCheck ? `, code_check=${String(Boolean(codeCheckResult))}` : ''),
      );

      const result: AgentRunResult = {
        traceId,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        success: analysisSuccess,
        mode,
        needsModelInput: false,
        plan,
        toolCalls,
        model: normalizedModel,
        analysis: analyzed.data,
        codeCheck: codeCheckResult,
        report,
        artifacts,
        metrics: this.buildMetrics(toolCalls),
        interaction: this.buildExecutionInteraction('completed'),
        response,
      };
      if (sessionKey) {
        await this.clearInteractionSession(sessionKey);
      }
      this.logRunResult(traceId, sessionKey, result);
      return result;
    } catch (error: any) {
      this.completeToolCallError(analyzeCall, error);
      const result: AgentRunResult = {
        traceId,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        success: false,
        mode,
        needsModelInput: false,
        plan,
        toolCalls,
        model: normalizedModel,
        metrics: this.buildMetrics(toolCalls),
        interaction: this.buildExecutionInteraction('blocked'),
        response: `分析执行失败：${analyzeCall.error}`,
      };
      this.logRunResult(traceId, sessionKey, result);
      return result;
    }
  }

  private inferAnalysisType(message: string): 'static' | 'dynamic' | 'seismic' | 'nonlinear' {
    const text = message.toLowerCase();
    if (text.includes('地震') || text.includes('seismic')) {
      return 'seismic';
    }
    if (text.includes('动力') || text.includes('dynamic') || text.includes('时程')) {
      return 'dynamic';
    }
    if (text.includes('非线性') || text.includes('nonlinear')) {
      return 'nonlinear';
    }
    return 'static';
  }

  private inferCodeCheckIntent(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('校核')
      || text.includes('规范')
      || text.includes('code-check')
      || text.includes('验算');
  }

  private inferDesignCode(message: string): string | undefined {
    const match = message.toUpperCase().match(/GB\s*([0-9]{5})/);
    if (!match?.[1]) {
      return undefined;
    }
    return `GB${match[1]}`;
  }

  private inferReportIntent(message: string): boolean | undefined {
    const text = message.toLowerCase();
    if (text.includes('报告') || text.includes('report')) {
      return true;
    }
    return undefined;
  }

  private assessInteractionNeeds(session: InteractionSession): {
    criticalMissing: string[];
    nonCriticalMissing: string[];
    defaultProposals: InteractionDefaultProposal[];
  } {
    const criticalMissing = this.computeMissingCriticalKeys(session.draft);
    const nonCriticalMissing: string[] = [];
    const resolved = session.resolved || {};

    if (!resolved.analysisType) {
      nonCriticalMissing.push('analysisType');
    }
    if (resolved.autoCodeCheck === undefined) {
      nonCriticalMissing.push('autoCodeCheck');
    }
    if (resolved.autoCodeCheck === true && !resolved.designCode) {
      nonCriticalMissing.push('designCode');
    }
    if (resolved.includeReport === undefined) {
      nonCriticalMissing.push('includeReport');
    }
    if (resolved.includeReport === true && !resolved.reportFormat) {
      nonCriticalMissing.push('reportFormat');
    }
    if (resolved.includeReport === true && !resolved.reportOutput) {
      nonCriticalMissing.push('reportOutput');
    }

    return {
      criticalMissing,
      nonCriticalMissing,
      defaultProposals: this.buildDefaultProposals(nonCriticalMissing),
    };
  }

  private buildDefaultProposals(nonCriticalMissing: string[]): InteractionDefaultProposal[] {
    return nonCriticalMissing.map((key) => {
      switch (key) {
        case 'analysisType':
          return { paramKey: key, value: 'static', reason: '默认采用静力分析，属于最保守且最常用起步工况。' };
        case 'autoCodeCheck':
          return { paramKey: key, value: true, reason: '默认开启规范校核以保证验算完整性。' };
        case 'designCode':
          return { paramKey: key, value: 'GB50017', reason: '默认采用钢结构设计标准 GB50017 进行保守校核。' };
        case 'includeReport':
          return { paramKey: key, value: true, reason: '默认生成报告，便于复核输入与结果。' };
        case 'reportFormat':
          return { paramKey: key, value: 'both', reason: '默认同时输出 json/markdown，兼顾机器和人工阅读。' };
        case 'reportOutput':
          return { paramKey: key, value: 'inline', reason: '默认内联返回，减少文件写入依赖。' };
        default:
          return { paramKey: key, value: null, reason: '默认保守值。' };
      }
    });
  }

  private applyNonCriticalDefaults(session: InteractionSession, defaults: InteractionDefaultProposal[]): void {
    session.resolved = session.resolved || {};
    for (const proposal of defaults) {
      switch (proposal.paramKey) {
        case 'analysisType':
          session.resolved.analysisType = proposal.value as NonNullable<InteractionSession['resolved']>['analysisType'];
          break;
        case 'autoCodeCheck':
          session.resolved.autoCodeCheck = Boolean(proposal.value);
          break;
        case 'designCode':
          session.resolved.designCode = String(proposal.value);
          break;
        case 'includeReport':
          session.resolved.includeReport = Boolean(proposal.value);
          break;
        case 'reportFormat':
          session.resolved.reportFormat = proposal.value as AgentReportFormat;
          break;
        case 'reportOutput':
          session.resolved.reportOutput = proposal.value as AgentReportOutput;
          break;
        default:
          break;
      }
    }
    session.updatedAt = Date.now();
  }

  private applyResolvedConfigFromContext(session: InteractionSession, context: AgentRunParams['context'] | undefined): void {
    if (!context) {
      return;
    }
    session.resolved = session.resolved || {};
    if (context.analysisType) {
      session.resolved.analysisType = context.analysisType;
    }
    if (context.designCode) {
      session.resolved.designCode = context.designCode;
    }
    if (context.autoCodeCheck !== undefined) {
      session.resolved.autoCodeCheck = context.autoCodeCheck;
    }
    if (context.includeReport !== undefined) {
      session.resolved.includeReport = context.includeReport;
    }
    if (context.reportFormat) {
      session.resolved.reportFormat = context.reportFormat;
    }
    if (context.reportOutput) {
      session.resolved.reportOutput = context.reportOutput;
    }
  }

  private applyInferredNonCriticalFromMessage(session: InteractionSession, message: string): void {
    session.resolved = session.resolved || {};
    if (!session.resolved.analysisType) {
      session.resolved.analysisType = this.inferAnalysisType(message);
    }
    const inferredCode = this.inferDesignCode(message);
    if (inferredCode && !session.resolved.designCode) {
      session.resolved.designCode = inferredCode;
    }
    if (session.resolved.autoCodeCheck === undefined && this.inferCodeCheckIntent(message)) {
      session.resolved.autoCodeCheck = true;
    }
    if (session.resolved.includeReport === undefined) {
      const reportIntent = this.inferReportIntent(message);
      if (reportIntent !== undefined) {
        session.resolved.includeReport = reportIntent;
      }
    }
  }

  private applyProvidedValuesToSession(session: InteractionSession, values: Record<string, unknown>): void {
    if (!values || typeof values !== 'object') {
      return;
    }
    const nextDraft: DraftExtraction = {
      inferredType: this.normalizeInferredType(values.inferredType),
      lengthM: this.normalizeNumber(values.lengthM),
      spanLengthM: this.normalizeNumber(values.spanLengthM),
      heightM: this.normalizeNumber(values.heightM),
      loadKN: this.normalizeNumber(values.loadKN),
    };
    session.draft = this.mergeDraftState(session.draft, nextDraft);
    session.resolved = session.resolved || {};
    if (typeof values.analysisType === 'string') {
      session.resolved.analysisType = this.normalizeAnalysisType(values.analysisType);
    }
    if (typeof values.designCode === 'string' && values.designCode.trim()) {
      session.resolved.designCode = values.designCode.trim().toUpperCase();
    }
    if (typeof values.autoCodeCheck === 'boolean') {
      session.resolved.autoCodeCheck = values.autoCodeCheck;
    }
    if (typeof values.includeReport === 'boolean') {
      session.resolved.includeReport = values.includeReport;
    }
    if (typeof values.reportFormat === 'string') {
      session.resolved.reportFormat = this.normalizeReportFormat(values.reportFormat);
    }
    if (typeof values.reportOutput === 'string') {
      session.resolved.reportOutput = this.normalizeReportOutput(values.reportOutput);
    }
    session.updatedAt = Date.now();
  }

  private normalizeAnalysisType(value: string): NonNullable<InteractionSession['resolved']>['analysisType'] {
    if (value === 'static' || value === 'dynamic' || value === 'seismic' || value === 'nonlinear') {
      return value;
    }
    return 'static';
  }

  private normalizeReportFormat(value: string): AgentReportFormat {
    if (value === 'json' || value === 'markdown' || value === 'both') {
      return value;
    }
    return 'both';
  }

  private normalizeReportOutput(value: string): AgentReportOutput {
    if (value === 'inline' || value === 'file') {
      return value;
    }
    return 'inline';
  }

  private computeMissingCriticalKeys(state: DraftState): string[] {
    const missing: string[] = [];
    if (state.inferredType === 'unknown') {
      missing.push('inferredType');
      return missing;
    }

    if (state.inferredType === 'portal-frame') {
      if (state.spanLengthM === undefined) {
        missing.push('spanLengthM');
      }
      if (state.heightM === undefined) {
        missing.push('heightM');
      }
      if (state.loadKN === undefined) {
        missing.push('loadKN');
      }
      return missing;
    }

    if (state.inferredType === 'double-span-beam') {
      if (state.spanLengthM === undefined) {
        missing.push('spanLengthM');
      }
      if (state.loadKN === undefined) {
        missing.push('loadKN');
      }
      return missing;
    }

    if (state.lengthM === undefined) {
      missing.push('lengthM');
    }
    if (state.loadKN === undefined) {
      missing.push('loadKN');
    }
    return missing;
  }

  private mapMissingFieldLabels(missing: string[]): string[] {
    return missing.map((key) => {
      switch (key) {
        case 'inferredType':
          return '结构类型（门式刚架/双跨梁/梁/平面桁架）';
        case 'lengthM':
          return '跨度/长度（m）';
        case 'spanLengthM':
          return '门式刚架或双跨每跨跨度（m）';
        case 'heightM':
          return '门式刚架柱高（m）';
        case 'loadKN':
          return '荷载大小（kN）';
        case 'analysisType':
          return '分析类型（static/dynamic/seismic/nonlinear）';
        case 'designCode':
          return '规范编号（如 GB50017）';
        case 'autoCodeCheck':
          return '是否自动规范校核';
        case 'includeReport':
          return '是否生成报告';
        case 'reportFormat':
          return '报告格式（json/markdown/both）';
        case 'reportOutput':
          return '报告输出位置（inline/file）';
        default:
          return key;
      }
    });
  }

  private buildInteractionPayload(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] },
    session: InteractionSession,
    state: AgentInteractionState,
  ): AgentInteraction {
    const missingKeys = [...assessment.criticalMissing, ...assessment.nonCriticalMissing];
    const questions = this.buildInteractionQuestions(missingKeys, assessment.criticalMissing);
    return {
      state,
      stage: this.resolveInteractionStage(missingKeys),
      turnId: randomUUID(),
      questions,
      pending: {
        criticalMissing: this.mapMissingFieldLabels(assessment.criticalMissing),
        nonCriticalMissing: this.mapMissingFieldLabels(assessment.nonCriticalMissing),
      },
      proposedDefaults: assessment.defaultProposals,
      nextActions: assessment.criticalMissing.length > 0
        ? ['provide_values', 'revise']
        : ['provide_values', 'allow_auto_decide', 'confirm_all', 'revise'],
    };
  }

  private buildInteractionQuestions(missingKeys: string[], criticalMissing: string[]): InteractionQuestion[] {
    return missingKeys.map((paramKey) => {
      const critical = criticalMissing.includes(paramKey);
      switch (paramKey) {
        case 'inferredType':
          return { paramKey, label: '结构类型', question: '请确认结构类型（门式刚架/双跨梁/梁/平面桁架）。', required: true, critical };
        case 'lengthM':
          return { paramKey, label: '跨度/长度', question: '请确认跨度或长度。', unit: 'm', required: true, critical };
        case 'spanLengthM':
          return { paramKey, label: '每跨跨度', question: '请确认门式刚架或双跨梁每跨跨度。', unit: 'm', required: true, critical };
        case 'heightM':
          return { paramKey, label: '柱高', question: '请确认门式刚架柱高。', unit: 'm', required: true, critical };
        case 'loadKN':
          return { paramKey, label: '荷载', question: '请确认控制荷载大小。', unit: 'kN', required: true, critical };
        case 'analysisType':
          return { paramKey, label: '分析类型', question: '请选择分析类型。', required: true, critical, suggestedValue: 'static' };
        case 'autoCodeCheck':
          return { paramKey, label: '自动校核', question: '是否自动执行规范校核？', required: true, critical, suggestedValue: true };
        case 'designCode':
          return { paramKey, label: '规范编号', question: '请确认规范编号（例如 GB50017）。', required: true, critical, suggestedValue: 'GB50017' };
        case 'includeReport':
          return { paramKey, label: '报告开关', question: '是否生成计算与校核报告？', required: true, critical, suggestedValue: true };
        case 'reportFormat':
          return { paramKey, label: '报告格式', question: '请确认报告格式。', required: true, critical, suggestedValue: 'both' };
        case 'reportOutput':
          return { paramKey, label: '报告输出', question: '请确认报告输出位置。', required: true, critical, suggestedValue: 'inline' };
        default:
          return { paramKey, label: paramKey, question: `请确认参数 ${paramKey}。`, required: true, critical };
      }
    });
  }

  private resolveInteractionStage(missingKeys: string[]): AgentInteractionStage {
    if (missingKeys.includes('inferredType')) {
      return 'intent';
    }
    if (missingKeys.some((key) => key === 'lengthM' || key === 'spanLengthM' || key === 'heightM')) {
      return 'model';
    }
    if (missingKeys.includes('loadKN')) {
      return 'loads';
    }
    if (missingKeys.includes('analysisType')) {
      return 'analysis';
    }
    if (missingKeys.includes('autoCodeCheck') || missingKeys.includes('designCode')) {
      return 'code_check';
    }
    return 'report';
  }

  private buildInteractionQuestion(interaction: AgentInteraction): string {
    const questionSummary = interaction.questions?.map((item) => item.label).join('、') || '必要参数';
    return `请先确认以下参数：${questionSummary}。若希望我按保守值自动决策，请回复“你决定”并触发 allow_auto_decide。`;
  }

  private buildExecutionInteraction(state: 'completed' | 'blocked'): AgentInteraction {
    return {
      state,
      stage: 'report',
      turnId: randomUUID(),
      nextActions: state === 'completed' ? [] : ['revise'],
    };
  }

  private extractElementIds(model: Record<string, unknown> | undefined): string[] {
    if (!model) {
      return [];
    }
    const elements = model['elements'];
    if (!Array.isArray(elements)) {
      return [];
    }
    return elements
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  private generateReport(params: {
    message: string;
    analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    analysis: unknown;
    codeCheck?: unknown;
    format: AgentReportFormat;
  }): AgentRunResult['report'] {
    const analysisSuccess = Boolean((params.analysis as any)?.success);
    const codeCheckSummary = (params.codeCheck as any)?.summary;
    const codeCheckText = codeCheckSummary
      ? `校核通过 ${String(codeCheckSummary.passed ?? 0)} / ${String(codeCheckSummary.total ?? 0)}`
      : '未执行规范校核';
    const summary = `分析类型 ${params.analysisType}，分析${analysisSuccess ? '成功' : '失败'}，${codeCheckText}。`;
    const keyMetrics = this.extractKeyMetrics(params.analysis, params.codeCheck);
    const clauseTraceability = this.extractClauseTraceability(params.codeCheck);
    const controllingCases = this.extractControllingCases(params.analysis);
    const jsonReport: Record<string, unknown> = {
      reportSchemaVersion: '1.0.0',
      intent: params.message,
      analysisType: params.analysisType,
      summary,
      keyMetrics,
      clauseTraceability,
      controllingCases,
      analysis: params.analysis,
      codeCheck: params.codeCheck,
      generatedAt: new Date().toISOString(),
    };

    if (params.format === 'json') {
      return {
        summary,
        json: jsonReport,
      };
    }

    const markdown = [
      '# StructureClaw 计算报告',
      '',
      '## 目录',
      '1. 执行摘要',
      '2. 关键指标',
      '3. 条文追溯',
      '4. 控制工况',
      '',
      '## 执行摘要',
      `- 用户意图：${params.message}`,
      `- 分析类型：${params.analysisType}`,
      `- 分析结果：${analysisSuccess ? '成功' : '失败'}`,
      `- 规范校核：${codeCheckText}`,
      '',
      summary,
      '',
      '## 关键指标',
      `- 最大位移: ${String((keyMetrics as Record<string, unknown>).maxAbsDisplacement ?? 'N/A')}`,
      `- 最大轴力: ${String((keyMetrics as Record<string, unknown>).maxAbsAxialForce ?? 'N/A')}`,
      `- 最大剪力: ${String((keyMetrics as Record<string, unknown>).maxAbsShearForce ?? 'N/A')}`,
      `- 最大弯矩: ${String((keyMetrics as Record<string, unknown>).maxAbsMoment ?? 'N/A')}`,
      `- 最大反力: ${String((keyMetrics as Record<string, unknown>).maxAbsReaction ?? 'N/A')}`,
      `- 校核通过率: ${String((keyMetrics as Record<string, unknown>).codeCheckPassRate ?? 'N/A')}`,
      '',
      '## 条文追溯',
      ...this.renderClauseTraceabilityMarkdown(clauseTraceability),
      '',
      '## 控制工况',
      ...this.renderControllingCasesMarkdown(controllingCases),
    ].join('\n');

    return {
      summary,
      json: jsonReport,
      markdown: params.format === 'both' || params.format === 'markdown' ? markdown : undefined,
    };
  }

  private extractKeyMetrics(analysis: unknown, codeCheck: unknown): Record<string, unknown> {
    const analysisPayload = analysis && typeof analysis === 'object' ? analysis as Record<string, unknown> : {};
    const analysisData = analysisPayload['data'];
    const analysisDataObject = analysisData && typeof analysisData === 'object' ? analysisData as Record<string, unknown> : {};
    const envelope = analysisDataObject['envelope'];
    const envelopeObject = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {};

    const codeCheckPayload = codeCheck && typeof codeCheck === 'object' ? codeCheck as Record<string, unknown> : {};
    const codeCheckSummary = codeCheckPayload['summary'];
    const codeCheckSummaryObject = codeCheckSummary && typeof codeCheckSummary === 'object'
      ? codeCheckSummary as Record<string, unknown>
      : {};
    const total = Number(codeCheckSummaryObject['total'] ?? 0);
    const passed = Number(codeCheckSummaryObject['passed'] ?? 0);

    return {
      maxAbsDisplacement: envelopeObject['maxAbsDisplacement'] ?? null,
      maxAbsAxialForce: envelopeObject['maxAbsAxialForce'] ?? null,
      maxAbsShearForce: envelopeObject['maxAbsShearForce'] ?? null,
      maxAbsMoment: envelopeObject['maxAbsMoment'] ?? null,
      maxAbsReaction: envelopeObject['maxAbsReaction'] ?? null,
      codeCheckPassRate: total > 0 ? Number((passed / total).toFixed(4)) : null,
    };
  }

  private extractClauseTraceability(codeCheck: unknown): Array<Record<string, unknown>> {
    const codeCheckPayload = codeCheck && typeof codeCheck === 'object' ? codeCheck as Record<string, unknown> : {};
    const details = codeCheckPayload['details'];
    if (!Array.isArray(details)) {
      return [];
    }

    const traceRows: Array<Record<string, unknown>> = [];
    for (const detail of details) {
      if (!detail || typeof detail !== 'object') {
        continue;
      }
      const detailObject = detail as Record<string, unknown>;
      const elementId = detailObject['elementId'];
      const checks = detailObject['checks'];
      if (!Array.isArray(checks)) {
        continue;
      }
      for (const check of checks) {
        if (!check || typeof check !== 'object') {
          continue;
        }
        const checkObject = check as Record<string, unknown>;
        const checkName = checkObject['name'];
        const items = checkObject['items'];
        if (!Array.isArray(items)) {
          continue;
        }
        for (const item of items) {
          if (!item || typeof item !== 'object') {
            continue;
          }
          const itemObject = item as Record<string, unknown>;
          traceRows.push({
            elementId: typeof elementId === 'string' ? elementId : 'unknown',
            check: typeof checkName === 'string' ? checkName : 'unknown',
            item: typeof itemObject['item'] === 'string' ? itemObject['item'] : 'unknown',
            clause: typeof itemObject['clause'] === 'string' ? itemObject['clause'] : '',
            formula: typeof itemObject['formula'] === 'string' ? itemObject['formula'] : '',
            utilization: itemObject['utilization'] ?? null,
            status: typeof itemObject['status'] === 'string' ? itemObject['status'] : 'unknown',
          });
        }
      }
    }

    return traceRows.slice(0, 20);
  }

  private extractControllingCases(analysis: unknown): Record<string, unknown> {
    const analysisPayload = analysis && typeof analysis === 'object' ? analysis as Record<string, unknown> : {};
    const analysisData = analysisPayload['data'];
    const analysisDataObject = analysisData && typeof analysisData === 'object' ? analysisData as Record<string, unknown> : {};
    const envelope = analysisDataObject['envelope'];
    const envelopeObject = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {};

    const controlCase = envelopeObject['controlCase'];
    const batchControlCase = controlCase && typeof controlCase === 'object' ? controlCase as Record<string, unknown> : {};

    return {
      batchControlCase,
      controlNodeDisplacement: envelopeObject['controlNodeDisplacement'] ?? null,
      controlElementAxialForce: envelopeObject['controlElementAxialForce'] ?? null,
      controlElementShearForce: envelopeObject['controlElementShearForce'] ?? null,
      controlElementMoment: envelopeObject['controlElementMoment'] ?? null,
      controlNodeReaction: envelopeObject['controlNodeReaction'] ?? null,
    };
  }

  private renderClauseTraceabilityMarkdown(traceability: Array<Record<string, unknown>>): string[] {
    if (traceability.length === 0) {
      return ['- 无条文追溯数据'];
    }
    return traceability.slice(0, 8).map((row) => {
      const elementId = row['elementId'] ?? 'unknown';
      const check = row['check'] ?? 'unknown';
      const clause = row['clause'] ?? '';
      const utilization = row['utilization'] ?? 'N/A';
      const status = row['status'] ?? 'unknown';
      return `- 构件 ${String(elementId)} / ${String(check)} / ${String(clause)} / 利用率 ${String(utilization)} / ${String(status)}`;
    });
  }

  private renderControllingCasesMarkdown(controllingCases: Record<string, unknown>): string[] {
    const batchControlCaseRaw = controllingCases['batchControlCase'];
    const batchControlCase = batchControlCaseRaw && typeof batchControlCaseRaw === 'object'
      ? batchControlCaseRaw as Record<string, unknown>
      : {};
    const lines = [
      `- 批量位移控制工况: ${String(batchControlCase['displacement'] ?? 'N/A')}`,
      `- 批量轴力控制工况: ${String(batchControlCase['axialForce'] ?? 'N/A')}`,
      `- 批量剪力控制工况: ${String(batchControlCase['shearForce'] ?? 'N/A')}`,
      `- 批量弯矩控制工况: ${String(batchControlCase['moment'] ?? 'N/A')}`,
      `- 批量反力控制工况: ${String(batchControlCase['reaction'] ?? 'N/A')}`,
      `- 位移控制节点: ${String(controllingCases['controlNodeDisplacement'] ?? 'N/A')}`,
      `- 轴力控制单元: ${String(controllingCases['controlElementAxialForce'] ?? 'N/A')}`,
      `- 剪力控制单元: ${String(controllingCases['controlElementShearForce'] ?? 'N/A')}`,
      `- 弯矩控制单元: ${String(controllingCases['controlElementMoment'] ?? 'N/A')}`,
      `- 反力控制节点: ${String(controllingCases['controlNodeReaction'] ?? 'N/A')}`,
    ];
    return lines;
  }

  private extractAnalysisSummary(analysis: unknown): Record<string, unknown> {
    const data = analysis as Record<string, unknown> | undefined;
    if (!data) {
      return {};
    }
    return {
      analysisType: data['analysis_type'],
      success: data['success'],
      errorCode: data['error_code'],
      message: data['message'],
    };
  }

  private extractUtilizationByElement(parameters: Record<string, unknown>): Record<string, unknown> {
    const raw = parameters['utilizationByElement'];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  private async persistReportArtifacts(
    traceId: string,
    report: NonNullable<AgentRunResult['report']>,
    format: AgentReportFormat,
  ): Promise<NonNullable<AgentRunResult['artifacts']>> {
    const reportDir = path.resolve(config.uploadDir, 'reports');
    await mkdir(reportDir, { recursive: true });

    const artifacts: NonNullable<AgentRunResult['artifacts']> = [];
    if (format === 'json' || format === 'both') {
      const jsonPath = path.join(reportDir, `${traceId}.json`);
      await writeFile(jsonPath, JSON.stringify(report.json, null, 2), 'utf-8');
      artifacts.push({
        type: 'report',
        format: 'json',
        path: jsonPath,
      });
    }
    if ((format === 'markdown' || format === 'both') && report.markdown) {
      const mdPath = path.join(reportDir, `${traceId}.md`);
      await writeFile(mdPath, report.markdown, 'utf-8');
      artifacts.push({
        type: 'report',
        format: 'markdown',
        path: mdPath,
      });
    }
    return artifacts;
  }

  private async renderSummary(message: string, fallback: string): Promise<string> {
    if (!this.llm) {
      return fallback;
    }

    try {
      const prompt = [
        '你是结构工程 Agent 的结果解释器。',
        '请用中文在 80 字以内给出结论，不要杜撰未出现的数据。',
        `用户意图：${message}`,
        `系统结果：${fallback}`,
      ].join('\n');
      const aiMessage = await this.llm.invoke(prompt);
      const content = typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
      return content || fallback;
    } catch {
      return fallback;
    }
  }

  private async textToModelDraft(message: string, existingState?: DraftState): Promise<DraftResult> {
    const llmExtraction = await this.tryLlmExtract(message, existingState);
    const extractionMode: 'llm' | 'rule-based' = llmExtraction ? 'llm' : 'rule-based';

    const mergedState = this.mergeDraftState(
      existingState,
      llmExtraction || this.extractDraftByRules(message),
    );

    const missingFields = this.computeMissingFields(mergedState);
    if (missingFields.length > 0) {
      return {
        inferredType: mergedState.inferredType,
        missingFields,
        extractionMode,
        stateToPersist: mergedState,
      };
    }

    return {
      inferredType: mergedState.inferredType,
      missingFields: [],
      extractionMode,
      model: this.buildModel(mergedState),
      stateToPersist: mergedState,
    };
  }

  private mergeDraftState(existing: DraftState | undefined, patch: DraftExtraction): DraftState {
    const mergedType = patch.inferredType && patch.inferredType !== 'unknown'
      ? patch.inferredType
      : (existing?.inferredType || 'unknown');
    const mergedLength = patch.lengthM ?? existing?.lengthM;
    const mergedSpan = patch.spanLengthM ?? existing?.spanLengthM;
    const spanLengthM = mergedSpan ?? (
      (mergedType === 'portal-frame' || mergedType === 'double-span-beam')
        ? mergedLength
        : undefined
    );

    return {
      inferredType: mergedType,
      lengthM: mergedLength,
      spanLengthM,
      heightM: patch.heightM ?? existing?.heightM,
      loadKN: patch.loadKN ?? existing?.loadKN,
      updatedAt: Date.now(),
    };
  }

  private computeMissingFields(state: DraftState): string[] {
    const missing: string[] = [];
    if (state.inferredType === 'unknown') {
      missing.push('结构类型（门式刚架/双跨梁/梁/平面桁架）');
      return missing;
    }

    if (state.inferredType === 'portal-frame') {
      if (state.spanLengthM === undefined) {
        missing.push('门式刚架跨度（m）');
      }
      if (state.heightM === undefined) {
        missing.push('门式刚架柱高（m）');
      }
      if (state.loadKN === undefined) {
        missing.push('荷载大小（kN）');
      }
      return missing;
    }

    if (state.inferredType === 'double-span-beam') {
      if (state.spanLengthM === undefined) {
        missing.push('每跨跨度（m）');
      }
      if (state.loadKN === undefined) {
        missing.push('荷载大小（kN）');
      }
      return missing;
    }

    if (state.lengthM === undefined) {
      missing.push('跨度/长度（m）');
    }
    if (state.loadKN === undefined) {
      missing.push('荷载大小（kN）');
    }
    return missing;
  }

  private buildModel(state: DraftState): Record<string, unknown> {
    const metadata = {
      source: 'text-draft-hybrid',
      inferredType: state.inferredType,
    };

    if (state.inferredType === 'truss') {
      const length = state.lengthM!;
      const load = state.loadKN!;
      return {
        schema_version: '1.0.0',
        unit_system: 'SI',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
          { id: '2', x: length, y: 0, z: 0, restraints: [false, true, true, true, true, true] },
        ],
        elements: [
          { id: '1', type: 'truss', nodes: ['1', '2'], material: '1', section: '1' },
        ],
        materials: [
          { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
        ],
        sections: [
          { id: '1', name: 'T1', type: 'rod', properties: { A: 0.01 } },
        ],
        load_cases: [
          { id: 'LC1', type: 'other', loads: [{ node: '2', fx: load }] },
        ],
        load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
        metadata,
      };
    }

    if (state.inferredType === 'double-span-beam') {
      const span = state.spanLengthM!;
      const load = state.loadKN!;
      return {
        schema_version: '1.0.0',
        unit_system: 'SI',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
          { id: '2', x: span, y: 0, z: 0 },
          { id: '3', x: span * 2, y: 0, z: 0, restraints: [false, true, true, true, true, true] },
        ],
        elements: [
          { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
          { id: '2', type: 'beam', nodes: ['2', '3'], material: '1', section: '1' },
        ],
        materials: [
          { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
        ],
        sections: [
          { id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } },
        ],
        load_cases: [
          { id: 'LC1', type: 'other', loads: [{ node: '2', fy: -load }] },
        ],
        load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
        metadata,
      };
    }

    if (state.inferredType === 'portal-frame') {
      const span = state.spanLengthM!;
      const height = state.heightM!;
      const load = state.loadKN!;
      return {
        schema_version: '1.0.0',
        unit_system: 'SI',
        nodes: [
          { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
          { id: '2', x: span, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
          { id: '3', x: 0, y: height, z: 0 },
          { id: '4', x: span, y: height, z: 0 },
        ],
        elements: [
          { id: '1', type: 'beam', nodes: ['1', '3'], material: '1', section: '1' },
          { id: '2', type: 'beam', nodes: ['3', '4'], material: '1', section: '1' },
          { id: '3', type: 'beam', nodes: ['4', '2'], material: '1', section: '1' },
        ],
        materials: [
          { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
        ],
        sections: [
          { id: '1', name: 'PF1', type: 'beam', properties: { A: 0.02, Iy: 0.0002 } },
        ],
        load_cases: [
          { id: 'LC1', type: 'other', loads: [{ node: '3', fy: -load / 2 }, { node: '4', fy: -load / 2 }] },
        ],
        load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
        metadata,
      };
    }

    const length = state.lengthM!;
    const load = state.loadKN!;
    return {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: [true, true, true, true, true, true] },
        { id: '2', x: length, y: 0, z: 0 },
      ],
      elements: [
        { id: '1', type: 'beam', nodes: ['1', '2'], material: '1', section: '1' },
      ],
      materials: [
        { id: '1', name: 'steel', E: 205000, nu: 0.3, rho: 7850 },
      ],
      sections: [
        { id: '1', name: 'B1', type: 'beam', properties: { A: 0.01, Iy: 0.0001 } },
      ],
      load_cases: [
        { id: 'LC1', type: 'other', loads: [{ node: '2', fy: -load }] },
      ],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
      metadata,
    };
  }

  private async tryLlmExtract(message: string, existingState?: DraftState): Promise<DraftExtraction | null> {
    if (!this.llm) {
      return null;
    }

    const prior = existingState
      ? JSON.stringify({
          inferredType: existingState.inferredType,
          lengthM: existingState.lengthM,
          spanLengthM: existingState.spanLengthM,
          heightM: existingState.heightM,
          loadKN: existingState.loadKN,
        })
      : '{}';

    const prompt = [
      '你是结构建模参数提取器。',
      '从用户输入里提取结构草模参数，仅返回 JSON，不要 markdown。',
      '可选 inferredType: beam | truss | portal-frame | double-span-beam | unknown。',
      '数值统一单位：m, kN。不存在的字段不要输出。',
      `已有参数：${prior}`,
      `用户输入：${message}`,
      '输出示例：{"inferredType":"portal-frame","spanLengthM":6,"heightM":4,"loadKN":20}',
    ].join('\n');

    try {
      const aiMessage = await this.llm.invoke(prompt);
      const content = typeof aiMessage.content === 'string'
        ? aiMessage.content
        : JSON.stringify(aiMessage.content);
      const parsed = this.parseJsonObject(content);
      if (!parsed) {
        return null;
      }

      return {
        inferredType: this.normalizeInferredType(parsed.inferredType),
        lengthM: this.normalizeNumber(parsed.lengthM),
        spanLengthM: this.normalizeNumber(parsed.spanLengthM),
        heightM: this.normalizeNumber(parsed.heightM),
        loadKN: this.normalizeNumber(parsed.loadKN),
      };
    } catch {
      return null;
    }
  }

  private extractDraftByRules(message: string): DraftExtraction {
    const text = message.toLowerCase();

    const inferredType = this.inferDraftType(text);
    const spanLengthM = this.extractNumber(text, [
      /每跨\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
      /双跨[^\d]*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    ]);
    const lengthM = this.extractNumber(text, [
      /(跨度|跨长|长度|长)\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
      /(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    ], [2, 1]);
    const heightM = this.extractNumber(text, [
      /(柱高|高度|高)\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
    ], [2]);
    const loadKN = this.extractNumber(text, [
      /(\d+(?:\.\d+)?)\s*(?:kn|千牛)(?!\s*\/\s*m)/i,
    ]);

    return {
      inferredType,
      lengthM: lengthM ?? undefined,
      spanLengthM: spanLengthM ?? undefined,
      heightM: heightM ?? undefined,
      loadKN: loadKN ?? undefined,
    };
  }

  private inferDraftType(text: string): InferredModelType {
    if (text.includes('门式刚架') || text.includes('portal frame')) {
      return 'portal-frame';
    }
    if (text.includes('双跨梁') || text.includes('double-span')) {
      return 'double-span-beam';
    }
    if (text.includes('桁架') || text.includes('truss')) {
      return 'truss';
    }
    if (text.includes('梁') || text.includes('beam') || text.includes('悬臂')) {
      return 'beam';
    }
    return 'unknown';
  }

  private normalizeInferredType(value: unknown): InferredModelType | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    if (value === 'beam' || value === 'truss' || value === 'portal-frame' || value === 'double-span-beam' || value === 'unknown') {
      return value;
    }
    return undefined;
  }

  private normalizeNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private parseJsonObject(content: string): Record<string, unknown> | null {
    const trimmed = content.trim();
    const direct = this.tryParseJson(trimmed);
    if (direct) {
      return direct;
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      return this.tryParseJson(fenced[1]);
    }

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return this.tryParseJson(trimmed.slice(first, last + 1));
    }
    return null;
  }

  private tryParseJson(content: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  private extractNumber(text: string, patterns: RegExp[], groupPriority: number[] = [1]): number | null {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) {
        continue;
      }
      for (const groupIndex of groupPriority) {
        const valueText = match[groupIndex];
        if (!valueText) {
          continue;
        }
        const value = Number.parseFloat(valueText);
        if (Number.isFinite(value)) {
          return value;
        }
      }
    }
    return null;
  }

  private startToolCall(tool: AgentToolName, input: Record<string, unknown>): AgentToolCall {
    return {
      tool,
      input,
      status: 'success',
      startedAt: new Date().toISOString(),
    };
  }

  private completeToolCallSuccess(call: AgentToolCall, output: unknown): void {
    call.status = 'success';
    call.output = output;
    call.completedAt = new Date().toISOString();
    call.durationMs = this.computeDurationMs(call.startedAt, call.completedAt);
  }

  private completeToolCallError(call: AgentToolCall, error: unknown): void {
    call.status = 'error';
    call.error = this.stringifyError(error);
    call.errorCode = this.extractErrorCode(error);
    call.completedAt = new Date().toISOString();
    call.durationMs = this.computeDurationMs(call.startedAt, call.completedAt);
  }

  private computeDurationMs(startedAt: string, completedAt: string): number {
    const start = Date.parse(startedAt);
    const end = Date.parse(completedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return 0;
    }
    return Math.max(0, end - start);
  }

  private stringifyError(error: unknown): string {
    const unknownError = error as any;
    if (unknownError?.response?.data) {
      return JSON.stringify(unknownError.response.data);
    }
    if (unknownError?.message) {
      return String(unknownError.message);
    }
    return 'Unknown error';
  }

  private extractErrorCode(error: unknown): string | undefined {
    const payload = (error as any)?.response?.data;
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const code = (payload.errorCode || payload.error_code) as unknown;
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }
    return undefined;
  }

  private buildClarificationQuestion(missingFields: string[]): string {
    return `请继续补充以下信息：${missingFields.join('、')}。我会沿用你前一轮已提供的参数继续建模。`;
  }

  private buildMetrics(toolCalls: AgentToolCall[]): NonNullable<AgentRunResult['metrics']> {
    const durations = toolCalls
      .map((call) => call.durationMs || 0)
      .filter((duration) => Number.isFinite(duration) && duration >= 0);
    const totalToolDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
    const maxToolDurationMs = durations.length > 0 ? Math.max(...durations) : 0;
    const toolDurationMsByName: Record<string, number> = {};
    for (const call of toolCalls) {
      const duration = call.durationMs || 0;
      toolDurationMsByName[call.tool] = (toolDurationMsByName[call.tool] || 0) + duration;
    }

    return {
      toolCount: toolCalls.length,
      failedToolCount: toolCalls.filter((call) => call.status === 'error').length,
      totalToolDurationMs,
      averageToolDurationMs: durations.length > 0 ? totalToolDurationMs / durations.length : 0,
      maxToolDurationMs,
      toolDurationMsByName,
    };
  }

  private buildInteractionSessionKey(conversationId: string): string {
    return `agent:interaction-session:${conversationId}`;
  }

  private buildLegacyDraftStateKey(conversationId: string): string {
    return `agent:draft-state:${conversationId}`;
  }

  private async getInteractionSession(conversationId: string | undefined): Promise<InteractionSession | undefined> {
    if (!conversationId) {
      return undefined;
    }

    try {
      const raw = await redis.get(this.buildInteractionSessionKey(conversationId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.draft) {
          return parsed as InteractionSession;
        }
      }

      const legacyRaw = await redis.get(this.buildLegacyDraftStateKey(conversationId));
      if (!legacyRaw) {
        return undefined;
      }
      const legacyParsed = JSON.parse(legacyRaw);
      if (!legacyParsed || typeof legacyParsed !== 'object') {
        return undefined;
      }
      return {
        draft: legacyParsed as DraftState,
        resolved: {},
        updatedAt: Date.now(),
      };
    } catch {
      return undefined;
    }
  }

  private async setInteractionSession(conversationId: string, session: InteractionSession): Promise<void> {
    try {
      await redis.setex(
        this.buildInteractionSessionKey(conversationId),
        AgentService.draftStateTtlSeconds,
        JSON.stringify(session),
      );
    } catch {
      // Keep non-blocking behavior for session persistence.
    }
  }

  private async clearInteractionSession(conversationId: string): Promise<void> {
    try {
      await redis.del(this.buildInteractionSessionKey(conversationId));
      await redis.del(this.buildLegacyDraftStateKey(conversationId));
    } catch {
      // Keep non-blocking behavior for session cleanup.
    }
  }

  private logRunResult(traceId: string, conversationId: string | undefined, result: AgentRunResult): void {
    logger.info({
      traceId,
      conversationId,
      success: result.success,
      mode: result.mode,
      durationMs: result.durationMs,
      metrics: result.metrics,
      toolCalls: result.toolCalls.map((call) => ({
        tool: call.tool,
        status: call.status,
        durationMs: call.durationMs,
        errorCode: call.errorCode,
      })),
    }, 'agent run completed');
  }
}
