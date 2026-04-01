import type { ToolManifest } from '../../agent-runtime/types.js';
import { localize } from './shared.js';

type StructureProtocolClientLike = {
  post: (path: string, payload: Record<string, unknown>) => Promise<{ data: any }>;
};

export async function executeValidateModel(
  client: StructureProtocolClientLike,
  input: {
    model: Record<string, unknown>;
    engineId?: string;
  },
): Promise<Record<string, unknown>> {
  const validated = await client.post('/validate', {
    model: input.model,
    engineId: input.engineId,
  });
  return (validated?.data ?? {}) as Record<string, unknown>;
}

export const VALIDATE_MODEL_TOOL_MANIFEST: ToolManifest = {
  id: 'validate_model',
  source: 'builtin',
  enabledByDefault: false,
  category: 'modeling',
  displayName: localize('校验结构模型', 'Validate Structural Model'),
  description: localize('校验结构模型字段合法性与引用完整性。', 'Validate the structural model fields and reference integrity.'),
  tags: ['validate_model', 'model'],
  inputSchema: {
    type: 'object',
    required: ['model'],
    properties: {
      model: { type: 'object' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      valid: { type: 'boolean' },
      schemaVersion: { type: 'string' },
      stats: { type: 'object' },
    },
  },
  errorCodes: ['INVALID_STRUCTURE_MODEL'],
};
