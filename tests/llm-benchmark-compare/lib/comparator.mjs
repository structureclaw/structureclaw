/**
 * Pure dual-run comparator for the llm-benchmark comparison command.
 *
 * Input: the two per-target benchmark result JSONs written by the public
 * benchmark runner (tests/llm-benchmark/lib/report.cjs `writeJsonOutput`).
 * Output: a comparison object plus a Markdown rendering. No I/O, no network.
 */
export const COMPARISON_SCHEMA_VERSION = "structureclaw-benchmark-comparison/v1";

const TOKEN_METRIC = "totalTokens";
const FINGERPRINT_KEYS = [
  "scenarioHash",
  "scenarioOrderHash",
  "attachmentHash",
  "promptAndToolHash",
  "evaluationHash",
  "runtimeConfigHash",
];

function fail(side, message) {
  throw new Error(`Invalid ${side} benchmark result: ${message}`);
}

function validateResult(result, side) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail(side, "expected a result JSON object");
  }
  if (!Array.isArray(result.scenarios) || result.scenarios.length === 0) {
    fail(side, '"scenarios" is missing or empty; the benchmark run produced no scenario results');
  }
  result.scenarios.forEach((scenario, index) => {
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
      fail(side, `scenarios[${index}] is not an object`);
    }
    if (typeof scenario.scenarioId !== "string" || scenario.scenarioId.length === 0) {
      fail(side, `scenarios[${index}] has no scenarioId`);
    }
  });
  const model = result.run?.models?.primary?.model;
  if (typeof model !== "string" || model.length === 0) {
    fail(side, 'run.models.primary.model is missing; cannot record the model identity');
  }
  const judgeModel = result.run?.models?.judge?.model;
  const judgeEndpoint = result.run?.models?.judge?.endpoint;
  if (typeof judgeModel !== "string" || judgeModel.length === 0
    || typeof judgeEndpoint !== "string" || judgeEndpoint.length === 0) {
    fail(side, "run.models.judge model/endpoint is missing; cannot verify both runs share one fixed judge");
  }
}

function scenarioPassAt1(scenario) {
  if (typeof scenario.retries?.passAt1 === "boolean") return scenario.retries.passAt1;
  return scenario.allPassed === true && (scenario.retries?.attempts || 1) <= 1;
}

function metricNumber(scenario, name) {
  const metric = (scenario.metrics || []).find((item) => item?.metric === name);
  if (!metric) return null;
  const value = Number.parseFloat(String(metric.actual));
  return Number.isFinite(value) ? value : null;
}

function average(values) {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function round(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function groupKey(scenario, field) {
  if (field === "structureType") {
    return scenario.benchmarkStructureType || scenario.structureType || "(unset)";
  }
  return scenario[field] || "(unset)";
}

function summarizeScenarios(scenarios) {
  const total = scenarios.length;
  const passed = scenarios.filter((scenario) => scenario.allPassed === true);
  const passAt1 = scenarios.filter(scenarioPassAt1);
  return {
    total,
    passed: passed.length,
    failed: total - passed.length,
    passRate: total > 0 ? passed.length / total : 0,
    passAt1: passAt1.length,
    passAt1Rate: total > 0 ? passAt1.length / total : 0,
    averagePrimaryTokens: round(average(scenarios.map((scenario) => metricNumber(scenario, TOKEN_METRIC)))),
    averageDurationMs: round(average(scenarios.map((scenario) => Number(scenario.durationMs))), 0),
  };
}

function scenarioIndex(result) {
  return new Map(result.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
}

function assertSameScenarioCorpus(indexA, indexB) {
  const idsA = [...indexA.keys()].sort();
  const idsB = [...indexB.keys()].sort();
  const onlyA = idsA.filter((id) => !indexB.has(id));
  const onlyB = idsB.filter((id) => !indexA.has(id));
  if (onlyA.length > 0 || onlyB.length > 0) {
    const parts = [];
    if (onlyA.length > 0) {
      parts.push(`${onlyA.length} scenario(s) only in the first result (e.g. ${onlyA.slice(0, 5).join(", ")})`);
    }
    if (onlyB.length > 0) {
      parts.push(`${onlyB.length} scenario(s) only in the second result (e.g. ${onlyB.slice(0, 5).join(", ")})`);
    }
    throw new Error(
      "Cannot compare runs with different scenario corpora: " + parts.join("; ")
      + ". Both targets must run the identical scenario selection.",
    );
  }
}

function judgeIdentity(result) {
  const judge = result.run?.models?.judge || {};
  return {
    model: judge.model ?? null,
    endpoint: judge.endpoint ?? null,
  };
}

function assertSameJudge(identityA, identityB) {
  const sameModel = identityA.model === identityB.model;
  const sameEndpoint = identityA.endpoint === identityB.endpoint;
  if (!sameModel || !sameEndpoint) {
    throw new Error(
      "Cannot compare runs scored by different judges: "
      + `first run judge ${JSON.stringify(identityA)} vs second run judge ${JSON.stringify(identityB)}. `
      + "Both targets must be scored by the same fixed judge endpoint, model, and parameters.",
    );
  }
}

function buildFairness(resultA, resultB) {
  const fingerprints = FINGERPRINT_KEYS.map((key) => ({
    key,
    a: resultA.run?.fingerprints?.[key] ?? null,
    b: resultB.run?.fingerprints?.[key] ?? null,
    match: resultA.run?.fingerprints?.[key] !== undefined
      && resultA.run?.fingerprints?.[key] === resultB.run?.fingerprints?.[key],
  }));
  const revisions = {};
  for (const repo of ["structureclaw", "benchmark"]) {
    const a = resultA.run?.revisions?.[repo]?.revision ?? null;
    const b = resultB.run?.revisions?.[repo]?.revision ?? null;
    revisions[repo] = { a, b, match: a !== null && a === b };
  }
  return { fingerprints, revisions };
}

function buildBreakdowns(scenariosA, scenariosB, fields) {
  const breakdowns = {};
  for (const field of fields) {
    const values = [...new Set([
      ...scenariosA.map((scenario) => groupKey(scenario, field)),
      ...scenariosB.map((scenario) => groupKey(scenario, field)),
    ])].sort((left, right) => String(left).localeCompare(String(right)));
    breakdowns[field] = Object.fromEntries(values.map((value) => [
      value,
      {
        a: summarizeScenarios(scenariosA.filter((scenario) => groupKey(scenario, field) === value)),
        b: summarizeScenarios(scenariosB.filter((scenario) => groupKey(scenario, field) === value)),
      },
    ]));
  }
  return breakdowns;
}

function buildFailedDiff(indexA, indexB) {
  const diff = { onlyA: [], onlyB: [], both: [] };
  for (const [id, scenarioA] of indexA) {
    const scenarioB = indexB.get(id);
    const failedA = scenarioA.allPassed !== true;
    const failedB = scenarioB.allPassed !== true;
    if (failedA && failedB) diff.both.push(id);
    else if (failedA) diff.onlyA.push(id);
    else if (failedB) diff.onlyB.push(id);
  }
  for (const key of Object.keys(diff)) diff[key].sort();
  return diff;
}

function buildSideIdentity(result, side, options) {
  const run = result.run || {};
  const primary = run.models?.primary || {};
  const vision = run.models?.vision || null;
  return {
    name: options.targetNames[side],
    label: options.labels[side],
    model: primary.model,
    visionModel: vision?.model ?? null,
    endpoint: primary.endpoint ?? null,
    runId: run.runId ?? null,
    resultsPath: options.resultsPaths[side],
    plannedScenarioCount: run.plannedScenarioCount ?? null,
    completedScenarioCount: run.completedScenarioCount ?? null,
    completed: run.completed === true,
  };
}

function rateComparison(a, b, names) {
  const delta = round(b - a, 4);
  const leader = delta === 0 ? "tie" : delta > 0 ? names.b : names.a;
  return { a: round(a, 4), b: round(b, 4), delta, leader };
}

export function buildComparison(resultA, resultB, options = {}) {
  const resolvedOptions = {
    targetNames: { a: options.targetNames?.a || "a", b: options.targetNames?.b || "b" },
    labels: { a: options.labels?.a || "Model A", b: options.labels?.b || "Model B" },
    resultsPaths: { a: options.resultsPaths?.a || null, b: options.resultsPaths?.b || null },
    generatedAt: options.generatedAt || new Date().toISOString(),
  };
  validateResult(resultA, "first");
  validateResult(resultB, "second");

  const indexA = scenarioIndex(resultA);
  const indexB = scenarioIndex(resultB);
  assertSameScenarioCorpus(indexA, indexB);

  const judgeA = judgeIdentity(resultA);
  const judgeB = judgeIdentity(resultB);
  assertSameJudge(judgeA, judgeB);

  const overall = {
    a: summarizeScenarios(resultA.scenarios),
    b: summarizeScenarios(resultB.scenarios),
  };
  const comparison = {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    generatedAt: resolvedOptions.generatedAt,
    context:
      "Both targets were served locally through OpenAI-compatible vLLM endpoints and scored by one fixed, "
      + "shared LLM-as-Judge endpoint used identically for both runs. These are local developer-run "
      + "benchmarks of locally served models, not hosted-API results and not CI results.",
    targets: {
      a: buildSideIdentity(resultA, "a", resolvedOptions),
      b: buildSideIdentity(resultB, "b", resolvedOptions),
    },
    fairness: {
      judge: { ...judgeA, identical: true },
      scenarioCorpusIdentical: true,
      ...buildFairness(resultA, resultB),
    },
    overall: {
      ...overall,
      passRate: rateComparison(overall.a.passRate, overall.b.passRate, resolvedOptions.targetNames),
      passAt1Rate: rateComparison(overall.a.passAt1Rate, overall.b.passAt1Rate, resolvedOptions.targetNames),
    },
    averages: {
      primaryTokens: {
        a: overall.a.averagePrimaryTokens,
        b: overall.b.averagePrimaryTokens,
      },
      durationMs: {
        a: overall.a.averageDurationMs,
        b: overall.b.averageDurationMs,
      },
    },
    breakdowns: buildBreakdowns(resultA.scenarios, resultB.scenarios, [
      "taskFamily",
      "locale",
      "structureType",
    ]),
    failedDiff: buildFailedDiff(indexA, indexB),
  };
  return comparison;
}

function formatRate(entry) {
  if (!entry || entry.total === 0) return "n/a";
  return `${entry.passed}/${entry.total} (${(entry.passRate * 100).toFixed(1)}%)`;
}

function formatPassAt1(entry) {
  if (!entry || entry.total === 0) return "n/a";
  return `${entry.passAt1}/${entry.total} (${(entry.passAt1Rate * 100).toFixed(1)}%)`;
}

function formatNumber(value, suffix = "") {
  if (value === null || value === undefined) return "n/a";
  return `${Number(value).toLocaleString("en-US")}${suffix}`;
}

function formatDeltaRate(delta, names) {
  if (delta.leader === "tie") return "tie";
  const pp = (Math.abs(delta.delta) * 100).toFixed(1);
  return `${delta.leader} (+${pp} pp)`;
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return "n/a";
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

export function renderComparisonMarkdown(comparison) {
  const names = { a: comparison.targets.a.name, b: comparison.targets.b.name };
  const lines = [];
  lines.push(`# LLM Benchmark Comparison: ${comparison.targets.a.label} vs ${comparison.targets.b.label}`);
  lines.push("");
  lines.push(`Generated: ${comparison.generatedAt}`);
  lines.push("");
  lines.push(`> ${comparison.context}`);
  lines.push("");

  lines.push("## Models under comparison");
  lines.push("");
  lines.push("| | " + names.a + " | " + names.b + " |");
  lines.push("| --- | --- | --- |");
  lines.push(`| Model | ${comparison.targets.a.model} | ${comparison.targets.b.model} |`);
  lines.push(`| Vision model | ${comparison.targets.a.visionModel || "n/a"} | ${comparison.targets.b.visionModel || "n/a"} |`);
  lines.push(`| Endpoint | ${comparison.targets.a.endpoint || "n/a"} | ${comparison.targets.b.endpoint || "n/a"} |`);
  lines.push(`| Result JSON | ${comparison.targets.a.resultsPath || "n/a"} | ${comparison.targets.b.resultsPath || "n/a"} |`);
  lines.push("");
  lines.push(`Shared judge: \`${comparison.fairness.judge.model}\` at \`${comparison.fairness.judge.endpoint}\``);
  lines.push("");

  lines.push("## Headline");
  lines.push("");
  lines.push(`| Metric | ${names.a} | ${names.b} | Comparison |`);
  lines.push("| --- | --- | --- | --- |");
  lines.push(
    `| Pass rate | ${formatRate(comparison.overall.a)} | ${formatRate(comparison.overall.b)} `
    + `| ${formatDeltaRate(comparison.overall.passRate, names)} |`,
  );
  lines.push(
    `| Pass@1 | ${formatPassAt1(comparison.overall.a)} | ${formatPassAt1(comparison.overall.b)} `
    + `| ${formatDeltaRate(comparison.overall.passAt1Rate, names)} |`,
  );
  lines.push(
    `| Avg primary-model tokens | ${formatNumber(comparison.averages.primaryTokens.a)} `
    + `| ${formatNumber(comparison.averages.primaryTokens.b)} | |`,
  );
  lines.push(
    `| Avg scenario duration | ${formatDuration(comparison.averages.durationMs.a)} `
    + `| ${formatDuration(comparison.averages.durationMs.b)} | |`,
  );
  lines.push("");

  const breakdownTitles = {
    taskFamily: "By task family",
    locale: "By locale",
    structureType: "By structure type",
  };
  for (const [field, title] of Object.entries(breakdownTitles)) {
    lines.push(`## ${title}`);
    lines.push("");
    lines.push(`| Group | ${names.a} pass | ${names.a} Pass@1 | ${names.b} pass | ${names.b} Pass@1 |`);
    lines.push("| --- | --- | --- | --- | --- |");
    for (const [value, entry] of Object.entries(comparison.breakdowns[field])) {
      lines.push(
        `| ${value} | ${formatRate(entry.a)} | ${formatPassAt1(entry.a)} `
        + `| ${formatRate(entry.b)} | ${formatPassAt1(entry.b)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Failed-scenario diff");
  lines.push("");
  const diff = comparison.failedDiff;
  lines.push(`- Failed only on ${names.a} (${diff.onlyA.length}): ${diff.onlyA.join(", ") || "(none)"}`);
  lines.push(`- Failed only on ${names.b} (${diff.onlyB.length}): ${diff.onlyB.join(", ") || "(none)"}`);
  lines.push(`- Failed on both (${diff.both.length}): ${diff.both.join(", ") || "(none)"}`);
  lines.push("");

  lines.push("## Run fingerprints");
  lines.push("");
  lines.push("| Check | " + names.a + " | " + names.b + " | Match |");
  lines.push("| --- | --- | --- | --- |");
  for (const entry of comparison.fairness.fingerprints) {
    lines.push(
      `| ${entry.key} | \`${shortHash(entry.a)}\` | \`${shortHash(entry.b)}\` | ${entry.match ? "yes" : "NO"} |`,
    );
  }
  for (const [repo, entry] of Object.entries(comparison.fairness.revisions)) {
    lines.push(
      `| ${repo} revision | \`${shortHash(entry.a)}\` | \`${shortHash(entry.b)}\` | ${entry.match ? "yes" : "NO"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function shortHash(value) {
  if (typeof value !== "string" || value.length === 0) return "n/a";
  return value.length <= 12 ? value : `${value.slice(0, 12)}…`;
}
