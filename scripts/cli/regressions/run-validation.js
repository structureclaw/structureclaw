const path = require("node:path");

const { runAnalysisRunner, resolveRegressionContext, runLoggedStep } = require("./shared");
const { BACKEND_VALIDATIONS, runBackendValidation } = require("./backend-validations");
const { runBackendRegression } = require("./backend-regression");
const { runAnalysisRegression } = require("./analysis-regression");

const ANALYSIS_VALIDATION_NAMES = new Set([
  "validate-opensees-runtime-and-routing",
  "validate-analyze-contract",
  "validate-code-check-traceability",
  "validate-static-regression",
  "validate-static-3d-regression",
  "validate-structure-examples",
  "validate-convert-roundtrip",
  "validate-midas-text-converter",
  "validate-converter-api-contract",
  "validate-schema-migration",
  "validate-convert-batch",
  "validate-convert-passrate",
]);

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

async function runFromFilename(filename, rootDir) {
  const name = path.basename(filename).replace(/\.sh$/u, "");
  await runValidationByName(name, rootDir);
}

module.exports = {
  ANALYSIS_VALIDATION_NAMES,
  runFromFilename,
  runValidationByName,
};
