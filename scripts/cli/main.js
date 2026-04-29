const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");

const { ALIAS_TO_COMMAND, COMMANDS, COMMAND_NAMES } = require("./command-manifest");
const convertBatch = require("./convert-batch");
const { runFrontendBuild } = require("./frontend-build");
const runtime = require("./runtime");

const MIN_NODE_MAJOR = 20;
const ANALYSIS_REQUIRED_PYTHON_MODULES = ["uvicorn", "yaml"];

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
    `StructureClaw CLI requires Node.js v${MIN_NODE_MAJOR}+ (current: v${process.versions.node}).`,
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

function formatCommandUsage(usage, programName) {
  return usage.replace(/^sclaw\b/u, programName);
}

function formatHelp(rootDir, programName = "sclaw") {
  const { version } = getPackageMetadata(rootDir);
  const lines = [
    "StructureClaw CLI",
    "",
    `Version: ${version}`,
    "",
    "Usage:",
    `  ${programName} <command> [options]`,
    "",
    "Commands:",
  ];

  for (const command of COMMANDS) {
    lines.push(`  ${formatCommandUsage(command.usage, programName).padEnd(48)} ${command.description}`);
  }

  lines.push("");
  lines.push("Notes:");
  lines.push("  - `doctor` is the cross-platform local preflight check.");
  lines.push("  - `start` is the recommended way to launch the local stack.");
  lines.push("  - Regressions and contract checks: `node tests/runner.mjs ...`.");
  return lines.join(os.EOL);
}

function log(message = "") {
  process.stdout.write(`${message}${os.EOL}`);
}

function getCliEntryPath(rootDir, programName = "sclaw") {
  const preferred = path.join(rootDir, programName);
  if (runtime.pathExists(preferred)) {
    return preferred;
  }
  return path.join(rootDir, "sclaw");
}

function inferCliContext(options = {}) {
  const inferredProgramName =
    options.programName ||
    process.env.SCLAW_PROGRAM_NAME ||
    path.basename(process.argv[1] || "sclaw") ||
    "sclaw";
  const profile =
    String(options.profile || process.env.SCLAW_PROFILE || (inferredProgramName === "sclaw_cn" ? "cn" : "default"))
      .trim()
      .toLowerCase();
  return {
    programName: inferredProgramName,
    profile,
  };
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
    // Try winget first; fall back to PowerShell installer if winget is unavailable or fails.
    if (runtime.hasCommand("winget")) {
      try {
        await runtime.runCommand("winget", [
          "install",
          "--id",
          "AstralSoftware.UV",
          "-e",
          "--accept-package-agreements",
          "--accept-source-agreements",
        ]);
        if (runtime.hasCommand("uv")) {
          return;
        }
      } catch {
        // winget install failed — fall through to PowerShell installer.
      }
    }

    // PowerShell installer (official Astral recommendation for Windows).
    const ps = runtime.hasCommand("pwsh") ? "pwsh" : "powershell";
    await runtime.runCommand(ps, [
      "-ExecutionPolicy",
      "ByPass",
      "-Command",
      "irm https://astral.sh/uv/install.ps1 | iex",
    ]);
    // The installer puts uv in %USERPROFILE%\.local\bin which may not be on
    // the current process PATH.  Detect and inject it so subsequent commands
    // in this process can find uv.
    const localBin = path.join(os.homedir(), ".local", "bin");
    if (fs.existsSync(path.join(localBin, "uv.exe")) || fs.existsSync(path.join(localBin, "uv"))) {
      process.env.PATH = `${localBin};${process.env.PATH}`;
    }
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
  const { paths } = runtime.loadProjectEnvironment(rootDir, () => {}, {
    profile: env.SCLAW_PROFILE,
    programName: env.SCLAW_PROGRAM_NAME,
  });
  if (!runtime.pathExists(paths.analysisRequirementsFile)) {
    throw new Error(`Analysis requirements file not found: ${paths.analysisRequirementsFile}`);
  }

  const currentPython = runtime.resolveAnalysisPython(rootDir, env);
  if (currentPython) {
    const currentModuleStates = await Promise.all(
      ANALYSIS_REQUIRED_PYTHON_MODULES.map(async (moduleName) => [moduleName, await runtime.pythonModuleExists(currentPython, moduleName)]),
    );
    if (currentModuleStates.every(([, present]) => present)) {
      return currentPython;
    }
  }

  await ensureUv(rootDir);
  // ensureUv may have appended to process.env.PATH (e.g. after a fresh uv
  // install on Windows).  Propagate that to the caller-supplied env dict so
  // that buildAnalysisEnvironment / runCommand pick it up.
  if (env.PATH !== process.env.PATH) {
    env.PATH = process.env.PATH;
  }

  // Resolve venv location: always in the user data directory
  const venvDir = path.join(paths.runtimeDir, ".venv");

  let resolvedPython = currentPython;
  if (!resolvedPython) {
    const pythonVersion =
      env.ANALYSIS_PYTHON_VERSION || runtime.DEFAULT_ANALYSIS_PYTHON_VERSION;
    log("Preparing analysis Python virtual environment...");
    await runtime.runCommand("uv", [
      "venv",
      "--python",
      pythonVersion,
      venvDir,
    ]);

    resolvedPython = runtime.resolveAnalysisPython(rootDir, env);
  }
  if (!resolvedPython) {
    throw new Error(`Failed to locate Python after creating venv at ${venvDir}.`);
  }

  await runtime.runCommand("uv", [
    "pip",
    "install",
    "--python",
    resolvedPython,
    "--link-mode=copy",
    "-r",
    paths.analysisRequirementsFile,
  ], {
    env,
  });

  const installedModuleStates = await Promise.all(
    ANALYSIS_REQUIRED_PYTHON_MODULES.map(async (moduleName) => [moduleName, await runtime.pythonModuleExists(resolvedPython, moduleName)]),
  );
  const missingModules = installedModuleStates
    .filter(([, present]) => !present)
    .map(([moduleName]) => moduleName);
  if (missingModules.length > 0) {
    throw new Error(`Python venv is present but missing required analysis modules: ${missingModules.join(", ")}.`);
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
  const { paths } = runtime.loadProjectEnvironment(rootDir, () => {}, {
    profile: env.SCLAW_PROFILE,
    programName: env.SCLAW_PROGRAM_NAME,
  });
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
  const { paths } = runtime.loadProjectEnvironment(rootDir, () => {}, {
    profile: env.SCLAW_PROFILE,
    programName: env.SCLAW_PROGRAM_NAME,
  });
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
    `file:${path.join(paths.dataDir, "structureclaw.db").replace(/\\/gu, "/")}`,
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
  const { paths } = runtime.loadProjectEnvironment(rootDir, () => {}, {
    profile: env.SCLAW_PROFILE,
    programName: env.SCLAW_PROGRAM_NAME,
  });
  runtime.ensureDirectory(paths.dataDir);
  runtime.ensureLocalSqliteConfig(rootDir, env, log);
  runtime.assertSqliteDatabaseUrl(env);
  log(`Running db:init with DATABASE_URL=${env.DATABASE_URL}`);
  await runtime.runCommand(
    runtime.getNpmCommand(),
    ["run", "db:init", "--prefix", path.join(rootDir, "backend")],
    {
      env,
    },
  );
}

async function invokeScopedDbInit(rootDir, env, profileName) {
  const scopedEnv = {
    ...env,
  };
  runtime.ensureLocalSqliteConfig(rootDir, scopedEnv, log, { profileName });
  await invokeDbInit(rootDir, scopedEnv);
}

/**
 * Remap DATABASE_URL from package-install dir to user-writable runtime dir.
 * `ensureLocalSqliteConfig` derives URLs from rootDir (the package install
 * directory), which is read-only for global npm installs. This function
 * redirects the SQLite path to paths.dataDir.
 */
function remapInstalledSqliteDatabaseUrl(env, paths) {
  if (typeof env.DATABASE_URL !== "string" || !env.DATABASE_URL.startsWith("file:")) {
    return;
  }
  // Always use the user-writable data directory
  env.DATABASE_URL = `file:${path.join(paths.dataDir, "structureclaw.db").replace(/\\/gu, "/")}`;
}

function resolveBundledPrismaEntry(rootDir) {
  return require.resolve("prisma/build/index.js", {
    paths: [rootDir, path.join(rootDir, "backend")],
  });
}

async function runBundledPrisma(rootDir, args, env) {
  const prismaEntry = resolveBundledPrismaEntry(rootDir);
  await runtime.runCommand(process.execPath, [prismaEntry, ...args], {
    env,
  });
}

/**
 * In installed mode, run prisma db push + seed directly since there is no
 * backend package.json with npm scripts.
 */
async function invokeInstalledDbInit(rootDir, env, paths) {
  runtime.ensureDirectory(paths.dataDir);
  const prismaSchema = path.join(rootDir, "backend", "prisma", "schema.prisma");
  if (!runtime.pathExists(prismaSchema)) {
    log("Skipping database init — Prisma schema not found.");
    return;
  }

  // Step 1: Ensure Prisma client is generated
  log("Generating Prisma client...");
  try {
    await runBundledPrisma(rootDir, [
      "generate",
      `--schema=${prismaSchema}`,
    ], env);
    log("[ok] Prisma client generated.");
  } catch (err) {
    log(`[warn] Prisma generate failed: ${err.message}`);
  }

  // Step 2: Push schema to SQLite
  log("Initializing database (installed mode)...");
  try {
    await runBundledPrisma(rootDir, [
      "db", "push",
      `--schema=${prismaSchema}`,
      "--accept-data-loss",
    ], env);
    log("[ok] Database schema synced.");
  } catch (err) {
    log(`[warn] Database init failed: ${err.message}`);
  }
}

function getServiceCommand(name, frontendPort, paths) {
  // Installed package: run compiled backend directly (no npm run dev)
  if (name === "backend" && paths.installedMode) {
    return {
      command: process.execPath,
      args: [path.join(paths.backendDir, "index.js")],
      envPatch: {},
    };
  }

  if (name === "backend") {
    return {
      command: runtime.getNpmCommand(),
      args: ["run", "dev", "--prefix", "backend"],
      envPatch: {
        SCLAW_FRONTEND_DIR: path.join(paths.rootDir, "frontend", "out"),
      },
    };
  }

  // Frontend is served statically by the backend; no separate process needed
  return { command: process.execPath, args: ["-e", "process.exit(0)"], envPatch: {} };
}

function parseBooleanEnvFlag(rawValue) {
  return /^(1|true|yes|on)$/iu.test(String(rawValue || "").trim());
}

function readTrackedServicePids(paths) {
  return ["backend", "frontend"]
    .map((name) => runtime.readTrackedPid(paths, name))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function getPortCleanupOptions(paths, env, allowedPids = readTrackedServicePids(paths)) {
  return {
    allowedPids,
    allowForeign: parseBooleanEnvFlag(env.SCLAW_FORCE_PORT_CLEANUP),
    allowProjectOwned: true,
    rootDir: paths.rootDir,
  };
}

function startTrackedService(paths, env, name, frontendPort) {
  const existingPid = runtime.readTrackedPid(paths, name);
  if (existingPid) {
    log(`${name} is already running (pid ${existingPid}).`);
    return;
  }

  const { command, args, envPatch } = getServiceCommand(name, frontendPort, paths);
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

async function installCli(rootDir, args, programName = "sclaw") {
  const force = args.includes("--force");
  const installDir = path.join(os.homedir(), ".local", "bin");
  runtime.ensureDirectory(installDir);

  const entryPath = getCliEntryPath(rootDir, programName);
  const shellTarget = path.join(installDir, programName);
  const cmdTarget = path.join(installDir, `${programName}.cmd`);

  if (!force && (runtime.pathExists(shellTarget) || runtime.pathExists(cmdTarget))) {
    throw new Error(
      `Target already exists in ${installDir}. Use \`${programName} install-cli --force\` to overwrite.`,
    );
  }

  const shellScript = `#!/usr/bin/env sh\nnode ${runtime.quoteShellArgument(entryPath)} "$@"\n`;
  fs.writeFileSync(shellTarget, shellScript, { mode: 0o755 });

  if (runtime.isWindows()) {
    const cmdScript = `@echo off\r\nnode "${entryPath}" %*\r\n`;
    fs.writeFileSync(cmdTarget, cmdScript);
  }

  log(`Installed user-local ${programName} launcher in ${installDir}`);
  log("If the command is not found, add that directory to your PATH.");
}

function resolveApiBase(env) {
  if (env.SCLAW_API_BASE) {
    return env.SCLAW_API_BASE;
  }
  return `http://localhost:${env.PORT || runtime.DEFAULT_BACKEND_PORT}`;
}

function resolveMirrorValueSource(key, env, dotEnv, paths) {
  if (String(process.env[key] || "").trim()) {
    return "process.env";
  }
  if (dotEnv && String(dotEnv[key] || "").trim()) {
    return "settings.json";
  }

  if (String(env.SCLAW_PROFILE || "").toLowerCase() === "cn") {
    if (key === "PIP_INDEX_URL" && env[key] === runtime.CN_DEFAULT_PIP_INDEX_URL) {
      return "sclaw_cn default";
    }
    if (key === "NPM_CONFIG_REGISTRY" && env[key] === runtime.CN_DEFAULT_NPM_REGISTRY) {
      return "sclaw_cn default";
    }
    if (key === "APT_MIRROR" && env[key] === runtime.CN_DEFAULT_APT_MIRROR) {
      return "sclaw_cn default";
    }
  }

  return "unset";
}

function showMirrorStatus(env, dotEnv, paths) {
  const rows = [
    ["PIP_INDEX_URL", env.PIP_INDEX_URL || "", resolveMirrorValueSource("PIP_INDEX_URL", env, dotEnv, paths)],
    [
      "NPM_CONFIG_REGISTRY",
      env.NPM_CONFIG_REGISTRY || "",
      resolveMirrorValueSource("NPM_CONFIG_REGISTRY", env, dotEnv, paths),
    ],
    ["APT_MIRROR", env.APT_MIRROR || "", resolveMirrorValueSource("APT_MIRROR", env, dotEnv, paths)],
  ];

  log(`Mirror configuration (profile: ${env.SCLAW_PROFILE || "default"}):`);
  for (const [key, value, source] of rows) {
    log(`- ${key}=${value || "<empty>"}  (source: ${source})`);
  }
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
  const programName = env.SCLAW_PROGRAM_NAME || "sclaw";
  const subcommand = args[0];

  switch (subcommand) {
    case "search": {
      const keyword = args[1];
      const domain = args[2];
      if (!keyword) {
        throw new Error(`Usage: ${programName} skill search <keyword> [domain]`);
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
        throw new Error(`Usage: ${programName} skill ${subcommand} <skill-id>`);
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
        `Usage:\n  ${programName} skill search <keyword> [domain]\n  ${programName} skill install <skill-id>\n  ${programName} skill enable <skill-id>\n  ${programName} skill disable <skill-id>\n  ${programName} skill uninstall <skill-id>\n  ${programName} skill list`,
      );
  }
}

async function invokeLocalUp(rootDir, env, options = {}) {
  migrateLegacyEnvFiles(rootDir, runtime.resolvePaths(rootDir));
  const context = runtime.loadProjectEnvironment(rootDir, () => {}, {
    profile: env.SCLAW_PROFILE,
    programName: env.SCLAW_PROGRAM_NAME,
  });
  const { paths } = context;
  const isInstalled = paths.installedMode;

  // Ensure runtime data directory structure exists for installed packages
  if (isInstalled) {
    runtime.ensureDirectory(paths.dataDir);
    runtime.ensureDirectory(paths.logDir);
    runtime.ensureDirectory(paths.pidDir);
    runtime.ensureDirectory(path.join(paths.dataDir, "skills"));
    runtime.ensureDirectory(path.join(paths.dataDir, "tools"));
  }

  runtime.ensureLocalSqliteConfig(rootDir, env, log, { profileName: "start" });
  if (isInstalled) {
    // Remap SQLite URL from package dir to user-writable runtime dir
    remapInstalledSqliteDatabaseUrl(env, paths);
  }
  runtime.assertSqliteDatabaseUrl(env);

  if (!isInstalled) {
    await ensureNpmDependencies(paths.backendDir, "backend", ["prisma", "@prisma/client"]);
    await ensureNpmDependencies(paths.frontendDir, "frontend", ["next"]);
  }

  await ensureAnalysisPython(rootDir, env);
  await ensureOpenSeesRuntime(rootDir, env);

  // In dev mode, ensure frontend is built for static serving
  if (!isInstalled) {
    const frontendOutIndex = path.join(paths.frontendDir, "out", "index.html");
    if (!runtime.pathExists(frontendOutIndex)) {
      log("Building frontend for static serving...");
      await runFrontendBuild(paths, env);
    }
  }

  if (options.skipInfra) {
    log("Skipping optional infra startup.");
  }

  if (!options.skipDbInit) {
    if (isInstalled) {
      await invokeInstalledDbInit(rootDir, env, paths);
    } else {
      await invokeScopedDbInit(rootDir, env, "start");
    }
  }

  // Kill stale processes
  const ports = [env.PORT || runtime.DEFAULT_BACKEND_PORT];
  runtime.killPortPids(ports, log, getPortCleanupOptions(paths, env));

  startTrackedService(paths, env, "backend", env.FRONTEND_PORT || runtime.DEFAULT_FRONTEND_PORT);

  log("");
  if (isInstalled) {
    log("StructureClaw started.");
  } else {
    log("Local stack started.");
  }
  const backendPort = env.PORT || runtime.DEFAULT_BACKEND_PORT;
  const url = `http://localhost:${backendPort}`;
  log(`UI + API: ${url}`);
  log(`Data: ${paths.dataDir}`);
  log(`Logs: ${paths.logDir}`);

  // Wait briefly and check if backend is actually listening
  await runtime.sleep(2000);
  const backendLog = runtime.logFilePath(paths, "backend");
  const lastLines = runtime.tailLines(backendLog, 5);
  const hasStartupError = lastLines.some((line) =>
    /error|Error|ERR|crashed|ENOENT|Cannot find/i.test(line)
  );
  if (hasStartupError) {
    log("");
    log("Backend failed to start. Recent log:");
    for (const line of lastLines) {
      log(`  ${line}`);
    }
    log(`Check full log: ${backendLog}`);
    return;
  }

  // Auto-open browser
  setTimeout(() => openBrowser(url), 1500);
}

async function promptForFirstRunConfig(envFile, existingEnv) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("\n=== StructureClaw First-Run Setup ===\n");
    await rl.question("请-------输入任意键继续-------\n");

    const defaultBaseUrl = existingEnv.LLM_BASE_URL || "https://api.openai.com/v1";
    const defaultModel = existingEnv.LLM_MODEL || "gpt-4-turbo-preview";

    const baseUrl = (await rl.question(`LLM base URL [${defaultBaseUrl}]: `)).trim() || defaultBaseUrl;
    const model = (await rl.question(`LLM model [${defaultModel}]: `)).trim() || defaultModel;
    const apiKeyPrompt = existingEnv.LLM_API_KEY
      ? `LLM API key [press Enter to keep ${maskSecret(existingEnv.LLM_API_KEY)}]: `
      : "LLM API key: ";
    const apiKey = (await rl.question(apiKeyPrompt)).trim() || existingEnv.LLM_API_KEY || "";

    // Write settings.json (primary user config)
    const settingsDir = path.dirname(envFile);
    const settingsPath = path.join(settingsDir, "settings.json");
    const settings = {
      server: { port: 31415, host: "0.0.0.0" },      llm: { baseUrl, model, ...(apiKey ? { apiKey } : {}) },
      logging: { level: "info", llmLogEnabled: false },
      updatedAt: new Date().toISOString(),
    };
    runtime.ensureDirectory(settingsDir);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
    console.log(`\nConfiguration written to ${settingsPath}`);

    // No .env generation — settings.json is the single config source
    // Database URL is resolved from settings.json by the backend at runtime
  } finally {
    rl.close();
  }
}

/**
 * Test LLM connectivity by making a lightweight request to the models endpoint.
 * Non-blocking: warns but does not fail.
 */
async function testLlmConnectivity(baseUrl, apiKey) {
  if (!apiKey) {
    log("  LLM API key not set — skipping connectivity test.");
    return;
  }
  const url = baseUrl.replace(/\/+$/, "") + "/models";
  const http = require("node:http");
  const https = require("node:https");
  const client = url.startsWith("https:") ? https : http;

  const ok = await new Promise((resolve) => {
    const req = client.request(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      },
    );
    req.on("timeout", () => { req.destroy(); resolve(0); });
    req.on("error", () => resolve(0));
    req.end();
  });

  if (ok >= 200 && ok < 300) {
    log("  LLM connectivity: OK");
  } else if (ok === 401 || ok === 403) {
    log("  LLM connectivity: authentication failed — verify your API key.");
  } else if (ok === 0) {
    log("  LLM connectivity: could not reach server — verify your base URL.");
  } else {
    log(`  LLM connectivity: HTTP ${ok} — verify your configuration.`);
  }
}

/**
 * Migrate .env values into settings.json if settings.json doesn't exist yet.
 * This handles the upgrade path from the old .env-only config to JSON config.
 */
function migrateEnvToSettingsJson(paths, envFile) {
  const settingsPath = path.join(paths.runtimeDir, "settings.json");
  if (!runtime.pathExists(envFile)) {
    return; // No .env to migrate from
  }

  const env = runtime.readDotEnv(envFile);
  if (!env.LLM_BASE_URL && !env.LLM_MODEL && !env.LLM_API_KEY
      && !env.PORT && !env.LOG_LEVEL && !env.HOST
      && !env.YJK_PATH && !env.YJKS_ROOT && !env.YJKS_EXE && !env.YJK_PYTHON_BIN
      && !env.YJK_WORK_DIR && !env.YJK_VERSION && !env.YJK_TIMEOUT_S && !env.YJK_INVISIBLE
      && !env.YJK_LAUNCHER_PREWARM && !env.YJK_LAUNCHER_PREWARM_S && !env.YJK_DIRECT_READY_TIMEOUT_S) {
    return; // Nothing meaningful to migrate
  }

  let settings = {};
  if (runtime.pathExists(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      settings = {};
    }
  }

  let changed = false;
  const setMissing = (sectionName, key, value) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    settings[sectionName] = settings[sectionName] || {};
    if (settings[sectionName][key] !== undefined) return;
    settings[sectionName][key] = value;
    changed = true;
  };
  const setMissingNumber = (sectionName, key, value) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setMissing(sectionName, key, parsed);
  };
  const normalizeYjkLauncherPrewarm = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return "";
    if (["0", "false", "no", "off", "never", "disabled"].includes(normalized)) return "off";
    if (["1", "true", "yes", "on", "always", "force"].includes(normalized)) return "always";
    return "auto";
  };

  // Server section
  if (env.PORT || env.HOST) {
    setMissingNumber("server", "port", env.PORT);
    setMissing("server", "host", env.HOST);
  }

  // LLM section
  if (env.LLM_BASE_URL || env.LLM_MODEL || env.LLM_API_KEY) {
    setMissing("llm", "baseUrl", env.LLM_BASE_URL);
    setMissing("llm", "model", env.LLM_MODEL);
    setMissing("llm", "apiKey", env.LLM_API_KEY);
  }

  // Logging section
  if (env.LOG_LEVEL || env.LLM_LOG_ENABLED) {
    setMissing("logging", "level", env.LOG_LEVEL);
    if (env.LLM_LOG_ENABLED === "true") setMissing("logging", "llmLogEnabled", true);
  }

  // YJK section
  if (env.YJK_PATH || env.YJKS_ROOT || env.YJKS_EXE || env.YJK_PYTHON_BIN || env.YJK_WORK_DIR
      || env.YJK_VERSION || env.YJK_TIMEOUT_S || env.YJK_INVISIBLE
      || env.YJK_LAUNCHER_PREWARM || env.YJK_LAUNCHER_PREWARM_S || env.YJK_DIRECT_READY_TIMEOUT_S) {
    setMissing("yjk", "installRoot", env.YJK_PATH || env.YJKS_ROOT);
    setMissing("yjk", "exePath", env.YJKS_EXE);
    setMissing("yjk", "pythonBin", env.YJK_PYTHON_BIN);
    setMissing("yjk", "workDir", env.YJK_WORK_DIR);
    setMissing("yjk", "version", env.YJK_VERSION);
    setMissingNumber("yjk", "timeoutS", env.YJK_TIMEOUT_S);
    if (env.YJK_INVISIBLE === "1" || env.YJK_INVISIBLE === "true") setMissing("yjk", "invisible", true);
    setMissing("yjk", "launcherPrewarm", normalizeYjkLauncherPrewarm(env.YJK_LAUNCHER_PREWARM));
    setMissingNumber("yjk", "launcherPrewarmS", env.YJK_LAUNCHER_PREWARM_S);
    setMissingNumber("yjk", "directReadyTimeoutS", env.YJK_DIRECT_READY_TIMEOUT_S);
  }

  if (!changed) {
    return;
  }

  settings.updatedAt = new Date().toISOString();
  runtime.ensureDirectory(path.dirname(settingsPath));
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  log(`Migrated .env settings to ${settingsPath}`);
}

function migrateLegacyEnvFiles(rootDir, paths) {
  migrateEnvToSettingsJson(paths, paths.envFile);
  const projectEnvFile = path.join(rootDir, ".env");
  if (path.resolve(projectEnvFile) !== path.resolve(paths.envFile)) {
    migrateEnvToSettingsJson(paths, projectEnvFile);
  }
}

/**
 * Open a URL in the default browser.
 */
function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;
  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = process.env.comspec || "cmd.exe";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Non-critical: browser didn't open, user can navigate manually
  }
}

async function invokeDoctor(rootDir, env) {
  runtime.requireCommand("node", "Install Node.js 20+ and retry.");
  runtime.requireCommand("npm", "Install npm and retry.");

  const { paths } = runtime.loadProjectEnvironment(rootDir, () => {}, {
    profile: env.SCLAW_PROFILE,
    programName: env.SCLAW_PROGRAM_NAME,
  });
  const isInstalled = paths.installedMode;

  // Ensure runtime data directory
  runtime.ensureDirectory(paths.dataDir);
  runtime.ensureDirectory(paths.logDir);
  runtime.ensureDirectory(paths.pidDir);
  runtime.ensureDirectory(path.join(paths.runtimeDir, "workspace"));
  runtime.ensureDirectory(path.join(paths.runtimeDir, "agent-checkpoints"));
  runtime.ensureDirectory(path.join(paths.dataDir, "skills"));
  runtime.ensureDirectory(path.join(paths.dataDir, "tools"));

  // Migrate legacy .env files → settings.json if needed. Source checkouts used
  // to keep .env in the repo root; installed/runtime setups use runtimeDir/.env.
  migrateLegacyEnvFiles(rootDir, paths);

  // Interactive first-run wizard if no settings.json exists
  if (!runtime.pathExists(path.join(paths.runtimeDir, "settings.json"))) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await promptForFirstRunConfig(paths.envFile, {});
    } else {
      // Non-interactive: create minimal settings.json with defaults
      const settingsPath = path.join(paths.runtimeDir, "settings.json");
      const settings = {
        server: { port: 31415, host: "0.0.0.0" },          logging: { level: "info", llmLogEnabled: false },
        updatedAt: new Date().toISOString(),
      };
      runtime.ensureDirectory(paths.runtimeDir);
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
      log(`Created default configuration at ${settingsPath}`);
    }
  }

  runtime.ensureLocalSqliteConfig(rootDir, env, log, { profileName: "doctor" });
  if (isInstalled) {
    remapInstalledSqliteDatabaseUrl(env, paths);
  }
  runtime.assertSqliteDatabaseUrl(env);

  if (!isInstalled) {
    await ensureNpmDependencies(paths.backendDir, "backend", ["prisma", "@prisma/client"]);
    await ensureNpmDependencies(paths.frontendDir, "frontend", ["next"]);
  }

  await ensureAnalysisPython(rootDir, env);
  try {
    await ensureOpenSeesRuntime(rootDir, env);
  } catch {
    log("Warning: OpenSees runtime probe failed — analysis features may be limited in this environment.");
  }

  if (isInstalled) {
    await invokeInstalledDbInit(rootDir, env, paths);
  } else {
    await invokeScopedDbInit(rootDir, env, "doctor");
  }

  // Test LLM connectivity — read from settings.json
  const settingsPath = path.join(path.dirname(paths.envFile), "settings.json");
  let llmBaseUrl = "https://api.openai.com/v1";
  let llmApiKey = "";
  try {
    if (runtime.pathExists(settingsPath)) {
      const settingsJson = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      llmBaseUrl = settingsJson?.llm?.baseUrl || llmBaseUrl;
      llmApiKey = settingsJson?.llm?.apiKey || "";
    }
  } catch { /* use defaults */ }
  await testLlmConnectivity(llmBaseUrl, llmApiKey);

  log("");
  log("=== Setup Summary ===");
  log(`  Data directory: ${paths.dataDir}`);
  log(`  Configuration:  ${paths.envFile}`);
  log(`  Database:       ${env.DATABASE_URL || paths.dataDir}`);
  if (isInstalled) {
    log("");
    log("Run `sclaw start` to launch StructureClaw.");
  } else {
    log("Local startup checks passed.");
  }
}

async function dispatch(commandName, rawArgs, rootDir) {
  const context = runtime.loadProjectEnvironment(rootDir, log);
  const { paths, env } = context;
  const programName = env.SCLAW_PROGRAM_NAME || "sclaw";

  switch (commandName) {
    case "help":
      log(formatHelp(rootDir, programName));
      return;
    case "version":
      log(`${programName} ${getPackageMetadata(rootDir).version}`);
      return;
    case "install":
      await ensureNpmDependencies(paths.backendDir, "backend", ["prisma", "@prisma/client"]);
      await ensureNpmDependencies(paths.frontendDir, "frontend", ["next"]);
      return;
    case "install-cli":
      await installCli(rootDir, rawArgs, programName);
      return;
    case "ensure-uv":
      await ensureUv(rootDir);
      return;
    case "setup-analysis-python":
      await ensureAnalysisPython(rootDir, env);
      return;
    case "mirror-status":
      showMirrorStatus(env, {}, paths);
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
      await runtime.runCommand(runtime.getNpmCommand(), ["run", "db:generate", "--prefix", paths.backendDir], {
        env,
      });
      await runtime.runCommand(runtime.getNpmCommand(), ["run", "build", "--prefix", paths.backendDir], {
        env,
      });
      await runFrontendBuild(paths, env);
      return;
    case "convert-batch":
      await invokeConvertBatch(rootDir, env, rawArgs);
      return;
    case "db-up":
      log("No optional infra services are required in the SQLite local-first stack.");
      return;
    case "db-down":
      log("No optional infra services are running in the SQLite local-first stack.");
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
    case "restart": {
      const trackedPids = readTrackedServicePids(paths);
      await stopTrackedService(paths, "frontend");
      await stopTrackedService(paths, "backend");
      runtime.killPortPids(
        [env.PORT || runtime.DEFAULT_BACKEND_PORT, env.FRONTEND_PORT || runtime.DEFAULT_FRONTEND_PORT],
        log,
        getPortCleanupOptions(paths, env, trackedPids),
      );
      await invokeLocalUp(rootDir, env, { skipInfra: true });
      return;
    }
    case "stop": {
      const trackedPids = readTrackedServicePids(paths);
      await stopTrackedService(paths, "frontend");
      await stopTrackedService(paths, "backend");
      runtime.killPortPids(
        [env.PORT || runtime.DEFAULT_BACKEND_PORT, env.FRONTEND_PORT || runtime.DEFAULT_FRONTEND_PORT],
        log,
        getPortCleanupOptions(paths, env, trackedPids),
      );
      log("Local stack stopped.");
      return;
    }
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
  const cliContext = inferCliContext(options);
  process.env.SCLAW_PROGRAM_NAME = cliContext.programName;
  process.env.SCLAW_PROFILE = cliContext.profile;
  const rootDir = runtime.resolveProjectRoot(options.rootDir);
  const rawCommand = argv[0] || "help";
  const commandName = resolveCommandName(rawCommand);
  const rawArgs = argv.slice(1);

  if (!COMMAND_NAMES.has(commandName)) {
    log(`Unknown command: ${rawCommand}`);
    log("");
    log(formatHelp(rootDir, cliContext.programName));
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
  getPortCleanupOptions,
  main,
  resolveCommandName,
};
