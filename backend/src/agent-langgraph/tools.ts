/**
 * LangGraph tool definitions for the StructureClaw ReAct agent.
 *
 * Tools read dependencies from config.configurable (AgentConfigurable)
 * and state from the graph state via config.configurable.agentState.
 *
 * Artifact-writing tools (build_model, run_analysis, etc.) return
 * Command({ update }) objects to write directly into graph state channels,
 * eliminating the need for an extract_artifacts intermediary node.
 *
 * Custom streaming events are emitted via config.writer for real-time
 * tool status updates to the frontend.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { AgentSkillRuntime } from '../agent-runtime/index.js';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { Command, interrupt } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { logger } from '../utils/logger.js';
import { getLogger, logToolCall } from '../utils/agent-logger.js';
import type { AgentState } from './state.js';
import type { AgentConfigurable } from './configurable.js';
import { runPkpmCalcbook } from '../agent-skills/report-export/calculation-book/pkpm-calcbook/runner.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the AgentConfigurable from the LangGraph run config. */
function getConfigurable(config: LangGraphRunnableConfig): AgentConfigurable & { agentState?: AgentState } {
  return config.configurable as AgentConfigurable & { agentState?: AgentState };
}

/** Get the tool call ID from the LangChain config. */
function getToolCallId(config: LangGraphRunnableConfig): string {
  const id = (config as any).toolCall?.id;
  if (!id) throw new Error('Tool call ID not available in config');
  return id;
}

/**
 * Create a Command that updates graph state channels AND adds a ToolMessage.
 * This is the recommended LangGraph pattern for tools that produce artifacts.
 */
function toolResult(
  toolCallId: string,
  toolName: string,
  content: string,
  stateUpdate?: Partial<AgentState>,
): Command {
  return new Command({
    update: {
      ...(stateUpdate || {}),
      messages: [new ToolMessage({
        content,
        tool_call_id: toolCallId,
        name: toolName,
      })],
    },
  });
}

function buildDraftProgress(
  locale: 'zh' | 'en',
  criticalMissing: string[],
): { canProceed: boolean; nextAction: 'ask_user_clarification' | 'build_model'; reason?: string } {
  if (criticalMissing.length === 0) {
    return { canProceed: true, nextAction: 'build_model' };
  }
  const missingText = criticalMissing.join(', ');
  return {
    canProceed: false,
    nextAction: 'ask_user_clarification',
    reason: locale === 'zh'
      ? `草稿仍缺少关键参数：${missingText}。需要继续向用户澄清，不能直接构建模型或写入 memory。`
      : `The draft is still missing critical parameters: ${missingText}. Continue by asking the user for clarification; do not build the model or store draft values in memory.`,
  };
}

const ANALYSIS_MESSAGE_LIMIT = 6000;
type TextCompaction = 'middle' | 'tail';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactText(
  value: unknown,
  limit = ANALYSIS_MESSAGE_LIMIT,
  mode: TextCompaction = 'middle',
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.length <= limit) return text;
  const omitted = text.length - limit;
  if (mode === 'tail') {
    const marker = `...[truncated ${omitted} chars]\n`;
    const tailLength = Math.max(0, limit - marker.length);
    return `${marker}${text.slice(-tailLength)}`;
  }
  const marker = `\n...[truncated ${omitted} chars]...\n`;
  const bodyLength = Math.max(0, limit - marker.length);
  const headLength = Math.ceil(bodyLength * 0.35);
  const tailLength = bodyLength - headLength;
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}

function normalizeAnalysisErrorCode(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return 'ANALYSIS_EXECUTION_FAILED';
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function countRecordEntries(value: unknown): number | undefined {
  return isRecord(value) ? Object.keys(value).length : undefined;
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function pickNumberLike(record: Record<string, unknown>, key: string): number | string | null | undefined {
  const value = record[key];
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return undefined;
}

function pickStringLike(record: Record<string, unknown>, key: string): string | null | undefined {
  const value = record[key];
  if (value === null) return null;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function omitEmptyRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function pickAnalysisDiagnostics(
  result: Record<string, unknown>,
  meta: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const diagnostics: Record<string, unknown> = {};
  const copy = (targetKey: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    const isTail = targetKey.endsWith('Tail');
    diagnostics[targetKey] = typeof value === 'string'
      ? compactText(value, 2000, isTail ? 'tail' : 'middle') ?? value
      : value;
  };

  copy('engineId', meta.engineId);
  copy('engineName', meta.engineName);
  copy('exceptionType', meta.exceptionType);
  copy('analysisSkillId', meta.analysisSkillId);
  copy('analysisAdapterKey', meta.analysisAdapterKey);
  copy('workDir', meta.workDir);
  copy('runMetaPath', meta.runMetaPath);
  copy('driverResultPath', meta.driverResultPath);
  copy('driverOutputPath', meta.driverOutputPath);
  copy('stdoutPath', meta.stdoutPath);
  copy('stderrPath', meta.stderrPath);
  copy('stdoutTail', meta.stdoutTail);
  copy('stderrTail', meta.stderrTail);
  copy('stepsTail', meta.stepsTail);
  copy('message', result.message);

  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

function buildSuccessfulAnalysisDetails(data: Record<string, unknown>, result: Record<string, unknown>) {
  const summary = optionalRecord(data.summary);
  const envelope = optionalRecord(data.envelope);
  const caseResults = optionalRecord(data.caseResults);
  const loadCases = optionalRecord(data.loadCases);
  const combinations = optionalRecord(data.combinations);

  const counts = omitEmptyRecord({
    nodeCount: firstDefined(
      summary ? pickNumberLike(summary, 'nodeCount') : undefined,
      countRecordEntries(data.displacements),
    ),
    elementCount: firstDefined(
      summary ? pickNumberLike(summary, 'elementCount') : undefined,
      countRecordEntries(data.forces),
    ),
    reactionNodeCount: firstDefined(
      summary ? pickNumberLike(summary, 'reactionNodeCount') : undefined,
      countRecordEntries(data.reactions),
    ),
    loadCaseCount: firstDefined(
      summary ? pickNumberLike(summary, 'loadCaseCount') : undefined,
      countRecordEntries(caseResults),
      countRecordEntries(loadCases),
    ),
    combinationCount: firstDefined(
      summary ? pickNumberLike(summary, 'combinationCount') : undefined,
      countRecordEntries(combinations),
    ),
  });

  const keyMetrics = envelope ? omitEmptyRecord({
    maxAbsDisplacement: pickNumberLike(envelope, 'maxAbsDisplacement'),
    maxAbsAxialForce: pickNumberLike(envelope, 'maxAbsAxialForce'),
    maxAbsShearForce: pickNumberLike(envelope, 'maxAbsShearForce'),
    maxAbsMoment: pickNumberLike(envelope, 'maxAbsMoment'),
    maxAbsReaction: pickNumberLike(envelope, 'maxAbsReaction'),
  }) : undefined;

  const controlling = envelope ? omitEmptyRecord({
    controlNodeDisplacement: pickStringLike(envelope, 'controlNodeDisplacement'),
    controlElementAxialForce: pickStringLike(envelope, 'controlElementAxialForce'),
    controlElementShearForce: pickStringLike(envelope, 'controlElementShearForce'),
    controlElementMoment: pickStringLike(envelope, 'controlElementMoment'),
    controlNodeReaction: pickStringLike(envelope, 'controlNodeReaction'),
  }) : undefined;

  const rawWarnings = Array.isArray(data.warnings)
    ? data.warnings
    : Array.isArray(result.warnings)
      ? result.warnings
      : [];
  const warnings = rawWarnings
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 5)
    .map((value) => compactText(value, 500) ?? value);

  return omitEmptyRecord({
    counts,
    keyMetrics,
    controlling,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}

function getAnalysisPayload(result: Record<string, unknown>): Record<string, unknown> {
  return isRecord(result.data) ? result.data : result;
}

export function buildAnalysisToolSummary(args: {
  result: unknown;
  skillId?: string;
}): Record<string, unknown> {
  const result = isRecord(args.result) ? args.result : {};
  const meta = isRecord(result.meta) ? result.meta : {};
  const data = getAnalysisPayload(result);
  const status = typeof result.status === 'string' ? result.status : undefined;
  const success = result.success !== false && status !== 'error';

  if (!success) {
    const errorCode = normalizeAnalysisErrorCode(result.error_code, result.errorCode);
    const diagnostics = pickAnalysisDiagnostics(result, meta);
    return {
      success: false,
      skillId: args.skillId,
      errorCode,
      message: compactText(result.message) || 'Analysis execution failed',
      ...(diagnostics ? { diagnostics } : {}),
    };
  }

  return {
    success: true,
    skillId: args.skillId,
    analysisMode: data?.analysisMode,
    ...(buildSuccessfulAnalysisDetails(data, result) ?? {}),
  };
}

export function buildModelToolSummary(
  model: Record<string, unknown>,
  locale: 'zh' | 'en' = 'zh',
): Record<string, unknown> {
  const nodeCount = Array.isArray(model.nodes) ? model.nodes.length : 0;
  const elementCount = Array.isArray(model.elements) ? model.elements.length : 0;
  const schemaVersion = model.schema_version;

  if (nodeCount === 0 || elementCount === 0) {
    return {
      success: false,
      errorCode: 'EMPTY_MODEL',
      message: locale === 'zh'
        ? '模型构建结果为空，未生成可分析的节点或单元。请重新提取参数或补充结构连接信息。'
        : 'Model build returned an empty model with no analyzable nodes or elements. Re-extract parameters or provide structural connectivity.',
      nodeCount,
      elementCount,
      schemaVersion,
    };
  }

  return {
    success: true,
    nodeCount,
    elementCount,
    schemaVersion,
  };
}

export function buildModelToolStateUpdate(
  model: Record<string, unknown>,
  summary: Record<string, unknown>,
): Partial<AgentState> {
  if (summary.success === false) {
    return {
      model: null,
      analysisResult: null,
      codeCheckResult: null,
      report: null,
    };
  }
  return { model };
}

// ---------------------------------------------------------------------------
// Engineering tools (wrap AgentSkillRuntime)
// ---------------------------------------------------------------------------

export function createDetectStructureTypeTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: { message: string; locale?: string }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);
      const skillIds = configurable.skillScope;
      const locale = (input.locale === 'en' ? 'en' : (state?.locale || 'zh')) as 'zh' | 'en';
      const message = state?.lastUserMessage || input.message || '';
      try {
        const match = await skillRuntime.detectStructuralType(
          message,
          locale,
          undefined,
          skillIds,
        );
        const result = {
          key: match.key,
          mappedType: match.mappedType,
          skillId: match.skillId,
          supportLevel: match.supportLevel,
          supportNote: match.supportNote,
        };
        const stateUpdate: Partial<AgentState> = {};
        if (match.key) stateUpdate.structuralTypeKey = match.key;
        logToolCall(log, { tool: 'detect_structure_type', durationMs: Date.now() - start, extra: { matchedKey: match.key, skillId: match.skillId } });
        return toolResult(toolCallId, 'detect_structure_type', JSON.stringify(result), stateUpdate);
      } catch (error) {
        logToolCall(log, { tool: 'detect_structure_type', durationMs: Date.now() - start, success: false, extra: { error: error instanceof Error ? error.message : String(error) } });
        throw error;
      }
    },
    {
      name: 'detect_structure_type',
      description:
        'Detect the structural type (beam, truss, frame, portal-frame, etc.) from a user description. ' +
        'Returns the matched type key, mapped model type, and the skill ID to use for further processing.',
      schema: z.object({
        message: z.string().describe('The user message describing the structure'),
        locale: z.enum(['zh', 'en']).optional().describe('User locale (defaults to session locale)'),
      }),
    },
  );
}

export function createExtractDraftParamsTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: {
      message: string;
      locale?: string;
    }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);

      const existingState = state?.draftState || undefined;
      const skillIds = configurable.skillScope;
      const locale = (input.locale === 'en' ? 'en' : (state?.locale || 'zh')) as 'zh' | 'en';
      const message = state?.lastUserMessage || input.message || '';

      try {
        // Step 1: Detect structural type
        const match = await skillRuntime.detectStructuralType(
          message, locale, existingState, skillIds,
        );

        // Early return when no skill matched
        if (!match.skillId) {
          const nextState = {
            ...(existingState || { inferredType: 'unknown' as const }),
            structuralTypeKey: match.key,
            supportLevel: match.supportLevel,
            supportNote: match.supportNote,
            updatedAt: Date.now(),
          };
          const responseJson = {
            nextState,
            criticalMissing: ['inferredType'],
            optionalMissing: [],
            structuralTypeMatch: match,
            skillId: undefined,
            extractionMode: 'deterministic',
            ...buildDraftProgress(locale, ['inferredType']),
          };
          const stateUpdate: Partial<AgentState> = { draftState: nextState };
          if (match.key) stateUpdate.structuralTypeKey = match.key;
          logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, extra: { skillId: undefined, criticalMissing: 1 } });
          return toolResult(toolCallId, 'extract_draft_params', JSON.stringify(responseJson), stateUpdate);
        }

        // Step 2: Resolve plugin
        const plugin = await skillRuntime.resolvePluginForType(match.skillId, skillIds);
        if (!plugin) {
          const nextState = existingState || { inferredType: 'unknown' as const, updatedAt: Date.now() };
          const responseJson = {
            nextState,
            criticalMissing: ['inferredType'],
            optionalMissing: [],
            structuralTypeMatch: match,
            skillId: undefined,
            extractionMode: 'deterministic',
            ...buildDraftProgress(locale, ['inferredType']),
          };
          logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, extra: { skillId: match.skillId, pluginResolved: false } });
          return toolResult(toolCallId, 'extract_draft_params', JSON.stringify(responseJson), { draftState: nextState });
        }

        // Generic skill: deterministic path (no LLM extraction needed)
        if (plugin.id === 'generic' && existingState?.inferredType && existingState.inferredType !== 'unknown') {
          const { withStructuralTypeState } = await import('../agent-runtime/plugin-helpers.js');
          const nextState = withStructuralTypeState(plugin.handler.mergeState(existingState, {}), match);
          const missing = plugin.handler.computeMissing(nextState, 'execution');
          const responseJson = {
            nextState,
            criticalMissing: missing.critical,
            optionalMissing: missing.optional,
            structuralTypeMatch: match,
            skillId: plugin.id,
            extractionMode: 'deterministic',
            ...buildDraftProgress(locale, missing.critical),
          };
          const stateUpdate: Partial<AgentState> = { draftState: nextState, structuralTypeKey: match.key };
          logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, extra: { skillId: plugin.id, extractionMode: 'deterministic', criticalMissing: missing.critical.length } });
          return toolResult(toolCallId, 'extract_draft_params', JSON.stringify(responseJson), stateUpdate);
        }

        // Step 3: Sub-agent extracts parameters (skill manifest driven)
        const { invokeParamExtractor } = await import('./param-extractor.js');
        const draftPatch = await invokeParamExtractor({ message, existingState, locale, plugin });

        // Step 4: Handler pipeline (extractDraft → mergeState → computeMissing)
        const patch = plugin.handler.extractDraft({
          message,
          locale,
          currentState: existingState,
          llmDraftPatch: draftPatch,
          structuralTypeMatch: match,
        });
        const { withStructuralTypeState } = await import('../agent-runtime/plugin-helpers.js');
        const nextState = withStructuralTypeState(plugin.handler.mergeState(existingState, patch), match);
        const missing = plugin.handler.computeMissing(nextState, 'execution');

        const responseJson = {
          nextState,
          criticalMissing: missing.critical,
          optionalMissing: missing.optional,
          structuralTypeMatch: match,
          skillId: plugin.id,
          extractionMode: draftPatch ? 'llm' : 'deterministic',
          ...buildDraftProgress(locale, missing.critical),
        };

        const stateUpdate: Partial<AgentState> = {};
        if (nextState) stateUpdate.draftState = nextState;
        if (match.key) stateUpdate.structuralTypeKey = match.key;

        logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, extra: { skillId: plugin.id, extractionMode: responseJson.extractionMode, criticalMissing: missing.critical.length } });
        return toolResult(
          toolCallId,
          'extract_draft_params',
          JSON.stringify(responseJson),
          stateUpdate,
        );
      } catch (error) {
        logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, success: false, extra: { error: error instanceof Error ? error.message : String(error) } });
        throw error;
      }
    },
    {
      name: 'extract_draft_params',
      description:
        'Extract structural engineering parameters from a user message and merge them into the draft state. ' +
        'Reads existing draft state from conversation state automatically — do NOT pass it as a parameter. ' +
        'Returns updated draft state, missing fields, and the matched structural type.',
      schema: z.object({
        message: z.string().describe('The user message to extract parameters from'),
        locale: z.enum(['zh', 'en']).optional().describe('User locale'),
      }),
    },
  );
}

export function createBuildModelTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (_input: Record<string, unknown>, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);

      // Read draft state from graph state channel
      const draftState = state?.draftState;
      if (!draftState) {
        throw new Error('No draft state available. Run extract_draft_params first.');
      }
      const skillIds = configurable.skillScope;

      const model = await skillRuntime.buildModel(draftState, skillIds, {
        message: state?.lastUserMessage || '',
        locale: state?.locale || 'zh',
      });
      if (!model) {
        logToolCall(log, { tool: 'build_model', durationMs: Date.now() - start, extra: { success: false } });
        throw new Error('Model build returned undefined — draft may be incomplete. Try running extract_draft_params again with more explicit parameters.');
      }

      // Store model in graph state via Command.
      // Keep ToolMessage content compact — full model lives in graph state.
      // The streaming layer reads model from nodeState for artifact_payload_sync.
      const summary = buildModelToolSummary(model, state?.locale || 'zh');
      const success = summary.success !== false;
      logToolCall(log, { tool: 'build_model', durationMs: Date.now() - start, success, extra: summary });
      return toolResult(
        toolCallId,
        'build_model',
        JSON.stringify(summary),
        buildModelToolStateUpdate(model, summary),
      );
    },
    {
      name: 'build_model',
      description:
        'Build a computable structural model from the current draft state. ' +
        'Reads draft state from conversation state automatically — do NOT pass it as a parameter. ' +
        'Returns the model if all critical parameters are present, or an error if the draft is incomplete.',
      schema: z.object({}),
    },
  );
}

export function createAskUserClarificationTool() {
  return tool(
    async (input: { question: string; optionsJson?: string }) => {
      const options = input.optionsJson
        ? JSON.parse(input.optionsJson) as string[]
        : undefined;

      const userResponse = interrupt({
        type: 'clarification_needed',
        question: input.question,
        options,
      }) as string;

      return JSON.stringify({
        type: 'clarification_answered',
        question: input.question,
        answer: userResponse,
      });
    },
    {
      name: 'ask_user_clarification',
      description:
        'Pause execution and ask the user a clarification question. ' +
        'Use this when you cannot proceed without user input. ' +
        'The graph will resume once the user provides an answer.',
      schema: z.object({
        question: z.string().describe('The question to ask the user'),
        optionsJson: z
          .string()
          .optional()
          .describe('JSON array of suggested answer options'),
      }),
    },
  );
}

export function createSetSessionConfigTool() {
  return tool(
    async (input: {
      analysisType?: string;
      designCode?: string;
      skillIdsJson?: string;
    }, config: LangGraphRunnableConfig) => {
      const state = getConfigurable(config).agentState;
      const toolCallId = getToolCallId(config);

      const updatedKeys: string[] = [];
      const stateUpdate: Partial<AgentState> = {};

      if (input.analysisType) {
        stateUpdate.policy = {
          ...(state?.policy || {}),
          analysisType: input.analysisType as 'static' | 'dynamic' | 'seismic' | 'nonlinear',
        };
        updatedKeys.push('analysisType');
      }
      if (input.designCode) {
        stateUpdate.policy = {
          ...(state?.policy || {}),
          ...(stateUpdate.policy || {}),
          designCode: input.designCode,
        };
        updatedKeys.push('designCode');
      }
      if (input.skillIdsJson) {
        stateUpdate.selectedSkillIds = JSON.parse(input.skillIdsJson) as string[];
        updatedKeys.push('selectedSkillIds');
      }

      const responseJson = {
        success: true,
        updatedKeys,
        message: `Updated: ${updatedKeys.join(', ') || 'nothing'}`,
      };

      // Only return Command if there are actual updates
      if (updatedKeys.length > 0) {
        return toolResult(toolCallId, 'set_session_config', JSON.stringify(responseJson), stateUpdate);
      }
      return JSON.stringify(responseJson);
    },
    {
      name: 'set_session_config',
      description:
        'Update current-session configuration: analysis type (static/dynamic/seismic/nonlinear), ' +
        'design code (GB50010/GB50011/GB50017), or selected skill IDs. ' +
        'This does not create persistent memory.',
      schema: z.object({
        analysisType: z
          .enum(['static', 'dynamic', 'seismic', 'nonlinear'])
          .optional()
          .describe('Analysis type to set'),
        designCode: z
          .string()
          .optional()
          .describe('Design code to set (e.g. GB50017)'),
        skillIdsJson: z
          .string()
          .optional()
          .describe('JSON array of skill IDs to select'),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Engineering execution tools (wrap AgentSkillRuntime execution methods)
// ---------------------------------------------------------------------------

export function createValidateModelTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: { engineId?: string }, config: LangGraphRunnableConfig) => {
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      // Read model from graph state channel
      const model = state?.model;
      if (!model) {
        return JSON.stringify({ error: 'No model available. Run build_model first.' });
      }
      const result = await skillRuntime.executeValidationSkill({
        model,
        engineId: input.engineId,
        structureProtocolClient: configurable.structureProtocolClient,
      });
      // Keep output compact — trim large model echo from validation result
      const compact: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
        if (k === 'input') {
          compact[k] = { model: '(model stored in state)' };
        } else {
          compact[k] = v;
        }
      }
      return JSON.stringify(compact);
    },
    {
      name: 'validate_model',
      description:
        'Validate the current structural model for correctness (connectivity, geometry, loads). ' +
        'Reads the model from conversation state automatically — do NOT pass it as a parameter. ' +
        'Returns validation errors and warnings.',
      schema: z.object({
        engineId: z.string().optional().describe('Optional analysis engine ID'),
      }),
    },
  );
}

export function createRunAnalysisTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: {
      analysisType: string;
    }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);

      // Read model from graph state channel
      const model = state?.model;
      if (!model) {
        return toolResult(toolCallId, 'run_analysis', JSON.stringify({ error: 'No model available. Run build_model first.' }));
      }
      const skillIds = configurable.skillScope;
      const analysisType = (input.analysisType || 'static') as 'static' | 'dynamic' | 'seismic' | 'nonlinear';
      const traceId = `lg-${Date.now()}`;

      const engineClient = configurable.engineClient;
      const postToEngineWithRetry = async (
        p: string,
        payload: Record<string, unknown>,
        opts: { retries: number; traceId: string; tool: 'run_analysis'; signal?: AbortSignal },
      ) => {
        let lastError: unknown;
        for (let attempt = 0; attempt <= opts.retries; attempt++) {
          try {
            return await engineClient.post(p, payload, { signal: opts.signal });
          } catch (error) {
            lastError = error;
            if (attempt === opts.retries) throw error;
          }
        }
        throw lastError;
      };

      // engineId is resolved by the selected analysis skill, not from LLM input
      const result = await skillRuntime.executeAnalysisSkill({
        traceId,
        analysisType,
        model,
        parameters: { traceId },
        skillIds,
        postToEngineWithRetry,
      });

      // Store analysis result in graph state via Command.
      // Keep ToolMessage content compact — the full data lives in graph state.
      // The streaming layer reads analysisResult from nodeState for artifact_payload_sync.
      const analysisSummary = buildAnalysisToolSummary({
        result: result.result,
        skillId: result.skillId,
      });
      const analysisSucceeded = analysisSummary.success !== false;
      logToolCall(log, {
        tool: 'run_analysis',
        durationMs: Date.now() - start,
        success: analysisSucceeded,
        extra: { analysisType, skillId: result.skillId, success: analysisSucceeded },
      });
      return toolResult(
        toolCallId,
        'run_analysis',
        JSON.stringify(analysisSummary),
        { analysisResult: result.result as Record<string, unknown> },
      );
    },
    {
      name: 'run_analysis',
      description:
        'Execute a structural analysis (static, dynamic, seismic, or nonlinear). ' +
        'Reads the model from conversation state automatically — do NOT pass it as a parameter. ' +
        'Returns analysis results including displacements, forces, and reactions. ' +
        'The analysis engine is resolved from the selected analysis skill automatically.',
      schema: z.object({
        analysisType: z
          .enum(['static', 'dynamic', 'seismic', 'nonlinear'])
          .describe('Type of analysis to perform'),
      }),
    },
  );
}

export function createRunCodeCheckTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: {
      designCode: string;
      engineId?: string;
    }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);
      const skillIds = configurable.skillScope;
      const selectedDesignCode = skillRuntime.resolveCodeCheckDesignCodeFromSkillIds(skillIds);
      const codeCheckSkillId = selectedDesignCode
        ? skillRuntime.resolveCodeCheckSkillId(selectedDesignCode)
        : undefined;
      if (!codeCheckSkillId) {
        const skipped = {
          skipped: true,
          reason: 'No code-check skill is selected in the current skill scope.',
        };
        logToolCall(log, { tool: 'run_code_check', durationMs: Date.now() - start, extra: { skipped: true, reason: skipped.reason } });
        return toolResult(toolCallId, 'run_code_check', JSON.stringify(skipped));
      }

      // Read model and analysis from graph state channels
      const model = state?.model;
      if (!model) {
        return toolResult(toolCallId, 'run_code_check', JSON.stringify({ error: 'No model available. Run build_model first.' }));
      }
      const analysis = state?.analysisResult;
      if (!analysis) {
        return toolResult(toolCallId, 'run_code_check', JSON.stringify({ error: 'No analysis results available. Run run_analysis first.' }));
      }
      const traceId = `lg-cc-${Date.now()}`;

      const result = await skillRuntime.executeCodeCheckSkill({
        codeCheckClient: configurable.codeCheckClient,
        traceId,
        designCode: selectedDesignCode || input.designCode || 'GB50017',
        model,
        analysis,
        analysisParameters: {},
        engineId: input.engineId,
        codeCheckSkillId,
      });

      // Store code check result in graph state via Command
      logToolCall(log, { tool: 'run_code_check', durationMs: Date.now() - start, extra: { designCode: input.designCode, skillId: result.skillId, success: true } });
      return toolResult(
        toolCallId,
        'run_code_check',
        JSON.stringify({ success: true, skillId: result.skillId }),
        { codeCheckResult: result.result as Record<string, unknown> },
      );
    },
    {
      name: 'run_code_check',
      description:
        'Run code compliance check against a design code (e.g. GB50017, GB50010, GB50011). ' +
        'Reads model and analysis results from conversation state automatically — do NOT pass them as parameters. ' +
        'Returns pass/fail status for each check.',
      schema: z.object({
        designCode: z
          .string()
          .describe('Design code to check against (GB50010, GB50011, GB50017, JGJ3)'),
        engineId: z.string().optional().describe('Optional engine ID'),
      }),
    },
  );
}

export function createGenerateReportTool(skillRuntime: AgentSkillRuntime) {
  return tool(
    async (input: {
      message: string;
      analysisType: string;
      locale?: string;
    }, config: LangGraphRunnableConfig) => {
      const log = getLogger(config.configurable as Partial<AgentConfigurable> | undefined);
      const start = Date.now();
      const configurable = getConfigurable(config);
      const state = configurable.agentState;
      const toolCallId = getToolCallId(config);

      // Read analysis, codeCheck, draftState from graph state channels
      const analysis = state?.analysisResult;
      if (!analysis) {
        return toolResult(toolCallId, 'generate_report', JSON.stringify({ error: 'No analysis results available. Run run_analysis first.' }));
      }
      const codeCheck = state?.codeCheckResult || undefined;
      const draftState = state?.draftState || undefined;
      const skillIds = configurable.skillScope;
      const locale = (input.locale === 'en' ? 'en' : (state?.locale || 'zh')) as 'zh' | 'en';
      const analysisType = (input.analysisType || 'static') as 'static' | 'dynamic' | 'seismic' | 'nonlinear';

      const result = await skillRuntime.executeReportSkill({
        message: input.message,
        analysisType,
        analysis,
        codeCheck,
        format: 'both',
        locale,
        draft: draftState,
        skillIds,
      });

      // For PKPM analysis, also generate the dedicated calculation book
      const analysisData = (analysis as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      const analysisMode = analysisData?.analysisMode as string | undefined;
      const isPkpm = analysisMode === 'pkpm-satwe'
        || (analysis as Record<string, unknown>)?.meta != null
          && typeof (analysis as Record<string, unknown>).meta === 'object'
          && ((analysis as Record<string, unknown>).meta as Record<string, unknown>)?.analysisAdapterKey === 'builtin-pkpm';
      if (isPkpm && analysisData?.summary) {
        const jwsPath = (analysisData.summary as Record<string, unknown>)?.jws_path as string | undefined;
        if (jwsPath) {
          try {
            const calcbook = await runPkpmCalcbook(jwsPath);
            if (calcbook) {
              if (calcbook.markdown && result.report.json) {
                const jsonReport = result.report.json as Record<string, unknown>;
                jsonReport.calcbookMarkdown = calcbook.markdown;
              }
              if (calcbook.summary?.pdf_path) {
                (result.report as Record<string, unknown>).pdfUrl = `/api/v1/files/serve?path=${encodeURIComponent(calcbook.summary.pdf_path)}`;
              }
            }
          } catch (err) {
            logger.warn({ err }, 'PKPM calcbook generation failed, skipping');
          }
        }
      }

      // Store report in graph state via Command
      logToolCall(log, { tool: 'generate_report', durationMs: Date.now() - start, extra: { analysisType, locale, success: true } });
      return toolResult(
        toolCallId,
        'generate_report',
        JSON.stringify({ success: true, summary: result.report.summary }),
        { report: result.report as unknown as Record<string, unknown> },
      );
    },
    {
      name: 'generate_report',
      description:
        'Generate an engineering report with summary, key metrics, and compliance narrative. ' +
        'Reads analysis results, code check results, and draft state from conversation state automatically — ' +
        'do NOT pass them as parameters. ' +
        'Requires run_analysis to have been called first.',
      schema: z.object({
        message: z.string().describe('Original user message / intent'),
        analysisType: z
          .enum(['static', 'dynamic', 'seismic', 'nonlinear'])
          .describe('Analysis type that was performed'),
        locale: z.enum(['zh', 'en']).optional().describe('Report language'),
      }),
    },
  );
}

