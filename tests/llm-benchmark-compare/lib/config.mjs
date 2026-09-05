import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "targets.json");
const DEFAULT_CASE_TIMEOUT_MS = 30 * 60 * 1000;
export const SMOKE_SCENARIO_ID = "std-beam-6m-gt-repeat";
const TASK_FAMILIES = [
  "standard_workflow",
  "interactive_robustness",
  "multimodal_reverse_engineering",
];
const CONFIG_SCHEMA_VERSION = "structureclaw-benchmark-compare/v1";
const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const TARGET_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function isHttpUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateEndpoint(entry, role, index) {
  const where = role === "target" ? `targets[${index}]` : "judge";
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`Config field "${where}" must be an object.`);
  }
  const name = role === "target" ? entry.name : entry.name || "judge";
  if (typeof name !== "string" || !TARGET_NAME_PATTERN.test(name)) {
    throw new Error(
      `Config field "${where}.name" must match ${TARGET_NAME_PATTERN} (got ${JSON.stringify(name)}).`,
    );
  }
  if (!isHttpUrl(entry.baseUrl)) {
    throw new Error(
      `Config field "${where}.baseUrl" must be an http(s) OpenAI-compatible base URL (got ${JSON.stringify(entry.baseUrl)}).`,
    );
  }
  if (typeof entry.model !== "string" || entry.model.trim().length === 0) {
    throw new Error(`Config field "${where}.model" must be a non-empty model ID.`);
  }
  if (typeof entry.apiKeyEnv !== "string" || !ENV_VAR_NAME_PATTERN.test(entry.apiKeyEnv)) {
    throw new Error(
      `Config field "${where}.apiKeyEnv" must be an environment variable name like EXAMPLE_API_KEY (got ${JSON.stringify(entry.apiKeyEnv)}).`,
    );
  }
  return {
    name,
    label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : name,
    baseUrl: entry.baseUrl.replace(/\/+$/, ""),
    model: entry.model.trim(),
    apiKeyEnv: entry.apiKeyEnv,
  };
}

export function loadCompareConfig(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    throw new Error(`Cannot read comparison config ${configPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Comparison config ${configPath} is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Comparison config ${configPath} must contain a JSON object.`);
  }
  if (parsed.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Comparison config ${configPath} has schemaVersion ${JSON.stringify(parsed.schemaVersion)}; expected "${CONFIG_SCHEMA_VERSION}".`,
    );
  }
  if (!Array.isArray(parsed.targets)) {
    throw new Error(`Comparison config ${configPath} must contain a "targets" array.`);
  }
  if (parsed.targets.length !== 2) {
    throw new Error(
      `Comparison config ${configPath} must declare exactly 2 targets (got ${parsed.targets.length}).`,
    );
  }
  const targets = parsed.targets.map((target, index) => validateEndpoint(target, "target", index));
  if (targets[0].name === targets[1].name) {
    throw new Error(
      `Comparison config ${configPath} declares duplicate target name "${targets[0].name}"; target names must be unique.`,
    );
  }
  const judge = validateEndpoint(parsed.judge, "judge");
  return { schemaVersion: parsed.schemaVersion, targets, judge };
}

export function parseCompareOptions(args) {
  let config = DEFAULT_CONFIG_PATH;
  let outputDir;
  let scenarioId;
  let taskFamily;
  let caseTimeoutMs = DEFAULT_CASE_TIMEOUT_MS;
  let smoke = false;
  let dryRun = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const value = () => {
      index += 1;
      if (index >= args.length) {
        throw new Error(`Option ${current} requires a value.`);
      }
      return args[index];
    };
    if (current === "--config") {
      config = value();
    } else if (current === "--output-dir") {
      outputDir = value();
    } else if (current === "--scenario") {
      scenarioId = value();
    } else if (current === "--family" || current === "--task-family") {
      taskFamily = value();
    } else if (current === "--case-timeout-ms") {
      caseTimeoutMs = Number(value());
    } else if (current === "--smoke") {
      smoke = true;
    } else if (current === "--dry-run") {
      dryRun = true;
    } else if (current === "--help" || current === "-h") {
      help = true;
    } else {
      throw new Error(`Unknown option for llm-benchmark-compare: ${current}`);
    }
  }

  if (smoke && scenarioId) {
    throw new Error("--smoke already selects a single scenario; do not combine it with --scenario.");
  }
  if (smoke && taskFamily) {
    throw new Error("--smoke runs one full-corpus-independent scenario; do not combine it with --family.");
  }
  if (scenarioId && taskFamily) {
    throw new Error("Use either --scenario or --family, not both.");
  }
  if (taskFamily && !TASK_FAMILIES.includes(taskFamily)) {
    throw new Error(`Unknown task family "${taskFamily}". Use one of: ${TASK_FAMILIES.join(", ")}`);
  }
  if (!Number.isFinite(caseTimeoutMs) || caseTimeoutMs <= 0) {
    throw new Error("--case-timeout-ms must be a positive number of milliseconds.");
  }
  if (!outputDir && !help) {
    throw new Error("--output-dir <dir> is required (result JSONs, comparison.json, and comparison.md are written there).");
  }
  if (smoke) {
    scenarioId = SMOKE_SCENARIO_ID;
  }
  if (help) {
    return {
      config: path.resolve(config),
      outputDir: null,
      scenarioId: null,
      taskFamily: null,
      caseTimeoutMs,
      smoke,
      dryRun,
      help,
    };
  }

  return {
    config: path.resolve(config),
    outputDir: path.resolve(outputDir),
    scenarioId: scenarioId || null,
    taskFamily: taskFamily || null,
    caseTimeoutMs,
    smoke,
    dryRun,
    help,
  };
}

function resolvedKey(env, apiKeyEnv) {
  const value = env[apiKeyEnv];
  return typeof value === "string" && value.trim().length > 0;
}

export function resolvePlan({ options, config, env, rootDir }) {
  const targets = config.targets.map((target, index) => ({
    ...target,
    role: `target ${index + 1} of ${config.targets.length}`,
    visionModel: target.model,
    apiKeyAvailable: resolvedKey(env, target.apiKeyEnv),
    resultsPath: path.join(options.outputDir, target.name, "results.json"),
    runtimeDataDir: path.join(options.outputDir, target.name, "runtime-data"),
    databaseUrl: `file:${path.join(options.outputDir, target.name, "benchmark.db").replace(/\\/g, "/")}`,
  }));
  const judge = {
    ...config.judge,
    role: "judge",
    apiKeyAvailable: resolvedKey(env, config.judge.apiKeyEnv),
  };
  return {
    configPath: options.config,
    rootDir,
    outputDir: options.outputDir,
    dryRun: options.dryRun,
    smoke: options.smoke,
    caseTimeoutMs: options.caseTimeoutMs,
    selection: {
      scenarioId: options.scenarioId,
      taskFamily: options.taskFamily,
    },
    targets,
    judge,
  };
}

export function missingApiKeys(plan) {
  const missing = [];
  for (const target of plan.targets) {
    if (!target.apiKeyAvailable) missing.push(target.apiKeyEnv);
  }
  if (!plan.judge.apiKeyAvailable) missing.push(plan.judge.apiKeyEnv);
  return [...new Set(missing)];
}

export function requireApiKeys(plan) {
  const missing = missingApiKeys(plan);
  if (missing.length > 0) {
    throw new Error(
      "Pre-flight failed: API key environment variable(s) not set: "
      + `${missing.join(", ")}. Export them before running; key values are resolved from the `
      + "environment and are never written to committed files, logs, or the comparison report.",
    );
  }
}
