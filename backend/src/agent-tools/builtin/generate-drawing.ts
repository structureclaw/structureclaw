import type { ToolManifest } from '../../agent-runtime/types.js';
import { localize } from './shared.js';

export const GENERATE_DRAWING_TOOL_MANIFEST: ToolManifest = {
  id: 'generate_drawing',
  source: 'builtin',
  enabledByDefault: false,
  category: 'drawing',
  displayName: localize('生成结构图纸', 'Generate Structural Drawings'),
  description: localize('根据结构模型和分析结果生成结构图纸。', 'Generate structural drawings from the model and analysis results.'),
  requiresTools: ['run_analysis'],
  tags: ['drawing', 'deliverable'],
  inputSchema: {
    type: 'object',
    required: ['model'],
    properties: {
      model: { type: 'object' },
      analysisResults: { type: 'object' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      drawingArtifact: { type: 'object' },
    },
  },
  errorCodes: ['DRAWING_EXECUTION_FAILED'],
};
