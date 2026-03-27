const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");

const { ALIAS_TO_COMMAND, COMMANDS, COMMAND_NAMES } = require("./command-manifest");
const convertBatch = require("./convert-batch");
const { createDockerComposeRunner } = require("./docker-compose-runner");
const { runFrontendBuild } = require("./frontend-build");
const runtime = require("./runtime");

const MIN_NODE_MAJOR = 18;

function getPackageMetadata(rootDir) {
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return {
    name: packageJson.name || "structureclaw-cli",
    version: packageJson.version || "0.1.0",
  };
}

function ensureSupportedNodeVersion() {
  const majorVersion = Number.parseInt(process.versions.node.split(".")[0] || "0", 10);
  if (majorVersion >= MIN_NODE_MAJOR) {
    return;
  }
  throw new Error(
    `sclaw requires Node.js v${MIN_NODE_MAJOR}+ (current: v${process.versions.node}).`,
  );
}

function resolveCommandName(rawCommand) {
  if (!rawCommand) {
    return "help";
  }
  if (COMMAND_NAMES.has(rawCommand)) {
    return rawCommand;
  }
  return ALIAS_TO_COMMAND.get(rawCommand) || rawCommand;
}

function formatHelp(rootDir) {
  const { version } = getPackageMetadata(rootDir);
  const lines = [
    "StructureClaw CLI",
    "",
    `Version: ${version}`,
    "",
    "Usage:",
    "  sclaw <command> [options]",
    "",
    "Commands:",
  ];

  for (const command of COMMANDS) {
    lines.push(`  ${command.usage.padEnd(48)} ${command.description}`);
  }

  lines.push("");
  lines.push("Notes:");
  lines.push("  - `doctor` is the cross-platform local preflight check.");
  lines.push("  - `start` maps to the recommended no-infra local profile (same as `local-up-noinfra`).");
  lines.push("  - Regressions and contract checks: `node tests/runner.mjs ...`.");
  return lines.join(os.EOL);
}

function log(message = "") {
  process.stdout.write(`${message}${os.EOL}`);
}

const docker = createDockerComposeRunner(log);

function getCliEntryPath(rootDir) {
  return path.join(rootDir, "sclaw");
}

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

function maskSecret(value) {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function replaceEnvValue(rawText, key, value) {
  const safeValue = String(value ?? "");
  const linePattern = new RegExp(`^${key}=.*$`, "mu");
  const nextLine = `${key}=${safeValue}`;

  if (linePattern.test(rawText)) {
    return rawText.replace(linePattern, nextLine);
  }

  const suffix = rawText.endsWith(os.EOL) || rawText.length === 0 ? "" : os.EOL;
  return `${rawText}${suffix}${nextLine}${os.EOL}`;
}

function normalizeChatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/u, "");
  if (!trimmed) {
    return "";
  }
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

async function testApiConnection(config) {
  const targetUrl = normalizeChatCompletionsUrl(config.baseUrl);
  if (!targetUrl) {
    return { ok: false, message: "Missing LLM base URL." };
  }

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        message: `${response.status} ${response.statusText}${text ? `: ${text}` : ""}`,
      };
    }
    return { ok: true, message: "API connection successful / API 连接成功" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function promptForDockerInstallConfig(defaults) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const providerInput = await rl.question(
      `LLM provider / 模型提供商 [${defaults.provider}]: `,
    );
    const baseUrlInput = await rl.question(
      `LLM base URL / 接口地址${defaults.baseUrl ? ` [${defaults.baseUrl}]` : ""}: `,
    );
    const modelInput = await rl.question(
      `LLM model / 模型名称${defaults.model ? ` [${defaults.model}]` : ""}: `,
    );
    const apiKeyPrompt = defaults.apiKey
      ? `LLM API key / 密钥 [press Enter to keep ${maskSecret(defaults.apiKey)}]: `
      : "LLM API key / 密钥: ";
    const apiKeyInput = await rl.question(apiKeyPrompt);

    return {
      provider: providerInput.trim() || defaults.provider,
      baseUrl: baseUrlInput.trim() || defaults.baseUrl,
      model: modelInput.trim() || defaults.model,
      apiKey: apiKeyInput.trim() || defaults.apiKey,
    };
  } finally {
    rl.close();
  }
}

async function collectDockerInstallConfig(rawArgs, env) {
  const { flags } = parseCliOptions(rawArgs);
  const defaults = {
    provider: String(flags.get("llm-provider") || env.LLM_PROVIDER || "openai"),
    baseUrl: String(flags.get("llm-base-url") || env.LLM_BASE_URL || ""),
    apiKey: String(flags.get("llm-api-key") || env.LLM_API_KEY || env.OPENAI_API_KEY || env.ZAI_API_KEY || ""),
    model: String(flags.get("llm-model") || env.LLM_MODEL || ""),
  };
  const nonInteractive =
    flags.has("non-interactive") || !process.stdin.isTTY || !process.stdout.isTTY;
  const skipApiTest = flags.has("skip-api-test");

  const config = nonInteractive
    ? defaults
    : await promptForDockerInstallConfig(defaults);

  const missing = [
    ["--llm-provider", config.provider],
    ["--llm-base-url", config.baseUrl],
    ["--llm-api-key", config.apiKey],
    ["--llm-model", config.model],
  ].filter(([, value]) => !String(value || "").trim());

  if (missing.length > 0) {
    throw new Error(
      `docker-install requires ${missing.map(([name]) => name).join(", ")}. Add the flags or run interactively.`,
    );
  }

  return {
    provider: config.provider.trim(),
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    skipApiTest,
  };
}

function persistDockerEnv(paths, config) {
  const templatePath = runtime.pathExists(paths.envFile) ? paths.envFile : paths.envExampleFile;
  let content = fs.readFileSync(templatePath, "utf8");
  content = replaceEnvValue(content, "LLM_PROVIDER", config.provider);
  content = replaceEnvValue(content, "LLM_BASE_URL", config.baseUrl);
  content = replaceEnvValue(content, "LLM_API_KEY", config.apiKey);
  content = replaceEnvValue(content, "LLM_MODEL", config.model);
  fs.writeFileSync(paths.envFile, content);
}

async function showDockerHealth(env) {
  const { frontendPort, backendPort } = docker.getDockerPorts(env);
  log("Docker service health:");
  log(
    (await runtime.requestUrl(`http://localhost:${frontendPort}`, "HEAD"))
      ? `frontend: healthy / 健康 http://localhost:${frontendPort}`
      : "frontend: unavailable / 不可用",
  );
  log(
    (await runtime.requestUrl(`http://localhost:${backendPort}/health`))
      ? `backend: healthy / 健康 http://localhost:${backendPort}/health`
      : "backend: unavailable / 不可用",
  );
}

async function showDockerStatus(paths, env) {
  await docker.ensureDockerReady();
  const result = docker.readDockerCompose(paths, ["ps"]);
  if (result.stdout.trim()) {
    process.stdout.write(`${result.stdout.trim()}${os.EOL}`);
  } else {
    log("No docker compose services found.");
  }
  if (result.status !== 0 && result.stderr.trim()) {
    process.stderr.write(`${result.stderr.trim()}${os.EOL}`);
  }
  log("");
  await showDockerHealth(env);
}

async function showDockerLogs(paths, args) {
  const { flags, positionals } = parseCliOptions(args);
  const target = positionals[0] || "all";
  const follow = flags.has("follow");
  const composeArgs = ["logs", "--tail", "80"];

  if (follow) {
    composeArgs.push("-f");
  }
  if (target !== "all") {
    composeArgs.push(target);
  }

  await docker.runDockerCompose(paths, composeArgs);
}

async function invokeDockerStart(rootDir, env, options = {}) {
  const { paths } = runtime.loadProjectEnvironment(rootDir, log);

  if (!options.skipEnvCheck && !runtime.pathExists(paths.envFile)) {
    throw new Error(
      `Missing ${paths.envFile}. Run \`sclaw docker-install\` first to configure the docker stack.`,
    );
  }

  const psResult = docker.readDockerCompose(paths, ["ps", "-q"]);
  const hasExistingContainers = psResult.status === 0 && Boolean(psResult.stdout.trim());
  const composeArgs = options.build
    ? ["up", "--build", "-d"]
    : hasExistingContainers
      ? ["start"]
      : ["up", "-d"];

  await docker.runDockerCompose(paths, composeArgs, { env });

  const refreshed = runtime.loadProjectEnvironment(rootDir, log).env;
  if (options.waitForServices !== false) {
    log("Waiting for docker services... / 等待 Docker 服务启动...");
    const ready = await docker.waitForDockerServices(refreshed, options.timeoutMs || 180000);
    if (!ready) {
      log("Some docker services are not ready yet / 部分 Docker 服务尚未完全就绪");
    }
  }

  log("");
  await showDockerStatus(paths, refreshed);
}

async function invokeDockerStop(rootDir) {
  const { paths } = runtime.loadProjectEnvironment(rootDir, log);
  await docker.runDockerCompose(paths, ["stop"]);
  log("Docker services stopped / Docker 服务已停止");
}

async function invokeDockerInstall(rootDir, env, rawArgs) {
  const { paths } = runtime.loadProjectEnvironment(rootDir, log);
  const config = await collectDockerInstallConfig(rawArgs, env);

  log("Saving docker configuration... / 正在写入 Docker 配置...");
  persistDockerEnv(paths, config);
  log(`LLM provider: ${config.provider}`);
  log(`LLM base URL: ${config.baseUrl}`);
  log(`LLM API key: ${maskSecret(config.apiKey)}`);
  log(`LLM model: ${config.model}`);

  if (!config.skipApiTest) {
    log("Testing API connection... / 正在测试 API 连接...");
    const testResult = await testApiConnection(config);
    if (testResult.ok) {
      log(testResult.message);
    } else {
      log(`API test failed, continuing anyway / API 测试失败，继续执行: ${testResult.message}`);
    }
  }

  await invokeDockerStart(rootDir, runtime.loadProjectEnvironment(rootDir, log).env, {
    build: true,
    skipEnvCheck: true,
    waitForServices: true,
    timeoutMs: 180000,
  });
}

async function installUvFromOfficialScript() {
  const installDir = process.env.UV_INSTALL_DIR || path.join(os.homedir(), ".local", "bin");
  const response = await fetch("https://astral.sh/uv/install.sh");
  if (!response.ok) {
    throw new Error(`Failed to download uv installer: ${response.status} ${response.statusText}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sclaw-uv-install-"));
  const scriptPath = path.join(tempDir, "install-uv.sh");
  try {
    fs.writeFileSync(scriptPath, await response.text(), "utf8");
    await runtime.runCommand("sh", [scriptPath], {
      env: {
        ...process.env,
        UV_INSTALL_DIR: installDir,
      },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const installedUv = path.join(installDir, "uv");
  if (runtime.pathExists(installedUv)) {
    process.env.PATH = `${installDir}${path.delimiter}${process.env.PATH || ""}`;
  }
}

async function ensureUv(rootDir) {
  if (runtime.hasCommand("uv")) {
    return;
  }

  if (runtime.isWindows()) {
    runtime.requireCommand(
      "winget",
      "Install winget, or install uv manually and then rerun `sclaw ensure-uv`.",
    );
    await runtime.runCommand("winget", [
      "install",
      "--id",
      "AstralSoftware.UV",
      "-e",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
    runtime.requireCommand(
      "uv",
      "uv installation finished, but `uv` is still unavailable. Restart your terminal and retry.",
    );
    return;
  }

  await installUvFromOfficialScript();
  runtime.requireCommand(
    "uv",
    "uv installation finished, but `uv` is still unavailable. Add ~/.local/bin to PATH and retry.",
  );
}

async function ensureNpmDependencies(projectDir, projectName, packageNames = []) {
  const lockFile = path.join(projectDir, "package-lock.json");
  const nodeModulesDir = path.join(projectDir, "node_modules");
  const lockSnapshot = path.join(nodeModulesDir, ".package-lock.snapshot");

  let needsInstall = !runtime.pathExists(nodeModulesDir);
  if (!needsInstall && runtime.pathExists(lockFile)) {
    needsInstall = runtime.sha256File(lockFile) !== runtime.sha256File(lockSnapshot);
  }
  if (!needsInstall && packageNames.length > 0) {
    needsInstall = !runtime.installedPackagesMatchLock(projectDir, packageNames);
  }

  if (!needsInstall) {
    return;
  }

  log(`Installing ${projectName} dependencies...`);
  await runtime.runCommand(runtime.getNpmCommand(), ["ci", "--prefix", projectDir]);
  if (runtime.pathExists(lockFile)) {
    runtime.ensureDirectory(nodeModulesDir);
    fs.copyFileSync(lockFile, lockSnapshot);
  }
}

async function ensureAnalysisPython(rootDir, env) {
  runtime.requireCommand("python", "Install Python 3.12+ and retry.");

  const { paths } = runtime.loadProjectEnvironment(rootDir);
  if (!runtime.pathExists(paths.analysisRequirementsFile)) {
    throw new Error(`Analysis requirements file not found: ${paths.analysisRequirementsFile}`);
  }

  const currentPython = runtime.resolveAnalysisPython(rootDir, env);
  if (currentPython && (await runtime.pythonModuleExists(currentPython, "uvicorn"))) {
    return currentPython;
  }

  await ensureUv(rootDir);

  const pythonVersion =
    env.ANALYSIS_PYTHON_VERSION || runtime.DEFAULT_ANALYSIS_PYTHON_VERSION;
  log("Preparing analysis Python virtual environment...");
  await runtime.runCommand("uv", [
    "venv",
    "--python",
    pythonVersion,
    path.join(rootDir, "backend", ".venv"),
  ]);

  const resolvedPython = runtime.resolveAnalysisPython(rootDir, env);
  if (!resolvedPython) {
    throw new Error("Failed to locate backend/.venv python after uv venv.");
  }

  await runtime.runCommand("uv", [
    "pip",
    "install",
    "--python",
    resolvedPython,
    "--link-mode=copy",
    "-r",
    paths.analysisRequirementsFile,
  ]);

  if (!(await runtime.pythonModuleExists(resolvedPython, "uvicorn"))) {
    throw new Error("backend/.venv is present but missing uvicorn.");
  }

  return resolvedPython;
}

async function ensureOpenSeesRuntime(rootDir, env) {
  const pythonBin = runtime.resolveAnalysisPython(rootDir, env);
  if (!pythonBin) {
    throw new Error("No analysis Python environment found at backend/.venv.");
  }

  const paths = runtime.resolvePaths(rootDir);
  const probeScript = path.join(paths.analysisOpenseesStaticRoot, "opensees_runtime.py");
  if (!runtime.pathExists(probeScript)) {
    throw new Error(`OpenSees probe script missing: ${probeScript}`);
  }

  const analysisEnv = runtime.buildAnalysisEnvironment(rootDir, env);
  await runtime.runCommand(
    pythonBin,
    [probeScript, "--json"],
    {
      env: analysisEnv,
      stdio: "ignore",
    },
  );
}

async function invokeConvertBatch(rootDir, env, rawArgs = []) {
  await ensureAnalysisPython(rootDir, env);
  await convertBatch.runConvertBatch(rootDir, rawArgs);
}

async function invokePostgresImport(rootDir, env, rawArgs = []) {
  const { paths } = runtime.loadProjectEnvironment(rootDir);
  runtime.ensureDirectory(paths.dataDir);

  const commandEnv = {
    ...env,
  };
  if (!commandEnv.DATABASE_URL && !commandEnv.SQLITE_TARGET_DATABASE_URL) {
    commandEnv.DATABASE_URL = `file:${path.join(paths.dataDir, "structureclaw.db").replace(/\\/gu, "/")}`;
  }

  await runtime.runCommand(
    process.execPath,
    [path.join(rootDir, "backend", "scripts", "migrate-postgres-to-sqlite.mjs"), ...rawArgs],
    {
      cwd: rootDir,
      env: commandEnv,
    },
  );
}

function isLocalPostgresUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return new Set(["localhost", "127.0.0.1", "::1", "postgres"]).has(
      String(parsed.hostname || "").toLowerCase(),
    );
  } catch {
    return false;
  }
}

function createTimestampToken() {
  return new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
}

async function invokeAutoMigrateLegacyPostgres(rootDir, env) {
  const { paths } = runtime.loadProjectEnvironment(rootDir);
  if (!runtime.pathExists(paths.envFile)) {
    return;
  }

  const envText = fs.readFileSync(paths.envFile, "utf8");
  const dotEnv = runtime.parseDotEnv(envText);
  const legacyDatabaseUrl = String(dotEnv.DATABASE_URL || "").trim();

  if (!legacyDatabaseUrl || legacyDatabaseUrl.startsWith("file:")) {
    return;
  }
  if (
    !legacyDatabaseUrl.startsWith("postgres://") &&
    !legacyDatabaseUrl.startsWith("postgresql://")
  ) {
    return;
  }
  if (!isLocalPostgresUrl(legacyDatabaseUrl)) {
    throw new Error(
      ".env still points DATABASE_URL at a non-local PostgreSQL host. Automatic migration is limited to local legacy sources.",
    );
  }

  const sqliteDatabaseUrl = `file:${path.join(paths.dataDir, "structureclaw.db").replace(/\\/gu, "/")}`;
  log("[info] Detected legacy local PostgreSQL DATABASE_URL in .env.");
  log(`[info] Migrating data into SQLite at ${sqliteDatabaseUrl} ...`);
  await invokePostgresImport(
    rootDir,
    {
      ...env,
      POSTGRES_SOURCE_DATABASE_URL: legacyDatabaseUrl,
      DATABASE_URL: sqliteDatabaseUrl,
    },
    ["--force"],
  );

  const backupPath = `${paths.envFile}.pre-sqlite-migration.${createTimestampToken()}.bak`;
  fs.copyFileSync(paths.envFile, backupPath);
  let updatedEnvText = replaceEnvValue(
    envText,
    "DATABASE_URL",
    "file:../../.runtime/data/structureclaw.db",
  );
  updatedEnvText = replaceEnvValue(
    updatedEnvText,
    "POSTGRES_SOURCE_DATABASE_URL",
    legacyDatabaseUrl,
  );
  fs.writeFileSync(paths.envFile, updatedEnvText);
  log("[ok] Legacy PostgreSQL config migrated to SQLite.");
  log(`[info] Original .env backed up to ${backupPath}`);
}

async function invokeDbInit(rootDir, env) {
  const { paths } = runtime.loadProjectEnvironment(rootDir);
  runtime.ensureDirectory(paths.dataDir);
  runtime.ensureLocalSqliteConfig(rootDir, env, log);
  runtime.assertSqliteDatabaseUrl(env);
  log(`Running db:init with DATABASE_URL=${env.DATABASE_URL}`);
  await runtime.runCommand(
    runtime.getNpmCommand(),
    ["run", "db:init", "--prefix", paths.backendDir],
    {
      env,
    },
  );
}

function getServiceCommand(name, frontendPort) {
  if (name === "backend") {
    return {
      command: runtime.getNpmCommand(),
      args: ["run", "dev", "--prefix", "backend"],
      envPatch: {},
    };
  }

  return {
    command: runtime.getNpmCommand(),
    args: ["run", "dev", "--prefix", "frontend", "--", "--port", frontendPort],
    envPatch: {
      FRONTEND_PORT: frontendPort,
      PORT: frontendPort,
    },
  };
}

function startTrackedService(paths, env, name, frontendPort) {
  const existingPid = runtime.readTrackedPid(paths, name);
  if (existingPid) {
    log(`${name} is already running (pid ${existingPid}).`);
    return;
  }

  const { command, args, envPatch } = getServiceCommand(name, frontendPort);
  const logFile = runtime.logFilePath(paths, name);
  runtime.appendSessionHeader(logFile, name);
  const pid = runtime.spawnDetached(command, args, {
    cwd: paths.rootDir,
    env: {
      ...env,
      ...envPatch,
    },
    logFile,
  });
  runtime.writeTrackedPid(paths, name, pid);
  log(`Started ${name} (pid ${pid}).`);
}

async function stopTrackedService(paths, name) {
  const pid = runtime.readTrackedPid(paths, name);
  if (!pid) {
    log(`${name} is not tracked.`);
    return;
  }
  log(`Stopping ${name} (pid ${pid})...`);
  try {
    await runtime.stopProcessTree(pid);
  } catch {
  }
  runtime.removeTrackedPid(paths, name);
}

function latestSessionHeaderOrStopped(paths, name) {
  const logFile = runtime.logFilePath(paths, name);
  return runtime.latestSessionHeader(logFile);
}

async function showHealth(env) {
  const backendUrl = `http://localhost:${env.PORT || runtime.DEFAULT_BACKEND_PORT}/health`;
  const frontendUrl = `http://localhost:${env.FRONTEND_PORT || runtime.DEFAULT_FRONTEND_PORT}`;
  log("Health checks:");
  log((await runtime.requestUrl(backendUrl)) ? "backend: healthy" : "backend: unavailable");
  log((await runtime.requestUrl(frontendUrl, "HEAD")) ? "frontend: healthy" : "frontend: unavailable");
}

function showServiceStatus(paths, name) {
  const pid = runtime.readTrackedPid(paths, name);
  const header = latestSessionHeaderOrStopped(paths, name);
  if (pid) {
    log(`${name}: running (pid ${pid})`);
    if (header) {
      log(`  session: ${header}`);
    }
    return;
  }
  log(`${name}: stopped`);
  if (header) {
    log(`  last session: ${header}`);
  }
}

async function showLogs(paths, args) {
  const requestedTarget = args[0] && !args[0].startsWith("--") ? args[0] : "all";
  const follow = args.includes("--follow");
  const files =
    requestedTarget === "backend"
      ? [runtime.logFilePath(paths, "backend")]
      : requestedTarget === "frontend"
        ? [runtime.logFilePath(paths, "frontend")]
        : [runtime.logFilePath(paths, "frontend"), runtime.logFilePath(paths, "backend")];
  const existingFiles = [];

  for (const filePath of files) {
    if (!runtime.pathExists(filePath)) {
      log(`Log file not found yet: ${filePath}`);
      continue;
    }
    existingFiles.push(filePath);
    log(`----- ${path.basename(filePath)} latest session -----`);
    const lines = runtime.latestSessionLines(filePath);
    if (lines.length > 0) {
      process.stdout.write(`${lines.join(os.EOL)}${os.EOL}`);
    }
  }

  if (!follow || existingFiles.length === 0) {
    return;
  }

  log("----- follow mode: streaming full logs -----");
  if (runtime.isWindows()) {
    const command = [
      "-NoProfile",
      "-Command",
      `Get-Content -LiteralPath ${existingFiles
        .map((filePath) => `'${filePath.replace(/'/gu, "''")}'`)
        .join(", ")} -Tail 40 -Wait`,
    ];
    await runtime.runCommand("powershell", command);
    return;
  }

  await runtime.runCommand("tail", ["-n", "80", "-f", ...existingFiles]);
}

async function installCli(rootDir, args) {
  const force = args.includes("--force");
  const installDir = path.join(os.homedir(), ".local", "bin");
  runtime.ensureDirectory(installDir);

  const entryPath = getCliEntryPath(rootDir);
  const shellTarget = path.join(installDir, "sclaw");
  const cmdTarget = path.join(installDir, "sclaw.cmd");

  if (!force && (runtime.pathExists(shellTarget) || runtime.pathExists(cmdTarget))) {
    throw new Error(
      `Target already exists in ${installDir}. Use \`sclaw install-cli --force\` to overwrite.`,
    );
  }

  const shellScript = `#!/usr/bin/env sh\nnode ${runtime.quoteShellArgument(entryPath)} "$@"\n`;
  fs.writeFileSync(shellTarget, shellScript, { mode: 0o755 });

  if (runtime.isWindows()) {
    const cmdScript = `@echo off\r\nnode "${entryPath}" %*\r\n`;
    fs.writeFileSync(cmdTarget, cmdScript);
  }

  log(`Installed user-local sclaw launcher in ${installDir}`);
  log("If the command is not found, add that directory to your PATH.");
}

function resolveApiBase(env) {
  if (env.SCLAW_API_BASE) {
    return env.SCLAW_API_BASE;
  }
  return `http://localhost:${env.PORT || runtime.DEFAULT_BACKEND_PORT}`;
}

async function callJsonApi(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}\n${text}`);
  }
  log(text);
}

async function runSkillCommand(env, args) {
  const apiBase = resolveApiBase(env);
  const subcommand = args[0];

  switch (subcommand) {
    case "search": {
      const keyword = args[1];
      const domain = args[2];
      if (!keyword) {
        throw new Error("Usage: sclaw skill search <keyword> [domain]");
      }
      const searchUrl = new URL(`${apiBase}/api/v1/agent/skillhub/search`);
      searchUrl.searchParams.set("q", keyword);
      if (domain) {
        searchUrl.searchParams.set("domain", domain);
      }
      await callJsonApi(searchUrl.toString());
      return;
    }
    case "install":
    case "enable":
    case "disable":
    case "uninstall": {
      const skillId = args[1];
      if (!skillId) {
        throw new Error(`Usage: sclaw skill ${subcommand} <skill-id>`);
      }
      await callJsonApi(`${apiBase}/api/v1/agent/skillhub/${subcommand}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ skillId }),
      });
      return;
    }
    case "list":
      await callJsonApi(`${apiBase}/api/v1/agent/skillhub/installed`);
      return;
    default:
      throw new Error(
        "Usage:\n  sclaw skill search <keyword> [domain]\n  sclaw skill install <skill-id>\n  sclaw skill enable <skill-id>\n  sclaw skill disable <skill-id>\n  sclaw skill uninstall <skill-id>\n  sclaw skill list",
      );
  }
}

async function invokeLocalUp(rootDir, env, options = {}) {
  const context = runtime.loadProjectEnvironment(rootDir);
  const { paths } = context;

  runtime.ensureLocalSqliteConfig(rootDir, env, log);
  runtime.assertSqliteDatabaseUrl(env);
  await ensureNpmDependencies(paths.backendDir, "backend", ["prisma", "@prisma/client"]);
  await ensureNpmDependencies(paths.frontendDir, "frontend", ["next"]);
  await ensureAnalysisPython(rootDir, env);
  await ensureOpenSeesRuntime(rootDir, env);

  if (!options.skipInfra && env.REDIS_URL && String(env.REDIS_URL).toLowerCase() !== "disabled") {
    runtime.requireCommand(
      "docker",
      "Install Docker Desktop and retry, or use `sclaw start` (alias: `local-up-noinfra`).",
    );
    await runtime.runCommand("docker", [
      "compose",
      "-f",
      paths.dockerComposeFile,
      "up",
      "-d",
      "redis",
    ]);
  } else if (options.skipInfra) {
    log("Skipping optional infra startup.");
  }

  if (!options.skipDbInit) {
    await invokeDbInit(rootDir, env);
  }

  startTrackedService(paths, env, "backend", env.FRONTEND_PORT || runtime.DEFAULT_FRONTEND_PORT);
  startTrackedService(paths, env, "frontend", env.FRONTEND_PORT || runtime.DEFAULT_FRONTEND_PORT);
  log("");
  log("Local stack started.");
  log(`Logs: ${paths.logDir}`);
  log(`Frontend: http://localhost:${env.FRONTEND_PORT || runtime.DEFAULT_FRONTEND_PORT}`);
  log(`Backend:  http://localhost:${env.PORT || runtime.DEFAULT_BACKEND_PORT}`);
}

async function invokeDoctor(rootDir, env) {
  runtime.requireCommand("node", "Install Node.js 18+ and retry.");
  runtime.requireCommand("npm", "Install npm and retry.");
  runtime.requireCommand("python", "Install Python 3.12+ and retry.");
  runtime.ensureLocalSqliteConfig(rootDir, env, log);
  runtime.assertSqliteDatabaseUrl(env);

  const { paths } = runtime.loadProjectEnvironment(rootDir);
  await ensureNpmDependencies(paths.backendDir, "backend", ["prisma", "@prisma/client"]);
  await ensureNpmDependencies(paths.frontendDir, "frontend", ["next"]);
  await ensureAnalysisPython(rootDir, env);
  await ensureOpenSeesRuntime(rootDir, env);
  await invokeDbInit(rootDir, env);
  log("Local startup checks passed.");
}

async function dispatch(commandName, rawArgs, rootDir) {
  const context = runtime.loadProjectEnvironment(rootDir, log);
  const { paths, env } = context;

  switch (commandName) {
    case "help":
      log(formatHelp(rootDir));
      return;
    case "version":
      log(`sclaw ${getPackageMetadata(rootDir).version}`);
      return;
    case "install":
      await ensureNpmDependencies(paths.backendDir, "backend", ["prisma", "@prisma/client"]);
      await ensureNpmDependencies(paths.frontendDir, "frontend", ["next"]);
      return;
    case "install-cli":
      await installCli(rootDir, rawArgs);
      return;
    case "ensure-uv":
      await ensureUv(rootDir);
      return;
    case "setup-analysis-python":
      await ensureAnalysisPython(rootDir, env);
      return;
    case "dev-backend":
      await runtime.runCommand(runtime.getNpmCommand(), ["run", "dev", "--prefix", paths.backendDir], {
        env,
      });
      return;
    case "dev-frontend":
      await runtime.runCommand(
        runtime.getNpmCommand(),
        ["run", "dev", "--prefix", paths.frontendDir, "--", "--port", env.FRONTEND_PORT],
        {
          env: {
            ...env,
            PORT: env.FRONTEND_PORT,
          },
        },
      );
      return;
    case "build":
      await runtime.runCommand(runtime.getNpmCommand(), ["run", "build", "--prefix", paths.backendDir], {
        env,
      });
      await runFrontendBuild(paths, env);
      return;
    case "convert-batch":
      await invokeConvertBatch(rootDir, env, rawArgs);
      return;
    case "db-up":
      await runtime.runCommand("docker", ["compose", "-f", paths.dockerComposeFile, "up", "-d", "redis"]);
      return;
    case "db-down":
      await runtime.runCommand("docker", ["compose", "-f", paths.dockerComposeFile, "stop", "redis"]);
      return;
    case "db-init":
      await invokeDbInit(rootDir, env);
      return;
    case "db-import-postgres":
      await invokePostgresImport(rootDir, env, rawArgs);
      return;
    case "db-auto-migrate-legacy-postgres":
      await invokeAutoMigrateLegacyPostgres(rootDir, env);
      return;
    case "docker-up":
      await docker.runDockerCompose(paths, ["up", "--build", "-d"], { env });
      return;
    case "docker-down":
      await docker.runDockerCompose(paths, ["down"], { env });
      return;
    case "docker-install":
      await invokeDockerInstall(rootDir, env, rawArgs);
      return;
    case "docker-start":
      await invokeDockerStart(rootDir, env, { waitForServices: true });
      return;
    case "docker-stop":
      await invokeDockerStop(rootDir);
      return;
    case "docker-status":
      await showDockerStatus(paths, env);
      return;
    case "docker-logs":
      await showDockerLogs(paths, rawArgs);
      return;
    case "local-up":
      await invokeLocalUp(rootDir, env, { skipInfra: false });
      return;
    case "health":
      await showHealth(env);
      return;
    case "doctor":
      await invokeDoctor(rootDir, env);
      return;
    case "start":
      await invokeLocalUp(rootDir, env, { skipInfra: true });
      return;
    case "restart":
      await stopTrackedService(paths, "frontend");
      await stopTrackedService(paths, "backend");
      await invokeLocalUp(rootDir, env, { skipInfra: true });
      return;
    case "stop":
      await stopTrackedService(paths, "frontend");
      await stopTrackedService(paths, "backend");
      try {
        await runtime.runCommand("docker", ["compose", "-f", paths.dockerComposeFile, "stop", "redis"], {
          stdio: "ignore",
        });
      } catch {
      }
      log("Local stack stopped.");
      return;
    case "status":
      showServiceStatus(paths, "backend");
      showServiceStatus(paths, "frontend");
      log("");
      await showHealth(env);
      return;
    case "logs":
      await showLogs(paths, rawArgs);
      return;
    case "skill":
      await runSkillCommand(env, rawArgs);
      return;
    default:
      throw new Error(`Unknown command: ${commandName}`);
  }
}

async function main(argv = process.argv.slice(2), options = {}) {
  ensureSupportedNodeVersion();
  const rootDir = runtime.resolveProjectRoot(options.rootDir);
  const rawCommand = argv[0] || "help";
  const commandName = resolveCommandName(rawCommand);
  const rawArgs = argv.slice(1);

  if (!COMMAND_NAMES.has(commandName)) {
    log(`Unknown command: ${rawCommand}`);
    log("");
    log(formatHelp(rootDir));
    return 1;
  }

  await dispatch(commandName, rawArgs, rootDir);
  return 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  formatHelp,
  getPackageMetadata,
  main,
  resolveCommandName,
};
