const { runAnalysisRunner, resolveRegressionContext, runLoggedStep } = require("./shared");
const { BACKEND_VALIDATIONS, runBackendValidation } = require("./backend-validations");
const { runBackendRegression } = require("./backend-regression");
const { runAnalysisRegression } = require("./analysis-regression");

const ANALYSIS_VALIDATION_NAMES = new Set([
  "validate-opensees-runtime-and-routing",
  "validate-analyze-contract",
  "validate-seismic-analyze-contract",
  "validate-seismic-wall-line-member-contract",
  "validate-seismic-multi-direction-contract",
  "validate-seismic-directional-ground-motion-contract",
  "validate-seismic-zonation-table-contract",
  "validate-seismic-intensity-only-preliminary-contract",
  "validate-seismic-design-basic-acceleration-contract",
  "validate-seismic-earthquake-level-contract",
  "validate-seismic-elastic-plastic-time-history-boundary-contract",
  "validate-seismic-elastic-plastic-member-hinge-time-history-contract",
  "validate-seismic-auto-performance-objective-contract",
  "validate-seismic-auto-pushover-contract",
  "validate-seismic-vertical-seismic-requirement-contract",
  "validate-seismic-special-system-boundary-contract",
  "validate-seismic-long-period-special-study-contract",
  "validate-seismic-workflow-contract-aliases-contract",
  "validate-seismic-time-history-contract",
  "validate-seismic-ground-motion-requirement-contract",
  "validate-seismic-structured-height-method-decision-contract",
  "validate-seismic-catalog-time-history-contract",
  "validate-seismic-local-catalog-time-history-contract",
  "validate-seismic-local-catalog-selection-contract",
  "validate-seismic-auto-regularity-contract",
  "validate-seismic-nested-regularity-assessment-contract",
  "validate-seismic-soft-story-regularity-contract",
  "validate-seismic-structured-weak-story-regularity-contract",
  "validate-seismic-story-strength-regularity-contract",
  "validate-seismic-story-stiffness-regularity-contract",
  "validate-seismic-story-mass-regularity-contract",
  "validate-seismic-floor-diaphragm-regularity-contract",
  "validate-seismic-story-diaphragm-opening-regularity-contract",
  "validate-seismic-torsional-irregularity-contract",
  "validate-seismic-structured-torsional-ratio-contract",
  "validate-seismic-plan-setback-regularity-contract",
  "validate-seismic-structured-plan-irregularity-contract",
  "validate-seismic-vertical-discontinuity-regularity-contract",
  "validate-seismic-plan-aspect-regularity-contract",
  "validate-seismic-pushover-contract",
  "validate-seismic-pushover-member-hinge-contract",
  "validate-seismic-uploaded-text-time-history-contract",
  "validate-code-check-traceability",
  "validate-gb50011-seismic-code-check-contract",
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
