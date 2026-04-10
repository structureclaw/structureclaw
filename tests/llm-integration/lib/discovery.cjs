const fs = require("node:fs");
const path = require("node:path");

const { normalizeFixtureDocument } = require("./fixtures.cjs");

function collectFixtureFiles(currentDir) {
  if (!fs.existsSync(currentDir)) {
    return [];
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__llm_tests__") {
        const fixtureEntries = fs.readdirSync(entryPath, { withFileTypes: true }).sort((left, right) =>
          left.name.localeCompare(right.name)
        );
        for (const fixtureEntry of fixtureEntries) {
          if (fixtureEntry.isFile() && fixtureEntry.name.endsWith(".json")) {
            files.push(path.join(entryPath, fixtureEntry.name));
          }
        }
        continue;
      }
      files.push(...collectFixtureFiles(entryPath));
    }
  }

  return files;
}

function discoverLlmFixtureFiles(rootDir) {
  const agentSkillsRoot = path.join(rootDir, "backend", "src", "agent-skills");
  return collectFixtureFiles(agentSkillsRoot);
}

function loadLlmFixtures(rootDir) {
  const fixtureFiles = discoverLlmFixtureFiles(rootDir);
  const cases = [];

  for (const filePath of fixtureFiles) {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    cases.push(...normalizeFixtureDocument(parsed, filePath));
  }

  return cases;
}

module.exports = {
  discoverLlmFixtureFiles,
  loadLlmFixtures,
};
