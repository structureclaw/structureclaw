const { runAnalysisRunner, resolveRegressionContext, runLoggedStep } = require("./shared");
const { BACKEND_VALIDATIONS, runBackendValidation } = require("./backend-validations");
const { runBackendRegression } = require("./backend-regression");
const { runAnalysisRegression } = require("./analysis-regression");

const ANALYSIS_VALIDATION_NAMES = new Set([
  "validate-opensees-runtime-and-routing",
  "validate-analyze-contract",
  "validate-code-check-traceability",
  "validate-structure-examples",
  "validate-convert-roundtrip",
  "validate-midas-text-converter",
  "validate-converter-api-contract",
  "validate-schema-migration",
  "validate-convert-batch",
  "validate-convert-passrate",
]);

const CHECK_VALIDATION_NAME_BY_ALIAS = new Map([
  ["backend-regression", "check-backend-regression"],
  ["analysis-regression", "check-analysis-regression"],
  ["check-backend-regression", "check-backend-regression"],
  ["check-analysis-regression", "check-analysis-regression"],
]);

function getValidationNames() {
  return [
    ...Object.keys(BACKEND_VALIDATIONS),
    ...ANALYSIS_VALIDATION_NAMES,
  ].sort();
}

function getCheckNames() {
  return [...CHECK_VALIDATION_NAME_BY_ALIAS.keys()].sort();
}

function resolveCheckValidationName(name) {
  return CHECK_VALIDATION_NAME_BY_ALIAS.get(name) || null;
}

async function runValidationByName(name, rootDir) {
  if (name === "check-backend-regression") {
    await runBackendRegression(rootDir);
    return;
  }
  if (name === "check-analysis-regression") {
    await runAnalysisRegression(rootDir);
    return;
  }

  const context = resolveRegressionContext(rootDir);
  if (Object.prototype.hasOwnProperty.call(BACKEND_VALIDATIONS, name)) {
    await runLoggedStep(name, async () => {
      await runBackendValidation(name, context);
    });
    return;
  }

  if (ANALYSIS_VALIDATION_NAMES.has(name)) {
    await runLoggedStep(name, async () => {
      await runAnalysisRunner(context, name);
    });
    return;
  }

  throw new Error(`Unknown regression validation: ${name}`);
}

module.exports = {
  ANALYSIS_VALIDATION_NAMES,
  getCheckNames,
  getValidationNames,
  resolveCheckValidationName,
  runValidationByName,
};
