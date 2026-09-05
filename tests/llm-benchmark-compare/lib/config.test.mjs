// Test entry point, executed via `node --test` — invisible to static reachability.
// fallow-ignore-file unused-file
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_CONFIG_PATH,
  loadCompareConfig,
  missingApiKeys,
  parseCompareOptions,
  requireApiKeys,
  resolvePlan,
  SMOKE_SCENARIO_ID,
} from "./config.mjs";
import { buildTargetEnv, countPlannedScenarios, printPlan, resolveAnalysisPythonBin, runLlmBenchmarkCompare } from "./orchestrator.mjs";

const CONFIG_SCHEMA_VERSION = "structureclaw-benchmark-compare/v1";

function writeTempFile(t, content, name = "targets.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compare-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  return filePath;
}

function validConfigDocument(overrides = {}) {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ...overrides,
    targets: overrides.targets ?? [
      { name: "alpha", baseUrl: "http://127.0.0.1:7001/v1/", model: "org/model-alpha", apiKeyEnv: "TEST_COMPARE_KEY_A" },
      { name: "beta", baseUrl: "http://127.0.0.1:7002/v1", model: "org/model-beta", apiKeyEnv: "TEST_COMPARE_KEY_B" },
    ],
    judge: overrides.judge ?? {
      baseUrl: "http://127.0.0.1:7003/v1",
      model: "org/judge-model",
      apiKeyEnv: "TEST_COMPARE_KEY_JUDGE",
    },
  };
}

function loadedConfig(t, overrides = {}) {
  return loadCompareConfig(writeTempFile(t, validConfigDocument(overrides)));
}

test("loadCompareConfig parses the shipped targets.json", (t) => {
  const config = loadCompareConfig(DEFAULT_CONFIG_PATH);

  assert.equal(config.schemaVersion, CONFIG_SCHEMA_VERSION);
  assert.equal(config.targets.length, 2);
  assert.equal(config.judge.name, "judge");
  for (const target of config.targets) {
    assert.deepEqual(Object.keys(target).sort(), ["apiKeyEnv", "baseUrl", "label", "model", "name"]);
    assert.match(target.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    assert.match(target.model, /.+/);
    assert.match(target.apiKeyEnv, /^[A-Z_][A-Z0-9_]*$/);
  }
  assert.notEqual(config.targets[0].name, config.targets[1].name);
});

test("loadCompareConfig normalizes base URLs and applies label defaults", (t) => {
  const config = loadedConfig(t);

  assert.equal(config.targets[0].baseUrl, "http://127.0.0.1:7001/v1");
  assert.equal(config.targets[0].label, "alpha");
  assert.equal(config.judge.name, "judge");
  assert.equal(config.judge.label, "judge");
});

test("loadCompareConfig fails with a specific error for unreadable or malformed files", (t) => {
  assert.throws(
    () => loadCompareConfig(path.join(os.tmpdir(), "compare-config-does-not-exist.json")),
    /Cannot read comparison config .*compare-config-does-not-exist\.json/,
  );
  assert.throws(() => loadCompareConfig(writeTempFile(t, "{ not json")), /is not valid JSON/);
  assert.throws(() => loadCompareConfig(writeTempFile(t, "[]")), /must contain a JSON object/);
  assert.throws(
    () => loadCompareConfig(writeTempFile(t, validConfigDocument({ schemaVersion: "other/v1" }))),
    /has schemaVersion "other\/v1"; expected "structureclaw-benchmark-compare\/v1"/,
  );
});

test("loadCompareConfig requires exactly two uniquely named targets", (t) => {
  const single = validConfigDocument();
  single.targets = single.targets.slice(0, 1);
  assert.throws(() => loadCompareConfig(writeTempFile(t, single)), /exactly 2 targets \(got 1\)/);

  const triple = validConfigDocument();
  triple.targets = [...triple.targets, { ...triple.targets[0], name: "gamma" }];
  assert.throws(() => loadCompareConfig(writeTempFile(t, triple)), /exactly 2 targets \(got 3\)/);

  const duplicated = validConfigDocument();
  duplicated.targets = [
    duplicated.targets[0],
    { ...duplicated.targets[1], name: duplicated.targets[0].name },
  ];
  assert.throws(
    () => loadCompareConfig(writeTempFile(t, duplicated)),
    /duplicate target name "alpha"; target names must be unique/,
  );
});

test("loadCompareConfig validates endpoint fields with actionable errors", (t) => {
  assert.throws(
    () => loadedConfig(t, {
      targets: [
        { name: "alpha", baseUrl: "ftp://127.0.0.1:7001/v1", model: "m", apiKeyEnv: "TEST_COMPARE_KEY_A" },
        validConfigDocument().targets[1],
      ],
    }),
    /targets\[0\]\.baseUrl" must be an http\(s\) OpenAI-compatible base URL/,
  );
  assert.throws(
    () => loadedConfig(t, {
      targets: [
        { name: "alpha", baseUrl: "http://127.0.0.1:7001/v1", apiKeyEnv: "TEST_COMPARE_KEY_A" },
        validConfigDocument().targets[1],
      ],
    }),
    /targets\[0\]\.model" must be a non-empty model ID/,
  );
  assert.throws(
    () => loadedConfig(t, {
      targets: [
        { name: "alpha", baseUrl: "http://127.0.0.1:7001/v1", model: "m", apiKeyEnv: "not an env name" },
        validConfigDocument().targets[1],
      ],
    }),
    /targets\[0\]\.apiKeyEnv" must be an environment variable name/,
  );
  assert.throws(
    () => loadedConfig(t, { judge: { baseUrl: "http://127.0.0.1:7003/v1", apiKeyEnv: "TEST_COMPARE_KEY_JUDGE" } }),
    /"judge\.model" must be a non-empty model ID/,
  );
});

test("parseCompareOptions applies defaults and resolves paths", () => {
  const options = parseCompareOptions(["--output-dir", "out"]);

  assert.equal(options.config, path.resolve(DEFAULT_CONFIG_PATH));
  assert.equal(options.outputDir, path.resolve("out"));
  assert.equal(options.scenarioId, null);
  assert.equal(options.taskFamily, null);
  assert.equal(options.caseTimeoutMs, 30 * 60 * 1000);
  assert.equal(options.smoke, false);
  assert.equal(options.dryRun, false);
  assert.equal(options.help, false);
});

test("parseCompareOptions supports scenario, family, smoke, timeout, and dry-run flags", () => {
  const base = ["--output-dir", "out"];

  assert.deepEqual(
    { ...parseCompareOptions([...base, "--scenario", "s1"]) },
    { ...parseCompareOptions([...base, "--scenario", "s1"]), scenarioId: "s1" },
  );
  assert.equal(
    parseCompareOptions([...base, "--task-family", "standard_workflow"]).taskFamily,
    "standard_workflow",
  );
  const smoke = parseCompareOptions([...base, "--smoke"]);
  assert.equal(smoke.smoke, true);
  assert.equal(smoke.scenarioId, SMOKE_SCENARIO_ID);
  assert.equal(parseCompareOptions([...base, "--dry-run"]).dryRun, true);
  assert.equal(parseCompareOptions([...base, "--case-timeout-ms", "42"]).caseTimeoutMs, 42);
  assert.equal(parseCompareOptions(["--help"]).help, true);
});

test("parseCompareOptions rejects invalid or conflicting flags", () => {
  const base = ["--output-dir", "out"];

  assert.throws(() => parseCompareOptions([]), /--output-dir <dir> is required/);
  assert.throws(() => parseCompareOptions([...base, "--bogus"]), /Unknown option for llm-benchmark-compare: --bogus/);
  assert.throws(() => parseCompareOptions([...base, "--config"]), /--config requires a value/);
  assert.throws(
    () => parseCompareOptions([...base, "--smoke", "--scenario", "s1"]),
    /--smoke already selects a single scenario/,
  );
  assert.throws(() => parseCompareOptions([...base, "--smoke", "--family", "standard_workflow"]), /--smoke/);
  assert.throws(() => parseCompareOptions([...base, "--scenario", "s1", "--family", "standard_workflow"]), /either --scenario or --family/);
  assert.throws(
    () => parseCompareOptions([...base, "--family", "unknown_family"]),
    /Unknown task family "unknown_family"/,
  );
  assert.throws(() => parseCompareOptions([...base, "--case-timeout-ms", "abc"]), /positive number of milliseconds/);
  assert.throws(() => parseCompareOptions([...base, "--case-timeout-ms", "0"]), /positive number of milliseconds/);
});

test("parseCompareOptions prints help without requiring --output-dir", () => {
  const options = parseCompareOptions(["--help"]);

  assert.equal(options.help, true);
});

test("resolvePlan lays out per-target result, runtime-data, and database paths", (t) => {
  const config = loadedConfig(t);
  const options = parseCompareOptions([
    "--config", writeTempFile(t, validConfigDocument()),
    "--output-dir", "out",
    "--scenario", "s1",
    "--case-timeout-ms", "1234",
  ]);
  const env = { TEST_COMPARE_KEY_A: "unused", TEST_COMPARE_KEY_JUDGE: "unused" };

  const plan = resolvePlan({ options, config, env, rootDir: "/repo" });

  const outDir = path.resolve("out");
  assert.equal(plan.rootDir, "/repo");
  assert.deepEqual(plan.selection, { scenarioId: "s1", taskFamily: null });
  assert.equal(plan.caseTimeoutMs, 1234);
  assert.equal(plan.targets[0].role, "target 1 of 2");
  assert.equal(plan.targets[1].role, "target 2 of 2");
  assert.equal(plan.targets[0].resultsPath, path.join(outDir, "alpha", "results.json"));
  assert.equal(plan.targets[0].runtimeDataDir, path.join(outDir, "alpha", "runtime-data"));
  assert.equal(plan.targets[0].databaseUrl, `file:${path.join(outDir, "alpha", "benchmark.db")}`);
  // Binding correction (issue #304): the vision model is the target model itself.
  assert.equal(plan.targets[0].visionModel, "org/model-alpha");
  assert.equal(plan.judge.role, "judge");
});

test("resolvePlan reports API-key availability from the environment without reading values", (t) => {
  const config = loadedConfig(t);
  const options = parseCompareOptions(["--output-dir", "out", "--dry-run"]);

  const plan = resolvePlan({
    options,
    config,
    env: { TEST_COMPARE_KEY_A: "unused", TEST_COMPARE_KEY_JUDGE: "unused" },
    rootDir: "/repo",
  });

  assert.equal(plan.targets[0].apiKeyAvailable, true);
  assert.equal(plan.targets[1].apiKeyAvailable, false);
  assert.equal(plan.judge.apiKeyAvailable, true);

  assert.deepEqual(missingApiKeys(plan), ["TEST_COMPARE_KEY_B"]);
});

test("missingApiKeys deduplicates shared env vars across targets and judge", (t) => {
  const config = loadedConfig(t, {
    targets: [
      { name: "alpha", baseUrl: "http://127.0.0.1:7001/v1", model: "m-a", apiKeyEnv: "TEST_COMPARE_SHARED_KEY" },
      { name: "beta", baseUrl: "http://127.0.0.1:7002/v1", model: "m-b", apiKeyEnv: "TEST_COMPARE_SHARED_KEY" },
    ],
    judge: { baseUrl: "http://127.0.0.1:7003/v1", model: "m-j", apiKeyEnv: "TEST_COMPARE_SHARED_KEY" },
  });
  const plan = resolvePlan({
    options: parseCompareOptions(["--output-dir", "out"]),
    config,
    env: {},
    rootDir: "/repo",
  });

  assert.deepEqual(missingApiKeys(plan), ["TEST_COMPARE_SHARED_KEY"]);
  assert.throws(() => requireApiKeys(plan), (err) => {
    assert.match(err.message, /API key environment variable\(s\) not set: TEST_COMPARE_SHARED_KEY/);
    assert.match(err.message, /never written to committed files, logs, or the comparison report/);
    return true;
  });
});

test("printPlan prints the fully resolved plan including judge and selection", () => {
  const plan = {
    configPath: "/repo/targets.json",
    outputDir: "/tmp/compare-out",
    caseTimeoutMs: 1800000,
    smoke: false,
    selection: { scenarioId: "s1", taskFamily: null },
    rootDir: "/repo",
    targets: [
      {
        name: "alpha",
        label: "Alpha",
        baseUrl: "http://127.0.0.1:7001/v1",
        model: "org/model-alpha",
        visionModel: "org/model-alpha",
        apiKeyEnv: "TEST_COMPARE_KEY_A",
        apiKeyAvailable: true,
        resultsPath: "/tmp/compare-out/alpha/results.json",
        runtimeDataDir: "/tmp/compare-out/alpha/runtime-data",
        databaseUrl: "file:/tmp/compare-out/alpha/benchmark.db",
      },
      {
        name: "beta",
        label: "beta",
        baseUrl: "http://127.0.0.1:7002/v1",
        model: "org/model-beta",
        visionModel: "org/model-beta",
        apiKeyEnv: "TEST_COMPARE_KEY_B",
        apiKeyAvailable: false,
        resultsPath: "/tmp/compare-out/beta/results.json",
        runtimeDataDir: "/tmp/compare-out/beta/runtime-data",
        databaseUrl: "file:/tmp/compare-out/beta/benchmark.db",
      },
    ],
    judge: {
      name: "judge",
      label: "judge",
      baseUrl: "http://127.0.0.1:7003/v1",
      model: "org/judge-model",
      apiKeyEnv: "TEST_COMPARE_KEY_JUDGE",
      apiKeyAvailable: true,
    },
  };

  const lines = [];
  printPlan(plan, 3, (line) => lines.push(line));
  const output = lines.join("\n");

  assert.match(output, /LLM benchmark comparison plan/);
  assert.match(output, /Config: \/repo\/targets\.json/);
  assert.match(output, /Output dir: \/tmp\/compare-out/);
  assert.match(output, /Case timeout: 1800000ms/);
  assert.match(output, /Selection: single scenario s1 \(3 scenario run\(s\) per target\)/);
  assert.match(output, /1\. alpha — Alpha/);
  assert.match(output, /base URL: http:\/\/127\.0\.0\.1:7001\/v1/);
  assert.match(output, /model: org\/model-alpha/);
  assert.match(output, /vision model: org\/model-alpha \(same as target\)/);
  assert.match(output, /api key env: TEST_COMPARE_KEY_A \(set\)/);
  assert.match(output, /api key env: TEST_COMPARE_KEY_B \(NOT SET\)/);
  assert.match(output, /results: \/tmp\/compare-out\/alpha\/results\.json/);
  assert.match(output, /isolated data dir: \/tmp\/compare-out\/alpha\/runtime-data/);
  assert.match(output, /benchmark db: file:\/tmp\/compare-out\/alpha\/benchmark\.db/);
  assert.match(output, /Judge \(fixed and shared by both targets\):/);
  assert.match(output, /model: org\/judge-model/);
});

test("printPlan describes family, smoke, and full-corpus selections", () => {
  const basePlan = {
    selection: { scenarioId: null, taskFamily: null },
    smoke: false,
    targets: [],
    judge: { baseUrl: "http://127.0.0.1:7003/v1", model: "org/judge-model", apiKeyEnv: "TEST_COMPARE_KEY_JUDGE", apiKeyAvailable: true },
  };
  const lines = [];
  const collect = (line) => lines.push(line);

  printPlan({ ...basePlan, selection: { scenarioId: null, taskFamily: "standard_workflow" }, smoke: false }, 50, collect);
  printPlan({ ...basePlan, smoke: true }, 1, collect);
  printPlan(basePlan, 150, collect);

  const output = lines.join("\n");
  assert.match(output, /Selection: task family standard_workflow \(50 scenario run\(s\) per target\)/);
  assert.match(output, /Selection: smoke \(1 scenario run\(s\) per target\)/);
  assert.match(output, /Selection: full corpus \(150 scenario run\(s\) per target\)/);
});

test("buildTargetEnv isolates the model under test and pins the vision model to it", (t) => {
  const config = loadedConfig(t);
  const options = parseCompareOptions(["--output-dir", "out"]);
  const plan = resolvePlan({ options, config, env: {}, rootDir: "/repo" });

  const env = buildTargetEnv(plan, plan.targets[0], {
    judgeApiKey: "dummy-judge-key",
    targetApiKey: "dummy-target-key",
  });

  assert.equal(env.SCLAW_ROOT, "/repo");
  assert.equal(env.SCLAW_DATA_DIR, plan.targets[0].runtimeDataDir);
  assert.equal(env.DATABASE_URL, plan.targets[0].databaseUrl);
  assert.equal(env.LLM_BASE_URL, "http://127.0.0.1:7001/v1");
  assert.equal(env.LLM_MODEL, "org/model-alpha");
  assert.equal(env.LLM_API_KEY, "dummy-target-key");
  // Binding correction (issue #304): without LLM_VISION_MODEL the attachment
  // summarizer is never created, so each target run must set it to the target
  // model ID and point it at the target endpoint.
  assert.equal(env.LLM_VISION_BASE_URL, "http://127.0.0.1:7001/v1");
  assert.equal(env.LLM_VISION_MODEL, "org/model-alpha");
  assert.equal(env.LLM_VISION_API_KEY, "dummy-target-key");
  assert.equal(env.LLM_JUDGE_BASE_URL, "http://127.0.0.1:7003/v1");
  assert.equal(env.LLM_JUDGE_MODEL, "org/judge-model");
  assert.equal(env.LLM_JUDGE_API_KEY, "dummy-judge-key");
});

test("resolveAnalysisPythonBin uses SCLAW_BENCHMARK_PYTHON_BIN verbatim when set", () => {
  assert.equal(
    resolveAnalysisPythonBin({
      env: { SCLAW_BENCHMARK_PYTHON_BIN: "/opt/bench-python/bin/python" },
      homedir: "/home/does-not-exist",
      platform: "linux",
    }),
    "/opt/bench-python/bin/python",
  );
});

test("resolveAnalysisPythonBin falls back to the shared home venv interpreter", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "compare-home-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const posixPython = path.join(home, ".structureclaw", ".venv", "bin", "python");
  fs.mkdirSync(path.dirname(posixPython), { recursive: true });
  fs.writeFileSync(posixPython, "");

  assert.equal(resolveAnalysisPythonBin({ env: {}, homedir: home, platform: "linux" }), posixPython);

  const winPython = path.join(home, ".structureclaw", ".venv", "Scripts", "python.exe");
  fs.mkdirSync(path.dirname(winPython), { recursive: true });
  fs.writeFileSync(winPython, "");
  assert.equal(resolveAnalysisPythonBin({ env: {}, homedir: home, platform: "win32" }), winPython);
});

test("resolveAnalysisPythonBin returns null with no env var and no home venv", () => {
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "compare-home-empty-"));
  assert.equal(resolveAnalysisPythonBin({ env: {}, homedir: emptyHome, platform: "linux" }), null);
  // A blank env value must not be written into settings.json.
  assert.equal(resolveAnalysisPythonBin({ env: { SCLAW_BENCHMARK_PYTHON_BIN: "   " }, homedir: emptyHome, platform: "linux" }), null);
});

test("runLlmBenchmarkCompare --dry-run prints the resolved plan and executes nothing", async (t) => {
  try {
    countPlannedScenarios({ selection: { scenarioId: null, taskFamily: null } });
  } catch {
    t.skip("llm-benchmark submodule is not initialized; run `git submodule update --init`");
    return;
  }

  const configPath = writeTempFile(t, validConfigDocument());
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "compare-dry-run-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  const lines = [];
  await runLlmBenchmarkCompare(
    ["--dry-run", "--config", configPath, "--output-dir", outDir, "--scenario", SMOKE_SCENARIO_ID],
    { write: (line) => lines.push(line) },
  );
  const output = lines.join("\n");

  assert.match(output, /LLM benchmark comparison plan/);
  assert.match(output, new RegExp(`Config: ${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Selection: single scenario std-beam-6m-gt-repeat \(1 scenario run\(s\) per target\)/);
  assert.match(output, /1\. alpha — alpha/);
  assert.match(output, /model: org\/model-alpha/);
  assert.match(output, /vision model: org\/model-alpha \(same as target\)/);
  assert.match(output, /2\. beta — beta/);
  assert.match(output, /api key env: TEST_COMPARE_KEY_B \(NOT SET\)/);
  assert.match(output, /Judge \(fixed and shared by both targets\):/);
  assert.match(output, /Dry run: no pre-flight checks performed, no scenarios executed\./);
  // Dry run must not create any run artifacts.
  assert.deepEqual(fs.readdirSync(outDir), []);
});

test("runLlmBenchmarkCompare --help prints usage without requiring --output-dir", async () => {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = (chunk) => {
    output += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  };
  try {
    await runLlmBenchmarkCompare(["--help"]);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(output, /Usage:\n  node tests\/runner\.mjs llm-benchmark-compare --output-dir <dir> \[options\]/);
  assert.match(output, /--dry-run\s+Print the resolved plan/);
  assert.match(output, /never logged or/);
});

function minimalRunResult({ model, endpoint, judgeEndpoint, scenarioId }) {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    totalScenarios: 1,
    run: {
      schemaVersion: "structureclaw-benchmark-run/v3",
      runId: `run-${model.replace(/\W+/g, "-")}`,
      plannedScenarioCount: 1,
      models: {
        primary: { model, endpoint },
        judge: { model: "org/judge-model", endpoint: judgeEndpoint },
        vision: { model, endpoint },
      },
      revisions: { structureclaw: { revision: "rev-1" }, benchmark: { revision: "rev-2" } },
      fingerprints: {
        scenarioHash: "fp-s1",
        scenarioOrderHash: "fp-o1",
        attachmentHash: "fp-a1",
        promptAndToolHash: "fp-p1",
        evaluationHash: "fp-e1",
        runtimeConfigHash: "fp-r1",
      },
      completedScenarioCount: 1,
      completed: true,
    },
    scenarios: [{
      scenarioId,
      taskFamily: "standard_workflow",
      locale: "en",
      structureType: "beam",
      benchmarkStructureType: "beam",
      allPassed: true,
      metrics: [{ metric: "totalTokens", pass: true, expected: "(info)", actual: "100" }],
      durationMs: 1000,
    }],
  };
}

test("runLlmBenchmarkCompare runs both targets end to end and writes the comparison", async (t) => {
  try {
    countPlannedScenarios({ selection: { scenarioId: null, taskFamily: null } });
  } catch {
    t.skip("llm-benchmark submodule is not initialized; run `git submodule update --init`");
    return;
  }

  const configPath = writeTempFile(t, validConfigDocument());
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "compare-run-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  const keyNames = ["TEST_COMPARE_KEY_A", "TEST_COMPARE_KEY_B", "TEST_COMPARE_KEY_JUDGE"];
  for (const [index, name] of keyNames.entries()) process.env[name] = `dummy-key-${index}`;
  t.after(() => {
    for (const name of keyNames) delete process.env[name];
  });

  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, authorization: init?.headers?.Authorization });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: "org/model-alpha" }, { id: "org/model-beta" }, { id: "org/judge-model" }],
      }),
    };
  };

  const spawnCalls = [];
  const results = [
    minimalRunResult({ model: "org/model-alpha", endpoint: "http://127.0.0.1:7001/v1", judgeEndpoint: "http://127.0.0.1:7003/v1", scenarioId: SMOKE_SCENARIO_ID }),
    minimalRunResult({ model: "org/model-beta", endpoint: "http://127.0.0.1:7002/v1", judgeEndpoint: "http://127.0.0.1:7003/v1", scenarioId: SMOKE_SCENARIO_ID }),
  ];
  const spawnImpl = (command, args, options) => {
    const output = args[args.indexOf("--output") + 1];
    const resultsDirExisted = fs.existsSync(path.dirname(output));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(results.shift())}\n`);
    spawnCalls.push({ command, args, env: options.env, resultsDirExisted });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  };

  const lines = [];
  await runLlmBenchmarkCompare(
    ["--config", configPath, "--output-dir", outDir, "--scenario", SMOKE_SCENARIO_ID],
    { write: (line) => lines.push(line), fetchImpl, spawnImpl },
  );
  const output = lines.join("\n");

  // Pre-flight: judge first, then each target, each with its declared key env.
  assert.deepEqual(fetchCalls.map((call) => call.url.endsWith("/models")), [true, true, true]);
  assert.deepEqual(fetchCalls.map((call) => call.authorization), [
    "Bearer dummy-key-2",
    "Bearer dummy-key-0",
    "Bearer dummy-key-1",
  ]);
  // Pre-flight progress must stream through the injected writer, not hardcoded
  // stdout, so test/CI wrappers can capture it.
  assert.match(output, /Pre-flight: checking judge "judge" at /);
  assert.match(output, /Pre-flight: checking target 1 of 2 "alpha" at /);
  assert.match(output, /ok \(serves org\/judge-model\)/);

  // Targets run sequentially with per-target model-under-test env and a
  // shared judge env; the results directory exists before each spawn.
  assert.equal(spawnCalls.length, 2);
  assert.match(spawnCalls[0].args[spawnCalls[0].args.indexOf("--output") + 1], /alpha\/results\.json$/);
  assert.match(spawnCalls[1].args[spawnCalls[1].args.indexOf("--output") + 1], /beta\/results\.json$/);
  assert.deepEqual(spawnCalls.map((call) => call.resultsDirExisted), [true, true]);
  assert.deepEqual(spawnCalls.map((call) => call.env.LLM_MODEL), ["org/model-alpha", "org/model-beta"]);
  assert.deepEqual(spawnCalls.map((call) => call.env.LLM_VISION_MODEL), ["org/model-alpha", "org/model-beta"]);
  for (const call of spawnCalls) {
    assert.equal(call.env.LLM_JUDGE_MODEL, "org/judge-model");
    assert.equal(call.env.LLM_JUDGE_API_KEY, "dummy-key-2");
    assert.deepEqual(
      { scenario: call.args[call.args.indexOf("--scenario") + 1], timeout: call.args[call.args.indexOf("--case-timeout-ms") + 1] },
      { scenario: SMOKE_SCENARIO_ID, timeout: "1800000" },
    );
  }

  // Comparison artifacts land in the output directory.
  const comparison = JSON.parse(fs.readFileSync(path.join(outDir, "comparison.json"), "utf8"));
  assert.deepEqual(
    { a: comparison.targets.a.model, b: comparison.targets.b.model, total: comparison.overall.a.total },
    { a: "org/model-alpha", b: "org/model-beta", total: 1 },
  );
  assert.equal(comparison.fairness.judge.model, "org/judge-model");
  assert.equal(comparison.fairness.judge.endpoint, "http://127.0.0.1:7003/v1");
  assert.ok(fs.existsSync(path.join(outDir, "comparison.md")));
  assert.match(output, /Comparison written to .*comparison\.json/);
  assert.match(output, /Comparison written to .*comparison\.md/);
});

test("runLlmBenchmarkCompare survives deps without a writer and still produces artifacts", async (t) => {
  try {
    countPlannedScenarios({ selection: { scenarioId: null, taskFamily: null } });
  } catch {
    t.skip("llm-benchmark submodule is not initialized; run `git submodule update --init`");
    return;
  }

  const configPath = writeTempFile(t, validConfigDocument());
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "compare-no-writer-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  const keyNames = ["TEST_COMPARE_KEY_A", "TEST_COMPARE_KEY_B", "TEST_COMPARE_KEY_JUDGE"];
  for (const [index, name] of keyNames.entries()) process.env[name] = `dummy-key-${index}`;
  t.after(() => {
    for (const name of keyNames) delete process.env[name];
  });

  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ id: "org/model-alpha" }, { id: "org/model-beta" }, { id: "org/judge-model" }],
    }),
  });
  const results = [
    minimalRunResult({ model: "org/model-alpha", endpoint: "http://127.0.0.1:7001/v1", judgeEndpoint: "http://127.0.0.1:7003/v1", scenarioId: SMOKE_SCENARIO_ID }),
    minimalRunResult({ model: "org/model-beta", endpoint: "http://127.0.0.1:7002/v1", judgeEndpoint: "http://127.0.0.1:7003/v1", scenarioId: SMOKE_SCENARIO_ID }),
  ];
  const spawnImpl = (command, args) => {
    const output = args[args.indexOf("--output") + 1];
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(results.shift())}\n`);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  };

  // Regression: the orchestrator used to call deps.write unconditionally, so
  // plain CLI execution (deps = {}) crashed with "deps.write is not a function".
  const originalWrite = process.stdout.write;
  let stdout = "";
  process.stdout.write = (chunk) => {
    stdout += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  };
  try {
    await runLlmBenchmarkCompare(
      ["--config", configPath, "--output-dir", outDir, "--scenario", SMOKE_SCENARIO_ID],
      { fetchImpl, spawnImpl },
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  // The comparison artifacts are still produced and the defaulted writer
  // carried the plan, target banners, and pre-flight progress to stdout.
  const comparison = JSON.parse(fs.readFileSync(path.join(outDir, "comparison.json"), "utf8"));
  assert.equal(comparison.overall.a.total, 1);
  assert.ok(fs.existsSync(path.join(outDir, "comparison.md")));
  assert.match(stdout, /LLM benchmark comparison plan/);
  assert.match(stdout, /Pre-flight: checking judge "judge" at /);
  assert.match(stdout, /==> Benchmarking target "alpha"/);
  assert.match(stdout, /Comparison written to .*comparison\.json/);
});

// Shared harness for the analysis-python seeding tests: a fully stubbed
// two-target compare run through the real orchestration seam, with a probe
// that captures the workspace state each spawn sees.
async function runStubbedCompare(t, { prepare, spawnProbe }) {
  const configPath = writeTempFile(t, validConfigDocument());
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "compare-python-bin-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  const keyNames = ["TEST_COMPARE_KEY_A", "TEST_COMPARE_KEY_B", "TEST_COMPARE_KEY_JUDGE"];
  for (const [index, name] of keyNames.entries()) process.env[name] = `dummy-key-${index}`;
  t.after(() => {
    for (const name of keyNames) delete process.env[name];
  });

  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ id: "org/model-alpha" }, { id: "org/model-beta" }, { id: "org/judge-model" }],
    }),
  });
  const results = [
    minimalRunResult({ model: "org/model-alpha", endpoint: "http://127.0.0.1:7001/v1", judgeEndpoint: "http://127.0.0.1:7003/v1", scenarioId: SMOKE_SCENARIO_ID }),
    minimalRunResult({ model: "org/model-beta", endpoint: "http://127.0.0.1:7002/v1", judgeEndpoint: "http://127.0.0.1:7003/v1", scenarioId: SMOKE_SCENARIO_ID }),
  ];
  const spawnImpl = (command, args, options) => {
    if (spawnProbe) spawnProbe(options.env.SCLAW_DATA_DIR);
    const output = args[args.indexOf("--output") + 1];
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(results.shift())}\n`);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  };

  if (prepare) prepare(outDir);
  await runLlmBenchmarkCompare(
    ["--config", configPath, "--output-dir", outDir, "--scenario", SMOKE_SCENARIO_ID],
    { write: () => {}, fetchImpl, spawnImpl },
  );
  return outDir;
}

test("orchestration seeds each isolated workspace with an analysis-only settings.json", async (t) => {
  try {
    countPlannedScenarios({ selection: { scenarioId: null, taskFamily: null } });
  } catch {
    t.skip("llm-benchmark submodule is not initialized; run `git submodule update --init`");
    return;
  }

  const pythonBin = "/opt/bench-python/bin/python";
  process.env.SCLAW_BENCHMARK_PYTHON_BIN = pythonBin;
  t.after(() => {
    delete process.env.SCLAW_BENCHMARK_PYTHON_BIN;
  });

  const settingsAtSpawn = [];
  const outDir = await runStubbedCompare(t, {
    // A stale settings file carrying an LLM override must be wiped by the run:
    // observing only the analysis key at spawn time proves the write happens
    // after the wipe (the file is replaced, not merged).
    prepare: (dir) => {
      fs.mkdirSync(path.join(dir, "alpha", "runtime-data"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "alpha", "runtime-data", "settings.json"),
        `${JSON.stringify({ llm: { model: "stale-override" } })}\n`,
      );
    },
    spawnProbe: (dataDir) => {
      settingsAtSpawn.push(JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")));
    },
  });

  assert.deepEqual(settingsAtSpawn, [
    { analysis: { pythonBin } },
    { analysis: { pythonBin } },
  ]);
  for (const target of ["alpha", "beta"]) {
    const seeded = JSON.parse(fs.readFileSync(path.join(outDir, target, "runtime-data", "settings.json"), "utf8"));
    // Exactly one key path: analysis.pythonBin, and never any LLM config —
    // per-target model isolation must keep flowing from the env vars.
    assert.deepEqual(seeded, { analysis: { pythonBin } });
    assert.deepEqual(Object.keys(seeded), ["analysis"]);
    assert.deepEqual(Object.keys(seeded.analysis), ["pythonBin"]);
  }
});

test("orchestration writes no settings.json when no analysis python resolves", async (t) => {
  try {
    countPlannedScenarios({ selection: { scenarioId: null, taskFamily: null } });
  } catch {
    t.skip("llm-benchmark submodule is not initialized; run `git submodule update --init`");
    return;
  }

  const originalHome = process.env.HOME;
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "compare-empty-home-"));
  t.after(() => fs.rmSync(emptyHome, { recursive: true, force: true }));
  t.after(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    delete process.env.SCLAW_BENCHMARK_PYTHON_BIN;
  });

  let spawnCount = 0;
  const outDir = await runStubbedCompare(t, {
    prepare: () => {
      delete process.env.SCLAW_BENCHMARK_PYTHON_BIN;
      // os.homedir() honors $HOME on POSIX; an empty home has no shared venv.
      process.env.HOME = emptyHome;
    },
    spawnProbe: () => {
      spawnCount += 1;
    },
  });

  assert.equal(spawnCount, 2);
  for (const target of ["alpha", "beta"]) {
    assert.equal(fs.existsSync(path.join(outDir, target, "runtime-data")), true);
    assert.equal(fs.existsSync(path.join(outDir, target, "runtime-data", "settings.json")), false);
  }
});
