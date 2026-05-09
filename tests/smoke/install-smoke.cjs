const os = require("node:os");
const path = require("node:path");

const runtime = require("../../scripts/cli/runtime");

function log(message = "") {
  process.stdout.write(`${message}${os.EOL}`);
}

async function runNativeInstallSmoke(rootDir) {
  const { env } = runtime.loadProjectEnvironment(rootDir, log);
  const cliPath = path.join(rootDir, "sclaw");

  log("[ci-native-smoke] sclaw doctor");
  await runtime.runCommand(process.execPath, [cliPath, "doctor"], { env });

  log("[ci-native-smoke] sclaw build");
  await runtime.runCommand(process.execPath, [cliPath, "build"], { env });

  log("[ci-native-smoke] ok");
}

module.exports = {
  runNativeInstallSmoke,
};
