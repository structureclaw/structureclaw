const {
  resolveRegressionContext,
  runAnalysisRunner,
  runLoggedStep,
} = require("./shared");

const ANALYSIS_STEPS = [
  ["OpenSees runtime and routing", "validate-opensees-runtime-and-routing"],
  ["Analyze response contract", "validate-analyze-contract"],
  ["Code-check traceability", "validate-code-check-traceability"],
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
