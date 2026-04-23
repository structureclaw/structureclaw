function formatMetric(m) {
  const icon = m.pass ? "\u2713" : "\u2717";
  return `  ${icon} ${m.metric.padEnd(16)} expected: ${m.expected.padEnd(30)} actual: ${m.actual}`;
}

function printScenarioResult(scenario, evaluation) {
  const status = evaluation.allPassed ? "PASS" : "FAIL";
  process.stdout.write(`\n${"=".repeat(60)}\n`);
  process.stdout.write(`${status}  ${scenario.id}\n`);
  if (scenario.description) {
    process.stdout.write(`     ${scenario.description}\n`);
  }
  process.stdout.write(`\n`);
  for (const m of evaluation.metrics) {
    process.stdout.write(formatMetric(m) + "\n");
  }
  process.stdout.write(`${"=".repeat(60)}\n`);
}

function printSummary(results) {
  const passed = results.filter((r) => r.allPassed).length;
  const failed = results.length - passed;
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

  process.stdout.write(`\n${"=".repeat(60)}\n`);
  process.stdout.write(`Benchmark Results: ${passed}/${results.length} passed`);
  if (failed > 0) {
    process.stdout.write(`, ${failed} failed`);
  }
  process.stdout.write(`\n`);
  if (failed > 0) {
    const failedIds = results.filter((r) => !r.allPassed).map((r) => r.scenarioId);
    process.stdout.write(`Failed: ${failedIds.join(", ")}\n`);
  }
  process.stdout.write(`Total time: ${(totalDuration / 1000).toFixed(1)}s\n`);
  process.stdout.write(`${"=".repeat(60)}\n\n`);
}

function writeJsonOutput(outputPath, results) {
  const fs = require("node:fs");
  const record = {
    timestamp: new Date().toISOString(),
    totalScenarios: results.length,
    passed: results.filter((r) => r.allPassed).length,
    failed: results.filter((r) => !r.allPassed).length,
    scenarios: results,
  };
  fs.writeFileSync(outputPath, JSON.stringify(record, null, 2) + "\n");
  process.stdout.write(`Results written to ${outputPath}\n`);
}

module.exports = { printScenarioResult, printSummary, writeJsonOutput };
