const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runtime = require("../../scripts/cli/runtime");

function logStep(title) {
  process.stdout.write(`\n==> ${title}\n`);
}

async function runLoggedStep(title, task) {
  logStep(title);
  await task();
}

function resolveRegressionContext(rootDir) {
  const projectRoot = runtime.resolveProjectRoot(rootDir);
  const { paths, env } = runtime.loadProjectEnvironment(projectRoot);
  return {
    rootDir: projectRoot,
    paths,
    env: { ...env },
  };
}

function ensureRegressionSqliteDatabaseUrl(context) {
  const fallbackDatabaseUrl = `file:${path
    .join(context.rootDir, ".structureclaw", "data", "structureclaw-regression.db")
    .replace(/\\/gu, "/")}`;
  runtime.ensureDirectory(context.paths.dataDir);

  if (!context.env.DATABASE_URL) {
    context.env.DATABASE_URL = fallbackDatabaseUrl;
    process.stdout.write("[info] DATABASE_URL is not set; using SQLite regression fallback.\n");
    return;
  }

  if (!String(context.env.DATABASE_URL).startsWith("file:")) {
    process.stdout.write(
      `[info] DATABASE_URL='${context.env.DATABASE_URL}' is not a SQLite file URL; using SQLite regression fallback.\n`,
    );
    context.env.DATABASE_URL = fallbackDatabaseUrl;
  }
}

async function runBackendCommand(context, args, options = {}) {
  await runtime.runCommand(runtime.getNpmCommand(), args, {
    cwd: context.rootDir,
    env: {
      ...process.env,
      ...context.env,
      ...options.env,
    },
    stdio: options.stdio || "inherit",
  });
}

async function runBackendBuildOnce(context) {
  if (context.backendBuildReady) {
    return;
  }
  await runBackendCommand(context, ["run", "build", "--prefix", context.paths.backendDir], {
    stdio: "ignore",
  });
  context.backendBuildReady = true;
}

function resolveAnalysisPythonContext(context) {
  const pythonBin = runtime.resolveAnalysisPython(context.rootDir, context.env);
  if (!pythonBin) {
    throw new Error(
      "No analysis Python environment found at backend/.venv and ANALYSIS_PYTHON_BIN is not set",
    );
  }
  return {
    pythonBin,
    env: runtime.buildAnalysisEnvironment(context.rootDir, context.env),
  };
}

async function runAnalysisRunner(context, commandName) {
  const analysis = resolveAnalysisPythonContext(context);
  await runtime.runCommand(
    analysis.pythonBin,
    [path.join(context.rootDir, "tests", "regression", "analysis-runner.py"), commandName],
    {
      cwd: context.rootDir,
      env: analysis.env,
    },
  );
}

async function withTempDir(prefix, callback) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(tempDir);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  ensureRegressionSqliteDatabaseUrl,
  logStep,
  resolveAnalysisPythonContext,
  resolveRegressionContext,
  runAnalysisRunner,
  runBackendBuildOnce,
  runBackendCommand,
  runLoggedStep,
  withTempDir,
};
