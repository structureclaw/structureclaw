import type { ToolManifest } from '../../agent-runtime/types.js';
import { buildCodeCheckInput, executeCodeCheckDomain } from '../../agent-skills/code-check/entry.js';
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
