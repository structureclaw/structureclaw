const test = require("node:test");
const nodeAssert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { formatCaseSummary, appendArtifactRecord } = require("./reporting.cjs");

test("formatCaseSummary produces expected multi-line output", () => {
  const summary = formatCaseSummary(
    { id: "frame-static-basic#specific", category: "pipeline", variant: "specific" },
    {
      enabledSkillIds: ["frame", "opensees-static"],
      activatedSkillIds: ["frame"],
      structuralSkillId: "frame",
      analysisSkillId: "opensees-static",
      toolCalls: [{ tool: "draft_model", status: "success" }, { tool: "run_analysis", status: "success" }]
    },
    "PASS"
  );

  nodeAssert.ok(summary.includes("PASS frame-static-basic#specific"));
  nodeAssert.ok(summary.includes("[pipeline/specific]"));
  nodeAssert.ok(summary.includes("enabled: frame, opensees-static"));
  nodeAssert.ok(summary.includes("structural: frame"));
  nodeAssert.ok(summary.includes("tools: draft_model -> run_analysis"));
});

test("formatCaseSummary handles empty tool calls", () => {
  const summary = formatCaseSummary(
    { id: "test", category: "extraction", variant: "legacy" },
    { enabledSkillIds: undefined, activatedSkillIds: [], toolCalls: [] },
    "PASS"
  );

  nodeAssert.ok(summary.includes("enabled: (auto)"));
  nodeAssert.ok(summary.includes("tools: (none)"));
});

test("appendArtifactRecord writes and appends records", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporting-test-"));
  const filePath = path.join(tmpDir, "output.json");

  appendArtifactRecord(filePath, { id: "case-1", status: "PASS" });
  appendArtifactRecord(filePath, { id: "case-2", status: "FAIL" });

  const records = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  nodeAssert.equal(records.length, 2);
  nodeAssert.equal(records[0].id, "case-1");
  nodeAssert.equal(records[1].status, "FAIL");

  fs.rmSync(tmpDir, { recursive: true });
});

test("appendArtifactRecord creates parent directories", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporting-test-"));
  const filePath = path.join(tmpDir, "nested", "dir", "output.json");

  appendArtifactRecord(filePath, { id: "case-1", status: "PASS" });

  const records = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  nodeAssert.equal(records.length, 1);

  fs.rmSync(tmpDir, { recursive: true });
});
