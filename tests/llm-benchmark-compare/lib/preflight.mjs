/**
 * Pre-flight gate for the dual-target benchmark comparison.
 *
 * For every target and for the judge, the OpenAI-compatible models-list
 * endpoint must return the configured model ID before any scenario starts.
 * Both deployed stacks require an API key on every request, so the check
 * always sends it. Key values are never logged.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

function describeFetchError(err) {
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return "request timed out";
  }
  return err instanceof Error ? err.message : String(err);
}

export async function checkModelEndpoint(endpoint, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const label = `${endpoint.role} "${endpoint.name}"`;
  const { apiKeyEnv, baseUrl, model } = endpoint;
  const apiKey = endpoint.apiKey;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error(
      `Pre-flight failed for ${label}: environment variable ${apiKeyEnv} is not set or empty. `
      + `Export ${apiKeyEnv} before running; the key value is resolved from the environment and `
      + "is never written to committed files, logs, or the comparison report.",
    );
  }

  let response;
  try {
    response = await fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(
      `Pre-flight failed for ${label}: cannot reach ${baseUrl}/models (${describeFetchError(err)}). `
      + "Verify the endpoint is serving (docker compose ps in the model-deploy stack folder) "
      + "and that the configured base URL and port are correct.",
    );
  }

  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403
      ? "the endpoint rejected the API key"
      : response.status === 404
        ? "no OpenAI-compatible /models route was found at this base URL"
        : `HTTP ${response.status}`;
    throw new Error(
      `Pre-flight failed for ${label}: GET ${baseUrl}/models returned HTTP ${response.status} (${detail}). `
      + `Check ${apiKeyEnv} and the endpoint configuration.`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `Pre-flight failed for ${label}: ${baseUrl}/models returned a non-JSON response; `
      + "the endpoint does not look like an OpenAI-compatible server.",
    );
  }
  const servedModels = Array.isArray(payload?.data)
    ? payload.data.map((entry) => entry?.id).filter((id) => typeof id === "string")
    : null;
  if (!servedModels) {
    throw new Error(
      `Pre-flight failed for ${label}: ${baseUrl}/models response has no "data" model list; `
      + "the endpoint does not look like an OpenAI-compatible server.",
    );
  }
  if (!servedModels.includes(model)) {
    throw new Error(
      `Pre-flight failed for ${label}: ${baseUrl} does not serve the configured model. `
      + `Expected model ID "${model}" but the endpoint serves: ${servedModels.join(", ") || "(none)"}. `
      + "Fix the serving stack or update the comparison config.",
    );
  }

  return { ok: true, role: endpoint.role, name: endpoint.name, baseUrl, model, servedModels };
}

export async function runPreflight(plan, { fetchImpl = fetch, env = process.env, write = () => {} } = {}) {
  const checks = [plan.judge, ...plan.targets];
  const results = [];
  for (const endpoint of checks) {
    write(`Pre-flight: checking ${endpoint.role} "${endpoint.name}" at ${endpoint.baseUrl} ... `);
    const result = await checkModelEndpoint(
      { ...endpoint, apiKey: env[endpoint.apiKeyEnv] },
      { fetchImpl },
    );
    write(`ok (serves ${result.model})\n`);
    results.push(result);
  }
  return results;
}
