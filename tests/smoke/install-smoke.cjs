const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createDockerComposeRunner } = require("../../scripts/cli/docker-compose-runner");
const { runFrontendBuild } = require("../../scripts/cli/frontend-build");
const runtime = require("../../scripts/cli/runtime");

function log(message = "") {
  process.stdout.write(`${message}${os.EOL}`);
}

function writeDockerSmokeEnv(paths) {
  const outEnv =
    process.env.STRUCTURECLAW_COMPOSE_ENV_FILE ||
    path.join(paths.runtimeDir, "ci-docker-smoke.env");

  // Generate the Docker env file directly — no longer depends on .env.example
  const lines = [
    "# Auto-generated for CI Docker smoke test",
    `DATABASE_URL=file:/.runtime/data/structureclaw.db`,
    `LLM_API_KEY=ci-dummy-key`,
    `LLM_MODEL=gpt-4.1`,
    `LLM_BASE_URL=https://api.openai.com/v1`,
  ];
  runtime.ensureDirectory(path.dirname(outEnv));
  fs.writeFileSync(outEnv, lines.join(os.EOL));
  return outEnv;
}

function readEnvFileValues(filePath) {
  return runtime.parseDotEnv(fs.readFileSync(filePath, "utf8"));
}

async function runNativeInstallSmoke(rootDir) {
  const { paths, env } = runtime.loadProjectEnvironment(rootDir, log);

  log("[ci-native-smoke] npm ci backend");
  await runtime.runCommand(runtime.getNpmCommand(), ["ci", "--prefix", paths.backendDir], { env });

  log("[ci-native-smoke] npm ci frontend");
  await runtime.runCommand(runtime.getNpmCommand(), ["ci", "--prefix", paths.frontendDir], { env });

  log("[ci-native-smoke] backend build");
  await runtime.runCommand(runtime.getNpmCommand(), ["run", "build", "--prefix", paths.backendDir], { env });

  log("[ci-native-smoke] frontend build");
  await runFrontendBuild(paths, env);

  log("[ci-native-smoke] ok");
}

async function runDockerComposeSmoke(rootDir) {
  const docker = createDockerComposeRunner(log);
  const { paths } = runtime.loadProjectEnvironment(rootDir, log);
  const envFile = writeDockerSmokeEnv(paths);
  const smokeEnv = {
    ...process.env,
    ...readEnvFileValues(envFile),
  };
  let cleanupError = null;

  runtime.ensureDirectory(paths.dataDir);

  try {
    log("[ci-docker-smoke] docker compose config");
    await docker.runDockerCompose(paths, ["config", "-q"], { env: smokeEnv, envFile, timeoutMs: 120000 });

    try {
      log("[ci-docker-smoke] pruning stale build cache");
      await runtime.runCommand("docker", ["builder", "prune", "-f", "--filter", "until=24h"], {
        env: smokeEnv,
      });
    } catch (error) {
      log(`[ci-docker-smoke] warning: failed to prune build cache: ${error.message}`);
    }

    log("[ci-docker-smoke] docker compose up --build -d");
    await docker.runDockerCompose(paths, ["up", "--build", "-d"], {
      env: smokeEnv,
      envFile,
      timeoutMs: 300000,
    });

    log("[ci-docker-smoke] waiting for docker services");
    const ready = await docker.waitForDockerServices(smokeEnv, 300000);
    if (!ready) {
      const psResult = docker.readDockerCompose(paths, ["ps"], { envFile });
      if (psResult.stdout.trim()) {
        process.stdout.write(`${psResult.stdout.trim()}${os.EOL}`);
      }
      throw new Error("docker compose smoke timed out waiting for healthy services");
    }

    const { frontendPort } = docker.getDockerPorts(smokeEnv);
    const frontendOk = await runtime.requestUrl(`http://127.0.0.1:${frontendPort}/`, "GET");
    if (!frontendOk) {
      log(`[ci-docker-smoke] frontend returned a non-healthy response on http://127.0.0.1:${frontendPort}/`);
    }

    log("[ci-docker-smoke] docker compose smoke passed");
  } finally {
    try {
      log("[ci-docker-smoke] docker compose down");
      await docker.runDockerCompose(paths, ["down", "--remove-orphans"], {
        env: smokeEnv,
        envFile,
        timeoutMs: 120000,
      });
    } catch (error) {
      cleanupError = error;
    }
  }

  if (cleanupError) {
    throw cleanupError;
  }
}

module.exports = {
  runDockerComposeSmoke,
  runNativeInstallSmoke,
};
