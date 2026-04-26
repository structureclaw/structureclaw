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
        logToolCall(log, { tool: 'detect_structure_type', durationMs: Date.now() - start, level: 'info', extra: { error: error instanceof Error ? error.message : String(error) } });
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
        logToolCall(log, { tool: 'extract_draft_params', durationMs: Date.now() - start, extra: { error: error instanceof Error ? error.message : String(error) } });
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
      const nodeCount = Array.isArray(model.nodes) ? model.nodes.length : 0;
      const elementCount = Array.isArray(model.elements) ? model.elements.length : 0;
      logToolCall(log, { tool: 'build_model', durationMs: Date.now() - start, extra: { success: true, nodeCount, elementCount, schemaVersion: model.schema_version } });
      return toolResult(
        toolCallId,
        'build_model',
        JSON.stringify({ success: true, nodeCount, elementCount, schemaVersion: model.schema_version }),
        { model },
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
        parameters: {},
        skillIds,
        postToEngineWithRetry,
      });

      // Store analysis result in graph state via Command.
      // Keep ToolMessage content compact — the full data lives in graph state.
      // The streaming layer reads analysisResult from nodeState for artifact_payload_sync.
      const analysisSummary = typeof result.result === 'object' && result.result !== null
        ? { success: true, skillId: result.skillId, analysisMode: (result.result as Record<string, unknown>)?.data
            ? ((result.result as Record<string, unknown>).data as Record<string, unknown>)?.analysisMode
            : undefined }
        : { success: true, skillId: result.skillId };
      logToolCall(log, { tool: 'run_analysis', durationMs: Date.now() - start, extra: { analysisType, skillId: result.skillId, success: true } });
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
        designCode: input.designCode || 'GB50017',
        model,
        analysis,
        analysisParameters: {},
        engineId: input.engineId,
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

