const runtime = require("../../scripts/cli/runtime");
const { runBackendValidation } = require("./backend-validations");
const {
  ensureRegressionSqliteDatabaseUrl,
  resolveRegressionContext,
  runBackendCommand,
  runLoggedStep,
} = require("./shared");

const BACKEND_STEPS = [
  ["Dev startup CLI guards", "validate-dev-startup-guards"],
  ["Agent orchestration regression", "validate-agent-orchestration"],
  ["Agent base-chat fallback contract", "validate-agent-base-chat-fallback"],
  ["Agent tools protocol contract", "validate-agent-tools-contract"],
  ["Agent API contract regression", "validate-agent-api-contract"],
  ["Agent capability matrix contract", "validate-agent-capability-matrix"],
  ["Agent SkillHub contract", "validate-agent-skillhub-contract"],
  ["Agent SkillHub CLI integration contract", "validate-agent-skillhub-cli"],
  ["Agent SkillHub repository-down fallback contract", "validate-agent-skillhub-repository-down"],
  ["Chat stream contract regression", "validate-chat-stream-contract"],
  ["Chat message routing contract", "validate-chat-message-routing"],
  ["Report narrative contract", "validate-report-narrative-contract"],
];

const JEST_ENV_FORWARD_KEYS = [
  "LLM_PROVIDER",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_BASE_URL",
  "LLM_TIMEOUT_MS",
  "LLM_MAX_RETRIES",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "ANALYSIS_ENGINE_URL",
  "ANALYSIS_ENGINE_MANIFEST_PATH",
  "ZAI_API_KEY",
];

function pickJestForwardEnv(context) {
  const forwarded = {};
  for (const key of JEST_ENV_FORWARD_KEYS) {
    if (context.env[key] !== undefined) {
      forwarded[key] = context.env[key];
    }
  }
  return forwarded;
}

async function runBackendRegression(rootDir) {
  const context = resolveRegressionContext(rootDir);
  ensureRegressionSqliteDatabaseUrl(context);

  console.log("Backend regression checks");

  await runLoggedStep("Backend regression database sync", async () => {
    await runBackendCommand(context, ["run", "db:deploy", "--prefix", context.paths.backendDir], {
      stdio: "ignore",
    });
    console.log("[ok] Backend regression database sync");
  });

  await runLoggedStep("Backend build", async () => {
    await runBackendCommand(context, ["run", "build", "--prefix", context.paths.backendDir]);
    context.backendBuildReady = true;
  });

  await runLoggedStep("Backend lint", async () => {
    await runBackendCommand(context, ["run", "lint", "--prefix", context.paths.backendDir]);
  });

  await runLoggedStep("Backend test", async () => {
    await runBackendCommand(context, ["run", "db:generate", "--prefix", context.paths.backendDir]);
    await runBackendCommand(context, ["run", "build", "--prefix", context.paths.backendDir]);
    // Run Jest directly in backend cwd to avoid npm prefix/env exit-code inconsistencies.
    await runtime.runCommand(runtime.getNpmCommand(), ["exec", "jest", "--", "--passWithNoTests", "--runInBand"], {
      cwd: context.paths.backendDir,
      env: {
        ...process.env,
        ...pickJestForwardEnv(context),
        DATABASE_URL: context.env.DATABASE_URL,
        NODE_OPTIONS: "--experimental-vm-modules",
      },
      stdio: "inherit",
    });
  });

  for (const [title, validationName] of BACKEND_STEPS) {
    await runLoggedStep(title, async () => {
      await runBackendValidation(validationName, context);
    });
  }

  await runLoggedStep("Prisma schema validate", async () => {
    await runBackendCommand(context, ["run", "db:validate", "--prefix", context.paths.backendDir]);
  });

  console.log("\nBackend regression checks passed.");
}

module.exports = {
  runBackendRegression,
};
