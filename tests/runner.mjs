import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rootDir = path.resolve(__dirname, "..");

const validationRunner = require("./regression/run-validation.js");
const { runBackendRegression } = require("./regression/backend-regression.js");
const { runAnalysisRegression } = require("./regression/analysis-regression.js");
const { runDockerComposeSmoke, runNativeInstallSmoke } = require("./smoke/install-smoke.cjs");

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
  process.stdout.write(`StructureClaw regression and smoke runner

Usage:
  node tests/runner.mjs <command> [options]

Commands:
  validate <name>       Run a named validation
  validate --list       List validation names
  check <name>          Run a grouped check
  check --list          List check names
  backend-regression    Full backend regression suite
  analysis-regression   Full analysis regression suite
  smoke-native          CI-style native install smoke (npm ci + build)
  smoke-docker          Docker compose smoke test

Replaces former sclaw commands:
  sclaw validate ...    -> node tests/runner.mjs validate ...
  sclaw check ...       -> node tests/runner.mjs check ...
  sclaw backend-regression / analysis-regression / test-smoke-* -> see above
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
    case "smoke-docker":
      await runDockerComposeSmoke(rootDir);
      return;
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
