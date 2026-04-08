import type { ToolManifest } from '../../agent-runtime/types.js';
import type { AppLocale } from '../../services/locale.js';
import type { AgentRunResult, AgentToolCall, AgentToolName } from '../../services/agent.js';
import { localize } from './shared.js';

export async function executeValidateModel(
  input: {
    runValidate: () => Promise<Record<string, unknown>>;
  },
): Promise<Record<string, unknown>> {
  return input.runValidate();
}

export async function executeValidateModelStep(args: {
  locale: AppLocale;
  model: Record<string, unknown>;
  engineId?: string;
  autoAnalyze: boolean;
  wasGeneratedThisTurn: boolean;
  plan: string[];
  toolCalls: AgentToolCall[];
  localize: (locale: AppLocale, zh: string, en: string) => string;
  loggerWarn: (meta: Record<string, unknown>, message: string) => void;
  startToolCall: (tool: AgentToolName, input: Record<string, unknown>) => AgentToolCall;
  completeToolCallSuccess: (call: AgentToolCall, output?: unknown) => void;
  completeToolCallError: (call: AgentToolCall, error: unknown) => void;
  shouldBypassValidateFailure: (error: unknown) => boolean;
  buildBlockedResult: (response: string) => Promise<AgentRunResult>;
  buildGeneratedModelValidationClarification: (validationError: string) => Promise<AgentRunResult>;
  traceId: string;
  runValidate: () => Promise<{ input: { model: Record<string, unknown> }; result: Record<string, unknown> }>;
}): Promise<{ ok: true; normalizedModel: Record<string, unknown>; validationWarning?: string } | { ok: false; result: AgentRunResult }> {
  args.plan.push(args.localize(args.locale, '校验模型字段与引用完整性', 'Validate model fields and references'));
  const validateInput = { model: args.model };
  const validateCall = args.startToolCall('validate_model', validateInput);
  args.toolCalls.push(validateCall);

  try {
    const validationExecution = await executeValidateModel({
      runValidate: async () => {
        const result = await args.runValidate();
        validateCall.input = result.input;
        return result.result;
      },
    });
    args.completeToolCallSuccess(validateCall, validationExecution);
    if (validationExecution?.valid === false) {
      validateCall.status = 'error';
      validateCall.errorCode = typeof validationExecution?.errorCode === 'string' ? validationExecution.errorCode : 'INVALID_STRUCTURE_MODEL';
      validateCall.error = typeof validationExecution?.message === 'string'
        ? validationExecution.message
        : args.localize(args.locale, '模型校验失败', 'Model validation failed');
      if (args.wasGeneratedThisTurn) {
        return {
          ok: false,
          result: await args.buildGeneratedModelValidationClarification(
            validateCall.error || args.localize(args.locale, '模型校验失败', 'Model validation failed'),
          ),
        };
      }
      return {
        ok: false,
        result: await args.buildBlockedResult(
          args.localize(args.locale, `模型校验失败：${validateCall.error}`, `Model validation failed: ${validateCall.error}`),
        ),
      };
    }
    return { ok: true, normalizedModel: args.model };
  } catch (error: any) {
    args.completeToolCallError(validateCall, error);
    if (args.autoAnalyze && args.shouldBypassValidateFailure(error)) {
      const validationWarning = args.localize(
        args.locale,
        `模型校验服务暂时不可用，已跳过 \`validate_model\` 并继续执行 \`run_analysis\`：${validateCall.error}`,
        `The model validation service is temporarily unavailable. \`validate_model\` was skipped and \`run_analysis\` will continue: ${validateCall.error}`,
      );
      args.plan.push(args.localize(args.locale, '校验服务不可用，跳过 `validate_model` 并继续执行 `run_analysis`', 'Validation service unavailable; skip `validate_model` and continue with `run_analysis`'));
      args.loggerWarn({ traceId: args.traceId, validationError: validateCall.error }, '`validate_model` failed with an upstream error; continuing with `run_analysis`');
      return {
        ok: true,
        normalizedModel: args.model,
        validationWarning,
      };
    }
    if (args.wasGeneratedThisTurn) {
      return {
        ok: false,
        result: await args.buildGeneratedModelValidationClarification(
          validateCall.error || args.localize(args.locale, '模型校验失败', 'Model validation failed'),
        ),
      };
    }
    return {
      ok: false,
      result: await args.buildBlockedResult(
        args.localize(args.locale, `模型校验失败：${validateCall.error}`, `Model validation failed: ${validateCall.error}`),
      ),
    };
  }
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
