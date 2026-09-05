// Test entry point, executed via `node --test` — invisible to static reachability.
// fallow-ignore-file unused-file
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildComparison, COMPARISON_SCHEMA_VERSION, renderComparisonMarkdown } from "./comparator.mjs";

// Synthetic benchmark-result fixtures mirroring the public benchmark runner's
// JSON output (tests/llm-benchmark/runner.cjs `buildRunMetadata` and
// tests/llm-benchmark/lib/report.cjs `writeJsonOutput`), so the comparator is
// exercised against realistic records. Deterministic; no network, no LLM.

const FIXED_FINGERPRINTS = {
  scenarioHash: "fp-scenario-0000000001",
  scenarioOrderHash: "fp-order-00000000001",
  attachmentHash: "fp-attach-0000000001",
  promptAndToolHash: "fp-prompt-000000001",
  evaluationHash: "fp-eval-00000000001",
  runtimeConfigHash: "fp-runtime-00000001",
};

const JUDGE_IDENTITY = {
  model: "judge-model-fixed",
  endpoint: "https://127.0.0.1:8443/v1",
};

function buildScenario(overrides = {}) {
  return {
    scenarioId: "std-beam-6m-gt-repeat",
    baseScenarioId: "std-beam-6m-gt",
    split: "core",
    taskFamily: "standard_workflow",
    locale: "en",
    structureType: "beam",
    benchmarkStructureType: "beam",
    inputModality: "text",
    mode: "auto",
    allPassed: true,
    retries: { attempts: 1, passAt1: true },
    metrics: [{ metric: "totalTokens", pass: true, expected: "(info)", actual: "1000" }],
    durationMs: 60000,
    turnResults: [],
    ...overrides,
  };
}

function buildRunResult(overrides = {}) {
  const {
    scenarios = [buildScenario()],
    model = "model-under-test-a",
    visionModel = model,
    runId = "run-a-00000000",
    fingerprints = FIXED_FINGERPRINTS,
    revisions = {
      structureclaw: { revision: "rev-structureclaw-0001" },
      benchmark: { revision: "rev-benchmark-0000001" },
    },
    judge = JUDGE_IDENTITY,
    endpoint = "http://127.0.0.1:7999/v1",
    completed = true,
    run: runOverrides = {},
  } = overrides;

  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    totalScenarios: scenarios.length,
    run: {
      schemaVersion: "structureclaw-benchmark-run/v3",
      runId,
      startedAt: "2026-01-01T00:00:00.000Z",
      plannedScenarioCount: scenarios.length,
      selection: { scenarioId: null, taskFamily: null, caseTimeoutMs: 1800000 },
      models: {
        primary: { model, endpoint },
        judge: { model: judge.model, endpoint: judge.endpoint },
        vision: visionModel ? { model: visionModel, endpoint } : null,
      },
      revisions,
      fingerprints,
      completedScenarioCount: scenarios.length,
      completed,
      ...runOverrides,
    },
    scenarios,
  };
}

const COMPARE_OPTIONS = {
  targetNames: { a: "model-a", b: "model-b" },
  labels: { a: "Model A", b: "Model B" },
  resultsPaths: { a: "out/model-a/results.json", b: "out/model-b/results.json" },
  generatedAt: "2026-01-01T00:00:00.000Z",
};

function makeScenario(id, {
  pass = true,
  family = "standard_workflow",
  locale = "en",
  structure = "beam",
  structureType = structure,
  tokens = "1000",
  durationMs = 60000,
  attempts,
} = {}) {
  const effectiveAttempts = attempts ?? (pass ? 1 : 2);
  const overrides = {
    scenarioId: id,
    taskFamily: family,
    locale,
    benchmarkStructureType: structure,
    structureType,
    allPassed: pass,
    retries: { attempts: effectiveAttempts, passAt1: pass && effectiveAttempts <= 1 },
    metrics: [{ metric: "totalTokens", pass: true, expected: "(info)", actual: tokens }],
    durationMs,
  };
  return buildScenario(overrides);
}

function pairedResults(specs) {
  const scenariosA = specs.map((spec) => makeScenario(spec.id, spec.a));
  const scenariosB = specs.map((spec) => makeScenario(spec.id, spec.b));
  return [
    buildRunResult({ scenarios: scenariosA, model: "model-a" }),
    buildRunResult({ scenarios: scenariosB, model: "model-b" }),
  ];
}

test("buildComparison compares differing pass rates and names the leader", () => {
  const [resultA, resultB] = pairedResults([
    { id: "s1", a: { pass: true }, b: { pass: true } },
    { id: "s2", a: { pass: true }, b: { pass: false } },
    { id: "s3", a: { pass: true }, b: { pass: true } },
    { id: "s4", a: { pass: false }, b: { pass: false } },
  ]);

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.equal(comparison.overall.a.total, 4);
  assert.equal(comparison.overall.a.passed, 3);
  assert.equal(comparison.overall.b.passed, 2);
  assert.deepEqual(comparison.overall.passRate, { a: 0.75, b: 0.5, delta: -0.25, leader: "model-a" });
  assert.deepEqual(comparison.overall.passAt1Rate, { a: 0.75, b: 0.5, delta: -0.25, leader: "model-a" });
});

test("buildComparison reports a tie when both sides score identically", () => {
  const [resultA, resultB] = pairedResults([
    { id: "s1", a: { pass: true }, b: { pass: true } },
    { id: "s2", a: { pass: false }, b: { pass: false } },
  ]);

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.deepEqual(comparison.overall.passRate, { a: 0.5, b: 0.5, delta: 0, leader: "tie" });
});

test("buildComparison counts pass@1 separately from eventual pass", () => {
  const [resultA, resultB] = pairedResults([
    {
      id: "s1",
      a: { pass: true, attempts: 2 },
      b: { pass: true, attempts: 1 },
    },
  ]);

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.equal(comparison.overall.a.passed, 1);
  assert.equal(comparison.overall.a.passAt1, 0);
  assert.equal(comparison.overall.b.passAt1, 1);
  assert.deepEqual(comparison.overall.passAt1Rate, { a: 0, b: 1, delta: 1, leader: "model-b" });
});

test("buildComparison honors an explicit retries.passAt1 verdict", () => {
  const [resultA, resultB] = pairedResults([
    { id: "s1", a: { pass: true, attempts: 3 }, b: { pass: true, attempts: 1 } },
  ]);
  // attempts 3 would otherwise not count as pass@1; an explicit true verdict wins.
  resultA.scenarios[0].retries = { attempts: 3, passAt1: true };

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.equal(comparison.overall.a.passAt1, 1);
});

test("buildComparison breaks results down by task family", () => {
  const [resultA, resultB] = pairedResults([
    { id: "s1", a: { pass: true }, b: { pass: true } },
    { id: "s2", a: { pass: false }, b: { pass: true } },
    {
      id: "s3",
      a: { pass: false, family: "interactive_robustness" },
      b: { pass: false, family: "interactive_robustness" },
    },
  ]);

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  const standard = comparison.breakdowns.taskFamily.standard_workflow;
  assert.deepEqual(
    { total: standard.a.total, passed: standard.a.passed, rate: standard.a.passRate },
    { total: 2, passed: 1, rate: 0.5 },
  );
  assert.deepEqual(
    { total: standard.b.total, passed: standard.b.passed, rate: standard.b.passRate },
    { total: 2, passed: 2, rate: 1 },
  );
  const interactive = comparison.breakdowns.taskFamily.interactive_robustness;
  assert.equal(interactive.a.passed, 0);
  assert.equal(interactive.b.passed, 0);
});

test("buildComparison breaks results down by locale", () => {
  const [resultA, resultB] = pairedResults([
    { id: "s1", a: { pass: true }, b: { pass: false } },
    { id: "s2", a: { pass: true, locale: "zh" }, b: { pass: false, locale: "zh" } },
    { id: "s3", a: { pass: true }, b: { pass: true } },
  ]);

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.deepEqual(
    { total: comparison.breakdowns.locale.en.a.total, passed: comparison.breakdowns.locale.en.a.passed },
    { total: 2, passed: 2 },
  );
  assert.equal(comparison.breakdowns.locale.en.b.passed, 1);
  assert.equal(comparison.breakdowns.locale.zh.a.passed, 1);
  assert.equal(comparison.breakdowns.locale.zh.b.passed, 0);
});

test("buildComparison breaks results down by structure type with an unset fallback", () => {
  const [resultA, resultB] = pairedResults([
    { id: "s1", a: { pass: true, structure: "beam" }, b: { pass: true, structure: "beam" } },
    {
      id: "s2",
      a: { pass: true, structure: null, structureType: "frame" },
      b: { pass: false, structure: null, structureType: "frame" },
    },
    {
      id: "s3",
      a: { pass: false, structure: null, structureType: null },
      b: { pass: false, structure: null, structureType: null },
    },
  ]);

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.deepEqual(Object.keys(comparison.breakdowns.structureType), ["(unset)", "beam", "frame"]);
  assert.equal(comparison.breakdowns.structureType.beam.a.total, 1);
  assert.equal(comparison.breakdowns.structureType.frame.b.total, 1);
  assert.equal(comparison.breakdowns.structureType["(unset)"].a.passed, 0);
});

test("buildComparison buckets failed scenarios into onlyA, onlyB, and both", () => {
  const [resultA, resultB] = pairedResults([
    { id: "s1", a: { pass: false }, b: { pass: true } },
    { id: "s2", a: { pass: true }, b: { pass: false } },
    { id: "s3", a: { pass: false }, b: { pass: false } },
    { id: "s4", a: { pass: true }, b: { pass: true } },
  ]);

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.deepEqual(comparison.failedDiff, { onlyA: ["s1"], onlyB: ["s2"], both: ["s3"] });
});

test("buildComparison averages primary-model tokens and scenario duration", () => {
  const [resultA, resultB] = pairedResults([
    { id: "s1", a: { tokens: "1000", durationMs: 60000 }, b: { tokens: "500", durationMs: 45000 } },
    { id: "s2", a: { tokens: "2000", durationMs: 90000 }, b: { tokens: "500", durationMs: 45000 } },
    { id: "s3", a: { tokens: "3000", durationMs: 120000 }, b: { tokens: "1000", durationMs: 45001 } },
  ]);

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.equal(comparison.averages.primaryTokens.a, 2000);
  assert.equal(comparison.averages.primaryTokens.b, 666.7);
  assert.equal(comparison.averages.durationMs.a, 90000);
  assert.equal(comparison.averages.durationMs.b, 45000);
});

test("buildComparison reports null averages when no token metrics exist", () => {
  const stripTokens = (result) => ({
    ...result,
    scenarios: result.scenarios.map((scenario) => ({ ...scenario, metrics: [] })),
  });
  const [resultA, resultB] = pairedResults([{ id: "s1" }, { id: "s2" }]);

  const comparison = buildComparison(stripTokens(resultA), stripTokens(resultB), COMPARE_OPTIONS);

  assert.equal(comparison.averages.primaryTokens.a, null);
  assert.equal(comparison.averages.primaryTokens.b, null);
});

test("buildComparison records fingerprint and revision fairness checks", () => {
  const resultA = buildRunResult({ scenarios: [makeScenario("s1")] });
  const resultB = buildRunResult({
    scenarios: [makeScenario("s1")],
    fingerprints: { ...FIXED_FINGERPRINTS, evaluationHash: "fp-eval-different" },
    revisions: {
      structureclaw: { revision: "rev-structureclaw-0001" },
      benchmark: { revision: "rev-benchmark-0000002" },
    },
  });

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.equal(comparison.fairness.scenarioCorpusIdentical, true);
  const byKey = Object.fromEntries(comparison.fairness.fingerprints.map((entry) => [entry.key, entry]));
  assert.equal(byKey.scenarioHash.match, true);
  assert.equal(byKey.evaluationHash.match, false);
  assert.equal(comparison.fairness.revisions.structureclaw.match, true);
  assert.equal(comparison.fairness.revisions.benchmark.match, false);
});

test("buildComparison records each target's identity including its vision model", () => {
  const resultA = buildRunResult({
    scenarios: [makeScenario("s1")],
    model: "org/model-a",
    runId: "run-a",
    endpoint: "http://127.0.0.1:7999/v1",
  });
  const resultB = buildRunResult({
    scenarios: [makeScenario("s1")],
    model: "org/model-b",
    runId: "run-b",
    endpoint: "http://127.0.0.1:8002/v1",
    completed: false,
  });

  const comparison = buildComparison(resultA, resultB, { ...COMPARE_OPTIONS, targetNames: { a: "model-a", b: "model-b" } });

  assert.deepEqual(
    { ...comparison.targets.a },
    {
      name: "model-a",
      label: "Model A",
      model: "org/model-a",
      // Binding correction (issue #304): each target run sets LLM_VISION_MODEL
      // to the target model ID, so the fingerprinted vision identity is the
      // model under test itself.
      visionModel: "org/model-a",
      endpoint: "http://127.0.0.1:7999/v1",
      runId: "run-a",
      resultsPath: "out/model-a/results.json",
      plannedScenarioCount: 1,
      completedScenarioCount: 1,
      completed: true,
    },
  );
  assert.equal(comparison.targets.b.visionModel, "org/model-b");
  assert.equal(comparison.targets.b.completed, false);
  assert.equal(comparison.fairness.judge.model, JUDGE_IDENTITY.model);
  assert.equal(comparison.fairness.judge.endpoint, JUDGE_IDENTITY.endpoint);
  assert.equal(comparison.fairness.judge.identical, true);
});

test("buildComparison stamps the schema version, generation time, and local-run context", () => {
  const [resultA, resultB] = pairedResults([{ id: "s1" }]);

  const comparison = buildComparison(resultA, resultB, COMPARE_OPTIONS);

  assert.equal(comparison.schemaVersion, COMPARISON_SCHEMA_VERSION);
  assert.equal(comparison.generatedAt, "2026-01-01T00:00:00.000Z");
  assert.match(comparison.context, /locally served/);
  assert.match(comparison.context, /fixed/);
});

test("buildComparison rejects runs with mismatched scenario corpora", () => {
  const resultA = buildRunResult({ scenarios: [makeScenario("s1"), makeScenario("s2")] });
  const resultB = buildRunResult({ scenarios: [makeScenario("s1"), makeScenario("s3")] });

  assert.throws(() => buildComparison(resultA, resultB, COMPARE_OPTIONS), (err) => {
    assert.match(err.message, /different scenario corpora/);
    assert.match(err.message, /only in the first result \(e\.g\. s2\)/);
    assert.match(err.message, /only in the second result \(e\.g\. s3\)/);
    return true;
  });
});

test("buildComparison rejects a non-object result", () => {
  const resultA = buildRunResult({ scenarios: [makeScenario("s1")] });

  assert.throws(() => buildComparison(null, resultA, COMPARE_OPTIONS), /Invalid first benchmark result: expected a result JSON object/);
  assert.throws(() => buildComparison(resultA, "nope", COMPARE_OPTIONS), /Invalid second benchmark result: expected a result JSON object/);
});

test("buildComparison rejects a result without scenario results", () => {
  const resultA = buildRunResult({ scenarios: [] });

  assert.throws(
    () => buildComparison(resultA, resultA, COMPARE_OPTIONS),
    /Invalid first benchmark result: "scenarios" is missing or empty/,
  );
});

test("buildComparison rejects scenarios without a scenarioId", () => {
  const resultA = buildRunResult({ scenarios: [makeScenario("s1"), { ...makeScenario(), scenarioId: "" }] });

  assert.throws(
    () => buildComparison(resultA, resultA, COMPARE_OPTIONS),
    /Invalid first benchmark result: scenarios\[1\] has no scenarioId/,
  );
});

test("buildComparison rejects results without the primary model identity", () => {
  const resultA = buildRunResult({ scenarios: [makeScenario("s1")], model: "" });

  assert.throws(
    () => buildComparison(resultA, resultA, COMPARE_OPTIONS),
    /run\.models\.primary\.model is missing/,
  );
});

test("buildComparison rejects results without the shared judge identity", () => {
  const stripJudge = (result) => ({
    ...result,
    run: { ...result.run, models: { ...result.run.models, judge: { model: null, endpoint: null } } },
  });
  const resultA = buildRunResult({ scenarios: [makeScenario("s1")] });

  // Both sides missing the judge identity must fail rather than silently
  // report fairness.identical from null === null.
  assert.throws(
    () => buildComparison(stripJudge(resultA), stripJudge(resultA), COMPARE_OPTIONS),
    /Invalid first benchmark result: run\.models\.judge model\/endpoint is missing/,
  );
});

test("buildComparison rejects runs scored by different judges", () => {
  const resultA = buildRunResult({ scenarios: [makeScenario("s1")] });
  const resultB = buildRunResult({
    scenarios: [makeScenario("s1")],
    judge: { model: "a-different-judge", endpoint: JUDGE_IDENTITY.endpoint },
  });

  assert.throws(() => buildComparison(resultA, resultB, COMPARE_OPTIONS), (err) => {
    assert.match(err.message, /different judges/);
    assert.match(err.message, /a-different-judge/);
    assert.match(err.message, /same fixed judge endpoint, model, and parameters/);
    return true;
  });
});

test("renderComparisonMarkdown renders headline, breakdowns, diff, and fingerprints", () => {
  const resultA = buildRunResult({
    scenarios: [
      makeScenario("s1", { tokens: "1000", durationMs: 60000 }),
      makeScenario("s2", { pass: false }),
      makeScenario("s3", { locale: "zh", structure: "frame" }),
      makeScenario("s4", { pass: false }),
      makeScenario("s5", { pass: false, locale: "zh", structure: "frame" }),
    ],
    model: "org/model-a",
    visionModel: "org/model-a",
    runId: "run-a",
  });
  const resultB = buildRunResult({
    scenarios: [
      makeScenario("s1", { tokens: "1500", durationMs: 30000 }),
      makeScenario("s2", { tokens: "1500", durationMs: 30000 }),
      makeScenario("s3", { pass: false, tokens: "1500", durationMs: 30000, locale: "zh", structure: "frame" }),
      makeScenario("s4", { tokens: "1500", durationMs: 30000 }),
      makeScenario("s5", { pass: false, tokens: "1500", durationMs: 30000, locale: "zh", structure: "frame" }),
    ],
    model: "org/model-b",
    visionModel: "org/model-b",
    runId: "run-b",
    fingerprints: { ...FIXED_FINGERPRINTS, evaluationHash: "fp-eval-different" },
  });

  const markdown = renderComparisonMarkdown(
    buildComparison(resultA, resultB, { ...COMPARE_OPTIONS, targetNames: { a: "model-a", b: "model-b" } }),
  );

  assert.match(markdown, /# LLM Benchmark Comparison: Model A vs Model B/);
  assert.match(markdown, /\| Model \| org\/model-a \| org\/model-b \|/);
  assert.match(markdown, /\| Vision model \| org\/model-a \| org\/model-b \|/);
  assert.match(markdown, /Shared judge: `judge-model-fixed` at `https:\/\/127\.0\.0\.1:8443\/v1`/);
  assert.match(markdown, /\| Pass rate \| 2\/5 \(40\.0%\) \| 3\/5 \(60\.0%\) \| model-b \(\+20\.0 pp\) \|/);
  assert.match(markdown, /\| Pass@1 \| 2\/5 \(40\.0%\) \| 3\/5 \(60\.0%\) \| model-b \(\+20\.0 pp\) \|/);
  assert.match(markdown, /\| Avg primary-model tokens \| 1,000 \| 1,500 \|/);
  assert.match(markdown, /\| Avg scenario duration \| 60\.0s \| 30\.0s \|/);
  assert.match(markdown, /## By task family/);
  assert.match(markdown, /## By locale/);
  assert.match(markdown, /## By structure type/);
  assert.match(markdown, /## Failed-scenario diff/);
  assert.match(markdown, /- Failed only on model-a \(2\): s2, s4/);
  assert.match(markdown, /- Failed only on model-b \(1\): s3/);
  assert.match(markdown, /- Failed on both \(1\): s5/);
  assert.match(markdown, /## Run fingerprints/);
  // Fingerprints render truncated to 12 characters plus an ellipsis.
  assert.match(markdown, /\| scenarioHash \| `fp-scenario-…` \| `fp-scenario-…` \| yes \|/);
  assert.match(markdown, /\| evaluationHash [^|]*\| `fp-eval-0000…` \| `fp-eval-diff…` \| NO \|/);
});

test("renderComparisonMarkdown reports a tie headline when rates match", () => {
  const [resultA, resultB] = pairedResults([{ id: "s1", a: { pass: true }, b: { pass: true } }]);

  const markdown = renderComparisonMarkdown(buildComparison(resultA, resultB, COMPARE_OPTIONS));

  assert.match(markdown, /\| Pass rate \| 1\/1 \(100\.0%\) \| 1\/1 \(100\.0%\) \| tie \|/);
});
