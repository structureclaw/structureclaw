import type { ToolManifest } from '../../agent-runtime/types.js';
import { localize } from './shared.js';

export const POSTPROCESS_RESULT_TOOL_MANIFEST: ToolManifest = {
  id: 'postprocess_result',
  source: 'builtin',
  enabledByDefault: false,
  category: 'analysis',
  displayName: localize('后处理分析结果', 'Postprocess Analysis Results'),
  description: localize('对原始分析结果进行后处理，生成组合工况包络、位移摘要等。', 'Postprocess raw analysis results into load combination envelopes, displacement summaries, etc.'),
  requiresTools: ['run_analysis'],
  tags: ['postprocess', 'analysis'],
  inputSchema: {
    type: 'object',
    required: ['analysisRaw'],
    properties: {
      analysisRaw: { type: 'object' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      postprocessedResult: { type: 'object' },
    },
  },
  errorCodes: ['POSTPROCESS_EXECUTION_FAILED'],
};
