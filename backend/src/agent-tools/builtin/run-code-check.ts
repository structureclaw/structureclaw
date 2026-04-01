import type { ToolManifest } from '../../agent-runtime/types.js';
import { buildCodeCheckInput, executeCodeCheckDomain } from '../../agent-skills/code-check/entry.js';
import type { AppLocale } from '../../services/locale.js';
import type { AgentRunResult, AgentToolCall, AgentToolName } from '../../services/agent.js';
import { localize } from './shared.js';

export async function executeRunCodeCheck(args: {
  codeCheckClient: unknown;
  traceId: string;
  designCode: string;
  model: Record<string, unknown>;
  analysis: unknown;
  analysisParameters: Record<string, unknown>;
  codeCheckElements?: string[];
  engineId?: string;
}): Promise<{ input: Record<string, unknown>; result: unknown }> {
  const input = buildCodeCheckInput({
    traceId: args.traceId,
    designCode: args.designCode,
    model: args.model,
    analysis: args.analysis,
    analysisParameters: args.analysisParameters,
    codeCheckElements: args.codeCheckElements,
  });
  const result = await executeCodeCheckDomain(args.codeCheckClient as any, input, args.engineId);
  return {
    input,
    result,
  };
}

export async function executeRunCodeCheckStep(args: {
  locale: AppLocale;
  localize: (locale: AppLocale, zh: string, en: string) => string;
  plan: string[];
  toolCalls: AgentToolCall[];
  startToolCall: (tool: AgentToolName, input: Record<string, unknown>) => AgentToolCall;
  completeToolCallSuccess: (call: AgentToolCall, output?: unknown) => void;
  completeToolCallError: (call: AgentToolCall, error: unknown) => void;
  buildBlockedResult: (response: string) => Promise<AgentRunResult>;
  codeCheckClient: unknown;
  traceId: string;
  designCode: string;
  model: Record<string, unknown>;
  analysis: unknown;
  analysisParameters: Record<string, unknown>;
  codeCheckElements?: string[];
  engineId?: string;
}): Promise<{ ok: true; value: unknown } | { ok: false; result: AgentRunResult }> {
  args.plan.push(args.localize(args.locale, `执行 ${args.designCode} 规范校核`, `Run ${args.designCode} code checks`));
  const codeCheckCall = args.startToolCall('run_code_check', {
    traceId: args.traceId,
    designCode: args.designCode,
    model: args.model,
    analysis: args.analysis,
    analysisParameters: args.analysisParameters,
    codeCheckElements: args.codeCheckElements,
  });
  args.toolCalls.push(codeCheckCall);

  try {
    const codeCheckExecution = await executeRunCodeCheck({
      codeCheckClient: args.codeCheckClient,
      traceId: args.traceId,
      designCode: args.designCode,
      model: args.model,
      analysis: args.analysis,
      analysisParameters: args.analysisParameters,
      codeCheckElements: args.codeCheckElements,
      engineId: args.engineId,
    });
    codeCheckCall.input = codeCheckExecution.input;
    const codeChecked = codeCheckExecution.result;
    args.completeToolCallSuccess(codeCheckCall, codeChecked);
    return { ok: true, value: codeChecked };
  } catch (error: any) {
    args.completeToolCallError(codeCheckCall, error);
    return {
      ok: false,
      result: await args.buildBlockedResult(
        args.localize(args.locale, `规范校核失败：${codeCheckCall.error}`, `Code check failed: ${codeCheckCall.error}`),
      ),
    };
  }
}

export const RUN_CODE_CHECK_TOOL_MANIFEST: ToolManifest = {
  id: 'run_code_check',
  source: 'builtin',
  enabledByDefault: false,
  category: 'code-check',
  displayName: localize('执行规范校核', 'Run Code Check'),
  description: localize('结构规范校核。', 'Run structural code checks.'),
  tags: ['run_code_check', 'design-code'],
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
  requiresTools: ['run_analysis'],
  errorCodes: ['CODE_CHECK_EXECUTION_FAILED'],
};
