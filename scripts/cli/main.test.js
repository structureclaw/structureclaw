const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const runtime = require("./runtime");
const {
  formatCheckList,
  formatHelp,
  formatValidationList,
  main,
  resolveCommandName,
} = require("./main");
const { COMMAND_NAMES } = require("./command-manifest");
const validationRunner = require("./regressions/run-validation");

const rootDir = path.resolve(__dirname, "..", "..");

test("resolveCommandName handles aliases", () => {
  assert.equal(resolveCommandName("--help"), "help");
  assert.equal(resolveCommandName("--version"), "version");
  assert.equal(resolveCommandName("doctor"), "doctor");
  assert.equal(resolveCommandName("install-docker"), "docker-install");
  assert.equal(resolveCommandName("status"), "status");
  assert.equal(resolveCommandName("stop"), "stop");
});

test("help output includes unified command surface", () => {
  const helpText = formatHelp(rootDir);
  assert.match(helpText, /sclaw start/);
  assert.match(helpText, /sclaw docker-install/);
  assert.match(helpText, /sclaw docker-start/);
  assert.match(helpText, /sclaw install-cli/);
  assert.match(helpText, /analysis-regression/);
  assert.match(helpText, /sclaw validate <name>/);
  assert.match(helpText, /sclaw check <name>/);
});

test("validation and check lists expose unified commands", () => {
  const validationList = formatValidationList();
  assert.match(validationList, /sclaw validate validate-agent-api-contract/);
  assert.match(validationList, /sclaw validate validate-analyze-contract/);

  const checkList = formatCheckList();
  assert.match(checkList, /sclaw check backend-regression/);
  assert.match(checkList, /sclaw check analysis-regression/);
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
    "db-import-postgres",
    "db-auto-migrate-legacy-postgres",
    "docker-up",
    "docker-down",
    "docker-install",
    "docker-start",
    "docker-stop",
    "docker-status",
    "docker-logs",
    "local-up",
    "local-up-uv",
    "local-up-noinfra",
    "local-down",
    "local-status",
    "health",
    "check-startup",
    "backend-regression",
    "analysis-regression",
    "validate",
    "check",
    "start",
    "restart",
    "logs",
  ]) {
    assert.ok(COMMAND_NAMES.has(commandName), `${commandName} should exist`);
  }
});

test("main routes validate subcommand by validation name", async () => {
  const original = validationRunner.runValidationByName;
  const calls = [];
  validationRunner.runValidationByName = async (name, rootDirArg) => {
    calls.push({ name, rootDirArg });
  };

  try {
    const code = await main(["validate", "validate-agent-api-contract"], { rootDir });
    assert.equal(code, 0);
    assert.deepEqual(calls, [
      {
        name: "validate-agent-api-contract",
        rootDirArg: rootDir,
      },
    ]);
  } finally {
    validationRunner.runValidationByName = original;
  }
});

test("main routes check subcommand to grouped regression", async () => {
  const original = validationRunner.runValidationByName;
  const calls = [];
  validationRunner.runValidationByName = async (name, rootDirArg) => {
    calls.push({ name, rootDirArg });
  };

  try {
    const code = await main(["check", "backend-regression"], { rootDir });
    assert.equal(code, 0);
    assert.deepEqual(calls, [
      {
        name: "check-backend-regression",
        rootDirArg: rootDir,
      },
    ]);
  } finally {
    validationRunner.runValidationByName = original;
  }
});

test("main rejects unknown check names", async () => {
  await assert.rejects(
    main(["check", "not-a-real-check"], { rootDir }),
    /Unknown check: not-a-real-check/,
  );
});
