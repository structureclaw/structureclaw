import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const validationRunner = require(path.join(__dirname, "regression", "run-validation.js"));

test("regression runner lists known backend validations", () => {
  const names = validationRunner.getValidationNames();
  assert.ok(names.includes("validate-agent-api-contract"));
  assert.ok(names.includes("validate-analyze-contract"));
});

test("regression runner exposes check aliases", () => {
  const checks = validationRunner.getCheckNames();
  assert.ok(checks.includes("backend-regression"));
  assert.ok(checks.includes("analysis-regression"));
  assert.equal(validationRunner.resolveCheckValidationName("backend-regression"), "check-backend-regression");
});
