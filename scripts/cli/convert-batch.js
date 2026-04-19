const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function printUsage(log = console.log) {
  log(`Usage:
  sclaw convert-batch --input-dir <dir> --output-dir <dir> --report <file> --target-format <name> [options]

Options:
  --input-dir <dir>               Directory containing source JSON files
  --output-dir <dir>              Directory to write converted JSON files
  --report <file>                 Path to write batch report JSON
  --source-format <name>          Source format (default: structuremodel-v2)
  --target-format <name>          Target format
  --target-schema-version <ver>   Target schema version (default: 2.0.0)
  --allow-failures                Return success even if some files fail
  -h, --help                      Show this help
`);
}

function parseArgs(argv) {
  const args = {
    inputDir: "",
    outputDir: "",
    report: "",
    sourceFormat: "structuremodel-v2",
    targetFormat: "",
    targetSchemaVersion: "2.0.0",
    allowFailures: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--input-dir":
        args.inputDir = argv[index + 1] || "";
        index += 1;
        break;
      case "--output-dir":
        args.outputDir = argv[index + 1] || "";
        index += 1;
        break;
      case "--report":
        args.report = argv[index + 1] || "";
        index += 1;
        break;
      case "--source-format":
        args.sourceFormat = argv[index + 1] || "";
        index += 1;
        break;
      case "--target-format":
        args.targetFormat = argv[index + 1] || "";
        index += 1;
        break;
      case "--target-schema-version":
        args.targetSchemaVersion = argv[index + 1] || "";
        index += 1;
        break;
      case "--allow-failures":
        args.allowFailures = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function utcNow() {
  return new Date().toISOString();
}

function buildArgumentError(message) {
  const error = new Error(message);
  error.isUsageError = true;
  return error;
}

function validateArgs(args) {
  if (!args.inputDir) {
    throw buildArgumentError("Missing required argument: --input-dir");
  }
  if (!args.outputDir) {
    throw buildArgumentError("Missing required argument: --output-dir");
  }
  if (!args.report) {
    throw buildArgumentError("Missing required argument: --report");
  }
  if (!args.targetFormat) {
    throw buildArgumentError("Missing required argument: --target-format");
  }
}

async function loadStructureProtocolService(rootDir) {
  const serviceModulePath = path.join(
    rootDir,
    "backend",
    "dist",
    "services",
    "structure-protocol-execution.js",
  );
  if (!fs.existsSync(serviceModulePath)) {
    throw new Error(
      `Backend structure protocol service is not available at ${serviceModulePath}. Run \`npm run build --prefix backend\` first.`,
    );
  }

  const imported = await import(pathToFileURL(serviceModulePath).href);
  return new imported.StructureProtocolExecutionService();
}

function normalizeConvertError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    errorCode:
      error && typeof error === "object" && typeof error.errorCode === "string"
        ? error.errorCode
        : "CONVERT_EXECUTION_FAILED",
    message,
  };
}

async function convertOneFile(service, sourceFile, outputDir, options) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  } catch (error) {
    return {
      file: path.basename(sourceFile),
      status: "failed",
      outputFile: null,
      errorCode: "INVALID_JSON",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const result = await service.convert({
      model: payload,
      target_schema_version: options.targetSchemaVersion,
      source_format: options.sourceFormat,
      target_format: options.targetFormat,
    });
    const outputFile = path.join(outputDir, path.basename(sourceFile));
    fs.writeFileSync(outputFile, JSON.stringify(result.model, null, 2), "utf8");
    return {
      file: path.basename(sourceFile),
      status: "ok",
      outputFile,
      errorCode: null,
      message: null,
    };
  } catch (error) {
    const normalized = normalizeConvertError(error);
    return {
      file: path.basename(sourceFile),
      status: "failed",
      outputFile: null,
      errorCode: normalized.errorCode,
      message: normalized.message,
    };
  }
}

function buildReport(args, inputDir, outputDir, startedAt, results) {
  const successCount = results.filter((item) => item.status === "ok").length;
  const failedCount = results.length - successCount;
  const failureByErrorCode = {};

  for (const item of results) {
    if (item.status !== "failed") {
      continue;
    }
    const code = item.errorCode || "UNKNOWN";
    failureByErrorCode[code] = (failureByErrorCode[code] || 0) + 1;
  }

  return {
    startedAt,
    finishedAt: utcNow(),
    sourceFormat: args.sourceFormat,
    targetFormat: args.targetFormat,
    targetSchemaVersion: args.targetSchemaVersion,
    inputDir,
    outputDir,
    summary: {
      total: results.length,
      success: successCount,
      failed: failedCount,
      failureByErrorCode,
    },
    items: results.map((item) => ({
      file: item.file,
      status: item.status,
      outputFile: item.outputFile,
      errorCode: item.errorCode,
      message: item.message,
    })),
  };
}

async function runConvertBatch(rootDir, rawArgs = [], options = {}) {
  const log = options.log || console.log;
  const serviceFactory = options.serviceFactory || loadStructureProtocolService;
  const args = parseArgs(rawArgs);

  if (args.help) {
    printUsage(log);
    return;
  }

  validateArgs(args);

  const inputDir = path.resolve(rootDir, args.inputDir);
  const outputDir = path.resolve(rootDir, args.outputDir);
  const reportPath = path.resolve(rootDir, args.report);

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const sourceFiles = fs
    .readdirSync(inputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(inputDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const startedAt = utcNow();
  const originalCwd = process.cwd();
  process.chdir(rootDir);

  try {
    const service = await serviceFactory(rootDir);
    const results = [];

    for (const sourceFile of sourceFiles) {
      results.push(
        await convertOneFile(service, sourceFile, outputDir, {
          sourceFormat: args.sourceFormat,
          targetFormat: args.targetFormat,
          targetSchemaVersion: args.targetSchemaVersion,
        }),
      );
    }

    const report = buildReport(args, inputDir, outputDir, startedAt, results);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    log(
      `[batch] total=${report.summary.total} success=${report.summary.success} failed=${report.summary.failed}`,
    );
    log(`[batch] report=${reportPath}`);

    if (report.summary.failed > 0 && !args.allowFailures) {
      throw new Error(
        `Batch convert finished with ${report.summary.failed} failure(s). Re-run with --allow-failures to keep a zero exit code.`,
      );
    }
  } finally {
    process.chdir(originalCwd);
  }
}

module.exports = {
  parseArgs,
  printUsage,
  runConvertBatch,
};
