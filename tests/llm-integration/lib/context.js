const path = require("node:path");
const runtime = require("../../../scripts/cli/runtime");

/**
 * Resolve the integration test context: paths, env vars, and pre-flight checks.
 * Throws early if LLM_API_KEY is missing.
 */
function resolveIntegrationContext(rootDir) {
  const projectRoot = runtime.resolveProjectRoot(rootDir);
  const { paths, env } = runtime.loadProjectEnvironment(projectRoot);

  const llmApiKey = process.env.LLM_API_KEY || env.LLM_API_KEY || "";
  const llmModel = process.env.LLM_MODEL || env.LLM_MODEL || "";
  const llmBaseUrl = process.env.LLM_BASE_URL || env.LLM_BASE_URL || "";

  if (!llmApiKey) {
    throw new Error(
      "LLM_API_KEY is required for integration tests.\n" +
      "Set it via environment variable or .env file."
    );
  }

  return {
    rootDir: projectRoot,
    paths,
    env: {
      ...env,
      LLM_API_KEY: llmApiKey,
      LLM_MODEL: llmModel,
      LLM_BASE_URL: llmBaseUrl,
      DATABASE_URL: `file:${path
        .join(projectRoot, ".structureclaw", "data", "structureclaw-llm-test.db")
        .replace(/\\/gu, "/")}`,
    },
  };
}

module.exports = { resolveIntegrationContext };
