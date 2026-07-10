const {
  resolveRegressionContext,
  runAnalysisRunner,
  runLoggedStep,
} = require("./shared");

const ANALYSIS_STEPS = [
  ["OpenSees runtime and routing", "validate-opensees-runtime-and-routing"],
  ["Analyze response contract", "validate-analyze-contract"],
  ["Seismic response-spectrum contract", "validate-seismic-analyze-contract"],
  ["Seismic wall line-member contract", "validate-seismic-wall-line-member-contract"],
  ["Seismic multi-direction response-spectrum contract", "validate-seismic-multi-direction-contract"],
  ["Seismic directional ground-motion contract", "validate-seismic-directional-ground-motion-contract"],
  ["Seismic GB18306 zonation-table contract", "validate-seismic-zonation-table-contract"],
  ["Seismic intensity-only preliminary contract", "validate-seismic-intensity-only-preliminary-contract"],
  ["Seismic design-basic-acceleration contract", "validate-seismic-design-basic-acceleration-contract"],
  ["Seismic earthquake-level contract", "validate-seismic-earthquake-level-contract"],
  ["Seismic elastic-plastic time-history boundary contract", "validate-seismic-elastic-plastic-time-history-boundary-contract"],
  ["Seismic elastic-plastic member-hinge time-history contract", "validate-seismic-elastic-plastic-member-hinge-time-history-contract"],
  ["Seismic auto performance-objective contract", "validate-seismic-auto-performance-objective-contract"],
  ["Seismic auto pushover contract", "validate-seismic-auto-pushover-contract"],
  ["Seismic vertical seismic requirement contract", "validate-seismic-vertical-seismic-requirement-contract"],
  ["Seismic special-system boundary contract", "validate-seismic-special-system-boundary-contract"],
  ["Seismic long-period special-study contract", "validate-seismic-long-period-special-study-contract"],
  ["Seismic workflow contract-aliases contract", "validate-seismic-workflow-contract-aliases-contract"],
  ["Seismic time-history contract", "validate-seismic-time-history-contract"],
  ["Seismic ground-motion requirement contract", "validate-seismic-ground-motion-requirement-contract"],
  ["Seismic structured-height method-decision contract", "validate-seismic-structured-height-method-decision-contract"],
  ["Seismic built-in catalog time-history contract", "validate-seismic-catalog-time-history-contract"],
  ["Seismic local-catalog time-history contract", "validate-seismic-local-catalog-time-history-contract"],
  ["Seismic local-catalog metadata selection contract", "validate-seismic-local-catalog-selection-contract"],
  ["Seismic auto-regularity contract", "validate-seismic-auto-regularity-contract"],
  ["Seismic nested regularity-assessment contract", "validate-seismic-nested-regularity-assessment-contract"],
  ["Seismic soft-story regularity contract", "validate-seismic-soft-story-regularity-contract"],
  ["Seismic structured weak-story regularity contract", "validate-seismic-structured-weak-story-regularity-contract"],
  ["Seismic story-strength regularity contract", "validate-seismic-story-strength-regularity-contract"],
  ["Seismic structured story-stiffness regularity contract", "validate-seismic-story-stiffness-regularity-contract"],
  ["Seismic story-mass regularity contract", "validate-seismic-story-mass-regularity-contract"],
  ["Seismic floor-diaphragm regularity contract", "validate-seismic-floor-diaphragm-regularity-contract"],
  ["Seismic story diaphragm-opening regularity contract", "validate-seismic-story-diaphragm-opening-regularity-contract"],
  ["Seismic torsional-irregularity regularity contract", "validate-seismic-torsional-irregularity-contract"],
  ["Seismic structured torsional-ratio contract", "validate-seismic-structured-torsional-ratio-contract"],
  ["Seismic plan-setback regularity contract", "validate-seismic-plan-setback-regularity-contract"],
  ["Seismic structured plan-irregularity contract", "validate-seismic-structured-plan-irregularity-contract"],
  ["Seismic vertical-discontinuity regularity contract", "validate-seismic-vertical-discontinuity-regularity-contract"],
  ["Seismic plan-aspect regularity contract", "validate-seismic-plan-aspect-regularity-contract"],
  ["Seismic pushover contract", "validate-seismic-pushover-contract"],
  ["Seismic pushover member-hinge contract", "validate-seismic-pushover-member-hinge-contract"],
  ["Seismic uploaded-text time-history contract", "validate-seismic-uploaded-text-time-history-contract"],
  ["Code-check traceability", "validate-code-check-traceability"],
  ["GB50011 seismic code-check contract", "validate-gb50011-seismic-code-check-contract"],
  ["StructureModel v1 examples", "validate-structure-examples"],
  ["Convert round-trip", "validate-convert-roundtrip"],
  ["Midas-text converter", "validate-midas-text-converter"],
  ["Converter API contract", "validate-converter-api-contract"],
  ["Schema migration", "validate-schema-migration"],
  ["Batch convert report", "validate-convert-batch"],
  ["Convert round-trip pass rate", "validate-convert-passrate"],
];

async function runAnalysisRegression(rootDir) {
  const context = resolveRegressionContext(rootDir);
  console.log("Analysis regression checks");

  for (const [title, commandName] of ANALYSIS_STEPS) {
    await runLoggedStep(title, async () => {
      await runAnalysisRunner(context, commandName);
    });
  }

  console.log("\nAnalysis regression checks passed.");
}

module.exports = {
  runAnalysisRegression,
};
