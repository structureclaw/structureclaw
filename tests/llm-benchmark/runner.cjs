const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const { resolveIntegrationContext } = require("../llm-integration/lib/context.js");
const { evaluateScenario } = require("./lib/evaluate.cjs");
const { printScenarioResult, printSummary, writeJsonOutput } = require("./lib/report.cjs");

async function importBackendModules(rootDir) {
  const runtimePath = path.join(rootDir, "backend", "dist", "agent-runtime", "index.js");
  const servicePath = path.join(rootDir, "backend", "dist", "agent-langgraph", "agent-service.js");

  const runtimeMod = await import(pathToFileURL(runtimePath).href);
  const serviceMod = await import(`${pathToFileURL(servicePath).href}?bench=${Date.now()}`);

  return {
    AgentSkillRuntime: runtimeMod.AgentSkillRuntime,
    LangGraphAgentService: serviceMod.LangGraphAgentService,
  };
}

function loadScenarios(rootDir, options) {
  const scenariosDir = path.join(rootDir, "tests", "llm-benchmark", "scenarios");
  const files = fs.readdirSync(scenariosDir).filter((f) => f.endsWith(".json")).sort();
  let all = [];
  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(path.join(scenariosDir, file), "utf-8"));
    all.push(...parsed);
  }
  if (options.scenarioId) {
    all = all.filter((s) => s.id === options.scenarioId);
  }
  return all;
}

function parseBenchmarkOptions(args) {
  let scenarioId;
  let outputPath;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scenario" && args[i + 1]) {
      scenarioId = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[++i];
    }
  }
  return { scenarioId, outputPath };
}

async function runBenchmark(rootDir, args) {
  const options = parseBenchmarkOptions(args);
  const context = resolveIntegrationContext(rootDir);

  // Inject LLM env vars
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
  execSync("npx prisma db push --accept-data-loss", {
    cwd: path.join(rootDir, "backend"),
    env: { ...process.env, ...context.env },
    stdio: "pipe",
  });

  // Load scenarios
  const scenarios = loadScenarios(rootDir, options);
  if (scenarios.length === 0) {
    process.stdout.write("No benchmark scenarios matched.\n");
    return;
  }

  process.stdout.write(`\n${"=".repeat(60)}\n`);
  process.stdout.write(`LangGraph Agent Benchmark: ${scenarios.length} scenario(s)\n`);
  process.stdout.write(`Model: ${context.env.LLM_MODEL || "(default)"}\n`);
  process.stdout.write(`Base URL: ${context.env.LLM_BASE_URL || "(default)"}\n`);
  process.stdout.write(`${"=".repeat(60)}\n`);

  // Import and instantiate
  const { AgentSkillRuntime, LangGraphAgentService } = await importBackendModules(rootDir);
  const runtime = new AgentSkillRuntime();
  const service = new LangGraphAgentService(runtime);

  const results = [];

  for (const scenario of scenarios) {
    process.stdout.write(`\nRunning: ${scenario.id}...\n`);
    const startTime = Date.now();

    try {
      const state = await service.runFull({
        message: scenario.message,
        conversationId: `bench-${scenario.id}-${startTime}`,
        context: { locale: scenario.locale || "zh" },
      });

      const durationMs = Date.now() - startTime;
      const evaluation = evaluateScenario(scenario, state, durationMs);
      printScenarioResult(scenario, evaluation);
      results.push(evaluation);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\nFAIL  ${scenario.id}\n`);
      process.stdout.write(`  error: ${message}\n`);
      results.push({
        scenarioId: scenario.id,
        description: scenario.description || "",
        passed: 0,
        total: 1,
        allPassed: false,
        metrics: [{ metric: "execution", pass: false, expected: "no error", actual: message }],
        durationMs,
      });
    }
  }

  printSummary(results);

  if (options.outputPath) {
    writeJsonOutput(options.outputPath, results);
  }

  if (results.some((r) => !r.allPassed)) {
    process.exitCode = 1;
  }
}

module.exports = { runBenchmark };
