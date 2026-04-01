import type { ToolManifest } from '../../agent-runtime/types.js';
import { localize } from './shared.js';

export const UPDATE_MODEL_TOOL_MANIFEST: ToolManifest = {
  id: 'update_model',
  source: 'builtin',
  enabledByDefault: false,
  category: 'modeling',
  displayName: localize('更新结构模型', 'Update Structural Model'),
  description: localize('基于现有会话中的结构模型与参数，对几何、荷载、材料、截面和边界条件进行增量更新。', 'Apply incremental updates to geometry, loads, materials, sections, and boundary conditions based on the existing structural model context.'),
  tags: ['update', 'model', 'structure-type'],
  inputSchema: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string' },
      conversationId: { type: 'string' },
      phase: { enum: ['interactive', 'execution'] },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      inferredType: { type: 'string' },
      missingFields: { type: 'array', items: { type: 'string' } },
      extractionMode: { enum: ['llm', 'deterministic'] },
      model: { type: 'object' },
    },
  },
  errorCodes: ['AGENT_MISSING_MODEL_INPUT'],
};
