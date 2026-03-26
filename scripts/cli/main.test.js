const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const runtime = require("./runtime");
const { formatHelp, resolveCommandName } = require("./main");
const { COMMAND_NAMES } = require("./command-manifest");

const rootDir = path.resolve(__dirname, "..", "..");

test("resolveCommandName handles aliases", () => {
  assert.equal(resolveCommandName("--help"), "help");
  assert.equal(resolveCommandName("--version"), "version");
  assert.equal(resolveCommandName("doctor"), "doctor");
  assert.equal(resolveCommandName("status"), "status");
  assert.equal(resolveCommandName("stop"), "stop");
});

test("help output includes unified command surface", () => {
  const helpText = formatHelp(rootDir);
  assert.match(helpText, /sclaw start/);
  assert.match(helpText, /sclaw install-cli/);
  assert.match(helpText, /analysis-regression/);
});

test("dot env parser strips comments and quotes", () => {
  const parsed = runtime.parseDotEnv(`
# comment
FOO=bar
BAR="quoted value"
BAZ='single value'
EMPTY=
`);
  assert.deepEqual(parsed, {
    FOO: "bar",
    BAR: "quoted value",
    BAZ: "single value",
    EMPTY: "",
  });
});

test("normalizeSqliteFileUrl resolves relative schema paths", () => {
  const normalized = runtime.normalizeSqliteFileUrl(
    rootDir,
    "file:../../.runtime/data/structureclaw.db",
  );
  assert.match(normalized, /^file:/);
  assert.match(normalized, /structureclaw\.db$/);
  assert.doesNotMatch(normalized, /\\/);
});

test("command manifest covers make lifecycle targets", () => {
  for (const commandName of [
    "install",
    "ensure-uv",
    "setup-analysis-python",
    "dev-backend",
    "dev-frontend",
    "build",
    "db-up",
    "db-down",
    "db-init",
    "docker-up",
    "docker-down",
    "local-up",
    "local-up-uv",
    "local-up-noinfra",
    "local-down",
    "local-status",
    "health",
    "check-startup",
    "backend-regression",
    "analysis-regression",
    "start",
    "restart",
    "logs",
  ]) {
    assert.ok(COMMAND_NAMES.has(commandName), `${commandName} should exist`);
  }
});
