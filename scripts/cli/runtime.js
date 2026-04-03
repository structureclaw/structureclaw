const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_ANALYSIS_PYTHON_VERSION = "3.12";
const DEFAULT_FRONTEND_PORT = "30000";
const DEFAULT_BACKEND_PORT = "8000";
const CN_DEFAULT_PIP_INDEX_URL = "https://pypi.tuna.tsinghua.edu.cn/simple";
const CN_DEFAULT_NPM_REGISTRY = "https://registry.npmmirror.com";
const CN_DEFAULT_DOCKER_REGISTRY_MIRROR = "docker.m.daocloud.io/";
const CN_DEFAULT_APT_MIRROR = "mirrors.tuna.tsinghua.edu.cn";

function isWindows() {
  return process.platform === "win32";
}

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function ensureFileFromExample(targetPath, examplePath, logger = () => {}) {
  if (!pathExists(targetPath) && pathExists(examplePath)) {
    ensureDirectory(path.dirname(targetPath));
    fs.copyFileSync(examplePath, targetPath);
    logger(`Created ${targetPath} from example.`);
  }
}

function hasCommand(commandName) {
  const lookup = isWindows() ? "where" : "which";
  const result = spawnSync(lookup, [commandName], {
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0;
}

function requireCommand(commandName, hint) {
  if (!hasCommand(commandName)) {
    throw new Error(`Missing required command: ${commandName}\n${hint}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDotEnv(rawText) {
  const values = {};
  for (const rawLine of rawText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readDotEnv(filePath) {
  if (!pathExists(filePath)) {
    return {};
  }
  return parseDotEnv(fs.readFileSync(filePath, "utf8"));
}

function getConfigValue(dotEnv, name, defaultValue) {
  if (dotEnv[name] && String(dotEnv[name]).trim()) {
    return String(dotEnv[name]);
  }
  if (process.env[name] && String(process.env[name]).trim()) {
    return String(process.env[name]);
  }
  return defaultValue;
}

function resolveProjectRoot(explicitRoot) {
  const candidates = [
    explicitRoot,
    process.env.SCLAW_PROJECT_ROOT,
    process.cwd(),
    path.resolve(__dirname, "..", ".."),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (
      pathExists(path.join(resolved, "backend", "package.json")) &&
      pathExists(path.join(resolved, "frontend", "package.json")) &&
      pathExists(path.join(resolved, "scripts"))
    ) {
      return resolved;
    }
  }

  throw new Error(
    "Cannot locate the StructureClaw project root. Run inside the repository, or set SCLAW_PROJECT_ROOT.",
  );
}

function resolvePaths(rootDir) {
  const runtimeDir = path.join(rootDir, ".runtime");
  return {
    rootDir,
    runtimeDir,
    logDir: path.join(runtimeDir, "logs"),
    pidDir: path.join(runtimeDir, "pids"),
    dataDir: path.join(runtimeDir, "data"),
    envFile: path.join(rootDir, ".env"),
    envExampleFile: path.join(rootDir, ".env.example"),
    backendDir: path.join(rootDir, "backend"),
    frontendDir: path.join(rootDir, "frontend"),
    dockerComposeFile: path.join(rootDir, "docker-compose.yml"),
    dockerComposeCnFile: path.join(rootDir, "docker-compose.cn.yml"),
    analysisRequirementsFile: path.join(
      rootDir,
      "backend",
      "src",
      "agent-skills",
      "analysis",
      "runtime",
      "requirements.txt",
    ),
    analysisPythonRoot: path.join(
      rootDir,
      "backend",
      "src",
      "agent-skills",
      "analysis",
      "runtime",
    ),
    analysisOpenseesStaticRoot: path.join(
      rootDir,
      "backend",
      "src",
      "agent-skills",
      "analysis",
      "opensees-static",
    ),
    skillSharedPythonRoot: path.join(rootDir, "backend", "src", "skill-shared", "python"),
    dataInputSkillRoot: path.join(rootDir, "backend", "src", "agent-skills", "data-input"),
    codeCheckSkillRoot: path.join(rootDir, "backend", "src", "agent-skills", "code-check"),
    materialSkillRoot: path.join(rootDir, "backend", "src", "agent-skills", "material"),
  };
}

function normalizeDockerRegistryMirror(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    return "";
  }

  let normalized = trimmed
    .replace(/^https?:\/\//iu, "")
    .replace(/^\/+/u, "")
    .replace(/\s+/gu, "");

  if (!normalized) {
    throw new Error("DOCKER_REGISTRY_MIRROR is invalid after normalization.");
  }

  if (!normalized.endsWith("/")) {
    normalized = `${normalized}/`;
  }

  return normalized;
}

function normalizeAptMirror(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed
    .replace(/^https?:\/\//iu, "")
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "");

  if (!normalized) {
    throw new Error("APT_MIRROR is invalid after normalization.");
  }

  if (/\s/u.test(normalized) || /\//u.test(normalized)) {
    throw new Error(
      "APT_MIRROR must be host[:port] without scheme or path, e.g. mirrors.tuna.tsinghua.edu.cn",
    );
  }

  return normalized;
}

function applyCnProfileDefaults(env, dotEnv) {
  if (String(env.SCLAW_PROFILE || "").toLowerCase() !== "cn") {
    return;
  }

  if (!String(dotEnv.PIP_INDEX_URL || "").trim() && !String(process.env.PIP_INDEX_URL || "").trim()) {
    env.PIP_INDEX_URL = CN_DEFAULT_PIP_INDEX_URL;
  }
  if (!String(dotEnv.NPM_CONFIG_REGISTRY || "").trim() && !String(process.env.NPM_CONFIG_REGISTRY || "").trim()) {
    env.NPM_CONFIG_REGISTRY = CN_DEFAULT_NPM_REGISTRY;
  }
  if (
    !String(dotEnv.DOCKER_REGISTRY_MIRROR || "").trim() &&
    !String(process.env.DOCKER_REGISTRY_MIRROR || "").trim()
  ) {
    env.DOCKER_REGISTRY_MIRROR = CN_DEFAULT_DOCKER_REGISTRY_MIRROR;
  }
  if (!String(dotEnv.APT_MIRROR || "").trim() && !String(process.env.APT_MIRROR || "").trim()) {
    env.APT_MIRROR = CN_DEFAULT_APT_MIRROR;
  }
}

function loadProjectEnvironment(rootDir, logger = () => {}, options = {}) {
  const paths = resolvePaths(rootDir);
  ensureDirectory(paths.runtimeDir);
  ensureDirectory(paths.logDir);
  ensureDirectory(paths.pidDir);
  ensureFileFromExample(paths.envFile, paths.envExampleFile, logger);
  const dotEnv = readDotEnv(paths.envFile);
  const profile =
    String(options.profile || process.env.SCLAW_PROFILE || dotEnv.SCLAW_PROFILE || "default").toLowerCase();
  const programName = String(options.programName || process.env.SCLAW_PROGRAM_NAME || "sclaw");
  const env = {
    ...process.env,
    ...dotEnv,
    SCLAW_PROFILE: profile,
    SCLAW_PROGRAM_NAME: programName,
  };
  applyCnProfileDefaults(env, dotEnv);
  env.DOCKER_REGISTRY_MIRROR = normalizeDockerRegistryMirror(env.DOCKER_REGISTRY_MIRROR);
  env.APT_MIRROR = normalizeAptMirror(env.APT_MIRROR);
  env.FRONTEND_PORT = env.FRONTEND_PORT || DEFAULT_FRONTEND_PORT;
  env.PORT = env.PORT || DEFAULT_BACKEND_PORT;
  return { paths, dotEnv, env };
}

function normalizeSqliteFileUrl(rootDir, databaseUrl) {
  if (!databaseUrl || !databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }
  const suffix = databaseUrl.slice(5);
  const queryIndex = suffix.indexOf("?");
  const location = queryIndex >= 0 ? suffix.slice(0, queryIndex) : suffix;
  const query = queryIndex >= 0 ? suffix.slice(queryIndex) : "";
  if (!location) {
    return databaseUrl;
  }
  const normalizedPath = path.isAbsolute(location)
    ? location
    : path.resolve(rootDir, "backend", "prisma", location);
  return `file:${normalizedPath.replace(/\\/gu, "/")}${query}`;
}

function buildScopedSqliteDatabaseUrl(rootDir, profileName = "start") {
  const safeProfile = String(profileName || "start")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "") || "start";
  const sqlitePath = path.join(rootDir, ".runtime", "data", `structureclaw.${safeProfile}.db`);
  return `file:${sqlitePath.replace(/\\/gu, "/")}`;
}

function ensureLocalSqliteConfig(rootDir, env, logger = () => {}, options = {}) {
  const profileName = options.profileName || "start";
  const targetDatabaseUrl = buildScopedSqliteDatabaseUrl(rootDir, profileName);
  const currentDatabaseUrl =
    env.DATABASE_URL || "file:../../.runtime/data/structureclaw.db";

  if (currentDatabaseUrl.startsWith("file:")) {
    const normalizedCurrent = normalizeSqliteFileUrl(rootDir, currentDatabaseUrl);
    env.DATABASE_URL = targetDatabaseUrl;
    if (normalizedCurrent !== targetDatabaseUrl) {
      logger(
        `Using isolated SQLite DATABASE_URL for ${profileName}: ${env.DATABASE_URL}`,
      );
    }
    return env.DATABASE_URL;
  }

  const normalized = currentDatabaseUrl.toLowerCase();
  const isLegacyLocalPostgres =
    normalized.startsWith("postgresql://") &&
    (normalized.includes("@localhost:") || normalized.includes("@127.0.0.1:"));
  if (!isLegacyLocalPostgres) {
    throw new Error(
      `Local workflow expects a SQLite DATABASE_URL. Current value: ${currentDatabaseUrl}`,
    );
  }

  env.DATABASE_URL = targetDatabaseUrl;
  if (!env.POSTGRES_SOURCE_DATABASE_URL) {
    env.POSTGRES_SOURCE_DATABASE_URL = currentDatabaseUrl;
  }
  logger(
    `Detected legacy local PostgreSQL DATABASE_URL. Overriding to SQLite for local workflow: ${env.DATABASE_URL}`,
  );
  return env.DATABASE_URL;
}

function assertSqliteDatabaseUrl(env) {
  if (!String(env.DATABASE_URL || "").startsWith("file:")) {
    throw new Error(
      `Local workflow expects a SQLite file DATABASE_URL. Current value: ${env.DATABASE_URL || ""}`,
    );
  }
}

function sha256File(filePath) {
  if (!pathExists(filePath)) {
    return "";
  }
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function installedPackagesMatchLock(projectDir, packageNames) {
  const lockFile = path.join(projectDir, "package-lock.json");
  if (!pathExists(lockFile)) {
    return true;
  }
  let lockJson;
  try {
    lockJson = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  } catch {
    return false;
  }

  return packageNames.every((packageName) => {
    const installedPackageJson = path.join(
      projectDir,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    if (!pathExists(installedPackageJson)) {
      return false;
    }

    const packageKey = `node_modules/${packageName}`;
    const expectedVersion =
      lockJson.packages &&
      lockJson.packages[packageKey] &&
      typeof lockJson.packages[packageKey].version === "string"
        ? lockJson.packages[packageKey].version
        : "";
    if (!expectedVersion) {
      return true;
    }

    try {
      const installedJson = JSON.parse(fs.readFileSync(installedPackageJson, "utf8"));
      return installedJson.version === expectedVersion;
    } catch {
      return false;
    }
  });
}

function getNpmCommand() {
  return isWindows() ? "npm.cmd" : "npm";
}

function getBashCommand() {
  return isWindows() ? "bash.exe" : "bash";
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const useShell =
      options.shell !== undefined
        ? options.shell
        : isWindows() && /\.(cmd|bat)$/iu.test(command);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio || "inherit",
      shell: useShell,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code ?? "null"}${
            signal ? ` (signal: ${signal})` : ""
          }`,
        ),
      );
    });
  });
}

function pidFilePath(paths, name) {
  return path.join(paths.pidDir, `${name}.pid`);
}

function logFilePath(paths, name) {
  return path.join(paths.logDir, `${name}.log`);
}

function readTrackedPid(paths, name) {
  const pidFile = pidFilePath(paths, name);
  if (!pathExists(pidFile)) {
    return null;
  }
  const pidText = fs.readFileSync(pidFile, "utf8").trim();
  const pid = Number.parseInt(pidText, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    fs.rmSync(pidFile, { force: true });
    return null;
  }
  if (isPidRunning(pid)) {
    return pid;
  }
  fs.rmSync(pidFile, { force: true });
  return null;
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function writeTrackedPid(paths, name, pid) {
  fs.writeFileSync(pidFilePath(paths, name), String(pid));
}

function removeTrackedPid(paths, name) {
  fs.rmSync(pidFilePath(paths, name), { force: true });
}

function appendSessionHeader(logFile, name) {
  ensureDirectory(path.dirname(logFile));
  const stamp = new Date().toISOString();
  fs.appendFileSync(logFile, `=== [${stamp}] starting ${name} ===${os.EOL}`);
}

function spawnDetached(command, args, options) {
  const useShell =
    options.shell !== undefined
      ? options.shell
      : isWindows() && /\.(cmd|bat)$/iu.test(command);
  const stdoutFd = fs.openSync(options.logFile, "a");
  const stderrFd = fs.openSync(options.logFile, "a");
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    windowsHide: true,
    shell: useShell,
  });
  child.unref();
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);
  return child.pid;
}

async function stopProcessTree(pid) {
  if (!isPidRunning(pid)) {
    return;
  }

  if (isWindows()) {
    await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!isPidRunning(pid)) {
      return;
    }
    await sleep(1000);
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return;
    }
  }
}

function latestSessionHeader(logFile) {
  if (!pathExists(logFile)) {
    return null;
  }
  const lines = fs.readFileSync(logFile, "utf8").split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith("=== [")) {
      return lines[index];
    }
  }
  return null;
}

function tailLines(filePath, count) {
  if (!pathExists(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u);
  return lines.slice(Math.max(0, lines.length - count));
}

function latestSessionLines(filePath, fallbackCount = 80, maxCount = 120) {
  if (!pathExists(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u);
  let sessionStart = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith("=== [")) {
      sessionStart = index;
      break;
    }
  }
  if (sessionStart >= 0) {
    return lines.slice(sessionStart, sessionStart + maxCount);
  }
  return lines.slice(Math.max(0, lines.length - fallbackCount));
}

function requestUrl(url, method = "GET") {
  return new Promise((resolve) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.request(
      url,
      {
        method,
        timeout: 5000,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode && response.statusCode < 400);
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
    request.end();
  });
}

function buildAnalysisPaths(rootDir) {
  const paths = resolvePaths(rootDir);
  return [
    paths.analysisPythonRoot,
    paths.skillSharedPythonRoot,
    paths.dataInputSkillRoot,
    paths.codeCheckSkillRoot,
    paths.materialSkillRoot,
    // After code-check so `from runtime import …` resolves to code-check/runtime.py,
    // not opensees-static/runtime.py; `opensees_runtime` still imports from this dir.
    paths.analysisOpenseesStaticRoot,
  ];
}

function resolveAnalysisPython(rootDir, env) {
  if (env.ANALYSIS_PYTHON_BIN && pathExists(env.ANALYSIS_PYTHON_BIN)) {
    return env.ANALYSIS_PYTHON_BIN;
  }
  const windowsVenv = path.join(rootDir, "backend", ".venv", "Scripts", "python.exe");
  if (pathExists(windowsVenv)) {
    return windowsVenv;
  }
  const unixVenv = path.join(rootDir, "backend", ".venv", "bin", "python");
  if (pathExists(unixVenv)) {
    return unixVenv;
  }
  return null;
}

function buildAnalysisEnvironment(rootDir, env) {
  const pythonPathSeparator = isWindows() ? ";" : ":";
  const extraPaths = buildAnalysisPaths(rootDir);
  return {
    ...env,
    PYTHONPATH: [...extraPaths, env.PYTHONPATH].filter(Boolean).join(pythonPathSeparator),
  };
}

async function pythonModuleExists(pythonPath, moduleName) {
  if (!pythonPath || !pathExists(pythonPath)) {
    return false;
  }
  try {
    await runCommand(pythonPath, [
      "-c",
      `import importlib.util, sys; sys.exit(0 if importlib.util.find_spec("${moduleName}") else 1)`,
    ]);
    return true;
  } catch {
    return false;
  }
}

function quoteShellArgument(rawValue) {
  return `"${String(rawValue).replace(/(["\\$`])/gu, "\\$1")}"`;
}

module.exports = {
  CN_DEFAULT_APT_MIRROR,
  CN_DEFAULT_DOCKER_REGISTRY_MIRROR,
  CN_DEFAULT_NPM_REGISTRY,
  CN_DEFAULT_PIP_INDEX_URL,
  DEFAULT_ANALYSIS_PYTHON_VERSION,
  DEFAULT_BACKEND_PORT,
  DEFAULT_FRONTEND_PORT,
  appendSessionHeader,
  assertSqliteDatabaseUrl,
  buildScopedSqliteDatabaseUrl,
  buildAnalysisEnvironment,
  ensureDirectory,
  ensureFileFromExample,
  ensureLocalSqliteConfig,
  getBashCommand,
  getConfigValue,
  getNpmCommand,
  hasCommand,
  installedPackagesMatchLock,
  isPidRunning,
  isWindows,
  latestSessionHeader,
  latestSessionLines,
  loadProjectEnvironment,
  logFilePath,
  normalizeSqliteFileUrl,
  normalizeAptMirror,
  normalizeDockerRegistryMirror,
  parseDotEnv,
  pathExists,
  pidFilePath,
  pythonModuleExists,
  quoteShellArgument,
  readTrackedPid,
  removeTrackedPid,
  requestUrl,
  requireCommand,
  resolveAnalysisPython,
  resolvePaths,
  resolveProjectRoot,
  runCommand,
  sha256File,
  sleep,
  spawnDetached,
  stopProcessTree,
  tailLines,
  writeTrackedPid,
};
