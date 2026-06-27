import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI, ChatOpenAICompletions } from '@langchain/openai';
import type { config } from '../config/index.js';
import { getEffectiveLlmSettings, getEffectiveVisionLlmSettings } from '../config/llm-runtime.js';
import { llmCallLogger } from './llm-logger.js';
import { logger, logLlmCall } from './agent-logger.js';

export type StructureClawChatModel = BaseChatModel & {
  bindTools: NonNullable<BaseChatModel['bindTools']>;
};

export type LlmProvider = 'openai-compatible' | 'anthropic';

type ChatModelConfigLike = Pick<
  typeof config,
  'llmApiKey' | 'llmModel' | 'llmTimeoutMs' | 'llmMaxRetries' | 'llmBaseUrl'
>;

export interface ChatModelRuntimeOptions {
  disableStreaming?: boolean;
}

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function normalizeProviderName(rawValue: string | undefined): LlmProvider | undefined {
  const normalized = rawValue?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['anthropic', 'claude'].includes(normalized)) return 'anthropic';
  if (['openai', 'openai-compatible', 'openai_compatible', 'compatible'].includes(normalized)) {
    return 'openai-compatible';
  }
  return undefined;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function isClaudeModel(modelName: string | undefined): boolean {
  const normalized = modelName?.trim().toLowerCase();
  return !!normalized && (normalized === 'claude' || normalized.startsWith('claude-'));
}

function isDefaultOpenAIBaseUrl(baseUrl: string | undefined): boolean {
  const normalized = baseUrl?.trim();
  return !normalized || withoutTrailingSlash(normalized).toLowerCase() === OPENAI_DEFAULT_BASE_URL;
}

function isAnthropicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'anthropic.com' || normalized.endsWith('.anthropic.com');
}

function isAnthropicNativeBaseUrl(baseUrl: string | undefined): boolean {
  const normalized = baseUrl?.trim();
  if (!normalized || isDefaultOpenAIBaseUrl(normalized)) return false;
  try {
    const parsed = new URL(normalized);
    return isAnthropicHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function normalizeAnthropicBaseUrl(baseUrl: string | undefined): string | undefined {
  const normalized = baseUrl?.trim();
  if (!normalized || isDefaultOpenAIBaseUrl(normalized)) return undefined;
  try {
    const parsed = new URL(normalized);
    const normalizedPath = withoutTrailingSlash(parsed.pathname);
    if (normalizedPath === '/v1') {
      parsed.pathname = '';
    } else if (normalizedPath.toLowerCase().endsWith('/v1')) {
      parsed.pathname = normalizedPath.slice(0, -3) || '';
    }
    return withoutTrailingSlash(parsed.toString());
  } catch {
    return withoutTrailingSlash(normalized);
  }
}

export function resolveLlmProvider(
  modelConfig: ChatModelConfigLike,
  providerOverride: string | undefined = process.env.LLM_PROVIDER,
): LlmProvider {
  const explicit = normalizeProviderName(providerOverride);
  if (explicit) return explicit;

  if (isClaudeModel(modelConfig.llmModel) || isAnthropicNativeBaseUrl(modelConfig.llmBaseUrl)) {
    return 'anthropic';
  }

  return 'openai-compatible';
}

function envListMatchesModel(rawValue: string | undefined, modelName: string | undefined): boolean {
  const raw = rawValue?.trim().toLowerCase();
  if (!raw) return false;

  const normalizedModel = modelName?.trim().toLowerCase() ?? '';
  if (!normalizedModel) return false;

  if (['1', 'true', 'yes', 'on', '*', 'all'].includes(raw)) return true;

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .some((item) => normalizedModel === item || normalizedModel.startsWith(`${item}-`));
}

export function shouldOmitTemperature(modelName: string | undefined): boolean {
  return envListMatchesModel(process.env.LLM_OMIT_TEMPERATURE_MODELS, modelName);
}

export function buildChatModelOptions(
  modelConfig: ChatModelConfigLike,
  temperature: number,
  runtimeOptions: ChatModelRuntimeOptions = {},
) {
  const disableStreaming = runtimeOptions.disableStreaming ?? false;
  const options = {
    modelName: modelConfig.llmModel,
    timeout: modelConfig.llmTimeoutMs,
    maxRetries: modelConfig.llmMaxRetries,
    apiKey: modelConfig.llmApiKey,
    disableStreaming,
    ...(disableStreaming ? { streaming: false } : {}),
    configuration: {
      baseURL: modelConfig.llmBaseUrl,
    },
  };

  return shouldOmitTemperature(modelConfig.llmModel)
    ? options
    : { ...options, temperature };
}

export function buildAnthropicChatModelOptions(
  modelConfig: ChatModelConfigLike,
  temperature: number,
  runtimeOptions: ChatModelRuntimeOptions = {},
) {
  const disableStreaming = runtimeOptions.disableStreaming ?? false;
  const anthropicApiUrl = normalizeAnthropicBaseUrl(modelConfig.llmBaseUrl);
  const options = {
    model: modelConfig.llmModel,
    apiKey: modelConfig.llmApiKey,
    maxRetries: modelConfig.llmMaxRetries,
    disableStreaming,
    ...(disableStreaming ? { streaming: false } : {}),
    ...(anthropicApiUrl ? { anthropicApiUrl } : {}),
    clientOptions: {
      timeout: modelConfig.llmTimeoutMs,
    },
  };

  return shouldOmitTemperature(modelConfig.llmModel)
    ? options
    : { ...options, temperature };
}

type ChatCompletionRequestLike = {
  model?: string;
  messages?: unknown[];
  [key: string]: unknown;
};

type ReasoningValue = string | null;
const SOURCE_MESSAGES_OPTION_KEY = '__structureClawSourceMessages';

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function isDeepSeekV4Model(modelName: string | undefined): boolean {
  return typeof modelName === 'string' && modelName.toLowerCase().includes('deepseek-v4');
}

function getMessageType(message: unknown): string | undefined {
  if (message && typeof message === 'object' && typeof (message as { _getType?: unknown })._getType === 'function') {
    return ((message as { _getType: () => string })._getType)();
  }
  const plain = message as { role?: unknown; type?: unknown } | null;
  if (typeof plain?.role === 'string') return plain.role === 'assistant' ? 'ai' : plain.role;
  if (typeof plain?.type === 'string') return plain.type;
  return undefined;
}

function getReasoningContent(message: unknown): ReasoningValue | undefined {
  const additionalKwargs = (message as { additional_kwargs?: unknown } | null)?.additional_kwargs;
  if (!additionalKwargs || typeof additionalKwargs !== 'object' || Array.isArray(additionalKwargs)) {
    return undefined;
  }
  const record = additionalKwargs as Record<string, unknown>;
  if (!hasOwn(record, 'reasoning_content')) return undefined;
  const reasoningContent = record.reasoning_content;
  return typeof reasoningContent === 'string' || reasoningContent === null ? reasoningContent : undefined;
}

export function attachDeepSeekReasoningContent(
  request: ChatCompletionRequestLike,
  sourceMessages: unknown[] | null,
): ChatCompletionRequestLike {
  if (!sourceMessages || !Array.isArray(request.messages)) return request;

  const reasoningByAssistant = sourceMessages
    .filter((message) => getMessageType(message) === 'ai')
    .map((message) => getReasoningContent(message));
  const requestAssistantCount = request.messages
    .filter((message) => message && typeof message === 'object' && (message as { role?: unknown }).role === 'assistant')
    .length;

  if (requestAssistantCount !== reasoningByAssistant.length) return request;

  if (!reasoningByAssistant.some((value) => value !== undefined)) return request;

  let assistantIndex = 0;
  let changed = false;
  const messages = request.messages.map((message) => {
    if (!message || typeof message !== 'object' || (message as { role?: unknown }).role !== 'assistant') {
      return message;
    }

    const reasoningContent = reasoningByAssistant[assistantIndex];
    assistantIndex += 1;
    if (reasoningContent === undefined) return message;

    const record = message as Record<string, unknown>;
    if (hasOwn(record, 'reasoning_content')) return message;

    changed = true;
    return { ...record, reasoning_content: reasoningContent };
  });

  return changed ? { ...request, messages } : request;
}

function withSourceMessages(options: any, sourceMessages: unknown[]) {
  const requestOptions = options?.options && typeof options.options === 'object'
    ? options.options
    : {};
  return {
    ...(options ?? {}),
    [SOURCE_MESSAGES_OPTION_KEY]: sourceMessages,
    options: {
      ...requestOptions,
      [SOURCE_MESSAGES_OPTION_KEY]: sourceMessages,
    },
  };
}

function getSourceMessagesFromOptions(options: any): unknown[] | null {
  const sourceMessages = options?.[SOURCE_MESSAGES_OPTION_KEY];
  return Array.isArray(sourceMessages) ? sourceMessages : null;
}

function withoutSourceMessagesOption(options: any) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return options;
  const { [SOURCE_MESSAGES_OPTION_KEY]: _sourceMessages, ...rest } = options;
  return rest;
}

class DeepSeekV4CompatibleChatOpenAICompletions extends ChatOpenAICompletions {
  async _generate(messages: any[], options: any, runManager?: any) {
    return await super._generate(messages, withSourceMessages(options, messages), runManager);
  }

  async *_streamResponseChunks(messages: any[], options: any, runManager?: any) {
    yield* super._streamResponseChunks(messages, withSourceMessages(options, messages), runManager);
  }

  completionWithRetry(request: any, requestOptions?: any): Promise<any> {
    const sourceMessages = getSourceMessagesFromOptions(requestOptions);
    const patchedRequest = attachDeepSeekReasoningContent(request, sourceMessages);
    return super.completionWithRetry(patchedRequest as any, withoutSourceMessagesOption(requestOptions));
  }
}

function withProviderCompatibility(options: ReturnType<typeof buildChatModelOptions>) {
  if (!isDeepSeekV4Model(options.modelName)) {
    return options;
  }
  return {
    ...options,
    completions: new DeepSeekV4CompatibleChatOpenAICompletions(options as any),
  };
}

export function createChatModel(
  temperature: number,
  runtimeOptions: ChatModelRuntimeOptions = {},
): StructureClawChatModel | null {
  const effectiveSettings = getEffectiveLlmSettings();
  if (!effectiveSettings?.llmApiKey?.trim()) {
    return null;
  }

  const model = resolveLlmProvider(effectiveSettings) === 'anthropic'
    ? new ChatAnthropic(buildAnthropicChatModelOptions(effectiveSettings, temperature, runtimeOptions))
    : new ChatOpenAI(withProviderCompatibility(
      buildChatModelOptions(effectiveSettings, temperature, runtimeOptions),
    ));

  return wrapWithLlmLogging(model, () => getEffectiveLlmSettings().llmModel);
}

export function createVisionChatModel(
  temperature: number,
  runtimeOptions: ChatModelRuntimeOptions = {},
): StructureClawChatModel | null {
  const effectiveSettings = getEffectiveVisionLlmSettings();
  if (!effectiveSettings?.llmApiKey?.trim()) {
    return null;
  }

  const model = resolveLlmProvider(
    effectiveSettings,
    process.env.LLM_VISION_PROVIDER ?? process.env.LLM_PROVIDER,
  ) === 'anthropic'
    ? new ChatAnthropic(buildAnthropicChatModelOptions(effectiveSettings, temperature, runtimeOptions))
    : new ChatOpenAI(withProviderCompatibility(
      buildChatModelOptions(effectiveSettings, temperature, runtimeOptions),
    ));

  return wrapWithLlmLogging(model, () => getEffectiveVisionLlmSettings()?.llmModel ?? effectiveSettings.llmModel);
}

function sanitizeBase64ForLogging(text: string): string {
  return text.replace(
    /data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/g,
    (match) => `[base64 image: ${Math.round(match.length / 1024)} KB]`,
  );
}

function wrapWithLlmLogging<TModel extends StructureClawChatModel>(model: TModel, modelName: () => string): TModel {
  const originalInvoke = model.invoke.bind(model);

  (model as any).invoke = async function (input: any, options?: any) {
    const promptStr = sanitizeBase64ForLogging(typeof input === 'string' ? input : JSON.stringify(input));
    const start = Date.now();
    const loggedModel = modelName();
    try {
      const result = await originalInvoke(input, options);
      const content = sanitizeBase64ForLogging(
        typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content),
      );
      const durationMs = Date.now() - start;
      llmCallLogger.log({
        model: loggedModel,
        prompt: promptStr,
        response: content,
        durationMs,
        success: true,
      });
      logLlmCall(logger, { model: loggedModel, durationMs, level: 'info' });
      return result;
    } catch (error) {
      const durationMs = Date.now() - start;
      llmCallLogger.log({
        model: loggedModel,
        prompt: promptStr,
        response: null,
        durationMs,
        success: false,
        error: sanitizeBase64ForLogging(String(error)),
      });
      logLlmCall(logger, { model: loggedModel, durationMs, success: false });
      throw error;
    }
  };

  return model;
}
