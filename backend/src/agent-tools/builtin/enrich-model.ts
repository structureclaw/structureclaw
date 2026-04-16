import type { ToolManifest } from '../../agent-runtime/types.js';
import { localize } from './shared.js';

export const ENRICH_MODEL_TOOL_MANIFEST: ToolManifest = {
  id: 'enrich_model',
  source: 'builtin',
  enabledByDefault: false,
  category: 'modeling',
  displayName: localize('丰富结构模型', 'Enrich Structural Model'),
  description: localize('通过技能插件（截面、材料、荷载边界）丰富结构模型字段。', 'Enrich the structural model fields via skill plugins (section, material, load-boundary).'),
  tags: ['enrich', 'modeling'],
  inputSchema: {
    type: 'object',
    required: ['normalizedModel'],
    properties: {
      normalizedModel: { type: 'object' },
      skillId: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      enrichedModel: { type: 'object' },
      patches: { type: 'array' },
    },
  },
  errorCodes: ['ENRICH_EXECUTION_FAILED'],
};
