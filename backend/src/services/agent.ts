import axios, { AxiosInstance } from 'axios';
import { ChatOpenAI } from '@langchain/openai';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { createChatModel } from '../utils/llm.js';
import { logger } from '../utils/logger.js';
import { redis } from '../utils/redis.js';
import { type AppLocale } from './locale.js';
import {
  AgentSkillRuntime,
  type DraftExtraction,
  type DraftLoadPosition,
  type DraftLoadType,
  type DraftResult,
  type DraftState,
  type DraftSupportType,
  type InferredModelType,
  type ScenarioMatch,
  type ScenarioTemplateKey,
} from './agent-skills/index.js';

export type AgentToolName = 'text-to-model-draft' | 'convert' | 'validate' | 'analyze' | 'code-check' | 'report';
export type AgentRunMode = 'chat' | 'execute' | 'auto';
export type AgentReportFormat = 'json' | 'markdown' | 'both';
export type AgentReportOutput = 'inline' | 'file';
export type AgentUserDecision = 'provide_values' | 'confirm_all' | 'allow_auto_decide' | 'revise';
export type AgentInteractionState = 'collecting' | 'confirming' | 'ready' | 'executing' | 'completed' | 'blocked';
export type AgentInteractionStage = 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';

interface InteractionSession {
  draft: DraftState;
  scenario?: ScenarioMatch;
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
  detectedScenario?: string;
  detectedScenarioLabel?: string;
  conversationStage?: string;
  missingCritical?: string[];
  missingOptional?: string[];
  fallbackSupportNote?: string;
  recommendedNextStep?: string;
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
    locale?: AppLocale;
    skillIds?: string[];
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
  private readonly skillRuntime: AgentSkillRuntime;
  private static readonly draftStateTtlSeconds = 30 * 60;

  constructor() {
    this.engineClient = axios.create({
      baseURL: config.analysisEngineUrl,
      timeout: 300000,
    });

    this.llm = createChatModel(0.1);
    this.skillRuntime = new AgentSkillRuntime(this.llm);
  }

  private isZh(locale: AppLocale): boolean {
    return locale === 'zh';
  }

  private localize(locale: AppLocale, zh: string, en: string): string {
    return this.isZh(locale) ? zh : en;
  }

  private resolveInteractionLocale(locale: AppLocale | undefined): AppLocale {
    return locale === 'en' ? 'en' : 'zh';
  }

  private getStageLabel(stage: AgentInteractionStage, locale: AppLocale): string {
    switch (stage) {
      case 'intent':
        return this.localize(locale, '需求识别', 'Intent');
      case 'model':
        return this.localize(locale, '几何建模', 'Geometry');
      case 'loads':
        return this.localize(locale, '荷载条件', 'Loads');
      case 'analysis':
        return this.localize(locale, '分析设置', 'Analysis');
      case 'code_check':
        return this.localize(locale, '规范校核', 'Code Check');
      case 'report':
        return this.localize(locale, '报告输出', 'Report');
    }
  }

  private getScenarioLabel(key: ScenarioTemplateKey, locale: AppLocale): string {
    return this.skillRuntime.getScenarioLabel(key, locale);
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

  listSkills() {
    return this.skillRuntime.listSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      structureType: skill.structureType,
      stages: skill.stages,
      triggers: skill.triggers,
      autoLoadByDefault: skill.autoLoadByDefault,
    }));
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
              skillIds: { type: 'array', items: { type: 'string' } },
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
              detectedScenario: { type: 'string' },
              detectedScenarioLabel: { type: 'string' },
              conversationStage: { type: 'string' },
              missingCritical: { type: 'array', items: { type: 'string' } },
              missingOptional: { type: 'array', items: { type: 'string' } },
              fallbackSupportNote: { type: 'string' },
              recommendedNextStep: { type: 'string' },
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
    const locale = this.resolveInteractionLocale(params.context?.locale);
    const runMode: AgentRunMode = params.mode || 'auto';
    const modelInput = params.context?.model;
    const sourceFormat = params.context?.modelFormat || 'structuremodel-v1';
    const autoAnalyze = params.context?.autoAnalyze ?? true;
    const analysisParameters = params.context?.parameters || {};
    const userDecision = params.context?.userDecision;
    const providedValues = params.context?.providedValues || {};
    const skillIds = params.context?.skillIds;

    const plan: string[] = [];
    const toolCalls: AgentToolCall[] = [];
    const mode: 'rule-based' | 'llm-assisted' = this.llm ? 'llm-assisted' : 'rule-based';

    const sessionKey = params.conversationId?.trim();
    const session = await this.getInteractionSession(sessionKey);
    const workingSession: InteractionSession = session || {
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

    const scenario = this.detectScenario(params.message, locale, workingSession.draft.inferredType, skillIds);
    this.applyScenarioMatch(workingSession, scenario);

    if (runMode === 'chat') {
      return this.handleChatMode({
        params,
        traceId,
        startedAt,
        startedAtMs,
        locale,
        mode,
        toolCalls,
        plan,
        sessionKey,
        workingSession,
      });
    }

    let normalizedModel = modelInput;
    if (!normalizedModel) {
      plan.push(this.localize(locale, '从自然语言生成结构模型草案（支持会话级补数）', 'Generate a structural model draft from natural language with session carry-over'));
      const draftCall = this.startToolCall('text-to-model-draft', { message: params.message, conversationId: sessionKey });
      toolCalls.push(draftCall);

      const draft = await this.textToModelDraft(params.message, workingSession.draft, locale, skillIds);
      if (draft.stateToPersist) {
        workingSession.draft = this.mergePersistedDraftState(workingSession.draft, draft.stateToPersist);
      }
      this.enforceScenarioSupportBoundary(workingSession);
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
          const assessment = this.assessInteractionNeeds(workingSession, locale);
          if (assessment.nonCriticalMissing.length === 0) {
            break;
          }
          this.applyNonCriticalDefaults(workingSession, assessment.defaultProposals);
        }
      }

      const finalAssessment = this.assessInteractionNeeds(workingSession, locale);
      if (finalAssessment.criticalMissing.length > 0 || finalAssessment.nonCriticalMissing.length > 0 || !draft.model) {
        if (sessionKey) {
          await this.setInteractionSession(sessionKey, workingSession);
        }

        const interaction = this.buildInteractionPayload(
          finalAssessment,
          workingSession,
          finalAssessment.criticalMissing.length > 0 ? 'confirming' : 'collecting',
          locale,
        );
        const missingFields = this.mapMissingFieldLabels(finalAssessment.criticalMissing, locale);
        const question = this.buildInteractionQuestion(interaction, locale);
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
      plan.push(this.localize(locale, `将输入模型从 ${sourceFormat} 转为 structuremodel-v1`, `Convert the input model from ${sourceFormat} to structuremodel-v1`));
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
            response: this.localize(locale, `模型格式转换失败：${convertCall.error}`, `Model conversion failed: ${convertCall.error}`),
          };
        this.logRunResult(traceId, sessionKey, result);
        return result;
      }
    }

    let validationWarning: string | undefined;

    plan.push(this.localize(locale, '校验模型字段与引用完整性', 'Validate model fields and references'));
    const validateInput = { model: normalizedModel };
    const validateCall = this.startToolCall('validate', validateInput);
    toolCalls.push(validateCall);

    try {
      const validated = await this.engineClient.post('/validate', validateInput);
      this.completeToolCallSuccess(validateCall, validated.data);
      if (validated.data?.valid === false) {
        validateCall.status = 'error';
        validateCall.errorCode = validated.data?.errorCode || 'INVALID_STRUCTURE_MODEL';
        validateCall.error = validated.data?.message || this.localize(locale, '模型校验失败', 'Model validation failed');
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
          response: this.localize(locale, `模型校验失败：${validateCall.error}`, `Model validation failed: ${validateCall.error}`),
        };
        this.logRunResult(traceId, sessionKey, result);
        return result;
      }
    } catch (error: any) {
      this.completeToolCallError(validateCall, error);
      if (autoAnalyze && this.shouldBypassValidateFailure(error)) {
        validationWarning = this.localize(
          locale,
          `模型校验服务暂时不可用，已跳过校验并继续分析：${validateCall.error}`,
          `The model validation service is temporarily unavailable. Validation was skipped and analysis will continue: ${validateCall.error}`,
        );
        plan.push(this.localize(locale, '校验服务不可用，跳过校验并继续分析', 'Validation service unavailable; skip validation and continue to analysis'));
        logger.warn({ traceId, validationError: validateCall.error }, 'Validate call failed with upstream error; continuing to analyze');
      } else {
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
          response: this.localize(locale, `模型校验失败：${validateCall.error}`, `Model validation failed: ${validateCall.error}`),
        };
        this.logRunResult(traceId, sessionKey, result);
        return result;
      }
    }

    if (!autoAnalyze) {
      const response = await this.renderSummary(
        params.message,
        this.localize(locale, '模型已通过校验。根据配置未自动执行 analyze。', 'The model passed validation. Analyze was not executed automatically under the current configuration.'),
        locale,
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

    plan.push(this.localize(locale, `执行 ${resolvedAnalysisType} 分析并返回摘要`, `Run ${resolvedAnalysisType} analysis and return a summary`));
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
        plan.push(this.localize(locale, `执行 ${resolvedDesignCode} 规范校核`, `Run ${resolvedDesignCode} code checks`));
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
            response: this.localize(locale, `规范校核失败：${codeCheckCall.error}`, `Code check failed: ${codeCheckCall.error}`),
          };
          this.logRunResult(traceId, sessionKey, result);
          return result;
        }
      }

      let report: AgentRunResult['report'];
      let artifacts: AgentRunResult['artifacts'];
      if (analysisSuccess && resolvedIncludeReport) {
        plan.push(this.localize(locale, '生成可读计算与校核报告', 'Generate a readable analysis and code-check report'));
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
          locale,
        });
        if (report && resolvedReportOutput === 'file') {
          artifacts = await this.persistReportArtifacts(traceId, report, resolvedReportFormat);
        }
        this.completeToolCallSuccess(reportCall, report);
      }

      const response = await this.renderSummary(
        params.message,
        this.localize(
          locale,
          `分析完成。analysis_type=${resolvedAnalysisType}, success=${String(analyzed.data?.success ?? false)}`
            + (resolvedAutoCodeCheck ? `, code_check=${String(Boolean(codeCheckResult))}` : '')
            + (validationWarning ? `, validation_warning=true` : ''),
          `Analysis finished. analysis_type=${resolvedAnalysisType}, success=${String(analyzed.data?.success ?? false)}`
            + (resolvedAutoCodeCheck ? `, code_check=${String(Boolean(codeCheckResult))}` : '')
            + (validationWarning ? `, validation_warning=true` : '')
        ),
        locale,
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
        response: validationWarning ? `${validationWarning}\n\n${response}` : response,
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
        response: this.localize(locale, `分析执行失败：${analyzeCall.error}`, `Analysis execution failed: ${analyzeCall.error}`),
      };
      this.logRunResult(traceId, sessionKey, result);
      return result;
    }
  }

  private detectScenario(message: string, locale: AppLocale, currentType?: InferredModelType, skillIds?: string[]): ScenarioMatch {
    return this.skillRuntime.detectScenario(message, locale, currentType, skillIds);
  }

  private applyScenarioMatch(session: InteractionSession, scenario: ScenarioMatch): void {
    session.scenario = scenario;
    if (session.draft.inferredType === 'unknown' && scenario.mappedType !== 'unknown') {
      session.draft.inferredType = scenario.mappedType;
    }
    session.updatedAt = Date.now();
  }

  private enforceScenarioSupportBoundary(session: InteractionSession): void {
    if (session.scenario?.supportLevel === 'unsupported' && session.scenario.mappedType === 'unknown') {
      session.draft.inferredType = 'unknown';
    }
  }

  private buildRecommendedNextStep(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] },
    interaction: AgentInteraction,
    locale: AppLocale,
  ): string {
    if (assessment.criticalMissing.length > 0) {
      const nextLabel = interaction.questions?.[0]?.label || this.localize(locale, '关键参数', 'the key parameter');
      return this.localize(locale, `先补齐 ${nextLabel}。`, `Fill in ${nextLabel} first.`);
    }
    if (assessment.nonCriticalMissing.length > 0) {
      return this.localize(
        locale,
        '关键参数已基本齐备，继续确认分析类型、规范和报告偏好。',
        'Core geometry and loading are mostly ready; continue by confirming analysis, code-check, and report preferences.'
      );
    }
    return this.localize(
      locale,
      '当前参数已足够进入执行阶段，可以点击“执行分析”或继续微调参数。',
      'The current parameters are sufficient to proceed. You can click “Run Analysis” or keep refining the inputs.'
    );
  }

  private buildChatModeResponse(interaction: AgentInteraction, locale: AppLocale): string {
    const lines: string[] = [];
    if (interaction.detectedScenarioLabel) {
      lines.push(this.localize(locale, `识别场景：${interaction.detectedScenarioLabel}`, `Detected scenario: ${interaction.detectedScenarioLabel}`));
    }
    if (interaction.conversationStage) {
      lines.push(this.localize(locale, `当前阶段：${interaction.conversationStage}`, `Current stage: ${interaction.conversationStage}`));
    }
    if (interaction.fallbackSupportNote) {
      lines.push(interaction.fallbackSupportNote);
    }
    if (interaction.missingCritical?.length) {
      lines.push(this.localize(
        locale,
        `待补关键参数：${interaction.missingCritical.join('、')}`,
        `Critical parameters still needed: ${interaction.missingCritical.join(', ')}`
      ));
    }
    if (interaction.missingOptional?.length) {
      lines.push(this.localize(
        locale,
        `后续建议确认：${interaction.missingOptional.join('、')}`,
        `Recommended to confirm next: ${interaction.missingOptional.join(', ')}`
      ));
    }
    if (interaction.recommendedNextStep) {
      lines.push(this.localize(locale, `下一步：${interaction.recommendedNextStep}`, `Next step: ${interaction.recommendedNextStep}`));
    }
    if (interaction.questions?.length) {
      lines.push(this.localize(locale, `优先问题：${interaction.questions[0]?.question}`, `Priority question: ${interaction.questions[0]?.question}`));
    }
    return lines.join('\n');
  }

  private async handleChatMode(args: {
    params: AgentRunParams;
    traceId: string;
    startedAt: string;
    startedAtMs: number;
    locale: AppLocale;
    mode: 'rule-based' | 'llm-assisted';
    toolCalls: AgentToolCall[];
    plan: string[];
    sessionKey?: string;
    workingSession: InteractionSession;
  }): Promise<AgentRunResult> {
    const { params, traceId, startedAt, startedAtMs, locale, mode, toolCalls, plan, sessionKey, workingSession } = args;

    plan.push(this.localize(locale, '识别结构场景并匹配对话模板', 'Identify the structural scenario and select the matching dialogue template'));
    plan.push(this.localize(locale, '按当前阶段补齐关键工程参数', 'Collect the key engineering parameters for the current stage'));

    const draftCall = this.startToolCall('text-to-model-draft', { message: params.message, conversationId: sessionKey, mode: 'chat' });
    toolCalls.push(draftCall);

    const draft = await this.textToModelDraft(params.message, workingSession.draft, locale, params.context?.skillIds);
    if (draft.stateToPersist) {
      workingSession.draft = this.mergePersistedDraftState(workingSession.draft, draft.stateToPersist);
    }
    this.enforceScenarioSupportBoundary(workingSession);
    workingSession.updatedAt = Date.now();
    this.applyInferredNonCriticalFromMessage(workingSession, params.message);
    this.completeToolCallSuccess(draftCall, {
      inferredType: draft.inferredType,
      missingFields: draft.missingFields,
      extractionMode: draft.extractionMode,
      modelGenerated: Boolean(draft.model),
    });

    const assessment = this.assessInteractionNeeds(workingSession, locale, 'chat');
    const state: AgentInteractionState = assessment.criticalMissing.length > 0
      ? 'confirming'
      : assessment.nonCriticalMissing.length > 0
        ? 'collecting'
        : 'ready';
    const interaction = this.buildInteractionPayload(assessment, workingSession, state, locale);
    interaction.recommendedNextStep = this.buildRecommendedNextStep(assessment, interaction, locale);

    if (sessionKey) {
      await this.setInteractionSession(sessionKey, workingSession);
    }

    const response = this.buildChatModeResponse(interaction, locale);
    const result: AgentRunResult = {
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      success: true,
      mode,
      needsModelInput: assessment.criticalMissing.length > 0,
      plan,
      toolCalls,
      metrics: this.buildMetrics(toolCalls),
      interaction,
      clarification: interaction.questions?.length
        ? {
            missingFields: interaction.missingCritical || [],
            question: interaction.questions[0]?.question || response,
          }
        : undefined,
      response,
    };
    this.logRunResult(traceId, sessionKey, result);
    return result;
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

  private assessInteractionNeeds(session: InteractionSession, locale: AppLocale, mode: AgentRunMode = 'execute'): {
    criticalMissing: string[];
    nonCriticalMissing: string[];
    defaultProposals: InteractionDefaultProposal[];
  } {
    const criticalMissing = this.computeMissingCriticalKeys(session.draft);
    if (mode === 'chat') {
      criticalMissing.push(...this.computeMissingLoadDetailKeys(session.draft));
    }
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
      defaultProposals: this.buildDefaultProposals(nonCriticalMissing, locale),
    };
  }

  private buildDefaultProposals(nonCriticalMissing: string[], locale: AppLocale): InteractionDefaultProposal[] {
    return nonCriticalMissing.map((key) => {
      switch (key) {
        case 'analysisType':
          return { paramKey: key, value: 'static', reason: this.localize(locale, '默认采用静力分析，属于最保守且最常用起步工况。', 'Default to static analysis as the most conservative and common starting case.') };
        case 'autoCodeCheck':
          return { paramKey: key, value: true, reason: this.localize(locale, '默认开启规范校核以保证验算完整性。', 'Enable code checks by default to keep the verification flow complete.') };
        case 'designCode':
          return { paramKey: key, value: 'GB50017', reason: this.localize(locale, '默认采用钢结构设计标准 GB50017 进行保守校核。', 'Use GB50017 by default for a conservative steel-design check.') };
        case 'includeReport':
          return { paramKey: key, value: true, reason: this.localize(locale, '默认生成报告，便于复核输入与结果。', 'Generate a report by default so inputs and results can be reviewed.') };
        case 'reportFormat':
          return { paramKey: key, value: 'both', reason: this.localize(locale, '默认同时输出 json/markdown，兼顾机器和人工阅读。', 'Return both JSON and Markdown by default for machine and human consumption.') };
        case 'reportOutput':
          return { paramKey: key, value: 'inline', reason: this.localize(locale, '默认内联返回，减少文件写入依赖。', 'Return results inline by default to avoid file-output dependencies.') };
        default:
          return { paramKey: key, value: null, reason: this.localize(locale, '默认保守值。', 'Apply a conservative default.') };
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
      supportType: this.normalizeSupportType(values.supportType),
      loadKN: this.normalizeNumber(values.loadKN),
      loadType: this.normalizeLoadType(values.loadType),
      loadPosition: this.normalizeLoadPosition(values.loadPosition),
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

  private normalizeLoadType(value: unknown): DraftLoadType | undefined {
    if (value === 'point' || value === 'distributed') {
      return value;
    }
    return undefined;
  }

  private normalizeSupportType(value: unknown): DraftSupportType | undefined {
    if (value === 'cantilever' || value === 'simply-supported' || value === 'fixed-fixed' || value === 'fixed-pinned') {
      return value;
    }
    return undefined;
  }

  private normalizeLoadPosition(value: unknown): DraftLoadPosition | undefined {
    if (
      value === 'end'
      || value === 'midspan'
      || value === 'full-span'
      || value === 'top-nodes'
      || value === 'middle-joint'
      || value === 'free-joint'
    ) {
      return value;
    }
    return undefined;
  }

  private computeMissingCriticalKeys(state: DraftState): string[] {
    return this.skillRuntime.computeMissingCriticalKeys(state);
  }

  private computeMissingLoadDetailKeys(state: DraftState): string[] {
    return this.skillRuntime.computeMissingLoadDetailKeys(state);
  }

  private mapMissingFieldLabels(missing: string[], locale: AppLocale): string[] {
    const structuralKeys = missing.filter((key) => ['inferredType', 'lengthM', 'spanLengthM', 'heightM', 'supportType', 'loadKN', 'loadType', 'loadPosition'].includes(key));
    const structuralLabels = new Map(
      structuralKeys.map((key) => [key, this.skillRuntime.mapMissingFieldLabels([key], locale)[0] || key])
    );
    return missing.map((key) => {
      if (structuralLabels.has(key)) {
        return structuralLabels.get(key)!;
      }
      switch (key) {
        case 'analysisType':
          return this.localize(locale, '分析类型（static/dynamic/seismic/nonlinear）', 'Analysis type (static/dynamic/seismic/nonlinear)');
        case 'designCode':
          return this.localize(locale, '规范编号（如 GB50017）', 'Design code (for example GB50017)');
        case 'autoCodeCheck':
          return this.localize(locale, '是否自动规范校核', 'Whether to run code checks automatically');
        case 'includeReport':
          return this.localize(locale, '是否生成报告', 'Whether to generate a report');
        case 'reportFormat':
          return this.localize(locale, '报告格式（json/markdown/both）', 'Report format (json/markdown/both)');
        case 'reportOutput':
          return this.localize(locale, '报告输出位置（inline/file）', 'Report output location (inline/file)');
        default:
          return key;
      }
    });
  }

  private buildInteractionPayload(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] },
    session: InteractionSession,
    state: AgentInteractionState,
    locale: AppLocale,
  ): AgentInteraction {
    const missingKeys = [...assessment.criticalMissing, ...assessment.nonCriticalMissing];
    const questions = this.buildInteractionQuestions(missingKeys, assessment.criticalMissing, session, locale);
    const stage = this.resolveInteractionStage(missingKeys);
    const missingCritical = this.mapMissingFieldLabels(assessment.criticalMissing, locale);
    const missingOptional = this.mapMissingFieldLabels(assessment.nonCriticalMissing, locale);
    return {
      state,
      stage,
      turnId: randomUUID(),
      detectedScenario: session.scenario?.key,
      detectedScenarioLabel: session.scenario ? this.getScenarioLabel(session.scenario.key, locale) : undefined,
      conversationStage: this.getStageLabel(stage, locale),
      missingCritical,
      missingOptional,
      fallbackSupportNote: session.scenario?.supportNote,
      questions,
      pending: {
        criticalMissing: missingCritical,
        nonCriticalMissing: missingOptional,
      },
      proposedDefaults: assessment.defaultProposals,
      nextActions: assessment.criticalMissing.length > 0
        ? ['provide_values', 'revise']
        : ['provide_values', 'allow_auto_decide', 'confirm_all', 'revise'],
    };
  }

  private buildInteractionQuestions(
    missingKeys: string[],
    criticalMissing: string[],
    session: InteractionSession,
    locale: AppLocale,
  ): InteractionQuestion[] {
    const structuralKeys = missingKeys.filter((key) => ['inferredType', 'lengthM', 'spanLengthM', 'heightM', 'supportType', 'loadKN', 'loadType', 'loadPosition'].includes(key));
    const structuralQuestions = new Map(
      this.skillRuntime.buildInteractionQuestions(structuralKeys, criticalMissing, session.draft, locale).map((question) => [question.paramKey, question])
    );
    return missingKeys.map((paramKey) => {
      const critical = criticalMissing.includes(paramKey);
      const structuralQuestion = structuralQuestions.get(paramKey);
      if (structuralQuestion) {
        return structuralQuestion;
      }
      switch (paramKey) {
        case 'analysisType':
          return { paramKey, label: this.localize(locale, '分析类型', 'Analysis type'), question: this.localize(locale, '请选择分析类型。', 'Please choose the analysis type.'), required: true, critical, suggestedValue: 'static' };
        case 'autoCodeCheck':
          return { paramKey, label: this.localize(locale, '自动校核', 'Auto code check'), question: this.localize(locale, '是否自动执行规范校核？', 'Should code checks run automatically?'), required: true, critical, suggestedValue: true };
        case 'designCode':
          return { paramKey, label: this.localize(locale, '规范编号', 'Design code'), question: this.localize(locale, '请确认规范编号（例如 GB50017）。', 'Please confirm the design code (for example GB50017).'), required: true, critical, suggestedValue: 'GB50017' };
        case 'includeReport':
          return { paramKey, label: this.localize(locale, '报告开关', 'Report toggle'), question: this.localize(locale, '是否生成计算与校核报告？', 'Should an analysis and code-check report be generated?'), required: true, critical, suggestedValue: true };
        case 'reportFormat':
          return { paramKey, label: this.localize(locale, '报告格式', 'Report format'), question: this.localize(locale, '请确认报告格式。', 'Please confirm the report format.'), required: true, critical, suggestedValue: 'both' };
        case 'reportOutput':
          return { paramKey, label: this.localize(locale, '报告输出', 'Report output'), question: this.localize(locale, '请确认报告输出位置。', 'Please confirm where the report should be returned.'), required: true, critical, suggestedValue: 'inline' };
        default:
          return { paramKey, label: paramKey, question: this.localize(locale, `请确认参数 ${paramKey}。`, `Please confirm parameter ${paramKey}.`), required: true, critical };
      }
    });
  }

  private resolveInteractionStage(missingKeys: string[]): AgentInteractionStage {
    if (missingKeys.includes('inferredType')) {
      return 'intent';
    }
    if (missingKeys.some((key) => key === 'lengthM' || key === 'spanLengthM' || key === 'heightM' || key === 'supportType')) {
      return 'model';
    }
    if (missingKeys.includes('loadKN') || missingKeys.includes('loadType') || missingKeys.includes('loadPosition')) {
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

  private buildInteractionQuestion(interaction: AgentInteraction, locale: AppLocale): string {
    const questionSummary = interaction.questions?.map((item) => item.label).join(locale === 'zh' ? '、' : ', ')
      || this.localize(locale, '必要参数', 'required parameters');
    return this.localize(
      locale,
      `请先确认以下参数：${questionSummary}。若希望我按保守值自动决策，请回复“你决定”并触发 allow_auto_decide。`,
      `Please confirm the following parameters first: ${questionSummary}. If you want me to choose conservative defaults automatically, reply with "you decide" and trigger allow_auto_decide.`
    );
  }

  private buildLoadTypeQuestion(type: InferredModelType, locale: AppLocale): string {
    return this.skillRuntime.buildInteractionQuestions(['loadType'], ['loadType'], { inferredType: type, updatedAt: Date.now() }, locale)[0]?.question
      || this.localize(locale, '请确认荷载形式（点荷载或均布荷载）。', 'Please confirm the load type (point or distributed).');
  }

  private buildLoadPositionQuestion(type: InferredModelType, locale: AppLocale): string {
    return this.skillRuntime.buildInteractionQuestions(['loadPosition'], ['loadPosition'], { inferredType: type, updatedAt: Date.now() }, locale)[0]?.question
      || this.localize(locale, '请确认荷载位置。', 'Please confirm the load position.');
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
    locale: AppLocale;
  }): AgentRunResult['report'] {
    const analysisSuccess = Boolean((params.analysis as any)?.success);
    const codeCheckSummary = (params.codeCheck as any)?.summary;
    const codeCheckText = codeCheckSummary
      ? this.localize(params.locale, `校核通过 ${String(codeCheckSummary.passed ?? 0)} / ${String(codeCheckSummary.total ?? 0)}`, `Code checks passed ${String(codeCheckSummary.passed ?? 0)} / ${String(codeCheckSummary.total ?? 0)}`)
      : this.localize(params.locale, '未执行规范校核', 'No code checks were executed');
    const summary = this.localize(
      params.locale,
      `分析类型 ${params.analysisType}，分析${analysisSuccess ? '成功' : '失败'}，${codeCheckText}。`,
      `Analysis type ${params.analysisType}; analysis ${analysisSuccess ? 'succeeded' : 'failed'}; ${codeCheckText}.`
    );
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
      this.localize(params.locale, '# StructureClaw 计算报告', '# StructureClaw Calculation Report'),
      '',
      this.localize(params.locale, '## 目录', '## Contents'),
      this.localize(params.locale, '1. 执行摘要', '1. Executive Summary'),
      this.localize(params.locale, '2. 关键指标', '2. Key Metrics'),
      this.localize(params.locale, '3. 条文追溯', '3. Clause Traceability'),
      this.localize(params.locale, '4. 控制工况', '4. Governing Cases'),
      '',
      this.localize(params.locale, '## 执行摘要', '## Executive Summary'),
      this.localize(params.locale, `- 用户意图：${params.message}`, `- User intent: ${params.message}`),
      this.localize(params.locale, `- 分析类型：${params.analysisType}`, `- Analysis type: ${params.analysisType}`),
      this.localize(params.locale, `- 分析结果：${analysisSuccess ? '成功' : '失败'}`, `- Analysis result: ${analysisSuccess ? 'Success' : 'Failure'}`),
      this.localize(params.locale, `- 规范校核：${codeCheckText}`, `- Code checks: ${codeCheckText}`),
      '',
      summary,
      '',
      this.localize(params.locale, '## 关键指标', '## Key Metrics'),
      this.localize(params.locale, `- 最大位移: ${String((keyMetrics as Record<string, unknown>).maxAbsDisplacement ?? 'N/A')}`, `- Max displacement: ${String((keyMetrics as Record<string, unknown>).maxAbsDisplacement ?? 'N/A')}`),
      this.localize(params.locale, `- 最大轴力: ${String((keyMetrics as Record<string, unknown>).maxAbsAxialForce ?? 'N/A')}`, `- Max axial force: ${String((keyMetrics as Record<string, unknown>).maxAbsAxialForce ?? 'N/A')}`),
      this.localize(params.locale, `- 最大剪力: ${String((keyMetrics as Record<string, unknown>).maxAbsShearForce ?? 'N/A')}`, `- Max shear force: ${String((keyMetrics as Record<string, unknown>).maxAbsShearForce ?? 'N/A')}`),
      this.localize(params.locale, `- 最大弯矩: ${String((keyMetrics as Record<string, unknown>).maxAbsMoment ?? 'N/A')}`, `- Max moment: ${String((keyMetrics as Record<string, unknown>).maxAbsMoment ?? 'N/A')}`),
      this.localize(params.locale, `- 最大反力: ${String((keyMetrics as Record<string, unknown>).maxAbsReaction ?? 'N/A')}`, `- Max reaction: ${String((keyMetrics as Record<string, unknown>).maxAbsReaction ?? 'N/A')}`),
      this.localize(params.locale, `- 校核通过率: ${String((keyMetrics as Record<string, unknown>).codeCheckPassRate ?? 'N/A')}`, `- Code-check pass rate: ${String((keyMetrics as Record<string, unknown>).codeCheckPassRate ?? 'N/A')}`),
      '',
      this.localize(params.locale, '## 条文追溯', '## Clause Traceability'),
      ...this.renderClauseTraceabilityMarkdown(clauseTraceability, params.locale),
      '',
      this.localize(params.locale, '## 控制工况', '## Governing Cases'),
      ...this.renderControllingCasesMarkdown(controllingCases, params.locale),
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

  private renderClauseTraceabilityMarkdown(traceability: Array<Record<string, unknown>>, locale: AppLocale): string[] {
    if (traceability.length === 0) {
      return [this.localize(locale, '- 无条文追溯数据', '- No clause traceability data')];
    }
    return traceability.slice(0, 8).map((row) => {
      const elementId = row['elementId'] ?? 'unknown';
      const check = row['check'] ?? 'unknown';
      const clause = row['clause'] ?? '';
      const utilization = row['utilization'] ?? 'N/A';
      const status = row['status'] ?? 'unknown';
      return this.localize(
        locale,
        `- 构件 ${String(elementId)} / ${String(check)} / ${String(clause)} / 利用率 ${String(utilization)} / ${String(status)}`,
        `- Element ${String(elementId)} / ${String(check)} / ${String(clause)} / utilization ${String(utilization)} / ${String(status)}`
      );
    });
  }

  private renderControllingCasesMarkdown(controllingCases: Record<string, unknown>, locale: AppLocale): string[] {
    const batchControlCaseRaw = controllingCases['batchControlCase'];
    const batchControlCase = batchControlCaseRaw && typeof batchControlCaseRaw === 'object'
      ? batchControlCaseRaw as Record<string, unknown>
      : {};
    const lines = [
      this.localize(locale, `- 批量位移控制工况: ${String(batchControlCase['displacement'] ?? 'N/A')}`, `- Governing displacement case: ${String(batchControlCase['displacement'] ?? 'N/A')}`),
      this.localize(locale, `- 批量轴力控制工况: ${String(batchControlCase['axialForce'] ?? 'N/A')}`, `- Governing axial-force case: ${String(batchControlCase['axialForce'] ?? 'N/A')}`),
      this.localize(locale, `- 批量剪力控制工况: ${String(batchControlCase['shearForce'] ?? 'N/A')}`, `- Governing shear-force case: ${String(batchControlCase['shearForce'] ?? 'N/A')}`),
      this.localize(locale, `- 批量弯矩控制工况: ${String(batchControlCase['moment'] ?? 'N/A')}`, `- Governing moment case: ${String(batchControlCase['moment'] ?? 'N/A')}`),
      this.localize(locale, `- 批量反力控制工况: ${String(batchControlCase['reaction'] ?? 'N/A')}`, `- Governing reaction case: ${String(batchControlCase['reaction'] ?? 'N/A')}`),
      this.localize(locale, `- 位移控制节点: ${String(controllingCases['controlNodeDisplacement'] ?? 'N/A')}`, `- Control displacement node: ${String(controllingCases['controlNodeDisplacement'] ?? 'N/A')}`),
      this.localize(locale, `- 轴力控制单元: ${String(controllingCases['controlElementAxialForce'] ?? 'N/A')}`, `- Control axial-force element: ${String(controllingCases['controlElementAxialForce'] ?? 'N/A')}`),
      this.localize(locale, `- 剪力控制单元: ${String(controllingCases['controlElementShearForce'] ?? 'N/A')}`, `- Control shear-force element: ${String(controllingCases['controlElementShearForce'] ?? 'N/A')}`),
      this.localize(locale, `- 弯矩控制单元: ${String(controllingCases['controlElementMoment'] ?? 'N/A')}`, `- Control moment element: ${String(controllingCases['controlElementMoment'] ?? 'N/A')}`),
      this.localize(locale, `- 反力控制节点: ${String(controllingCases['controlNodeReaction'] ?? 'N/A')}`, `- Control reaction node: ${String(controllingCases['controlNodeReaction'] ?? 'N/A')}`),
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

  private async renderSummary(message: string, fallback: string, locale: AppLocale): Promise<string> {
    if (!this.llm) {
      return fallback;
    }

    try {
      const prompt = [
        this.localize(locale, '你是结构工程 Agent 的结果解释器。', 'You explain results produced by the structural engineering agent.'),
        this.localize(locale, '请用中文在 80 字以内给出结论，不要杜撰未出现的数据。', 'Respond in English within 80 words and do not invent data that was not provided.'),
        this.localize(locale, `用户意图：${message}`, `User intent: ${message}`),
        this.localize(locale, `系统结果：${fallback}`, `System result: ${fallback}`),
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

  private async textToModelDraft(message: string, existingState?: DraftState, locale: AppLocale = 'en', skillIds?: string[]): Promise<DraftResult> {
    return this.skillRuntime.textToModelDraft(message, existingState, locale, skillIds);
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
      supportType: patch.supportType ?? existing?.supportType,
      loadKN: patch.loadKN ?? existing?.loadKN,
      loadType: patch.loadType ?? existing?.loadType,
      loadPosition: patch.loadPosition ?? existing?.loadPosition,
      updatedAt: Date.now(),
    };
  }

  private mergePersistedDraftState(existing: DraftState | undefined, next: DraftState): DraftState {
    return this.mergeDraftState(existing, {
      inferredType: next.inferredType,
      lengthM: next.lengthM,
      spanLengthM: next.spanLengthM,
      heightM: next.heightM,
      supportType: next.supportType,
      loadKN: next.loadKN,
      loadType: next.loadType,
      loadPosition: next.loadPosition,
    });
  }

  private mergeDraftExtraction(
    preferred: DraftExtraction | null,
    fallback: DraftExtraction,
  ): DraftExtraction {
    return {
      inferredType: preferred?.inferredType && preferred.inferredType !== 'unknown'
        ? preferred.inferredType
        : fallback.inferredType,
      lengthM: preferred?.lengthM ?? fallback.lengthM,
      spanLengthM: preferred?.spanLengthM ?? fallback.spanLengthM,
      heightM: preferred?.heightM ?? fallback.heightM,
      supportType: preferred?.supportType ?? fallback.supportType,
      loadKN: preferred?.loadKN ?? fallback.loadKN,
      loadType: preferred?.loadType ?? fallback.loadType,
      loadPosition: preferred?.loadPosition ?? fallback.loadPosition,
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
    if (state.inferredType === 'beam' && state.supportType === undefined) {
      missing.push('支座/边界条件（悬臂/简支/两端固结/固铰）');
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
    const supportType = state.supportType || 'cantilever';
    const leftRestraint = supportType === 'simply-supported'
      ? [true, false, true, false, false, false]
      : [true, false, true, false, true, false];
    const rightRestraint = supportType === 'simply-supported'
      ? [false, false, true, false, false, false]
      : supportType === 'fixed-fixed'
        ? [true, false, true, false, true, false]
        : supportType === 'fixed-pinned'
          ? [true, false, true, false, false, false]
          : undefined;
    const loads = state.loadType === 'distributed' || state.loadPosition === 'full-span'
      ? [
          { type: 'distributed', element: '1', wz: -load },
          { type: 'distributed', element: '2', wz: -load },
        ]
      : state.loadPosition === 'midspan'
        ? [{ node: '2', fy: -load }]
        : [{ node: '3', fy: -load }];
    return {
      schema_version: '1.0.0',
      unit_system: 'SI',
      nodes: [
        { id: '1', x: 0, y: 0, z: 0, restraints: leftRestraint },
        { id: '2', x: length / 2, y: 0, z: 0 },
        rightRestraint
          ? { id: '3', x: length, y: 0, z: 0, restraints: rightRestraint }
          : { id: '3', x: length, y: 0, z: 0 },
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
        { id: 'LC1', type: 'other', loads },
      ],
      load_combinations: [{ id: 'ULS', factors: { LC1: 1.0 } }],
      metadata: { ...metadata, supportType },
    };
  }

  private async tryLlmExtract(message: string, existingState?: DraftState, locale: AppLocale = 'en'): Promise<DraftExtraction | null> {
    if (!this.llm) {
      return null;
    }

    const prior = existingState
      ? JSON.stringify({
          inferredType: existingState.inferredType,
          lengthM: existingState.lengthM,
          spanLengthM: existingState.spanLengthM,
          heightM: existingState.heightM,
          supportType: existingState.supportType,
          loadKN: existingState.loadKN,
          loadType: existingState.loadType,
          loadPosition: existingState.loadPosition,
        })
      : '{}';

    const prompt = locale === 'zh'
      ? [
          '你是结构建模参数提取器。',
          '从用户输入里提取结构草模参数，仅返回 JSON，不要 markdown。',
          '可选 inferredType: beam | truss | portal-frame | double-span-beam | unknown。',
          '数值统一单位：m, kN。不存在的字段不要输出。',
          `已有参数：${prior}`,
          `用户输入：${message}`,
          '若已说明梁的支座/边界条件，请提取 supportType（cantilever/simply-supported/fixed-fixed/fixed-pinned）。',
          '若已给出荷载，请同时提取 loadType（point/distributed）与 loadPosition。',
          '输出示例：{"inferredType":"beam","lengthM":6,"supportType":"simply-supported","loadKN":20,"loadType":"point","loadPosition":"midspan"}',
        ].join('\n')
      : [
          'You extract structural model draft parameters.',
          'Read the user request and return JSON only, without markdown.',
          'Allowed inferredType values: beam | truss | portal-frame | double-span-beam | unknown.',
          'Use m and kN as units. Omit fields that are not present.',
          'When beam support or boundary conditions are mentioned, also extract supportType (cantilever/simply-supported/fixed-fixed/fixed-pinned).',
          'When loads are mentioned, also extract loadType (point/distributed) and loadPosition.',
          `Known parameters: ${prior}`,
          `User input: ${message}`,
          'Example output: {"inferredType":"beam","lengthM":6,"supportType":"simply-supported","loadKN":20,"loadType":"point","loadPosition":"midspan"}',
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
        supportType: this.normalizeSupportType(parsed.supportType),
        loadKN: this.normalizeNumber(parsed.loadKN),
        loadType: this.normalizeLoadType(parsed.loadType),
        loadPosition: this.normalizeLoadPosition(parsed.loadPosition),
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
      /each span\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
      /per span\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
    ]);
    const lengthM = this.extractNumber(text, [
      /(跨度|跨长|长度|长)\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
      /(\d+(?:\.\d+)?)\s*(?:m|米)/i,
      /(span|length)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
    ], [2, 1]);
    const heightM = this.extractNumber(text, [
      /(柱高|高度|高)\s*(\d+(?:\.\d+)?)\s*(?:m|米)/i,
      /(height|column height)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*m/i,
    ], [2]);
    const loadKN = this.extractNumber(text, [
      /(\d+(?:\.\d+)?)\s*(?:kn|千牛)\s*\/\s*(?:m|米)/i,
      /(\d+(?:\.\d+)?)\s*(?:kn|千牛)(?!\s*\/\s*m)/i,
      /(load)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)\s*kn/i,
    ]);
    const loadType = this.extractLoadType(text);
    const loadPosition = this.extractLoadPosition(text, inferredType, loadType);

    return {
      inferredType,
      lengthM: lengthM ?? undefined,
      spanLengthM: spanLengthM ?? undefined,
      heightM: heightM ?? undefined,
      supportType: this.extractSupportType(text) ?? undefined,
      loadKN: loadKN ?? undefined,
      loadType,
      loadPosition,
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

  private extractLoadType(text: string): DraftLoadType | undefined {
    if (text.includes('均布') || text.includes('distributed') || text.includes('uniform') || text.includes('udl')) {
      return 'distributed';
    }
    if (text.includes('点荷载') || text.includes('集中荷载') || text.includes('point load') || text.includes('concentrated')) {
      return 'point';
    }
    if (text.includes('端部') || text.includes('跨中') || text.includes('midspan') || text.includes('tip')) {
      return 'point';
    }
    return undefined;
  }

  private extractSupportType(text: string): DraftSupportType | undefined {
    if (
      text.includes('fixed-pinned')
      || text.includes('fixed pinned')
      || text.includes('固铰')
      || text.includes('一端固结一端铰支')
    ) {
      return 'fixed-pinned';
    }
    if (
      text.includes('fixed-fixed')
      || text.includes('fixed fixed')
      || text.includes('两端固结')
      || text.includes('双固结')
    ) {
      return 'fixed-fixed';
    }
    if (text.includes('simply supported') || text.includes('simple support') || text.includes('简支')) {
      return 'simply-supported';
    }
    if (text.includes('cantilever') || text.includes('悬臂')) {
      return 'cantilever';
    }
    return undefined;
  }

  private extractLoadPosition(
    text: string,
    inferredType: InferredModelType,
    loadType: DraftLoadType | undefined,
  ): DraftLoadPosition | undefined {
    if (text.includes('柱顶') || text.includes('顶节点') || text.includes('top nodes')) {
      return 'top-nodes';
    }
    if (text.includes('中跨节点') || text.includes('中间节点') || text.includes('middle joint') || text.includes('center joint')) {
      return 'middle-joint';
    }
    if (text.includes('跨中') || text.includes('midspan') || text.includes('mid span')) {
      return 'midspan';
    }
    if (text.includes('全跨') || text.includes('整跨') || text.includes('满跨') || text.includes('full span') || text.includes('entire span')) {
      return 'full-span';
    }
    if (text.includes('端部') || text.includes('端点') || text.includes('tip') || text.includes('free end') || text.includes('at end')) {
      return 'end';
    }
    if (text.includes('节点') || text.includes('joint') || text.includes('node')) {
      return inferredType === 'double-span-beam' ? 'middle-joint' : 'free-joint';
    }
    if (loadType === 'distributed') {
      return inferredType === 'portal-frame' || inferredType === 'double-span-beam' || inferredType === 'beam'
        ? 'full-span'
        : undefined;
    }
    return undefined;
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
    const status = this.extractHttpStatus(error);
    if (unknownError?.response?.data) {
      const payload = typeof unknownError.response.data === 'string'
        ? unknownError.response.data
        : JSON.stringify(unknownError.response.data);
      return status ? `HTTP ${status}: ${payload}` : payload;
    }
    if (unknownError?.message) {
      return status ? `HTTP ${status}: ${String(unknownError.message)}` : String(unknownError.message);
    }
    return 'Unknown error';
  }

  private extractHttpStatus(error: unknown): number | undefined {
    const status = (error as any)?.response?.status;
    return typeof status === 'number' ? status : undefined;
  }

  private shouldBypassValidateFailure(error: unknown): boolean {
    const status = this.extractHttpStatus(error);
    if (typeof status === 'number') {
      return status >= 500;
    }

    const code = (error as any)?.code;
    return code === 'ECONNABORTED' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT';
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
