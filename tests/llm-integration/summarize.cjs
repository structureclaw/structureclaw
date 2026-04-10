/**
 * Summarize artifact records by grouping pass/fail rate by family and variant.
 */
function summarizeArtifacts(records) {
  return records.reduce((acc, record) => {
    const family = record.family || "unknown";
    const variant = record.variant || "unknown";
    acc[family] = acc[family] || {};
    acc[family][variant] = acc[family][variant] || { passed: 0, failed: 0, total: 0 };
    const bucket = acc[family][variant];
    bucket.total += 1;
    if (record.status === "PASS") bucket.passed += 1;
    else bucket.failed += 1;
    return acc;
  }, {});
}

/**
 * Print a summary table to stdout.
 */
function printSummary(summary) {
  for (const [family, variants] of Object.entries(summary)) {
    process.stdout.write(`\n${family}:\n`);
    for (const [variant, stats] of Object.entries(variants)) {
      process.stdout.write(`  ${variant}: passed=${stats.passed}, failed=${stats.failed}, total=${stats.total}\n`);
    }
  }
}

module.exports = { summarizeArtifacts, printSummary };
