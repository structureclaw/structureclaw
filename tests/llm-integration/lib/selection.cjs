function parseLlmIntegrationOptions(args) {
  let category;
  let family;
  let skillId;
  let variant;
  let scenarioId;
  let outputPath;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    // Handle --key=value form
    const eqIndex = current.indexOf("=");
    if (current.startsWith("--") && eqIndex > 2) {
      const key = current.slice(0, eqIndex);
      const value = current.slice(eqIndex + 1);

      if (key === "--family" || key === "--skill") {
        family = value;
        skillId = value;
      } else if (key === "--variant") {
        if (value !== "auto") variant = value;
      } else if (key === "--scenario") {
        scenarioId = value;
      } else if (key === "--output") {
        outputPath = value;
      }
      continue;
    }

    if (current === "--family" || current === "--skill") {
      family = args[index + 1];
      skillId = args[index + 1];
      index += 1;
      continue;
    }
    if (current === "--variant") {
      const raw = args[index + 1];
      if (raw !== "auto") variant = raw;
      index += 1;
      continue;
    }
    if (current === "--scenario") {
      scenarioId = args[index + 1];
      index += 1;
      continue;
    }
    if (current === "--output") {
      outputPath = args[index + 1];
      index += 1;
      continue;
    }
    if (!current.startsWith("--") && category === undefined) {
      category = current;
    }
  }

  return { category, family, skillId, variant, scenarioId, outputPath };
}

function filterLlmTestCases(testCases, options = {}) {
  return testCases.filter((testCase) => {
    if (options.category && testCase.category !== options.category) {
      return false;
    }
    if (options.skillId && testCase.skillId !== options.skillId) {
      return false;
    }
    if (options.family && testCase.family !== options.family) {
      return false;
    }
    if (options.variant && testCase.variant !== options.variant) {
      return false;
    }
    if (options.scenarioId && testCase.scenarioId !== options.scenarioId) {
      return false;
    }
    return true;
  });
}

module.exports = {
  parseLlmIntegrationOptions,
  filterLlmTestCases,
};
