import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config/index.js';

export function createChatModel(temperature: number): ChatOpenAI | null {
  if (!config.llmApiKey) {
    return null;
  }

  return new ChatOpenAI({
    modelName: config.llmModel,
    temperature,
    timeout: config.llmTimeoutMs,
    maxRetries: config.llmMaxRetries,
    openAIApiKey: config.llmApiKey,
    configuration: {
      baseURL: config.llmBaseUrl,
    },
  });
}
