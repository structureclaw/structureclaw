/**
 * LLM-as-Judge evaluator for natural_language assertions.
 *
 * Configuration (via environment variables):
 *   LLM_JUDGE_MODEL    — model to use (falls back to LLM_MODEL, then "gpt-4o-mini")
 *   LLM_JUDGE_API_KEY  — API key (falls back to LLM_API_KEY)
 *   LLM_JUDGE_BASE_URL — base URL (falls back to LLM_BASE_URL, then "https://api.openai.com")
 *
 * Fixed parameters: temperature=0, max_tokens=500, timeout=30s
 */

const https = require("node:https");

const JUDGE_TEMPERATURE = 0;
const JUDGE_MAX_TOKENS = 500;
const JUDGE_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BODY = 100_000; // 100KB

/**
 * Build a compact summary of the agent output for the judge prompt.
 * @param {object} state - AgentState returned by runFull
 * @returns {string}
 */
function summarizeAgentOutput(state) {
  const parts = [];

  if (state.structuralTypeKey) {
    parts.push(`Structural type: ${state.structuralTypeKey}`);
  }

  if (state.model) {
    const nodes = Array.isArray(state.model.nodes) ? state.model.nodes.length : 0;
    const elements = Array.isArray(state.model.elements) ? state.model.elements.length : 0;
    parts.push(`Model: ${nodes} nodes, ${elements} elements`);
  }

  if (state.analysisResult) {
    const keys = Object.keys(state.analysisResult).filter((k) => k !== "_raw").join(", ");
    parts.push(`Analysis result keys: ${keys || "(present)"}`);
    const displacements =
      state.analysisResult.displacements || state.analysisResult.nodeDisplacements;
    if (Array.isArray(displacements) && displacements.length > 0) {
      parts.push(`Sample displacement: ${JSON.stringify(displacements[0])}`);
    }
    const reactions = state.analysisResult.reactions || state.analysisResult.nodeReactions;
    if (Array.isArray(reactions) && reactions.length > 0) {
      parts.push(`Sample reaction: ${JSON.stringify(reactions[0])}`);
    }
  }

  if (state.report?.markdown) {
    parts.push(`Report excerpt: ${state.report.markdown.slice(0, 500)}`);
  }

  return parts.length > 0 ? parts.join("\n") : "(no agent output)";
}

/**
 * Build the judge prompt.
 * @param {string} description - natural language criterion
 * @param {string} agentOutput - compact summary of agent state
 * @returns {string}
 */
function buildJudgePrompt(description, agentOutput) {
  return [
    "You are a structural engineering test evaluator.",
    "Based on the agent output below, judge whether the following criterion is satisfied.",
    "",
    `Criterion: ${description}`,
    "",
    "Agent output:",
    agentOutput,
    "",
    'Respond ONLY with a JSON object on a single line: {"pass": true} or {"pass": false, "reason": "brief explanation"}',
    "Do not include any other text.",
  ].join("\n");
}

/**
 * Extract JSON from LLM response, handling markdown fences and nested braces.
 * @param {string} response - raw LLM response
 * @returns {object|null} parsed object or null
 */
function extractJudgeJson(response) {
  let text = response.trim();

  // Strip markdown code fences
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Try full parse first
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to brace-matching
  }

  // Find balanced braces — greedy match from first { to last }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Call the LLM judge API (HTTPS only).
 * @param {string} prompt
 * @returns {Promise<string>} raw response text
 */
function callLlmJudgeApi(prompt) {
  const apiKey = process.env.LLM_JUDGE_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_JUDGE_API_KEY or LLM_API_KEY is required for judge evaluation");
  }
  const model = process.env.LLM_JUDGE_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";
  const rawBase =
    process.env.LLM_JUDGE_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com";
  let base = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;

  // Build URL handling bases that already include /v1 or other versioned paths
  const chatPath = /\/v\d+$/.test(base) ? "/chat/completions" : "/v1/chat/completions";
  const url = new URL(`${base}${chatPath}`);
  if (url.protocol !== "https:") {
    throw new Error(`Judge API must use HTTPS, got: ${url.protocol}`);
  }

  const bodyStr = JSON.stringify({
    model,
    temperature: JUDGE_TEMPERATURE,
    max_tokens: JUDGE_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  return new Promise((resolve, reject) => {
    let settled = false;

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > MAX_RESPONSE_BODY) {
            if (!settled) {
              settled = true;
              req.destroy(new Error("Judge response body exceeded 100KB limit"));
            }
          }
        });
        res.on("end", () => {
          if (settled) return;
          if (res.statusCode && res.statusCode >= 400) {
            settled = true;
            reject(
              new Error(`Judge API returned HTTP ${res.statusCode}`),
            );
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content ?? "";
            settled = true;
            resolve(content.trim());
          } catch {
            settled = true;
            reject(new Error(`Failed to parse judge response: ${data.slice(0, 100)}`));
          }
        });
      },
    );

    req.setTimeout(JUDGE_TIMEOUT_MS, () => {
      if (!settled) {
        settled = true;
        req.destroy(new Error("LLM judge request timed out after 30s"));
      }
    });
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Evaluate a natural_language assertion against the agent state using LLM-as-Judge.
 *
 * @param {string} description - the natural language criterion to evaluate
 * @param {object} state - AgentState returned by runFull
 * @returns {Promise<{ pass: boolean, reason?: string }>}
 */
async function evaluateNaturalLanguage(description, state) {
  const agentOutput = summarizeAgentOutput(state);
  const prompt = buildJudgePrompt(description, agentOutput);

  try {
    const response = await callLlmJudgeApi(prompt);
    const result = extractJudgeJson(response);
    if (!result) {
      return { pass: false, reason: `Judge returned non-JSON: ${response.slice(0, 100)}` };
    }
    return {
      pass: result.pass === true,
      reason: typeof result.reason === "string" ? result.reason : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { pass: false, reason: `Judge error: ${msg}` };
  }
}

module.exports = { evaluateNaturalLanguage };
