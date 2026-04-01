import type { ToolManifest } from '../../agent-runtime/types.js';
import { localize } from './shared.js';

type PostToEngineWithRetry = (
  path: string,
  input: Record<string, unknown>,
  options: { retries: number; traceId: string; tool: 'run_analysis' },
) => Promise<{ data: any }>;

export async function executeRunAnalysis(
  postToEngineWithRetry: PostToEngineWithRetry,
  args: {
    traceId: string;
    input: {
      type: 'static' | 'dynamic' | 'seismic' | 'nonlinear';
      engineId?: string;
      model: Record<string, unknown>;
      parameters: Record<string, unknown>;
    };
  },
): Promise<Record<string, unknown>> {
  const analyzed = await postToEngineWithRetry('/analyze', args.input, {
    retries: 2,
    traceId: args.traceId,
    tool: 'run_analysis',
  });
  return (analyzed?.data ?? {}) as Record<string, unknown>;
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
