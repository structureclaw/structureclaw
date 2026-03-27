const runtime = require("./runtime");

async function runFrontendBuild(paths, env) {
  const buildEnv = { ...env };
  // next build must see NODE_ENV=production; root .env often sets development for local runtime.
  buildEnv.NODE_ENV = "production";
  if (runtime.isWindows()) {
    buildEnv.NODE_OPTIONS = "--require ./scripts/fs-rename-fallback.cjs";
  }
  await runtime.runCommand(runtime.getNpmCommand(), ["exec", "next", "build"], {
    cwd: paths.frontendDir,
    env: buildEnv,
  });
}

module.exports = {
  runFrontendBuild,
};
