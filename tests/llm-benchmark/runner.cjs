const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

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

function normalizeScenario(scenario) {
  if (scenario.turns) {
    return { ...scenario, _multiTurn: true };
  }
  return {
    ...scenario,
    _multiTurn: false,
    turns: [
      {
        message: scenario.message,
        assertions: scenario.expect?.assertions,
      },
    ],
  };
}

function mergeTurnResults(scenario, turnResults, totalDurationMs) {
  const allMetrics = [];
  let allPassed = true;
  let passed = 0;
  let total = 0;

  for (const { evaluation } of turnResults) {
    // Keep per-turn toolCalls and duration as informational
    const coreMetrics = evaluation.metrics.filter(
      (m) => m.metric !== "toolCalls" && m.metric !== "duration",
    );
    allMetrics.push(...coreMetrics);
    passed += coreMetrics.filter((m) => m.pass).length;
    total += coreMetrics.length;
    if (!evaluation.allPassed) allPassed = false;
  }

  // Add overall informational metrics
  allMetrics.push({
    metric: "duration",
    pass: true,
    expected: "(info)",
    actual: `${(totalDurationMs / 1000).toFixed(1)}s`,
  });

  return {
    scenarioId: scenario.id,
    description: scenario.description || "",
    passed,
    total: total + 1,
    allPassed,
    metrics: allMetrics,
    durationMs: totalDurationMs,
    turnResults: turnResults.map((r) => ({ turnIndex: r.turnIndex, evaluation: r.evaluation })),
  };
}

async function runBenchmark(rootDir, args) {
  const options = parseBenchmarkOptions(args);
  const { resolveRegressionContext } = require("../regression/shared.js");
  const context = resolveRegressionContext(rootDir);

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

  for (const rawScenario of scenarios) {
    const scenario = normalizeScenario(rawScenario);
    const maxRetries = Math.max(0, typeof scenario.maxRetries === "number" ? scenario.maxRetries : 0);
    let attempt = 0;
    let lastEvaluation = null;

    while (attempt <= maxRetries) {
      if (attempt > 0) {
        process.stdout.write(`  Retrying (attempt ${attempt + 1}/${maxRetries + 1})...\n`);
      } else {
        process.stdout.write(`\nRunning: ${scenario.id}...\n`);
      }

      const scenarioStart = Date.now();
      let executionError = false;
      const turnResults = [];
      const conversationId = `bench-${scenario.id}-${scenarioStart}-${attempt}`;

      // Suppress noisy agent logs during execution
      const prevLogLevel = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = "warn";

      try {
        for (let i = 0; i < scenario.turns.length; i++) {
          const turn = scenario.turns[i];
          const turnStart = Date.now();

          const state = await service.runFull({
            message: turn.message,
            conversationId,
            context: { locale: scenario.locale || "zh" },
          });

          const turnDurationMs = Date.now() - turnStart;

          if (turn.assertions && turn.assertions.length > 0) {
            const turnScenario = { ...scenario, expect: { assertions: turn.assertions } };
            const evaluation = await evaluateScenario(turnScenario, state, turnDurationMs);
            turnResults.push({ turnIndex: i, evaluation });
          }
        }
      } catch (err) {
        executionError = true;
        const message = err instanceof Error ? err.message : String(err);
        process.stdout.write(`  error: ${message}\n`);
        turnResults.push({
          turnIndex: scenario.turns.length - 1,
          evaluation: {
            scenarioId: scenario.id,
            description: scenario.description || "",
            passed: 0,
            total: 1,
            allPassed: false,
            metrics: [{ metric: "execution", pass: false, expected: "no error", actual: message }],
            durationMs: Date.now() - scenarioStart,
          },
        });
      } finally {
        if (prevLogLevel === undefined) {
          delete process.env.LOG_LEVEL;
        } else {
          process.env.LOG_LEVEL = prevLogLevel;
        }
      }

      const totalDurationMs = Date.now() - scenarioStart;

      if (turnResults.length > 0) {
        if (scenario._multiTurn) {
          lastEvaluation = mergeTurnResults(scenario, turnResults, totalDurationMs);
        } else {
          lastEvaluation = turnResults[0].evaluation;
        }
      }

      if (lastEvaluation && lastEvaluation.allPassed) break;
      if (executionError) break;
      attempt += 1;
    }

    if (!lastEvaluation) {
      lastEvaluation = {
        scenarioId: scenario.id,
        description: scenario.description || "",
        passed: 0,
        total: 1,
        allPassed: false,
        metrics: [{ metric: "execution", pass: false, expected: "no evaluation produced", actual: "(none)" }],
        durationMs: 0,
      };
    }

    printScenarioResult(rawScenario, lastEvaluation);
    results.push(lastEvaluation);
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
