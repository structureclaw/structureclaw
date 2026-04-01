import type { ToolManifest } from '../../agent-runtime/types.js';
import type { AppLocale } from '../../services/locale.js';
import type { AgentRunResult, AgentToolCall, AgentToolName } from '../../services/agent.js';
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

export async function executeConvertModelStep(args: {
  locale: AppLocale;
  sourceFormat: string;
  modelInput?: Record<string, unknown>;
  plan: string[];
  toolCalls: AgentToolCall[];
  localize: (locale: AppLocale, zh: string, en: string) => string;
  startToolCall: (tool: AgentToolName, input: Record<string, unknown>) => AgentToolCall;
  completeToolCallSuccess: (call: AgentToolCall, output?: unknown) => void;
  completeToolCallError: (call: AgentToolCall, error: unknown) => void;
  buildBlockedResult: (response: string) => Promise<AgentRunResult>;
  structureProtocolClient: StructureProtocolClientLike;
}): Promise<{ ok: true; normalizedModel: Record<string, unknown> } | { ok: false; result: AgentRunResult }> {
  args.plan.push(args.localize(args.locale, `将输入模型从 ${args.sourceFormat} 转为 structuremodel-v1`, `Convert the input model from ${args.sourceFormat} to structuremodel-v1`));
  const convertInput = {
    model: args.modelInput,
    source_format: args.sourceFormat,
    target_format: 'structuremodel-v1',
    target_schema_version: '1.0.0',
  };
  const convertCall = args.startToolCall('convert_model', convertInput);
  args.toolCalls.push(convertCall);

  try {
    const converted = await executeConvertModel(args.structureProtocolClient, convertInput);
    args.completeToolCallSuccess(convertCall, converted);
    return {
      ok: true,
      normalizedModel: (converted?.model ?? {}) as Record<string, unknown>,
    };
  } catch (error: any) {
    args.completeToolCallError(convertCall, error);
    return {
      ok: false,
      result: await args.buildBlockedResult(
        args.localize(args.locale, `模型格式转换失败：${convertCall.error}`, `Model conversion failed: ${convertCall.error}`),
      ),
    };
  }
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
