const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { runConvertBatch } = require("./convert-batch");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sclaw-convert-batch-"));
}

test("runConvertBatch writes report and fails when failures are not allowed", async () => {
  const rootDir = createTempRoot();
  const inputDir = path.join(rootDir, "input");
  const outputDir = path.join(rootDir, "output");
  const reportPath = path.join(rootDir, "reports", "report.json");
  const logs = [];

  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, "valid.json"), JSON.stringify({ id: "valid" }, null, 2));
  fs.writeFileSync(path.join(inputDir, "invalid.json"), JSON.stringify({ id: "invalid" }, null, 2));

  const serviceFactory = async () => ({
    async convert(payload) {
      if (payload.model.id === "invalid") {
        const error = new Error("invalid structure model");
        error.errorCode = "INVALID_STRUCTURE_MODEL";
        throw error;
      }
      return {
        model: {
          converted: true,
          sourceId: payload.model.id,
        },
      };
    },
  });

  await assert.rejects(
    runConvertBatch(
      rootDir,
      [
        "--input-dir",
        "input",
        "--output-dir",
        "output",
        "--report",
        "reports/report.json",
        "--target-format",
        "compact-1",
      ],
      {
        log: (message) => logs.push(message),
        serviceFactory,
      },
    ),
    /Batch convert finished with 1 failure/,
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.success, 1);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.failureByErrorCode.INVALID_STRUCTURE_MODEL, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(outputDir, "valid.json"), "utf8")).sourceId,
    "valid",
  );
  assert.deepEqual(logs, [
    "[batch] total=2 success=1 failed=1",
    `[batch] report=${reportPath}`,
  ]);
});

test("runConvertBatch keeps zero-exit behavior with --allow-failures", async () => {
  const rootDir = createTempRoot();
  const inputDir = path.join(rootDir, "input");
  const reportPath = path.join(rootDir, "report.json");

  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, "broken.json"), "{not json", "utf8");

  await runConvertBatch(
    rootDir,
    [
      "--input-dir",
      "input",
      "--output-dir",
      "output",
      "--report",
      "report.json",
      "--target-format",
      "compact-1",
      "--allow-failures",
    ],
    {
      log: () => {},
      serviceFactory: async () => ({
        async convert() {
          throw new Error("should not be called");
        },
      }),
    },
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.success, 0);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.items[0].errorCode, "INVALID_JSON");
});
