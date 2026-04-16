import type { ToolManifest } from '../../agent-runtime/types.js';
import { localize } from './shared.js';

export const SYNTHESIZE_DESIGN_TOOL_MANIFEST: ToolManifest = {
  id: 'synthesize_design',
  source: 'builtin',
  enabledByDefault: false,
  category: 'modeling',
  displayName: localize('设计迭代优化', 'Design Iteration and Optimization'),
  description: localize('基于分析或校核结果迭代优化结构设计方案。', 'Iteratively optimize the structural design based on analysis or code-check results.'),
  requiresTools: ['run_analysis'],
  tags: ['design', 'iteration'],
  inputSchema: {
    type: 'object',
    required: ['normalizedModel'],
    properties: {
      normalizedModel: { type: 'object' },
      postprocessedResult: { type: 'object' },
      codeCheckResult: { type: 'object' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      proposedModel: { type: 'object' },
    },
  },
  errorCodes: ['DESIGN_EXECUTION_FAILED'],
};
