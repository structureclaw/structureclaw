const fs = require("node:fs");
const path = require("node:path");

/**
 * Format a single test case summary for console output.
 */
function formatCaseSummary(testCase, observedTrace, status) {
  const tools = (observedTrace.toolCalls || [])
    .filter((call) => call.status === "success")
    .map((call) => call.tool)
    .join(" -> ") || "(none)";

  return [
    `  ${status} ${testCase.id} [${testCase.category}/${testCase.variant}]`,
    `    enabled: ${(observedTrace.enabledSkillIds || []).join(", ") || "(auto)"}`,
    `    activated: ${(observedTrace.activatedSkillIds || []).join(", ") || "(none)"}`,
    `    structural: ${observedTrace.structuralSkillId || "(none)"}`,
    `    analysis: ${observedTrace.analysisSkillId || "(none)"}`,
    `    tools: ${tools}`
  ].join("\n");
}

/**
 * Append a record to a JSON artifact file.
 * Creates the file with an array if it doesn't exist.
 */
function appendArtifactRecord(outputPath, record) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let records = [];
  if (fs.existsSync(outputPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      records = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      records = [];
    }
  }

  records.push(record);
  fs.writeFileSync(outputPath, JSON.stringify(records, null, 2) + "\n");
}

module.exports = { formatCaseSummary, appendArtifactRecord };
