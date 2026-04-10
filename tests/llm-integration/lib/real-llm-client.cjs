const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Create a real LLM client using the backend's @langchain/openai dependency.
 * Uses `apiKey` (v1.x) parameter name. Reads config from process.env which
 * must be set before calling this function.
 *
 * The returned client is wrapped with LLM call logging so that every
 * invoke() call is recorded to .runtime/logs/llm-calls-test.jsonl.
 *
 * @param {object} context - Integration context with env vars
 * @param {number} [temperature=0] - LLM temperature (0 for deterministic)
 * @returns {import('@langchain/openai').ChatOpenAI | null}
 */
function createRealLlmClient(context, temperature = 0) {
  const apiKey = context.env.LLM_API_KEY || process.env.LLM_API_KEY || "";
  if (!apiKey) {
    return null;
  }

  const backendRequire = createRequire(
    path.join(context.rootDir, "backend", "package.json")
  );
  const { ChatOpenAI } = backendRequire("@langchain/openai");

  const model = new ChatOpenAI({
    model: context.env.LLM_MODEL || process.env.LLM_MODEL || undefined,
    temperature,
    timeout: parseInt(context.env.LLM_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS || "90000", 10),
    maxRetries: parseInt(context.env.LLM_MAX_RETRIES || process.env.LLM_MAX_RETRIES || "1", 10),
    apiKey,
    configuration: {
      baseURL: context.env.LLM_BASE_URL || process.env.LLM_BASE_URL || undefined,
    },
  });

  return wrapWithLogging(model, context);
}

/**
 * Self-contained LLM call logger. Writes one JSON line per invoke() call
 * to <rootDir>/.runtime/logs/llm-calls-test.jsonl — same format as the backend's
 * LlmCallLogger so the CI artifact upload picks it up automatically.
 */
let _logStream = null;
let _logDisabled = false;
function ensureLogStream(rootDir) {
  if (_logDisabled) return null;
  if (_logStream) return _logStream;
  if (process.env.LLM_LOG_ENABLED === "false") { _logDisabled = true; return null; }
  try {
    const dir = process.env.LLM_LOG_DIR || path.join(rootDir, ".runtime", "logs");
    fs.mkdirSync(dir, { recursive: true });
    _logStream = fs.createWriteStream(path.join(dir, "llm-calls-test.jsonl"), { flags: "a" });
    _logStream.on("error", () => { _logDisabled = true; _logStream = null; });
    return _logStream;
  } catch {
    _logDisabled = true;
    return null;
  }
}

function wrapWithLogging(model, context) {
  const stream = ensureLogStream(context.rootDir);
  if (!stream) return model;

  const modelName = context.env.LLM_MODEL || process.env.LLM_MODEL || "unknown";
  const originalInvoke = model.invoke.bind(model);

  function safeStringify(val) {
    if (typeof val === "string") return val;
    try {
      const result = JSON.stringify(val);
      return result === undefined ? String(val) : result;
    } catch {
      return String(val);
    }
  }

  function writeLogEntry(entry) {
    try {
      stream.write(JSON.stringify(entry) + "\n");
    } catch {
      // Non-blocking: never crash on log write failure.
    }
  }

  model.invoke = async function (input, options) {
    const promptStr = safeStringify(input);
    const start = Date.now();
    try {
      const result = await originalInvoke(input, options);
      const content = safeStringify(result.content);
      writeLogEntry({
        timestamp: new Date().toISOString(),
        model: modelName,
        prompt: promptStr,
        response: content,
        promptChars: promptStr.length,
        responseChars: content.length,
        durationMs: Date.now() - start,
        success: true,
      });
      return result;
    } catch (error) {
      writeLogEntry({
        timestamp: new Date().toISOString(),
        model: modelName,
        prompt: promptStr,
        response: null,
        promptChars: promptStr.length,
        responseChars: 0,
        durationMs: Date.now() - start,
        success: false,
        error: String(error),
      });
      throw error;
    }
  };

  return model;
}

module.exports = { createRealLlmClient };
