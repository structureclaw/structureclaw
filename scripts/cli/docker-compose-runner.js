const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const runtime = require("./runtime");

/**
 * Docker compose helpers shared by sclaw and tests/smoke.
 * @param {(msg?: string) => void} log
 */
function createDockerComposeRunner(log = () => {}) {
  function findDockerDesktopExecutable() {
    if (!runtime.isWindows()) {
      return null;
    }

    const candidates = [
      path.join(process.env.ProgramFiles || "", "Docker", "Docker", "Docker Desktop.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Docker", "Docker", "Docker Desktop.exe"),
    ].filter(Boolean);

    return candidates.find((candidate) => runtime.pathExists(candidate)) || null;
  }

  function isDockerInstalled() {
    return runtime.hasCommand("docker") || Boolean(findDockerDesktopExecutable());
  }

  function isDockerServiceReady() {
    if (!runtime.hasCommand("docker")) {
      return false;
    }
    const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0 && Boolean(result.stdout.trim());
  }

  function launchDockerDesktop() {
    const executable = findDockerDesktopExecutable();
    if (!executable) {
      return false;
    }

    const child = spawn(executable, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return true;
  }

  async function waitForDockerService(timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isDockerServiceReady()) {
        return true;
      }
      await runtime.sleep(3000);
    }
    return false;
  }

  async function ensureDockerReady(timeoutMs = 120000) {
    if (!isDockerInstalled()) {
      throw new Error(
        "Docker is required for this command. Install Docker Desktop / Docker Engine and retry.",
      );
    }

    if (isDockerServiceReady()) {
      return;
    }

    if (runtime.isWindows() && launchDockerDesktop()) {
      log("Starting Docker Desktop... / 正在启动 Docker Desktop...");
      if (await waitForDockerService(timeoutMs)) {
        log("Docker service is ready / Docker 服务已就绪");
        return;
      }
    }

    throw new Error(
      "Docker service is not ready. Start Docker Desktop and retry. / Docker 服务未就绪，请先启动 Docker Desktop 后重试。",
    );
  }

  function getDockerPorts(env) {
    return {
      frontendPort: env.FRONTEND_PORT || runtime.DEFAULT_FRONTEND_PORT,
      backendPort: env.PORT || runtime.DEFAULT_BACKEND_PORT,
    };
  }

  async function waitForDockerServices(env, timeoutMs = 180000) {
    const { frontendPort, backendPort } = getDockerPorts(env);
    const services = [
      { name: "frontend", url: `http://localhost:${frontendPort}`, method: "HEAD" },
      { name: "backend", url: `http://localhost:${backendPort}/health`, method: "GET" },
    ];
    const ready = new Set();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      for (const service of services) {
        if (ready.has(service.name)) {
          continue;
        }
        if (await runtime.requestUrl(service.url, service.method)) {
          ready.add(service.name);
          log(`${service.name} ready / ${service.name} 已就绪`);
        }
      }
      if (ready.size === services.length) {
        return true;
      }
      await runtime.sleep(5000);
    }

    return false;
  }

  function getDockerComposeArgs(paths, composeArgs, options = {}) {
    return [
      "compose",
      "-f",
      paths.dockerComposeFile,
      ...(options.envFile ? ["--env-file", options.envFile] : []),
      ...composeArgs,
    ];
  }

  async function runDockerCompose(paths, composeArgs, options = {}) {
    await ensureDockerReady(options.timeoutMs);
    await runtime.runCommand("docker", getDockerComposeArgs(paths, composeArgs, options), {
      cwd: paths.rootDir,
      env: options.env,
      stdio: options.stdio,
    });
  }

  function readDockerCompose(paths, composeArgs, options = {}) {
    return spawnSync("docker", getDockerComposeArgs(paths, composeArgs, options), {
      cwd: paths.rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      windowsHide: true,
    });
  }

  return {
    ensureDockerReady,
    getDockerComposeArgs,
    getDockerPorts,
    readDockerCompose,
    runDockerCompose,
    waitForDockerServices,
  };
}

module.exports = {
  createDockerComposeRunner,
};
