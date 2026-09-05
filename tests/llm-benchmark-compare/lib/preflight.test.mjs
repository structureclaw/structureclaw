// Test entry point, executed via `node --test` — invisible to static reachability.
// fallow-ignore-file unused-file
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { checkModelEndpoint, runPreflight } from "./preflight.mjs";

const UNREACHABLE_BASE_URL = "http://127.0.0.1:1/v1";
const SHORT_TIMEOUT = { timeoutMs: 2000 };

/**
 * Local OpenAI-compatible /models stub. Binds an ephemeral port on 127.0.0.1;
 * no external network is contacted. Records every request so tests can assert
 * on the auth header without ever handling a real key.
 */
function startModelStub(t, { status = 200, payload = { data: [] }, body } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests.push({ url: req.url, method: req.method, authorization: req.headers.authorization });
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body ?? `${JSON.stringify(payload)}\n`);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      t.after(() => server.close());
      resolve({ requests, baseUrl: `http://127.0.0.1:${port}/v1` });
    });
  });
}

function endpoint(overrides = {}) {
  return {
    role: "target 1 of 1",
    name: "alpha",
    baseUrl: UNREACHABLE_BASE_URL,
    model: "org/model-alpha",
    apiKeyEnv: "TEST_COMPARE_KEY_A",
    apiKey: "dummy-key",
    ...overrides,
  };
}

test("checkModelEndpoint passes when the endpoint serves the configured model", async (t) => {
  const stub = await startModelStub(t, {
    payload: { object: "list", data: [{ id: "org/model-alpha" }, { id: "some/other-model" }] },
  });

  const result = await checkModelEndpoint(endpoint({ baseUrl: stub.baseUrl }), SHORT_TIMEOUT);

  assert.deepEqual(result, {
    ok: true,
    role: "target 1 of 1",
    name: "alpha",
    baseUrl: stub.baseUrl,
    model: "org/model-alpha",
    servedModels: ["org/model-alpha", "some/other-model"],
  });
  // Both deployed stacks require an API key on every request; the check must send it.
  assert.deepEqual(stub.requests, [
    { url: "/v1/models", method: "GET", authorization: "Bearer dummy-key" },
  ]);
});

test("checkModelEndpoint fails fast without any request when the API key env is unset", async (t) => {
  const stub = await startModelStub(t, { payload: { data: [{ id: "org/model-alpha" }] } });

  await assert.rejects(
    checkModelEndpoint(endpoint({ baseUrl: stub.baseUrl, apiKey: "   " }), SHORT_TIMEOUT),
    (err) => {
      assert.match(err.message, /Pre-flight failed for target 1 of 1 "alpha"/);
      assert.match(err.message, /environment variable TEST_COMPARE_KEY_A is not set or empty/);
      assert.match(err.message, /never written to committed files, logs, or the comparison report/);
      return true;
    },
  );
  assert.equal(stub.requests.length, 0);
});

test("checkModelEndpoint fails fast on an unreachable endpoint", async () => {
  await assert.rejects(
    checkModelEndpoint(endpoint(), SHORT_TIMEOUT),
    (err) => {
      assert.match(err.message, /Pre-flight failed for target 1 of 1 "alpha"/);
      assert.match(err.message, /cannot reach http:\/\/127\.0\.0\.1:1\/v1\/models/);
      assert.match(err.message, /Verify the endpoint is serving/);
      return true;
    },
  );
});

test("checkModelEndpoint fails when the endpoint serves a different model ID", async (t) => {
  const stub = await startModelStub(t, { payload: { data: [{ id: "some/other-model" }] } });

  await assert.rejects(
    checkModelEndpoint(endpoint({ baseUrl: stub.baseUrl }), SHORT_TIMEOUT),
    (err) => {
      assert.match(err.message, /does not serve the configured model/);
      assert.match(err.message, /Expected model ID "org\/model-alpha"/);
      assert.match(err.message, /the endpoint serves: some\/other-model/);
      assert.match(err.message, /Fix the serving stack or update the comparison config/);
      return true;
    },
  );
});

test("checkModelEndpoint fails fast when the judge endpoint is down", async () => {
  await assert.rejects(
    checkModelEndpoint(endpoint({ role: "judge", name: "judge" }), SHORT_TIMEOUT),
    /Pre-flight failed for judge "judge": cannot reach http:\/\/127\.0\.0\.1:1\/v1\/models/,
  );
});

test("checkModelEndpoint reports auth rejections from the endpoint", async (t) => {
  const stub = await startModelStub(t, { status: 401, payload: { error: { message: "bad key" } } });

  await assert.rejects(
    checkModelEndpoint(endpoint({ baseUrl: stub.baseUrl }), SHORT_TIMEOUT),
    /returned HTTP 401 \(the endpoint rejected the API key\)\. Check TEST_COMPARE_KEY_A/,
  );
});

test("checkModelEndpoint reports a missing OpenAI-compatible /models route", async (t) => {
  const stub = await startModelStub(t, { status: 404, payload: { error: "not found" } });

  await assert.rejects(
    checkModelEndpoint(endpoint({ baseUrl: stub.baseUrl }), SHORT_TIMEOUT),
    /returned HTTP 404 \(no OpenAI-compatible \/models route was found at this base URL\)/,
  );
});

test("checkModelEndpoint rejects a non-JSON /models response", async (t) => {
  const stub = await startModelStub(t, { body: "<html>not json</html>" });

  await assert.rejects(
    checkModelEndpoint(endpoint({ baseUrl: stub.baseUrl }), SHORT_TIMEOUT),
    /returned a non-JSON response; the endpoint does not look like an OpenAI-compatible server/,
  );
});

test("checkModelEndpoint rejects a response without a data model list", async (t) => {
  const stub = await startModelStub(t, { payload: { object: "list" } });

  await assert.rejects(
    checkModelEndpoint(endpoint({ baseUrl: stub.baseUrl }), SHORT_TIMEOUT),
    /response has no "data" model list/,
  );
});

test("runPreflight checks the judge first, then every target, and streams progress", async (t) => {
  const stub = await startModelStub(t, {
    payload: { data: [{ id: "org/model-alpha" }, { id: "org/model-beta" }, { id: "org/judge-model" }] },
  });
  const plan = {
    judge: endpoint({ role: "judge", name: "judge", baseUrl: stub.baseUrl, model: "org/judge-model", apiKeyEnv: "TEST_COMPARE_KEY_JUDGE" }),
    targets: [
      endpoint({ role: "target 1 of 2", name: "alpha", baseUrl: stub.baseUrl, model: "org/model-alpha" }),
      endpoint({ role: "target 2 of 2", name: "beta", baseUrl: stub.baseUrl, model: "org/model-beta", apiKeyEnv: "TEST_COMPARE_KEY_B" }),
    ],
  };

  const lines = [];
  const results = await runPreflight(plan, {
    env: { TEST_COMPARE_KEY_A: "dummy-key", TEST_COMPARE_KEY_B: "dummy-key", TEST_COMPARE_KEY_JUDGE: "dummy-key" },
    write: (line) => lines.push(line),
  });

  assert.deepEqual(results.map((result) => result.name), ["judge", "alpha", "beta"]);
  assert.deepEqual(results.map((result) => result.model), ["org/judge-model", "org/model-alpha", "org/model-beta"]);
  const output = lines.join("");
  assert.match(output, /Pre-flight: checking judge "judge" at /);
  assert.match(output, /Pre-flight: checking target 2 of 2 "beta" at /);
  assert.match(output, /ok \(serves org\/model-beta\)/);
});

test("runPreflight fails fast on the judge without contacting any target", async (t) => {
  const stub = await startModelStub(t, { payload: { data: [{ id: "org/model-alpha" }] } });
  const plan = {
    judge: endpoint({ role: "judge", name: "judge", apiKeyEnv: "TEST_COMPARE_KEY_JUDGE" }),
    targets: [endpoint({ role: "target 1 of 1", name: "alpha", baseUrl: stub.baseUrl })],
  };

  await assert.rejects(
    runPreflight(plan, { env: { TEST_COMPARE_KEY_A: "dummy-key", TEST_COMPARE_KEY_JUDGE: "dummy-key" }, write: () => {} }),
    /Pre-flight failed for judge "judge"/,
  );
  assert.equal(stub.requests.length, 0);
});
