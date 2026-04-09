import type { ToolManifest } from '../../agent-runtime/types.js';
import type { AppLocale } from '../../services/locale.js';
import type { AgentRunResult, AgentToolCall, AgentToolName } from '../../services/agent.js';
import { localize } from './shared.js';

export async function executeRunAnalysis(
  args: {
    input: {
      type: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
      engineId?: string;
      model: Record<string, unknown>;
      parameters: Record<string, unknown>;
    };
    runAnalysis: () => Promise<Record<string, unknown>>;
  },
): Promise<Record<string, unknown>> {
  return args.runAnalysis();
}

export async function executeRunAnalysisStep(args: {
  traceId: string;
  locale: AppLocale;
  analysisType: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
  engineId?: string;
  model: Record<string, unknown>;
  parameters: Record<string, unknown>;
  plan: string[];
  toolCalls: AgentToolCall[];
  localize: (locale: AppLocale, zh: string, en: string) => string;
  startToolCall: (tool: AgentToolName, input: Record<string, unknown>) => AgentToolCall;
  completeToolCallSuccess: (call: AgentToolCall, output?: unknown) => void;
  completeToolCallError: (call: AgentToolCall, error: unknown) => void;
  shouldRetryEngineCall: (error: unknown) => boolean;
  buildBlockedResult: (response: string) => Promise<AgentRunResult>;
  runAnalysis: (input: {
    type: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
    engineId?: string;
    model: Record<string, unknown>;
    parameters: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
}): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; result: AgentRunResult }> {
  args.plan.push(args.localize(args.locale, `执行 ${args.analysisType} 分析并返回摘要`, `Run ${args.analysisType} analysis and return a summary`));
  const analyzeInput = {
    type: args.analysisType,
    engineId: args.engineId,
    model: args.model,
    parameters: args.parameters,
  };
  const analyzeCall = args.startToolCall('run_analysis', analyzeInput);
  args.toolCalls.push(analyzeCall);

  try {
    const analyzed = await executeRunAnalysis({
      input: analyzeInput,
      runAnalysis: () => args.runAnalysis(analyzeInput),
    });
    args.completeToolCallSuccess(analyzeCall, analyzed);
    return { ok: true, data: analyzed };
  } catch (error: any) {
    args.completeToolCallError(analyzeCall, error);
    const transientUpstreamFailure = args.shouldRetryEngineCall(error);
    const response = transientUpstreamFailure
      ? args.localize(
        args.locale,
        `分析引擎服务暂时不可用，重试后仍失败：${analyzeCall.error}`,
        `The analysis engine is temporarily unavailable and still failed after retry: ${analyzeCall.error}`,
      )
      : args.localize(args.locale, `分析执行失败：${analyzeCall.error}`, `Analysis execution failed: ${analyzeCall.error}`);
    return {
      ok: false,
      result: await args.buildBlockedResult(response),
    };
  }
}

export const RUN_ANALYSIS_TOOL_MANIFEST: ToolManifest = {
  id: 'run_analysis',
  source: 'builtin',
  enabledByDefault: false,
  category: 'analysis',
  displayName: localize('执行结构分析', 'Run Structural Analysis'),
  description: localize('执行结构分析（static/dynamic/seismic/nonlinear）。', 'Execute structural analysis (static, dynamic, seismic, or nonlinear).'),
  tags: ['analysis', 'engine'],
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
  requiresTools: ['validate_model'],
  errorCodes: ['INVALID_ANALYSIS_TYPE', 'ANALYSIS_EXECUTION_FAILED'],
};
