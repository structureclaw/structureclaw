const fs = require("node:fs");
const path = require("node:path");

function walkDirectories(dirPath, onFile) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDirectories(fullPath, onFile);
      continue;
    }
    onFile(fullPath);
  }
}

function discoverLlmFixtureFiles(rootDir) {
  const skillRoot = path.join(rootDir, "backend", "src", "agent-skills");
  const fixtureFiles = [];

  walkDirectories(skillRoot, (filePath) => {
    const normalized = filePath.replace(/\\/gu, "/");
    if (normalized.includes("/__llm_tests__/") && normalized.endsWith(".json")) {
      fixtureFiles.push(filePath);
    }
  });

  return fixtureFiles.sort();
}

function loadLlmFixtures(rootDir) {
  const files = discoverLlmFixtureFiles(rootDir);
  const testCases = [];

  for (const filePath of files) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const cases = Array.isArray(parsed) ? parsed : parsed.testCases;
    if (!Array.isArray(cases)) {
      throw new Error(`Invalid llm fixture file: ${filePath}`);
    }
    testCases.push(...cases);
  }

  return testCases;
}

module.exports = {
  discoverLlmFixtureFiles,
  loadLlmFixtures,
};
