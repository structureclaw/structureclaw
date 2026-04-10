const path = require("node:path");

function fixtureError(filePath, message) {
  const location = typeof filePath === "string" && filePath.length > 0 ? `${filePath}: ` : "";
  return new Error(`${location}${message}`);
}

function validateTurns(turns, filePath, fixtureLabel) {
  if (!Array.isArray(turns)) {
    return;
  }

  if (turns.length === 0) {
    throw fixtureError(filePath, `invalid ${fixtureLabel}: turns must not be empty`);
  }

  turns.forEach((turn, index) => {
    if (!turn || typeof turn !== "object") {
      throw fixtureError(filePath, `invalid ${fixtureLabel}: turn ${index + 1} must be an object`);
    }
    if (typeof turn.message !== "string" || turn.message.trim().length === 0) {
      throw fixtureError(filePath, `invalid ${fixtureLabel}: turn ${index + 1} requires message`);
    }
  });
}

function validateMessages(messages, filePath, fixtureLabel) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw fixtureError(filePath, `invalid ${fixtureLabel}: messages must be a non-empty array`);
  }

  messages.forEach((message, index) => {
    if (typeof message !== "string" || message.trim().length === 0) {
      throw fixtureError(filePath, `invalid ${fixtureLabel}: message ${index + 1} must be a non-empty string`);
    }
  });
}

function inferFamilyFromFilePath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return "";
  }

  const parentDir = path.basename(path.dirname(filePath));
  if (parentDir === "__llm_tests__") {
    return path.basename(path.dirname(path.dirname(filePath)));
  }

  return path.basename(path.dirname(filePath));
}

function normalizeSkillId(parsed, filePath) {
  const fromDocument =
    typeof parsed.skillId === "string" && parsed.skillId.trim().length > 0
      ? parsed.skillId.trim()
      : typeof parsed.family === "string" && parsed.family.trim().length > 0
        ? parsed.family.trim()
        : "";

  return fromDocument || inferFamilyFromFilePath(filePath);
}

function normalizeLegacyCase(testCase, family, filePath) {
  if (!testCase || typeof testCase !== "object") {
    throw fixtureError(filePath, "invalid legacy fixture case");
  }
  if (typeof testCase.id !== "string" || testCase.id.trim().length === 0) {
    throw fixtureError(filePath, "invalid legacy fixture case: missing id");
  }
  if (typeof testCase.category !== "string" || testCase.category.trim().length === 0) {
    throw fixtureError(filePath, `invalid legacy fixture case "${testCase.id}": missing category`);
  }
  if (typeof testCase.locale !== "string" || testCase.locale.trim().length === 0) {
    throw fixtureError(filePath, `invalid legacy fixture case "${testCase.id}": missing locale`);
  }
  const category = testCase.category;
  const isClarification = category === "clarification";
  if (isClarification) {
    if (!Array.isArray(testCase.turns)) {
      throw fixtureError(filePath, `invalid legacy fixture case "${testCase.id}": turns must be an array`);
    }
    validateTurns(testCase.turns, filePath, `legacy fixture case "${testCase.id}"`);
  } else {
    validateMessages(testCase.messages, filePath, `legacy fixture case "${testCase.id}"`);
  }

  const { assertions, ...rest } = testCase;
  const expect = assertions && typeof assertions === "object" ? assertions : {};
  const { enabledSkillIds: _ignoredEnabledSkillIds, ...normalizedRest } = rest;

  return {
    ...normalizedRest,
    family,
    skillId: family,
    variant: "legacy",
    fallbackPolicy: "allow-generic",
    expect,
    sourceFile: filePath,
  };
}

function normalizeV2Scenario(scenario, family, filePath) {
  if (!scenario || typeof scenario !== "object") {
    throw fixtureError(filePath, "invalid v2 fixture scenario");
  }

  const scenarioId =
    typeof scenario?.scenarioId === "string" && scenario.scenarioId.trim().length > 0
      ? scenario.scenarioId.trim()
      : typeof scenario?.id === "string" && scenario.id.trim().length > 0
        ? scenario.id.trim()
        : "unknown-scenario";
  if (scenarioId === "unknown-scenario") {
    throw fixtureError(filePath, "invalid v2 fixture scenario: missing scenarioId");
  }
  if (typeof scenario.category !== "string" || scenario.category.trim().length === 0) {
    throw fixtureError(filePath, `invalid v2 fixture scenario "${scenarioId}": missing category`);
  }
  if (typeof scenario.locale !== "string" || scenario.locale.trim().length === 0) {
    throw fixtureError(filePath, `invalid v2 fixture scenario "${scenarioId}": missing locale`);
  }
  if (scenario.variants == null || typeof scenario.variants !== "object") {
    throw fixtureError(filePath, `invalid v2 fixture scenario "${scenarioId}": variants must be an object`);
  }
  if (Array.isArray(scenario.variants)) {
    throw fixtureError(filePath, `invalid v2 fixture scenario "${scenarioId}": variants must be an object map`);
  }

  const { variants, expect: scenarioExpect, scenarioId: _ignoredScenarioId, id: _ignoredScenarioLegacyId, ...scenarioRest } = scenario;

  const variantEntries = Object.entries(variants);

  if (variantEntries.length === 0) {
    throw fixtureError(filePath, `invalid v2 fixture scenario "${scenarioId}": variants must not be empty`);
  }

  const isClarification = scenario.category === "clarification";
  if (isClarification) {
    if (!Array.isArray(scenario.turns)) {
      throw fixtureError(filePath, `invalid v2 fixture scenario "${scenarioId}": turns must be an array`);
    }
    validateTurns(scenario.turns, filePath, `v2 fixture scenario "${scenarioId}"`);
  } else {
    validateMessages(scenario.messages, filePath, `v2 fixture scenario "${scenarioId}"`);
  }

  return variantEntries.map(([variantName, variant]) => {
    if (!variant || typeof variant !== "object") {
      throw fixtureError(filePath, `invalid v2 fixture scenario "${scenarioId}": variant "${variantName}" must be an object`);
    }
    const enabledSkillIds = Array.isArray(variant.enabledSkillIds)
      ? variant.enabledSkillIds
      : Array.isArray(scenario.enabledSkillIds)
        ? scenario.enabledSkillIds
        : undefined;
    const fallbackPolicy =
      typeof variant.fallbackPolicy === "string" && variant.fallbackPolicy.trim().length > 0
        ? variant.fallbackPolicy
        : typeof scenario.fallbackPolicy === "string" && scenario.fallbackPolicy.trim().length > 0
          ? scenario.fallbackPolicy
          : "allow-generic";
    const expect =
      variant && Object.prototype.hasOwnProperty.call(variant, "expect")
        ? variant.expect
        : scenarioExpect;
    const {
      expect: _ignoredVariantExpect,
      enabledSkillIds: _ignoredVariantEnabledSkillIds,
      fallbackPolicy: _ignoredVariantFallbackPolicy,
      variant: _ignoredVariantName,
      id: _ignoredVariantId,
      ...variantRest
    } = variant;

    const normalized = {
      ...scenarioRest,
      ...variantRest,
      id: `${scenarioId}#${variantName}`,
      scenarioId,
      family,
      skillId: family,
      variant: variantName,
      fallbackPolicy,
      expect,
      sourceFile: filePath,
    };

    if (enabledSkillIds !== undefined) {
      normalized.enabledSkillIds = enabledSkillIds;
    }

    return normalized;
  });
}

function normalizeFixtureDocument(parsed, filePath) {
  if (!parsed || typeof parsed !== "object") {
    throw fixtureError(filePath, "invalid fixture document");
  }

  const family = normalizeSkillId(parsed, filePath);
  const version = typeof parsed.version === "string" ? parsed.version : "";

  if (version.startsWith("2.")) {
    if (typeof parsed.family !== "string" || parsed.family.trim().length === 0) {
      throw fixtureError(filePath, "invalid v2 fixture document: missing family");
    }
    if (!Array.isArray(parsed.scenarios)) {
      throw fixtureError(filePath, "invalid v2 fixture document: scenarios must be an array");
    }
    const scenarios = parsed.scenarios;
    return scenarios.flatMap((scenario) => normalizeV2Scenario(scenario, family, filePath));
  }

  if (version.startsWith("1.")) {
    if (typeof parsed.skillId !== "string" || parsed.skillId.trim().length === 0) {
      throw fixtureError(filePath, "invalid legacy fixture document: missing skillId");
    }
    if (!Array.isArray(parsed.testCases)) {
      throw fixtureError(filePath, "invalid legacy fixture document: testCases must be an array");
    }
    const testCases = parsed.testCases;
    return testCases.map((testCase) => normalizeLegacyCase(testCase, family, filePath));
  }

  throw fixtureError(filePath, `invalid fixture document version "${version || "unknown"}"`);
}

module.exports = {
  normalizeFixtureDocument,
};
