const os = require("node:os");
const path = require("node:path");

const { runFrontendBuild } = require("../../scripts/cli/frontend-build");
const runtime = require("../../scripts/cli/runtime");

function log(message = "") {
  process.stdout.write(`${message}${os.EOL}`);
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

module.exports = {
  runNativeInstallSmoke,
};
