const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { resolveIntegrationContext } = require("./lib/context.js");
const { createRealLlmClient } = require("./lib/real-llm-client.cjs");
const { withRetry, MAX_ATTEMPTS } = require("./lib/retry.js");
const { loadLlmFixtures } = require("./lib/discovery.cjs");
const { parseLlmIntegrationOptions, filterLlmTestCases } = require("./lib/selection.cjs");
const {
  assertRoutingTrace,
  assertToolAuthorizers,
} = require("./lib/assertions.js");
const {
  runRoutingTest,
  runExtractionTest,
  runPipelineTest,
  runClarificationTest,
} = require("./lib/executors.cjs");
const { resolveObservedTrace } = require("./lib/trace.cjs");
const { formatCaseSummary, appendArtifactRecord } = require("./lib/reporting.cjs");

/** Import AgentSkillRuntime from backend dist. */
async function importAgentSkillRuntime(rootDir) {
  const filePath = path.join(rootDir, "backend", "dist", "agent-runtime", "index.js");
  const mod = await import(pathToFileURL(filePath).href);
  return mod.AgentSkillRuntime;
}

/** Import and instantiate AgentService with real LLM. */
async function createAgentService(rootDir) {
  const filePath = path.join(rootDir, "backend", "dist", "services", "agent.js");
  const mod = await import(`${pathToFileURL(filePath).href}?llm-test=${Date.now()}`);
  const AgentService = mod.AgentService;
  return new AgentService();
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runLlmIntegrationTests(rootDir, args) {
  const maxAttempts = MAX_ATTEMPTS;
  const context = resolveIntegrationContext(rootDir);
  const options = parseLlmIntegrationOptions(args);

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
  const allCases = loadLlmFixtures(rootDir);
  const cases = filterLlmTestCases(allCases, options);

  if (cases.length === 0) {
    process.stdout.write("No test cases matched.\n");
    return;
  }

  process.stdout.write(`\n${"=".repeat(60)}\n`);
  process.stdout.write(`LLM Integration Tests: ${cases.length} cases\n`);
  process.stdout.write(`Provider: ${context.env.LLM_PROVIDER}\n`);
  process.stdout.write(`Model: ${context.env.LLM_MODEL || "(default)"}\n`);
  process.stdout.write(`Category: ${options.category || "(all)"}\n`);
  process.stdout.write(`Skill: ${options.skillId || "(all)"}\n`);
  process.stdout.write(`Family: ${options.family || "(all)"}\n`);
  process.stdout.write(`Variant: ${options.variant || "(all)"}\n`);
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
    let draftResult = null;
    let pipelineResult = null;

    try {
      await withRetry(async () => {
        switch (testCase.category) {
          case "routing":
            await runRoutingTest(runtime, testCase);
            break;
          case "extraction":
            if (!llm) throw new Error("LLM client not available");
            draftResult = await runExtractionTest(runtime, llm, testCase);
            break;
          case "pipeline": {
            if (!agentService) {
              agentService = await createAgentService(rootDir);
            }
            pipelineResult = await runPipelineTest(agentService, testCase);
            break;
          }
          case "clarification":
            if (!llm) throw new Error("LLM client not available");
            draftResult = await runClarificationTest(runtime, llm, testCase);
            break;
          default:
            throw new Error(`Unknown test category: ${testCase.category}`);
        }
      }, testCase.id, maxAttempts);

      // Resolve observed trace
      const observedTrace = resolveObservedTrace({
        testCase,
        draftResult: draftResult || undefined,
        pipelineResult: pipelineResult || undefined,
      });

      // Assert routing trace expectations
      const expect = testCase.expect || {};
      if (expect.routing) {
        assertRoutingTrace(observedTrace, expect.routing);
      }
      if (expect.toolAuthorizers) {
        assertToolAuthorizers(observedTrace.toolCalls || [], expect.toolAuthorizers);
      }

      // Check fallback policy
      if (testCase.fallbackPolicy === "forbid-generic" && observedTrace.structuralSkillId === "generic") {
        throw new Error(`unexpected generic fallback for ${testCase.id}`);
      }
      if (testCase.fallbackPolicy === "require-generic" && observedTrace.structuralSkillId !== "generic") {
        throw new Error(`expected generic fallback for ${testCase.id}`);
      }

      const duration = Date.now() - caseStart;
      process.stdout.write(`${formatCaseSummary(testCase, observedTrace, "PASS")}\n`);

      if (options.outputPath) {
        appendArtifactRecord(options.outputPath, {
          id: testCase.id,
          category: testCase.category,
          variant: testCase.variant,
          family: testCase.family,
          enabledSkillIds: observedTrace.enabledSkillIds,
          activatedSkillIds: observedTrace.activatedSkillIds,
          structuralSkillId: observedTrace.structuralSkillId,
          analysisSkillId: observedTrace.analysisSkillId,
          toolCalls: observedTrace.toolCalls,
          status: "PASS",
          durationMs: duration,
        });
      }

      results.passed += 1;
    } catch (err) {
      draftResult = draftResult || err?.draftResult || null;
      pipelineResult = pipelineResult || err?.pipelineResult || null;
      const duration = Date.now() - caseStart;
      const message = err instanceof Error ? err.message : String(err);

      const failTrace = resolveObservedTrace({
        testCase,
        draftResult: draftResult || undefined,
        pipelineResult: pipelineResult || undefined,
      });
      process.stdout.write(`${formatCaseSummary(testCase, failTrace, "FAIL")}\n`);
      process.stdout.write(`    error: ${message}\n`);

      if (options.outputPath) {
        appendArtifactRecord(options.outputPath, {
          id: testCase.id,
          category: testCase.category,
          variant: testCase.variant,
          family: testCase.family,
          enabledSkillIds: failTrace.enabledSkillIds,
          activatedSkillIds: failTrace.activatedSkillIds,
          structuralSkillId: failTrace.structuralSkillId,
          analysisSkillId: failTrace.analysisSkillId,
          toolCalls: failTrace.toolCalls,
          status: "FAIL",
          durationMs: duration,
          error: message,
        });
      }

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
