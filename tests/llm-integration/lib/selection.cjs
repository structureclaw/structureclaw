function parseLlmIntegrationOptions(args) {
  let category;
  let skillId;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--skill") {
      skillId = args[index + 1];
      index += 1;
      continue;
    }
    if (!current.startsWith("--") && category === undefined) {
      category = current;
    }
  }

  return { category, skillId };
}

function filterLlmTestCases(testCases, options = {}) {
  return testCases.filter((testCase) => {
    if (options.category && testCase.category !== options.category) {
      return false;
    }
    if (options.skillId && testCase.skillId !== options.skillId) {
      return false;
    }
    return true;
  });
}

module.exports = {
  parseLlmIntegrationOptions,
  filterLlmTestCases,
};
