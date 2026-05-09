import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rootDir = path.resolve(__dirname, "..");

const validationRunner = require("./regression/run-validation.js");
const { runBackendRegression } = require("./regression/backend-regression.js");
const { runAnalysisRegression } = require("./regression/analysis-regression.js");
const { runNativeInstallSmoke } = require("./smoke/install-smoke.cjs");

const { runLlmIntegrationTests } = require("./llm-integration/runner.cjs");
const { summarizeArtifacts, printSummary } = require("./llm-integration/summarize.cjs");
const { runBenchmark } = require("./llm-benchmark/runner.cjs");

function parseCliOptions(args) {
  const positionals = [];
  const flags = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const separator = current.indexOf("=");
    if (separator > 2) {
      flags.set(current.slice(2, separator), current.slice(separator + 1));
      continue;
    }

    const key = current.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
      continue;
    }

    flags.set(key, true);
  }

  return { flags, positionals };
}

function formatValidationList() {
  const lines = ["Available validations:", ""];
  for (const name of validationRunner.getValidationNames()) {
    lines.push(`  ${name}`);
  }
  return lines.join("\n");
}

function formatCheckList() {
  const lines = ["Available checks:", ""];
  for (const name of validationRunner.getCheckNames()) {
    lines.push(`  ${name}`);
  }
  return lines.join("\n");
}

function printHelp() {
  process.stdout.write(`StructureClaw test runner

Usage:
  node tests/runner.mjs <command> [options]

Commands:
  validate <name>       Run one named contract/schema validation
  validate --list       List named validations
  check <name>          Run a grouped validation alias
  check --list          List grouped validation aliases
  backend-regression    Backend regression bundle: build, lint, Jest, and validations
  analysis-regression   Deterministic engineering analysis regression
  llm-integration       Legacy LLM/routing integration tests (requires LLM_API_KEY)
                        supports: node tests/runner.mjs llm-integration [category]
                        default: routing
                        categories: routing | extraction | pipeline | clarification
                          [--family <family>]  (alias: --skill)
                          [--variant <specific|generic|auto>]
                          [--scenario <scenarioId>]
                          [--output <artifact.json>]
  llm-benchmark         LangGraph agent benchmark (requires LLM_API_KEY)
                        runs the full ReAct agent and evaluates scenario quality
                          [--scenario <scenarioId>]
                          [--output <results.json>]
  llm-summary <path>   Summarize LLM test artifacts by family/variant
  smoke-native          Native install/build compatibility smoke

Replaces former sclaw commands:
  sclaw validate ...    -> node tests/runner.mjs validate ...
  sclaw check ...       -> node tests/runner.mjs check ...
  sclaw backend-regression / analysis-regression / test-smoke-* -> see above

Test taxonomy:
  docs/testing.md defines category ownership and CI workflow boundaries.
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rawArgs = argv.slice(1);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  switch (cmd) {
    case "validate": {
      const { flags, positionals } = parseCliOptions(rawArgs);
      if (flags.has("list")) {
        process.stdout.write(`${formatValidationList()}\n`);
        return;
      }
      const validationName = positionals[0];
      if (!validationName) {
        throw new Error("Usage: node tests/runner.mjs validate <name>\n       node tests/runner.mjs validate --list");
      }
      await validationRunner.runValidationByName(validationName, rootDir);
      return;
    }
    case "check": {
      const { flags, positionals } = parseCliOptions(rawArgs);
      if (flags.has("list")) {
        process.stdout.write(`${formatCheckList()}\n`);
        return;
      }
      const checkName = positionals[0];
      if (!checkName) {
        throw new Error("Usage: node tests/runner.mjs check <name>\n       node tests/runner.mjs check --list");
      }
      const validationName = validationRunner.resolveCheckValidationName(checkName);
      if (!validationName) {
        throw new Error(`Unknown check: ${checkName}\n\n${formatCheckList()}`);
      }
      await validationRunner.runValidationByName(validationName, rootDir);
      return;
    }
    case "backend-regression":
      await runBackendRegression(rootDir);
      return;
    case "analysis-regression":
      await runAnalysisRegression(rootDir);
      return;
    case "smoke-native":
      await runNativeInstallSmoke(rootDir);
      return;
    case "llm-integration":
      await runLlmIntegrationTests(rootDir, rawArgs);
      return;
    case "llm-benchmark":
      await runBenchmark(rootDir, rawArgs);
      return;
    case "llm-summary": {
      const artifactPath = rawArgs[0];
      if (!artifactPath) {
        throw new Error("Usage: node tests/runner.mjs llm-summary <artifact.json>");
      }
      const fs = require("node:fs");
      if (!fs.existsSync(artifactPath)) {
        throw new Error(`Artifact file not found: ${artifactPath}`);
      }
      const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      if (!Array.isArray(parsed)) {
        throw new Error(`Expected a JSON array in ${artifactPath}, got ${typeof parsed}`);
      }
      const records = parsed;
      const summary = summarizeArtifacts(records);
      printSummary(summary);
      process.stdout.write("\n");
      return;
    }
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
