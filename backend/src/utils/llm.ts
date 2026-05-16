import { ChatOpenAI, ChatOpenAICompletions } from '@langchain/openai';
import type { config } from '../config/index.js';
import { getEffectiveLlmSettings } from '../config/llm-runtime.js';
import { llmCallLogger } from './llm-logger.js';
import { logger, logLlmCall } from './agent-logger.js';

type ChatModelConfigLike = Pick<
  typeof config,
  'llmApiKey' | 'llmModel' | 'llmTimeoutMs' | 'llmMaxRetries' | 'llmBaseUrl'
>;

export interface ChatModelRuntimeOptions {
  disableStreaming?: boolean;
}

export function buildChatModelOptions(
  modelConfig: ChatModelConfigLike,
  temperature: number,
  runtimeOptions: ChatModelRuntimeOptions = {},
) {
  const disableStreaming = runtimeOptions.disableStreaming ?? false;
  return {
    modelName: modelConfig.llmModel,
    temperature,
    timeout: modelConfig.llmTimeoutMs,
    maxRetries: modelConfig.llmMaxRetries,
    apiKey: modelConfig.llmApiKey,
    disableStreaming,
    ...(disableStreaming ? { streaming: false } : {}),
    configuration: {
      baseURL: modelConfig.llmBaseUrl,
    },
  };
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
): ChatOpenAI | null {
  const effectiveSettings = getEffectiveLlmSettings();
  if (!effectiveSettings.llmApiKey.trim()) {
    return null;
  }

  const model = new ChatOpenAI(withProviderCompatibility(
    buildChatModelOptions(effectiveSettings, temperature, runtimeOptions),
  ));

  return wrapWithLlmLogging(model);
}

function wrapWithLlmLogging(model: ChatOpenAI): ChatOpenAI {
  const originalInvoke = model.invoke.bind(model);

  (model as any).invoke = async function (input: any, options?: any) {
    const promptStr = typeof input === 'string' ? input : JSON.stringify(input);
    const start = Date.now();
    const loggedModel = getEffectiveLlmSettings().llmModel;
    try {
      const result = await originalInvoke(input, options);
      const content = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);
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
        error: String(error),
      });
      logLlmCall(logger, { model: loggedModel, durationMs, success: false });
      throw error;
    }
  };

  return model;
}
