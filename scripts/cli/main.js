const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ALIAS_TO_COMMAND, COMMANDS, COMMAND_NAMES } = require("./command-manifest");
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
  lines.push("  - `start` maps to the recommended no-infra local profile.");
  lines.push("  - `backend-regression` / `analysis-regression` now run without bash or WSL.");
  return lines.join(os.EOL);
}

function log(message = "") {
  process.stdout.write(`${message}${os.EOL}`);
}

function getCliEntryPath(rootDir) {
  return path.join(rootDir, "sclaw");
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

  await runtime.runCommand(path.join(rootDir, "scripts", "ensure-uv.sh"), []);
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
  runtime.requireCommand("python", "Install Python 3.11+ and retry.");
  await ensureUv(rootDir);

  const { paths } = runtime.loadProjectEnvironment(rootDir);
  if (!runtime.pathExists(paths.analysisRequirementsFile)) {
    throw new Error(`Analysis requirements file not found: ${paths.analysisRequirementsFile}`);
  }

  const currentPython = runtime.resolveAnalysisPython(rootDir, env);
  const venvReady = await runtime.pythonModuleExists(currentPython, "uvicorn");
  if (venvReady) {
    return runtime.resolveAnalysisPython(rootDir, env);
  }

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

  const analysisEnv = runtime.buildAnalysisEnvironment(rootDir, env);
  await runtime.runCommand(
    pythonBin,
    ["-m", "providers.opensees.runtime", "--json"],
    {
      env: analysisEnv,
      stdio: "ignore",
    },
  );
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

async function runFrontendBuild(paths, env) {
  const buildEnv = { ...env };
  if (runtime.isWindows()) {
    buildEnv.NODE_OPTIONS = "--require ./scripts/fs-rename-fallback.cjs";
  }
  await runtime.runCommand(runtime.getNpmCommand(), ["exec", "next", "build"], {
    cwd: paths.frontendDir,
    env: buildEnv,
  });
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
      "Install Docker Desktop and retry, or use `sclaw local-up-noinfra` / `sclaw start`.",
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
  runtime.requireCommand("python", "Install Python 3.11+ and retry.");
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
    case "db-up":
      await runtime.runCommand("docker", ["compose", "-f", paths.dockerComposeFile, "up", "-d", "redis"]);
      return;
    case "db-down":
      await runtime.runCommand("docker", ["compose", "-f", paths.dockerComposeFile, "stop", "redis"]);
      return;
    case "db-init":
      await invokeDbInit(rootDir, env);
      return;
    case "docker-up":
      await runtime.runCommand("docker", ["compose", "-f", paths.dockerComposeFile, "up", "--build"]);
      return;
    case "docker-down":
      await runtime.runCommand("docker", ["compose", "-f", paths.dockerComposeFile, "down"]);
      return;
    case "local-up":
      await invokeLocalUp(rootDir, env, { skipInfra: false });
      return;
    case "local-up-uv":
      await invokeLocalUp(rootDir, env, { skipInfra: false });
      return;
    case "local-up-noinfra":
      await invokeLocalUp(rootDir, env, { skipInfra: true });
      return;
    case "local-down":
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
    case "local-status":
      showServiceStatus(paths, "backend");
      showServiceStatus(paths, "frontend");
      log("");
      await showHealth(env);
      return;
    case "health":
      await showHealth(env);
      return;
    case "check-startup":
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
    case "backend-regression":
      await require("./regressions/backend-regression").runBackendRegression(rootDir);
      return;
    case "analysis-regression":
      await require("./regressions/analysis-regression").runAnalysisRegression(rootDir);
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
