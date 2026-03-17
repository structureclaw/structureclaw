import axios, { AxiosInstance } from 'axios';
import { ChatOpenAI } from '@langchain/openai';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { buildProxyConfig } from '../utils/http.js';
import { createChatModel } from '../utils/llm.js';
import { prisma } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { redis } from '../utils/redis.js';
import { type AppLocale } from './locale.js';
import { AgentPolicyService } from './agent-policy.js';
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
import {
  buildCodeCheckInput,
  buildCodeCheckSummaryText,
  executeCodeCheckDomain,
} from './agent-skills/domains/code-check-domain.js';
import {
  extractClauseTraceability,
  extractControllingCases,
  extractKeyMetrics,
} from './agent-skills/domains/postprocess-domain.js';
import { extractVisualizationHints } from './agent-skills/domains/visualization-domain.js';
import {
  computeNoSkillMissingFields,
  mergeNoSkillDraftExtraction,
  mergeNoSkillDraftState,
  normalizeNoSkillDraftState,
  tryNoSkillLlmBuildGenericModel,
  tryNoSkillLlmExtract,
} from './agent-noskill-runtime.js';

export type AgentToolName = 'text-to-model-draft' | 'convert' | 'validate' | 'analyze' | 'code-check' | 'report';
export type AgentRunMode = 'chat' | 'execute' | 'auto';
export type AgentReportFormat = 'json' | 'markdown' | 'both';
export type AgentReportOutput = 'inline' | 'file';
export type AgentUserDecision = 'provide_values' | 'confirm_all' | 'allow_auto_decide' | 'revise';
export type AgentInteractionState = 'collecting' | 'confirming' | 'ready' | 'executing' | 'completed' | 'blocked';
export type AgentInteractionStage = 'intent' | 'model' | 'loads' | 'analysis' | 'code_check' | 'report';
export type AgentInteractionRouteHint = 'prefer_chat' | 'prefer_execute';

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

interface PersistedMessageDebugDetails {
  promptSnapshot: string;
  skillIds: string[];
  responseSummary: string;
  plan: string[];
  toolCalls: AgentToolCall[];
}

export interface AgentInteraction {
  state: AgentInteractionState;
  stage: AgentInteractionStage;
  turnId: string;
  routeHint?: AgentInteractionRouteHint;
  routeReason?: string;
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

export interface AgentConversationSessionSnapshot {
  draft: DraftState;
  resolved?: InteractionSession['resolved'];
  interaction: AgentInteraction;
  model?: Record<string, unknown>;
  updatedAt: number;
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
    engineId?: string;
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
  public llm: ChatOpenAI | null;
  private readonly skillRuntime: AgentSkillRuntime;
  private readonly policy: AgentPolicyService;
  private static readonly draftStateTtlSeconds = 30 * 60;

  constructor() {
    this.engineClient = axios.create({
      baseURL: config.analysisEngineUrl,
      timeout: 300000,
      ...buildProxyConfig(config.analysisEngineUrl),
    });

    this.llm = createChatModel(0.1);
    this.skillRuntime = new AgentSkillRuntime();
    this.policy = new AgentPolicyService();
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
    return this.policy.getStageLabel(stage, locale);
  }

  private async getScenarioLabel(key: ScenarioTemplateKey, locale: AppLocale): Promise<string> {
    return this.skillRuntime.getScenarioLabel(key, locale);
  }

  async shouldPreferExecute(message: string, options?: {
    locale?: AppLocale;
    conversationId?: string;
    skillIds?: string[];
    hasModel?: boolean;
  }): Promise<boolean> {
    if (options?.hasModel) {
      return true;
    }
    if (this.policy.inferCodeCheckIntent(message) || this.policy.inferReportIntent(message) === true) {
      return true;
    }
    if (this.isNoSkillMode(options?.skillIds)) {
      return true;
    }
    const locale = this.resolveInteractionLocale(options?.locale);
    const sessionKey = options?.conversationId?.trim();
    const session = await this.getInteractionSession(sessionKey);
    if (session?.draft && session.draft.inferredType !== 'unknown') {
      const assessment = await this.assessInteractionNeeds(session, locale, options?.skillIds, 'chat');
      if (assessment.criticalMissing.length > 0) {
        const stage = await this.skillRuntime.resolveInteractionStage(
          assessment.criticalMissing,
          session.draft,
          options?.skillIds,
        );
        if (stage === 'intent' || stage === 'model' || stage === 'loads') {
          return false;
        }
      }
      if (assessment.nonCriticalMissing.length > 0 && !session.userApprovedAutoDecide) {
        const stage = this.policy.resolveInteractionStageFromMissing('analysis', assessment.nonCriticalMissing);
        if (stage === 'analysis' || stage === 'code_check' || stage === 'report') {
          return false;
        }
      }
    }
    return this.skillRuntime.shouldPreferExecute(message, locale, session?.draft, options?.skillIds);
  }

  async getConversationSessionSnapshot(
    conversationId: string | undefined,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<AgentConversationSessionSnapshot | undefined> {
    const session = await this.getInteractionSession(conversationId);
    if (!session) {
      return undefined;
    }

    const assessment = await this.assessInteractionNeeds(session, locale, skillIds, 'chat');
    const state = assessment.criticalMissing.length > 0
      ? 'collecting'
      : assessment.nonCriticalMissing.length > 0
        ? 'confirming'
        : 'ready';
    const interaction = await this.buildInteractionPayload(assessment, session, state, locale, skillIds);
    const model = assessment.criticalMissing.length === 0
      ? await this.skillRuntime.buildModel(session.draft, skillIds)
      : undefined;

    return {
      draft: session.draft,
      resolved: session.resolved,
      interaction,
      model,
      updatedAt: session.updatedAt,
    };
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

  async clearConversationSession(conversationId: string | undefined): Promise<void> {
    if (!conversationId) {
      return;
    }
    await this.clearInteractionSession(conversationId);
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
            engineId: { type: 'string' },
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
              routeHint: { enum: ['prefer_chat', 'prefer_execute'] },
              routeReason: { type: 'string' },
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
    const noSkillMode = this.isNoSkillMode(skillIds);

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
    await this.applyProvidedValuesToSession(workingSession, providedValues, locale, skillIds);
    if (userDecision === 'allow_auto_decide' || userDecision === 'confirm_all') {
      workingSession.userApprovedAutoDecide = true;
    } else if (userDecision === 'revise') {
      workingSession.userApprovedAutoDecide = false;
    }

    const resolvedRunMode: AgentRunMode = runMode === 'auto'
      ? ((modelInput || await this.skillRuntime.shouldPreferExecute(params.message, locale, workingSession.draft, skillIds))
        ? 'execute'
        : 'chat')
      : runMode;

    if (resolvedRunMode === 'chat') {
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
        workingSession.draft = draft.stateToPersist;
      }
      if (draft.scenario) {
        workingSession.scenario = draft.scenario;
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
          const assessment = await this.assessInteractionNeeds(workingSession, locale, skillIds);
          if (assessment.nonCriticalMissing.length === 0) {
            break;
          }
          this.applyNonCriticalDefaults(workingSession, assessment.defaultProposals);
        }
      }

      const finalAssessment = (noSkillMode && draft.model)
        ? { criticalMissing: [], nonCriticalMissing: [], defaultProposals: [] }
        : await this.assessInteractionNeeds(workingSession, locale, skillIds);
      if (finalAssessment.criticalMissing.length > 0 || finalAssessment.nonCriticalMissing.length > 0 || !draft.model) {
        if (sessionKey) {
          await this.setInteractionSession(sessionKey, workingSession);
        }

        if (noSkillMode) {
          const missingFields = draft.missingFields.length > 0
            ? draft.missingFields
            : [this.localize(locale, '关键结构参数', 'key structural parameters')];
          const question = this.localize(
            locale,
            `当前未启用技能。我会走通用建模能力，请先补充：${missingFields.join('、')}。`,
            `No skills are enabled. I will use generic modeling capability. Please provide: ${missingFields.join(', ')}.`
          );
          const result: AgentRunResult = {
            traceId,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAtMs,
            success: false,
            mode,
            needsModelInput: true,
            plan,
            toolCalls,
            metrics: this.buildMetrics(toolCalls),
            interaction: this.buildExecutionInteraction('blocked', locale),
            clarification: {
              missingFields,
              question,
            },
            response: question,
          };

          return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds);
        }

        const interaction = await this.buildInteractionPayload(
          finalAssessment,
          workingSession,
          finalAssessment.criticalMissing.length > 0 ? 'confirming' : 'collecting',
          locale,
          skillIds,
        );
        const missingFields = await this.mapMissingFieldLabels(finalAssessment.criticalMissing, locale, workingSession.draft, skillIds);
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

        return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds);
      }

      normalizedModel = draft.model;
    }

    const resolvedAnalysisType = workingSession.resolved?.analysisType || params.context?.analysisType || this.policy.inferAnalysisType(params.message);
    const resolvedDesignCode = workingSession.resolved?.designCode || params.context?.designCode || 'GB50017';
    const resolvedAutoCodeCheck = workingSession.resolved?.autoCodeCheck ?? params.context?.autoCodeCheck ?? this.policy.inferCodeCheckIntent(params.message);
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
            interaction: this.buildExecutionInteraction('blocked', locale),
            response: this.localize(locale, `模型格式转换失败：${convertCall.error}`, `Model conversion failed: ${convertCall.error}`),
          };
        return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds);
      }
    }

    let validationWarning: string | undefined;

    plan.push(this.localize(locale, '校验模型字段与引用完整性', 'Validate model fields and references'));
    const validateInput = { model: normalizedModel };
    const validateCall = this.startToolCall('validate', validateInput);
    toolCalls.push(validateCall);

    try {
      const validated = await this.engineClient.post('/validate', {
        ...validateInput,
        engineId: params.context?.engineId,
      });
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
          interaction: this.buildExecutionInteraction('blocked', locale),
          response: this.localize(locale, `模型校验失败：${validateCall.error}`, `Model validation failed: ${validateCall.error}`),
        };
        return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds);
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
          interaction: this.buildExecutionInteraction('blocked', locale),
          response: this.localize(locale, `模型校验失败：${validateCall.error}`, `Model validation failed: ${validateCall.error}`),
        };
        return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds);
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
        interaction: this.buildExecutionInteraction('completed', locale),
        response,
      };
      if (sessionKey) {
        await this.clearInteractionSession(sessionKey);
      }
      return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds);
    }

    plan.push(this.localize(locale, `执行 ${resolvedAnalysisType} 分析并返回摘要`, `Run ${resolvedAnalysisType} analysis and return a summary`));
    const analyzeInput = {
      type: resolvedAnalysisType,
      engineId: params.context?.engineId,
      model: normalizedModel,
      parameters: this.buildAnalysisParameters(analysisParameters, normalizedModel),
    };
    const analyzeCall = this.startToolCall('analyze', analyzeInput);
    toolCalls.push(analyzeCall);

    try {
      const analyzed = await this.postToEngineWithRetry('/analyze', analyzeInput, {
        retries: 2,
        traceId,
        tool: 'analyze',
      });
      this.completeToolCallSuccess(analyzeCall, analyzed.data);
      const analysisSuccess = Boolean(analyzed.data?.success);
      let codeCheckResult: unknown;

      if (analysisSuccess && resolvedAutoCodeCheck) {
        plan.push(this.localize(locale, `执行 ${resolvedDesignCode} 规范校核`, `Run ${resolvedDesignCode} code checks`));
        const codeCheckInput = buildCodeCheckInput({
          traceId,
          designCode: resolvedDesignCode,
          model: normalizedModel,
          analysis: analyzed.data,
          analysisParameters,
          codeCheckElements: params.context?.codeCheckElements,
        });
        const codeCheckCall = this.startToolCall('code-check', codeCheckInput);
        toolCalls.push(codeCheckCall);

        try {
          const codeChecked = await executeCodeCheckDomain(this.engineClient, codeCheckInput, params.context?.engineId);
          this.completeToolCallSuccess(codeCheckCall, codeChecked);
          codeCheckResult = codeChecked;
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
            interaction: this.buildExecutionInteraction('blocked', locale),
            response: this.localize(locale, `规范校核失败：${codeCheckCall.error}`, `Code check failed: ${codeCheckCall.error}`),
          };
          return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds);
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
        report = await this.generateReport({
          message: params.message,
          analysisType: resolvedAnalysisType,
          analysis: analyzed.data,
          codeCheck: codeCheckResult,
          format: resolvedReportFormat,
          locale,
          draft: workingSession.draft,
          skillIds,
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
        interaction: this.buildExecutionInteraction('completed', locale),
        response: validationWarning ? `${validationWarning}\n\n${response}` : response,
      };
      if (sessionKey) {
        await this.clearInteractionSession(sessionKey);
      }
      return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds);
    } catch (error: any) {
      this.completeToolCallError(analyzeCall, error);
      const transientUpstreamFailure = this.shouldRetryEngineCall(error);
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
        interaction: this.buildExecutionInteraction('blocked', locale),
        response: transientUpstreamFailure
          ? this.localize(
            locale,
            `分析引擎服务暂时不可用，重试后仍失败：${analyzeCall.error}`,
            `The analysis engine is temporarily unavailable and still failed after retry: ${analyzeCall.error}`,
          )
          : this.localize(locale, `分析执行失败：${analyzeCall.error}`, `Analysis execution failed: ${analyzeCall.error}`),
      };
      return this.finalizeRunResult(traceId, sessionKey, params.message, result, skillIds);
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
    const noSkillMode = this.isNoSkillMode(params.context?.skillIds);

    plan.push(noSkillMode
      ? this.localize(locale, '按通用规则提取可计算结构参数', 'Extract computable structural parameters using generic rules')
      : this.localize(locale, '识别结构场景并匹配对话模板', 'Identify the structural scenario and select the matching dialogue template'));
    plan.push(this.localize(locale, '按当前阶段补齐关键工程参数', 'Collect the key engineering parameters for the current stage'));

    const draftCall = this.startToolCall('text-to-model-draft', { message: params.message, conversationId: sessionKey, mode: 'chat' });
    toolCalls.push(draftCall);

    const draft = await this.textToModelDraft(params.message, workingSession.draft, locale, params.context?.skillIds);
    if (draft.stateToPersist) {
      workingSession.draft = draft.stateToPersist;
    }
    if (draft.scenario) {
      workingSession.scenario = draft.scenario;
    }
    workingSession.updatedAt = Date.now();
    this.applyInferredNonCriticalFromMessage(workingSession, params.message);
    this.completeToolCallSuccess(draftCall, {
      inferredType: draft.inferredType,
      missingFields: draft.missingFields,
      extractionMode: draft.extractionMode,
      modelGenerated: Boolean(draft.model),
    });

    if (noSkillMode) {
      if (sessionKey) {
        await this.setInteractionSession(sessionKey, workingSession);
      }

      if (draft.model) {
        const interaction: AgentInteraction = {
          state: 'ready',
          stage: 'model',
          turnId: randomUUID(),
          routeHint: 'prefer_execute',
          routeReason: this.localize(
            locale,
            '未启用技能，但当前输入已可直接生成结构模型。',
            'No skills are enabled, but the current input is sufficient to build a structural model directly.',
          ),
          conversationStage: this.getStageLabel('model', locale),
          missingCritical: [],
          missingOptional: [],
          questions: [],
          pending: {
            criticalMissing: [],
            nonCriticalMissing: [],
          },
          proposedDefaults: [],
          nextActions: ['confirm_all'],
          recommendedNextStep: this.localize(
            locale,
            '可直接执行分析，或继续补充更细的建模参数。',
            'You can run analysis directly, or continue refining modeling parameters.',
          ),
        };

        const response = this.localize(
          locale,
          '已根据当前输入直接生成结构模型 JSON，可直接执行分析。',
          'A structural model JSON has been generated directly from your input and is ready for analysis.',
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
          metrics: this.buildMetrics(toolCalls),
          model: draft.model,
          interaction,
          response,
        };
        return this.finalizeRunResult(traceId, sessionKey, params.message, result, params.context?.skillIds);
      }

      const missingFields = draft.missingFields.length > 0
        ? draft.missingFields
        : [this.localize(locale, '关键结构参数', 'key structural parameters')];
      const question = this.localize(
        locale,
        `当前未启用技能。我会走通用建模能力，请先补充：${missingFields.join('、')}。`,
        `No skills are enabled. I will use generic modeling capability. Please provide: ${missingFields.join(', ')}.`,
      );
      const interaction: AgentInteraction = {
        state: 'confirming',
        stage: 'model',
        turnId: randomUUID(),
        routeHint: 'prefer_chat',
        routeReason: this.localize(
          locale,
          '当前仍缺少关键建模参数，请先补充后再执行。',
          'Critical modeling parameters are still missing. Please provide them before execution.',
        ),
        conversationStage: this.getStageLabel('model', locale),
        missingCritical: missingFields,
        missingOptional: [],
        questions: [{
          paramKey: 'genericModeling',
          label: this.localize(locale, '关键参数', 'Key parameters'),
          question,
          required: true,
          critical: true,
        }],
        pending: {
          criticalMissing: missingFields,
          nonCriticalMissing: [],
        },
        proposedDefaults: [],
        nextActions: ['provide_values', 'revise'],
      };

      const result: AgentRunResult = {
        traceId,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        success: true,
        mode,
        needsModelInput: true,
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
      return this.finalizeRunResult(traceId, sessionKey, params.message, result, params.context?.skillIds);
    }

    const assessment = await this.assessInteractionNeeds(workingSession, locale, params.context?.skillIds, 'chat');
    const state: AgentInteractionState = assessment.criticalMissing.length > 0
      ? 'confirming'
      : assessment.nonCriticalMissing.length > 0
        ? 'collecting'
        : 'ready';
    const interaction = await this.buildInteractionPayload(assessment, workingSession, state, locale, params.context?.skillIds);
    interaction.recommendedNextStep = this.buildRecommendedNextStep(assessment, interaction, locale);

    if (sessionKey) {
      await this.setInteractionSession(sessionKey, workingSession);
    }

    const response = this.buildChatModeResponse(interaction, locale);
    const synchronizedModel = draft.model ?? undefined
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
      model: synchronizedModel,
      interaction,
      clarification: interaction.questions?.length
        ? {
            missingFields: interaction.missingCritical || [],
            question: interaction.questions[0]?.question || response,
          }
        : undefined,
      response,
    };
    return this.finalizeRunResult(traceId, sessionKey, params.message, result, params.context?.skillIds);
  }

  private async assessInteractionNeeds(
    session: InteractionSession,
    locale: AppLocale,
    skillIds?: string[],
    mode: AgentRunMode = 'execute'
  ): Promise<{
    criticalMissing: string[];
    nonCriticalMissing: string[];
    defaultProposals: InteractionDefaultProposal[];
  }> {
    const structural = await this.skillRuntime.assessDraft(
      session.draft,
      locale,
      mode === 'chat' ? 'chat' : 'execute',
      skillIds,
    );
    const criticalMissing = [...structural.criticalMissing];
    const nonCriticalMissing: string[] = [...structural.optionalMissing];
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

    const structuralDefaults = await this.skillRuntime.buildStructuralDefaultProposals(
      structural.optionalMissing,
      session.draft,
      locale,
      skillIds,
    );
    const nonStructuralDefaults = this.policy.buildDefaultProposals(nonCriticalMissing, locale);
    const mergedDefaults = [...structuralDefaults, ...nonStructuralDefaults];
    const uniqueDefaults = Array.from(new Map(mergedDefaults.map((item) => [item.paramKey, item])).values());

    return {
      criticalMissing,
      nonCriticalMissing,
      defaultProposals: uniqueDefaults,
    };
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
      session.resolved.analysisType = this.policy.inferAnalysisType(message);
    }
    const inferredCode = this.policy.inferDesignCode(message);
    if (inferredCode && !session.resolved.designCode) {
      session.resolved.designCode = inferredCode;
    }
    if (session.resolved.autoCodeCheck === undefined && this.policy.inferCodeCheckIntent(message)) {
      session.resolved.autoCodeCheck = true;
    }
    if (session.resolved.includeReport === undefined) {
      const reportIntent = this.policy.inferReportIntent(message);
      if (reportIntent !== undefined) {
        session.resolved.includeReport = reportIntent;
      }
    }
  }

  private async applyProvidedValuesToSession(
    session: InteractionSession,
    values: Record<string, unknown>,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<void> {
    if (!values || typeof values !== 'object') {
      return;
    }
    session.draft = await this.skillRuntime.applyProvidedValues(session.draft, values, locale, skillIds);
    if (session.draft.scenarioKey) {
      session.scenario = {
        key: session.draft.scenarioKey,
        mappedType: session.draft.inferredType,
        skillId: session.draft.skillId,
        supportLevel: session.draft.supportLevel || 'supported',
        supportNote: session.draft.supportNote,
      };
    }
    session.resolved = session.resolved || {};
    if (typeof values.analysisType === 'string') {
      session.resolved.analysisType = this.policy.normalizeAnalysisType(values.analysisType);
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
      session.resolved.reportFormat = this.policy.normalizeReportFormat(values.reportFormat);
    }
    if (typeof values.reportOutput === 'string') {
      session.resolved.reportOutput = this.policy.normalizeReportOutput(values.reportOutput);
    }
    session.updatedAt = Date.now();
  }

  private async mapMissingFieldLabels(missing: string[], locale: AppLocale, draft: DraftState, skillIds?: string[]): Promise<string[]> {
    const labels = await this.skillRuntime.mapMissingFieldLabels(missing, locale, draft, skillIds);
    return missing.map((key, index) => {
      const policyLabel = this.policy.mapNonStructuralMissingFieldLabel(key, locale);
      return policyLabel || labels[index] || key;
    });
  }

  private async buildInteractionPayload(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[]; defaultProposals: InteractionDefaultProposal[] },
    session: InteractionSession,
    state: AgentInteractionState,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<AgentInteraction> {
    const missingKeys = [...assessment.criticalMissing, ...assessment.nonCriticalMissing];
    const questions = await this.buildInteractionQuestions(missingKeys, assessment.criticalMissing, session, locale, skillIds);
    const stage = await this.resolveInteractionStage(missingKeys, session.draft, skillIds);
    const missingCritical = await this.mapMissingFieldLabels(assessment.criticalMissing, locale, session.draft, skillIds);
    const missingOptional = await this.mapMissingFieldLabels(assessment.nonCriticalMissing, locale, session.draft, skillIds);
    const route = this.buildInteractionRouteHint(assessment, stage, session, locale);
    return {
      state,
      stage,
      turnId: randomUUID(),
      routeHint: route.routeHint,
      routeReason: route.routeReason,
      detectedScenario: session.scenario?.key,
      detectedScenarioLabel: session.scenario ? await this.getScenarioLabel(session.scenario.key, locale) : undefined,
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

  private buildInteractionRouteHint(
    assessment: { criticalMissing: string[]; nonCriticalMissing: string[] },
    stage: AgentInteractionStage,
    session: InteractionSession,
    locale: AppLocale,
  ): { routeHint: AgentInteractionRouteHint; routeReason: string } {
    if (assessment.criticalMissing.length > 0) {
      if (stage === 'intent' || stage === 'model' || stage === 'loads') {
        return {
          routeHint: 'prefer_chat',
          routeReason: this.localize(
            locale,
            '当前仍缺少关键建模参数，建议继续对话补参后再执行。',
            'Critical modeling inputs are still missing; continue clarification before execution.',
          ),
        };
      }
      return {
        routeHint: 'prefer_chat',
        routeReason: this.localize(
          locale,
          '仍有关键参数待确认，建议先完成参数补充。',
          'Key parameters are still pending; complete clarification first.',
        ),
      };
    }

    if (assessment.nonCriticalMissing.length > 0 && !session.userApprovedAutoDecide) {
      return {
        routeHint: 'prefer_chat',
        routeReason: this.localize(
          locale,
          '分析、校核或报告偏好尚未确认，建议先确认策略再执行。',
          'Analysis, code-check, or reporting preferences are pending; confirm strategy before execution.',
        ),
      };
    }

    return {
      routeHint: 'prefer_execute',
      routeReason: this.localize(
        locale,
        '当前参数已达到执行条件，可直接进入分析流程。',
        'Current inputs are execution-ready; analysis can proceed directly.',
      ),
    };
  }

  private async buildInteractionQuestions(
    missingKeys: string[],
    criticalMissing: string[],
    session: InteractionSession,
    locale: AppLocale,
    skillIds?: string[],
  ): Promise<InteractionQuestion[]> {
    const structuralQuestions = new Map(
      (await this.skillRuntime.buildInteractionQuestions(missingKeys, criticalMissing, session.draft, locale, skillIds))
        .map((question) => [question.paramKey, question])
    );
    return missingKeys.map((paramKey) => {
      const critical = criticalMissing.includes(paramKey);
      const structuralQuestion = structuralQuestions.get(paramKey);
      if (structuralQuestion) {
        return structuralQuestion;
      }
      const policyQuestion = this.policy.buildNonStructuralInteractionQuestion(paramKey, locale, critical);
      if (policyQuestion) {
        return policyQuestion;
      }
      return { paramKey, label: paramKey, question: this.localize(locale, `请确认参数 ${paramKey}。`, `Please confirm parameter ${paramKey}.`), required: true, critical };
    });
  }

  private async resolveInteractionStage(missingKeys: string[], draft: DraftState, skillIds?: string[]): Promise<AgentInteractionStage> {
    const structuralStage = await this.skillRuntime.resolveInteractionStage(missingKeys, draft, skillIds);
    return this.policy.resolveInteractionStageFromMissing(structuralStage, missingKeys);
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

  private buildExecutionInteraction(state: 'completed' | 'blocked', locale: AppLocale): AgentInteraction {
    return {
      state,
      stage: 'report',
      turnId: randomUUID(),
      routeHint: 'prefer_execute',
      routeReason: state === 'completed'
        ? this.localize(locale, '执行已完成。', 'Execution completed.')
        : this.localize(locale, '执行已触发，但被下游工具或校验失败阻断。', 'Execution attempted but was blocked by downstream tool or validation failure.'),
      nextActions: state === 'completed' ? [] : ['revise'],
    };
  }

  private async generateReport(params: {
    message: string;
    analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    analysis: unknown;
    codeCheck?: unknown;
    format: AgentReportFormat;
    locale: AppLocale;
    draft?: DraftState;
    skillIds?: string[];
  }): Promise<AgentRunResult['report']> {
    const analysisSuccess = Boolean((params.analysis as any)?.success);
    const codeCheckText = buildCodeCheckSummaryText({
      codeCheck: params.codeCheck,
      locale: params.locale,
      localize: (locale, zh, en) => this.localize(locale, zh, en),
    });
    const summary = this.localize(
      params.locale,
      `分析类型 ${params.analysisType}，分析${analysisSuccess ? '成功' : '失败'}，${codeCheckText}。`,
      `Analysis type ${params.analysisType}; analysis ${analysisSuccess ? 'succeeded' : 'failed'}; ${codeCheckText}.`
    );
    const keyMetrics = extractKeyMetrics(params.analysis, params.codeCheck);
    const clauseTraceability = extractClauseTraceability(params.codeCheck);
    const controllingCases = extractControllingCases(params.analysis);
    const visualizationHints = extractVisualizationHints(params.analysis);
    const jsonReport: Record<string, unknown> = {
      reportSchemaVersion: '1.0.0',
      intent: params.message,
      analysisType: params.analysisType,
      summary,
      keyMetrics,
      clauseTraceability,
      controllingCases,
      visualizationHints,
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

    const markdown = await this.skillRuntime.buildReportNarrative({
      message: params.message,
      analysisType: params.analysisType,
      analysisSuccess,
      codeCheckText,
      summary,
      keyMetrics,
      clauseTraceability,
      controllingCases,
      visualizationHints,
      locale: params.locale,
    }, params.draft, params.skillIds);

    return {
      summary,
      json: jsonReport,
      markdown: params.format === 'both' || params.format === 'markdown' ? markdown : undefined,
    };
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
    if (this.isNoSkillMode(skillIds)) {
      return this.textToModelDraftWithoutSkills(message, existingState, locale);
    }
    return this.skillRuntime.textToModelDraft(this.llm, message, existingState, locale, skillIds);
  }

  private isNoSkillMode(skillIds?: string[]): boolean {
    return Array.isArray(skillIds) && skillIds.length === 0;
  }

  private async textToModelDraftWithoutSkills(
    message: string,
    existingState: DraftState | undefined,
    locale: AppLocale,
  ): Promise<DraftResult> {
    const llmExtraction = await tryNoSkillLlmExtract(this.llm, message, existingState, locale);
    const mergedExtraction = mergeNoSkillDraftExtraction(llmExtraction, { inferredType: 'unknown' });
    const stateToPersist = mergeNoSkillDraftState(existingState, mergedExtraction);
    const noSkillState = normalizeNoSkillDraftState(stateToPersist);

    const model = await tryNoSkillLlmBuildGenericModel(this.llm, message, noSkillState, locale);
    const missingFields = model ? [] : computeNoSkillMissingFields(noSkillState);

    return {
      inferredType: noSkillState.inferredType,
      missingFields: model ? [] : missingFields,
      extractionMode: llmExtraction ? 'llm' : 'rule-based',
      model,
      stateToPersist: noSkillState,
    };
  }

  private buildAnalysisParameters(
    baseParameters: Record<string, unknown>,
    model: Record<string, unknown>,
  ): Record<string, unknown> {
    const next = { ...baseParameters };
    const modelLoadCases = this.normalizeModelLoadCases(model);
    const modelCombinations = this.normalizeModelCombinations(model);

    if (next.loadCases === undefined && modelLoadCases.length > 0) {
      next.loadCases = modelLoadCases;
    }
    if (next.combinations === undefined && modelCombinations.length > 0) {
      next.combinations = modelCombinations;
    }

    return next;
  }

  private normalizeModelLoadCases(model: Record<string, unknown>): Array<Record<string, unknown>> {
    const loadCases = Array.isArray(model.load_cases) ? model.load_cases : [];
    return loadCases
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item, index) => ({
        name: typeof item.id === 'string' ? item.id : `LC${index + 1}`,
        type: typeof item.type === 'string' ? item.type : 'other',
        loads: this.normalizeModelLoads(item.loads),
      }))
      .filter((item) => Array.isArray(item.loads) && item.loads.length > 0);
  }

  private normalizeModelCombinations(model: Record<string, unknown>): Array<Record<string, unknown>> {
    const combinations = Array.isArray(model.load_combinations) ? model.load_combinations : [];
    return combinations.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }

  private normalizeModelLoads(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => {
        if (item.type === 'distributed' || item.element !== undefined) {
          const magnitude = this.asNumber(item.wy ?? item.fy ?? item.wz ?? item.fz, 0);
          return {
            type: 'distributed',
            element: String(item.element ?? ''),
            wy: magnitude,
            wz: 0,
          };
        }

        const forces = Array.isArray(item.forces)
          ? item.forces.slice(0, 6).map((entry) => this.asNumber(entry, 0))
          : [
              this.asNumber(item.fx, 0),
              this.asNumber(item.fy ?? item.wy, 0),
              this.asNumber(item.fz ?? item.wz, 0),
              this.asNumber(item.mx, 0),
              this.asNumber(item.my, 0),
              this.asNumber(item.mz, 0),
            ];

        return {
          type: 'nodal',
          node: String(item.node ?? ''),
          forces: forces.length === 6 ? forces : [0, 0, 0, 0, 0, 0],
        };
      })
      .filter((item) => {
        if (item.type === 'distributed') {
          return typeof item.element === 'string' && item.element.length > 0;
        }
        return typeof item.node === 'string' && item.node.length > 0;
      });
  }

  private asNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
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
    return this.shouldRetryEngineCall(error);
  }

  private shouldRetryEngineCall(error: unknown): boolean {
    const status = this.extractHttpStatus(error);
    if (typeof status === 'number') {
      return status >= 500;
    }

    const code = (error as any)?.code;
    return code === 'ECONNABORTED' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT';
  }

  private async postToEngineWithRetry(
    path: string,
    payload: Record<string, unknown>,
    options: {
      retries: number;
      traceId: string;
      tool: AgentToolName;
    },
  ) {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= options.retries) {
      try {
        return await this.engineClient.post(path, payload);
      } catch (error) {
        lastError = error;
        if (!this.shouldRetryEngineCall(error) || attempt === options.retries) {
          throw error;
        }
        logger.warn(
          {
            traceId: options.traceId,
            tool: options.tool,
            attempt: attempt + 1,
            error: this.stringifyError(error),
          },
          'Transient engine call failed; retrying',
        );
      }
      attempt += 1;
    }
    throw lastError;
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

  private async finalizeRunResult(
    traceId: string,
    conversationId: string | undefined,
    userMessage: string,
    result: AgentRunResult,
    skillIds?: string[],
  ): Promise<AgentRunResult> {
    await this.persistConversationMessages(conversationId, userMessage, result, skillIds);
    this.logRunResult(traceId, conversationId, result);
    return result;
  }

  private buildPersistedDebugDetails(
    userMessage: string,
    result: AgentRunResult,
    skillIds?: string[],
  ): PersistedMessageDebugDetails {
    const safeSkillIds = Array.isArray(skillIds) ? skillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
    const promptSnapshot = JSON.stringify({
      message: userMessage,
      context: {
        traceId: result.traceId,
        skillIds: safeSkillIds,
      },
    }, null, 2);

    return {
      promptSnapshot,
      skillIds: safeSkillIds,
      responseSummary: result.response || '',
      plan: Array.isArray(result.plan) ? result.plan : [],
      toolCalls: Array.isArray(result.toolCalls) ? result.toolCalls : [],
    };
  }

  private async persistConversationMessages(
    conversationId: string | undefined,
    userMessage: string,
    result: AgentRunResult,
    skillIds?: string[],
  ): Promise<void> {
    const assistantMessage = result.response;
    if (!conversationId || !userMessage.trim() || !assistantMessage?.trim()) {
      return;
    }

    const debugDetails = this.buildPersistedDebugDetails(userMessage, result, skillIds);

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true },
      });
      if (!conversation) {
        return;
      }

      await prisma.message.createMany({
        data: [
          {
            conversationId,
            role: 'user',
            content: userMessage.trim(),
          },
          {
            conversationId,
            role: 'assistant',
            content: assistantMessage.trim(),
            metadata: {
              debugDetails,
            } as unknown as Prisma.InputJsonValue,
          },
        ],
      });
    } catch {
      // Keep message persistence non-blocking so agent flows still complete.
    }
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
