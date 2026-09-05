import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  loadCompareConfig,
  parseCompareOptions,
  requireApiKeys,
  resolvePlan,
} from "./config.mjs";
import { buildComparison, renderComparisonMarkdown } from "./comparator.mjs";
import { runPreflight } from "./preflight.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const RUNNER_SCRIPT = path.join(REPO_ROOT, "tests", "runner.mjs");
const SUBMODULE_RUNNER = path.join(REPO_ROOT, "tests", "llm-benchmark", "runner.cjs");

function loadSubmoduleScenarioCounter() {
  try {
    const require = createRequire(import.meta.url);
    const benchmark = require(SUBMODULE_RUNNER);
    return (selection) => benchmark.loadScenarios(selection).length;
  } catch (err) {
    throw new Error(
      "The llm-benchmark submodule is not available. "
      + `Run \`git submodule update --init\` before running this command (${err.message}).`,
    );
  }
}

export function countPlannedScenarios(plan) {
  const counter = loadSubmoduleScenarioCounter();
  return counter({
    scenarioId: plan.selection.scenarioId,
    taskFamily: plan.selection.taskFamily,
  });
}

export function printPlan(plan, scenarioCount, write = (line) => process.stdout.write(`${line}\n`)) {
  const selection = plan.selection.scenarioId
    ? `single scenario ${plan.selection.scenarioId}`
    : plan.selection.taskFamily
      ? `task family ${plan.selection.taskFamily}`
      : plan.smoke
        ? "smoke"
        : "full corpus";
  write("LLM benchmark comparison plan");
  write(`  Config: ${plan.configPath}`);
  write(`  Output dir: ${plan.outputDir}`);
  write(`  Case timeout: ${plan.caseTimeoutMs}ms`);
  write(`  Selection: ${selection} (${scenarioCount} scenario run(s) per target)`);
  write("  Targets (executed sequentially, identical corpus and judge):");
  for (const [index, target] of plan.targets.entries()) {
    write(`    ${index + 1}. ${target.name} — ${target.label}`);
    write(`       base URL: ${target.baseUrl}`);
    write(`       model: ${target.model}`);
    write(`       vision model: ${target.visionModel} (same as target)`);
    write(`       api key env: ${target.apiKeyEnv} (${target.apiKeyAvailable ? "set" : "NOT SET"})`);
    write(`       results: ${target.resultsPath}`);
    write(`       isolated data dir: ${target.runtimeDataDir}`);
    write(`       benchmark db: ${target.databaseUrl}`);
  }
  write("  Judge (fixed and shared by both targets):");
  write(`       base URL: ${plan.judge.baseUrl}`);
  write(`       model: ${plan.judge.model}`);
  write(`       api key env: ${plan.judge.apiKeyEnv} (${plan.judge.apiKeyAvailable ? "set" : "NOT SET"})`);
}

async function spawnBenchmarkRun(command, args, options) {
  const spawnImpl = options.spawnImpl || spawn;
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", (err) => resolve({ code: null, signal: null, error: err }));
  });
}

export function buildTargetEnv(plan, target, { judgeApiKey, targetApiKey }) {
  return {
    ...process.env,
    SCLAW_ROOT: plan.rootDir,
    SCLAW_DATA_DIR: target.runtimeDataDir,
    DATABASE_URL: target.databaseUrl,
    LLM_BASE_URL: target.baseUrl,
    LLM_MODEL: target.model,
    LLM_API_KEY: targetApiKey,
    // Each target run exercises its own native vision as part of the SUT:
    // without LLM_VISION_MODEL the attachment summarizer is never created and
    // image attachments never reach the agent (see issue #304 correction).
    LLM_VISION_BASE_URL: target.baseUrl,
    LLM_VISION_MODEL: target.visionModel,
    LLM_VISION_API_KEY: targetApiKey,
    LLM_JUDGE_BASE_URL: plan.judge.baseUrl,
    LLM_JUDGE_MODEL: plan.judge.model,
    LLM_JUDGE_API_KEY: judgeApiKey,
  };
}

// The backend resolves its analysis Python as `$SCLAW_DATA_DIR/.venv/bin/python`
// and otherwise falls back to the system python3, which lacks the analysis
// runtime dependencies (e.g. fastapi) — a failure mode observed live when a
// compare target's isolated data dir replaced the shared workspace. Resolution:
// SCLAW_BENCHMARK_PYTHON_BIN verbatim, else the shared home venv interpreter,
// else null (write no settings file and preserve the previous behavior).
export function resolveAnalysisPythonBin({
  env = process.env,
  homedir = os.homedir(),
  platform = process.platform,
} = {}) {
  const fromEnv = env.SCLAW_BENCHMARK_PYTHON_BIN?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const venvLayout = platform === "win32" ? "Scripts/python.exe" : "bin/python";
  const venvPython = path.join(homedir, ".structureclaw", ".venv", venvLayout);
  return fs.existsSync(venvPython) ? venvPython : null;
}

function readResultsFile(resultsPath, targetName) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Benchmark run for target "${targetName}" did not produce a readable result file at `
      + `${resultsPath}: ${err.message}. Inspect the benchmark output above for the failure.`,
    );
  }
  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error(
      `Benchmark result for target "${targetName}" at ${resultsPath} contains no scenario results.`,
    );
  }
  return parsed;
}

async function runTargetBenchmark(plan, target, deps) {
  const judgeApiKey = process.env[plan.judge.apiKeyEnv];
  const targetApiKey = process.env[target.apiKeyEnv];
  const childEnv = buildTargetEnv(plan, target, { judgeApiKey, targetApiKey });

  // Fresh per-run data-dir workspace: with no settings.json present, runtime
  // settings cannot override the model-under-test environment variables.
  fs.rmSync(target.runtimeDataDir, { recursive: true, force: true });
  fs.mkdirSync(target.runtimeDataDir, { recursive: true });
  // The benchmark runner writes its result JSON with a bare writeFileSync and
  // no mkdir, so the per-target directory must exist before the (potentially
  // hours-long) run completes, or the results would be lost at write time.
  fs.mkdirSync(path.dirname(target.resultsPath), { recursive: true });
  // Written after the wipe so each run starts clean; analysis-only on purpose —
  // per-target LLM isolation must keep flowing from the env vars in childEnv.
  const analysisPythonBin = resolveAnalysisPythonBin();
  if (analysisPythonBin) {
    fs.writeFileSync(
      path.join(target.runtimeDataDir, "settings.json"),
      `${JSON.stringify({ analysis: { pythonBin: analysisPythonBin } }, null, 2)}\n`,
    );
  }

  const args = [
    RUNNER_SCRIPT,
    "llm-benchmark",
    "--output",
    target.resultsPath,
    "--case-timeout-ms",
    String(plan.caseTimeoutMs),
  ];
  if (plan.selection.scenarioId) {
    args.push("--scenario", plan.selection.scenarioId);
  }
  if (plan.selection.taskFamily) {
    args.push("--family", plan.selection.taskFamily);
  }

  deps.write(
    `\n==> Benchmarking target "${target.name}" (${target.model}) at ${target.baseUrl}\n`,
  );
  const { code, signal, error } = await spawnBenchmarkRun(process.execPath, args, {
    spawnImpl: deps.spawnImpl,
    cwd: plan.rootDir,
    env: childEnv,
  });
  if (error) {
    throw new Error(`Failed to start the benchmark runner for target "${target.name}": ${error.message}`);
  }
  if (code !== 0) {
    deps.write(
      `\n[warn] Benchmark runner for target "${target.name}" exited with code ${code}`
      + `${signal ? ` (signal ${signal})` : ""}; comparing the scenarios that completed.\n`,
    );
  }
  return readResultsFile(target.resultsPath, target.name);
}

function writeTextFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

export async function runLlmBenchmarkCompare(args, deps = {}) {
  const options = parseCompareOptions(args);
  if (options.help) {
    printCompareHelp();
    return;
  }
  const write = deps.write || ((line) => process.stdout.write(`${line}\n`));
  // runTargetBenchmark calls deps.write unconditionally, so the defaulted
  // writer must be threaded through; plain CLI execution passes deps = {}.
  const effectiveDeps = { ...deps, write };
  const config = loadCompareConfig(options.config);
  const plan = resolvePlan({ options, config, env: process.env, rootDir: REPO_ROOT });
  const scenarioCount = countPlannedScenarios(plan);
  printPlan(plan, scenarioCount, write);

  if (options.dryRun) {
    write("Dry run: no pre-flight checks performed, no scenarios executed.");
    return;
  }

  requireApiKeys(plan);
  await runPreflight(plan, {
    fetchImpl: deps.fetchImpl,
    env: process.env,
    // Preflight streams progress mid-line, so its default stays raw stdout;
    // an injected writer must receive it instead of hardcoded stdout.
    write: deps.write || ((line) => process.stdout.write(line)),
  });

  fs.mkdirSync(plan.outputDir, { recursive: true });
  const results = [];
  for (const target of plan.targets) {
    const result = await runTargetBenchmark(plan, target, effectiveDeps);
    results.push(result);
  }

  const comparison = buildComparison(results[0], results[1], {
    targetNames: { a: plan.targets[0].name, b: plan.targets[1].name },
    labels: { a: plan.targets[0].label, b: plan.targets[1].label },
    resultsPaths: {
      a: path.relative(plan.rootDir, plan.targets[0].resultsPath) || plan.targets[0].resultsPath,
      b: path.relative(plan.rootDir, plan.targets[1].resultsPath) || plan.targets[1].resultsPath,
    },
  });
  const comparisonJsonPath = path.join(plan.outputDir, "comparison.json");
  const comparisonMarkdownPath = path.join(plan.outputDir, "comparison.md");
  writeTextFile(comparisonJsonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  const markdown = renderComparisonMarkdown(comparison);
  writeTextFile(comparisonMarkdownPath, `${markdown}\n`);

  write(`\nComparison written to ${comparisonJsonPath}`);
  write(`Comparison written to ${comparisonMarkdownPath}\n`);
  write(markdown);
}

function printCompareHelp() {
  process.stdout.write(`StructureClaw dual-target LLM benchmark comparison

Usage:
  node tests/runner.mjs llm-benchmark-compare --output-dir <dir> [options]

Runs the public llm-benchmark once per configured target (sequentially,
identical corpus, judge, and configuration; only the model-under-test env
differs), then writes comparison.json + comparison.md side-by-side reports.

Options:
  --config <path>        Targets config JSON (default: tests/llm-benchmark-compare/targets.json)
                         declares per-target name, base URL, model ID, and the
                         env-var name holding its API key.
  --output-dir <dir>     Required. Result JSON per target, comparison.json, and
                         comparison.md are written here.
  --dry-run              Print the resolved plan (targets, judge, corpus size,
                         case timeout, output paths) without executing anything.
  --smoke                Run one standard-workflow scenario per target before a
                         full corpus run (provider integration smoke).
  --scenario <id>        Run a single scenario by ID on both targets.
  --family <taskFamily>  Run one task family on both targets
                         (${["standard_workflow", "interactive_robustness", "multimodal_reverse_engineering"].join(" | ")}).
  --case-timeout-ms <n>  Per-scenario timeout (default: 1800000, sized for
                         long-context local reasoning models).

Environment (key values are resolved from the environment and never logged or
committed): per-target API key env var and judge API key env var as declared in
the config; LLM_BENCHMARK_PROVIDER_REQUEST_TIMEOUT_MS is passed through to the
benchmark runner. Optional SCLAW_BENCHMARK_PYTHON_BIN overrides the analysis
python pinned into each target workspace's settings.json.

Each target run gets an isolated SCLAW_DATA_DIR workspace with fresh settings,
so a settings.json LLM override cannot redirect the model under test, and a
dedicated SQLite DATABASE_URL, mirroring CI's benchmark database pattern. The
seeded settings.json is analysis-only (analysis.pythonBin); all LLM config
comes from the environment.
`);
}
