import { ChatOpenAI } from '@langchain/openai';
import type { config } from '../config/index.js';
import { getEffectiveLlmSettings } from '../config/llm-runtime.js';
import { llmCallLogger } from './llm-logger.js';
import { logger, logLlmCall } from './agent-logger.js';

type ChatModelConfigLike = Pick<
  typeof config,
  'llmApiKey' | 'llmModel' | 'llmTimeoutMs' | 'llmMaxRetries' | 'llmBaseUrl'
>;

export function buildChatModelOptions(modelConfig: ChatModelConfigLike, temperature: number) {
  return {
    modelName: modelConfig.llmModel,
    temperature,
    timeout: modelConfig.llmTimeoutMs,
    maxRetries: modelConfig.llmMaxRetries,
    apiKey: modelConfig.llmApiKey,
    configuration: {
      baseURL: modelConfig.llmBaseUrl,
    },
  };
}

export function createChatModel(temperature: number): ChatOpenAI | null {
  const effectiveSettings = getEffectiveLlmSettings();
  if (!effectiveSettings.llmApiKey.trim()) {
    return null;
  }

  const model = new ChatOpenAI(buildChatModelOptions(effectiveSettings, temperature));

  return wrapWithLlmLogging(model);
}

export function createDynamicChatModel(temperature: number): ChatOpenAI {
  return new Proxy({} as ChatOpenAI, {
    get(_target, prop) {
      const model = createChatModel(temperature);
      if (!model) {
        throw new Error('LLM is not configured');
      }
      const value = Reflect.get(model, prop, model);
      return typeof value === 'function' ? value.bind(model) : value;
    },
  });
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
