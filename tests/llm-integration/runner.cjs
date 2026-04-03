const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const { resolveIntegrationContext } = require("./lib/context.js");
const { createRealLlmClient } = require("./lib/real-llm-client.cjs");
const { withRetry } = require("./lib/retry.js");
const { assert, assertMatch, assertToolCalls, assertCriticalMissing, assertNotCriticalMissing } = require("./lib/assertions.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logResult(status, caseId, attempt, maxAttempts, durationMs, detail) {
  const attemptStr = `${attempt}/${maxAttempts}`;
  const duration = `${(durationMs / 1000).toFixed(1)}s`;
  if (status === "PASS") {
    process.stdout.write(`  [PASS] ${caseId} (${attemptStr}) — ${duration}\n`);
  } else if (status === "RETRY") {
    process.stdout.write(`  [RETRY] ${caseId} (${attemptStr}) — ${detail}\n`);
  } else {
    process.stdout.write(`  [FAIL] ${caseId} (${attemptStr}) — ${detail}\n`);
  }
}

function loadFixtures(rootDir) {
  const fixturePath = path.join(__dirname, "fixtures", "test-cases.json");
  const raw = fs.readFileSync(fixturePath, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed.testCases;
}

/** Import AgentSkillRuntime from backend dist. */
async function importAgentSkillRuntime(rootDir) {
  const filePath = path.join(rootDir, "backend", "dist", "agent-runtime", "index.js");
  const mod = await import(pathToFileURL(filePath).href);
  return mod.AgentSkillRuntime;
}

/** Import and instantiate AgentService with real LLM. */
async function createAgentService(rootDir, context) {
  const filePath = path.join(rootDir, "backend", "dist", "services", "agent.js");
  const mod = await import(`${pathToFileURL(filePath).href}?llm-test=${Date.now()}`);
  const AgentService = mod.AgentService;
  return new AgentService();
}

function resolveLocale(locale) {
  return locale === "zh" ? "zh" : "en";
}

// ---------------------------------------------------------------------------
// Test executors per category
// ---------------------------------------------------------------------------

/**
 * ROUTING: Test that detectStructuralType returns the correct skill.
 * No LLM call needed — this is deterministic regex-based.
 */
async function runRoutingTest(runtime, testCase) {
  const locale = resolveLocale(testCase.locale);
  const message = testCase.messages[0];
  const match = await runtime.detectStructuralType(message, locale);
  const expected = testCase.assertions;

  if (expected.inferredType) {
    const actualKey = match.mappedType || match.key;
    assert(
      actualKey === expected.inferredType || match.skillId === expected.inferredType,
      `expected inferredType="${expected.inferredType}", got key="${match.key}" mappedType="${match.mappedType}" skillId="${match.skillId}"`
    );
  }
  if (expected.structuralTypeKey) {
    assert(
      match.key === expected.structuralTypeKey || match.mappedType === expected.structuralTypeKey,
      `expected structuralTypeKey="${expected.structuralTypeKey}", got key="${match.key}" mappedType="${match.mappedType}"`
    );
  }
}

/**
 * EXTRACTION: Test that textToModelDraft produces correct parameters with real LLM.
 */
async function runExtractionTest(runtime, llm, testCase) {
  const locale = resolveLocale(testCase.locale);
  const message = testCase.messages[0];
  const expected = testCase.assertions;

  const result = await runtime.textToModelDraft(llm, message, undefined, locale);

  if (expected.inferredType) {
    assert(
      result.inferredType === expected.inferredType,
      `expected inferredType="${expected.inferredType}", got "${result.inferredType}"`
    );
  }

  if (expected.criticalMissing !== undefined) {
    const actual = result.missingFields || [];
    for (const field of expected.criticalMissing) {
      assert(actual.includes(field), `expected "${field}" in criticalMissing, got [${actual.join(", ")}]`);
    }
  }

  if (expected.draftPatch) {
    assertDraftPatch(result.stateToPersist || {}, expected.draftPatch);
  }
}

/**
 * Assert draftPatch fields against expected values.
 * Supports: { value: number, tolerance } for scalars,
 *           { value: number[], tolerance } for arrays,
 *           exact string/number match otherwise.
 */
function assertDraftPatch(state, expectedPatch) {
  for (const [key, expectedValue] of Object.entries(expectedPatch)) {
    const actualValue = state[key];
    if (expectedValue === null || expectedValue === undefined) continue;

    if (typeof expectedValue === "object" && expectedValue.value !== undefined) {
      const tolerance = expectedValue.tolerance || 0.05;
      const expected = expectedValue.value;

      if (Array.isArray(expected)) {
        // Array with tolerance: compare element-wise
        assert(Array.isArray(actualValue), `expected ${key} to be an array, got ${typeof actualValue}: ${actualValue}`);
        assert(actualValue.length === expected.length, `expected ${key} length ${expected.length}, got ${actualValue.length}`);
        for (let i = 0; i < expected.length; i++) {
          const diff = Math.abs(actualValue[i] - expected[i]) / Math.abs(expected[i] || 1);
          assert(diff <= tolerance, `expected ${key}[${i}]=${expected[i]} (±${(tolerance * 100).toFixed(0)}%), got ${actualValue[i]}`);
        }
      } else {
        // Scalar number with tolerance
        assert(typeof actualValue === "number", `expected ${key} to be a number, got ${typeof actualValue}: ${actualValue}`);
        const diff = Math.abs(actualValue - expected) / Math.abs(expected || 1);
        assert(diff <= tolerance, `expected ${key}=${expected} (±${(tolerance * 100).toFixed(0)}%), got ${actualValue}`);
      }
    } else {
      // Exact match (string, number, etc.)
      assert(
        actualValue === expectedValue,
        `expected ${key}="${expectedValue}", got "${actualValue}"`
      );
    }
  }
}

/**
 * PIPELINE: Full end-to-end via AgentService with real LLM and real analysis.
 */
async function runPipelineTest(agentService, testCase) {
  const locale = resolveLocale(testCase.locale);
  const message = testCase.messages[0];
  const expected = testCase.assertions;

  const result = await agentService.run({
    message,
    conversationId: `llm-test-${testCase.id}-${Date.now()}`,
    traceId: `trace-${testCase.id}`,
    context: {
      locale,
      autoAnalyze: true,
      includeReport: expected.expectReport !== false,
      autoCodeCheck: false,
    },
  });

  if (expected.toolCalls) {
    assertToolCalls(result.toolCalls || [], expected.toolCalls);
  }

  if (expected.analysisSuccess !== false && result.toolCalls) {
    const analysisCall = result.toolCalls.find((tc) => tc.tool === "run_analysis");
    if (analysisCall) {
      assert(
        analysisCall.status === "success",
        `run_analysis should succeed, got status="${analysisCall.status}"${analysisCall.error ? `, error: ${analysisCall.error}` : ""}`
      );
    }
  }
}

/**
 * CLARIFICATION: Multi-turn test where each turn has expected assertions.
 */
async function runClarificationTest(runtime, llm, testCase) {
  const locale = resolveLocale(testCase.locale);
  let currentState = undefined;

  for (let i = 0; i < testCase.turns.length; i++) {
    const turn = testCase.turns[i];
    const result = await runtime.textToModelDraft(llm, turn.message, currentState, locale);
    currentState = result.stateToPersist;

    const expected = turn.assertions;

    if (expected.criticalMissingIncludes) {
      assertCriticalMissing(result.missingFields || [], expected.criticalMissingIncludes);
    }
    if (expected.criticalMissing) {
      if (expected.criticalMissing.length === 0) {
        assert(
          (result.missingFields || []).length === 0,
          `expected no criticalMissing, got [${(result.missingFields || []).join(", ")}]`
        );
      } else {
        assertCriticalMissing(result.missingFields || [], expected.criticalMissing);
      }
    }
    if (expected.modelBuilt !== undefined) {
      if (expected.modelBuilt) {
        assert(result.model !== undefined, `expected model to be built on turn ${i + 1}, but it was undefined`);
      } else {
        assert(result.model === undefined, `expected model NOT to be built on turn ${i + 1}`);
      }
    }
    if (expected.draftPatch) {
      assertDraftPatch(result.stateToPersist || {}, expected.draftPatch);
    }
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runLlmIntegrationTests(rootDir, args) {
  const maxAttempts = 4; // 1 initial + 3 retries
  const context = resolveIntegrationContext(rootDir);

  // Inject LLM env vars into process.env BEFORE importing backend modules.
  // The backend config module reads process.env at import time.
  for (const [k, v] of Object.entries(context.env)) {
    if (v !== undefined && v !== "") {
      process.env[k] = v;
    }
  }

  // Ensure backend is built
  const { runBackendBuildOnce } = require("../regression/shared.js");
  await runBackendBuildOnce(context);

  // Ensure DB is ready
  const { execSync } = require("node:child_process");
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.join(rootDir, "backend"),
    env: { ...process.env, ...context.env },
    stdio: "pipe",
  });

  // Load test cases
  const allCases = loadFixtures(rootDir);

  // Parse filter from args
  const filterCategory = args.find((a) => !a.startsWith("--"));
  const cases = filterCategory
    ? allCases.filter((tc) => tc.category === filterCategory)
    : allCases;

  if (cases.length === 0) {
    process.stdout.write("No test cases matched.\n");
    return;
  }

  process.stdout.write(`\n${"=".repeat(60)}\n`);
  process.stdout.write(`LLM Integration Tests: ${cases.length} cases\n`);
  process.stdout.write(`Provider: ${context.env.LLM_PROVIDER}\n`);
  process.stdout.write(`Model: ${context.env.LLM_MODEL || "(default)"}\n`);
  process.stdout.write(`${"=".repeat(60)}\n\n`);

  // Create LLM client and runtime
  const llm = createRealLlmClient(context, 0);
  const AgentSkillRuntime = await importAgentSkillRuntime(rootDir);
  const runtime = new AgentSkillRuntime();

  let agentService = null;

  const results = { passed: 0, failed: 0, retried: 0, failures: [] };
  const startTime = Date.now();

  for (const testCase of cases) {
    const caseStart = Date.now();

    try {
      await withRetry(async () => {
        switch (testCase.category) {
          case "routing":
            await runRoutingTest(runtime, testCase);
            break;
          case "extraction":
            if (!llm) throw new Error("LLM client not available");
            await runExtractionTest(runtime, llm, testCase);
            break;
          case "pipeline": {
            if (!agentService) {
              agentService = await createAgentService(rootDir, context);
            }
            await runPipelineTest(agentService, testCase);
            break;
          }
          case "clarification":
            if (!llm) throw new Error("LLM client not available");
            await runClarificationTest(runtime, llm, testCase);
            break;
          default:
            throw new Error(`Unknown test category: ${testCase.category}`);
        }
      }, testCase.id, maxAttempts);

      const duration = Date.now() - caseStart;
      logResult("PASS", testCase.id, 1, maxAttempts, duration);
      results.passed += 1;
    } catch (err) {
      const duration = Date.now() - caseStart;
      const message = err instanceof Error ? err.message : String(err);
      logResult("FAIL", testCase.id, maxAttempts, maxAttempts, duration, message);
      results.failed += 1;
      results.failures.push({ id: testCase.id, error: message });
    }
  }

  // Summary
  const totalDuration = Date.now() - startTime;
  process.stdout.write(`\n${"=".repeat(60)}\n`);
  process.stdout.write(`Results: ${results.passed}/${cases.length} passed, ${results.failed} failed\n`);
  if (results.failures.length > 0) {
    process.stdout.write(`Failed: ${results.failures.map((f) => f.id).join(", ")}\n`);
  }
  process.stdout.write(`Total time: ${(totalDuration / 1000).toFixed(1)}s\n`);
  process.stdout.write(`${"=".repeat(60)}\n\n`);

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

module.exports = { runLlmIntegrationTests };
