const { createRequire } = require("node:module");
const path = require("node:path");

/**
 * Create a real LLM client using the backend's @langchain/openai dependency.
 * No mocking — makes actual API calls.
 *
 * @param {object} context - Integration context with env vars
 * @param {number} [temperature=0] - LLM temperature (0 for deterministic)
 * @returns {import('@langchain/openai').ChatOpenAI | null}
 */
function createRealLlmClient(context, temperature = 0) {
  const apiKey = context.env.LLM_API_KEY;
  if (!apiKey) {
    return null;
  }

  const backendRequire = createRequire(
    path.join(context.rootDir, "backend", "package.json")
  );
  const { ChatOpenAI } = backendRequire("@langchain/openai");

  const model = new ChatOpenAI({
    modelName: context.env.LLM_MODEL || undefined,
    temperature,
    timeout: parseInt(context.env.LLM_TIMEOUT_MS || "90000", 10),
    maxRetries: parseInt(context.env.LLM_MAX_RETRIES || "1", 10),
    openAIApiKey: apiKey,
    configuration: {
      baseURL: context.env.LLM_BASE_URL || undefined,
    },
  });

  return model;
}

module.exports = { createRealLlmClient };
