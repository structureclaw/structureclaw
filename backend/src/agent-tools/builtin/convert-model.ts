import type { ToolManifest } from '../../agent-runtime/types.js';
import { localize } from './shared.js';

type StructureProtocolClientLike = {
  post: (path: string, payload: Record<string, unknown>) => Promise<{ data: any }>;
};

export async function executeConvertModel(
  client: StructureProtocolClientLike,
  input: {
    model?: Record<string, unknown>;
    source_format: string;
    target_format: string;
    target_schema_version: string;
  },
): Promise<Record<string, unknown>> {
  const converted = await client.post('/convert', input);
  return (converted?.data ?? {}) as Record<string, unknown>;
}

export const CONVERT_MODEL_TOOL_MANIFEST: ToolManifest = {
  id: 'convert_model',
  source: 'builtin',
  enabledByDefault: false,
  category: 'modeling',
  displayName: localize('转换结构模型', 'Convert Structural Model'),
  description: localize('在支持的结构协议格式之间转换模型。', 'Convert a structural model between supported protocol formats.'),
  tags: ['convert_model', 'model', 'protocol'],
  inputSchema: {
    type: 'object',
    required: ['model'],
    properties: {
      model: { type: 'object' },
      source_format: { type: 'string' },
      target_format: { type: 'string' },
      target_schema_version: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      sourceFormat: { type: 'string' },
      targetFormat: { type: 'string' },
      sourceSchemaVersion: { type: 'string' },
      targetSchemaVersion: { type: 'string' },
      model: { type: 'object' },
    },
  },
  errorCodes: ['UNSUPPORTED_SOURCE_FORMAT', 'UNSUPPORTED_TARGET_FORMAT', 'INVALID_STRUCTURE_MODEL'],
};
