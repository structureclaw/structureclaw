import type { ToolManifest } from '../../agent-runtime/types.js';
import { localize } from './shared.js';

export const DRAFT_MODEL_TOOL_MANIFEST: ToolManifest = {
  id: 'draft_model',
  source: 'builtin',
  enabledByDefault: false,
  category: 'modeling',
  displayName: localize('草拟结构模型', 'Draft Structural Model'),
  description: localize('从文本和补充参数生成或更新可计算结构模型草稿。', 'Generate or update a computable structural model draft from text and provided parameters.'),
  tags: ['draft', 'model', 'structure-type'],
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
