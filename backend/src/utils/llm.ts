import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config/index.js';
import { llmCallLogger } from './llm-logger.js';

export function createChatModel(temperature: number): ChatOpenAI | null {
  if (!config.llmApiKey) {
    return null;
  }

  const model = new ChatOpenAI({
    modelName: config.llmModel,
    temperature,
    timeout: config.llmTimeoutMs,
    maxRetries: config.llmMaxRetries,
    openAIApiKey: config.llmApiKey,
    configuration: {
      baseURL: config.llmBaseUrl,
    },
  });

  return wrapWithLlmLogging(model);
}

function wrapWithLlmLogging(model: ChatOpenAI): ChatOpenAI {
  const originalInvoke = model.invoke.bind(model);

  (model as any).invoke = async function (input: any, options?: any) {
    const promptStr = typeof input === 'string' ? input : JSON.stringify(input);
    const start = Date.now();
    try {
      const result = await originalInvoke(input, options);
      const content = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);
      llmCallLogger.log({
        model: config.llmModel,
        prompt: promptStr,
        response: content,
        durationMs: Date.now() - start,
        success: true,
      });
      return result;
    } catch (error) {
      llmCallLogger.log({
        model: config.llmModel,
        prompt: promptStr,
        response: null,
        durationMs: Date.now() - start,
        success: false,
        error: String(error),
      });
      throw error;
    }
  };

  return model;
}
