import type { ChatOpenAI } from '@langchain/openai';
import type { AppLocale } from './locale.js';
import type { AgentRunResult, AgentToolCall, AgentToolName } from './agent.js';
import { executeValidateModelStep } from '../agent-tools/builtin/validate-model.js';
import { logger } from '../utils/logger.js';

interface ValidationDeps {
  locale: AppLocale;
  engineId?: string;
  autoAnalyze: boolean;
  plan: string[];
  toolCalls: AgentToolCall[];
  traceId: string;
  llm: ChatOpenAI | null;
  localize: (locale: AppLocale, zh: string, en: string) => string;
  loggerWarn: (meta: Record<string, unknown>, message: string) => void;
  startToolCall: (tool: AgentToolName, input: Record<string, unknown>) => AgentToolCall;
  completeToolCallSuccess: (call: AgentToolCall, output?: unknown) => void;
  completeToolCallError: (call: AgentToolCall, error: unknown) => void;
  shouldBypassValidateFailure: (error: unknown) => boolean;
  buildBlockedResult: (response: string) => Promise<AgentRunResult>;
  buildGeneratedModelValidationClarification: (validationError: string) => Promise<AgentRunResult>;
  runValidate: (model: Record<string, unknown>) => Promise<{ input: { model: Record<string, unknown> }; result: Record<string, unknown> }>;
}

export async function tryRepairModel(
  llm: ChatOpenAI | null,
  model: Record<string, unknown>,
  validationError: string,
  locale: AppLocale,
): Promise<Record<string, unknown> | null> {
  if (!llm) {
    return null;
  }

  const prompt = [
    'You are a structural model repair assistant for StructureClaw.',
    'The following StructureModel v1 JSON failed validation.',
    'Fix the errors while preserving the intended structure.',
    'Return ONLY valid JSON with no additional commentary.',
    '',
    `Validation error: ${validationError}`,
    '',
    `Model JSON:\n${JSON.stringify(model, null, 2)}`,
    '',
    locale === 'zh'
      ? '修复后直接输出 JSON，不要加任何说明。'
      : 'Output the repaired JSON only, with no commentary.',
  ].join('\n');

  try {
    const aiMessage = await llm.invoke(prompt);
    const raw = typeof aiMessage.content === 'string'
      ? aiMessage.content
      : JSON.stringify(aiMessage.content);

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1]?.trim() || raw.trim();
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      return null;
    }
    const repaired = JSON.parse(candidate.slice(start, end + 1));
    if (repaired && typeof repaired === 'object') {
      return repaired as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export async function validateWithRetry(
  model: Record<string, unknown>,
  wasGeneratedThisTurn: boolean,
  deps: ValidationDeps,
  maxRetries = 2,
): Promise<
  | { ok: true; model: Record<string, unknown>; warning?: string }
  | { ok: false; result: AgentRunResult }
> {
  let currentModel = model;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const isRetry = attempt > 0;
    if (isRetry) {
      deps.plan.push(
        deps.localize(
          deps.locale,
          `自动修复尝试 ${attempt}/${maxRetries}`,
          `Auto-repair attempt ${attempt}/${maxRetries}`,
        ),
      );
    }

    const step = await executeValidateModelStep({
      locale: deps.locale,
      model: currentModel,
      engineId: deps.engineId,
      autoAnalyze: deps.autoAnalyze,
      wasGeneratedThisTurn,
      plan: deps.plan,
      toolCalls: deps.toolCalls,
      localize: deps.localize,
      loggerWarn: deps.loggerWarn,
      startToolCall: deps.startToolCall,
      completeToolCallSuccess: deps.completeToolCallSuccess,
      completeToolCallError: deps.completeToolCallError,
      shouldBypassValidateFailure: deps.shouldBypassValidateFailure,
      buildBlockedResult: deps.buildBlockedResult,
      buildGeneratedModelValidationClarification: deps.buildGeneratedModelValidationClarification,
      traceId: deps.traceId,
      runValidate: () => deps.runValidate(currentModel),
    });

    if (step.ok) {
      return { ok: true, model: step.normalizedModel, warning: step.validationWarning };
    }

    if (!wasGeneratedThisTurn || attempt >= maxRetries) {
      return { ok: false, result: step.result };
    }

    const lastValidateCall = [...deps.toolCalls].reverse().find((c) => c.tool === 'validate_model');
    const validationError = lastValidateCall?.error || 'Validation failed';

    logger.info(
      { traceId: deps.traceId, attempt: attempt + 1, maxRetries },
      'Attempting LLM-driven model repair after validation failure',
    );

    const repaired = await tryRepairModel(deps.llm, currentModel, validationError, deps.locale);
    if (!repaired) {
      return { ok: false, result: step.result };
    }

    currentModel = repaired;
  }

  return {
    ok: false,
    result: await deps.buildBlockedResult(
      deps.localize(deps.locale, '模型自动修复失败', 'Automatic model repair failed'),
    ),
  };
}
